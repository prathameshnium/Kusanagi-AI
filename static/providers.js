/* Kusanagi AI -- AI provider layer.
 *
 * One call() for every app. Requires keys.js.
 *
 * Providers: Google Gemini, Anthropic (Claude), Hugging Face, OpenRouter, and a
 * local Ollama. Hugging Face and OpenRouter both speak the OpenAI
 * chat-completions format, so they share a handler.
 *
 * Security notes:
 *   - Gemini keys go in the x-goog-api-key header, not the query string. A key in
 *     a URL ends up in browser history, in Referer on any redirect, and in
 *     whatever proxy logs sit in between; a header does not.
 *   - Anthropic refuses browser CORS requests unless they carry
 *     anthropic-dangerous-direct-browser-access, the opt-in its docs require
 *     for browser use. The name warns that page script can see the key, which
 *     is already this app's threat model (see keys.js); the dashboard tells
 *     users to make a dedicated, expiring, spend-limited key for it.
 *   - Everything except Gemini uses Authorization: Bearer.
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
    // Claude models think before answering, which can take a while.
    var ANTHROPIC_TIMEOUT_MS = 300000;
    var ANTHROPIC_VERSION = '2023-06-01';

    var ENDPOINTS = {
        gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
        anthropic: 'https://api.anthropic.com/v1/messages',
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
        anthropic: [
            { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
            { id: 'claude-fable-5-1', name: 'Claude Fable 5.1 (most capable, priciest)' },
            { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
            { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (cheapest)' },
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
        anthropic: 'Anthropic (Claude)',
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
                    var timeout = new Error('Request timed out. The provider did not respond.');
                    timeout.retryable = true;
                    throw timeout;
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

    /* ------------------------------------------------------------ streaming */

    /* A caller that passes onDelta(textSoFar) gets the answer as it is
       written: each handler then asks its API for a stream and reports the
       growing text. The promise still resolves to the same {text, usage, ...}
       as a plain call, so nothing else has to change. */

    // A stream that goes quiet this long is treated as dead. Claude sends
    // pings while it thinks, so a real answer never sits silent this long.
    var STREAM_IDLE_MS = 120000;

    /** Read a response body line by line, without waiting for the end. */
    function streamLines(resp, onLine) {
        if (!resp.body || !resp.body.getReader) {
            return resp.text().then(function (all) { all.split(/\r?\n/).forEach(onLine); });
        }
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var timer = null;
        var stalled = false;
        function watch() {
            clearTimeout(timer);
            timer = setTimeout(function () { stalled = true; reader.cancel(); }, STREAM_IDLE_MS);
        }
        function pump() {
            watch();
            return reader.read().then(function (step) {
                if (stalled) {
                    var quiet = new Error('The provider stopped sending the answer.');
                    quiet.retryable = true;
                    throw quiet;
                }
                if (step.done) {
                    clearTimeout(timer);
                    buffer += decoder.decode();
                    if (buffer) onLine(buffer);
                    return;
                }
                buffer += decoder.decode(step.value, { stream: true });
                var lines = buffer.split(/\r?\n/);
                buffer = lines.pop();
                lines.forEach(onLine);
                return pump();
            }, function (err) {
                clearTimeout(timer);
                throw err;
            });
        }
        return pump().catch(function (err) {
            clearTimeout(timer);
            try { reader.cancel(); } catch (e) { /* already closed */ }
            throw err;
        });
    }

    /** Server-sent events: call onData(parsedJson) for each `data:` event. */
    function streamEvents(resp, onData) {
        var data = [];
        function flush() {
            if (!data.length) return;
            var payload = data.join('\n');
            data = [];
            if (payload === '[DONE]') return;
            var parsed;
            try { parsed = JSON.parse(payload); } catch (e) { return; }
            onData(parsed);
        }
        return streamLines(resp, function (line) {
            if (line === '') flush();
            else if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
            // `event:`, `id:` and `:` comment lines carry nothing we need.
        }).then(flush);
    }

    /** The answer text in a list of Anthropic content blocks. */
    function textOf(content) {
        return content
            .filter(function (b) { return b && b.type === 'text'; })
            .map(function (b) { return b.text; })
            .join('');
    }

    /**
     * Rebuild an Anthropic message from its stream, block by block, so the
     * result looks just like a non-streamed response (pause_turn sends these
     * blocks back as they are). `onBlocks` sees the blocks after each change.
     */
    function readAnthropicStream(resp, onBlocks) {
        var msg = { content: [], stop_reason: null, stop_details: null, usage: {} };
        var partialJson = {};
        var failure = null;
        return streamEvents(resp, function (ev) {
            if (failure) return;
            var block = msg.content[ev.index];
            switch (ev.type) {
            case 'message_start':
                Object.assign(msg.usage, ev.message && ev.message.usage);
                break;
            case 'content_block_start':
                msg.content[ev.index] = Object.assign({}, ev.content_block);
                break;
            case 'content_block_delta':
                if (!block || !ev.delta) break;
                if (ev.delta.type === 'text_delta') {
                    block.text = (block.text || '') + ev.delta.text;
                    onBlocks(msg.content);
                } else if (ev.delta.type === 'thinking_delta') {
                    block.thinking = (block.thinking || '') + ev.delta.thinking;
                } else if (ev.delta.type === 'signature_delta') {
                    block.signature = ev.delta.signature;
                } else if (ev.delta.type === 'input_json_delta') {
                    partialJson[ev.index] = (partialJson[ev.index] || '') + ev.delta.partial_json;
                } else if (ev.delta.type === 'citations_delta') {
                    (block.citations = block.citations || []).push(ev.delta.citation);
                }
                break;
            case 'content_block_stop':
                if (block && partialJson[ev.index] !== undefined) {
                    try { block.input = JSON.parse(partialJson[ev.index] || '{}'); }
                    catch (e) { block.input = {}; }
                }
                break;
            case 'message_delta':
                if (ev.delta) {
                    msg.stop_reason = ev.delta.stop_reason || msg.stop_reason;
                    msg.stop_details = ev.delta.stop_details || msg.stop_details;
                }
                Object.assign(msg.usage, ev.usage);
                break;
            case 'error':
                var e = ev.error || {};
                failure = new Error('Anthropic: ' + (e.message || e.type || 'stream error'));
                failure.retryable = /overloaded|api_error|rate_limit/.test(e.type || '');
                break;
            }
        }).then(function () {
            if (failure) throw failure;
            msg.content = msg.content.filter(Boolean);
            return msg;
        });
    }

    /**
     * Build an Error from a failed response, without leaking the key.
     *
     * `retryable` marks failures that another model might survive: the model is
     * gone, busy, or overloaded. A rejected key or an exhausted balance is not
     * retryable -- trying six more models would just produce six more failures
     * and six more seconds of waiting.
     */
    function providerError(data, resp, label) {
        var msg = (data && data.error && (data.error.message || data.error))
            || (data && data.message)
            || null;
        if (typeof msg !== 'string') msg = null;

        var text;
        var retryable = false;

        if (resp.status === 401 || resp.status === 403) {
            text = label + ': key rejected (HTTP ' + resp.status + '). '
                + (msg || 'Check the key and that it is enabled for this API.');
        } else if (resp.status === 402) {
            text = label + ': out of credit (HTTP 402).';
        } else if (resp.status === 404) {
            text = label + ': model not available (HTTP 404)'
                + (msg ? ': ' + msg : '. It may have been retired.');
            retryable = true;
        } else if (resp.status === 429) {
            text = label + ': rate limited (HTTP 429).';
            retryable = true;
        } else if (resp.status >= 500) {
            text = label + ': provider error ' + resp.status
                + (msg ? ': ' + msg : '. The service may be overloaded.');
            retryable = true;
        } else {
            text = label + ' error ' + resp.status + (msg ? ': ' + msg : '');
            // 400 from these APIs usually means an unknown model id.
            retryable = resp.status === 400 && /model/i.test(msg || '');
        }

        if (/prompt is too long|context length|too many tokens/i.test(msg || '')) {
            text += ' The chat no longer fits the model. Remove a file sent whole, or '
                + 'start a new chat; use Load document for big files.';
            retryable = false;
        }

        var err = new Error(text);
        err.status = resp.status;
        err.retryable = retryable;
        return err;
    }

    // The largest context any model here takes is 1M tokens. Text runs about
    // four characters a token, so anything estimated past this cannot fit.
    var MAX_PROMPT_TOKENS = 1000000;

    /** Rough token count of the text in `messages`. Files sent as base64
     *  (PDFs, images) are left out: their cost is not their length. */
    function estimateTokens(messages) {
        var chars = 0;
        messages.forEach(function (m) {
            if (typeof m.content === 'string') chars += m.content.length;
            else m.content.forEach(function (part) {
                if (part.type === 'text') chars += String(part.text || '').length;
                else if (part.kind === 'text') chars += String(part.data || '').length;
            });
        });
        return Math.ceil(chars / 4);
    }

    /**
     * Normalise a call into a message list.
     * Callers pass either {prompt} for one-shot work or {messages} for a conversation;
     * everything below works from the list so multi-turn is not a special case.
     */
    function toMessages(params) {
        if (Array.isArray(params.messages) && params.messages.length) {
            // Content is text, or a list of parts -- {type: 'text', text} and
            // {type: 'file', ...} -- for providers that take whole files.
            return params.messages.filter(function (m) {
                return m && (typeof m.content === 'string' || Array.isArray(m.content))
                    && m.content.length;
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
        var onDelta = opts && opts.onDelta;
        // alt=sse is a format switch, not data; the key stays in the header.
        if (onDelta) url = url.replace(/:generateContent$/, ':streamGenerateContent?alt=sse');

        return request(url, {
            method: 'POST',
            // Key in a header, never the query string.
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
        }, opts && opts.timeoutMs).then(function (resp) {
            var read = !resp.ok || !onDelta ? readJson(resp) : readGeminiStream(resp, onDelta);
            return read.then(function (data) {
                if (!resp.ok) throw providerError(data, resp, 'Gemini');

                var candidate = data.candidates && data.candidates[0];
                var part = candidate && candidate.content && candidate.content.parts
                    && candidate.content.parts[0];
                if (!part || typeof part.text !== 'string') {
                    // Happens on a safety block, where candidates[] is empty rather
                    // than an error -- the old code threw a TypeError here.
                    var reason = (candidate && candidate.finishReason)
                        || (data.promptFeedback && data.promptFeedback.blockReason);
                    var empty = new Error('Gemini returned no text'
                        + (reason ? ' (' + reason + ')' : '') + '.');
                    empty.retryable = true;
                    throw empty;
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

    /** Gemini's stream, folded back into the shape of one generateContent reply. */
    function readGeminiStream(resp, onDelta) {
        var text = '';
        var last = {};
        return streamEvents(resp, function (chunk) {
            var candidate = chunk.candidates && chunk.candidates[0];
            var parts = (candidate && candidate.content && candidate.content.parts) || [];
            var added = parts.map(function (p) { return p.text || ''; }).join('');
            if (added) { text += added; onDelta(text); }
            if (candidate && candidate.finishReason) last.finishReason = candidate.finishReason;
            if (chunk.usageMetadata) last.usageMetadata = chunk.usageMetadata;
            if (chunk.promptFeedback) last.promptFeedback = chunk.promptFeedback;
        }).then(function () {
            return {
                candidates: [{ content: text ? { parts: [{ text: text }] } : null,
                    finishReason: last.finishReason }],
                usageMetadata: last.usageMetadata,
                promptFeedback: last.promptFeedback,
            };
        });
    }

    /** An OpenAI-style chat-completions stream, as one non-streamed reply. */
    function readOpenAiStream(resp, onDelta) {
        var text = '';
        var usage = null;
        var failure = null;
        return streamEvents(resp, function (chunk) {
            if (chunk.error) {
                failure = failure || new Error(String(chunk.error.message || chunk.error));
                return;
            }
            var choice = chunk.choices && chunk.choices[0];
            var piece = choice && choice.delta && choice.delta.content;
            if (piece) { text += piece; onDelta(text); }
            if (chunk.usage) usage = chunk.usage;
        }).then(function () {
            if (failure) throw failure;
            return { choices: [{ message: { content: text || null } }], usage: usage };
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
                stream: !!(opts && opts.onDelta),
            };
            if (opts && opts.json) body.response_format = { type: 'json_object' };
            var onDelta = opts && opts.onDelta;

            return request(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            }, opts && opts.timeoutMs).then(function (resp) {
                var read = !resp.ok || !onDelta ? readJson(resp) : readOpenAiStream(resp, onDelta);
                return read.then(function (data) {
                    if (!resp.ok) throw providerError(data, resp, label);
                    var choice = data.choices && data.choices[0];
                    var text = choice && choice.message && choice.message.content;
                    if (typeof text !== 'string') {
                        var blank = new Error(label + ' returned no text.');
                        blank.retryable = true;
                        throw blank;
                    }
                    return { text: text, usage: data.usage || null };
                });
            });
        };
    }

    /* Providers that take whole files in a message. Add one here once its
       handler turns {type: 'file'} parts into that API's own blocks. */
    var FILE_PROVIDERS = ['anthropic'];
    function acceptsFiles(provider) { return FILE_PROVIDERS.indexOf(provider) !== -1; }

    /** A provider-neutral part as an Anthropic content block. Sent inline,
     *  never through the Files API, so no copy waits in a file store. */
    function anthropicPart(part) {
        if (part.type !== 'file') return { type: 'text', text: String(part.text || '') };
        if (part.kind === 'image') {
            return { type: 'image',
                source: { type: 'base64', media_type: part.mediaType, data: part.data } };
        }
        return { type: 'document', title: part.name, source: part.kind === 'pdf'
            ? { type: 'base64', media_type: 'application/pdf', data: part.data }
            : { type: 'text', media_type: 'text/plain', data: part.data } };
    }

    /* Models that accept the server-side refusal fallback. Haiku has none. */
    var ANTHROPIC_REFUSAL_FALLBACK = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5'];

    /**
     * Anthropic Messages API.
     *
     *   - System turns move to the top-level `system` field.
     *   - The conversation must open with a user turn, so leading assistant
     *     turns are dropped.
     *   - No `temperature`: current Claude models reject non-default sampling
     *     parameters with a 400, so the slider does not apply here.
     *   - No JSON-mode flag: the prompts already ask for bare JSON, and
     *     callJson() tolerates fences and surrounding prose.
     */
    function callAnthropic(messages, modelId, apiKey, temperature, opts) {
        var system = [];
        var turns = [];
        messages.forEach(function (m) {
            if (m.role === 'system') { system.push(m.content); return; }
            var role = m.role === 'assistant' ? 'assistant' : 'user';
            if (!turns.length && role === 'assistant') return;
            turns.push({ role: role, content: typeof m.content === 'string'
                ? m.content : m.content.map(anthropicPart) });
        });
        if (!turns.length) return Promise.reject(new Error('Nothing to send.'));

        // Options the user switched on in Settings, remembered in this browser.
        var prefs = window.Kusanagi.prefs;
        function option(name) { return prefs ? prefs.claude(name) : undefined; }

        var body = {
            model: modelId,
            max_tokens: parseInt(option('maxTokens'), 10) || 16000,
            messages: turns,
        };
        var betas = [];

        // Prompt caching, laid out as Anthropic advises: the cache is a prefix
        // match over tools, then system, then messages. An explicit breakpoint
        // on the system prompt makes it (and the tools ahead of it) a read
        // point whatever happens later; automatic caching then moves a second
        // breakpoint to the end of each conversation turn, so the next turn
        // re-reads the whole history. One-shot prompts end in text that is
        // never sent again, so they get no tail breakpoint: it would only add
        // the write premium.
        var cache = option('cache');
        if (system.length) {
            var systemText = system.join('\n\n');
            body.system = cache
                ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
                : systemText;
        }
        if (cache && opts && opts.conversation) body.cache_control = { type: 'ephemeral' };

        // Effort is the only depth control on current Claude models: thinking
        // is always on, and a token budget is rejected. Unset keeps the
        // model's default (medium on Opus and Haiku 5.5, high on Sonnet 5.5).
        var effort = (opts && opts.effort) || option('effort');
        if (effort) body.output_config = { effort: effort };
        if (option('reasoning')) body.thinking = { type: 'adaptive', display: 'summarized' };
        if (option('usOnly')) body.inference_geo = 'us';
        if (option('fast') && modelId === 'claude-opus-5-5') {
            betas.push('fast-mode-2026-02-01');
            body.speed = 'fast';
        }

        var headers = {
            'Content-Type': 'application/json',
            // Anthropic's docs list Authorization: Bearer as the primary scheme
            // and x-api-key as a legacy fallback.
            Authorization: 'Bearer ' + apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-dangerous-direct-browser-access': 'true',
        };
        if (ANTHROPIC_REFUSAL_FALLBACK.indexOf(modelId) !== -1) {
            // On a safety refusal Anthropic re-runs the request on another Claude
            // model inside the same call. Same provider, so this stays within
            // the line callWithFallback() draws.
            betas.push('server-side-fallback-2026-07-01');
            body.fallbacks = 'default';
        }
        if (betas.length) headers['anthropic-beta'] = betas.join(',');

        // Anthropic runs the searches and fetches itself, so the browser only
        // ever talks to api.anthropic.com. Skipped for JSON calls, where a
        // search would only get in the way of the bare JSON they expect.
        if (!(opts && opts.json)) {
            // The newer tool versions, which filter results before they reach
            // the context, are documented for Opus and Sonnet; Haiku and
            // Fable get the basic ones.
            var basic = !/opus|sonnet/.test(modelId);
            // No max_uses unless the user set a cap: Claude searches and
            // fetches as often as the question needs.
            var limit = parseInt(option('webLimit'), 10);
            var tools = [];
            if (option('webSearch')) {
                tools.push({ type: basic ? 'web_search_20250305' : 'web_search_20260209',
                    name: 'web_search' });
            }
            if (option('webFetch')) {
                tools.push({ type: basic ? 'web_fetch_20250910' : 'web_fetch_20260209',
                    name: 'web_fetch' });
            }
            if (limit > 0) tools.forEach(function (t) { t.max_uses = limit; });
            if (tools.length) body.tools = tools;
        }

        // Fable can think for many minutes on a hard question.
        var timeoutMs = (opts && opts.timeoutMs)
            || (/fable/.test(modelId) ? ANTHROPIC_TIMEOUT_MS * 2 : ANTHROPIC_TIMEOUT_MS);
        var content = [];   // every block across continuations, in order
        var usage = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0 };
        var onDelta = opts && opts.onDelta;
        if (onDelta) body.stream = true;

        // With web tools on, a long search can stop with pause_turn: send the
        // partial answer back and Claude carries on from where it paused.
        function send(round) {
            return request(ENDPOINTS.anthropic, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body),
            }, timeoutMs).then(function (resp) {
                var read = !resp.ok || !onDelta ? readJson(resp)
                    : readAnthropicStream(resp, function (blocks) {
                        onDelta(textOf(content.concat(blocks)));
                    });
                return read.then(function (data) {
                    if (!resp.ok) throw providerError(data, resp, 'Anthropic');
                    content = content.concat(data.content || []);
                    if (data.usage) {
                        usage.input_tokens += data.usage.input_tokens || 0;
                        usage.output_tokens += data.usage.output_tokens || 0;
                        usage.cache_read += data.usage.cache_read_input_tokens || 0;
                        usage.cache_write += data.usage.cache_creation_input_tokens || 0;
                    }
                    if (data.stop_reason === 'pause_turn' && round < MAX_PAUSE_ROUNDS) {
                        body.messages = turns.concat([{ role: 'assistant', content: content }]);
                        return send(round + 1);
                    }
                    return data;
                });
            });
        }

        return send(0).then(function (data) {
            if (data.stop_reason === 'refusal') {
                var category = data.stop_details && data.stop_details.category;
                var refused = new Error('Claude declined to answer'
                    + (category ? ' (' + category + ').' : '.'));
                refused.retryable = true;
                throw refused;
            }

            // Content can include thinking and tool blocks; only text is the answer.
            var text = textOf(content);
            if (!text) {
                var blank = new Error('Anthropic returned no text.');
                blank.retryable = true;
                throw blank;
            }

            // Summarised reasoning, when asked for; empty text otherwise.
            var reasoning = content
                .filter(function (b) { return b && b.type === 'thinking' && b.thinking; })
                .map(function (b) { return b.thinking; })
                .join('\n\n');

            return {
                text: text,
                reasoning: reasoning,
                webSources: webSources(content),
                // input_tokens is only the uncached remainder; the prompt is all three.
                usage: {
                    prompt_tokens: usage.input_tokens + usage.cache_read + usage.cache_write,
                    completion_tokens: usage.output_tokens,
                    total_tokens: usage.input_tokens + usage.cache_read + usage.cache_write
                        + usage.output_tokens,
                    cache_read_tokens: usage.cache_read,
                    cache_write_tokens: usage.cache_write,
                },
            };
        });
    }

    // Each pause is one long stretch of searching, so a deep question can take
    // many; this only stops a runaway loop.
    var MAX_PAUSE_ROUNDS = 30;

    /** Pages Claude searched or fetched, deduplicated: [{title, url}]. Results
        are untrusted; the caller renders them as text and checked links. */
    function webSources(content) {
        var seen = {};
        var out = [];
        function add(url, title) {
            if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen[url]) return;
            seen[url] = true;
            out.push({ url: url, title: String(title || url) });
        }
        content.forEach(function (b) {
            if (!b) return;
            if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
                b.content.forEach(function (r) {
                    if (r && r.type === 'web_search_result') add(r.url, r.title);
                });
            } else if (b.type === 'web_fetch_tool_result' && b.content
                && b.content.type === 'web_fetch_result') {
                var doc = b.content.content;
                add(b.content.url, doc && doc.title);
            }
        });
        return out;
    }

    /** Ollama streams one JSON object per line; the last carries the counts. */
    function readOllamaStream(resp, onDelta) {
        var text = '';
        var last = {};
        var failure = null;
        return streamLines(resp, function (line) {
            if (!line.trim()) return;
            var chunk;
            try { chunk = JSON.parse(line); } catch (e) { return; }
            if (chunk.error) { failure = failure || new Error('Ollama: ' + chunk.error); return; }
            var piece = chunk.message && chunk.message.content;
            if (piece) { text += piece; onDelta(text); }
            if (chunk.done) last = chunk;
        }).then(function () {
            if (failure) throw failure;
            return { message: { content: text || null },
                prompt_eval_count: last.prompt_eval_count, eval_count: last.eval_count };
        });
    }

    /* For Ollama the "key" field holds the base URL instead. */
    function callOllama(messages, modelId, baseUrl, temperature, opts) {
        var root = String(baseUrl || OLLAMA_DEFAULT).replace(/\/+$/, '');
        var onDelta = opts && opts.onDelta;
        // /api/chat keeps the turn structure; /api/generate would lose it.
        return request(root + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelId,
                messages: messages,
                stream: !!onDelta,
                options: { temperature: temperature },
            }),
        }, opts && opts.timeoutMs).then(function (resp) {
            var read = !resp.ok || !onDelta ? readJson(resp) : readOllamaStream(resp, onDelta);
            return read.then(function (data) {
                if (!resp.ok) throw providerError(data, resp, 'Ollama');
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
        anthropic: callAnthropic,
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

        // Save-time checks do not cover keys stored before they existed, so
        // refuse here too rather than send one provider's key to another.
        var owner = window.Kusanagi.keys && window.Kusanagi.keys.belongsElsewhere(provider, p.apiKey);
        if (owner) {
            return Promise.reject(new Error('The key saved for ' + label(provider)
                + ' looks like a ' + label(owner) + ' key, so it was not sent. '
                + 'Re-enter it in Settings.'));
        }

        var messages = toMessages(p);
        if (!messages.length) return Promise.reject(new Error('Nothing to send.'));
        if (!acceptsFiles(provider) && messages.some(function (m) {
            return typeof m.content !== 'string';
        })) {
            return Promise.reject(new Error(label(provider) + ' cannot take whole files '
                + 'here, so nothing was sent.'));
        }
        // Checked here, so a hopeless request is never sent at all.
        var estimate = estimateTokens(messages);
        if (estimate > MAX_PROMPT_TOKENS) {
            return Promise.reject(new Error('This message is about '
                + Math.round(estimate / 1000).toLocaleString() + 'k tokens, more than any '
                + 'model takes (1,000k), so nothing was sent. Remove a file sent whole, or '
                + 'start a new chat; use Load document for big files.'));
        }

        var temp = Number.isFinite(p.temperature) ? p.temperature : 0.5;
        return handler(messages, p.model, p.apiKey, temp, p);
    }

    /**
     * call(), but move down the provider's model list when a model fails in a
     * way another model might survive: retired, rate-limited, overloaded, timed
     * out, or refusing to answer.
     *
     * Stays within the chosen provider on purpose. Silently re-sending a
     * researcher's question -- or their document excerpts -- to a different
     * company because one model was busy is not a decision this layer should
     * make quietly.
     *
     * Resolves to {text, usage, model, attempts}, where `model` is whichever one
     * actually answered, so the UI can say when it was not the one selected.
     */
    function callWithFallback(provider, params) {
        var p = params || {};
        var first = p.model;
        var chain = [first];

        if (p.fallback !== false) {
            models(provider).forEach(function (m) {
                if (m.id !== first) chain.push(m.id);
            });
        }

        var attempts = [];
        // Once words are on screen, another model would start the answer
        // over on top of them, so a failure after that is final.
        var streamed = false;
        var onDelta = p.onDelta && function (text) { streamed = true; p.onDelta(text); };

        function attempt(index) {
            var model = chain[index];
            return call(provider, Object.assign({}, p, { model: model, onDelta: onDelta }))
                .then(function (result) {
                    return Object.assign({}, result, {
                        model: model,
                        attempts: attempts.slice(),
                    });
                })
                .catch(function (err) {
                    attempts.push({ model: model, error: err.message });
                    var last = index >= chain.length - 1;
                    if (last || !err.retryable || streamed) {
                        // Report the original failure, noting what else was tried.
                        if (attempts.length > 1) {
                            err.message += ' (also tried: '
                                + attempts.slice(1).map(function (a) { return a.model; })
                                    .join(', ') + ')';
                        }
                        err.attempts = attempts.slice();
                        throw err;
                    }
                    return attempt(index + 1);
                });
        }

        if (!chain.length || !chain[0]) {
            return Promise.reject(new Error('No model selected.'));
        }
        return attempt(0);
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
                // Models without a JSON mode sometimes wrap the payload in prose.
                var inner = extractJson(text);
                if (inner !== undefined) return inner;
                throw new Error('Model did not return valid JSON.');
            }
        });
    }

    /** Parse the outermost [...] or {...} in a string; undefined if there is none. */
    function extractJson(text) {
        var start = text.search(/[[{]/);
        var end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
        if (start === -1 || end <= start) return undefined;
        try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return undefined; }
    }

    /**
     * The list a JSON answer carries. The prompts ask for a bare array, but
     * OpenAI-style JSON mode only permits an object, so models wrap the array
     * under whatever key they like. Prefer `key`, then any array property.
     */
    function listFrom(parsed, key) {
        if (Array.isArray(parsed)) return parsed;
        if (!parsed || typeof parsed !== 'object') return [];
        if (key && Array.isArray(parsed[key])) return parsed[key];
        var names = Object.keys(parsed);
        for (var i = 0; i < names.length; i++) {
            if (Array.isArray(parsed[names[i]])) return parsed[names[i]];
        }
        return [];
    }

    function label(provider) { return LABELS[provider] || provider; }

    function models(provider) { return MODELS[provider] || []; }

    Object.assign(window.Kusanagi, {
        MODELS: MODELS,
        PROVIDER_LABELS: LABELS,
        ENDPOINTS: ENDPOINTS,
        OLLAMA_DEFAULT: OLLAMA_DEFAULT,
        call: call,
        acceptsFiles: acceptsFiles,
        callWithFallback: callWithFallback,
        callJson: callJson,
        listFrom: listFrom,
        models: models,
        providerLabel: label,
    });
})();
