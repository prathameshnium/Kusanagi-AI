// Shared settings modal (provider + API key config) for all Kusanagi AI web apps.
// Requires providers.js (Kusanagi.keys) to be loaded first.
window.Kusanagi = window.Kusanagi || {};

(function () {
    const PROVIDER_LABELS = {
        gemini: 'Google Gemini (Recommended)',
        groq: 'Groq (Fastest)',
        hf: 'Hugging Face',
        ollama: 'Ollama (Local)',
    };

    function mountSettings({ providers = ['gemini', 'groq', 'hf'], title = 'System Config', onSave } = {}) {
        if (window.Kusanagi._settingsApi) return window.Kusanagi._settingsApi;

        const hasOllama = providers.includes('ollama');
        const optionsHtml = providers
            .map((p) => `<option value="${p}">${PROVIDER_LABELS[p] || p}</option>`)
            .join('');

        const modal = document.createElement('div');
        modal.id = 'settings-modal';
        modal.className = 'hidden fixed inset-0 settings-modal z-[100] flex items-center justify-center backdrop-blur-sm';
        modal.innerHTML = `
            <div class="settings-modal-content p-6 rounded-lg shadow-2xl max-w-md w-full border">
                <div class="flex justify-between items-start mb-4">
                    <h2 class="text-xl font-bold text-accent">${title}</h2>
                    <button data-action="close" class="text-fg-secondary hover:text-fg-primary transition">&#10005;</button>
                </div>
                <div class="bg-success/10 border border-success/30 p-3 rounded mb-5 text-xs text-success">
                    <strong>Privacy:</strong> Keys are stored locally in your browser and sent directly to the chosen provider.
                </div>
                <div class="mb-4">
                    <label class="block text-xs font-bold text-fg-secondary uppercase tracking-wide mb-2">AI Provider</label>
                    <select id="settings-provider-select">${optionsHtml}</select>
                </div>
                <div class="mb-2">
                    <label class="block text-xs font-bold text-fg-secondary uppercase tracking-wide mb-2">API Key</label>
                    <input type="password" id="settings-key-input" autocomplete="off" placeholder="Enter secret key...">
                    ${hasOllama ? '<p id="settings-ollama-hint" class="hidden text-[10px] text-fg-secondary mt-1">Default: http://localhost:11434 (leave empty to use default)</p>' : ''}
                </div>
                <div class="flex justify-between items-center mt-6 pt-4 border-t border-tertiary">
                    <button data-action="purge" class="btn btn-danger text-xs">Purge All Keys</button>
                    <div class="flex gap-2">
                        <button data-action="close" class="btn btn-secondary">Cancel</button>
                        <button data-action="save" class="btn btn-accent">Save</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const providerSelect = modal.querySelector('#settings-provider-select');
        const keyInput = modal.querySelector('#settings-key-input');
        const ollamaHint = modal.querySelector('#settings-ollama-hint');

        function refreshKeyInput() {
            const provider = providerSelect.value;
            keyInput.value = Kusanagi.keys.get(provider);
            if (hasOllama) {
                const isOllama = provider === 'ollama';
                keyInput.placeholder = isOllama ? 'http://localhost:11434' : 'Enter secret key...';
                ollamaHint.classList.toggle('hidden', !isOllama);
            }
        }

        function open() {
            providerSelect.value = Kusanagi.keys.provider();
            refreshKeyInput();
            modal.classList.remove('hidden');
        }

        function close() {
            modal.classList.add('hidden');
        }

        providerSelect.addEventListener('change', refreshKeyInput);
        modal.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (!action) return;
            if (action === 'close') close();
            if (action === 'save') {
                const provider = providerSelect.value;
                let key = keyInput.value.trim();
                if (provider === 'ollama' && !key) key = 'http://localhost:11434';
                if (!key) { alert('API Key cannot be empty'); return; }
                Kusanagi.keys.setProvider(provider);
                Kusanagi.keys.set(provider, key);
                close();
                if (onSave) onSave(provider, key);
            }
            if (action === 'purge') {
                Kusanagi.purgeAll();
            }
        });

        const api = { open, close, refresh: refreshKeyInput };
        window.Kusanagi._settingsApi = api;
        return api;
    }

    function purgeAll() {
        if (confirm('Wipe all saved API keys and local data? This cannot be undone.')) {
            Kusanagi.keys.purge();
            location.reload();
        }
    }

    Object.assign(window.Kusanagi, { mountSettings, purgeAll });
})();
