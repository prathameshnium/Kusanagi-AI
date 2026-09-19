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
 *   - Persisting to localStorage is opt-in per provider, and the settings UI shows
 *     which providers are being remembered.
 *   - Nothing here logs a key. Callers must not either.
 *
 * Load before providers.js.
 */
window.Kusanagi = window.Kusanagi || {};

(function () {
    'use strict';

    var NS = 'k_';
    var PROVIDERS = ['gemini', 'hf', 'openrouter', 'ollama'];

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

    /* Keys written under the old scheme are already on disk. Silently dropping them
       would look like the app forgetting the user's key, so they are imported as
       "remembered" -- which is the behaviour those users already had -- and the old
       names are cleared. The settings dialog then shows the box ticked, so it is
       visible and can be turned off. */
    function migrateLegacy() {
        if (local.get(NS + 'migrated')) return;

        Object.keys(LEGACY).forEach(function (provider) {
            if (local.get(keyName(provider))) return;
            for (var i = 0; i < LEGACY[provider].length; i++) {
                var found = local.get(LEGACY[provider][i]);
                if (found) { local.set(keyName(provider), found); break; }
            }
        });

        if (!local.get(NS + 'provider')) {
            for (var j = 0; j < LEGACY_PROVIDER.length; j++) {
                var p = local.get(LEGACY_PROVIDER[j]);
                if (p) { local.set(NS + 'provider', p); break; }
            }
        }

        Object.keys(LEGACY).forEach(function (provider) {
            LEGACY[provider].forEach(local.del);
        });
        LEGACY_PROVIDER.forEach(local.del);
        local.set(NS + 'migrated', '1');
    }

    var keys = {
        providers: PROVIDERS.slice(),

        /** Current key for a provider, or '' if none. Session wins over persisted. */
        get: function (provider) {
            return session.get(keyName(provider)) || local.get(keyName(provider)) || '';
        },

        /**
         * Store a key. Session-only unless persist is true.
         * Passing an empty value clears the key from both stores.
         */
        set: function (provider, value, persist) {
            var name = keyName(provider);
            if (!value) { this.remove(provider); return; }
            session.set(name, value);
            if (persist) local.set(name, value);
            else local.del(name);
        },

        remove: function (provider) {
            session.del(keyName(provider));
            local.del(keyName(provider));
        },

        /** True if this provider's key is being kept on disk between sessions. */
        isPersisted: function (provider) {
            return !!local.get(keyName(provider));
        },

        /** Selected provider. Not a secret, so it persists. */
        provider: function () {
            var p = local.get(NS + 'provider') || 'gemini';
            return PROVIDERS.indexOf(p) === -1 ? 'gemini' : p;
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
            forgetRetired();
            Object.keys(LEGACY).forEach(function (provider) {
                LEGACY[provider].forEach(local.del);
            });
            LEGACY_PROVIDER.forEach(local.del);
        },
    };

    migrateLegacy();
    forgetRetired();
    window.Kusanagi.keys = keys;
})();
