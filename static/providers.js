/* Kusanagi AI -- AI provider layer.
 *
 * One call() for every app. Requires keys.js.
 *
 * Providers: Google Gemini, Hugging Face, OpenRouter, and a local Ollama.
 * Hugging Face and OpenRouter both speak the OpenAI chat-completions format, so
 * they share a handler.
 *
 * Security notes:
 *   - Gemini keys go in the x-goog-api-key header, not the query string. A key in
 *     a URL ends up in browser history, in Referer on any redirect, and in
 *     whatever proxy logs sit in between; a header does not.
 *   - Everything else uses Authorization: Bearer.
 *   - OpenRouter's optional HTTP-Referer / X-Title headers are deliberately not
 *     sent: they exist for its public leaderboard and would announce which page
 *     a researcher is using.
 *   - Error messages from providers are returned as plain strings and must be
 *     rendered as text by callers, never as HTML.
 *   - Requests are abortable and time-bounded so a hung provider cannot wedge
 *     the UI.
 *
 * Model IDs go stale fast. `python scripts/check_models.py` re-validates every
 * list below against the live APIs.
 */
window.Kusanagi = window.Kusanagi || {};

(function () {
    'use strict';

    var DEFAULT_TIMEOUT_MS = 120000;
    var OLLAMA_DEFAULT = 'http://localhost:11434';

    var ENDPOINTS = {
        gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
        // The old api-inference.huggingface.co/models/<id> route is legacy; the
        // router is OpenAI-compatible and handles provider selection itself.
        hf: 'https://router.huggingface.co/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    };

    var MODELS = {
        gemini: [
            { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
            { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
            { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (cheapest)' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        ],
        hf: [
            { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
            { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' },
            { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B' },
            { id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen2.5 7B' },
        ],
        openrouter: [
            { id: 'deepseek/deepseek-v4-flash-0731:free', name: 'DeepSeek V4 Flash (free)' },
            { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
            { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
            { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
            { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5' },
        ],
        // These are the models scripts_to_pull/*.ps1 actually fetches.
        ollama: [
            { id: 'llama3.2:1b', name: 'Llama 3.2 1B (local)' },
            { id: 'phi3.5', name: 'Phi-3.5 (local)' },
            { id: 'tinyllama', name: 'TinyLlama (local)' },
            { id: 'smollm2:360m', name: 'SmolLM2 360M (local)' },
        ],
    };

    var LABELS = {
        gemini: 'Google Gemini',
        hf: 'Hugging Face',
        openrouter: 'OpenRouter',
        ollama: 'Ollama (local)',
    };

    /** fetch() with a timeout, so a provider that never answers still rejects. */
    function request(url, options, timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); },
            timeoutMs || DEFAULT_TIMEOUT_MS);

        var opts = Object.assign({}, options, { signal: controller.signal });
        return fetch(url, opts)
            .catch(function (err) {
                if (err && err.name === 'AbortError') {
                    throw new Error('Request timed out. The provider did not respond.');
                }
                // A failed cross-origin fetch is opaque by design; say something useful.
                throw new Error('Network error: could not reach the provider. '
                    + 'Check your connection, and that the endpoint is allowed.');
            })
            .then(function (resp) { clearTimeout(timer); return resp; },
                function (err) { clearTimeout(timer); throw err; });
    }

    function readJson(resp) {
        return resp.json().catch(function () { return {}; });
    }

    /** Pull the most specific message a provider gave us, without leaking the key. */
    function providerError(data, resp, label) {
        var msg = (data && data.error && (data.error.message || data.error))
            || (data && data.message)
            || null;
        if (typeof msg !== 'string') msg = null;
        if (resp.status === 401 || resp.status === 403) {
            return label + ': key rejected (HTTP ' + resp.status + '). '
                + (msg || 'Check the key and that it is enabled for this API.');
        }
        if (resp.status === 429) {
            return label + ': rate limited (HTTP 429). Wait a moment and retry.';
        }
        if (resp.status === 402) {
            return label + ': out of credit (HTTP 402).';
        }
        return label + ' error ' + resp.status + (msg ? ': ' + msg : '');
    }

    /**
     * Normalise a call into a message list.
     * Callers pass either {prompt} for one-shot work or {messages} for a conversation;
     * everything below works from the list so multi-turn is not a special case.
     */
    function toMessages(params) {
        if (Array.isArray(params.messages) && params.messages.length) {
            return params.messages.filter(function (m) {
                return m && typeof m.content === 'string' && m.content.length;
            });
        }
        return [{ role: 'user', content: String(params.prompt || '') }];
    }

    function callGemini(messages, modelId, apiKey, temperature, opts) {
        var url = ENDPOINTS.gemini + encodeURIComponent(modelId) + ':generateContent';

        var body = { contents: [], generationConfig: {} };
        messages.forEach(function (m) {
            if (m.role === 'system') {
                // Gemini has no system role in v1beta contents; it takes a
                // separate instruction block.
                body.systemInstruction = { parts: [{ text: m.content }] };
                return;
            }
            body.contents.push({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            });
        });
        if (typeof temperature === 'number') body.generationConfig.temperature = temperature;
        if (opts && opts.json) body.generationConfig.responseMimeType = 'application/json';

        return request(url, {
            method: 'POST',
            // Key in a header, never the query string.
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
        }, opts && opts.timeoutMs).then(function (resp) {
            return readJson(resp).then(function (data) {
                if (!resp.ok) throw new Error(providerError(data, resp, 'Gemini'));

                var candidate = data.candidates && data.candidates[0];
                var part = candidate && candidate.content && candidate.content.parts
                    && candidate.content.parts[0];
                if (!part || typeof part.text !== 'string') {
                    // Happens on a safety block, where candidates[] is empty rather
                    // than an error -- the old code threw a TypeError here.
                    var reason = (candidate && candidate.finishReason)
                        || (data.promptFeedback && data.promptFeedback.blockReason);
                    throw new Error('Gemini returned no text'
                        + (reason ? ' (' + reason + ')' : '') + '.');
                }

                var u = data.usageMetadata;
                return {
                    text: part.text,
                    usage: u ? {
                        prompt_tokens: u.promptTokenCount,
                        completion_tokens: u.candidatesTokenCount,
                        total_tokens: u.totalTokenCount,
                    } : null,
                };
            });
        });
    }

    /**
     * Shared handler for every OpenAI-compatible chat-completions endpoint.
     * Hugging Face's router and OpenRouter both speak this, so they differ only
     * in URL and the label used in error messages.
     */
    function openAiCompatible(endpoint, label) {
        return function (messages, modelId, apiKey, temperature, opts) {
            var body = {
                model: modelId,
                messages: messages,
                temperature: temperature,
                stream: false,
            };
            if (opts && opts.json) body.response_format = { type: 'json_object' };

            return request(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            }, opts && opts.timeoutMs).then(function (resp) {
                return readJson(resp).then(function (data) {
                    if (!resp.ok) throw new Error(providerError(data, resp, label));
                    var choice = data.choices && data.choices[0];
                    var text = choice && choice.message && choice.message.content;
                    if (typeof text !== 'string') {
                        throw new Error(label + ' returned no text.');
                    }
                    return { text: text, usage: data.usage || null };
                });
            });
        };
    }

    /* For Ollama the "key" field holds the base URL instead. */
    function callOllama(messages, modelId, baseUrl, temperature, opts) {
        var root = String(baseUrl || OLLAMA_DEFAULT).replace(/\/+$/, '');
        // /api/chat keeps the turn structure; /api/generate would lose it.
        return request(root + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelId,
                messages: messages,
                stream: false,
                options: { temperature: temperature },
            }),
        }, opts && opts.timeoutMs).then(function (resp) {
            return readJson(resp).then(function (data) {
                if (!resp.ok) throw new Error(providerError(data, resp, 'Ollama'));
                var text = data.message && data.message.content;
                if (typeof text !== 'string') {
                    throw new Error('Ollama returned no text. Is the model pulled?');
                }
                var p = data.prompt_eval_count || 0;
                var c = data.eval_count || 0;
                return {
                    text: text,
                    usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c },
                };
            });
        });
    }

    var HANDLERS = {
        gemini: callGemini,
        hf: openAiCompatible(ENDPOINTS.hf, 'Hugging Face'),
        openrouter: openAiCompatible(ENDPOINTS.openrouter, 'OpenRouter'),
        ollama: callOllama,
    };

    /**
     * call(provider, {apiKey, model, temperature, json, timeoutMs, prompt | messages})
     *   -> Promise<{text, usage}>
     *
     * Pass `prompt` for one-shot work, or `messages` ([{role, content}], with roles
     * 'system' | 'user' | 'assistant') to keep a conversation.
     *
     * `json` asks the provider for JSON output where it supports it. `text` is always
     * untrusted: render it with Kusanagi.dom.markdown or as textContent, never by
     * assigning to innerHTML.
     */
    function call(provider, params) {
        var p = params || {};
        var handler = HANDLERS[provider];
        if (!handler) return Promise.reject(new Error('Unknown provider: ' + provider));
        if (!p.apiKey) {
            return Promise.reject(new Error('No API key set for ' + label(provider) + '.'));
        }
        if (!p.model) return Promise.reject(new Error('No model selected.'));

        var messages = toMessages(p);
        if (!messages.length) return Promise.reject(new Error('Nothing to send.'));

        var temp = typeof p.temperature === 'number' ? p.temperature : 0.5;
        return handler(messages, p.model, p.apiKey, temp, p);
    }

    /**
     * Ask for JSON and parse it, tolerating the ```json fences models add anyway.
     * Rejects rather than returning half-parsed junk, so callers can fall back.
     */
    function callJson(provider, params) {
        var p = Object.assign({}, params, { json: true });
        return call(provider, p).then(function (result) {
            var text = result.text.trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/, '');
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error('Model did not return valid JSON.');
            }
        });
    }

    function label(provider) { return LABELS[provider] || provider; }

    function models(provider) { return MODELS[provider] || []; }

    Object.assign(window.Kusanagi, {
        MODELS: MODELS,
        PROVIDER_LABELS: LABELS,
        ENDPOINTS: ENDPOINTS,
        OLLAMA_DEFAULT: OLLAMA_DEFAULT,
        call: call,
        callJson: callJson,
        models: models,
        providerLabel: label,
    });
})();
