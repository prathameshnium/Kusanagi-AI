/* Orochimaru -- in-memory RAG over PDFs the user loads locally.
 *
 * Documents live in `documents` and nowhere else. Filenames are attacker-controlled
 * for our purposes (a PDF can be named anything), so they are rendered as text and
 * carried on dataset attributes rather than interpolated into onclick handlers.
 */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    var CHUNK_SIZE = 1000;
    var CHUNK_OVERLAP = 200;
    var MAX_PDF_BYTES = 64 * 1024 * 1024;

    var REVIEW_PERSONAS = {
        Physicist: 'You are a reviewer with expertise in physics. Focus on the '
            + 'underlying physical principles and models.',
        Chemist: 'You are a reviewer with expertise in chemistry. Focus on chemical '
            + 'compositions, reactions and characterisation.',
        Editor: 'You are an editor. Review for clarity, grammar, style and structure.',
    };

    /* A dynamic import() inside a classic script resolves relative to the *script*,
       not the document, and a wrong guess just 404s with no useful error. Anchor
       vendor paths to this file's own URL so the page can live anywhere. */
    var HERE = (document.currentScript && document.currentScript.src) || window.location.href;
    function vendorUrl(relative) { return new URL(relative, HERE).href; }

    var documents = Object.create(null);   // filename -> [chunk, ...]
    var lastAnswer = '';
    var sessionTokens = 0;
    var speaking = false;
    var busy = false;
    var settings = null;
    var pdfjsPromise = null;
    var ui = {};

    function provider() { return K.keys.provider(); }
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

    function handleFile(file) {
        if (!file) return;

        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
            K.ui.toast('That is not a PDF.', 'error');
            return;
        }
        if (file.size > MAX_PDF_BYTES) {
            K.ui.toast('That PDF is larger than 64 MB and would exhaust the tab.', 'error');
            return;
        }
        if (documents[file.name]) {
            K.ui.toast('That document is already loaded.', 'error');
            return;
        }

        ui.statusDoc.textContent = 'Parsing...';
        addSystem('Reading ' + file.name + ' into memory...');

        loadPdfJs()
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
            })
            .then(function (fullText) {
                if (!fullText.trim()) {
                    throw new Error('This PDF has no extractable text. Scanned pages '
                        + 'need OCR, which this tool does not do.');
                }
                documents[file.name] = chunkText(fullText);
                renderDocList();
                ui.statusDoc.textContent = 'Ready';
                addSystem('Loaded ' + file.name + ' ('
                    + documents[file.name].length + ' chunks).');
            })
            .catch(function (err) {
                ui.statusDoc.textContent = 'Error';
                addSystem(err.message, true);
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
            chunks = chunks.concat(documents[name]);
        });
        if (!chunks.length) return [];

        var terms = query.toLowerCase().split(/\s+/).filter(function (w) {
            return w.length > 3;
        });
        if (!terms.length) return chunks.slice(0, limit || 5);

        return chunks
            .map(function (chunk) {
                var lower = chunk.toLowerCase();
                var score = terms.reduce(function (sum, term) {
                    return sum + countOccurrences(lower, term);
                }, 0);
                return { text: chunk, score: score };
            })
            .filter(function (c) { return c.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, limit || 5)
            .map(function (c) { return c.text; });
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
        ui.log.appendChild(el('div', { class: 'flex items-start gap-4 justify-end' }, [
            el('div', { class: 'bg-accent text-accent-fg p-3 rounded-lg max-w-2xl shadow-md' }, [
                el('p', { class: 'text-sm whitespace-pre-wrap break-words', text: text }),
            ]),
        ]));
        scrollDown();
    }

    function addAI(text) {
        var body = el('div', {
            class: 'bg-tertiary p-4 rounded-lg max-w-3xl shadow-md prose prose-invert '
                + 'text-sm text-fg-primary break-words',
        });
        dom.markdown(body, text);
        ui.log.appendChild(el('div', { class: 'flex items-start gap-4' },
            [orochiAvatar(), body]));
        scrollDown();
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
                el('p', {
                    class: 'text-sm',
                    text: 'Documents are parsed in this tab and held in memory only. '
                        + 'Reloading the page discards them.',
                }),
            ]),
        ]));
    }

    /* ------------------------------------------------------------- documents */

    function renderDocList() {
        var names = docNames();
        ui.docCount.textContent = String(names.length);

        var chunks = names.reduce(function (sum, n) { return sum + documents[n].length; }, 0);
        ui.statusChunks.textContent = String(chunks);

        ui.quickActions.classList.toggle('is-dimmed', !names.length);
        ui.quickActions.classList.toggle('pointer-events-none', !names.length);

        if (!names.length) {
            dom.replace(ui.docList, el('p', {
                class: 'text-[10px] text-fg-secondary italic p-4 text-center border '
                    + 'border-dashed border-tertiary rounded',
                text: 'No documents loaded. Load a PDF to begin.',
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

    function ask(prompt, userFacing) {
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

        K.call(provider(), {
            apiKey: apiKey(),
            model: ui.model.value,
            temperature: parseFloat(ui.temp.value),
            prompt: prompt,
        }).then(function (res) {
            thinking.remove();
            addAI(res.text);
            lastAnswer = res.text;

            var secs = (performance.now() - started) / 1000;
            var tokens = (res.usage && res.usage.total_tokens)
                || Math.ceil((prompt.length + res.text.length) / 4);
            sessionTokens += tokens;
            ui.tokens.textContent = sessionTokens.toLocaleString();
            if (secs > 0) ui.speed.textContent = (tokens / secs).toFixed(1) + ' t/s';
        }).catch(function (err) {
            thinking.remove();
            addSystem(err.message, true);
        }).then(function () {
            setBusy(false);
            ui.indicator.classList.add('is-invisible');
            ui.input.focus();
        });
    }

    function send() {
        var query = ui.input.value.trim();
        if (!query) return;
        ui.input.value = '';

        var instruction = 'You are Orochimaru, a research assistant. Answer concisely.';
        var context = '';

        if (docNames().length) {
            ui.indicator.classList.remove('is-invisible');
            var chunks = retrieve(query, 5);
            if (chunks.length) {
                context = '\n\nCONTEXT FROM THE LOADED DOCUMENTS:\n'
                    + chunks.join('\n---\n');
                instruction += ' Use the provided context. If the context does not '
                    + 'answer the question, say so rather than guessing.';
            }
        }

        ask(instruction + context + '\n\nQUESTION: ' + query, query);
    }

    function runReview(role) {
        if (!docNames().length) return;
        var chunks = retrieve('conclusion results methodology abstract', 8);
        ask(REVIEW_PERSONAS[role] + '\n\nBased on these excerpts:\n'
            + chunks.join('\n\n') + '\n\nProvide a critical review.',
            role + ' review of the loaded documents');
    }

    function runSummary() {
        if (!docNames().length) return;
        var chunks = retrieve('abstract summary conclusion introduction', 6);
        ask('Summarise the following text:\n' + chunks.join('\n'),
            'Summarise the loaded documents');
    }

    /* ------------------------------------------------------------------- TTS */

    function stopSpeaking() {
        window.speechSynthesis.cancel();
        speaking = false;
        ui.tts.textContent = 'Read aloud';
        ui.tts.setAttribute('aria-pressed', 'false');
        ui.tts.classList.remove('text-accent');
    }

    function toggleTTS() {
        if (!('speechSynthesis' in window)) {
            K.ui.toast('This browser has no speech synthesis.', 'error');
            return;
        }
        if (speaking) { stopSpeaking(); return; }
        if (!lastAnswer) {
            K.ui.toast('Nothing to read yet.');
            return;
        }

        window.speechSynthesis.cancel();
        var utterance = new SpeechSynthesisUtterance(lastAnswer);
        utterance.onstart = function () {
            speaking = true;
            ui.tts.textContent = 'Stop';
            ui.tts.setAttribute('aria-pressed', 'true');
            ui.tts.classList.add('text-accent');
        };
        utterance.onend = stopSpeaking;
        utterance.onerror = stopSpeaking;
        window.speechSynthesis.speak(utterance);
    }

    /* ---------------------------------------------------------------- status */

    function checkStatus() {
        var has = !!apiKey();
        ui.statusAi.textContent = has
            ? (provider() === 'ollama' ? 'Local (Ollama)' : K.providerLabel(provider()))
            : 'Disconnected';
        ui.statusAi.className = has ? 'text-success font-bold' : 'text-danger';
        ui.dot.className = 'w-2 h-2 rounded-full ' + (has ? 'bg-success' : 'bg-danger');
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
            tempOut: document.getElementById('temp-val'),
            docList: document.getElementById('doc-list'),
            docCount: document.getElementById('doc-count'),
            statusAi: document.getElementById('status-ai'),
            statusDoc: document.getElementById('status-doc'),
            statusChunks: document.getElementById('status-chunks'),
            dot: document.getElementById('status-dot'),
            quickActions: document.getElementById('quick-actions'),
            reviewMenu: document.getElementById('review-menu'),
            indicator: document.getElementById('context-indicator'),
            tokens: document.getElementById('perf-tokens'),
            speed: document.getElementById('perf-speed'),
            ram: document.getElementById('perf-ram'),
            tts: document.getElementById('tts-btn'),
            upload: document.getElementById('pdf-upload'),
        };

        settings = K.ui.mountSettings({
            providers: ['gemini', 'groq', 'hf', 'ollama'],
            title: 'Secure configuration',
            onSave: function () {
                checkStatus();
                K.ui.fillModelSelect(ui.model, provider());
            },
        });

        K.ui.fillModelSelect(ui.model, provider());
        checkStatus();
        greeting();
        renderDocList();

        dom.replace(ui.reviewMenu, Object.keys(REVIEW_PERSONAS).map(function (role) {
            return el('button', {
                type: 'button',
                class: 'w-full text-left px-2 py-1.5 text-xs text-fg-secondary '
                    + 'hover:text-accent transition',
                text: role,
                on: { click: function () { runReview(role); } },
            });
        }));

        ui.temp.addEventListener('input', function () {
            ui.tempOut.textContent = ui.temp.value;
        });

        document.getElementById('load-doc').addEventListener('click', function () {
            ui.upload.click();
        });
        ui.upload.addEventListener('change', function () {
            handleFile(ui.upload.files[0]);
            ui.upload.value = '';
        });

        ui.send.addEventListener('click', send);
        ui.input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); send(); }
        });

        document.getElementById('action-summarize').addEventListener('click', runSummary);
        document.getElementById('toggle-review').addEventListener('click', function (e) {
            var nowHidden = ui.reviewMenu.classList.toggle('hidden');
            e.currentTarget.setAttribute('aria-expanded', String(!nowHidden));
        });
        document.getElementById('clear-chat').addEventListener('click', function () {
            sessionTokens = 0;
            lastAnswer = '';
            ui.tokens.textContent = '0';
            ui.speed.textContent = '--';
            greeting();
            addSystem('Chat history cleared.');
        });
        document.getElementById('open-settings').addEventListener('click', function () {
            settings.open();
        });
        document.getElementById('purge-btn').addEventListener('click', K.ui.purgeAll);
        ui.tts.addEventListener('click', toggleTTS);

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
