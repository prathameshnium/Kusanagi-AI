/* Kusanagi AI -- API key store.
 *
 * Threat model: this is a static site with no backend, so a key typed into it has to
 * live in the browser. There is no way to make that secret from someone who already
 * has code running on the page; what we *can* control is how long it survives and how
 * far it travels.
 *
 *   - Default is sessionStorage, so a key is gone when the tab closes. It is not
 *     readable by another tab, and it does not sit on disk waiting for the next thing
 *     that reads localStorage.
 *   - Remembering a key between sessions is opt-in, and only ever encrypted: the
 *     vault below seals keys with AES-256-GCM under a key derived from the
 *     user's password (PBKDF2-SHA-256, 600k iterations). Only the ciphertext,
 *     salt and IV are written to localStorage. The password and the derived key
 *     are never stored, and nothing in this file makes a network request.
 *   - Keys an older build remembered in plain text still work, and are flagged
 *     (plaintextProviders) so the UI can offer to encrypt them.
 *   - Nothing here logs a key. Callers must not either.
 *
 * Load before providers.js.
 */
window.Kusanagi = window.Kusanagi || {};

(function () {
    'use strict';

    var NS = 'k_';
    var PROVIDERS = ['gemini', 'anthropic', 'hf', 'openrouter', 'ollama'];

    // Two generations of key names predate this file: a global set and three
    // per-app prefixes that in practice only ever held a Gemini key.
    var LEGACY = {
        gemini: ['gemini_key', 'kks_key', 'orc_key', 'vis_key'],
        hf: ['hf_token'],
    };
    var LEGACY_PROVIDER = ['provider', 'kks_provider', 'orc_provider', 'vis_provider'];

    /* Storage can throw outright: Safari private mode, or a browser configured to
       block site data. A thrown SecurityError here would take down every page, so
       every access is guarded and a dead store just behaves as empty. */
    function safe(store) {
        return {
            get: function (k) {
                try { return store.getItem(k); } catch (e) { return null; }
            },
            set: function (k, v) {
                try { store.setItem(k, v); return true; } catch (e) { return false; }
            },
            del: function (k) {
                try { store.removeItem(k); } catch (e) { /* nothing to do */ }
            },
        };
    }

    var session = safe(window.sessionStorage);
    var local = safe(window.localStorage);

    function keyName(provider) { return NS + provider + '_key'; }

    /* Providers this app no longer supports. Their keys are still on disk for
       anyone who used an older build, and dropping them from PROVIDERS would
       orphan those secrets where nothing ever clears them again. Wipe on load,
       and again on purge. Add to this list, never remove from it. */
    var RETIRED = ['groq'];
    var RETIRED_LEGACY = ['groq_key'];

    function forgetRetired() {
        RETIRED.forEach(function (provider) {
            session.del(NS + provider + '_key');
            local.del(NS + provider + '_key');
        });
        RETIRED_LEGACY.forEach(function (name) {
            local.del(name);
            session.del(name);
        });
    }

    /* Keys written under older schemes are already on disk in plain text. They
       are never copied or rewritten -- that would put the secret on disk again.
       They are read where they lie (legacyKey) and reported by
       plaintextProviders(), so the dashboard can encrypt them into the vault or
       delete them. Only the non-secret provider choice is migrated here. */
    function legacyKey(provider) {
        var names = [keyName(provider)].concat(LEGACY[provider] || []);
        for (var i = 0; i < names.length; i++) {
            var found = local.get(names[i]);
            if (found) return found;
        }
        return '';
    }

    function dropLegacyKey(provider) {
        local.del(keyName(provider));
        (LEGACY[provider] || []).forEach(local.del);
    }

    function migrateLegacy() {
        if (local.get(NS + 'migrated')) return;

        if (!local.get(NS + 'provider')) {
            for (var j = 0; j < LEGACY_PROVIDER.length; j++) {
                var p = local.get(LEGACY_PROVIDER[j]);
                if (p) { local.set(NS + 'provider', p); break; }
            }
        }

        LEGACY_PROVIDER.forEach(local.del);
        local.set(NS + 'migrated', '1');
    }

    /* ----------------------------------------------------------------- vault */

    var VAULT = NS + 'vault';              // localStorage: the sealed blob
    var VAULT_OPEN = NS + 'vault_open';    // sessionStorage: providers unlocked here
    var VAULT_ITERATIONS = 600000;         // OWASP's current figure for PBKDF2-SHA-256
    // Short by the user's choice. A 4-character password is guessable offline by
    // anyone who copies this browser's storage; longer ones are still accepted.
    var VAULT_MIN_PASSWORD = 4;
    // Binds the ciphertext to this purpose, so it cannot be replayed as another blob.
    var VAULT_AAD = new TextEncoder().encode('kusanagi-key-vault-v1');

    function toB64(bytes) {
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    }

    function fromB64(text) {
        var s = atob(text);
        var out = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }

    function subtle() {
        // WebCrypto only exists in a secure context (https or localhost).
        if (!window.crypto || !window.crypto.subtle) {
            throw new Error('Encrypted storage needs a secure page (https or localhost).');
        }
        return window.crypto.subtle;
    }

    /** Password -> non-extractable AES-GCM key. The password goes nowhere else. */
    function deriveKey(password, salt, iterations) {
        var s = subtle();
        return s.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false,
            ['deriveKey'])
            .then(function (base) {
                return s.deriveKey(
                    { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
                    base,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt']);
            });
    }

    function readBlob() {
        try {
            var blob = JSON.parse(local.get(VAULT) || 'null');
            return blob && blob.v === 1 ? blob : null;
        } catch (e) {
            return null;
        }
    }

    /** Decrypt the vault to {provider: key}. Rejects on a wrong password. */
    function openBlob(password) {
        var blob = readBlob();
        if (!blob) return Promise.resolve({});
        // The count comes from storage. Lowering it gains an attacker nothing
        // (the derived key would not decrypt), but a huge value would hang the
        // tab, so only the range this code writes is accepted.
        if (!(blob.iter >= VAULT_ITERATIONS && blob.iter <= 5000000)) {
            return Promise.reject(new Error('The saved keys are damaged. Purge them and '
                + 'enter your keys again.'));
        }
        return Promise.resolve()
            .then(function () { return deriveKey(password, fromB64(blob.salt), blob.iter); })
            .then(function (key) {
                return subtle().decrypt(
                    { name: 'AES-GCM', iv: fromB64(blob.iv), additionalData: VAULT_AAD },
                    key, fromB64(blob.ct));
            })
            .then(function (plain) {
                return JSON.parse(new TextDecoder().decode(plain));
            }, function (err) {
                // GCM authentication failure: wrong password or a tampered blob.
                if (err && err.name === 'OperationError') {
                    throw new Error('Wrong password.');
                }
                throw err;
            });
    }

    /** Encrypt {provider: key} under a fresh salt and IV, and write it. */
    function sealBlob(password, entries) {
        var salt = crypto.getRandomValues(new Uint8Array(16));
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return Promise.resolve()
            .then(function () { return deriveKey(password, salt, VAULT_ITERATIONS); })
            .then(function (key) {
                return subtle().encrypt(
                    { name: 'AES-GCM', iv: iv, additionalData: VAULT_AAD },
                    key, new TextEncoder().encode(JSON.stringify(entries)));
            })
            .then(function (ct) {
                var ok = local.set(VAULT, JSON.stringify({
                    v: 1, kdf: 'PBKDF2-SHA256', iter: VAULT_ITERATIONS,
                    salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)),
                }));
                if (!ok) throw new Error('This browser would not save the encrypted keys.');
            });
    }

    /** Copy decrypted keys into this tab, as if typed in. */
    function loadIntoSession(entries) {
        var names = Object.keys(entries).filter(function (p) {
            return PROVIDERS.indexOf(p) !== -1 && typeof entries[p] === 'string';
        });
        names.forEach(function (p) {
            session.set(keyName(p), entries[p]);
            dropLegacyKey(p);   // any plain-text copy is now redundant
        });
        session.set(VAULT_OPEN, JSON.stringify(names));
        return names;
    }

    function openList() {
        try { return JSON.parse(session.get(VAULT_OPEN) || 'null'); } catch (e) { return null; }
    }

    var vault = {
        MIN_PASSWORD: VAULT_MIN_PASSWORD,

        /** An encrypted vault exists in this browser. */
        exists: function () { return !!readBlob(); },

        /** The vault has been unlocked in this tab. */
        isOpen: function () { return !!openList(); },

        /**
         * A vault exists but is not unlocked here. Changing a key in this state
         * is refused by the UI: the vault's copy would come back on the next
         * unlock and silently undo the change.
         */
        isLocked: function () { return !!readBlob() && !openList(); },

        /** True if `provider` is in the vault (known once unlocked). */
        contains: function (provider) {
            var list = openList();
            return !!list && list.indexOf(provider) !== -1;
        },

        /** Unlock: decrypt and load the keys into this tab. -> provider ids. */
        unlock: function (password) {
            if (!password) return Promise.reject(new Error('Enter your password.'));
            return openBlob(password).then(loadIntoSession);
        },

        /**
         * Remember keys, encrypted. `entries` is {provider: key}. Creates the
         * vault on first use, which is why the password rule is checked here.
         * Other entries already in the vault are kept.
         */
        store: function (entries, password) {
            if (!password) return Promise.reject(new Error('Enter your password.'));
            var creating = !readBlob();
            if (creating && password.length < VAULT_MIN_PASSWORD) {
                return Promise.reject(new Error('Use a password of at least '
                    + VAULT_MIN_PASSWORD + ' characters.'));
            }
            return openBlob(password).then(function (current) {
                Object.keys(entries).forEach(function (p) {
                    if (PROVIDERS.indexOf(p) !== -1 && entries[p]) current[p] = entries[p];
                });
                return sealBlob(password, current).then(function () {
                    return loadIntoSession(current);
                });
            });
        },

        /** Remove one provider's key from the vault (and this tab). */
        discard: function (provider, password) {
            if (!password) return Promise.reject(new Error('Enter your password.'));
            return openBlob(password).then(function (current) {
                delete current[provider];
                session.del(keyName(provider));
                var done = Object.keys(current).length
                    ? sealBlob(password, current)
                    : Promise.resolve(local.del(VAULT));
                return done.then(function () { return loadIntoSession(current); });
            });
        },

        /** Lock: drop the decrypted copies from this tab. The vault stays. */
        lock: function () {
            (openList() || []).forEach(function (p) { session.del(keyName(p)); });
            session.del(VAULT_OPEN);
        },

        /** Delete the vault outright. */
        destroy: function () {
            this.lock();
            local.del(VAULT);
        },
    };

    /* Published key prefixes. Used only to catch a key pasted under the wrong
       provider, which would otherwise be sent to a company that never issued it. */
    var KEY_PREFIXES = {
        gemini: 'AIza',
        anthropic: 'sk-ant-',
        hf: 'hf_',
        openrouter: 'sk-or-',
    };

    var keys = {
        providers: PROVIDERS.slice(),

        /**
         * If `value` carries another provider's key prefix, return that
         * provider's id; otherwise ''. Callers refuse to save on a match.
         */
        belongsElsewhere: function (provider, value) {
            var v = String(value || '');
            var others = Object.keys(KEY_PREFIXES);
            for (var i = 0; i < others.length; i++) {
                if (others[i] !== provider && v.indexOf(KEY_PREFIXES[others[i]]) === 0) {
                    return others[i];
                }
            }
            return '';
        },

        /** Current key for a provider, or '' if none. Session wins over persisted. */
        get: function (provider) {
            return session.get(keyName(provider)) || legacyKey(provider) || '';
        },

        /**
         * Hold a key for this tab only. Never writes plain text to disk; to
         * remember a key, use vault.store().
         * Passing an empty value clears the key from this tab.
         */
        set: function (provider, value) {
            var name = keyName(provider);
            if (!value) { session.del(name); return; }
            session.set(name, value);
            // A plain-text copy left by an older build is superseded; drop it.
            dropLegacyKey(provider);
        },

        /** Forget a key in this tab, and any plain-text copy on disk. The
            encrypted vault copy needs the password: vault.discard(). */
        remove: function (provider) {
            session.del(keyName(provider));
            dropLegacyKey(provider);
        },

        /** True if this provider's key is remembered, encrypted, in the vault.
            Known only once the vault has been unlocked in this tab. */
        isPersisted: function (provider) {
            return vault.contains(provider);
        },

        /** Providers whose key an older build left on disk unencrypted. */
        plaintextProviders: function () {
            return PROVIDERS.filter(function (p) { return !!legacyKey(p); });
        },

        /**
         * Selected provider. Not a secret, so it persists.
         *
         * Pass `allowed` (the providers a page can actually reach) and a
         * selection outside it resolves to the first allowed provider that has a
         * key, else the first allowed one. Without this, picking Ollama on the
         * dashboard sent every Ollama-less page to a provider its CSP blocks.
         */
        provider: function (allowed) {
            var p = local.get(NS + 'provider') || 'gemini';
            if (PROVIDERS.indexOf(p) === -1) p = 'gemini';
            if (!allowed || !allowed.length || allowed.indexOf(p) !== -1) return p;
            for (var i = 0; i < allowed.length; i++) {
                if (this.get(allowed[i])) return allowed[i];
            }
            return allowed[0];
        },

        setProvider: function (p) {
            if (PROVIDERS.indexOf(p) !== -1) local.set(NS + 'provider', p);
        },

        /** Wipe every key from both stores, plus the migration marker. */
        purge: function () {
            PROVIDERS.forEach(function (p) {
                session.del(keyName(p));
                local.del(keyName(p));
            });
            local.del(NS + 'provider');
            local.del(NS + 'migrated');
            vault.destroy();
            forgetRetired();
            Object.keys(LEGACY).forEach(function (provider) {
                LEGACY[provider].forEach(local.del);
            });
            LEGACY_PROVIDER.forEach(local.del);
        },
    };

    /* Non-secret settings. Kept beside the key store because this is the module
       that owns storage access and its try/catch guards, but deliberately a
       separate object so nothing confuses a preference with a credential. */
    var prefs = {
        /** Try the provider's other models when one fails. Default on. */
        modelFallback: function () {
            return local.get(NS + 'model_fallback') !== '0';
        },

        setModelFallback: function (enabled) {
            local.set(NS + 'model_fallback', enabled ? '1' : '0');
        },

        /** A short tune when an answer finishes. Default on. */
        chime: function () {
            return local.get(NS + 'chime') !== '0';
        },

        setChime: function (enabled) {
            local.set(NS + 'chime', enabled ? '1' : '0');
        },

        /** Read-aloud voices: 'local' (on this device) or 'web' (the browser's
            online voices, which send the text to its vendor). Default local. */
        voiceSource: function () {
            return local.get(NS + 'voice_source') === 'web' ? 'web' : 'local';
        },

        setVoiceSource: function (source) {
            local.set(NS + 'voice_source', source === 'web' ? 'web' : 'local');
        },

        /** The chosen voice's name for a source, or '' for that source's default. */
        voiceName: function (source) {
            return local.get(NS + 'voice_' + source) || '';
        },

        setVoiceName: function (source, name) {
            if (name) local.set(NS + 'voice_' + source, name);
            else local.del(NS + 'voice_' + source);
        },

        /** One Claude request option (see CLAUDE_OPTIONS), or its default. */
        claude: function (name) {
            var spec = CLAUDE_OPTIONS[name];
            if (!spec) return undefined;
            var raw = local.get(NS + 'claude_' + name);
            if (raw === null) return spec.default;
            if (typeof spec.default === 'boolean') return raw === '1';
            return spec.values.indexOf(raw) !== -1 ? raw : spec.default;
        },

        setClaude: function (name, value) {
            var spec = CLAUDE_OPTIONS[name];
            if (!spec) return;
            if (typeof spec.default === 'boolean') {
                local.set(NS + 'claude_' + name, value ? '1' : '0');
            } else if (spec.values.indexOf(value) !== -1 && value !== spec.default) {
                local.set(NS + 'claude_' + name, value);
            } else {
                local.del(NS + 'claude_' + name);
            }
        },
    };

    /* Optional Claude request settings, remembered in this browser. '' on a
       choice means "send nothing, keep the API's default". */
    var CLAUDE_OPTIONS = {
        effort: { default: '', values: ['', 'low', 'medium', 'high', 'xhigh', 'max'] },
        maxTokens: { default: '16000', values: ['4096', '16000', '32000'] },
        reasoning: { default: false },  // summarised thinking, shown above the answer
        cache: { default: false },      // prompt caching: cheaper repeated context
        usOnly: { default: false },     // inference_geo: "us"
        fast: { default: false },       // Opus 5.5 fast mode, at twice the price
        webSearch: { default: false },  // Claude searches the web itself
        webFetch: { default: false },   // Claude reads pages linked in the chat
        webLimit: { default: '', values: ['', '5', '10', '25'] },  // '' = no cap
    };
    prefs.CLAUDE_OPTIONS = CLAUDE_OPTIONS;

    migrateLegacy();
    forgetRetired();
    keys.vault = vault;
    window.Kusanagi.keys = keys;
    window.Kusanagi.prefs = prefs;
})();
