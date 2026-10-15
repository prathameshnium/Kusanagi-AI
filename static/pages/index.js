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
        { id: 'anthropic', placeholder: 'sk-ant-...', signup: 'https://platform.claude.com/settings/keys',
          note: 'Claude models, billed per token. Anthropic warns that a key used in a browser '
              + 'is visible to the page: create one just for this, with an expiry, in a '
              + 'workspace with a spend limit.' },
        { id: 'hf', placeholder: 'hf_...', signup: 'https://huggingface.co/settings/tokens',
          note: 'Open-weight models through one token. Needs the "Inference Providers" scope.' },
        { id: 'openrouter', placeholder: 'sk-or-v1-...', signup: 'https://openrouter.ai/keys',
          note: 'One key, hundreds of models across vendors, including free ones.' },
        { id: 'ollama', placeholder: K.OLLAMA_DEFAULT, signup: 'https://ollama.com/download',
          note: 'Fully local. Enter your server URL, not a key.' },
    ];

    // `providers` mirrors each page's mountSettings() list: the ones its CSP admits.
    var CLOUD = ['gemini', 'anthropic', 'hf', 'openrouter'];
    var TOOLS = [
        { name: 'Kakashi Search', href: 'web_apps/Kakashi_Search.html', providers: CLOUD,
          blurb: 'Agentic search with a cited answer. Normal mode searches the open web; '
              + 'Academic mode searches papers. "No AI" searches without any model or key.' },
        { name: 'Orochimaru Chat', href: 'web_apps/Orochimaru_Web_Research_Assistent.html',
          providers: CLOUD.concat('ollama'),
          blurb: 'Research chat with LaTeX answers and linked references. Load PDFs to answer '
              + 'from them, strictly or with labelled background. Parsed in your browser.' },
        { name: 'AI Visualizer', href: 'web_apps/Visualize_AI_Web.html', providers: CLOUD,
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
            var plain = K.keys.plaintextProviders().indexOf(spec.id) !== -1;
            status.textContent = has
                ? (kept ? 'saved, encrypted' : plain ? 'saved UNENCRYPTED' : 'this tab only')
                : (vault.exists() && !vault.isOpen() ? 'locked' : 'not set');
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
            var owner = K.keys.belongsElsewhere(spec.id, value);
            if (owner) {
                K.ui.toast('That looks like a ' + K.providerLabel(owner) + ' key. Not saved, '
                    + 'so it is not sent to ' + K.providerLabel(spec.id) + '.', 'error');
                input.focus();
                return;
            }
            if (refuseWhileLocked()) return;
            var remember = persist.checked;
            var wasRemembered = K.keys.isPersisted(spec.id);
            var entry = {};
            entry[spec.id] = value;
            var stored = remember
                ? vaultPassword(true).then(function (pw) { return vault.store(entry, pw); })
                : wasRemembered
                    ? vaultPassword(false).then(function (pw) { return vault.discard(spec.id, pw); })
                    : Promise.resolve();

            stored.then(function () {
                K.keys.set(spec.id, value);
                clearVaultInputs();
                refreshAll();
                K.ui.toast(K.providerLabel(spec.id) + ' saved'
                    + (remember ? ', encrypted on this device.' : ' for this tab.'), 'success');
            }, vaultError);
        });

        clearBtn.addEventListener('click', function () {
            if (refuseWhileLocked()) return;
            var done = K.keys.isPersisted(spec.id)
                ? vaultPassword(false).then(function (pw) { return vault.discard(spec.id, pw); })
                : Promise.resolve();
            done.then(function () {
                K.keys.remove(spec.id);
                clearVaultInputs();
                refreshAll();
                K.ui.toast(K.providerLabel(spec.id) + ' cleared.');
            }, vaultError);
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
            }, [persist, el('span', {
                text: 'Remember on this device (encrypted with your vault password)',
            })]),
        ]);
    }

    function renderProviders() {
        var host = document.getElementById('provider-rows');
        host.parentNode.insertBefore(buildVaultPanel(), host);
        dom.replace(host, PROVIDERS.map(providerRow));
        renderVault();
    }

    function refreshAllRows() {
        rowRefs.forEach(function (fn) { fn(); });
    }

    function refreshAll() {
        refreshAllRows();
        renderVault();
        renderTools();
    }

    /* ------------------------------------------------------------------- vault */

    var vault = K.keys.vault;
    var vaultUi = {};

    /**
     * The password typed in the vault panel. Rejects with a prompt to type it
     * when empty, and checks the confirmation when this creates the vault.
     */
    function vaultPassword(creatingAllowed) {
        var pw = vaultUi.password.value;
        if (!pw) {
            vaultUi.password.focus();
            return Promise.reject(new Error('Type your vault password in the '
                + '"Saved keys" box above first.'));
        }
        if (!vault.exists()) {
            if (!creatingAllowed) return Promise.reject(new Error('No vault exists yet.'));
            if (pw !== vaultUi.confirm.value) {
                vaultUi.confirm.focus();
                return Promise.reject(new Error('The two passwords do not match.'));
            }
        }
        return Promise.resolve(pw);
    }

    /* Changing a key while the vault is locked would be undone by the saved
       copy on the next unlock, so ask for the unlock first. */
    function refuseWhileLocked() {
        if (!vault.isLocked()) return false;
        K.ui.toast('Unlock your saved keys first (box above), so this change is not '
            + 'undone by the saved copy.', 'error');
        vaultUi.password.focus();
        return true;
    }

    function vaultError(err) {
        K.ui.toast(err.message, 'error');
    }

    function clearVaultInputs() {
        vaultUi.password.value = '';
        vaultUi.confirm.value = '';
    }

    function renderVault() {
        var exists = vault.exists();
        var open = vault.isOpen();
        var plain = K.keys.plaintextProviders();
        var one = plain.length === 1;

        vaultUi.status.textContent = !exists
            ? 'No saved keys yet. Set a password the first time you tick "Remember".'
            : open
                ? 'Unlocked in this tab. Closing the tab locks it again.'
                : 'Locked. Enter your password to load your saved keys into this tab.';
        vaultUi.confirm.classList.toggle('hidden', exists);
        vaultUi.password.placeholder = exists
            ? 'Vault password'
            : 'New vault password (at least ' + vault.MIN_PASSWORD + ' characters)';
        vaultUi.unlock.classList.toggle('hidden', !exists || open);
        vaultUi.lock.classList.toggle('hidden', !exists || !open);

        vaultUi.plain.classList.toggle('hidden', !plain.length);
        vaultUi.plainText.textContent = plain.length
            ? plain.map(K.providerLabel).join(', ') + (one ? ' is' : ' are')
                + ' stored on this device UNENCRYPTED by an older version. Encrypt '
                + (one ? 'it' : 'them') + ' with your vault password, or delete '
                + (one ? 'it' : 'them') + '.'
            : '';
    }

    function buildVaultPanel() {
        function pwInput(id) {
            return el('input', { type: 'password', id: id, autocomplete: 'off',
                spellcheck: 'false' });
        }
        vaultUi.password = pwInput('vault-password');
        vaultUi.confirm = pwInput('vault-confirm');
        vaultUi.confirm.placeholder = 'Repeat the new password';
        vaultUi.status = el('p', { class: 'text-xs text-fg-secondary mb-2' });
        vaultUi.unlock = el('button', { type: 'button', class: 'btn btn-accent text-xs shrink-0',
            text: 'Unlock' });
        vaultUi.lock = el('button', { type: 'button', class: 'btn btn-secondary text-xs shrink-0',
            text: 'Lock now' });
        vaultUi.plainText = el('p', { class: 'text-xs mb-2' });
        var encryptBtn = el('button', { type: 'button', class: 'btn btn-accent text-xs',
            text: 'Encrypt them' });
        var deleteBtn = el('button', { type: 'button', class: 'btn btn-danger text-xs',
            text: 'Delete them' });
        vaultUi.plain = el('div', {
            class: 'hidden mt-3 p-3 rounded border border-danger/40 bg-danger/10 text-danger',
        }, [vaultUi.plainText, el('div', { class: 'flex gap-2' }, [encryptBtn, deleteBtn])]);

        vaultUi.unlock.addEventListener('click', function () {
            vaultPassword(false).then(vault.unlock).then(function (names) {
                clearVaultInputs();
                refreshAll();
                K.ui.toast('Unlocked ' + names.length + ' saved key'
                    + (names.length === 1 ? '' : 's') + '.', 'success');
            }, vaultError);
        });
        vaultUi.lock.addEventListener('click', function () {
            vault.lock();
            refreshAll();
            K.ui.toast('Locked. Saved keys were removed from this tab.');
        });
        vaultUi.password.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && vault.exists() && !vault.isOpen()) {
                e.preventDefault();
                vaultUi.unlock.click();
            }
        });
        encryptBtn.addEventListener('click', function () {
            var entries = {};
            K.keys.plaintextProviders().forEach(function (p) { entries[p] = K.keys.get(p); });
            vaultPassword(true).then(function (pw) { return vault.store(entries, pw); })
                .then(function () {
                    clearVaultInputs();
                    refreshAll();
                    K.ui.toast('Encrypted. No key is stored in plain text any more.', 'success');
                }, vaultError);
        });
        deleteBtn.addEventListener('click', function () {
            K.keys.plaintextProviders().forEach(K.keys.remove);
            refreshAll();
            K.ui.toast('Unencrypted keys deleted.', 'success');
        });

        return el('div', { class: 'mb-6 pb-5 border-b border-tertiary' }, [
            el('label', { class: 'block font-bold text-fg-primary mb-1', for: 'vault-password',
                text: 'Saved keys (encrypted)' }),
            vaultUi.status,
            el('div', { class: 'flex flex-wrap gap-2 items-center' }, [
                el('div', { class: 'flex-1 min-w-[200px]' }, [vaultUi.password]),
                el('div', { class: 'flex-1 min-w-[200px]' }, [vaultUi.confirm]),
                vaultUi.unlock,
                vaultUi.lock,
            ]),
            el('p', {
                class: 'text-[11px] text-fg-secondary mt-2',
                text: 'Keys you choose to remember are encrypted here with AES-256-GCM, '
                    + 'using a key derived from this password (PBKDF2, 600,000 rounds). '
                    + 'Only the encrypted copy is saved. The password is never stored and '
                    + 'never leaves this browser, and it cannot be recovered: if you '
                    + 'forget it, purge and re-enter your keys.',
            }),
            vaultUi.plain,
        ]);
    }

    /* -------------------------------------------------------------- tool cards */

    function renderTools() {
        var host = document.getElementById('tool-grid');
        dom.replace(host, TOOLS.map(function (tool) {
            // Same resolution the page itself will do. Previously an Ollama
            // default marked every tool "ready", though only Orochimaru can
            // reach Ollama.
            var ready = !!K.keys.get(K.keys.provider(tool.providers));

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
            K.keys.purge();   // includes the encrypted vault
            refreshAll();
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
