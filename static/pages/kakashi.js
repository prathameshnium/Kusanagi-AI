/* Kakashi -- agentic search across five open databases plus a synthesised answer.
 *
 * Everything on the left-hand feed is third-party text (paper titles, journal
 * abstracts, HN story titles). None of it is trusted; it is all rendered as text
 * nodes via dom.js, and every outbound link goes through safeUrl().
 */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    var SEARCH_ENGINES = [
        { name: 'Google', url: 'https://www.google.com/search?q=' },
        { name: 'StartPage', url: 'https://www.startpage.com/do/search?query=' },
        { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
        { name: 'Brave', url: 'https://search.brave.com/search?q=' },
        { name: 'Qwant', url: 'https://www.qwant.com/?q=' },
    ];

    var BADGES = {
        Wikipedia: 'bg-gray-700 text-gray-200',
        DuckDuckGo: 'bg-orange-900/50 text-orange-200',
        OpenAlex: 'bg-green-900/50 text-green-200',
        Crossref: 'bg-red-900/50 text-red-200',
        HackerNews: 'bg-orange-600/20 text-orange-400',
    };

    // Higher scores float to the top of the feed.
    var RANK = { DuckDuckGo: 10, Wikipedia: 4, OpenAlex: 4, Crossref: 3, HackerNews: 1 };

    var sessionTokens = 0;
    var settings = null;
    var searching = false;
    var ui = {};

    function provider() { return K.keys.provider(); }
    function apiKey() { return K.keys.get(provider()); }

    /* ------------------------------------------------------------ data sources */

    /** Every fetcher resolves to [] on failure -- one dead API must not kill the run. */
    function safeFetch(url, parse) {
        return fetch(url)
            .then(function (r) { return r.ok ? parse(r) : []; })
            .catch(function () { return []; });
    }

    function fetchWikipedia(query) {
        var url = 'https://en.wikipedia.org/w/api.php?action=opensearch&search='
            + encodeURIComponent(query) + '&limit=3&namespace=0&format=json&origin=*';
        return safeFetch(url, function (r) {
            return r.json().then(function (data) {
                if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
                return data[1].map(function (title, i) {
                    return {
                        source: 'Wikipedia',
                        title: title,
                        snippet: (data[2] && data[2][i]) || 'No description.',
                        url: data[3] && data[3][i],
                        meta: 'wiki',
                    };
                });
            });
        });
    }

    function fetchDuckDuckGo(query) {
        var url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query)
            + '&format=json&no_html=1&skip_disambig=1';
        return safeFetch(url, function (r) {
            return r.json().then(function (data) {
                var out = [];
                if (data.Abstract && data.AbstractURL) {
                    out.push({
                        source: 'DuckDuckGo', title: data.Heading || query,
                        snippet: data.Abstract, url: data.AbstractURL, meta: 'instant',
                    });
                }
                (data.RelatedTopics || []).slice(0, 2).forEach(function (t) {
                    if (!t.Text || !t.FirstURL) return;
                    out.push({
                        source: 'DuckDuckGo', title: t.Text.split(' - ')[0],
                        snippet: t.Text, url: t.FirstURL, meta: 'related',
                    });
                });
                return out;
            });
        });
    }

    function fetchOpenAlex(query) {
        var url = 'https://api.openalex.org/works?search=' + encodeURIComponent(query)
            + '&per_page=3&sort=cited_by_count:desc';
        return safeFetch(url, function (r) {
            return r.json().then(function (data) {
                return (data.results || []).map(function (w) {
                    return {
                        source: 'OpenAlex',
                        title: w.title || 'Untitled work',
                        snippet: 'Cited by ' + (w.cited_by_count || 0) + '.',
                        url: w.doi || w.id,
                        meta: w.publication_year,
                    };
                });
            });
        });
    }

    function fetchHackerNews(query) {
        var url = 'https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(query)
            + '&tags=story&hitsPerPage=2';
        return safeFetch(url, function (r) {
            return r.json().then(function (data) {
                return (data.hits || []).map(function (h) {
                    return {
                        source: 'HackerNews',
                        title: h.title || 'Untitled story',
                        snippet: (h.points || 0) + ' points, ' + (h.num_comments || 0) + ' comments',
                        url: h.url || ('https://news.ycombinator.com/item?id=' + h.objectID),
                        meta: h.created_at ? new Date(h.created_at).getFullYear() : '',
                    };
                });
            });
        });
    }

    /* This slot used to query export.arxiv.org, which sends no
       Access-Control-Allow-Origin header -- so it always threw and always returned
       [], silently. Crossref covers similar ground and does support CORS. */
    function fetchCrossref(query) {
        var url = 'https://api.crossref.org/works?query=' + encodeURIComponent(query)
            + '&rows=3&select=title,DOI,issued,container-title,abstract';
        return safeFetch(url, function (r) {
            return r.json().then(function (data) {
                var items = (data.message && data.message.items) || [];
                return items.map(function (w) {
                    var parts = w.issued && w.issued['date-parts'] && w.issued['date-parts'][0];
                    return {
                        source: 'Crossref',
                        title: (w.title && w.title[0]) || 'Untitled work',
                        snippet: stripJats(w.abstract)
                            || (w['container-title'] && w['container-title'][0])
                            || 'No abstract supplied.',
                        url: w.DOI ? 'https://doi.org/' + w.DOI : '',
                        meta: parts && parts[0],
                    };
                });
            });
        });
    }

    /* Crossref abstracts come back as JATS XML. It is rendered as text either way,
       so this is about legibility, not safety. */
    function stripJats(abstract) {
        if (typeof abstract !== 'string') return '';
        return abstract.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /* ------------------------------------------------------------------ render */

    function renderStrategy(prompts) {
        dom.replace(ui.strategyList, prompts.map(function (p) {
            return el('div', { class: 'bg-primary border border-tertiary p-2 rounded' }, [
                // Model-generated query text: a text node.
                el('p', { class: 'text-xs text-fg-primary mb-2 font-mono break-words', text: p }),
                el('div', { class: 'flex flex-wrap gap-1' }, SEARCH_ENGINES.map(function (e) {
                    return dom.link(e.url + encodeURIComponent(p), e.name,
                        'text-[9px] bg-secondary border border-tertiary px-1.5 py-0.5 rounded '
                        + 'text-fg-secondary hover:bg-accent hover:text-accent-fg transition-colors');
                })),
            ]);
        }));
        ui.strategy.classList.remove('hidden');
    }

    function renderResults(results) {
        if (!results.length) {
            dom.replace(ui.organic, el('p', {
                class: 'text-center text-fg-secondary py-10',
                text: 'No results found.',
            }));
            return;
        }

        results.sort(function (a, b) { return (RANK[b.source] || 0) - (RANK[a.source] || 0); });

        dom.replace(ui.organic, results.map(function (res) {
            return K.ui.resultCard({
                badge: res.source,
                badgeClass: BADGES[res.source],
                meta: res.meta,
                title: res.title,
                url: res.url,
                body: el('p', {
                    class: 'text-sm text-fg-secondary line-clamp-3 leading-relaxed',
                    text: res.snippet,
                }),
                footer: el('div', { class: 'mt-3 pt-2 border-t border-tertiary/50' }, [
                    dom.link(res.url, res.url,
                        'text-[10px] text-fg-secondary hover:text-fg-primary block truncate'),
                ]),
            });
        }));
    }

    /* -------------------------------------------------------------------- flow */

    function setLoading(on) {
        searching = on;
        ui.homeGo.disabled = on;
        ui.headerGo.disabled = on;
    }

    function search(query) {
        if (searching) return;
        query = (query || '').trim();
        if (!query) return;

        if (!apiKey()) {
            K.ui.toast('Set an API key to run a search.', 'error');
            settings.open();
            return;
        }

        setLoading(true);
        ui.home.classList.add('hidden');
        ui.feed.classList.remove('hidden');
        ui.headerBox.classList.remove('hidden');
        ui.headerInput.value = query;
        ui.queryDisplay.textContent = query;

        dom.replace(ui.organic, el('div', { class: 'flex justify-center py-20' },
            [dom.spinner('w-8 h-8')]));

        ui.placeholder.classList.add('hidden');
        ui.response.classList.add('hidden');
        ui.loading.classList.remove('hidden');
        dom.clear(ui.strategyList);
        ui.strategy.classList.add('hidden');

        expandQuery(query)
            .then(function (prompts) {
                renderStrategy(prompts);
                return runSearches(prompts);
            })
            .then(function (results) { return synthesise(query, results); })
            .catch(function (err) {
                ui.loading.classList.add('hidden');
                dom.replace(ui.response, el('p', { class: 'text-danger', text: err.message }));
                ui.response.classList.remove('hidden');
            })
            .then(function () { setLoading(false); });
    }

    /** Ask the model for sub-queries; fall back to the raw query if it will not. */
    function expandQuery(query) {
        var prompt = K.prompts.searchStrategies(query, 5, 'web');

        return K.callJson(provider(), {
            apiKey: apiKey(), model: ui.model.value, temperature: 0.5, prompt: prompt,
        }).then(function (parsed) {
            var list = Array.isArray(parsed) ? parsed : (parsed && parsed.queries);
            var clean = (list || []).filter(function (s) { return typeof s === 'string' && s.trim(); });
            return clean.length ? clean.slice(0, 5) : [query];
        }).catch(function () {
            return [query];
        });
    }

    function runSearches(prompts) {
        var started = performance.now();

        var batches = prompts.map(function (p) {
            return Promise.all([
                fetchWikipedia(p), fetchOpenAlex(p), fetchDuckDuckGo(p),
                fetchHackerNews(p), fetchCrossref(p),
            ]).then(function (groups) {
                return groups.reduce(function (a, b) { return a.concat(b); }, []);
            });
        });

        return Promise.all(batches).then(function (all) {
            var seen = Object.create(null);
            var unique = [];
            all.forEach(function (batch) {
                batch.forEach(function (r) {
                    if (!r || !r.url || seen[r.url]) return;
                    seen[r.url] = true;
                    unique.push(r);
                });
            });

            var secs = ((performance.now() - started) / 1000).toFixed(2);
            ui.stats.textContent = unique.length + ' results (' + secs + 's)';
            renderResults(unique);
            // Returned so the answer can be grounded in them.
            return unique;
        });
    }

    /**
     * Ground the answer in the results we just retrieved.
     *
     * The previous version asked the model to answer from memory while the
     * search ran alongside it, so the two had nothing to do with each other and
     * any "citation" in the answer was unverifiable. Passing the retrieved
     * sources in means the citations point at links already on the page.
     */
    function synthesise(query, results) {
        // Enough sources to cite, few enough to leave a small model room to answer.
        var sources = (results || []).slice(0, 10).map(function (r) {
            return {
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                meta: r.source + (r.meta ? ', ' + r.meta : ''),
            };
        });

        var started = performance.now();

        return K.callWithFallback(provider(), {
            apiKey: apiKey(),
            model: ui.model.value,
            temperature: parseFloat(ui.temp.value),
            fallback: K.prefs.modelFallback(),
            prompt: K.prompts.deepResearch(query, sources),
        }).then(function (res) {
            var secs = (performance.now() - started) / 1000;
            var tokens = (res.usage && res.usage.total_tokens) || Math.ceil(res.text.length / 4);
            updateMetrics(tokens, secs > 0 ? tokens / secs : 0);

            ui.loading.classList.add('hidden');
            dom.clear(ui.response);
            if (res.model !== ui.model.value) {
                ui.response.appendChild(el('p', {
                    class: 'text-xs text-fg-secondary border border-tertiary '
                        + 'rounded px-2 py-1 mb-3',
                    text: 'Answered by ' + res.model + ': '
                        + ui.model.value + ' was unavailable.',
                }));
            }
            var body = el('div');
            dom.markdown(body, res.text);
            ui.response.appendChild(body);
            ui.response.classList.remove('hidden');
            renderMath(body);
        });
    }

    function renderMath(node) {
        if (typeof window.renderMathInElement !== 'function') return;
        try {
            window.renderMathInElement(node, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                ],
                throwOnError: false,
            });
        } catch (e) {
            // A malformed formula must not take out the whole answer.
        }
    }

    /* ----------------------------------------------------------------- metrics */

    function updateMetrics(tokens, speed) {
        sessionTokens += tokens;
        ui.tokens.textContent = sessionTokens.toLocaleString();
        if (speed) ui.speed.textContent = speed.toFixed(1) + ' t/s';
    }

    function updateRam() {
        // performance.memory is Chromium-only and not in any spec.
        var mem = window.performance && window.performance.memory;
        ui.ram.textContent = mem
            ? Math.round(mem.usedJSHeapSize / 1048576) + ' MB'
            : '--';
    }

    function reset() {
        ui.feed.classList.add('hidden');
        ui.headerBox.classList.add('hidden');
        ui.home.classList.remove('hidden');
        ui.homeInput.value = '';
        ui.homeInput.focus();
    }

    /* -------------------------------------------------------------------- init */

    function init() {
        ui = {
            home: document.getElementById('home-state'),
            homeInput: document.getElementById('home-input'),
            homeGo: document.getElementById('home-go'),
            headerBox: document.getElementById('header-search-container'),
            headerInput: document.getElementById('header-input'),
            headerGo: document.getElementById('header-go'),
            feed: document.getElementById('results-feed'),
            queryDisplay: document.getElementById('query-display'),
            stats: document.getElementById('result-stats'),
            strategy: document.getElementById('search-strategy'),
            strategyList: document.getElementById('strategy-list'),
            organic: document.getElementById('organic-container'),
            placeholder: document.getElementById('ai-placeholder'),
            loading: document.getElementById('ai-loading'),
            response: document.getElementById('ai-response'),
            model: document.getElementById('model-select'),
            temp: document.getElementById('temp-slider'),
            tempOut: document.getElementById('temp-display'),
            tokens: document.getElementById('header-tokens'),
            speed: document.getElementById('header-speed'),
            ram: document.getElementById('header-ram'),
        };

        settings = K.ui.mountSettings({
            providers: ['gemini', 'hf', 'openrouter'],
            onSave: function () { K.ui.fillModelSelect(ui.model, provider()); },
        });
        K.ui.fillModelSelect(ui.model, provider());

        ui.temp.addEventListener('input', function () {
            ui.tempOut.textContent = ui.temp.value;
        });

        ui.homeGo.addEventListener('click', function () { search(ui.homeInput.value); });
        ui.headerGo.addEventListener('click', function () { search(ui.headerInput.value); });

        [[ui.homeInput, ui.homeInput], [ui.headerInput, ui.headerInput]].forEach(function (pair) {
            pair[0].addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); search(pair[1].value); }
            });
        });

        document.getElementById('reset-search').addEventListener('click', reset);
        document.getElementById('open-settings').addEventListener('click', function () {
            settings.open();
        });
        document.getElementById('purge-btn').addEventListener('click', K.ui.purgeAll);

        updateRam();
        setInterval(updateRam, 2000);
        ui.homeInput.focus();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
