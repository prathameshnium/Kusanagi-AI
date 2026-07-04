// Shared AI-provider layer + API-key store for all Kusanagi AI web apps.
window.Kusanagi = window.Kusanagi || {};

(function () {
    const KEY_NS = 'k_';
    const LEGACY_KEYS = [
        'gemini_key', 'groq_key', 'hf_token', 'provider',
        'kks_key', 'kks_provider', 'orc_key', 'orc_provider', 'vis_key', 'vis_provider',
    ];

    // The old scheme was split across a global set (gemini_key/groq_key/hf_token/provider)
    // and three per-app prefixes (kks_/orc_/vis_) that only ever held a Gemini key in practice.
    // Migrate once into a single k_<provider>_key / k_provider namespace so every app agrees.
    function migrateLegacy() {
        if (localStorage.getItem(KEY_NS + 'migrated')) return;

        const provider = localStorage.getItem('provider') || localStorage.getItem('kks_provider') ||
            localStorage.getItem('orc_provider') || localStorage.getItem('vis_provider');
        if (provider && !localStorage.getItem(KEY_NS + 'provider')) {
            localStorage.setItem(KEY_NS + 'provider', provider);
        }

        const geminiKey = localStorage.getItem('gemini_key') || localStorage.getItem('kks_key') ||
            localStorage.getItem('orc_key') || localStorage.getItem('vis_key');
        if (geminiKey && !localStorage.getItem(KEY_NS + 'gemini_key')) {
            localStorage.setItem(KEY_NS + 'gemini_key', geminiKey);
        }

        const groqKey = localStorage.getItem('groq_key');
        if (groqKey && !localStorage.getItem(KEY_NS + 'groq_key')) {
            localStorage.setItem(KEY_NS + 'groq_key', groqKey);
        }

        const hfToken = localStorage.getItem('hf_token');
        if (hfToken && !localStorage.getItem(KEY_NS + 'hf_key')) {
            localStorage.setItem(KEY_NS + 'hf_key', hfToken);
        }

        localStorage.setItem(KEY_NS + 'migrated', '1');
    }

    const keys = {
        get(provider) { return localStorage.getItem(KEY_NS + provider + '_key') || ''; },
        set(provider, value) { localStorage.setItem(KEY_NS + provider + '_key', value); },
        provider() { return localStorage.getItem(KEY_NS + 'provider') || 'gemini'; },
        setProvider(p) { localStorage.setItem(KEY_NS + 'provider', p); },
        purge() {
            ['gemini', 'groq', 'hf', 'ollama'].forEach((p) => localStorage.removeItem(KEY_NS + p + '_key'));
            localStorage.removeItem(KEY_NS + 'provider');
            LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
        },
        migrateLegacy,
    };

    migrateLegacy();

    const MODELS = {
        gemini: [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
        ],
        groq: [
            { id: 'llama3-8b-8192', name: 'Llama 3 8B' },
            { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
            { id: 'gemma-7b-it', name: 'Gemma 7B' },
        ],
        hf: [
            { id: 'mistralai/Mistral-7B-Instruct-v0.3', name: 'Mistral 7B' },
            { id: 'microsoft/Phi-3-mini-4k-instruct', name: 'Phi-3 Mini' },
        ],
        ollama: [
            { id: 'llama3', name: 'Llama 3 (Local)' },
            { id: 'qwen2:1.5b', name: 'Qwen 1.5B' },
        ],
    };

    async function callGemini(prompt, modelId, apiKey, temperature) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature },
            }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error?.message || `Gemini Error ${resp.status}`);
        const usage = data.usageMetadata ? {
            prompt_tokens: data.usageMetadata.promptTokenCount,
            completion_tokens: data.usageMetadata.candidatesTokenCount,
            total_tokens: data.usageMetadata.totalTokenCount,
        } : null;
        return { text: data.candidates[0].content.parts[0].text, usage };
    }

    async function callGroq(prompt, modelId, apiKey, temperature) {
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: modelId, temperature }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error?.message || `Groq Error ${resp.status}`);
        return { text: data.choices[0].message.content, usage: data.usage || null };
    }

    async function callHF(prompt, modelId, apiKey, temperature) {
        const resp = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: prompt, parameters: { temperature, return_full_text: false, do_sample: true } }),
        });
        if (!resp.ok) throw new Error(`Hugging Face Error ${resp.status}`);
        const data = await resp.json();
        const text = Array.isArray(data) ? data[0].generated_text : data.generated_text;
        return { text, usage: null };
    }

    async function callOllama(prompt, modelId, baseUrl, temperature) {
        const resp = await fetch(`${baseUrl || 'http://localhost:11434'}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelId, prompt, stream: false, options: { temperature } }),
        });
        if (!resp.ok) throw new Error('Ollama Error. Check CORS / that Ollama is running.');
        const data = await resp.json();
        const usage = {
            prompt_tokens: data.prompt_eval_count || 0,
            completion_tokens: data.eval_count || 0,
            total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        };
        return { text: data.response, usage };
    }

    async function call(provider, { apiKey, model, temperature = 0.5, prompt }) {
        switch (provider) {
            case 'gemini': return callGemini(prompt, model, apiKey, temperature);
            case 'groq': return callGroq(prompt, model, apiKey, temperature);
            case 'hf': return callHF(prompt, model, apiKey, temperature);
            case 'ollama': return callOllama(prompt, model, apiKey, temperature);
            default: throw new Error(`Unknown provider: ${provider}`);
        }
    }

    Object.assign(window.Kusanagi, {
        MODELS,
        call,
        callGemini,
        callGroq,
        callHF,
        callOllama,
        keys,
    });
})();
