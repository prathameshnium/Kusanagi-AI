/* Dashboard: add a key, then open a tool.
 * The one place that knows about every provider and every app.
 *
 * Layout: one provider at a time (tabs + a single form), the encrypted vault
 * surfaced only when it matters (locked, or a key is being remembered), and
 * a short list of tools that says whether each one is ready.
 */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    var PROVIDERS = [
        { id: 'gemini', placeholder: 'AIza...', signup: 'https://aistudio.google.com/app/apikey',
          note: 'Free tier. A good default.' },
        { id: 'anthropic', placeholder: 'sk-ant-...', signup: 'https://platform.claude.com/settings/keys',
          note: 'Claude, billed per token. Use a dedicated key with an expiry and a spend limit.' },
        { id: 'hf', placeholder: 'hf_...', signup: 'https://huggingface.co/settings/tokens',
          note: 'Open-weight models. Needs the "Inference Providers" scope.' },
        { id: 'openrouter', placeholder: 'sk-or-v1-...', signup: 'https://openrouter.ai/keys',
          note: 'One key for hundreds of models, some free.' },
        { id: 'ollama', placeholder: K.OLLAMA_DEFAULT, signup: 'https://ollama.com/download',
          note: 'Runs on your machine. Enter the server address, not a key. Orochimaru only.' },
    ];

    // `providers` mirrors each page's mountSettings() list: the ones its CSP admits.
    var CLOUD = ['gemini', 'anthropic', 'hf', 'openrouter'];
    var TOOLS = [
        { name: 'Kakashi Search', href: 'web_apps/Kakashi_Search.html', providers: CLOUD,
          line: 'Search the web or the literature and get a cited answer.',
          worksWithoutKey: 'No-AI mode only' },
        { name: 'Orochimaru Chat', href: 'web_apps/Orochimaru_Web_Research_Assistent.html',
          providers: CLOUD.concat('ollama'),
          line: 'Chat, or ask questions about your own documents.' },
        { name: 'AI Visualizer', href: 'web_apps/Visualize_AI_Web.html', providers: CLOUD,
          line: 'See which word a model would write next, and how sure it is.' },
    ];

    var vault = K.keys.vault;
    var selected = null;          // provider id shown in the form
    var ui = {};

    function spec(id) {
        for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
        return PROVIDERS[0];
    }

    function toastError(err) { K.ui.toast(err.message, 'error'); }

    function pwInput(id, placeholder) {
        return el('input', { type: 'password', id: id, placeholder: placeholder,
            autocomplete: 'off', spellcheck: 'false' });
    }

    function refreshAll() {
        renderVaultBar();
        renderTabs();
        renderForm();
        renderTools();
    }

    /* --------------------------------------------------------------- vault bar */

    /* Changing a key while the vault is locked would be undone by the saved
       copy on the next unlock, so ask for the unlock first. */
    function refuseWhileLocked() {
        if (!vault.isLocked()) return false;
        K.ui.toast('Unlock your saved keys first, so this change is not undone by the '
            + 'saved copy.', 'error');
        if (ui.unlockPassword) ui.unlockPassword.focus();
        return true;
    }

    function renderVaultBar() {
        var parts = [];

        if (vault.isLocked()) {
            ui.unlockPassword = pwInput('unlock-password', 'Password');
            var unlock = el('button', { type: 'button', class: 'btn btn-accent text-xs shrink-0',
                text: 'Unlock' });
            var doUnlock = function () {
                vault.unlock(ui.unlockPassword.value).then(function (names) {
                    refreshAll();
                    K.ui.toast('Unlocked ' + names.length + ' saved key'
                        + (names.length === 1 ? '' : 's') + '.', 'success');
                }, function (err) { toastError(err); ui.unlockPassword.select(); });
            };
            unlock.addEventListener('click', doUnlock);
            ui.unlockPassword.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); doUnlock(); }
            });
            parts.push(el('div', { class: 'mb-5 p-3 rounded-lg border border-accent/40 bg-accent/10' }, [
                el('label', { class: 'block text-sm mb-2', for: 'unlock-password',
                    text: 'Your saved keys are locked.' }),
                el('div', { class: 'flex gap-2' }, [
                    el('div', { class: 'flex-1' }, [ui.unlockPassword]), unlock,
                ]),
            ]));
        } else if (vault.isOpen()) {
            var lock = el('button', { type: 'button', class: 'text-accent hover:underline',
                text: 'Lock' });
            lock.addEventListener('click', function () {
                vault.lock();
                refreshAll();
                K.ui.toast('Locked. Saved keys were removed from this tab.');
            });
            parts.push(el('p', { class: 'text-xs text-fg-secondary mb-4' },
                ['Saved keys are unlocked in this tab. ', lock]));
        }

        var plain = K.keys.plaintextProviders();
        if (plain.length) parts.push(plaintextWarning(plain));

        dom.replace(ui.vaultBar, parts);
    }

    /** Keys an older version left on disk unencrypted: encrypt or delete. */
    function plaintextWarning(plain) {
        var creating = !vault.exists();
        var pw = pwInput('plain-password', creating
            ? 'New password (' + vault.MIN_PASSWORD + '+ characters, '
                + vault.RECOMMENDED_PASSWORD + '+ recommended)' : 'Password');
        var confirm = pwInput('plain-confirm', 'Repeat password');
        var encrypt = el('button', { type: 'button', class: 'btn btn-accent text-xs',
            text: 'Encrypt' });
        var remove = el('button', { type: 'button', class: 'btn btn-danger text-xs',
            text: 'Delete' });

        encrypt.addEventListener('click', function () {
            // A locked vault is fine here: store() checks the password against it.
            if (creating && pw.value !== confirm.value) {
                K.ui.toast('The two passwords do not match.', 'error');
                return;
            }
            var entries = {};
            K.keys.plaintextProviders().forEach(function (p) { entries[p] = K.keys.get(p); });
            vault.store(entries, pw.value).then(function () {
                refreshAll();
                K.ui.toast('Encrypted. No key is stored in plain text any more.', 'success');
            }, toastError);
        });
        remove.addEventListener('click', function () {
            K.keys.plaintextProviders().forEach(K.keys.remove);
            refreshAll();
            K.ui.toast('Unencrypted keys deleted.', 'success');
        });

        return el('div', { class: 'mb-5 p-3 rounded-lg border border-danger/40 bg-danger/10 text-sm' }, [
            el('p', { class: 'text-danger mb-2', text: plain.map(K.providerLabel).join(', ')
                + ' saved without encryption by an older version.' }),
            el('div', { class: 'flex flex-wrap gap-2' }, [
                el('div', { class: 'flex-1 min-w-[160px]' }, [pw]),
                creating ? el('div', { class: 'flex-1 min-w-[160px]' }, [confirm]) : null,
                encrypt, remove,
            ]),
        ]);
    }

    /* -------------------------------------------------------------------- tabs */

    function renderTabs() {
        var active = K.keys.provider();
        dom.replace(ui.tabs, PROVIDERS.map(function (p) {
            var has = !!K.keys.get(p.id);
            var isSelected = p.id === selected;
            var tab = el('button', {
                type: 'button',
                role: 'tab',
                'aria-selected': String(isSelected),
                class: 'flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition '
                    + (isSelected
                        ? 'border-accent text-fg-primary bg-accent/10'
                        : 'border-tertiary text-fg-secondary hover:text-fg-primary'),
            }, [
                el('span', {
                    class: 'w-2 h-2 rounded-full ' + (has ? 'bg-success' : 'bg-tertiary'),
                    'aria-hidden': 'true',
                }),
                K.providerLabel(p.id).replace(' (Claude)', '').replace(' (local)', ''),
                p.id === active && has
                    ? el('span', { class: 'text-[10px] text-accent', text: 'in use' })
                    : null,
            ]);
            tab.setAttribute('aria-label', K.providerLabel(p.id)
                + (has ? ', key set' : ', no key') + (p.id === active && has ? ', in use' : ''));
            tab.addEventListener('click', function () { selected = p.id; renderTabs(); renderForm(); });
            return tab;
        }));
    }

    /* -------------------------------------------------------------------- form */

    function renderForm() {
        var p = spec(selected);
        var isOllama = p.id === 'ollama';
        var has = !!K.keys.get(p.id);
        var remembered = K.keys.isPersisted(p.id);
        var inUse = K.keys.provider() === p.id;

        var input = el('input', {
            type: isOllama ? 'text' : 'password',
            id: 'key-input',
            autocomplete: 'off',
            spellcheck: 'false',
            // Never refill the field with the secret; show that one exists instead.
            placeholder: has ? '•'.repeat(12) + '  saved' : p.placeholder,
            'aria-label': K.providerLabel(p.id) + (isOllama ? ' server address' : ' key'),
        });
        var save = el('button', { type: 'button', class: 'btn btn-accent shrink-0', text: 'Save' });

        var remember = el('input', { type: 'checkbox', id: 'remember' });
        remember.checked = remembered;
        var creating = !vault.exists();
        var password = pwInput('vault-password', creating
            ? 'New password (' + vault.MIN_PASSWORD + '+ characters, '
                + vault.RECOMMENDED_PASSWORD + '+ recommended)' : 'Your vault password');
        var confirm = pwInput('vault-confirm', 'Repeat password');
        var pwRow = el('div', { class: 'flex flex-wrap gap-2 mt-2' }, [
            el('div', { class: 'flex-1 min-w-[180px]' }, [password]),
            creating ? el('div', { class: 'flex-1 min-w-[180px]' }, [confirm]) : null,
        ]);
        var pwHint = el('p', { class: 'text-[11px] text-fg-secondary mt-1',
            text: 'Encrypted here with your password (AES-256-GCM). The password is never '
                + 'stored or sent, and cannot be recovered.' });
        var pwBox = el('div', {}, [pwRow, pwHint]);

        // A password is needed to remember a key, or to change one already remembered.
        function showPassword() {
            pwBox.classList.toggle('hidden', !(remember.checked || remembered));
        }
        remember.addEventListener('change', showPassword);

        function password_() {
            if (!password.value) {
                password.focus();
                return Promise.reject(new Error('Enter your vault password.'));
            }
            if (!vault.exists() && password.value !== confirm.value) {
                confirm.focus();
                return Promise.reject(new Error('The two passwords do not match.'));
            }
            return Promise.resolve(password.value);
        }

        save.addEventListener('click', function () {
            var value = input.value.trim();
            if (!value && isOllama) value = K.OLLAMA_DEFAULT;
            if (!value) {
                K.ui.toast('Paste a key first.', 'error');
                input.focus();
                return;
            }
            var owner = K.keys.belongsElsewhere(p.id, value);
            if (owner) {
                K.ui.toast('That looks like a ' + K.providerLabel(owner) + ' key. Not saved, '
                    + 'so it is not sent to ' + K.providerLabel(p.id) + '.', 'error');
                input.focus();
                return;
            }
            if (refuseWhileLocked()) return;
            var entry = {};
            entry[p.id] = value;
            var stored = remember.checked
                ? password_().then(function (pw) { return vault.store(entry, pw); })
                : remembered
                    ? password_().then(function (pw) { return vault.discard(p.id, pw); })
                    : Promise.resolve();

            stored.then(function () {
                K.keys.set(p.id, value);
                // Saving a key makes it the one the tools use.
                K.keys.setProvider(p.id);
                refreshAll();
                K.ui.toast(K.providerLabel(p.id) + ' saved'
                    + (remember.checked ? ', encrypted on this device.' : ' for this tab.'),
                    'success');
            }, toastError);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); save.click(); }
        });

        var actions = [];
        if (has && !inUse) {
            var use = el('button', { type: 'button', class: 'text-accent hover:underline',
                text: 'Use in tools' });
            use.addEventListener('click', function () {
                K.keys.setProvider(p.id);
                refreshAll();
                K.ui.toast('Tools will use ' + K.providerLabel(p.id) + '.');
            });
            actions.push(use);
        }
        if (has) {
            var clear = el('button', { type: 'button', class: 'text-fg-secondary hover:text-danger',
                text: 'Remove key' });
            clear.addEventListener('click', function () {
                if (refuseWhileLocked()) return;
                var done = remembered
                    ? password_().then(function (pw) { return vault.discard(p.id, pw); })
                    : Promise.resolve();
                done.then(function () {
                    K.keys.remove(p.id);
                    refreshAll();
                    K.ui.toast(K.providerLabel(p.id) + ' removed.');
                }, toastError);
            });
            actions.push(clear);
        }

        dom.replace(ui.form, el('div', { role: 'tabpanel' }, [
            el('div', { class: 'flex gap-2' }, [el('div', { class: 'flex-1' }, [input]), save]),
            el('p', { class: 'text-xs text-fg-secondary mt-2' }, [
                p.note + ' ',
                dom.link(p.signup, isOllama ? 'Download' : 'Get a key',
                    'text-accent hover:underline'),
            ]),
            isOllama ? null : el('label', {
                class: 'flex items-center gap-2 text-sm mt-4 cursor-pointer w-fit',
                for: 'remember',
            }, [remember, 'Remember on this device (encrypted)']),
            isOllama ? null : pwBox,
            actions.length
                ? el('div', { class: 'flex gap-4 text-xs mt-4' }, actions)
                : null,
        ]));
        showPassword();
    }

    /* ------------------------------------------------------------------- tools */

    function renderTools() {
        dom.replace(ui.tools, TOOLS.map(function (tool) {
            // Same resolution the page itself does.
            var provider = K.keys.provider(tool.providers);
            var ready = !!K.keys.get(provider);
            var status = ready
                ? 'Ready · ' + K.providerLabel(provider).replace(' (Claude)', '')
                : (tool.worksWithoutKey || 'Needs a key');

            return el('a', {
                href: tool.href,
                class: 'flex items-center justify-between gap-4 py-4 group',
            }, [
                el('div', { class: 'min-w-0' }, [
                    el('div', { class: 'font-bold text-fg-primary group-hover:text-accent transition',
                        text: tool.name }),
                    el('div', { class: 'text-sm text-fg-secondary', text: tool.line }),
                ]),
                el('div', { class: 'flex items-center gap-3 shrink-0' }, [
                    el('span', {
                        class: 'text-xs ' + (ready ? 'text-success' : 'text-fg-secondary'),
                        text: status,
                    }),
                    el('span', { class: 'text-accent text-lg group-hover:translate-x-1 transition',
                        text: '→', 'aria-hidden': 'true' }),
                ]),
            ]);
        }));
    }

    /* -------------------------------------------------------------------- init */

    function init() {
        ui = {
            vaultBar: document.getElementById('vault-bar'),
            tabs: document.getElementById('provider-tabs'),
            form: document.getElementById('provider-form'),
            tools: document.getElementById('tool-list'),
        };

        selected = K.keys.provider();
        refreshAll();

        document.getElementById('purge-keys').addEventListener('click', function () {
            if (!window.confirm('Forget every saved API key in this browser? This cannot be undone.')) {
                return;
            }
            K.keys.purge();   // includes the encrypted vault
            selected = K.keys.provider();
            refreshAll();
            K.ui.toast('All keys forgotten.', 'success');
        });

        K.ui.bindCopy(document.getElementById('copy-install'), function () {
            return document.getElementById('install-cmd').textContent;
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
