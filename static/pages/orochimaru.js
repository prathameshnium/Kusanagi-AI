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
    // Files sent whole to the AI: filename -> {provider, file}. Memory only,
    // like `documents`, but these do leave the tab (see sentPrefix).
    var sentFiles = Object.create(null);
    var lastAnswer = '';
    var transcript = [];                   // every turn, for "Copy chat"; memory only
    var history = [];                      // turns sent back to the model, trimmed
    var sessionTokens = 0;
    var answerCount = 0;                   // numbers citations as [answer:source]
    var activeSkills = [];                 // skill ids, see K.prompts.SKILLS
    var turns = [];                        // the chat as a saved file holds it
    var chatFile = '';                     // its file name, once saved to the folder
    var chatStarted = null;                // when it began, for that name
    var chatCategory = '';                 // the user's name for its group, or ''
    var folder = null;                     // {name, ready} once a chat folder is chosen
    var noHistory = false;                 // off by default; saving still needs a chosen folder
    var lastQuestion = '';                 // the one before, to make sense of follow-ups
    var busy = false;
    var settings = null;
    var pdfjsPromise = null;
    var ui = {};

    // The saved provider, narrowed to the ones this page offers (see mountSettings).
    function provider() { return settings.provider(); }
    function apiKey() { return K.keys.get(provider()); }
    function docNames() { return Object.keys(documents); }
    function sentNames() { return Object.keys(sentFiles); }

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

    /** Pieces of about CHUNK_SIZE characters, overlapping by CHUNK_OVERLAP,
     *  that end at a sentence (or failing that, a word) rather than mid-word. */
    function chunkText(text) {
        var chunks = [];
        var start = 0;
        while (start < text.length) {
            var end = Math.min(start + CHUNK_SIZE, text.length);
            if (end < text.length) end = cutPoint(text, start, end);
            chunks.push(text.slice(start, end).trim());
            if (end >= text.length) break;
            // Step back for the overlap, then forward to a word start; always advance.
            var next = Math.max(end - CHUNK_OVERLAP, start + 1);
            var space = text.indexOf(' ', next);
            start = space !== -1 && space < end ? space + 1 : end;
        }
        return chunks.filter(function (c) { return c; });
    }

    /** The best place to end a piece in text[start, end): the last sentence
     *  end in its second half, else the last space, else `end`. */
    function cutPoint(text, start, end) {
        var half = start + Math.floor((end - start) / 2);
        var window = text.slice(half, end);
        var sentence = -1;
        var re = /[.!?]["')\]]?\s/g;
        var m;
        while ((m = re.exec(window)) !== null) sentence = m.index + m[0].length;
        if (sentence !== -1) return half + sentence;
        var space = text.lastIndexOf(' ', end);
        return space > half ? space + 1 : end;
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

    /* --------------------------------------- files sent whole to the AI */

    /* "Send whole file to AI": the provider reads the file itself (a PDF's
       layout, tables and figures too) instead of the excerpts found here.
       Files are held provider-neutral ({type: 'file', ...}); providers.js turns
       them into each API's own blocks, and K.acceptsFiles() says which
       providers can take them (Anthropic for now).

       Privacy: the file is sent inline with each request, never to a file
       store; it stays in this tab's memory only, is never written into saved
       chats, and goes only to the provider it was sent to -- switch provider
       and it is held back, not passed on. */

    // One request may be at most 32 MB, and base64 adds a third.
    var MAX_SENT_BYTES = 20 * 1024 * 1024;
    var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    var IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp' };

    function sentBytes() {
        return sentNames().reduce(function (sum, n) { return sum + sentFiles[n].file.bytes; }, 0);
    }

    function base64Of(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var url = String(reader.result);
                resolve(url.slice(url.indexOf(',') + 1));
            };
            reader.onerror = function () { reject(reader.error || new Error('Could not read it.')); };
            reader.readAsDataURL(file);
        });
    }

    /** Hold `file` to send whole, to the provider chosen now: PDFs and images
     *  as base64, text files as text. */
    function handleSentFile(file) {
        if (!file) return;
        var to = provider();
        if (!K.acceptsFiles(to)) {
            K.ui.toast(K.providerLabel(to) + ' cannot take whole files here yet. Switch to '
                + 'Anthropic in Configure API, or use Load document.', 'error');
            return;
        }
        var ext = extensionOf(file.name);
        var image = IMAGE_TYPES[ext];
        if (!image && TEXT_TYPES.indexOf(ext) === -1 && PARSED_TYPES.indexOf(ext) === -1) {
            K.ui.toast('.' + (ext || '?') + ' files cannot be sent whole. Supported: '
                + PARSED_TYPES.concat(TEXT_TYPES, Object.keys(IMAGE_TYPES)).join(', ') + '.',
            'error');
            return;
        }
        if (sentFiles[file.name]) {
            K.ui.toast('That file is already sent to the AI.', 'error');
            return;
        }
        if (image && file.size > MAX_IMAGE_BYTES) {
            K.ui.toast('Images can be up to 5 MB.', 'error');
            return;
        }
        if (sentBytes() + file.size > MAX_SENT_BYTES) {
            K.ui.toast('Files sent whole are capped at 20 MB in all, to fit one request.',
                'error');
            return;
        }

        // The APIs read PDFs and images as they are. Word, PowerPoint,
        // OpenDocument, RTF and HTML they do not, so those go as their full
        // text, pulled out here by the same readers Load document uses.
        var read = ext === 'pdf' || image ? base64Of(file)
            : extractText(file, ext).then(function (text) {
                text = tidy(text);
                if (!text) throw new Error(file.name + ' contains no readable text.');
                return text;
            });

        read.then(function (data) {
            sentFiles[file.name] = { provider: to, file: {
                type: 'file',
                name: file.name,
                kind: ext === 'pdf' ? 'pdf' : image ? 'image' : 'text',
                mediaType: ext === 'pdf' ? 'application/pdf' : image || 'text/plain',
                data: data,
                bytes: file.size,
            } };
            renderDocList();
            addSystem('Sent whole to ' + K.providerLabel(to) + ' with each message: '
                + file.name + '. The provider receives the whole file under its API data '
                + 'policy. It is held in this tab only, never saved with the chat, and never '
                + 'sent to another provider.');
        }).catch(function (err) {
            addSystem(file.name + ': ' + err.message, true);
        });
    }

    /** A file leaving the device is the user's call each time: say what goes
     *  where before it does, from the button and from a drop alike. */
    function confirmSend(files) {
        if (!K.acceptsFiles(provider())) {
            K.ui.toast(K.providerLabel(provider()) + ' cannot take whole files here yet. Switch '
                + 'to Anthropic in Configure API, or use Load document.', 'error');
            return false;
        }
        var size = files.reduce(function (sum, f) { return sum + f.size; }, 0);
        return window.confirm('Send ' + files.map(function (f) { return f.name; }).join(', ')
            + ' (' + (size / 1048576).toFixed(1) + ' MB) whole to ' + K.providerLabel(provider())
            + '?\n\nThe entire file leaves this device with every message in this chat. '
            + 'Use "Load document" instead to keep it here and send only matching excerpts.');
    }

    /** The opening pair that carries the files sent whole to `to`. It comes
     *  first and never changes, so a prompt cache re-reads it every turn. */
    function sentPrefix(to) {
        var names = sentNames().filter(function (n) { return sentFiles[n].provider === to; });
        if (!names.length) return [];
        var parts = names.map(function (n) { return sentFiles[n].file; });
        // Images carry no name of their own, so name every file in the text.
        parts.push({ type: 'text', text: 'Attached files: ' + names.join(', ') + '. Answer '
            + 'from them where they are relevant, naming the file you draw on.' });
        return [{ role: 'user', content: parts },
            { role: 'assistant', content: 'I have the attached files and will use them.' }];
    }

    /** Files held back because the provider changed since they were sent. */
    function heldBack(to) {
        return sentNames().filter(function (n) { return sentFiles[n].provider !== to; });
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

    // Words too common to say anything about which passage answers a question.
    var STOPWORDS = {};
    ('a an and are as at be been but by can could did do does for from had has have '
        + 'how i if in into is it its me my no not of on or our so than that the their '
        + 'them then there these they this those to was we were what when where which '
        + 'who whom why will with would you your about also any each more most other '
        + 'some such only own same very just tell give show explain describe please').split(' ')
        .forEach(function (w) { STOPWORDS[w] = true; });

    /** Lower-case words and numbers, punctuation dropped: "XRD?" -> "xrd",
     *  "3.5" and "x-ray" stay whole. A RegExp over the text, never built from it. */
    function tokens(text) {
        return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:[.\-][\p{L}\p{N}]+)*/gu) || [])
            .map(stem);
    }

    /** A light English stemmer, so "measured", "measures" and "measuring"
     *  all meet "measure"'s stem. Short words and numbers are left alone. */
    function stem(w) {
        if (w.length < 5 || /\d/.test(w)) return w;
        if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
        if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
        if (/ing$/.test(w) && w.length > 5) return trimDouble(w.slice(0, -3));
        if (/ed$/.test(w) && w.length > 4) return trimDouble(w.slice(0, -2));
        if (/[^s]s$/.test(w)) w = w.slice(0, -1);
        return /e$/.test(w) ? w.slice(0, -1) : w;
    }
    function trimDouble(w) {
        if (/([^aeiouls])\1$/.test(w)) w = w.slice(0, -1);
        return /e$/.test(w) ? w.slice(0, -1) : w;
    }

    /** Query terms, stopwords out. Single letters only when they are digits. */
    function queryTerms(text) {
        return tokens(text).filter(function (t) {
            return !STOPWORDS[t] && (t.length > 1 || /\d/.test(t));
        });
    }

    // Term counts per piece, built once per document and dropped with it.
    var indexCache = new WeakMap();
    function indexOf(chunks) {
        var idx = indexCache.get(chunks);
        if (!idx) {
            idx = chunks.map(function (text) {
                var tf = Object.create(null);
                var words = tokens(text);
                words.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
                return { tf: tf, len: words.length };
            });
            indexCache.set(chunks, idx);
        }
        return idx;
    }

    var BM25_K1 = 1.2;
    var BM25_B = 0.75;

    /** The `limit` pieces that best answer `query`, ranked by BM25 over every
     *  loaded document: rare words count for more than common ones, and a word
     *  repeated in one piece counts less each time. `context` (the previous
     *  question) adds its words at half weight, so a follow-up such as "and the
     *  second sample?" still finds the passage the conversation is about. */
    function retrieve(query, limit, context) {
        limit = limit || 5;
        var pieces = [];
        docNames().forEach(function (name) {
            var idx = indexOf(documents[name]);
            documents[name].forEach(function (text, i) {
                pieces.push({ text: text, doc: name, tf: idx[i].tf, len: idx[i].len });
            });
        });
        if (!pieces.length) return [];
        if (ui.search && ui.search.value === 'exact') return exactSearch(pieces, query, limit);

        var weights = Object.create(null);
        queryTerms(context || '').forEach(function (t) { weights[t] = 0.5; });
        queryTerms(query).forEach(function (t) { weights[t] = 1; });
        var terms = Object.keys(weights);
        if (!terms.length) return pieces.slice(0, limit).map(asChunk);

        var n = pieces.length;
        var avgLen = pieces.reduce(function (sum, p) { return sum + p.len; }, 0) / n || 1;
        var idf = Object.create(null);
        terms.forEach(function (t) {
            var df = pieces.reduce(function (sum, p) { return sum + (p.tf[t] ? 1 : 0); }, 0);
            idf[t] = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        });

        return pieces
            .map(function (p) {
                var norm = BM25_K1 * (1 - BM25_B + BM25_B * p.len / avgLen);
                var score = terms.reduce(function (sum, t) {
                    var f = p.tf[t];
                    return f ? sum + weights[t] * idf[t] * f * (BM25_K1 + 1) / (f + norm) : sum;
                }, 0);
                return { piece: p, score: score };
            })
            .filter(function (c) { return c.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, limit)
            .map(function (c) { return asChunk(c.piece); });
    }

    function asChunk(p) { return { text: p.text, doc: p.doc }; }

    /** "Exact words": how often each query word appears in a piece, as written,
     *  part-words included ("magnet" finds "magnetisation"). No stemming or
     *  weighting, for when the precise term is what matters. */
    function exactSearch(pieces, query, limit) {
        var terms = (query.toLowerCase().match(/[\p{L}\p{N}]+(?:[.\-][\p{L}\p{N}]+)*/gu) || [])
            .filter(function (t) { return !STOPWORDS[t] && (t.length > 1 || /\d/.test(t)); });
        if (!terms.length) return pieces.slice(0, limit).map(asChunk);
        return pieces
            .map(function (p) {
                var lower = p.text.toLowerCase();
                var score = terms.reduce(function (sum, t) {
                    return sum + countOccurrences(lower, t);
                }, 0);
                return { piece: p, score: score };
            })
            .filter(function (c) { return c.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, limit)
            .map(function (c) { return asChunk(c.piece); });
    }

    /** Count non-overlapping occurrences without building a RegExp from input. */
    function countOccurrences(haystack, needle) {
        var count = 0;
        var from = 0;
        for (;;) {
            var at = haystack.indexOf(needle, from);
            if (at === -1) return count;
            count++;
            from = at + needle.length;
        }
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
        ui.log.appendChild(el('div', { class: 'flex items-start gap-4 justify-end msg-in' }, [
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
    /* A chat's category is the file's first line, a comment Markdown viewers
       hide: <!-- kusanagi-category: Spectroscopy --> */
    var CATEGORY = /^<!-- kusanagi-category: (.*?) -->\r?\n/;

    /** A category name the user typed, made safe for that comment. */
    function cleanCategory(name) {
        return String(name || '')
            .replace(/[\x00-\x1f\x7f>]/g, ' ')
            .replace(/-{2,}/g, '-')
            .replace(/\s+/g, ' ').trim().slice(0, 40);
    }

    function categoryOf(text) {
        var m = CATEGORY.exec(text || '');
        return m ? cleanCategory(m[1]) : '';
    }

    /** `text` with its category line set to `name` (removed when empty). */
    function withCategory(text, name) {
        var body = String(text).replace(CATEGORY, '');
        return name ? '<!-- kusanagi-category: ' + name + ' -->\n' + body : body;
    }

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
        return withCategory('# ' + chatTopic() + '\n\n' + chatAsMarkdown() + '\n\n'
            + DATA_START + data + DATA_END + '\n', chatCategory);
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
        if (noHistory || !folder || !folder.ready || !turns.length) return null;
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

    /** Put chat `name` in category `to` ('' for none). */
    function moveChat(name, to) {
        saving = saving.then(function () {
            if (name === chatFile) {
                chatCategory = to;
                return K.chats.write(name, chatDocument());
            }
            return K.chats.read(name).then(function (text) {
                return K.chats.write(name, withCategory(text, to));
            });
        }).then(function () { renderHistory(); }, function (err) {
            K.ui.toast('Could not move it: ' + err.message, 'error');
        });
    }

    /** Rename category `from` on every chat in it. */
    function renameCategory(from, files) {
        var to = cleanCategory(window.prompt('Rename the category "' + from + '" to:', from));
        if (!to || to === from) return;
        var inIt = files.filter(function (f) { return categoryOf(f.head) === from; });
        inIt.forEach(function (f) { moveChat(f.name, to); });
    }

    /** Ask where to put a chat, offering the categories already in use. */
    function chooseCategory(item, f, categories) {
        var current = categoryOf(f.head);
        var NEW = '\u0000new';
        var choices = [['', current ? 'Move to...' : 'Put in...']]
            .concat(categories.filter(function (c) { return c !== current; })
                .map(function (c) { return [c, c]; }))
            .concat(current ? [['\u0000none', 'No category']] : [])
            .concat([[NEW, 'New category...']]);
        var select = el('select', { class: 'history-select',
            'aria-label': 'Category for ' + f.name }, choices.map(function (c) {
            return el('option', { value: c[0], text: c[1] });
        }));
        select.addEventListener('change', function () {
            var to = select.value;
            if (to === NEW) to = cleanCategory(window.prompt('Name the new category:', ''));
            else if (to === '\u0000none') to = '';
            else if (!to) return;
            if (to === null || (to === '' && select.value === NEW)) { renderHistory(); return; }
            moveChat(f.name, to);
        });
        select.addEventListener('blur', function () { setTimeout(renderHistory, 200); });
        item.insertAdjacentElement('afterend', select);
        select.focus();
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
            var asked = shown.filter(function (t) { return t.who === 'You'; });
            lastQuestion = asked.length ? asked[asked.length - 1].text : '';
            chatFile = name;
            chatStarted = validDate(new Date(data.created));
            chatCategory = categoryOf(text);
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
            // Choosing a folder is asking to save, so it turns No history off.
            setNoHistory(false, true);
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

    /** No history: stop (or resume) writing chats to the folder. It does not
        make the chat private, so every message says so plainly. */
    function setNoHistory(on, quiet) {
        noHistory = on;
        ui.noHistory.setAttribute('aria-pressed', on ? 'true' : 'false');
        ui.noHistory.classList.toggle('is-active', on);
        if (!quiet) {
            addSystem(on
                ? 'No history: this chat is not saved on this device. It is not private: '
                    + 'the AI provider still receives every message, document excerpt and file '
                    + 'sent whole.'
                : (folder ? 'History on: chats are saved to "' + folder.name + '".'
                    : 'History on: choose a folder under Chat history to save chats.'));
        }
        renderHistory();
        if (!on) persist();
    }

    /** The Chat history panel and its folder row. `files` skips a re-read. */
    function renderHistory(files) {
        var setup;
        if (!K.chats.supported) {
            setup = [el('p', { class: 'text-fg-secondary', text: 'Needs Chrome or Edge. In '
                + 'this browser, use Save in the top bar to download a chat.' })];
        } else if (!folder) {
            setup = [
                el('button', { type: 'button', class: 'btn btn-secondary text-sm w-full',
                    text: 'Choose a folder...', on: { click: chooseFolder } }),
                el('p', { class: 'text-xs text-fg-secondary mt-1', text: 'Each chat is '
                    + 'saved there as a Markdown file as you go, with a "Kusanagi AI.md" '
                    + 'note on the version. Off until you choose one.' }),
            ];
        } else {
            setup = [el('div', { class: 'flex items-center justify-between gap-2' }, [
                el('span', { class: 'truncate', text: (noHistory ? 'Paused (No history): '
                    : 'Saving to ') + folder.name }),
                el('button', { type: 'button', class: 'text-danger hover:underline shrink-0',
                    text: 'Stop', on: { click: stopSaving } }),
            ])];
        }
        dom.replace(ui.historySetup, setup);

        if (!folder) {
            ui.historyCount.textContent = '';
            dom.replace(ui.historyBody, []);
            return;
        }

        if (!folder.ready) {
            ui.historyCount.textContent = '';
            dom.replace(ui.historyBody, [
                el('button', { type: 'button', class: 'btn btn-secondary text-sm w-full',
                    text: 'Allow access to ' + folder.name, on: { click: reconnectFolder } }),
                el('p', { class: 'text-xs text-fg-secondary mt-1', text: 'The browser '
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
            // Named categories A-Z, then chats with none.
            var groups = {};
            list.forEach(function (f) {
                var c = categoryOf(f.head);
                (groups[c] = groups[c] || []).push(f);
            });
            var named = Object.keys(groups).filter(function (c) { return c; }).sort(
                function (a, b) { return a.localeCompare(b); });
            var order = named.concat(groups[''] ? [''] : []);

            function item(f) {
                var title = f.name.replace(/^Orochimaru - /, '').replace(/\.md$/, '');
                var open = { type: 'button', class: 'history-open', title: f.name,
                    on: { click: function () { openChat(f.name); } } };
                if (f.name === chatFile) open['aria-current'] = 'true';
                var row = el('div', {
                    class: 'history-item' + (f.name === chatFile ? ' is-current' : ''),
                }, [
                    el('button', open, [title]),
                    el('button', {
                        type: 'button', class: 'history-move', text: '\u21C4',
                        title: 'Move to a category',
                        'aria-label': 'Move ' + title + ' to a category',
                        on: { click: function () { chooseCategory(row, f, named); } },
                    }),
                    el('button', {
                        type: 'button', class: 'history-delete',
                        'aria-label': 'Delete ' + title, text: '\u2715',
                        on: { click: function () { deleteChat(f.name); } },
                    }),
                ]);
                return row;
            }

            dom.replace(ui.historyBody, el('div', { class: 'history-list' },
                order.length === 1 && !order[0]
                    ? list.map(item)
                    : order.map(function (c) {
                        var head = [
                            el('span', { class: 'history-group-name',
                                text: c || 'No category' }),
                            el('span', { class: 'panel-count', text: String(groups[c].length) }),
                        ];
                        if (c) {
                            head.push(el('button', {
                                type: 'button', class: 'history-rename', text: 'Rename',
                                'aria-label': 'Rename the category ' + c,
                                on: { click: function (e) {
                                    // Inside <summary>: rename, do not fold.
                                    e.preventDefault();
                                    e.stopPropagation();
                                    renameCategory(c, list);
                                } },
                            }));
                        }
                        return el('details', { class: 'history-group', open: 'open' }, [
                            el('summary', {}, head),
                        ].concat(groups[c].map(item)));
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
        lastQuestion = '';
        chatFile = '';
        chatStarted = null;
        chatCategory = '';
        ui.tokens.textContent = '0';
        ui.speed.textContent = '--';
        K.ui.stopSpeech();
        greeting();
    }

    /** Clear: delete this chat's saved file, drop every document and file
     *  held in memory, and start an empty chat. */
    function clearAll() {
        if (!window.confirm('Clear this chat? Its saved file is deleted, loaded documents '
            + 'and files sent whole are dropped, and a new chat starts. This cannot be undone.')) {
            return;
        }
        var name = folder && folder.ready ? chatFile : '';
        // resetChat bumps chatToken first, so an answer still arriving cannot
        // write the chat back after its file is gone.
        resetChat();
        [documents, parsing, sentFiles].forEach(function (map) {
            Object.keys(map).forEach(function (k) { delete map[k]; });
        });
        indexCache = new WeakMap();
        ui.cache.textContent = '--';
        ui.cache.title = "Share of the last prompt read from Claude's prompt cache";
        renderDocList();
        (name ? K.chats.remove(name) : Promise.resolve()).then(function () {
            addSystem('Cleared. This is a new chat.');
            renderHistory();
        }).catch(function (err) {
            K.ui.toast('Cleared, but could not delete the saved file: ' + err.message, 'error');
            renderHistory();
        });
    }

    /* ----------------------------------------------------------- sidebar */

    var narrow = window.matchMedia('(max-width: 1023px)');

    function setSidebar(open) {
        var wasOpen = ui.sidebar.classList.contains('is-open');
        ui.sidebar.classList.toggle('is-open', open);
        ui.scrim.classList.toggle('hidden', !open);
        syncToggle();
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

    /** Wide screens: fold the sidebar column away, and remember it. */
    var COLLAPSED_KEY = 'kusanagi-orochimaru-sidebar';

    function setCollapsed(collapsed) {
        ui.sidebar.classList.toggle('is-collapsed', collapsed);
        syncToggle();
        try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? 'hidden' : 'shown'); }
        catch (e) { /* private mode */ }
    }

    function syncToggle() {
        var shown = narrow.matches ? ui.sidebar.classList.contains('is-open')
            : !ui.sidebar.classList.contains('is-collapsed');
        ui.sidebarToggle.setAttribute('aria-expanded', String(shown));
    }

    /** System notices. Filenames land here, so this is text -- the old version
     *  built "<strong>" + file.name + "</strong>" and assigned innerHTML. */
    function addSystem(text, isError) {
        ui.log.appendChild(el('div', { class: 'flex justify-center my-2 msg-in' }, [
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

    /* While waiting for the first word: one animation picked at random, and
       phrases that change every couple of seconds, so a long think feels
       alive rather than stuck. The art is CSS (see .think-* in input.css). */
    // Full class names, so the stylesheet build sees and keeps them.
    var THINK_ART = [['think-dots', 3], ['think-snake', 5], ['think-orbit', 3],
        ['think-ripple', 2], ['think-flip', 1], ['think-scan', 1]];
    /* Phrases come from thinking.js (1000 of them), dealt like cards from a
       shuffled deck so none repeats until every one has been shown. */
    var thinkDeck = [];
    function nextPhrase() {
        if (!thinkDeck.length) {
            thinkDeck = (K.THINKING && K.THINKING.length ? K.THINKING : ['Thinking']).slice();
            for (var i = thinkDeck.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var t = thinkDeck[i]; thinkDeck[i] = thinkDeck[j]; thinkDeck[j] = t;
            }
        }
        return thinkDeck.pop() + '...';
    }

    function anyOf(list) { return list[Math.floor(Math.random() * list.length)]; }

    function addThinking() {
        var art = anyOf(THINK_ART);
        var bits = [];
        for (var i = 0; i < art[1]; i++) bits.push(el('i'));
        var phrase = el('span', { class: 'think-phrase', text: nextPhrase() });
        var clock = el('span', { class: 'think-time', text: '0s' });
        var node = el('div', { class: 'flex items-start gap-4 msg-in' }, [
            orochiAvatar(),
            el('div', { class: 'think', role: 'status' }, [
                el('span', { class: 'think-art ' + art[0], 'aria-hidden': 'true' }, bits),
                phrase,
                clock,
            ]),
        ]);
        var started = Date.now();
        var ticks = 0;
        var timer = setInterval(function () {
            clock.textContent = Math.floor((Date.now() - started) / 1000) + 's';
            ticks += 1;
            if (ticks % 5) return;   // a new phrase every 2.5 s
            phrase.classList.add('is-swapping');
            setTimeout(function () {
                phrase.textContent = nextPhrase();
                phrase.classList.remove('is-swapping');
            }, 250);
        }, 500);
        node.stop = function () { clearInterval(timer); node.remove(); };
        ui.log.appendChild(node);
        scrollDown();
        return node;
    }

    /** True when the reader is at (or near) the bottom, so new words should
     *  keep the view pinned there; scrolled up to read, it is left alone. */
    function nearBottom() {
        return ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 80;
    }

    /**
     * The answer as it streams in, drawn as Markdown with a caret on the end.
     * Redrawn at most once a frame, and less often as it grows, so a long
     * answer stays smooth. Replaced by the finished answer (with its
     * citations and buttons) once the stream ends.
     */
    function addStream() {
        var body = el('div', {
            class: 'bg-tertiary p-4 rounded-lg shadow-md prose prose-invert '
                + 'text-sm text-fg-primary break-words',
        });
        var node = el('div', { class: 'flex items-start gap-4 msg-in', 'aria-hidden': 'true' }, [
            orochiAvatar(),
            el('div', { class: 'flex flex-col items-start gap-1 max-w-3xl min-w-0' }, [body]),
        ]);
        var latest = '';
        var frame = 0;
        var lastDraw = 0;
        var attached = false;
        function draw() {
            frame = 0;
            var pinned = nearBottom();
            lastDraw = performance.now();
            dom.markdown(body, latest);
            var tail = body;
            while (tail.lastElementChild && !/^(PRE|TABLE|UL|OL|HR)$/.test(tail.lastElementChild.tagName)) {
                tail = tail.lastElementChild;
            }
            tail.appendChild(el('span', { class: 'stream-caret' }));
            if (pinned) scrollDown();
        }
        return {
            update: function (text) {
                latest = text;
                if (!attached) {
                    attached = true;
                    ui.log.appendChild(node);
                }
                if (frame) return;
                var wait = Math.min(250, latest.length / 40) - (performance.now() - lastDraw);
                frame = wait > 0
                    ? setTimeout(function () { frame = requestAnimationFrame(draw); }, wait)
                    : requestAnimationFrame(draw);
            },
            started: function () { return attached; },
            remove: function () {
                cancelAnimationFrame(frame);
                clearTimeout(frame);
                node.remove();
            },
        };
    }

    function greeting() {
        dom.replace(ui.log, el('div', { class: 'flex items-start gap-4' }, [
            orochiAvatar(),
            el('div', { class: 'bg-tertiary p-4 rounded-lg max-w-3xl shadow-md' }, [
                el('p', { class: 'font-bold text-accent mb-1', text: 'Orochimaru' }),
                el('ul', { class: 'list-disc ml-5 mt-1 text-sm opacity-90 space-y-1' }, [
                    el('li', { text: 'Ask anything, or load documents (PDF, Word, CSV, '
                        + 'Markdown, HTML...) to ask about them.' }),
                    el('li', { text: '"Answer from": documents plus labelled general '
                        + 'knowledge, or documents only.' }),
                    el('li', { text: noHistory
                        ? 'No history is on: nothing is saved here, and a reload clears it. '
                            + 'Not private: the AI provider still sees everything you send.'
                        : (folder ? 'History is on: chats save to "' + folder.name + '". '
                            : 'History is on, but nothing is saved until you choose a folder '
                                + 'under Chat history. ')
                            + 'The AI provider sees everything you send.' }),
                ]),
            ]),
        ]));
    }

    /* ------------------------------------------------------------- documents */

    function renderDocList() {
        var names = docNames();
        var sent = sentNames();
        ui.docCount.textContent = String(names.length + sent.length);

        var chunks = names.reduce(function (sum, n) { return sum + documents[n].length; }, 0);
        ui.statusChunks.textContent = String(chunks);

        if (!names.length && !sent.length) {
            dom.replace(ui.docList, el('p', {
                class: 'text-[10px] text-fg-secondary italic p-4 text-center border '
                    + 'border-dashed border-tertiary rounded',
                text: 'No documents loaded. Load one to begin.',
            }));
            ui.statusDoc.textContent = 'None';
            return;
        }

        var rows = names.map(function (n) { return docRow(n, false); })
            .concat(sent.map(function (n) { return docRow(n, true); }));
        dom.replace(ui.docList, rows);
    }

    /** One row of the Documents list; `whole` marks a file sent to the AI whole. */
    function docRow(name, whole) {
        var remove = el('button', {
            type: 'button',
            class: 'text-fg-secondary hover:text-danger transition opacity-60 '
                + 'group-hover:opacity-100 shrink-0 px-1',
            // Filename travels as data, never as code.
            dataset: { doc: name },
            'aria-label': 'Remove ' + name,
            text: '✕',
        });
        remove.addEventListener('click', function () { removeDocument(name, whole); });

        return el('div', {
            class: 'bg-tertiary rounded p-2 flex justify-between items-center gap-2 group',
        }, [
            el('span', {
                class: 'truncate text-xs text-fg-primary',
                title: whole ? name + ' (sent whole to the AI provider)' : name + ' (read here)',
                text: name,
            }),
            whole ? el('span', { class: 'panel-count shrink-0', text: 'AI',
                title: 'Sent whole to the AI provider with each message' }) : null,
            remove,
        ]);
    }

    function removeDocument(name, whole) {
        if (!window.confirm('Remove "' + name + '" from memory?')) return;
        if (whole) delete sentFiles[name];
        else delete documents[name];
        renderDocList();
        addSystem(whole ? 'Dropped ' + name + '. It is no longer sent with messages.'
            : 'Dropped ' + name + '.');
    }

    /* ------------------------------------------------------- drag and drop */

    /** Files dropped on the chat: ask how to load them, private choice first. */
    function bindDrop(zone) {
        var depth = 0;   // dragenter/leave fire for every child crossed
        // A file dropped anywhere else would make the browser open it in
        // place of the page, losing every document held in memory.
        ['dragover', 'drop'].forEach(function (type) {
            window.addEventListener(type, function (e) {
                if (hasFiles(e) && !zone.contains(e.target)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'none';
                }
            });
        });
        function hasFiles(e) {
            return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
        }
        // Set through the CSSOM, which the page's style-src 'self' allows.
        function mark(on) {
            zone.style.outline = on ? '2px dashed var(--accent)' : '';
            zone.style.outlineOffset = on ? '-8px' : '';
        }
        zone.addEventListener('dragenter', function (e) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth += 1;
            mark(true);
        });
        zone.addEventListener('dragover', function (e) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        zone.addEventListener('dragleave', function () {
            depth = Math.max(0, depth - 1);
            if (!depth) mark(false);
        });
        zone.addEventListener('drop', function (e) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth = 0;
            mark(false);
            var files = Array.prototype.slice.call(e.dataTransfer.files);
            if (files.length) takeFiles(files);
        });
    }

    function isImage(file) { return !!IMAGE_TYPES[extensionOf(file.name)]; }

    /** Images can only be sent whole (nothing here reads them), so they skip
     *  the choice and go straight to the confirm; other files are asked. */
    function takeFiles(files) {
        var images = files.filter(isImage);
        var others = files.filter(function (f) { return !isImage(f); });
        if (images.length && confirmSend(images)) images.forEach(handleSentFile);
        if (others.length) askDropMode(others);
    }

    /** Ctrl+V of a screenshot. A pasted image has a generic name such as
     *  "image.png", so it is renamed by time to keep each paste apart. */
    var pastes = 0;
    function bindPaste() {
        document.addEventListener('paste', function (e) {
            var items = (e.clipboardData && e.clipboardData.items) || [];
            var files = [];
            Array.prototype.forEach.call(items, function (item) {
                if (item.kind !== 'file') return;
                var file = item.getAsFile();
                if (!file) return;
                var ext = Object.keys(IMAGE_TYPES).filter(function (k) {
                    return IMAGE_TYPES[k] === file.type;
                })[0];
                if (ext) {
                    pastes += 1;
                    file = new File([file], 'Screenshot ' + pastes + ' - '
                        + K.ui.fileStamp(new Date()) + '.' + ext, { type: file.type });
                }
                files.push(file);
            });
            if (!files.length) return;   // plain text pastes as usual
            e.preventDefault();
            takeFiles(files);
        });
    }

    function askDropMode(files) {
        var names = files.map(function (f) { return f.name; }).join(', ');
        var card;
        function choose(handler) {
            return function () {
                card.remove();
                if (handler === handleSentFile && !confirmSend(files)) return;
                files.forEach(handler);
            };
        }
        card = el('div', { class: 'flex justify-center my-2', role: 'group',
            'aria-label': 'How to load the dropped files' }, [
            el('div', { class: 'bg-tertiary border border-accent rounded-lg p-3 max-w-xl '
                + 'text-xs space-y-2 shadow-md' }, [
                el('p', { class: 'text-fg-primary break-words', text: 'Load ' + names + ':' }),
                el('div', { class: 'flex flex-wrap gap-2' }, [
                    el('button', { type: 'button', class: 'btn btn-accent text-xs',
                        text: 'Read here (private)', on: { click: choose(handleFile) } }),
                    el('button', { type: 'button', class: 'btn btn-secondary text-xs',
                        text: 'Send whole file to AI', on: { click: choose(handleSentFile) } }),
                    el('button', { type: 'button', class: 'btn text-xs text-fg-secondary',
                        text: 'Cancel', on: { click: function () { card.remove(); } } }),
                ]),
                el('p', { class: 'text-[10px] text-fg-secondary', text: 'Read here: parsed in '
                    + 'this tab; only matching excerpts go with a question. Whole file: the '
                    + 'AI provider receives all of it with each message.' }),
            ]),
        ]);
        ui.log.appendChild(card);
        scrollDown();
        card.querySelector('button').focus();
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
        var stream = addStream();
        setBusy(true);
        var started = performance.now();
        var token = chatToken;
        // One announcement when the answer is done, not one per word.
        ui.log.setAttribute('aria-busy', 'true');
        function settle() {
            thinking.stop();
            stream.remove();
            ui.log.removeAttribute('aria-busy');
        }

        K.callWithFallback(provider(), {
            apiKey: apiKey(),
            model: ui.model.value,
            temperature: parseFloat(ui.temp.value),
            fallback: K.prefs.modelFallback(),
            messages: messages,
            conversation: true,
            onDelta: function (text) {
                if (token !== chatToken) return;
                if (!stream.started()) thinking.stop();
                stream.update(text);
            },
        }).then(function (res) {
            settle();
            if (token !== chatToken) return;   // another chat is open now
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
            settle();
            if (token !== chatToken) return;
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
        submit(query, query);
    }

    /** Ask `query`; the chat shows `shown` as what the user said. `redo`
     *  keeps the question being redone as the one follow-ups build on. */
    function submit(query, shown, redo) {
        // The system prompt never changes; the excerpts retrieved for this
        // question, the answer mode and the skills that are on go in the turn.
        var chunks = [];
        if (docNames().length) {
            ui.indicator.classList.remove('is-invisible');
            chunks = retrieve(query, 5, lastQuestion);
        }
        if (!redo) lastQuestion = query;
        var turn = K.prompts.chatTurn(query, chunks, docNames(), strictMode(), activeSkills);
        var attached = sentPrefix(provider());
        if (attached.length && strictMode()) {
            turn += '\n\nAnswer only from the attached files and any excerpts above. If they '
                + 'do not cover it, say so and stop.';
        }
        var held = heldBack(provider());
        if (held.length) {
            addSystem('Not sent to ' + K.providerLabel(provider()) + ': ' + held.join(', ')
                + '. Those files go only to the provider they were sent to.');
        }

        ask([{ role: 'system', content: K.prompts.chatSystemPrompt() }]
            .concat(attached, history, [{ role: 'user', content: turn }]),
            shown, asSources(chunks), keptTurn(turn, query));
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
        if (!docNames().length) return false;
        var isReview = skill.group === 'review';
        // Style skills (and others with nothing to do on their own) only
        // shape later answers.
        if (!isReview && skill.id !== 'summarise' && !skill.onDocs) return false;
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
        return true;
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
        useSkill(skill);
        ui.input.focus();
    }

    /**
     * A skill sent on its own, as "/shorter" or picked from the menu: switch
     * it on and put it to work at once -- over the loaded documents when it is
     * a skill for them, otherwise on the last answer, given again in its
     * style. Turning it off is the chip's or the Skills panel's job.
     */
    function useSkill(skill) {
        if (busy) { K.ui.toast('Wait for the answer to finish.'); return; }
        var wasOn = activeSkills.indexOf(skill.id) !== -1;
        if (!wasOn) toggleSkill(skill.id, true);
        if (runSkill(skill)) return;
        if (lastAnswer) {
            // The earlier question goes in too, so document search still
            // finds the passages that answer was about.
            submit('Give your last answer again, following the ' + skill.label
                + ' skill (' + skill.description + '). The question was: '
                + lastQuestion, '/' + skill.id, true);
        } else if (wasOn) {
            addSystem(skill.label + ' is already on. Ask a question to use it.');
        }
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
        if (!rest) { useSkill(skill); return null; }
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
            search: document.getElementById('search-mode'),
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
            noHistory: document.getElementById('no-history'),
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
            if (narrow.matches) setSidebar(!ui.sidebar.classList.contains('is-open'));
            else setCollapsed(!ui.sidebar.classList.contains('is-collapsed'));
        });
        try {
            ui.sidebar.classList.toggle('is-collapsed',
                window.localStorage.getItem(COLLAPSED_KEY) === 'hidden');
        } catch (e) { /* private mode */ }
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
        var sendUpload = document.getElementById('send-upload');
        document.getElementById('send-doc').addEventListener('click', function () {
            sendUpload.click();
        });
        sendUpload.addEventListener('change', function () {
            var files = Array.prototype.slice.call(sendUpload.files);
            sendUpload.value = '';
            if (files.length && confirmSend(files)) files.forEach(handleSentFile);
        });
        bindDrop(document.querySelector('main'));
        bindPaste();

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
        document.getElementById('clear-all').addEventListener('click', clearAll);
        document.getElementById('open-settings').addEventListener('click', function () {
            settings.open();
        });
        document.getElementById('purge-btn').addEventListener('click', K.ui.purgeAll);
        K.ui.bindCopy(document.getElementById('copy-chat'), chatAsMarkdown);
        document.getElementById('save-chat').addEventListener('click', saveChat);
        ui.noHistory.addEventListener('click', function () { setNoHistory(!noHistory); });
        // Per-answer buttons read one answer; this one reads the whole chat.
        K.ui.bindSpeak(ui.tts, chatAsSpeech);

        // Only nag about leaving when there is actually something to lose.
        window.addEventListener('beforeunload', function (e) {
            if (!docNames().length && !sentNames().length) return;
            e.preventDefault();
            e.returnValue = '';
        });

        updateRam();
        setInterval(updateRam, 2000);
        ui.input.focus();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
