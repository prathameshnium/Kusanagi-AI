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
        var html = marked.parse(source, { breaks: true, gfm: true });
        target.innerHTML = DOMPurify.sanitize(html, {
            // No inline styles: the CSP blocks them anyway, and they are a
            // well-trodden route to UI redressing.
            FORBID_ATTR: ['style'],
            FORBID_TAGS: ['style', 'form', 'input', 'button'],
            ALLOW_DATA_ATTR: false,
        });
        return target;
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
    };
})();
