/* Orochimaru -- research chat, with in-memory RAG over documents loaded locally.
 *
 * This is also where OneTail went: with no documents loaded it is a plain
 * multi-turn chat; with documents loaded it answers from them, documents-first
 * with labelled background (the default) or strictly ("Documents only").
 *
 * Documents are read in the tab: PDF through pdf.js, Word / OpenDocument /
 * PowerPoint by unzipping them with the browser's own DecompressionStream,
 * HTML through DOMParser (which never runs scripts), and anything text-based
 * (txt, md, csv, dat, json, ...) as plain text.
 *
 * The conversation lives in `history` and `transcript` and nowhere else: not
 * localStorage, not sessionStorage, not a server. Reloading loses it.
 *
 * Documents live in `documents` and nowhere else. Filenames are attacker-controlled
 * for our purposes (a file can be named anything), so they are rendered as text and
 * carried on dataset attributes rather than interpolated into onclick handlers.
 */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    // Keep the prompt bounded so a long session does not silently blow the
    // context window (and the bill) one turn at a time. Even, so the history
    // sent to the model always opens on a user turn.
    var MAX_TURNS = 20;

    var CHUNK_SIZE = 1000;
    var CHUNK_OVERLAP = 200;
    var MAX_FILE_BYTES = 64 * 1024 * 1024;
    // Cap on what one archive may inflate to, so a zip bomb cannot take the tab.
    var MAX_UNZIPPED_BYTES = 256 * 1024 * 1024;

    // Read as plain text. Anything else with an extension below is parsed.
    var TEXT_TYPES = ['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'dat', 'json',
        'xml', 'tex', 'log', 'yaml', 'yml', 'ini'];
    var PARSED_TYPES = ['pdf', 'docx', 'odt', 'pptx', 'html', 'htm', 'rtf'];

    // Personas and skills live in prompts.js, beside the rules they are combined with.
    var REVIEW_PERSONAS = K.prompts.REVIEW_PERSONAS;

    /* A dynamic import() inside a classic script resolves relative to the *script*,
       not the document, and a wrong guess just 404s with no useful error. Anchor
       vendor paths to this file's own URL so the page can live anywhere. */
    var HERE = (document.currentScript && document.currentScript.src) || window.location.href;
    function vendorUrl(relative) { return new URL(relative, HERE).href; }

    var documents = Object.create(null);   // filename -> [chunk, ...]
    var parsing = Object.create(null);     // filename -> true while being read
    var lastAnswer = '';
    var transcript = [];                   // every turn, for "Copy chat"; memory only
    var history = [];                      // turns sent back to the model, trimmed
    var sessionTokens = 0;
    var answerCount = 0;                   // numbers citations as [answer:source]
    var activeSkills = [];                 // skill ids, see K.prompts.SKILLS
    var turns = [];                        // the chat as a saved file holds it
    var chatFile = '';                     // its file name, once saved to the folder
    var chatStarted = null;                // when it began, for that name
    var folder = null;                     // {name, ready} once a chat folder is chosen
    var busy = false;
    var settings = null;
    var pdfjsPromise = null;
    var ui = {};

    // The saved provider, narrowed to the ones this page offers (see mountSettings).
    function provider() { return settings.provider(); }
    function apiKey() { return K.keys.get(provider()); }
    function docNames() { return Object.keys(documents); }

    /* ---------------------------------------------------------------- pdf.js */

    /**
     * pdf.js v4 ships as an ES module only. v4 is what carries the fix for
     * CVE-2024-4367, where a crafted PDF could run arbitrary script through a
     * font glyph -- worth the ESM-only constraint for an app whose job is opening
     * PDFs someone emailed you.
     *
     * Loading it lazily keeps the rest of the page working if the import fails,
     * and lets us report why instead of dying on load.
     */
    function loadPdfJs() {
        if (pdfjsPromise) return pdfjsPromise;
        pdfjsPromise = import(vendorUrl('../vendor/pdfjs/pdf.min.mjs'))
            .then(function (mod) {
                mod.GlobalWorkerOptions.workerSrc = vendorUrl('../vendor/pdfjs/pdf.worker.min.mjs');
                return mod;
            })
            .catch(function (err) {
                pdfjsPromise = null;   // let a later attempt retry
                if (window.location.protocol === 'file:') {
                    throw new Error('The PDF engine cannot load from a file:// path. '
                        + 'Run "python scripts/serve.py" and open http://localhost:8000.');
                }
                throw new Error('Could not load the PDF engine: ' + err.message);
            });
        return pdfjsPromise;
    }

    function chunkText(text) {
        var step = CHUNK_SIZE - CHUNK_OVERLAP;
        if (step <= 0) step = CHUNK_SIZE;   // guard against a config that never advances
        var chunks = [];
        for (var i = 0; i < text.length; i += step) {
            chunks.push(text.slice(i, i + CHUNK_SIZE));
        }
        return chunks;
    }

    function extensionOf(name) {
        var match = /\.([a-z0-9]+)$/i.exec(name);
        return match ? match[1].toLowerCase() : '';
    }

    function handleFile(file) {
        if (!file) return;

        var ext = extensionOf(file.name);
        if (TEXT_TYPES.indexOf(ext) === -1 && PARSED_TYPES.indexOf(ext) === -1) {
            K.ui.toast('Cannot read .' + (ext || '?') + ' files. Supported: '
                + PARSED_TYPES.concat(TEXT_TYPES).join(', ') + '.', 'error');
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            K.ui.toast('That file is larger than 64 MB and would exhaust the tab.', 'error');
            return;
        }
        if (documents[file.name] || parsing[file.name]) {
            K.ui.toast('That document is already loaded.', 'error');
            return;
        }

        // Parsing is async; without this, choosing the same file again before
        // the first parse finished loaded it twice.
        parsing[file.name] = true;
        ui.statusDoc.textContent = 'Parsing...';
        addSystem('Reading ' + file.name + ' into memory...');

        extractText(file, ext)
            .then(function (fullText) {
                fullText = tidy(fullText);
                if (!fullText) {
                    throw new Error(ext === 'pdf'
                        ? 'This PDF has no extractable text. Scanned pages need OCR, '
                            + 'which this tool does not do.'
                        : file.name + ' contains no readable text.');
                }
                documents[file.name] = chunkText(fullText);
                renderDocList();
                ui.statusDoc.textContent = 'Ready';
                addSystem('Loaded ' + file.name + ' ('
                    + documents[file.name].length + ' chunks).');
            })
            .catch(function (err) {
                ui.statusDoc.textContent = 'Error';
                addSystem(file.name + ': ' + err.message, true);
            })
            .then(function () { delete parsing[file.name]; });
    }

    function tidy(text) {
        return String(text || '')
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function extractText(file, ext) {
        if (ext === 'pdf') return pdfText(file);
        if (ext === 'docx') return officeText(file, /^word\/document\.xml$/, ['p'], ['t']);
        if (ext === 'pptx') return officeText(file, /^ppt\/slides\/slide\d+\.xml$/, ['p'], ['t']);
        if (ext === 'odt') return officeText(file, /^content\.xml$/, ['p', 'h'], null);
        return file.text().then(function (text) {
            if (text.indexOf('\u0000') !== -1) {
                throw new Error('This looks like a binary file, not text.');
            }
            if (ext === 'html' || ext === 'htm') return htmlText(text);
            if (ext === 'rtf') return rtfText(text);
            return text;
        });
    }

    /* ----------------------------------------------------------- pdf */

    function pdfText(file) {
        return loadPdfJs()
            .then(function (pdfjs) {
                return file.arrayBuffer().then(function (buffer) {
                    return pdfjs.getDocument({
                        data: buffer,
                        // Defence in depth: never let the renderer eval font programs.
                        isEvalSupported: false,
                        disableAutoFetch: true,
                    }).promise;
                });
            })
            .then(function (pdf) {
                var pages = [];
                var chain = Promise.resolve();
                for (var i = 1; i <= pdf.numPages; i++) {
                    chain = chain.then(collectPage(pdf, i, pages));
                }
                return chain.then(function () { return pages.join('\n'); });
            });
    }

    function collectPage(pdf, pageNumber, sink) {
        return function () {
            return pdf.getPage(pageNumber)
                .then(function (page) { return page.getTextContent(); })
                .then(function (content) {
                    sink.push(content.items.map(function (item) { return item.str; }).join(' '));
                    ui.statusDoc.textContent =
                        Math.round((pageNumber / pdf.numPages) * 100) + '%';
                });
        };
    }

    /* ------------------------------------------- docx / pptx / odt (zip + xml) */

    /**
     * Read the entries whose names match `pattern` out of a zip archive.
     * Only stored and deflated entries exist in Office / OpenDocument files.
     */
    function unzip(buffer, pattern) {
        var view = new DataView(buffer);
        var eocd = -1;
        for (var i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd === -1) return Promise.reject(new Error('Not a valid document archive.'));

        var count = view.getUint16(eocd + 10, true);
        var at = view.getUint32(eocd + 16, true);
        var decoder = new TextDecoder();
        var entries = [];
        for (var n = 0; n < count; n++) {
            if (at + 46 > buffer.byteLength || view.getUint32(at, true) !== 0x02014b50) {
                return Promise.reject(new Error('The document archive is damaged.'));
            }
            var method = view.getUint16(at + 10, true);
            var size = view.getUint32(at + 20, true);
            var nameLen = view.getUint16(at + 28, true);
            var skip = nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
            var local = view.getUint32(at + 42, true);
            var name = decoder.decode(new Uint8Array(buffer, at + 46, nameLen));
            at += 46 + skip;
            if (!pattern.test(name)) continue;

            var start = local + 30 + view.getUint16(local + 26, true)
                + view.getUint16(local + 28, true);
            if (start + size > buffer.byteLength) {
                return Promise.reject(new Error('The document archive is damaged.'));
            }
            entries.push({ name: name, method: method, data: new Uint8Array(buffer, start, size) });
        }

        var budget = { left: MAX_UNZIPPED_BYTES };
        return Promise.all(entries.map(function (entry) {
            var bytes = entry.method === 0 ? Promise.resolve(entry.data)
                : entry.method === 8 ? inflate(entry.data, budget)
                : Promise.reject(new Error('Unsupported compression in the document.'));
            return bytes.then(function (data) {
                return { name: entry.name, text: decoder.decode(data) };
            });
        }));
    }

    function inflate(data, budget) {
        if (typeof DecompressionStream === 'undefined') {
            return Promise.reject(new Error('This browser cannot unpack Office files. '
                + 'Use a current Chrome, Edge, Firefox or Safari.'));
        }
        var reader = new Blob([data]).stream()
            .pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        var parts = [];
        var total = 0;
        function pump() {
            return reader.read().then(function (step) {
                if (step.done) {
                    var out = new Uint8Array(total);
                    var offset = 0;
                    parts.forEach(function (p) { out.set(p, offset); offset += p.length; });
                    return out;
                }
                total += step.value.length;
                budget.left -= step.value.length;
                if (budget.left < 0) {
                    reader.cancel();
                    throw new Error('The document unpacks to more than 256 MB.');
                }
                parts.push(step.value);
                return pump();
            });
        }
        return pump();
    }

    /**
     * Pull readable text out of Office XML. `paragraphs` are the element names
     * that end a line; `textTags`, when given, are the only elements whose text
     * counts (Word keeps field codes and such in other elements).
     */
    function xmlText(xml, paragraphs, textTags) {
        var doc = new DOMParser().parseFromString(xml, 'application/xml');
        var out = [];
        (function walk(node, inText) {
            for (var child = node.firstChild; child; child = child.nextSibling) {
                if (child.nodeType === 3) {
                    if (inText) out.push(child.nodeValue);
                    continue;
                }
                if (child.nodeType !== 1) continue;
                var tag = child.localName;
                if (tag === 'tab') out.push('\t');
                else if (tag === 'br' || tag === 'cr' || tag === 'line-break') out.push('\n');
                else if (tag === 's') out.push(' ');
                walk(child, textTags ? textTags.indexOf(tag) !== -1 : true);
                if (paragraphs.indexOf(tag) !== -1) out.push('\n');
            }
        })(doc, !textTags);
        return out.join('');
    }

    function officeText(file, pattern, paragraphs, textTags) {
        return file.arrayBuffer()
            .then(function (buffer) { return unzip(buffer, pattern); })
            .then(function (parts) {
                if (!parts.length) throw new Error('No text found in this document.');
                // slide2 before slide10
                parts.sort(function (a, b) {
                    return a.name.localeCompare(b.name, undefined, { numeric: true });
                });
                return parts.map(function (part) {
                    return xmlText(part.text, paragraphs, textTags);
                }).join('\n\n');
            });
    }

    /* ---------------------------------------------------------- html, rtf */

    /** DOMParser builds an inert document: no scripts run, nothing is fetched. */
    function htmlText(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        Array.prototype.forEach.call(
            doc.querySelectorAll('script, style, noscript, template, svg'),
            function (node) { node.remove(); });
        Array.prototype.forEach.call(
            doc.querySelectorAll('p, div, br, li, tr, h1, h2, h3, h4, h5, h6, pre, '
                + 'blockquote, section, article, header, footer, table'),
            function (node) { node.appendChild(doc.createTextNode('\n')); });
        Array.prototype.forEach.call(doc.querySelectorAll('td, th'),
            function (node) { node.appendChild(doc.createTextNode('\t')); });
        var title = doc.title ? doc.title + '\n\n' : '';
        return title + (doc.body ? doc.body.textContent : '');
    }

    var RTF_SKIP = ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object',
        'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata',
        'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl',
        'fldinst', 'filetbl', 'revtbl', 'bkmkstart', 'bkmkend'];

    /** RTF to text: keeps the prose, drops font tables, pictures and other
     *  destinations. Not a layout engine: tables come out as plain lines. */
    function rtfText(rtf) {
        var out = [];
        var stack = [];
        var skip = false;
        var word = /([a-zA-Z]+)(-?\d+)? ?/y;
        var cp1252 = new TextDecoder('windows-1252');
        var i = 0;
        while (i < rtf.length) {
            var ch = rtf[i];
            if (ch === '{') { stack.push(skip); i++; continue; }
            if (ch === '}') { skip = stack.length ? stack.pop() : false; i++; continue; }
            if (ch !== '\\' || i + 1 >= rtf.length) {
                if (!skip && ch !== '\r' && ch !== '\n') out.push(ch);
                i++;
                continue;
            }
            var next = rtf[i + 1];
            if (next === '\\' || next === '{' || next === '}') {
                if (!skip) out.push(next);
                i += 2;
            } else if (next === "'") {
                if (!skip) {
                    var code = parseInt(rtf.substr(i + 2, 2), 16);
                    out.push(cp1252.decode(new Uint8Array([isNaN(code) ? 63 : code])));
                }
                i += 4;
            } else if (next === '*') {
                skip = true;
                i += 2;
            } else {
                word.lastIndex = i + 1;
                var m = word.exec(rtf);
                if (!m) { i += 2; continue; }   // control symbol such as \~ or \-
                i = word.lastIndex;
                if (RTF_SKIP.indexOf(m[1]) !== -1) skip = true;
                else if (skip) continue;
                else if (m[1] === 'u' && m[2]) {
                    var n = parseInt(m[2], 10);
                    out.push(String.fromCharCode(n < 0 ? n + 65536 : n));
                    // Skip the plain-text fallback that follows a \u character.
                    i += rtf.substr(i, 2) === "\\'" ? 4 : 1;
                } else if (m[1] === 'par' || m[1] === 'line' || m[1] === 'row') out.push('\n');
                else if (m[1] === 'tab' || m[1] === 'cell') out.push('\t');
            }
        }
        return out.join('');
    }

    /* -------------------------------------------------------------- retrieval */

    /** Count non-overlapping occurrences without building a RegExp.
     *  The old code did `new RegExp(term, "g")` on raw user input, which threw on
     *  any query containing a bracket and invited catastrophic backtracking. */
    function countOccurrences(haystack, needle) {
        if (!needle) return 0;
        var count = 0;
        var from = 0;
        for (;;) {
            var at = haystack.indexOf(needle, from);
            if (at === -1) return count;
            count++;
            from = at + needle.length;
        }
    }

    function retrieve(query, limit) {
        var chunks = [];
        docNames().forEach(function (name) {
            chunks = chunks.concat(documents[name].map(function (text) {
                return { text: text, doc: name };
            }));
        });
        if (!chunks.length) return [];

        var terms = query.toLowerCase().split(/\s+/).filter(function (w) {
            return w.length > 3;
        });
        if (!terms.length) return chunks.slice(0, limit || 5);

        return chunks
            .map(function (chunk) {
                var lower = chunk.text.toLowerCase();
                var score = terms.reduce(function (sum, term) {
                    return sum + countOccurrences(lower, term);
                }, 0);
                return { chunk: chunk, score: score };
            })
            .filter(function (c) { return c.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, limit || 5)
            .map(function (c) { return c.chunk; });
    }

    /* ------------------------------------------------------------- chat pane */

    function scrollDown() { ui.log.scrollTop = ui.log.scrollHeight; }

    function orochiAvatar(extra) {
        return el('div', {
            class: 'flex-shrink-0 w-10 h-10 bg-tertiary rounded-full flex items-center '
                + 'justify-center font-bold text-accent border border-accent ' + (extra || ''),
            text: 'O',
            'aria-hidden': 'true',
        });
    }

    function addUser(text) {
        var said = el('p', { class: 'text-sm whitespace-pre-wrap break-words', text: text });
        transcript.push({ who: 'You', text: text, said: said });
        turns.push({ who: 'You', text: text });
        ui.log.appendChild(el('div', { class: 'flex items-start gap-4 justify-end' }, [
            el('div', { class: 'flex flex-col items-end gap-1 max-w-2xl' }, [
                el('div', { class: 'bg-accent text-accent-fg p-3 rounded-lg shadow-md' }, [
                    said,
                ]),
                K.ui.copyButton(function () { return text; }),
            ]),
        ]));
        scrollDown();
    }

    /** The excerpts behind an answer, as citable sources: document and excerpt. */
    function asSources(chunks) {
        return (chunks || []).map(function (chunk, index) {
            return { title: chunk.doc, meta: 'excerpt ' + (index + 1), snippet: chunk.text };
        });
    }

    function addAI(rawText, sources, reasoning, webSources) {
        answerCount += 1;
        var answerNo = answerCount;
        // Copies and the chat transcript carry the same [answer:source] labels
        // the reader sees.
        var text = dom.relabelCitations(rawText, answerNo);
        var body = el('div', {
            class: 'bg-tertiary p-4 rounded-lg shadow-md prose prose-invert '
                + 'text-sm text-fg-primary break-words',
        });
        dom.markdown(body, rawText);
        dom.citations(body, answerNo, sources);
        // Its Read aloud button, and a click on any paragraph reads from there.
        var readAloud = K.ui.speakButton(function () { return K.ui.speakableParts(body); });
        K.ui.readOnClick(body, readAloud);
        // `node` lets "Read chat aloud" speak the rendered answer, not raw Markdown.
        transcript.push({ who: 'Orochimaru', text: text, node: body });
        turns.push({ who: 'Orochimaru', text: rawText, sources: sources || [],
            reasoning: reasoning || '', webSources: webSources || [] });
        ui.log.appendChild(el('div', { class: 'flex items-start gap-4' }, [
            orochiAvatar(),
            el('div', { class: 'flex flex-col items-start gap-1 max-w-3xl min-w-0' }, [
                K.ui.reasoningBlock(reasoning),
                body,
                K.ui.webSourcesBlock(webSources),
                el('div', { class: 'flex gap-2' }, [
                    K.ui.copyButton(function () { return text; }),
                    readAloud,
                ]),
            ]),
        ]));
        scrollDown();
    }

    /** The whole conversation as speech: who said it, then what was said,
     *  block by block so each is highlighted as it is read. */
    function chatAsSpeech() {
        var parts = [];
        transcript.forEach(function (turn) {
            var own = turn.node ? K.ui.speakableParts(turn.node)
                : [{ node: turn.said || null, text: turn.text }];
            if (own.length) own[0] = { node: own[0].node, text: turn.who + ' said: ' + own[0].text };
            parts = parts.concat(own);
        });
        return parts;
    }

    /** The whole conversation as Markdown, ready to paste. */
    function chatAsMarkdown() {
        return transcript.map(function (turn) {
            return '**' + turn.who + ':**\n\n' + turn.text;
        }).join('\n\n---\n\n');
    }

    /* ------------------------------------------------------- saved chats */

    // Machine-readable copy of the chat at the end of each file, in an HTML
    // comment so Markdown viewers hide it. It is what "reopen" reads back.
    var DATA_START = '<!-- kusanagi-chat ';
    var DATA_END = ' -->';

    /** The first question, made safe for a file name. */
    function chatTopic() {
        var first = turns.filter(function (t) { return t.who === 'You'; })[0];
        return (first ? first.text : 'chat')
            .replace(/[\\/:*?"<>|#\[\]\x00-\x1f\x7f]+/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 50).trim() || 'chat';
    }

    function chatFileName(when) {
        return 'Orochimaru - ' + chatTopic() + ' - ' + K.ui.fileStamp(when) + '.md';
    }

    function validDate(d) {
        return d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
    }

    /** The chat as a Markdown file: the conversation, then its data. */
    function chatDocument() {
        var data = JSON.stringify({
            v: 1,
            created: validDate(chatStarted).toISOString(),
            model: ui.model.value,
            turns: turns,
            history: history,
        // "--" cannot appear inside an HTML comment; inside JSON strings it is
        // the only place it can occur, and \u002d reads back as "-".
        }).replace(/--/g, '-\\u002d');
        return '# ' + chatTopic() + '\n\n' + chatAsMarkdown() + '\n\n'
            + DATA_START + data + DATA_END + '\n';
    }

    function readChatDocument(text) {
        var start = text.lastIndexOf(DATA_START);
        if (start === -1) return null;
        var end = text.indexOf(DATA_END, start + DATA_START.length);
        if (end === -1) return null;
        try {
            var data = JSON.parse(text.slice(start + DATA_START.length, end));
            return data && data.v === 1 && Array.isArray(data.turns) ? data : null;
        } catch (e) {
            return null;
        }
    }

    /** Download the chat as Markdown (any browser). */
    function saveChat() {
        if (!turns.length) {
            K.ui.toast('Nothing to save yet.');
            return;
        }
        K.ui.saveFile(chatFile || chatFileName(validDate(chatStarted)), chatDocument(),
            'text/markdown;charset=utf-8');
    }

    /** "Kusanagi AI.md": what made the files in this folder, and which version. */
    function aboutDocument(count) {
        var site = /^https?:$/.test(window.location.protocol)
            ? window.location.origin + window.location.pathname.split('web_apps/')[0] : '';
        return [
            '# Kusanagi AI',
            '',
            'The chats in this folder were saved by Orochimaru, the research chat in',
            'Kusanagi AI.',
            '',
            '- Version: ' + K.VERSION,
            site ? '- Site: ' + site : null,
            '- Chats: ' + count,
            '- Last saved: ' + new Date().toLocaleString(),
            '',
            'Each chat is a Markdown file named "Orochimaru - <first question> - <date',
            'time>.md". Open it in any Markdown editor, or reopen it from Chat history',
            'in Orochimaru to carry on. The excerpts an answer quoted from your',
            'documents are saved inside that chat; the documents themselves are not,',
            'so load them again to ask more about them.',
            '',
        ].filter(function (line) { return line !== null; }).join('\n');
    }

    function isChatFile(name) { return /^Orochimaru - .+\.md$/.test(name); }

    // Bumped whenever another chat takes over the screen (new or reopened), so
    // a reply or a save that was in flight for the old one is dropped.
    var chatToken = 0;
    // Saves run one after another, so an older copy never lands last.
    var saving = Promise.resolve();

    /** A name not yet used in the folder: "... (2).md" when it is taken. */
    function freeName(name) {
        function attempt(n) {
            var candidate = n === 1 ? name : name.replace(/\.md$/, ' (' + n + ').md');
            return K.chats.has(candidate).then(function (taken) {
                return taken && n < 100 ? attempt(n + 1) : candidate;
            });
        }
        return attempt(1);
    }

    /** Write the open chat to the folder, if one is connected. */
    function persist() {
        saving = saving.then(saveNow, saveNow);
        return saving;
    }

    function saveNow() {
        if (!folder || !folder.ready || !turns.length) return null;
        var token = chatToken;
        if (!chatStarted) chatStarted = new Date();
        var named = chatFile ? Promise.resolve(chatFile) : freeName(chatFileName(chatStarted));
        return named.then(function (name) {
            if (token !== chatToken) return null;
            chatFile = name;
            return K.chats.write(name, chatDocument())
                .then(function () { return K.chats.list(isChatFile); })
                .then(function (files) {
                    return K.chats.write('Kusanagi AI.md', aboutDocument(files.length))
                        .then(function () { renderHistory(files); });
                });
        }).catch(function (err) {
            addSystem('Could not save the chat to the folder: ' + err.message, true);
        });
    }

    /* A chat file can come from anywhere, so take only the shapes this page
       writes: plain strings, and arrays of objects holding strings. */
    function pick(obj, keys) {
        var out = {};
        keys.forEach(function (k) { if (typeof obj[k] === 'string') out[k] = obj[k]; });
        return out;
    }

    function objects(list, keys) {
        return (Array.isArray(list) ? list : []).filter(function (x) {
            return x && typeof x === 'object';
        }).map(function (x) { return pick(x, keys); });
    }

    function cleanTurns(list) {
        return list.filter(function (t) {
            return t && typeof t.text === 'string';
        }).map(function (t) {
            if (t.who === 'You') return { who: 'You', text: t.text };
            return {
                who: 'Orochimaru',
                text: t.text,
                sources: objects(t.sources, ['title', 'meta', 'snippet', 'url']),
                reasoning: typeof t.reasoning === 'string' ? t.reasoning : '',
                webSources: objects(t.webSources, ['title', 'url']),
            };
        });
    }

    /**
     * What goes back to the model is the saved history only if it is plain
     * alternating text turns starting with the user. Otherwise it is rebuilt
     * from the turns on screen, so a file cannot carry anything the user does
     * not see.
     */
    function cleanHistory(saved, shown) {
        var ok = Array.isArray(saved) && saved.length % 2 === 0 && saved.every(function (m, i) {
            return m && typeof m.content === 'string'
                && m.role === (i % 2 === 0 ? 'user' : 'assistant');
        }) && saved.length / 2 <= shown.filter(function (t) { return t.who === 'You'; }).length;
        if (ok) {
            return saved.map(function (m) { return { role: m.role, content: m.content }; });
        }
        var rebuilt = [];
        for (var i = 0; i + 1 < shown.length; i++) {
            if (shown[i].who === 'You' && shown[i + 1].who === 'Orochimaru') {
                rebuilt.push({ role: 'user', content: shown[i].text },
                    { role: 'assistant', content: shown[i + 1].text });
                i += 1;
            }
        }
        return rebuilt.slice(-MAX_TURNS / 2);
    }

    function openChat(name) {
        K.chats.read(name).then(function (text) {
            var data = readChatDocument(text);
            if (!data) {
                K.ui.toast('That file has no Orochimaru chat data, so it cannot be reopened.',
                    'error');
                return;
            }
            var shown = cleanTurns(data.turns);
            resetChat();
            // One announcement, not the whole chat read out turn by turn.
            ui.log.setAttribute('aria-busy', 'true');
            shown.forEach(function (t) {
                if (t.who === 'You') addUser(t.text);
                else addAI(t.text, t.sources, t.reasoning, t.webSources);
            });
            ui.log.removeAttribute('aria-busy');
            history = cleanHistory(data.history, shown);
            chatFile = name;
            chatStarted = validDate(new Date(data.created));
            addSystem('Reopened ' + name.replace(/\.md$/, '') + '. The excerpts its answers '
                + 'quoted are saved with it, but not the documents; load them again to ask '
                + 'more about them.');
            renderHistory();
            setSidebar(false);
        }).catch(function (err) {
            K.ui.toast('Could not open the chat: ' + err.message, 'error');
        });
    }

    function deleteChat(name) {
        if (!window.confirm('Delete "' + name + '" from the folder? This cannot be undone.')) return;
        K.chats.remove(name).then(function () {
            // The open chat would otherwise be written straight back on the next answer.
            if (name === chatFile) {
                resetChat();
                addSystem('Deleted that chat. This is a new one.');
            }
            renderHistory();
        }).catch(function (err) {
            K.ui.toast('Could not delete it: ' + err.message, 'error');
        });
    }

    function chooseFolder() {
        K.chats.pick().then(function (name) {
            folder = { name: name, ready: true };
            addSystem('Saving chats to the folder "' + name + '".');
            renderHistory();
            persist();
        }).catch(function (err) {
            if (err && err.name === 'AbortError') return;   // picker closed
            K.ui.toast('Could not use that folder: ' + err.message, 'error');
        });
    }

    function reconnectFolder() {
        K.chats.reconnect().then(function (ok) {
            folder.ready = ok;
            renderHistory();
            if (ok) persist();
        }).catch(function (err) {
            K.ui.toast('The browser did not allow access: ' + err.message, 'error');
        });
    }

    function stopSaving() {
        K.chats.forget().then(function () {
            folder = null;
            addSystem('Stopped saving chats. The files already in the folder stay there.');
            renderHistory();
        });
    }

    /** The Settings row and the Chat history panel. `files` skips a re-read. */
    function renderHistory(files) {
        var setup;
        if (!K.chats.supported) {
            setup = [el('p', { class: 'text-fg-secondary', text: 'Needs Chrome or Edge. In '
                + 'this browser, use Save in the top bar to download a chat.' })];
        } else if (!folder) {
            setup = [
                el('button', { type: 'button', class: 'btn btn-secondary text-xs w-full',
                    text: 'Choose a folder...', on: { click: chooseFolder } }),
                el('p', { class: 'text-[10px] text-fg-secondary mt-1', text: 'Each chat is '
                    + 'saved there as a Markdown file as you go, with a "Kusanagi AI.md" '
                    + 'note on the version. Off until you choose one.' }),
            ];
        } else {
            setup = [el('div', { class: 'flex items-center justify-between gap-2' }, [
                el('span', { class: 'truncate', text: 'Saving to ' + folder.name }),
                el('button', { type: 'button', class: 'text-danger hover:underline shrink-0',
                    text: 'Stop', on: { click: stopSaving } }),
            ])];
        }
        dom.replace(ui.historySetup, setup);

        ui.historyPanel.classList.toggle('hidden', !folder);
        if (!folder) return;

        if (!folder.ready) {
            ui.historyCount.textContent = '';
            dom.replace(ui.historyBody, [
                el('button', { type: 'button', class: 'btn btn-secondary text-xs w-full',
                    text: 'Allow access to ' + folder.name, on: { click: reconnectFolder } }),
                el('p', { class: 'text-[10px] text-fg-secondary mt-1', text: 'The browser '
                    + 'asks again each visit before the page can read the folder.' }),
            ]);
            return;
        }

        var listed = files ? Promise.resolve(files) : K.chats.list(isChatFile);
        listed.then(function (list) {
            ui.historyCount.textContent = String(list.length);
            if (!list.length) {
                dom.replace(ui.historyBody, el('p', { class: 'text-fg-secondary italic',
                    text: 'No saved chats yet. They appear here after the first answer.' }));
                return;
            }
            dom.replace(ui.historyBody, el('div', { class: 'history-list' },
                list.map(function (f) {
                    var title = f.name.replace(/^Orochimaru - /, '').replace(/\.md$/, '');
                    var open = { type: 'button', class: 'history-open', title: f.name,
                        on: { click: function () { openChat(f.name); } } };
                    if (f.name === chatFile) open['aria-current'] = 'true';
                    return el('div', {
                        class: 'history-item' + (f.name === chatFile ? ' is-current' : ''),
                    }, [
                        el('button', open, [title]),
                        el('button', {
                            type: 'button', class: 'history-delete',
                            'aria-label': 'Delete ' + title, text: '\u2715',
                            on: { click: function () { deleteChat(f.name); } },
                        }),
                    ]);
                })));
        }).catch(function (err) {
            dom.replace(ui.historyBody, el('p', { class: 'text-danger',
                text: 'Could not read the folder: ' + err.message }));
        });
    }

    /** Start an empty chat. A chat already saved to the folder stays there. */
    function resetChat() {
        chatToken += 1;
        sessionTokens = 0;
        answerCount = 0;
        lastAnswer = '';
        transcript = [];
        turns = [];
        history = [];
        chatFile = '';
        chatStarted = null;
        ui.tokens.textContent = '0';
        ui.speed.textContent = '--';
        K.ui.stopSpeech();
        greeting();
    }

    /* ----------------------------------------------------------- sidebar */

    var narrow = window.matchMedia('(max-width: 1023px)');

    function setSidebar(open) {
        var wasOpen = ui.sidebar.classList.contains('is-open');
        ui.sidebar.classList.toggle('is-open', open);
        ui.scrim.classList.toggle('hidden', !open);
        ui.sidebarToggle.setAttribute('aria-expanded', String(open));
        // Off screen is not hidden: keep a closed drawer out of the Tab order
        // and away from screen readers.
        ui.sidebar.inert = narrow.matches && !open;
        if (open && !wasOpen) {
            var first = ui.sidebar.querySelector('button, a[href], input, select, summary');
            if (first) first.focus();
        } else if (!open && wasOpen && narrow.matches) {
            ui.sidebarToggle.focus();
        }
    }

    /** System notices. Filenames land here, so this is text -- the old version
     *  built "<strong>" + file.name + "</strong>" and assigned innerHTML. */
    function addSystem(text, isError) {
        ui.log.appendChild(el('div', { class: 'flex justify-center my-2' }, [
            el('span', {
                class: 'text-xs px-3 py-1 rounded-full max-w-2xl text-center '
                    + (isError
                        ? 'bg-danger/20 text-danger'
                        : 'bg-primary border border-tertiary text-fg-secondary'),
                text: text,
            }),
        ]));
        scrollDown();
    }

    function addThinking() {
        var node = el('div', { class: 'flex items-start gap-4' }, [
            orochiAvatar('animate-pulse'),
            el('div', {
                class: 'bg-tertiary p-3 rounded-lg text-fg-secondary italic text-sm',
                text: 'Thinking...',
            }),
        ]);
        ui.log.appendChild(node);
        scrollDown();
        return node;
    }

    function greeting() {
        dom.replace(ui.log, el('div', { class: 'flex items-start gap-4' }, [
            orochiAvatar(),
            el('div', { class: 'bg-tertiary p-4 rounded-lg max-w-3xl shadow-md' }, [
                el('p', { class: 'font-bold text-accent mb-1', text: 'Orochimaru' }),
                el('ul', { class: 'list-disc ml-5 mt-1 text-sm opacity-90 space-y-1' }, [
                    el('li', { text: 'Ask anything, or load documents (PDF, Word, text, '
                        + 'CSV, Markdown, HTML and more) to ask about them.' }),
                    el('li', { text: '"Answer from" chooses documents plus labelled general '
                        + 'knowledge (the default), or documents only.' }),
                    el('li', { text: 'Documents and messages are held in memory only. '
                        + 'Reloading the page discards them.' }),
                ]),
            ]),
        ]));
    }

    /* ------------------------------------------------------------- documents */

    function renderDocList() {
        var names = docNames();
        ui.docCount.textContent = String(names.length);

        var chunks = names.reduce(function (sum, n) { return sum + documents[n].length; }, 0);
        ui.statusChunks.textContent = String(chunks);

        if (!names.length) {
            dom.replace(ui.docList, el('p', {
                class: 'text-[10px] text-fg-secondary italic p-4 text-center border '
                    + 'border-dashed border-tertiary rounded',
                text: 'No documents loaded. Load one to begin.',
            }));
            ui.statusDoc.textContent = 'None';
            return;
        }

        dom.replace(ui.docList, names.map(function (name) {
            var remove = el('button', {
                type: 'button',
                class: 'text-fg-secondary hover:text-danger transition opacity-60 '
                    + 'group-hover:opacity-100 shrink-0 px-1',
                // Filename travels as data, never as code.
                dataset: { doc: name },
                'aria-label': 'Remove ' + name,
                text: '✕',
            });
            remove.addEventListener('click', function () { removeDocument(name); });

            return el('div', {
                class: 'bg-tertiary rounded p-2 flex justify-between items-center gap-2 group',
            }, [
                el('span', {
                    class: 'truncate text-xs text-fg-primary',
                    title: name,
                    text: name,
                }),
                remove,
            ]);
        }));
    }

    function removeDocument(name) {
        if (!window.confirm('Remove "' + name + '" from memory?')) return;
        delete documents[name];
        renderDocList();
        addSystem('Dropped ' + name + '.');
    }

    /* ------------------------------------------------------------------ chat */

    function setBusy(state) {
        busy = state;
        ui.send.disabled = state;
        ui.input.disabled = state;
    }

    /* Trim in one go, to half the cap: dropping the oldest turn on every
       message would change the start of the conversation each time and miss
       the prompt cache on every turn instead of once in a while. */
    function trimHistory() {
        if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS / 2);
    }

    /** "Documents only" is on. */
    function strictMode() { return ui.mode.value === 'strict'; }

    /**
     * Send `messages` and show the reply. `userFacing` is what the chat shows.
     * `kept` is what history keeps for later turns (default `userFacing`, in
     * place of whatever one-shot prompt a skill built). `sources` are what the
     * answer may cite.
     */
    function ask(messages, userFacing, sources, kept) {
        if (busy) return;
        if (!apiKey()) {
            K.ui.toast('Configure a provider first.', 'error');
            settings.open();
            return;
        }

        addUser(userFacing);
        var thinking = addThinking();
        setBusy(true);
        var started = performance.now();
        var token = chatToken;

        K.callWithFallback(provider(), {
            apiKey: apiKey(),
            model: ui.model.value,
            temperature: parseFloat(ui.temp.value),
            fallback: K.prefs.modelFallback(),
            messages: messages,
            conversation: true,
        }).then(function (res) {
            if (token !== chatToken) return;   // another chat is open now
            thinking.remove();
            if (res.model !== ui.model.value) {
                addSystem('Answered by ' + res.model + ': '
                    + ui.model.value + ' was unavailable.');
            }
            addAI(res.text, sources, res.reasoning, res.webSources);
            K.ui.chime();
            lastAnswer = res.text;
            history.push({ role: 'user', content: kept || userFacing },
                { role: 'assistant', content: res.text });
            trimHistory();
            persist();

            var secs = (performance.now() - started) / 1000;
            var tokens = (res.usage && res.usage.total_tokens)
                || Math.ceil((JSON.stringify(messages).length + res.text.length) / 4);
            sessionTokens += tokens;
            ui.tokens.textContent = sessionTokens.toLocaleString();
            if (secs > 0) ui.speed.textContent = (tokens / secs).toFixed(1) + ' t/s';
            showCache(res.usage);
        }).catch(function (err) {
            if (token !== chatToken) return;
            thinking.remove();
            addSystem(err.message, true);
        }).then(function () {
            setBusy(false);
            ui.indicator.classList.add('is-invisible');
            ui.input.focus();
        });
    }

    /** Share of this answer's prompt read from Anthropic's prompt cache. */
    function showCache(usage) {
        if (!usage || usage.cache_read_tokens === undefined) {
            ui.cache.textContent = '--';
            return;
        }
        var prompt = usage.prompt_tokens || 0;
        ui.cache.textContent = prompt
            ? Math.round((100 * usage.cache_read_tokens) / prompt) + '%'
            : '--';
        ui.cache.title = usage.cache_read_tokens.toLocaleString() + ' tokens read from cache, '
            + usage.cache_write_tokens.toLocaleString() + ' written';
    }

    function send() {
        var query = ui.input.value.trim();
        if (!query) return;
        ui.input.value = '';
        closeSlash();
        query = runSlash(query);
        if (!query) return;

        // The system prompt never changes; the excerpts retrieved for this
        // question, the answer mode and the skills that are on go in the turn.
        var chunks = [];
        if (docNames().length) {
            ui.indicator.classList.remove('is-invisible');
            chunks = retrieve(query, 5);
        }
        var turn = K.prompts.chatTurn(query, chunks, docNames(), strictMode(), activeSkills);

        ask([{ role: 'system', content: K.prompts.chatSystemPrompt() }]
            .concat(history, [{ role: 'user', content: turn }]),
            query, asSources(chunks), keptTurn(turn, query));
    }

    /* Claude's prompt cache needs every earlier turn sent back byte for byte,
       excerpts included, so that is what history keeps there. Other providers
       keep the bare question, as before: small local models have little room. */
    function keptTurn(turn, query) {
        return provider() === 'anthropic' ? turn : query;
    }

    /* ---------------------------------------------------------------- skills */

    /** Run a skill once over the loaded documents. */
    function runSkill(skill) {
        if (!docNames().length) return;
        var isReview = skill.group === 'review';
        // Style skills (and others with nothing to do on their own) only
        // shape later answers.
        if (!isReview && skill.id !== 'summarise' && !skill.onDocs) return;
        var limit = isReview ? 8 : 6;
        var chunks = retrieve(skill.hint || skill.onDocs, limit);
        if (!chunks.length) chunks = openingChunks(limit);
        var messages;
        if (isReview) {
            messages = [{ role: 'user',
                content: K.prompts.review(skill.role, REVIEW_PERSONAS[skill.role], chunks) }];
        } else if (skill.onDocs) {
            messages = [
                { role: 'system', content: K.prompts.chatSystemPrompt() },
                { role: 'user', content: K.prompts.chatTurn(
                    skill.onDocs, chunks, docNames(), strictMode(), activeSkills) },
            ];
        } else {
            messages = [{ role: 'user', content: K.prompts.summarise(chunks) }];
        }
        ask(messages, skill.label + ' of the loaded documents', asSources(chunks));
    }

    /** The start of each document, in turn: where a summary or review should
     *  begin when no passage matches the skill's retrieval hint. */
    function openingChunks(limit) {
        var out = [];
        for (var i = 0; out.length < limit; i++) {
            var added = false;
            docNames().forEach(function (name) {
                if (out.length < limit && documents[name][i] !== undefined) {
                    out.push({ text: documents[name][i], doc: name });
                    added = true;
                }
            });
            if (!added) break;
        }
        return out;
    }

    /** Switch a skill on or off. `quiet` skips the one-off run over the
     *  documents, for "/skill question", where the question is sent next. */
    function toggleSkill(id, quiet) {
        var skill = K.prompts.skill(id);
        if (!skill) return;
        if (activeSkills.indexOf(id) !== -1) {
            activeSkills = activeSkills.filter(function (s) { return s !== id; });
            renderSkills();
            addSystem('Skill off: ' + skill.label + '.');
            return;
        }
        // One reviewer voice at a time.
        if (skill.group) {
            activeSkills = activeSkills.filter(function (s) {
                return K.prompts.skill(s).group !== skill.group;
            });
        }
        activeSkills.push(id);
        renderSkills();
        addSystem('Skill on: ' + skill.label + '. ' + skill.description);
        if (!quiet && docNames().length && !busy) runSkill(skill);
    }

    /** Skills whose command or name contains `text`; those that start with
     *  it come first. */
    function matchSkills(text) {
        var q = text.toLowerCase();
        var starts = [];
        var contains = [];
        K.prompts.SKILLS.forEach(function (s) {
            if (!q || s.id.indexOf(q) === 0 || s.label.toLowerCase().indexOf(q) === 0) {
                starts.push(s);
            } else if ((s.id + ' ' + s.label).toLowerCase().indexOf(q) !== -1) {
                contains.push(s);
            }
        });
        return starts.concat(contains);
    }

    function renderSkills() {
        var shown = matchSkills(ui.skillFilter.value.trim());
        var rows = [];
        K.prompts.SKILL_SECTIONS.forEach(function (section) {
            var inSection = shown.filter(function (s) {
                return (s.group || '') === section[0];
            });
            if (!inSection.length) return;
            rows.push(el('p', { class: 'skill-heading', text: section[1] }));
            inSection.forEach(function (skill) {
                var on = activeSkills.indexOf(skill.id) !== -1;
                rows.push(el('button', {
                    type: 'button',
                    class: 'skill',
                    'aria-pressed': String(on),
                    title: skill.description + ' (/' + skill.id + ')',
                    on: { click: function () { toggleSkill(skill.id); } },
                }, [skill.label]));
            });
        });
        if (!rows.length) {
            rows.push(el('p', { class: 'skill-heading', text: 'No skill matches.' }));
        }
        dom.replace(ui.skillList, rows);
        ui.skillCount.textContent = activeSkills.length ? activeSkills.length + ' on' : '';

        ui.activeSkills.classList.toggle('hidden', !activeSkills.length);
        dom.replace(ui.activeSkills, activeSkills.map(function (id) {
            var skill = K.prompts.skill(id);
            return el('button', {
                type: 'button',
                class: 'skill-chip',
                'aria-label': 'Turn off ' + skill.label,
                on: { click: function () { toggleSkill(id); } },
            }, [skill.label, el('span', { text: '✕', 'aria-hidden': 'true' })]);
        }));
    }

    /* ---------------------------------------------------- slash commands */

    // Typing "/" at the start of the box lists skills; Enter or Tab picks one.
    var slash = { items: [], index: 0 };

    function slashQuery() {
        var m = /^\/([\w-]*)$/.exec(ui.input.value);
        return m ? m[1] : null;
    }

    function closeSlash() {
        slash.items = [];
        ui.slashMenu.classList.add('hidden');
        ui.input.removeAttribute('aria-activedescendant');
        ui.input.setAttribute('aria-expanded', 'false');
    }

    function renderSlash() {
        var q = slashQuery();
        slash.items = q === null ? [] : matchSkills(q).slice(0, 8);
        if (!slash.items.length) { closeSlash(); return; }
        slash.index = Math.min(slash.index, slash.items.length - 1);
        dom.replace(ui.slashMenu, slash.items.map(function (skill, i) {
            var on = activeSkills.indexOf(skill.id) !== -1;
            return el('div', {
                id: 'slash-' + skill.id,
                class: 'slash-item',
                role: 'option',
                'aria-selected': String(i === slash.index),
                // mousedown, so the input keeps focus.
                on: { mousedown: function (e) { e.preventDefault(); pickSlash(i); } },
            }, [
                el('span', { class: 'slash-cmd', text: '/' + skill.id }),
                el('span', { class: 'slash-label', text: (on ? '\u2713 ' : '') + skill.label }),
                el('span', { class: 'slash-desc', text: skill.description }),
            ]);
        }));
        ui.slashMenu.classList.remove('hidden');
        ui.input.setAttribute('aria-expanded', 'true');
        ui.input.setAttribute('aria-activedescendant', 'slash-' + slash.items[slash.index].id);
    }

    function pickSlash(i) {
        var skill = slash.items[i];
        if (!skill) return;
        ui.input.value = '';
        closeSlash();
        toggleSkill(skill.id);
        ui.input.focus();
    }

    /** True if the key was the menu's to handle. */
    function slashKey(e) {
        if (!slash.items.length) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            var step = e.key === 'ArrowDown' ? 1 : -1;
            slash.index = (slash.index + step + slash.items.length) % slash.items.length;
            renderSlash();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            pickSlash(slash.index);
        } else if (e.key === 'Escape') {
            closeSlash();
        } else {
            return false;
        }
        e.preventDefault();
        return true;
    }

    /**
     * "/skill" on its own toggles the skill; "/skill question" switches it on
     * and asks the question. Returns the text left to send, or null if the
     * command was all there was.
     */
    function runSlash(query) {
        var m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(query);
        var skill = m && K.prompts.skill(m[1].toLowerCase());
        if (!skill) return query;
        var rest = (m[2] || '').trim();
        if (!rest) { toggleSkill(skill.id); return null; }
        if (activeSkills.indexOf(skill.id) === -1) toggleSkill(skill.id, true);
        return rest;
    }

    /* ---------------------------------------------------------------- status */

    function checkStatus() {
        var has = !!apiKey();
        ui.statusAi.textContent = has
            ? (provider() === 'ollama' ? 'Local (Ollama)' : K.providerLabel(provider()))
            : 'Disconnected';
        ui.statusAi.className = has ? 'text-success font-bold' : 'text-danger';
        ui.dot.className = 'w-2 h-2 rounded-full ml-auto mr-1 ' + (has ? 'bg-success' : 'bg-danger');
    }

    function updateRam() {
        var mem = window.performance && window.performance.memory;
        if (mem) {
            ui.ram.textContent = Math.round(mem.usedJSHeapSize / 1048576) + ' MB';
            return;
        }
        // Fall back to the size of what we are actually holding.
        var chars = 0;
        docNames().forEach(function (n) {
            documents[n].forEach(function (c) { chars += c.length; });
        });
        ui.ram.textContent = chars ? '~' + Math.round((chars * 2) / 1048576) + ' MB' : '--';
    }

    /* ------------------------------------------------------------------ init */

    function init() {
        ui = {
            log: document.getElementById('chat-history'),
            input: document.getElementById('chat-input'),
            send: document.getElementById('send-btn'),
            model: document.getElementById('model-select'),
            temp: document.getElementById('temp-slider'),
            mode: document.getElementById('answer-mode'),
            tempOut: document.getElementById('temp-val'),
            docList: document.getElementById('doc-list'),
            docCount: document.getElementById('doc-count'),
            statusAi: document.getElementById('status-ai'),
            statusDoc: document.getElementById('status-doc'),
            statusChunks: document.getElementById('status-chunks'),
            dot: document.getElementById('status-dot'),
            skillList: document.getElementById('skill-list'),
            skillFilter: document.getElementById('skill-filter'),
            skillCount: document.getElementById('skill-count'),
            slashMenu: document.getElementById('slash-menu'),
            activeSkills: document.getElementById('active-skills'),
            indicator: document.getElementById('context-indicator'),
            tokens: document.getElementById('perf-tokens'),
            speed: document.getElementById('perf-speed'),
            cache: document.getElementById('perf-cache'),
            ram: document.getElementById('perf-ram'),
            tts: document.getElementById('tts-btn'),
            upload: document.getElementById('doc-upload'),
            sidebar: document.getElementById('sidebar'),
            scrim: document.getElementById('sidebar-scrim'),
            sidebarToggle: document.getElementById('sidebar-toggle'),
            historyPanel: document.getElementById('history-panel'),
            historyBody: document.getElementById('history-body'),
            historyCount: document.getElementById('history-count'),
            historySetup: document.getElementById('history-setup'),
        };

        settings = K.ui.mountSettings({
            providers: ['gemini', 'anthropic', 'hf', 'openrouter', 'ollama'],
            title: 'Secure configuration',
            onSave: function () {
                checkStatus();
                K.ui.fillModelSelect(ui.model, provider());
                syncModel();
                effort.sync();
            },
        });

        K.ui.fillModelSelect(ui.model, provider());
        var syncModel = K.ui.bindModelControls({
            model: ui.model, temp: ui.temp, tempOut: ui.tempOut, provider: provider,
            summary: false,
        });
        // Model, effort, web and reasoning share the row under the chat input.
        var effort = K.ui.claudeControls(provider);
        document.getElementById('chat-controls').appendChild(effort.node);

        ui.sidebarToggle.addEventListener('click', function () {
            setSidebar(!ui.sidebar.classList.contains('is-open'));
        });
        ui.scrim.addEventListener('click', function () { setSidebar(false); });
        setSidebar(false);
        narrow.addEventListener('change', function () { setSidebar(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && ui.sidebar.classList.contains('is-open')) setSidebar(false);
        });

        renderHistory();
        K.chats.restore().then(function (found) {
            folder = found;
            renderHistory();
        });
        checkStatus();
        greeting();
        renderDocList();

        renderSkills();
        ui.skillFilter.addEventListener('input', renderSkills);
        ui.input.addEventListener('input', function () { slash.index = 0; renderSlash(); });
        ui.input.addEventListener('blur', closeSlash);

        ui.temp.addEventListener('input', function () {
            ui.tempOut.textContent = ui.temp.value;
        });

        document.getElementById('load-doc').addEventListener('click', function () {
            ui.upload.click();
        });
        ui.upload.addEventListener('change', function () {
            Array.prototype.forEach.call(ui.upload.files, handleFile);
            ui.upload.value = '';
        });

        ui.send.addEventListener('click', send);
        ui.input.addEventListener('keydown', function (e) {
            if (slashKey(e)) return;
            if (e.key === 'Enter') { e.preventDefault(); send(); }
        });

        document.getElementById('clear-chat').addEventListener('click', function () {
            resetChat();
            addSystem(folder ? 'New chat. The last one is in Chat history.' : 'New chat.');
            renderHistory();
        });
        document.getElementById('open-settings').addEventListener('click', function () {
            settings.open();
        });
        document.getElementById('purge-btn').addEventListener('click', K.ui.purgeAll);
        K.ui.bindCopy(document.getElementById('copy-chat'), chatAsMarkdown);
        document.getElementById('save-chat').addEventListener('click', saveChat);
        // Per-answer buttons read one answer; this one reads the whole chat.
        K.ui.bindSpeak(ui.tts, chatAsSpeech);

        // Only nag about leaving when there is actually something to lose.
        window.addEventListener('beforeunload', function (e) {
            if (!docNames().length) return;
            e.preventDefault();
            e.returnValue = '';
        });

        updateRam();
        setInterval(updateRam, 2000);
        ui.input.focus();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
