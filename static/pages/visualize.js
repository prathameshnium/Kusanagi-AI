/* AI Visualizer -- next-token probability inspector. */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    var DEBOUNCE_MS = 1500;   // the free tiers rate-limit hard; do not lower this
    var debounceTimer = null;
    var inFlight = false;
    var settings = null;

    var ui = {};

    function provider() { return K.keys.provider(); }
    function apiKey() { return K.keys.get(provider()); }

    /* ------------------------------------------------------------------ render */

    function placeholder(message) {
        dom.replace(ui.list, el('p', {
            class: 'text-center text-fg-secondary text-xs mt-10 opacity-60',
            text: message,
        }));
    }

    function renderPredictions(predictions) {
        if (!predictions.length) {
            placeholder('No predictions came back.');
            return;
        }

        dom.replace(ui.list, predictions.map(function (pred) {
            var fill = el('div', { class: 'prob-bar-fill' });
            var pct = Math.max(0, Math.min(1, Number(pred.prob) || 0)) * 100;

            var item = el('button', {
                type: 'button',
                class: 'w-full text-left p-2 rounded hover:bg-tertiary/50 transition group',
                on: { click: function () { appendToken(pred.token); } },
            }, [
                el('div', { class: 'flex justify-between items-center mb-1 gap-2' }, [
                    // Model output: text node, never markup.
                    el('span', {
                        class: 'font-mono text-sm text-accent font-bold truncate',
                        text: JSON.stringify(String(pred.token)),
                    }),
                    el('span', {
                        class: 'text-xs text-fg-secondary font-mono shrink-0',
                        text: pct.toFixed(1) + '%',
                    }),
                ]),
                el('div', { class: 'prob-bar-bg' }, [fill]),
            ]);

            // Width is set through CSSOM, which a strict style-src permits;
            // a style="" attribute in markup would be blocked.
            requestAnimationFrame(function () {
                fill.style.width = Math.max(pct, 1) + '%';
            });

            return item;
        }));
    }

    /* -------------------------------------------------------------------- data */

    /** Coerce whatever the model returned into [{token, prob}]. */
    function normalise(raw) {
        var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.tokens) ? raw.tokens : []);
        return list
            .filter(function (p) { return p && p.token !== undefined && p.token !== null; })
            .map(function (p) {
                return { token: String(p.token), prob: Number(p.prob) || 0 };
            })
            .sort(function (a, b) { return b.prob - a.prob; });
    }

    function predict() {
        var text = ui.input.value;
        if (!text.trim()) { placeholder('Start typing to see AI probabilities.'); return; }

        if (!apiKey()) {
            placeholder('Set an API key to start.');
            return;
        }
        if (inFlight) return;

        inFlight = true;
        ui.loading.classList.remove('hidden');

        var topK = ui.topk.value;

        K.callJson(provider(), {
            apiKey: apiKey(),
            model: (K.models(provider())[0] || {}).id,
            temperature: 0.1,
            prompt: K.prompts.tokenProbabilities(text, topK),
        }).then(function (raw) {
            renderPredictions(normalise(raw).slice(0, Number(topK)));
        }).catch(function (err) {
            dom.replace(ui.list, el('p', {
                class: 'text-xs text-danger p-2',
                // Provider messages are text, not markup.
                text: err.message,
            }));
        }).then(function () {
            inFlight = false;
            ui.loading.classList.add('hidden');
        });
    }

    function appendToken(token) {
        // Models return tokens with or without a leading space; add one when the
        // token looks like a word and the text does not already end in whitespace.
        var needsSpace = /\w$/.test(ui.input.value) && /^\w/.test(token);
        ui.input.value += (needsSpace ? ' ' : '') + token;
        ui.input.focus();
        updateCount();
        clearTimeout(debounceTimer);
        predict();
    }

    function updateCount() {
        ui.count.textContent = ui.input.value.length + ' chars';
    }

    /* ------------------------------------------------------------------ status */

    function checkStatus() {
        var has = !!apiKey();
        ui.status.textContent = has ? 'Online' : 'Offline';
        ui.status.className = 'text-xs font-bold ' + (has ? 'text-success' : 'text-danger');
        ui.model.textContent = has
            ? K.providerLabel(provider())
            : 'No provider configured';
    }

    /* -------------------------------------------------------------------- init */

    function bindSlider(slider, output) {
        output.textContent = slider.value;
        slider.addEventListener('input', function () { output.textContent = slider.value; });
    }

    function init() {
        ui = {
            list: document.getElementById('prediction-list'),
            input: document.getElementById('text-input'),
            count: document.getElementById('char-count'),
            loading: document.getElementById('loading'),
            status: document.getElementById('status-indicator'),
            model: document.getElementById('model-display'),
            temp: document.getElementById('temp-slider'),
            topk: document.getElementById('topk-slider'),
        };

        settings = K.ui.mountSettings({
            providers: ['gemini', 'hf', 'openrouter'],
            onSave: function () { checkStatus(); predict(); },
        });

        bindSlider(ui.temp, document.getElementById('temp-val'));
        bindSlider(ui.topk, document.getElementById('topk-val'));

        ui.input.addEventListener('input', function () {
            updateCount();
            clearTimeout(debounceTimer);
            if (!ui.input.value.trim()) {
                placeholder('Start typing to see AI probabilities.');
                return;
            }
            debounceTimer = setTimeout(predict, DEBOUNCE_MS);
        });

        document.getElementById('predict-now').addEventListener('click', function () {
            clearTimeout(debounceTimer);
            predict();
        });

        document.getElementById('clear-text').addEventListener('click', function () {
            ui.input.value = '';
            updateCount();
            placeholder('Start typing to see AI probabilities.');
            ui.input.focus();
        });

        document.getElementById('open-settings').addEventListener('click', function () {
            settings.open();
        });

        placeholder('Start typing to see AI probabilities.');
        checkStatus();
        updateCount();
        ui.input.focus();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
