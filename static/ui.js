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

    /* Bump on each release. Written into the "Kusanagi AI.md" file beside
       saved chats, so a folder of chats says which build made it. */
    window.Kusanagi.VERSION = '2026.10.21';

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
            // 'new-password' is the value browsers honour: they neither fill a
            // saved login into the field nor take it for a site password.
            autocomplete: 'new-password',
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
                autocomplete: 'new-password', spellcheck: 'false', class: 'mt-2',
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

        var prefs = window.Kusanagi.prefs;

        /* Claude options and the read-aloud voice are remembered in this
           browser as soon as they change: Save is about keys, and refuses
           without one. */
        function optionSelect(id, choices) {
            return el('select', { id: id, class: 'mt-1' }, choices.map(function (c) {
                return el('option', { value: c[0], text: c[1] });
            }));
        }

        function optionToggle(id, label, note) {
            var box = el('input', { type: 'checkbox', id: id, class: 'mt-0.5 shrink-0' });
            var row = el('div', { class: 'mt-2' }, [
                el('label', {
                    class: 'flex items-start gap-2 text-xs text-fg-primary cursor-pointer',
                    for: id,
                }, [box, el('span', { text: label })]),
                el('p', { class: 'text-[11px] text-fg-secondary ml-5', text: note }),
            ]);
            return { box: box, row: row };
        }

        var effortSelect = optionSelect('settings-claude-effort', [
            ['', 'Model default'], ['low', 'Low (fast, cheap)'], ['medium', 'Medium'],
            ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max (slowest, priciest)'],
        ]);
        var maxTokensSelect = optionSelect('settings-claude-max', [
            ['4096', '4K tokens'], ['16000', '16K tokens'], ['32000', '32K tokens'],
        ]);
        var webLimitSelect = optionSelect('settings-claude-web-limit', [
            ['', 'No limit'], ['5', '5 each'], ['10', '10 each'], ['25', '25 each'],
        ]);
        var chimeToggle = optionToggle('settings-chime', 'Chime when an answer is done',
            'A short tune, made in the browser. Nothing is downloaded.');
        var claudeToggles = {
            reasoning: optionToggle('settings-claude-reasoning', 'Show reasoning',
                'A summary of how Claude thought it through, above the answer.'),
            cache: optionToggle('settings-claude-cache', 'Prompt caching',
                'Each chat turn re-reads the instructions and earlier turns from '
                + 'Anthropic\u2019s cache at a twentieth of the price or less (a '
                + 'fortieth on Fable). New text costs a quarter more the first time. '
                + 'The cache lasts 5 minutes after each answer.'),
            usOnly: optionToggle('settings-claude-us', 'Process in the US only',
                'Sends inference_geo: "us".'),
            fast: optionToggle('settings-claude-fast', 'Fast mode (Opus 5.5 only)',
                'Up to 2.5× faster output at twice the price.'),
            webSearch: optionToggle('settings-claude-search', 'Web search',
                'Claude searches the web itself, as often as the answer needs (see '
                + 'the limit below). Billed per search ($10 per 1,000) on top of tokens.'),
            webFetch: optionToggle('settings-claude-fetch', 'Web fetch',
                'Claude reads the full text of pages linked in the chat or found by '
                + 'search. Fetched pages count as input tokens.'),
        };

        function claudeLabel(text, id) {
            return el('label', {
                class: 'block text-[11px] text-fg-secondary mt-2', for: id, text: text,
            });
        }

        var claudeBox = el('div', { class: 'hidden mb-2 pt-3 border-t border-tertiary/60 '
            + 'md:pt-0 md:border-t-0' }, [
            el('p', {
                class: 'block text-xs font-bold text-fg-secondary uppercase tracking-wide',
                text: 'Claude options',
            }),
            el('div', { class: 'grid grid-cols-2 gap-2' }, [
                el('div', {}, [claudeLabel('Effort', 'settings-claude-effort'), effortSelect]),
                el('div', {}, [claudeLabel('Max answer length', 'settings-claude-max'),
                    maxTokensSelect]),
            ]),
            claudeToggles.reasoning.row,
            claudeToggles.cache.row,
            claudeToggles.usOnly.row,
            claudeToggles.fast.row,
            claudeToggles.webSearch.row,
            claudeToggles.webFetch.row,
            el('div', { class: 'mt-2' }, [
                claudeLabel('Searches and fetches per answer', 'settings-claude-web-limit'),
                webLimitSelect,
            ]),
        ]);

        var voiceSourceSelect = optionSelect('settings-voice-source', [
            ['local', 'Local (on this device)'],
            ['web', 'Web (online, natural)'],
        ]);
        voiceSourceSelect.classList.add('flex-1', 'min-w-0');
        var voiceSelect = el('select', { id: 'settings-voice', 'aria-label': 'Voice',
            class: 'mt-2' });
        var voiceNote = el('p', { class: 'text-[11px] text-fg-secondary mt-1' });

        var leftColumn = el('div', {}, [
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
                chimeToggle.row,
            ]),

            el('div', { class: 'mb-2 pt-3 border-t border-tertiary/60' }, [
                el('label', {
                    class: 'block text-xs font-bold text-fg-secondary uppercase tracking-wide mb-2',
                    for: 'settings-voice-source',
                    text: 'Read-aloud voice',
                }),
                el('div', { class: 'flex gap-2 items-center' }, [
                    voiceSourceSelect,
                    el('button', {
                        class: 'btn btn-secondary text-xs', type: 'button', text: 'Test',
                        on: { click: function () { testVoice(); } },
                    }),
                ]),
                voiceSelect,
                voiceNote,
            ]),
        ]);
        // Two columns once Claude's options are showing and there is room:
        // keys and voice on the left, Claude on the right.
        var columns = el('div', { class: 'gap-x-6' }, [leftColumn, claudeBox]);

        // A form of its own, so the browser's password manager groups these
        // password fields together instead of taking the page's chat or
        // search box for a username. It never submits anywhere.
        var dialog = el('form', {
            class: 'settings-modal-content p-6 rounded-lg shadow-2xl max-w-md w-full border '
                + 'max-h-[calc(100vh-2rem)] overflow-y-auto',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': title,
            autocomplete: 'off',
            novalidate: 'novalidate',
            on: { submit: function (e) { e.preventDefault(); } },
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

            columns,

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
            chimeToggle.box.checked = prefs.chime();
            var claude = provider === 'anthropic';
            claudeBox.classList.toggle('hidden', !claude);
            // Full class names, so the stylesheet build keeps them.
            dialog.classList.toggle('md:max-w-4xl', claude);
            columns.classList.toggle('md:grid', claude);
            columns.classList.toggle('md:grid-cols-2', claude);
            effortSelect.value = prefs.claude('effort');
            maxTokensSelect.value = prefs.claude('maxTokens');
            webLimitSelect.value = prefs.claude('webLimit');
            Object.keys(claudeToggles).forEach(function (name) {
                claudeToggles[name].box.checked = prefs.claude(name);
            });
            fillVoices();
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

        function announce() {
            window.dispatchEvent(new CustomEvent('kusanagi:prefs'));
        }

        function fillVoices() {
            var source = prefs.voiceSource();
            voiceSourceSelect.value = source;
            var voices = voicesFor(source);
            var current = chosenVoice();
            dom.clear(voiceSelect);
            voices.forEach(function (v) {
                voiceSelect.appendChild(el('option', { value: v.name,
                    text: v.name + ' (' + v.lang + ')' }));
            });
            if (current) voiceSelect.value = current.name;
            voiceSelect.disabled = !voices.length;
            voiceNote.textContent = !voices.length
                ? (source === 'web'
                    ? 'This browser offers no online voices. Microsoft Edge has the most, '
                        + 'including Ava Multilingual.'
                    : 'This browser offers no local voices.')
                : source === 'web'
                    ? 'Online voices send the text being read to the browser’s '
                        + 'speech service (Microsoft for Edge, Google for Chrome).'
                    : 'Spoken on this device; nothing leaves the browser.';
        }

        function testVoice() {
            if (!('speechSynthesis' in window)) {
                toast('This browser has no speech synthesis.', 'error');
                return;
            }
            stopSpeech();
            var voice = chosenVoice();
            var u = new SpeechSynthesisUtterance('Hello, this is how answers will be read aloud.');
            if (voice) { u.voice = voice; u.lang = voice.lang; }
            window.speechSynthesis.speak(u);
        }

        voiceSourceSelect.addEventListener('change', function () {
            prefs.setVoiceSource(voiceSourceSelect.value);
            fillVoices();
        });
        voiceSelect.addEventListener('change', function () {
            prefs.setVoiceName(prefs.voiceSource(), voiceSelect.value);
        });
        // Chrome loads its voice list after the page, and says so with this event.
        if ('speechSynthesis' in window) {
            window.speechSynthesis.addEventListener('voiceschanged', function () {
                if (!modal.classList.contains('hidden')) fillVoices();
            });
        }

        effortSelect.addEventListener('change', function () {
            prefs.setClaude('effort', effortSelect.value);
            announce();
        });
        webLimitSelect.addEventListener('change', function () {
            prefs.setClaude('webLimit', webLimitSelect.value);
            announce();
        });
        maxTokensSelect.addEventListener('change', function () {
            prefs.setClaude('maxTokens', maxTokensSelect.value);
            announce();
        });
        chimeToggle.box.addEventListener('change', function () {
            prefs.setChime(chimeToggle.box.checked);
            if (chimeToggle.box.checked) chime();
        });
        Object.keys(claudeToggles).forEach(function (name) {
            var box = claudeToggles[name].box;
            box.addEventListener('change', function () {
                prefs.setClaude(name, box.checked);
                announce();
            });
        });

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
        if (!window.confirm('Wipe every saved API key from this browser, and forget the chat '
            + 'folder (the chat files in it stay)? This cannot be undone.')) {
            return;
        }
        window.Kusanagi.keys.purge();
        var chats = window.Kusanagi.chats;
        (chats ? chats.forget() : Promise.resolve()).then(function () {
            window.location.reload();
        });
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

    var EFFORT_NAMES = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max' };

    /**
     * Keep a page's model controls in step with the Claude options in Settings:
     * the temperature slider is switched off for Claude (it rejects sampling
     * settings), and a line under the model picker says which options are on.
     *
     * bindModelControls({model, temp, tempOut, provider}) -> sync()
     * Call sync() again after the provider changes.
     */
    function bindModelControls(c) {
        var prefs = window.Kusanagi.prefs;
        // The one-line summary of Claude options under the model menu. Pages
        // that show those controls beside the menu pass summary: false.
        var summary = el('p', { class: 'text-[10px] text-fg-secondary mt-1 hidden' });
        if (c.summary !== false) c.model.insertAdjacentElement('afterend', summary);
        var tempValue = c.tempOut ? c.tempOut.textContent : '';

        function sync() {
            var claude = c.provider() === 'anthropic';
            if (c.temp) {
                c.temp.disabled = claude;
                c.temp.title = claude ? 'Claude does not accept a temperature setting.' : '';
                c.temp.classList.toggle('opacity-40', claude);
            }
            if (c.tempOut) {
                if (claude) {
                    if (c.tempOut.textContent !== '—') tempValue = c.tempOut.textContent;
                    c.tempOut.textContent = '—';
                } else if (c.tempOut.textContent === '—') {
                    c.tempOut.textContent = tempValue || c.temp.value;
                }
            }

            summary.classList.toggle('hidden', !claude);
            if (!claude) return;
            var effort = prefs.claude('effort');
            var parts = ['Effort: ' + (effort ? EFFORT_NAMES[effort] : 'default')];
            if (prefs.claude('reasoning')) parts.push('reasoning shown');
            if (prefs.claude('cache')) parts.push('cached');
            if (prefs.claude('usOnly')) parts.push('US only');
            if (prefs.claude('webSearch')) parts.push('web search');
            if (prefs.claude('webFetch')) parts.push('web fetch');
            if (prefs.claude('fast')) {
                parts.push(c.model.value === 'claude-opus-5-5' ? 'fast' : 'fast (Opus 5.5 only, off here)');
            }
            summary.textContent = parts.join(' · ');
        }

        c.model.addEventListener('change', sync);
        window.addEventListener('kusanagi:prefs', sync);
        sync();
        return sync;
    }

    /**
     * Claude controls for beside a chat or search box: the thinking effort and
     * a "Reasoning" switch. They share their settings with the Settings dialog,
     * and hide themselves unless Claude is the provider.
     *
     * claudeControls(provider) -> {node, sync}
     */
    function claudeControls(provider) {
        var prefs = window.Kusanagi.prefs;
        var select = el('select', {
            class: '!w-auto !bg-transparent !border-0 !text-xs !py-1 !pl-2 !pr-6 '
                + 'text-fg-secondary',
            'aria-label': 'Thinking effort',
            title: 'How hard Claude thinks: higher is slower and costs more.',
        }, [['', 'Effort: default'], ['low', 'Effort: low'], ['medium', 'Effort: medium'],
            ['high', 'Effort: high'], ['xhigh', 'Effort: extra high'], ['max', 'Effort: max'],
        ].map(function (c) { return el('option', { value: c[0], text: c[1] }); }));

        // Web tools and how many searches and fetches one answer may use.
        // 'off' turns both tools off; any other choice turns them on.
        var web = el('select', {
            class: '!w-auto !bg-transparent !border-0 !text-xs !py-1 !pl-2 !pr-6 '
                + 'text-fg-secondary',
            'aria-label': 'Web searches and fetches per answer',
            title: 'How many web searches and page fetches Claude may make per answer. '
                + 'Searches cost $10 per 1,000 on top of tokens.',
        }, [['off', 'Web: off'], ['', 'Web: no limit'], ['5', 'Web: 5 each'],
            ['10', 'Web: 10 each'], ['25', 'Web: 25 each'],
        ].map(function (c) { return el('option', { value: c[0], text: c[1] }); }));

        var reasoning = el('button', {
            type: 'button',
            class: 'text-[11px] font-bold px-2 py-0.5 rounded border transition whitespace-nowrap',
            text: 'Reasoning',
            title: 'Show a summary of how Claude thought it through, above the answer.',
        });

        var node = el('span', { class: 'flex items-center gap-1 shrink-0 pr-1' },
            [select, web, reasoning]);

        function announce() { window.dispatchEvent(new CustomEvent('kusanagi:prefs')); }

        function sync() {
            node.classList.toggle('hidden', provider() !== 'anthropic');
            select.value = prefs.claude('effort');
            web.value = prefs.claude('webSearch') || prefs.claude('webFetch')
                ? prefs.claude('webLimit') : 'off';
            var on = prefs.claude('reasoning');
            reasoning.setAttribute('aria-pressed', String(on));
            reasoning.classList.toggle('border-accent', on);
            reasoning.classList.toggle('text-accent', on);
            reasoning.classList.toggle('border-tertiary', !on);
            reasoning.classList.toggle('text-fg-secondary', !on);
        }
        select.addEventListener('change', function () {
            prefs.setClaude('effort', select.value);
            announce();
        });
        web.addEventListener('change', function () {
            var on = web.value !== 'off';
            prefs.setClaude('webSearch', on);
            prefs.setClaude('webFetch', on);
            if (on) prefs.setClaude('webLimit', web.value);
            announce();
        });
        reasoning.addEventListener('click', function () {
            prefs.setClaude('reasoning', !prefs.claude('reasoning'));
            announce();
        });
        window.addEventListener('kusanagi:prefs', sync);
        sync();
        return { node: node, sync: sync };
    }

    /** "Searched the web" list of the pages Claude used, or null. */
    function webSourcesBlock(sources) {
        if (!sources || !sources.length) return null;
        return el('details', {
            class: 'mt-2 text-xs text-fg-secondary border border-tertiary rounded px-3 py-2',
        }, [
            el('summary', { class: 'cursor-pointer font-bold',
                text: 'Web sources (' + sources.length + ')' }),
            el('ol', { class: 'mt-2 list-decimal ml-5 space-y-1' }, sources.map(function (s) {
                return el('li', {}, [el('a', {
                    href: s.url, target: '_blank', rel: 'noopener noreferrer',
                    class: 'text-accent hover:underline break-all', text: s.title,
                })]);
            })),
        ]);
    }

    /** A collapsed "Reasoning" box for Claude's summarised thinking, or null. */
    function reasoningBlock(text) {
        if (!text) return null;
        return el('details', {
            class: 'mb-2 text-xs text-fg-secondary border border-tertiary rounded px-3 py-2',
        }, [
            el('summary', { class: 'cursor-pointer font-bold', text: 'Reasoning' }),
            el('div', { class: 'mt-2 whitespace-pre-wrap', text: text }),
        ]);
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

    /* ----------------------------------------------------------------- chime */

    var audio = null;

    /**
     * A soft rising arpeggio (C6 E6 G6 C7) when an answer is done, synthesised
     * with Web Audio so there is no sound file to fetch. Silent if the
     * preference is off or the browser blocks audio before any click.
     */
    function chime() {
        if (!window.Kusanagi.prefs.chime()) return;
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        try {
            audio = audio || new Ctx();
            if (audio.state === 'suspended') audio.resume();
            var t0 = audio.currentTime + 0.02;
            var out = audio.createGain();
            out.gain.value = 0.18;
            out.connect(audio.destination);
            [1046.5, 1318.5, 1568.0, 2093.0].forEach(function (freq, i) {
                var start = t0 + i * 0.11;
                var tail = i === 3 ? 1.2 : 0.6;
                // A sine with a quiet octave above it reads as a bell, not a beep.
                [[1, 1], [2, 0.25]].forEach(function (partial) {
                    var osc = audio.createOscillator();
                    var env = audio.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = freq * partial[0];
                    env.gain.setValueAtTime(0.0001, start);
                    env.gain.exponentialRampToValueAtTime(partial[1], start + 0.015);
                    env.gain.exponentialRampToValueAtTime(0.0001, start + tail);
                    osc.connect(env);
                    env.connect(out);
                    osc.start(start);
                    osc.stop(start + tail + 0.05);
                });
            });
        } catch (e) { /* audio is a nicety; never break the answer over it */ }
    }

    /* ------------------------------------------------------------ read aloud */

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

    /* ------------------------------------------- what is being spoken now */

    // Reading goes one block (paragraph, list item, heading) at a time; the
    // block being read is highlighted and a small bar floats beside it.
    // Pause cancels speech and keeps the place instead of calling
    // speechSynthesis.pause(): browsers' resume() is unreliable, and Chrome's
    // online voices ignore it. Resume, Previous and Next all restart speech at
    // the start of a block.
    var session = null;    // {button, parts, index, paused}
    var run = 0;           // bumped on every restart; older callbacks are ignored
    var spokenNode = null;
    var speechBar = null;
    var barButtons = null;

    function stopSpeech() {
        run += 1;
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (session) resetSpeakButton(session.button);
        session = null;
        highlight(null);
        hideSpeechBar();
    }

    /** Speak block `index` of the session, then carry on to the next. */
    function speakFrom(index) {
        var s = session;
        if (!s) return;
        s.index = Math.max(0, Math.min(index, s.parts.length - 1));
        s.paused = false;
        run += 1;
        var mine = run;
        window.speechSynthesis.cancel();
        highlight(s.parts[s.index].node);
        syncSpeechBar();

        var current = s.index;
        var voice = chosenVoice();
        var pieces = speechPieces(s.parts[current].text);
        pieces.forEach(function (piece, i) {
            var u = new SpeechSynthesisUtterance(piece);
            if (voice) { u.voice = voice; u.lang = voice.lang; }
            if (i === pieces.length - 1) {
                u.onend = function () {
                    if (mine !== run || session !== s) return;
                    if (current + 1 < s.parts.length) speakFrom(current + 1);
                    else stopSpeech();
                };
            }
            u.onerror = function (e) {
                if (mine !== run || session !== s) return;
                // Our own cancel() reports these; only a real failure ends reading.
                if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
                stopSpeech();
            };
            window.speechSynthesis.speak(u);
        });
    }

    function startSpeech(button, parts, index) {
        if (!('speechSynthesis' in window)) {
            toast('This browser has no speech synthesis.', 'error');
            return;
        }
        stopSpeech();
        if (!parts.length) { toast('Nothing to read yet.'); return; }
        session = { button: button, parts: parts, index: 0, paused: false };
        button.textContent = 'Stop';
        button.setAttribute('aria-pressed', 'true');
        button.classList.add('text-accent');
        showSpeechBar();
        speakFrom(index || 0);
    }

    function togglePause() {
        if (!session) return;
        if (session.paused) {
            speakFrom(session.index);
            return;
        }
        session.paused = true;
        run += 1;
        window.speechSynthesis.cancel();
        syncSpeechBar();
    }

    function step(by) {
        if (!session) return;
        var next = session.index + by;
        if (next < 0 || next >= session.parts.length) return;
        speakFrom(next);
    }

    function highlight(node) {
        if (spokenNode) spokenNode.classList.remove('is-speaking');
        spokenNode = node;
        if (!node) return;
        node.classList.add('is-speaking');
        var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var rect = node.getBoundingClientRect();
        if (rect.top < 60 || rect.bottom > window.innerHeight - 60) {
            node.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
        }
        placeSpeechBar();
    }

    function ensureSpeechBar() {
        if (speechBar && document.body.contains(speechBar)) return speechBar;
        function button(text, label, click) {
            return el('button', { type: 'button', class: 'speech-btn', text: text,
                'aria-label': label, on: { click: click } });
        }
        barButtons = {
            prev: button('\u25C2 Prev', 'Previous paragraph', function () { step(-1); }),
            pause: button('Pause', 'Pause', togglePause),
            next: button('Next \u25B8', 'Next paragraph', function () { step(1); }),
            stop: button('Stop', 'Stop reading', stopSpeech),
        };
        speechBar = el('div', { class: 'speech-bar hidden', role: 'toolbar',
            'aria-label': 'Reading aloud' },
            [barButtons.prev, barButtons.pause, barButtons.next, barButtons.stop]);
        document.body.appendChild(speechBar);
        // Capture, so scrolling inside the chat log moves the bar too.
        window.addEventListener('scroll', placeSpeechBar, true);
        window.addEventListener('resize', placeSpeechBar);
        return speechBar;
    }

    function syncSpeechBar() {
        if (!session || !barButtons) return;
        var label = session.paused ? 'Resume' : 'Pause';
        barButtons.pause.textContent = label;
        barButtons.pause.setAttribute('aria-label', label);
        barButtons.prev.disabled = session.index === 0;
        barButtons.next.disabled = session.index >= session.parts.length - 1;
    }

    /** Beside the spoken block (or the button that started it), on screen. */
    function placeSpeechBar() {
        if (!speechBar || speechBar.classList.contains('hidden')) return;
        var anchor = spokenNode || (session && session.button);
        if (!anchor) return;
        var rect = anchor.getBoundingClientRect();
        var w = speechBar.offsetWidth;
        var h = speechBar.offsetHeight;
        var left;
        var top;
        if (rect.right + 8 + w <= window.innerWidth - 8) {
            // Room to the right: sit level with the block, covering nothing.
            left = rect.right + 8;
            top = rect.top + (rect.height - h) / 2;
        } else {
            // Narrow screens: just above the block, or below it at the top.
            left = Math.min(rect.right - w, window.innerWidth - w - 8);
            top = rect.top - h - 6;
            if (top < 8) top = rect.bottom + 6;
        }
        speechBar.style.left = Math.max(8, left) + 'px';
        speechBar.style.top = Math.min(Math.max(8, top), window.innerHeight - h - 8) + 'px';
    }

    function showSpeechBar() {
        ensureSpeechBar();
        speechBar.classList.remove('hidden');
        syncSpeechBar();
        placeSpeechBar();
    }

    function hideSpeechBar() {
        if (speechBar) speechBar.classList.add('hidden');
    }

    /**
     * A rendered answer split into the blocks a reader sees -- paragraphs,
     * list items, headings, table cells -- each with the text to speak, so
     * each can be highlighted as it is read. -> [{node, text}]
     */
    var BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, pre';

    function speakableParts(root) {
        var blocks = Array.prototype.filter.call(root.querySelectorAll(BLOCKS), function (b) {
            // Innermost only: a list item holding paragraphs is read as those.
            return !b.querySelector(BLOCKS) && !b.closest('.code-head, button');
        });
        var parts = blocks.map(function (b) { return { node: b, text: speakableText(b) }; })
            .filter(function (p) { return p.text; });
        return parts.length ? parts : [{ node: root, text: speakableText(root) }];
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
        copy.querySelectorAll('.katex-html, annotation, button, .code-head').forEach(function (n) {
            n.parentNode.removeChild(n);
        });
        return copy.textContent.replace(/\s+/g, ' ').trim();
    }

    /** `getText()` as parts: a string becomes one part with no node. */
    function partsFrom(got) {
        if (Array.isArray(got)) return got.filter(function (p) { return p && p.text; });
        var text = String(got || '').trim();
        return text ? [{ node: null, text: text }] : [];
    }

    // Each speak button's getText, so a click on its answer can start there.
    var partsFor = new WeakMap();

    /**
     * Make a button read aloud, and stop on a second click. `getText` returns
     * a string, or parts from speakableParts() so each block is highlighted
     * while it is read.
     */
    function bindSpeak(button, getText) {
        button.setAttribute('data-label', button.textContent);
        button.setAttribute('aria-pressed', 'false');
        partsFor.set(button, getText);
        button.addEventListener('click', function () {
            if (session && session.button === button) { stopSpeech(); return; }
            startSpeech(button, partsFrom(getText()), 0);
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

    /**
     * Clicking a paragraph of `root` reads aloud from there, through `button`
     * (a speakButton for the same answer). Links, buttons and selected text
     * keep their usual behaviour.
     */
    function readOnClick(root, button) {
        root.classList.add('read-on-click');
        root.addEventListener('click', function (e) {
            if (e.target.closest('a, button, input, select, textarea, summary, .code-head')) return;
            var selected = window.getSelection && String(window.getSelection()).trim();
            if (selected) return;
            var getText = partsFor.get(button);
            if (!getText) return;
            var parts = partsFrom(getText());
            for (var i = 0; i < parts.length; i++) {
                if (parts[i].node && parts[i].node.contains(e.target)) {
                    startSpeech(button, parts, i);
                    return;
                }
            }
        });
    }

    /* ------------------------------------------------------------ save file */

    /** Hand the user `text` as a file download. Nothing leaves the browser. */
    function saveFile(name, text, type) {
        var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        // A plain anchor: dom.el only accepts web URLs, and this is a blob: one.
        var link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    /** "2026-10-21 14-05": a date and time that sorts and is safe in a filename. */
    function fileStamp(date) {
        function two(n) { return (n < 10 ? '0' : '') + n; }
        var d = date || new Date();
        return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
            + ' ' + two(d.getHours()) + '-' + two(d.getMinutes());
    }

    /* ----------------------------------------------------------- new version */

    // When a new build is deployed, offer a reload rather than leave the page
    // running old code. The page, its own scripts and its stylesheet are
    // checked with HEAD requests (no body is downloaded): GitHub Pages and the
    // local server both send an ETag or Last-Modified that changes with the
    // file. Vendor libraries are skipped; they change rarely and are large.
    var UPDATE_CHECK_MS = 5 * 60 * 1000;

    function ownAssets() {
        var urls = [window.location.href.split('#')[0]];
        var nodes = document.querySelectorAll('script[src], link[rel="stylesheet"][href]');
        Array.prototype.forEach.call(nodes, function (node) {
            var url = new URL(node.src || node.href, window.location.href);
            if (url.origin === window.location.origin
                && url.pathname.indexOf('/vendor/') === -1) {
                urls.push(url.href);
            }
        });
        return urls;
    }

    function versionOf(url) {
        return fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (resp) {
            if (!resp.ok) return null;
            return resp.headers.get('ETag') || resp.headers.get('Last-Modified') || null;
        }).catch(function () { return null; });
    }

    /* GitHub Pages lets browsers keep files for 10 minutes, and a plain reload
       re-checks only the page, not its scripts. Re-fetch our own files past
       the cache first, so the reload runs the new code, not old scripts. */
    function reloadFresh() {
        var refresh = ownAssets().map(function (url) {
            return fetch(url, { cache: 'reload' }).catch(function () { return null; });
        });
        Promise.all(refresh).then(function () { window.location.reload(); });
    }

    function offerReload() {
        var reload = el('button', {
            type: 'button', class: 'btn btn-accent text-xs', text: 'Reload',
            on: { click: reloadFresh },
        });
        var later = el('button', {
            type: 'button', class: 'btn btn-secondary text-xs', text: 'Later',
            on: { click: function () { node.parentNode.removeChild(node); } },
        });
        var node = el('div', {
            class: 'settings-modal-content px-4 py-3 rounded-lg shadow-lg border '
                + 'border-accent text-sm max-w-sm fade-enter',
            role: 'status',
        }, [
            el('p', { class: 'font-bold text-fg-primary', text: 'A new version is available.' }),
            el('p', {
                class: 'text-xs text-fg-secondary mt-1',
                text: 'Reload to use it. Anything not saved on this page, such as '
                    + 'a chat or loaded documents, will be cleared.',
            }),
            el('div', { class: 'flex gap-2 mt-2' }, [reload, later]),
        ]);
        ensureToastHost().appendChild(node);
    }

    function watchForUpdates() {
        if (!/^https?:$/.test(window.location.protocol) || !window.fetch) return;
        var urls = ownAssets();
        var known = {};
        var offered = false;

        function check() {
            if (offered || document.hidden) return;
            Promise.all(urls.map(versionOf)).then(function (versions) {
                var changed = false;
                versions.forEach(function (version, i) {
                    if (version === null) return;
                    if (!(urls[i] in known)) known[urls[i]] = version;
                    else if (known[urls[i]] !== version) changed = true;
                });
                if (changed && !offered) {
                    offered = true;
                    offerReload();
                }
            });
        }

        check();
        setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener('visibilitychange', check);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchForUpdates);
    } else {
        watchForUpdates();
    }

    window.Kusanagi.ui = {
        saveFile: saveFile,
        fileStamp: fileStamp,
        bindSpeak: bindSpeak,
        speakButton: speakButton,
        speakableText: speakableText,
        speakableParts: speakableParts,
        readOnClick: readOnClick,
        stopSpeech: stopSpeech,
        copyButton: copyButton,
        bindCopy: bindCopy,
        toast: toast,
        chime: chime,
        mountSettings: mountSettings,
        purgeAll: purgeAll,
        fillModelSelect: fillModelSelect,
        bindModelControls: bindModelControls,
        reasoningBlock: reasoningBlock,
        claudeControls: claudeControls,
        webSourcesBlock: webSourcesBlock,
        resultCard: resultCard,
        expandableText: expandableText,
        copyToClipboard: copyToClipboard,
    };
})();
