/* Dashboard: provider configuration + tool launcher.
 * The one place that knows about every provider and every app. */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    var PROVIDERS = [
        { id: 'gemini', placeholder: 'AIza...', signup: 'https://aistudio.google.com/app/apikey',
          note: 'Generous free tier. Good default.' },
        { id: 'hf', placeholder: 'hf_...', signup: 'https://huggingface.co/settings/tokens',
          note: 'Open-weight models through one token. Needs the "Inference Providers" scope.' },
        { id: 'openrouter', placeholder: 'sk-or-v1-...', signup: 'https://openrouter.ai/keys',
          note: 'One key, hundreds of models across vendors, including free ones.' },
        { id: 'ollama', placeholder: K.OLLAMA_DEFAULT, signup: 'https://ollama.com/download',
          note: 'Fully local. Enter your server URL, not a key.' },
    ];

    var TOOLS = [
        { name: 'Kakashi Search', href: 'web_apps/Kakashi_Search.html',
          blurb: 'Agentic web search across Wikipedia, OpenAlex, arXiv, HN and DuckDuckGo, with a synthesised answer.' },
        { name: 'Orochimaru RAG', href: 'web_apps/Orochimaru_Web_Research_Assistent.html',
          blurb: 'Load PDFs into memory and chat with them. Parsing happens in the browser.',
          ollama: true },
        { name: 'Neji Scholar', href: 'web_apps/Neji_Search.html',
          blurb: 'Academic paper discovery over OpenAlex, with an incognito mode that skips the model entirely.' },
        { name: 'OneTail Chat', href: 'web_apps/OneTail_Web_Chatapp.html',
          blurb: 'Straightforward multi-provider chat. Nothing is written to disk.' },
        { name: 'AI Visualizer', href: 'web_apps/Visualize_AI_Web.html',
          blurb: 'Inspect next-token probabilities as you type.' },
    ];

    /* ------------------------------------------------------------ provider rows */

    var rowRefs = [];

    function providerRow(spec) {
        var isOllama = spec.id === 'ollama';
        var inputId = 'key-' + spec.id;
        var persistId = 'persist-' + spec.id;

        var status = el('span', { class: 'text-[10px] font-bold px-2 py-0.5 rounded shrink-0' });

        var input = el('input', {
            type: isOllama ? 'text' : 'password',
            id: inputId,
            autocomplete: 'off',
            spellcheck: 'false',
            placeholder: spec.placeholder,
        });

        var persist = el('input', { type: 'checkbox', id: persistId });

        var saveBtn = el('button', {
            type: 'button',
            class: 'btn btn-accent text-xs shrink-0',
            text: 'Save',
        });

        var clearBtn = el('button', {
            type: 'button',
            class: 'btn btn-secondary text-xs shrink-0',
            text: 'Clear',
        });

        function refresh() {
            var has = !!K.keys.get(spec.id);
            var kept = K.keys.isPersisted(spec.id);
            status.textContent = has ? (kept ? 'saved on device' : 'this tab only') : 'not set';
            status.className = 'text-[10px] font-bold px-2 py-0.5 rounded shrink-0 '
                + (has ? 'bg-success/15 text-success' : 'bg-tertiary text-fg-secondary');
            persist.checked = kept;
            // Never repopulate the field with the secret; show that one exists instead.
            input.value = '';
            input.placeholder = has ? '•'.repeat(12) + ' (saved)' : spec.placeholder;
        }

        saveBtn.addEventListener('click', function () {
            var value = input.value.trim();
            if (!value && isOllama) value = K.OLLAMA_DEFAULT;
            if (!value) {
                K.ui.toast('Enter a value for ' + K.providerLabel(spec.id) + ' first.', 'error');
                input.focus();
                return;
            }
            K.keys.set(spec.id, value, persist.checked);
            refresh();
            renderTools();
            K.ui.toast(K.providerLabel(spec.id) + ' saved'
                + (persist.checked ? ' on this device.' : ' for this tab.'), 'success');
        });

        clearBtn.addEventListener('click', function () {
            K.keys.remove(spec.id);
            refresh();
            renderTools();
            K.ui.toast(K.providerLabel(spec.id) + ' cleared.');
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
        });

        rowRefs.push(refresh);
        refresh();

        return el('li', { class: 'border-b border-tertiary/60 last:border-0 pb-5 last:pb-0' }, [
            el('div', { class: 'flex flex-wrap items-center gap-2 mb-1' }, [
                el('label', { class: 'font-bold text-fg-primary', for: inputId,
                    text: K.providerLabel(spec.id) }),
                status,
                dom.link(spec.signup, isOllama ? 'download' : 'get a key',
                    'text-xs text-accent hover:underline ml-auto'),
            ]),
            el('p', { class: 'text-xs text-fg-secondary mb-2', text: spec.note }),
            el('div', { class: 'flex flex-wrap gap-2 items-center' }, [
                el('div', { class: 'flex-1 min-w-[200px]' }, [input]),
                saveBtn,
                clearBtn,
            ]),
            el('label', {
                class: 'flex items-center gap-2 text-xs text-fg-secondary mt-2 cursor-pointer w-fit',
                for: persistId,
            }, [persist, el('span', { text: 'Remember on this device (writes to disk)' })]),
        ]);
    }

    function renderProviders() {
        var host = document.getElementById('provider-rows');
        dom.replace(host, PROVIDERS.map(providerRow));
    }

    function refreshAllRows() {
        rowRefs.forEach(function (fn) { fn(); });
    }

    /* -------------------------------------------------------------- tool cards */

    function renderTools() {
        var host = document.getElementById('tool-grid');
        var active = K.keys.provider();
        var configured = !!K.keys.get(active);

        dom.replace(host, TOOLS.map(function (tool) {
            var ready = configured || (tool.ollama && !!K.keys.get('ollama'));

            return el('div', {
                class: 'glass-card rounded-xl p-5 flex flex-col',
            }, [
                el('div', { class: 'flex items-start justify-between gap-2 mb-2' }, [
                    el('h3', { class: 'text-lg font-bold text-fg-primary', text: tool.name }),
                    el('span', {
                        class: 'text-[10px] font-bold px-2 py-0.5 rounded shrink-0 '
                            + (ready ? 'bg-success/15 text-success' : 'bg-tertiary text-fg-secondary'),
                        text: ready ? 'ready' : 'needs a key',
                    }),
                ]),
                el('p', { class: 'text-sm text-fg-secondary flex-1 mb-4', text: tool.blurb }),
                el('a', {
                    class: 'btn btn-secondary text-sm text-center w-full',
                    href: tool.href,
                    text: 'Open ' + tool.name.split(' ')[0],
                }),
            ]);
        }));
    }

    /* ------------------------------------------------------------------ chrome */

    function renderDefaultProvider() {
        var select = document.getElementById('default-provider');
        dom.replace(select, K.keys.providers.map(function (p) {
            return el('option', { value: p, text: K.providerLabel(p) });
        }));
        select.value = K.keys.provider();
        select.addEventListener('change', function () {
            K.keys.setProvider(select.value);
            renderTools();
            K.ui.toast('Tools will default to ' + K.providerLabel(select.value) + '.');
        });
    }

    /* Types the tagline out once. Skipped entirely when the visitor has asked for
       reduced motion, rather than just running faster. */
    function runTagline() {
        var target = document.getElementById('tagline');
        var cursor = document.getElementById('tagline-cursor');
        var phrases = [
            'For researchers in physics & material science',
            'Agentic search across five open databases',
            'Chat with your PDFs, parsed in your browser',
            'Or run the whole suite offline, with no API key',
        ];

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            if (cursor) cursor.remove();
            return;
        }

        var phrase = 0;
        var chars = phrases[0].length;
        var deleting = true;

        function tick() {
            var full = phrases[phrase];
            chars += deleting ? -1 : 1;
            target.textContent = full.slice(0, chars);

            var delay = deleting ? 25 : 55;
            if (!deleting && chars >= full.length) { deleting = true; delay = 2600; }
            else if (deleting && chars <= 0) {
                deleting = false;
                phrase = (phrase + 1) % phrases.length;
                delay = 400;
            }
            setTimeout(tick, delay);
        }
        setTimeout(tick, 2600);
    }

    function init() {
        renderProviders();
        renderDefaultProvider();
        renderTools();
        runTagline();

        document.getElementById('purge-keys').addEventListener('click', function () {
            if (!window.confirm('Wipe every saved API key from this browser? This cannot be undone.')) {
                return;
            }
            K.keys.purge();
            refreshAllRows();
            renderTools();
            document.getElementById('default-provider').value = K.keys.provider();
            K.ui.toast('All keys purged.', 'success');
        });

        document.getElementById('copy-install').addEventListener('click', function (e) {
            var text = document.getElementById('install-cmd').textContent;
            K.ui.copyToClipboard(text, e.currentTarget);
            K.ui.toast('Commands copied.', 'success');
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
