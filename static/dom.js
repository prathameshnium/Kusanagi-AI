/* Kusanagi AI -- safe DOM construction.
 *
 * Every string these apps display comes from somewhere untrusted: paper titles and
 * abstracts from OpenAlex/Crossref/arXiv/HN, filenames the user picked, and model
 * output from whichever provider is configured. The old code built HTML by template
 * literal and assigned it to innerHTML, which is how a paper title ends up executing.
 *
 * The rule in this codebase: untrusted text reaches the page as a text node, never as
 * markup. Build elements with el(), set strings via `text`, and hang behaviour off
 * listeners rather than inline onclick attributes.
 *
 * The single exception is rendered Markdown from a model, which has to be HTML to be
 * useful. markdown() runs it through DOMPurify and is the only innerHTML in the
 * project.
 */
window.Kusanagi = window.Kusanagi || {};

(function () {
    'use strict';

    /* Schemes that are safe to put in an href. Everything else -- javascript:,
       data:, vbscript:, and anything we do not recognise -- is dropped. */
    var SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

    /**
     * Return url if it is safe to navigate to, otherwise null.
     * Relative URLs resolve against the page and are allowed.
     */
    function safeUrl(url) {
        if (typeof url !== 'string' || !url.trim()) return null;
        var parsed;
        try {
            parsed = new URL(url, document.baseURI);
        } catch (e) {
            return null;
        }
        return SAFE_SCHEMES.indexOf(parsed.protocol) === -1 ? null : parsed.href;
    }

    /**
     * el(tag, props?, children?)
     *
     *   props.text      -> textContent (safe; use this for anything untrusted)
     *   props.class     -> className
     *   props.href      -> passed through safeUrl(); unsafe values drop the attribute
     *   props.dataset   -> data-* attributes
     *   props.on        -> {click: fn, ...} event listeners
     *   props.<other>   -> setAttribute, except DOM props like `disabled`/`value`
     *
     *   children: node | string | array (strings become text nodes)
     */
    function el(tag, props, children) {
        var node = document.createElement(tag);
        var p = props || {};

        Object.keys(p).forEach(function (key) {
            var value = p[key];
            if (value === null || value === undefined || value === false) return;

            if (key === 'text') { node.textContent = String(value); return; }
            if (key === 'class' || key === 'className') { node.className = value; return; }
            if (key === 'on') {
                Object.keys(value).forEach(function (evt) {
                    node.addEventListener(evt, value[evt]);
                });
                return;
            }
            if (key === 'dataset') {
                Object.keys(value).forEach(function (d) { node.dataset[d] = value[d]; });
                return;
            }
            if (key === 'href' || key === 'src') {
                var safe = safeUrl(value);
                if (safe) node.setAttribute(key, safe);
                return;
            }
            // Boolean/value properties have to be set as properties to behave.
            if (key === 'disabled' || key === 'checked' || key === 'value'
                || key === 'selected') {
                node[key] = value;
                return;
            }
            node.setAttribute(key, value === true ? '' : String(value));
        });

        append(node, children);
        return node;
    }

    /** Append a node, a string, or a (nested) array of either. */
    function append(parent, children) {
        if (children === null || children === undefined || children === false) return parent;
        if (Array.isArray(children)) {
            children.forEach(function (c) { append(parent, c); });
            return parent;
        }
        parent.appendChild(
            children instanceof Node ? children : document.createTextNode(String(children))
        );
        return parent;
    }

    /** An external link that cannot leak the opener or be a javascript: URL. */
    function link(url, text, className) {
        var safe = safeUrl(url);
        if (!safe) return el('span', { class: className || '', text: text });
        return el('a', {
            class: className || '',
            href: safe,
            text: text,
            target: '_blank',
            rel: 'noopener noreferrer',
        });
    }

    /** Remove every child of a node. */
    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
        return node;
    }

    /** Replace a node's contents with the given children. */
    function replace(node, children) {
        return append(clear(node), children);
    }

    /** Convenience: an SVG icon from a path `d`, built without innerHTML. */
    function icon(pathData, className) {
        var NSVG = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NSVG, 'svg');
        svg.setAttribute('class', className || 'w-5 h-5');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS(NSVG, 'path');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
        return svg;
    }

    /** A spinner, as a node. */
    function spinner(className) {
        return el('div', {
            class: 'inline-block border-4 border-accent border-t-transparent rounded-full '
                + 'animate-spin ' + (className || 'w-6 h-6'),
            role: 'status',
            'aria-label': 'Loading',
        });
    }

    var purifyReady = false;

    /* Force every link produced by Markdown to open safely. DOMPurify already
       strips javascript: hrefs; this stops tabnabbing on the ones it keeps. */
    function initPurify() {
        if (purifyReady || typeof DOMPurify === 'undefined') return;
        DOMPurify.addHook('afterSanitizeAttributes', function (node) {
            if (node.tagName === 'A' && node.hasAttribute('href')) {
                node.setAttribute('target', '_blank');
                node.setAttribute('rel', 'noopener noreferrer');
            }
        });
        purifyReady = true;
    }

    /**
     * Render untrusted Markdown into `target`.
     *
     * This is the only place in the project that assigns innerHTML. It is safe only
     * because DOMPurify runs on the output; if DOMPurify is missing we degrade to
     * plain text rather than rendering unsanitised markup.
     */
    function markdown(target, text) {
        var source = String(text === null || text === undefined ? '' : text);

        if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
            target.textContent = source;
            return target;
        }

        initPurify();
        var math = protectMath(source);
        var html = marked.parse(math.text, { breaks: true, gfm: true });
        target.innerHTML = DOMPurify.sanitize(html, {
            // No inline styles: the CSP blocks them anyway, and they are a
            // well-trodden route to UI redressing.
            FORBID_ATTR: ['style'],
            FORBID_TAGS: ['style', 'form', 'input', 'button'],
            ALLOW_DATA_ATTR: false,
        });
        restoreMath(target, math.pieces);
        typesetMath(target);
        codeCopy(target);
        return target;
    }

    /* Give each code block a bar with its language and a Copy button that
       copies the code exactly as written. */
    function codeCopy(target) {
        var ui = window.Kusanagi.ui;
        if (!ui || !ui.bindCopy) return;
        Array.prototype.forEach.call(target.querySelectorAll('pre'), function (pre) {
            var code = pre.querySelector('code') || pre;
            var lang = /language-([\w+#-]+)/.exec(code.className || '');
            var button = el('button', {
                type: 'button', class: 'code-copy', text: 'Copy',
                'aria-label': 'Copy ' + (lang ? lang[1] + ' ' : '') + 'code',
            });
            ui.bindCopy(button, function () { return code.textContent; });
            var block = el('div', { class: 'code-block' }, [
                el('div', { class: 'code-head' }, [
                    el('span', { text: lang ? lang[1] : 'code' }),
                    button,
                ]),
            ]);
            pre.parentNode.insertBefore(block, pre);
            block.appendChild(pre);
        });
    }

    /* ------------------------------------------------------------------ math */

    // Placeholder made only of letters and digits, so Markdown leaves it alone.
    var MATH_TOKEN = /KMATHX(\d+)XKMATH/g;

    /**
     * Pull LaTeX out before Markdown sees it. Otherwise $\mathrm{Cr_2O_3}$ loses
     * its underscores to emphasis and \\ line breaks to escaping. Code spans
     * and fences are skipped, so a $ in code stays a dollar sign.
     */
    function protectMath(source) {
        var pieces = [];
        var parts = source.split(/(```[\s\S]*?```|`[^`\n]*`)/);
        // Inline $...$ must hug its content ("$5 and $10" stays money). Written
        // without lookbehind, which Safari before 16.4 cannot parse at all.
        var math = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?=\S)[^$\n]*?[^\s$]\$(?!\d)/g;
        for (var i = 0; i < parts.length; i += 2) {   // odd indices are code
            parts[i] = parts[i].replace(math, function (m) {
                pieces.push(m);
                return 'KMATHX' + (pieces.length - 1) + 'XKMATH';
            });
        }
        return { text: parts.join(''), pieces: pieces };
    }

    /** Put the TeX back as plain text nodes -- never as markup. */
    function restoreMath(root, pieces) {
        if (!pieces.length) return;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function (node) {
            if (node.nodeValue.indexOf('KMATHX') === -1) return;
            node.nodeValue = node.nodeValue.replace(MATH_TOKEN, function (_, n) {
                return pieces[Number(n)] || '';
            });
        });
    }

    /**
     * Typeset TeX with the vendored KaTeX, when the page loads it. KaTeX builds
     * nodes and sets styles through the CSSOM, which a strict style-src allows.
     * trust stays false, so \href, \url and friends cannot make links.
     */
    function typesetMath(root) {
        if (typeof window.renderMathInElement !== 'function') return;
        try {
            window.renderMathInElement(root, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '$', right: '$', display: false },
                ],
                ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
                throwOnError: false,
                trust: false,
            });
        } catch (e) {
            // A malformed formula must not take out the whole answer.
        }
    }

    /* ------------------------------------------------------------- citations */

    var CITE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;
    var REF_HEADING = /^(sources|references|bibliography)$/i;

    function citeId(answerNo, n) { return 'cite-' + answerNo + '-' + n; }

    /** The same relabelling for copied text: [2] in answer 3 becomes [3:2]. */
    function relabelCitations(text, answerNo) {
        return String(text || '').replace(CITE, function (_, list) {
            return list.split(/\s*,\s*/).map(function (n) {
                return '[' + answerNo + ':' + n + ']';
            }).join('');
        });
    }

    function jumpTo(target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('cite-flash');
        void target.offsetWidth;   // restart the animation
        target.classList.add('cite-flash');
    }

    /**
     * Turn the model's [n] markers into academic-style [answer:source] links,
     * e.g. [1:2] for the second source of the first answer, each jumping to
     * its entry in that answer's reference list.
     *
     * `sources` are what the page actually sent ({title, url, snippet, meta});
     * the page builds their list itself, so no link in it can be invented.
     * A list the model wrote (citing from memory) is relabelled in place.
     */
    function citations(root, answerNo, sources) {
        sources = sources || [];
        var anchors = Object.create(null);

        // 1. A "## Sources" / "## References" list the model wrote.
        var headings = root.querySelectorAll('h1, h2, h3, h4, p > strong:only-child');
        var refHeading = null;
        Array.prototype.forEach.call(headings, function (h) {
            if (REF_HEADING.test(h.textContent.trim().replace(/:$/, ''))) refHeading = h;
        });
        var refBlock = refHeading && refHeading.tagName === 'STRONG' ? refHeading.parentNode : refHeading;
        if (refBlock) {
            for (var node = refBlock.nextElementSibling; node; node = node.nextElementSibling) {
                var entries = /^(UL|OL)$/.test(node.tagName) ? node.children : [node];
                Array.prototype.forEach.call(entries, function (entry) {
                    var first = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT).nextNode();
                    var m = first && /^\s*\[(\d{1,3})\]\s*/.exec(first.nodeValue);
                    if (!m || anchors[m[1]]) return;
                    first.nodeValue = first.nodeValue.slice(m[0].length);
                    entry.insertBefore(el('span', {
                        class: 'cite-label', text: '[' + answerNo + ':' + m[1] + '] ',
                    }), entry.firstChild);
                    entry.id = citeId(answerNo, m[1]);
                    entry.classList.add('cite-entry');
                    anchors[m[1]] = entry;
                });
            }
        }

        // 2. Inline markers in the prose.
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                return n.parentNode.closest('a, code, pre, .katex, .cite-entry')
                    ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            },
        });
        var texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        var cited = [];
        texts.forEach(function (textNode) {
            var value = textNode.nodeValue;
            CITE.lastIndex = 0;
            if (!CITE.test(value)) return;
            var frag = document.createDocumentFragment();
            var last = 0;
            value.replace(CITE, function (match, list, offset) {
                frag.appendChild(document.createTextNode(value.slice(last, offset)));
                list.split(/\s*,\s*/).forEach(function (n) {
                    n = String(Number(n));
                    if (cited.indexOf(n) === -1) cited.push(n);
                    var anchor = el('a', {
                        class: 'cite', href: '#' + citeId(answerNo, n),
                        text: '[' + answerNo + ':' + n + ']',
                        'aria-label': 'Source ' + n + ' of answer ' + answerNo,
                        dataset: { target: citeId(answerNo, n) },
                    });
                    anchor.addEventListener('click', function (e) {
                        var target = document.getElementById(citeId(answerNo, n));
                        if (!target) return;
                        e.preventDefault();
                        jumpTo(target);
                    });
                    frag.appendChild(anchor);
                });
                last = offset + match.length;
                return match;
            });
            frag.appendChild(document.createTextNode(value.slice(last)));
            textNode.parentNode.replaceChild(frag, textNode);
        });

        // 3. The page's own list for cited sources the model did not list.
        var missing = cited
            .filter(function (n) { return !anchors[n] && sources[n - 1]; })
            .sort(function (a, b) { return a - b; });
        if (!missing.length) return unlinkDangling(root);

        var list = el('ol', { class: 'cite-list' }, missing.map(function (n) {
            var src = sources[n - 1];
            var parts = [el('span', { class: 'cite-label', text: '[' + answerNo + ':' + n + '] ' })];
            parts.push(src.url ? link(src.url, src.title || src.url) : el('strong', { text: src.title || 'Source ' + n }));
            if (src.meta) parts.push(el('span', { class: 'cite-meta', text: ' · ' + src.meta }));
            if (src.snippet && !src.url) {
                parts.push(el('details', {}, [
                    el('summary', { text: 'Show excerpt' }),
                    el('blockquote', { text: src.snippet }),
                ]));
            }
            return el('li', { id: citeId(answerNo, n), class: 'cite-entry' }, parts);
        }));
        if (refBlock) {
            refBlock.parentNode.appendChild(list);
        } else {
            root.appendChild(el('h2', { text: 'Sources' }));
            root.appendChild(list);
        }
        return unlinkDangling(root);
    }

    /** A marker with nothing to point at stays a label, not a dead link.
     *  The target comes from a data attribute, not a.hash: on a page opened
     *  from file:// the hash can come back empty, and '#' alone is not a
     *  valid selector, which used to throw and lose the whole answer. */
    function unlinkDangling(root) {
        Array.prototype.forEach.call(root.querySelectorAll('a.cite'), function (a) {
            var id = a.getAttribute('data-target');
            if (id && root.querySelector('[id="' + id + '"]')) return;
            a.parentNode.replaceChild(el('span', { class: 'cite', text: a.textContent }), a);
        });
        return root;
    }

    /** Render Markdown into a fresh element. */
    function markdownEl(tag, className, text) {
        return markdown(el(tag, { class: className }), text);
    }

    window.Kusanagi.dom = {
        el: el,
        append: append,
        clear: clear,
        replace: replace,
        link: link,
        icon: icon,
        spinner: spinner,
        safeUrl: safeUrl,
        markdown: markdown,
        markdownEl: markdownEl,
        citations: citations,
        relabelCitations: relabelCitations,
    };
})();
