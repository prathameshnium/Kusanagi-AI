/* OneTail -- multi-provider chat.
 *
 * The conversation lives in this array and nowhere else: not localStorage, not
 * sessionStorage, not a server. Reloading the tab loses it, which is the point.
 */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    // Keep the prompt bounded so a long session does not silently blow the context
    // window (and the bill) one turn at a time.
    var MAX_TURNS = 20;

    var history = [];
    var sessionTokens = 0;
    var settings = null;
    var busy = false;
    var ui = {};

    function provider() { return K.keys.provider(); }
    function apiKey() { return K.keys.get(provider()); }

    /* ------------------------------------------------------------------ render */

    function scrollDown() {
        ui.log.scrollTop = ui.log.scrollHeight;
    }

    function avatar(label, extraClass) {
        return el('div', {
            class: 'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center '
                + 'font-bold ' + (extraClass || 'bg-tertiary text-accent'),
            text: label,
            'aria-hidden': 'true',
        });
    }

    function addUser(text) {
        ui.log.appendChild(el('div', { class: 'flex items-start gap-4 justify-end' }, [
            el('div', { class: 'bg-accent text-accent-fg p-4 rounded-lg max-w-2xl shadow-md' }, [
                el('p', { class: 'font-bold mb-1 text-xs opacity-70', text: 'You' }),
                // User text as a text node; whitespace preserved by CSS, not by markup.
                el('div', { class: 'whitespace-pre-wrap break-words', text: text }),
            ]),
        ]));
        scrollDown();
    }

    function addAI(text) {
        var body = el('div', {
            class: 'bg-tertiary p-4 rounded-lg max-w-3xl shadow-md prose prose-invert '
                + 'text-sm text-fg-primary break-words',
        });
        // Model output is Markdown, so it goes through the sanitiser in dom.js.
        dom.markdown(body, text);
        ui.log.appendChild(el('div', { class: 'flex items-start gap-4' }, [avatar('AI'), body]));
        scrollDown();
    }

    function addError(text) {
        ui.log.appendChild(el('div', { class: 'flex items-start gap-4' }, [
            avatar('!', 'bg-danger/20 text-danger'),
            el('div', {
                class: 'bg-danger/10 p-4 rounded-lg max-w-2xl border border-danger/40 '
                    + 'text-danger text-sm break-words',
                text: text,
            }),
        ]));
        scrollDown();
    }

    function addThinking() {
        var node = el('div', { class: 'flex items-start gap-4' }, [
            avatar('...', 'bg-tertiary text-accent animate-pulse'),
            el('div', {
                class: 'bg-tertiary p-4 rounded-lg text-fg-secondary italic animate-pulse',
                text: 'Thinking...',
            }),
        ]);
        ui.log.appendChild(node);
        scrollDown();
        return node;
    }

    function greeting() {
        dom.replace(ui.log, el('div', { class: 'flex items-start gap-4' }, [
            avatar('AI'),
            el('div', { class: 'bg-tertiary p-4 rounded-lg max-w-3xl' }, [
                el('p', { class: 'font-bold text-accent mb-1', text: 'OneTail' }),
                el('p', { class: 'text-sm', text: 'Built for privacy:' }),
                el('ul', { class: 'list-disc ml-5 mt-2 text-sm opacity-90 space-y-1' }, [
                    el('li', { text: 'Messages are held in memory. Reloading deletes them.' }),
                    el('li', { text: 'Keys stay in this tab unless you asked to be remembered.' }),
                    el('li', { text: 'Traffic goes straight to the provider you picked.' }),
                ]),
            ]),
        ]));
    }

    /* -------------------------------------------------------------------- send */

    function setBusy(state) {
        busy = state;
        ui.send.disabled = state;
        ui.input.disabled = state;
    }

    function send() {
        if (busy) return;
        var text = ui.input.value.trim();
        if (!text) return;

        if (!apiKey()) {
            K.ui.toast('Set a key for ' + K.providerLabel(provider()) + ' first.', 'error');
            settings.open();
            return;
        }

        ui.input.value = '';
        addUser(text);
        history.push({ role: 'user', content: text });

        var thinking = addThinking();
        setBusy(true);
        var started = performance.now();

        K.call(provider(), {
            apiKey: apiKey(),
            model: ui.model.value,
            temperature: parseFloat(ui.temp.value),
            messages: history.slice(-MAX_TURNS),
        }).then(function (res) {
            thinking.remove();
            addAI(res.text);
            history.push({ role: 'assistant', content: res.text });
            trimHistory();

            var seconds = (performance.now() - started) / 1000;
            var out = res.usage && res.usage.completion_tokens
                ? res.usage.completion_tokens
                : Math.ceil(res.text.length / 4);
            var total = res.usage && res.usage.total_tokens
                ? res.usage.total_tokens
                : Math.ceil(text.length / 4) + out;

            sessionTokens += total;
            ui.tokens.textContent = sessionTokens.toLocaleString();
            ui.speed.textContent = (seconds > 0 ? (out / seconds).toFixed(1) : '0') + ' t/s';
        }).catch(function (err) {
            thinking.remove();
            addError(err.message);
            // Drop the unanswered turn so a retry does not resend it twice.
            history.pop();
        }).then(function () {
            setBusy(false);
            updateTurnCount();
            ui.input.focus();
        });
    }

    function trimHistory() {
        if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
    }

    function updateTurnCount() {
        ui.turns.textContent = String(history.length);
    }

    function newChat() {
        history = [];
        sessionTokens = 0;
        ui.tokens.textContent = '0';
        ui.speed.textContent = '0 t/s';
        ui.input.value = '';
        greeting();
        updateTurnCount();
        ui.input.focus();
    }

    /* ------------------------------------------------------------------ status */

    function checkStatus() {
        var has = !!apiKey();
        ui.light.className = 'w-2.5 h-2.5 rounded-full inline-block '
            + (has ? 'bg-success' : 'bg-danger');
        ui.statusLabel.textContent = has
            ? K.providerLabel(provider()) + ' ready'
            : 'No key for ' + K.providerLabel(provider());
        return has;
    }

    /* -------------------------------------------------------------------- init */

    function init() {
        ui = {
            log: document.getElementById('chat-history'),
            input: document.getElementById('chat-input'),
            send: document.getElementById('send-button'),
            model: document.getElementById('model-selector'),
            temp: document.getElementById('temperature-slider'),
            tempOut: document.getElementById('temp-value'),
            tokens: document.getElementById('token-display'),
            speed: document.getElementById('speed-display'),
            light: document.getElementById('status-light'),
            statusLabel: document.getElementById('status-label'),
            turns: document.getElementById('turn-count'),
        };

        settings = K.ui.mountSettings({
            providers: ['gemini', 'groq', 'hf'],
            onSave: function () {
                K.ui.fillModelSelect(ui.model, provider());
                checkStatus();
            },
        });

        K.ui.fillModelSelect(ui.model, provider());
        checkStatus();
        greeting();
        updateTurnCount();

        ui.temp.addEventListener('input', function () {
            ui.tempOut.textContent = ui.temp.value;
        });
        ui.send.addEventListener('click', send);
        ui.input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        });
        document.getElementById('new-chat-btn').addEventListener('click', newChat);
        document.getElementById('open-settings').addEventListener('click', function () {
            settings.open();
        });
        document.getElementById('purge-btn').addEventListener('click', K.ui.purgeAll);

        ui.input.focus();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
