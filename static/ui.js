/* Kusanagi AI -- shared UI chrome: settings dialog, toasts, result cards.
 * Requires keys.js, providers.js and dom.js.
 *
 * Nothing here builds markup from a string. See dom.js for why.
 */
window.Kusanagi = window.Kusanagi || {};

(function () {
    'use strict';

    var dom = window.Kusanagi.dom;
    var el = dom.el;

    /* ------------------------------------------------------------------ toasts */

    var toastHost = null;

    function ensureToastHost() {
        if (toastHost && document.body.contains(toastHost)) return toastHost;
        toastHost = el('div', {
            class: 'fixed top-4 right-4 z-[200] flex flex-col gap-2 items-end',
            role: 'status',
            'aria-live': 'polite',
        });
        document.body.appendChild(toastHost);
        return toastHost;
    }

    /**
     * Non-blocking message. Replaces alert(), which froze the page and could not
     * show more than one thing at a time.
     * kind: 'info' | 'success' | 'error'
     */
    function toast(message, kind) {
        var tone = kind === 'error'
            ? 'border-danger text-danger'
            : kind === 'success'
                ? 'border-success text-success'
                : 'border-tertiary text-fg-primary';

        var node = el('div', {
            class: 'settings-modal-content px-4 py-2 rounded-lg shadow-lg border text-sm '
                + 'max-w-sm fade-enter ' + tone,
            text: String(message),
        });
        ensureToastHost().appendChild(node);
        setTimeout(function () {
            if (node.parentNode) node.parentNode.removeChild(node);
        }, kind === 'error' ? 8000 : 4000);
        return node;
    }

    /* ---------------------------------------------------------------- settings */

    var settingsApi = null;

    /**
     * mountSettings({providers, title, onSave}) -> {open, close, refresh}
     *
     * Idempotent: repeated calls return the dialog already on the page.
     */
    function mountSettings(options) {
        if (settingsApi) return settingsApi;
        var opts = options || {};
        var providers = opts.providers || ['gemini', 'hf', 'openrouter'];
        var title = opts.title || 'System Config';

        var providerSelect = el('select', { id: 'settings-provider-select' },
            providers.map(function (p) {
                return el('option', { value: p, text: window.Kusanagi.providerLabel(p) });
            }));

        var keyInput = el('input', {
            type: 'password',
            id: 'settings-key-input',
            autocomplete: 'off',
            spellcheck: 'false',
            placeholder: 'Enter secret key...',
            'aria-describedby': 'settings-persist-note',
        });

        var persistBox = el('input', { type: 'checkbox', id: 'settings-persist',
            class: 'mt-0.5 shrink-0' });

        var persistNote = el('p', {
            id: 'settings-persist-note',
            class: 'text-[11px] text-fg-secondary mt-1',
        });

        var hint = el('p', { class: 'text-[10px] text-fg-secondary mt-1 hidden' });

        var fallbackBox = el('input', {
            type: 'checkbox',
            id: 'settings-fallback',
            class: 'mt-0.5 shrink-0',
        });

        var dialog = el('div', {
            class: 'settings-modal-content p-6 rounded-lg shadow-2xl max-w-md w-full border',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': title,
        }, [
            el('div', { class: 'flex justify-between items-start mb-4' }, [
                el('h2', { class: 'text-xl font-bold text-accent', text: title }),
                el('button', {
                    class: 'text-fg-secondary hover:text-fg-primary transition text-xl leading-none',
                    type: 'button',
                    'aria-label': 'Close settings',
                    text: '✕',
                    on: { click: function () { close(); } },
                }),
            ]),

            el('div', {
                class: 'bg-success/10 border border-success/30 p-3 rounded mb-5 text-xs text-success',
            }, [
                el('strong', { text: 'Privacy: ' }),
                'Keys stay in this browser and go straight to the provider you pick. '
                + 'By default they are cleared when you close the tab.',
            ]),

            el('div', { class: 'mb-4' }, [
                el('label', {
                    class: 'block text-xs font-bold text-fg-secondary uppercase tracking-wide mb-2',
                    for: 'settings-provider-select',
                    text: 'AI provider',
                }),
                providerSelect,
            ]),

            el('div', { class: 'mb-2' }, [
                el('label', {
                    class: 'block text-xs font-bold text-fg-secondary uppercase tracking-wide mb-2',
                    for: 'settings-key-input',
                    text: 'API key',
                }),
                keyInput,
                hint,
            ]),

            el('div', { class: 'mb-2' }, [
                el('label', {
                    class: 'flex items-start gap-2 text-xs text-fg-primary cursor-pointer',
                    for: 'settings-persist',
                }, [persistBox, el('span', { text: 'Remember this key on this device' })]),
                persistNote,
            ]),

            el('div', { class: 'mb-2 pt-3 border-t border-tertiary/60' }, [
                el('label', {
                    class: 'flex items-start gap-2 text-xs text-fg-primary cursor-pointer',
                    for: 'settings-fallback',
                }, [fallbackBox, el('span', {
                    text: 'Fall back to this provider’s other models on failure',
                })]),
                el('p', {
                    class: 'text-[11px] text-fg-secondary mt-1',
                    text: 'If a model is retired, rate-limited or overloaded, try the '
                        + 'next one in the list. Never switches provider.',
                }),
            ]),

            el('div', {
                class: 'flex justify-between items-center mt-6 pt-4 border-t border-tertiary',
            }, [
                el('button', {
                    class: 'btn btn-danger text-xs',
                    type: 'button',
                    text: 'Purge all keys',
                    on: { click: purgeAll },
                }),
                el('div', { class: 'flex gap-2' }, [
                    el('button', {
                        class: 'btn btn-secondary',
                        type: 'button',
                        text: 'Cancel',
                        on: { click: function () { close(); } },
                    }),
                    el('button', {
                        class: 'btn btn-accent',
                        type: 'button',
                        text: 'Save',
                        on: { click: save },
                    }),
                ]),
            ]),
        ]);

        var modal = el('div', {
            class: 'hidden fixed inset-0 settings-modal z-[100] flex items-center '
                + 'justify-center backdrop-blur-sm p-4',
            on: {
                // Click the backdrop (not the dialog) to dismiss.
                click: function (e) { if (e.target === modal) close(); },
            },
        }, [dialog]);

        document.body.appendChild(modal);

        function currentProvider() { return providerSelect.value; }

        function refresh() {
            var provider = currentProvider();
            var isOllama = provider === 'ollama';

            keyInput.value = window.Kusanagi.keys.get(provider);
            keyInput.placeholder = isOllama
                ? window.Kusanagi.OLLAMA_DEFAULT
                : 'Enter secret key...';
            // An Ollama base URL is not a secret and is easier to check if visible.
            keyInput.type = isOllama ? 'text' : 'password';

            hint.classList.toggle('hidden', !isOllama);
            hint.textContent = isOllama
                ? 'Base URL of your local Ollama server. Leave empty for '
                    + window.Kusanagi.OLLAMA_DEFAULT + '.'
                : '';

            fallbackBox.checked = window.Kusanagi.prefs.modelFallback();
            persistBox.checked = window.Kusanagi.keys.isPersisted(provider);
            persistNote.textContent = persistBox.checked
                ? 'Stored on disk until you purge it. Anything that can read this '
                    + 'browser profile can read the key.'
                : 'Kept in memory for this tab only, and cleared when the tab closes.';
        }

        function save() {
            var provider = currentProvider();
            var value = keyInput.value.trim();
            if (provider === 'ollama' && !value) value = window.Kusanagi.OLLAMA_DEFAULT;
            if (!value) {
                toast('Enter a key first.', 'error');
                keyInput.focus();
                return;
            }
            window.Kusanagi.keys.setProvider(provider);
            window.Kusanagi.keys.set(provider, value, persistBox.checked);
            window.Kusanagi.prefs.setModelFallback(fallbackBox.checked);
            close();
            toast('Saved ' + window.Kusanagi.providerLabel(provider) + ' key'
                + (persistBox.checked ? ' (remembered on this device).' : ' for this tab.'),
                'success');
            if (opts.onSave) opts.onSave(provider, value);
        }

        var lastFocused = null;

        function open() {
            lastFocused = document.activeElement;
            providerSelect.value = window.Kusanagi.keys.provider();
            refresh();
            modal.classList.remove('hidden');
            keyInput.focus();
        }

        function close() {
            modal.classList.add('hidden');
            // Do not leave the key sitting in a detached input.
            keyInput.value = '';
            if (lastFocused && lastFocused.focus) lastFocused.focus();
        }

        providerSelect.addEventListener('change', refresh);
        persistBox.addEventListener('change', function () {
            persistNote.textContent = persistBox.checked
                ? 'Stored on disk until you purge it. Anything that can read this '
                    + 'browser profile can read the key.'
                : 'Kept in memory for this tab only, and cleared when the tab closes.';
        });
        keyInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
        });

        settingsApi = { open: open, close: close, refresh: refresh };
        return settingsApi;
    }

    function purgeAll() {
        if (!window.confirm('Wipe every saved API key from this browser? This cannot be undone.')) {
            return;
        }
        window.Kusanagi.keys.purge();
        window.location.reload();
    }

    /* ------------------------------------------------------------ model select */

    /** Refill a <select> with the models for a provider. */
    function fillModelSelect(select, provider) {
        var models = window.Kusanagi.models(provider);
        dom.replace(select, models.map(function (m) {
            return el('option', { value: m.id, text: m.name });
        }));
        if (!models.length) {
            select.appendChild(el('option', { value: '', text: 'No models' }));
        }
        return select;
    }

    /* -------------------------------------------------------------- result card */

    /**
     * One card shape for both search apps.
     *
     * resultCard({badge, badgeClass, meta, title, url, byline, body, footer})
     * Every field is treated as untrusted text; `body` and `footer` may be nodes.
     */
    function resultCard(spec) {
        var s = spec || {};
        var head = [];

        if (s.badge || s.meta) {
            head.push(el('div', { class: 'flex items-start justify-between gap-2 mb-1.5' }, [
                s.badge
                    ? el('span', {
                        class: 'text-[10px] uppercase font-bold px-2 py-0.5 rounded shrink-0 '
                            + (s.badgeClass || 'bg-tertiary text-fg-secondary'),
                        text: s.badge,
                    })
                    : el('span'),
                s.meta
                    ? el('span', { class: 'text-[10px] text-fg-secondary shrink-0',
                        text: String(s.meta) })
                    : null,
            ]));
        }

        var heading = el('h3', {
            class: 'text-base font-bold text-accent mb-1 leading-snug',
            text: s.title || 'Untitled',
        });

        if (s.url) {
            // dom.link() degrades to a <span> when the URL is not http(s)/mailto,
            // so an unsafe DOI still renders -- just not as something clickable.
            var wrapper = dom.link(s.url, null, 'block hover:underline');
            wrapper.appendChild(heading);
            head.push(wrapper);
        } else {
            head.push(heading);
        }

        if (s.byline) {
            head.push(el('div', {
                class: 'text-sm font-semibold text-fg-primary mb-2',
                text: s.byline,
            }));
        }

        return el('div', {
            class: 'bg-secondary border border-tertiary rounded-lg p-4 hover:border-accent '
                + 'transition group',
        }, [head, s.body || null, s.footer || null]);
    }

    /**
     * Long text with a Read more / Show less toggle, built as nodes so the text is
     * never parsed as HTML. Returns the wrapper element.
     */
    function expandableText(text, maxLength, className) {
        var full = String(text || '');
        var limit = maxLength || 250;
        var wrap = el('div', { class: className || '' });

        if (full.length <= limit) {
            wrap.textContent = full;
            return wrap;
        }

        var shown = el('span', { text: full.slice(0, limit).trimEnd() + '…' });
        var expanded = false;
        var toggle = el('button', {
            type: 'button',
            class: 'text-accent hover:underline ml-1 font-bold text-xs',
            text: 'Read more',
            'aria-expanded': 'false',
        });
        toggle.addEventListener('click', function () {
            expanded = !expanded;
            shown.textContent = expanded ? full : full.slice(0, limit).trimEnd() + '…';
            toggle.textContent = expanded ? 'Show less' : 'Read more';
            toggle.setAttribute('aria-expanded', String(expanded));
        });

        return dom.append(wrap, [shown, toggle]);
    }

    /** Copy text to the clipboard and flash a tick on the button. */
    function copyToClipboard(text, button) {
        function flash(ok) {
            if (!button) { toast(ok ? 'Copied.' : 'Could not copy.', ok ? 'success' : 'error'); return; }
            var original = button.getAttribute('aria-label') || '';
            button.classList.toggle('text-success', ok);
            button.classList.toggle('text-danger', !ok);
            button.setAttribute('aria-label', ok ? 'Copied' : 'Copy failed');
            setTimeout(function () {
                button.classList.remove('text-success', 'text-danger');
                button.setAttribute('aria-label', original);
            }, 1500);
        }

        if (!navigator.clipboard) { flash(false); return; }
        navigator.clipboard.writeText(String(text)).then(
            function () { flash(true); },
            function () { flash(false); }
        );
    }

    window.Kusanagi.ui = {
        toast: toast,
        mountSettings: mountSettings,
        purgeAll: purgeAll,
        fillModelSelect: fillModelSelect,
        resultCard: resultCard,
        expandableText: expandableText,
        copyToClipboard: copyToClipboard,
    };
})();
