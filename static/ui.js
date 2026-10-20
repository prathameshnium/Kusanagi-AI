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
     * mountSettings({providers, title, onSave}) -> {open, close, refresh, provider}
     *
     * Idempotent: repeated calls return the dialog already on the page.
     */
    function mountSettings(options) {
        if (settingsApi) return settingsApi;
        var opts = options || {};
        var providers = opts.providers || ['gemini', 'anthropic', 'hf', 'openrouter'];
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

        var vault = window.Kusanagi.keys.vault;

        function passwordInput(id, placeholder) {
            return el('input', {
                type: 'password', id: id, placeholder: placeholder,
                autocomplete: 'off', spellcheck: 'false', class: 'mt-2',
            });
        }

        // Shown while remembering is ticked: the password that seals the key.
        var vaultPassword = passwordInput('settings-vault-password', 'Vault password');
        var vaultConfirm = passwordInput('settings-vault-confirm', 'Repeat the new password');
        var vaultFields = el('div', { class: 'hidden' }, [vaultPassword, vaultConfirm]);

        // Shown while a vault exists but is locked in this tab.
        var unlockPassword = passwordInput('settings-unlock-password', 'Vault password');
        var unlockBox = el('div', {
            class: 'hidden mb-5 p-3 rounded border border-accent/40 bg-accent/10',
        }, [
            el('label', {
                class: 'block text-xs font-bold text-accent uppercase tracking-wide',
                for: 'settings-unlock-password',
                text: 'Unlock saved keys',
            }),
            el('p', {
                class: 'text-[11px] text-fg-secondary mt-1',
                text: 'Your remembered keys are encrypted. The password is checked in '
                    + 'this browser only and is never stored or sent anywhere.',
            }),
            el('div', { class: 'flex gap-2 items-start' }, [
                el('div', { class: 'flex-1' }, [unlockPassword]),
                el('button', {
                    class: 'btn btn-accent text-xs mt-2', type: 'button', text: 'Unlock',
                    on: { click: function () { unlock(); } },
                }),
            ]),
        ]);

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

            unlockBox,

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
                }, [persistBox, el('span', {
                    text: 'Remember this key on this device (encrypted with a password)',
                })]),
                persistNote,
                vaultFields,
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
            unlockBox.classList.toggle('hidden', !(vault.exists() && !vault.isOpen()));
            describePersist();
        }

        function describePersist() {
            var creating = !vault.exists();
            vaultFields.classList.toggle('hidden', !persistBox.checked);
            vaultConfirm.classList.toggle('hidden', !creating);
            vaultPassword.placeholder = creating
                ? 'New vault password (at least ' + vault.MIN_PASSWORD + ' characters)'
                : 'Vault password';
            persistNote.textContent = persistBox.checked
                ? 'Encrypted in this browser (AES-256-GCM) with your password. Only the '
                    + 'encrypted copy is saved; the password is never stored or sent.'
                : 'Kept in memory for this tab only, and cleared when the tab closes.';
        }

        function unlock() {
            vault.unlock(unlockPassword.value).then(function (names) {
                unlockPassword.value = '';
                refresh();
                toast('Unlocked ' + names.length + ' saved key'
                    + (names.length === 1 ? '' : 's') + ' for this tab.', 'success');
                if (opts.onSave) opts.onSave(currentProvider(), '');
            }, function (err) {
                toast(err.message, 'error');
                unlockPassword.select();
            });
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
            var owner = window.Kusanagi.keys.belongsElsewhere(provider, value);
            if (owner) {
                toast('That looks like a ' + window.Kusanagi.providerLabel(owner)
                    + ' key. Not saved, so it is not sent to '
                    + window.Kusanagi.providerLabel(provider) + '.', 'error');
                keyInput.focus();
                return;
            }
            if (vault.isLocked()) {
                toast('Unlock your saved keys first, so this change is not undone '
                    + 'by the saved copy.', 'error');
                unlockPassword.focus();
                return;
            }
            var remember = persistBox.checked;
            var wasRemembered = window.Kusanagi.keys.isPersisted(provider);
            var password = vaultPassword.value;
            if (remember && !vault.exists() && password !== vaultConfirm.value) {
                toast('The two passwords do not match.', 'error');
                vaultConfirm.focus();
                return;
            }

            var label = window.Kusanagi.providerLabel(provider);
            var entry = {};
            entry[provider] = value;
            var stored = remember
                ? vault.store(entry, password)
                : (wasRemembered ? vault.discard(provider, password) : Promise.resolve());

            stored.then(function () {
                window.Kusanagi.keys.setProvider(provider);
                window.Kusanagi.keys.set(provider, value);
                window.Kusanagi.prefs.setModelFallback(fallbackBox.checked);
                close();
                toast('Saved ' + label + ' key'
                    + (remember ? ', encrypted on this device.' : ' for this tab.'), 'success');
                if (opts.onSave) opts.onSave(provider, value);
            }, function (err) {
                // Unticking a remembered key needs the password to rewrite the vault.
                if (!remember && wasRemembered) {
                    vaultFields.classList.remove('hidden');
                    vaultConfirm.classList.add('hidden');
                }
                toast(err.message, 'error');
                vaultPassword.focus();
            });
        }

        var lastFocused = null;

        function open() {
            lastFocused = document.activeElement;
            providerSelect.value = activeProvider();
            refresh();
            modal.classList.remove('hidden');
            (unlockBox.classList.contains('hidden') ? keyInput : unlockPassword).focus();
        }

        function close() {
            modal.classList.add('hidden');
            // Do not leave secrets sitting in detached inputs.
            keyInput.value = '';
            vaultPassword.value = '';
            vaultConfirm.value = '';
            unlockPassword.value = '';
            if (lastFocused && lastFocused.focus) lastFocused.focus();
        }

        providerSelect.addEventListener('change', refresh);
        persistBox.addEventListener('change', describePersist);
        [keyInput, vaultPassword, vaultConfirm].forEach(function (input) {
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); save(); }
            });
        });
        unlockPassword.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); unlock(); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
        });

        /** The provider this page should use: the saved choice, if this page offers it. */
        function activeProvider() {
            return window.Kusanagi.keys.provider(providers);
        }

        settingsApi = { open: open, close: close, refresh: refresh, provider: activeProvider };

        // Saved keys are locked and this page has nothing to work with: ask for
        // the password straight away rather than failing on the first request.
        if (vault.exists() && !vault.isOpen()
            && !window.Kusanagi.keys.get(activeProvider())) {
            setTimeout(open, 0);
        }
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

    /**
     * A small "Copy" button. `getText` is called on click, so it copies what
     * is current then. Copies the Markdown source, which keeps the LaTeX and
     * the links intact when pasted elsewhere.
     */
    function copyButton(getText, label) {
        var name = label || 'Copy';
        return bindCopy(el('button', {
            type: 'button',
            class: 'text-[11px] font-bold text-fg-secondary hover:text-accent transition '
                + 'border border-tertiary rounded px-2 py-0.5',
            text: name,
            'aria-label': name,
        }), getText);
    }

    /** Make an existing button copy `getText()` and flash "Copied". */
    function bindCopy(button, getText) {
        var name = button.textContent;
        function copied() {
            button.textContent = 'Copied';
            setTimeout(function () { button.textContent = name; }, 1500);
        }
        function failed() {
            toast('This browser blocked copying. Select the text and press Ctrl+C.', 'error');
        }
        button.addEventListener('click', function () {
            var text = String(getText() || '');
            if (!text) { toast('Nothing to copy yet.', 'error'); return; }
            if (!navigator.clipboard) {
                if (legacyCopy(text)) copied(); else failed();
                return;
            }
            navigator.clipboard.writeText(text).then(copied, function () {
                // Permission-gated in some browsers and embedded views.
                if (legacyCopy(text)) copied(); else failed();
            });
        });
        return button;
    }

    /** Copy through a hidden, off-screen textarea; works where the async
        Clipboard API is refused. Positioned through the CSSOM, which the CSP allows. */
    function legacyCopy(text) {
        var area = el('textarea', { 'aria-hidden': 'true', tabindex: '-1' });
        area.value = text;
        area.readOnly = true;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        area.style.top = '0';
        document.body.appendChild(area);
        var active = document.activeElement;
        area.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(area);
        if (active && active.focus) active.focus();
        return ok;
    }

    /* ------------------------------------------------------------ read aloud */

    // One voice at a time across the page; this is the button now speaking.
    var speaking = null;

    // The web default. Edge names it "Microsoft AvaMultilingual Online (Natural)".
    var WEB_DEFAULT = /ava\s*multilingual/i;

    /** The browser's voices for a source: 'local' runs on this device, 'web'
        sends the text to the browser vendor's speech service. */
    function voicesFor(source) {
        if (!('speechSynthesis' in window)) return [];
        return window.speechSynthesis.getVoices().filter(function (v) {
            return source === 'web' ? !v.localService : v.localService;
        });
    }

    /** The voice to speak with: the saved one if it still exists, else the
        source's default (Ava Multilingual on the web, the browser's own locally). */
    function chosenVoice() {
        var prefs = window.Kusanagi.prefs;
        var source = prefs.voiceSource();
        var voices = voicesFor(source);
        var name = prefs.voiceName(source);
        var match = voices.filter(function (v) { return v.name === name; })[0];
        if (match) return match;
        if (source === 'web') {
            return voices.filter(function (v) { return WEB_DEFAULT.test(v.name); })[0]
                || voices.filter(function (v) { return /^en/i.test(v.lang); })[0]
                || voices[0] || null;
        }
        return voices.filter(function (v) { return v.default; })[0] || null;
    }

    function resetSpeakButton(button) {
        button.textContent = button.getAttribute('data-label');
        button.setAttribute('aria-pressed', 'false');
        button.classList.remove('text-accent');
    }

    function stopSpeech() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (speaking) resetSpeakButton(speaking);
        speaking = null;
    }

    /* Chrome stops a single long utterance after roughly 15 seconds, so speech
       is queued as sentence-sized pieces. */
    function speechPieces(text) {
        var sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text];
        var pieces = [];
        var current = '';
        sentences.forEach(function (s) {
            if ((current + s).length > 220 && current) { pieces.push(current); current = ''; }
            current += s;
        });
        if (current.trim()) pieces.push(current);
        return pieces;
    }

    /**
     * Visible text of a rendered answer, as it should be spoken: KaTeX's
     * visual layer and TeX annotations dropped (its MathML text reads far
     * better than "\mathrm{...}"), buttons left out.
     */
    function speakableText(node) {
        var copy = node.cloneNode(true);
        copy.querySelectorAll('.katex-html, annotation, button').forEach(function (n) {
            n.parentNode.removeChild(n);
        });
        return copy.textContent.replace(/\s+/g, ' ').trim();
    }

    /** Make a button read `getText()` aloud, and stop on a second click. */
    function bindSpeak(button, getText) {
        button.setAttribute('data-label', button.textContent);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', function () {
            if (!('speechSynthesis' in window)) {
                toast('This browser has no speech synthesis.', 'error');
                return;
            }
            if (speaking === button) { stopSpeech(); return; }
            stopSpeech();
            var text = String(getText() || '').trim();
            if (!text) { toast('Nothing to read yet.'); return; }

            speaking = button;
            button.textContent = 'Stop';
            button.setAttribute('aria-pressed', 'true');
            button.classList.add('text-accent');

            var pieces = speechPieces(text);
            var voice = chosenVoice();
            pieces.forEach(function (piece, i) {
                var u = new SpeechSynthesisUtterance(piece);
                if (voice) { u.voice = voice; u.lang = voice.lang; }
                if (i === pieces.length - 1) {
                    u.onend = function () { if (speaking === button) stopSpeech(); };
                }
                u.onerror = function () { if (speaking === button) stopSpeech(); };
                window.speechSynthesis.speak(u);
            });
        });
        return button;
    }

    /** A small per-answer "Read aloud" button, styled like copyButton. */
    function speakButton(getText) {
        return bindSpeak(el('button', {
            type: 'button',
            class: 'text-[11px] font-bold text-fg-secondary hover:text-accent transition '
                + 'border border-tertiary rounded px-2 py-0.5',
            text: 'Read aloud',
        }), getText);
    }

    window.Kusanagi.ui = {
        bindSpeak: bindSpeak,
        speakButton: speakButton,
        speakableText: speakableText,
        stopSpeech: stopSpeech,
        copyButton: copyButton,
        bindCopy: bindCopy,
        toast: toast,
        mountSettings: mountSettings,
        purgeAll: purgeAll,
        fillModelSelect: fillModelSelect,
        resultCard: resultCard,
        expandableText: expandableText,
        copyToClipboard: copyToClipboard,
    };
})();
