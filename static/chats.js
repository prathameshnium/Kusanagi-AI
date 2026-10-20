/* Kusanagi AI -- chats saved as Markdown files in a folder the user picks.
 *
 * Off until the user chooses a folder. Uses the File System Access API, which
 * Chrome and Edge have and Firefox and Safari do not; `supported` says which.
 * The folder handle (not its contents) is remembered in IndexedDB so the user
 * does not pick it every visit, but the browser still asks for permission
 * again in each new session, and only in response to a click.
 *
 * The files are the user's own: plain Markdown they can open anywhere. Nothing
 * here makes a network request.
 */
window.Kusanagi = window.Kusanagi || {};

(function () {
    'use strict';

    var DB = 'kusanagi';
    var STORE = 'handles';
    var KEY = 'chat-folder';

    var folder = null;     // FileSystemDirectoryHandle, once chosen or restored

    /* -------------------------------------------- remembering the folder */

    function db() {
        return new Promise(function (resolve, reject) {
            var req = window.indexedDB.open(DB, 1);
            req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function idb(mode, work) {
        return db().then(function (conn) {
            return new Promise(function (resolve, reject) {
                var tx = conn.transaction(STORE, mode);
                var req = work(tx.objectStore(STORE));
                tx.oncomplete = function () { conn.close(); resolve(req && req.result); };
                tx.onerror = function () { conn.close(); reject(tx.error); };
                tx.onabort = function () { conn.close(); reject(tx.error || new Error('Aborted.')); };
            });
        });
    }

    /* ------------------------------------------------------------- files */

    function granted(handle, ask) {
        var opts = { mode: 'readwrite' };
        return handle.queryPermission(opts).then(function (state) {
            if (state === 'granted' || !ask) return state === 'granted';
            return handle.requestPermission(opts).then(function (s) { return s === 'granted'; });
        });
    }

    /** The folder, as a promise, so callers get one way to see failure. */
    function need() {
        return folder ? Promise.resolve(folder)
            : Promise.reject(new Error('No chat folder chosen.'));
    }

    window.Kusanagi.chats = {
        supported: typeof window.showDirectoryPicker === 'function',

        /** The chosen folder's name, or '' when none. */
        folderName: function () { return folder ? folder.name : ''; },

        /** Let the user pick a folder (must run from a click). -> its name */
        pick: function () {
            return window.showDirectoryPicker({
                id: 'kusanagi-chats', mode: 'readwrite', startIn: 'documents',
            }).then(function (handle) {
                folder = handle;
                return idb('readwrite', function (s) { return s.put(handle, KEY); })
                    .then(function () { return handle.name; });
            });
        },

        /** The folder remembered from an earlier visit. -> {name, ready} or null.
            `ready` is false until reconnect() is clicked in this session. */
        restore: function () {
            if (!this.supported || !window.indexedDB) return Promise.resolve(null);
            return idb('readonly', function (s) { return s.get(KEY); }).then(function (handle) {
                if (!handle) return null;
                folder = handle;
                return granted(handle, false).then(function (ok) {
                    return { name: handle.name, ready: ok };
                });
            }).catch(function () { return null; });
        },

        /** Ask for access again (must run from a click). -> true if allowed */
        reconnect: function () {
            return need().then(function (dir) { return granted(dir, true); });
        },

        /** Stop saving: forget the folder. The files in it stay. */
        forget: function () {
            folder = null;
            return idb('readwrite', function (s) { return s.delete(KEY); }).catch(function () {});
        },

        /** Markdown files in the folder, newest first: [{name, modified}]. */
        list: function (filter) {
            return need().then(function (dir) { return listIn(dir, filter); });
        },

        /** True if `name` already exists in the folder. */
        has: function (name) {
            return need().then(function (dir) { return dir.getFileHandle(name); })
                .then(function () { return true; }, function (err) {
                    if (err && err.name === 'NotFoundError') return false;
                    throw err;
                });
        },

        read: function (name) {
            return need().then(function (dir) { return dir.getFileHandle(name); })
                .then(function (h) { return h.getFile(); })
                .then(function (f) { return f.text(); });
        },

        write: function (name, text) {
            return need().then(function (dir) {
                return dir.getFileHandle(name, { create: true });
            }).then(function (h) {
                return h.createWritable();
            }).then(function (w) {
                return w.write(text).then(function () { return w.close(); });
            });
        },

        remove: function (name) {
            return need().then(function (dir) { return dir.removeEntry(name); });
        },
    };

    /** Markdown files in `dir`, newest first: [{name, modified, head}]. */
    function listIn(dir, filter) {
        var out = [];
        var iter = dir.values();
        function next() {
            return iter.next().then(function (step) {
                if (step.done) return out;
                var h = step.value;
                if (h.kind !== 'file' || !/\.md$/i.test(h.name) || (filter && !filter(h.name))) {
                    return next();
                }
                return h.getFile().then(function (f) {
                    // The first line holds the chat's category, if it has one.
                    return f.slice(0, 300).text().then(function (head) {
                        out.push({ name: h.name, modified: f.lastModified, head: head });
                        return next();
                    });
                });
            });
        }
        return next().then(function (list) {
            return list.sort(function (a, b) { return b.modified - a.modified; });
        });
    }
})();
