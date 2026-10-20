/* Kakashi -- agentic search with a cited answer. Neji was merged into it.
 *
 * Two modes, one flow (expand the query -> search in parallel -> answer from
 * what was found):
 *
 *   Normal    the open web: Wikipedia, DuckDuckGo, OpenAlex, Crossref, HN.
 *   Academic  peer-reviewed papers only (OpenAlex + Crossref), shown as paper
 *             cards with authors, year, citations and abstract, filterable by
 *             year and sortable; the answer is a short literature review.
 *
 * "No AI" works in both: the raw query is searched directly and no model is
 * contacted at all, so no key is needed and nothing leaves for an AI provider.
 *
 * Everything in the results column is third-party text (titles, abstracts,
 * story titles). None of it is trusted: it is rendered as text nodes via dom.js,
 * every outbound link goes through safeUrl(), and it reaches the model only
 * inside the fenced SOURCES block built by prompts.js.
 */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    var WEB_ENGINES = [
        { name: 'Google', url: 'https://www.google.com/search?q=' },
        { name: 'StartPage', url: 'https://www.startpage.com/do/search?query=' },
        { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
        { name: 'Brave', url: 'https://search.brave.com/search?q=' },
        { name: 'Qwant', url: 'https://www.qwant.com/?q=' },
    ];

    var SCHOLAR_ENGINES = [
        { name: 'G.Scholar', url: 'https://scholar.google.com/scholar?q=' },
        { name: 'Semantic', url: 'https://www.semanticscholar.org/search?q=' },
        { name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/?term=' },
        { name: 'CORE', url: 'https://core.ac.uk/search?q=' },
    ];

    var EXAMPLES = {
        normal: [
            'How do multiferroics couple magnetism and polarisation?',
            'Why is BiFeO3 studied so much?',
        ],
        academic: [
            'Magnetoelectric coupling in BiFeO3 thin films',
            'Quantum error correction with surface codes',
        ],
    };

    var MODE_HINTS = {
        normal: 'Normal mode: searches the open web (Wikipedia, DuckDuckGo, OpenAlex, '
            + 'Crossref, Hacker News) and answers with citations to what it found.',
        academic: 'Academic mode: searches peer-reviewed papers (OpenAlex, Crossref) and '
            + 'writes a short literature review citing them.',
    };

    var BADGES = {
        Wikipedia: 'bg-gray-700 text-gray-200',
        DuckDuckGo: 'bg-orange-900/50 text-orange-200',
        OpenAlex: 'bg-green-900/50 text-green-200',
        Crossref: 'bg-red-900/50 text-red-200',
        HackerNews: 'bg-orange-600/20 text-orange-400',
    };

    // Normal mode: higher scores float to the top of the feed.
    var RANK = { DuckDuckGo: 10, Wikipedia: 4, OpenAlex: 4, Crossref: 3, HackerNews: 1 };

    var sessionTokens = 0;
    var answerCount = 0;   // numbers citations as [answer:source]
    var settings = null;
    var searching = false;
    var papers = [];          // Academic mode results, kept for re-filtering
    var ui = {};

    // The saved provider, narrowed to the ones this page offers (see mountSettings).
    function provider() { return settings.provider(); }
    function apiKey() { return K.keys.get(provider()); }
    function academic() { return ui.mode.value === 'academic'; }
    function noAI() { return ui.noAI.checked; }

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

    /** Rebuild an abstract from OpenAlex's inverted index. */
    function reconstructAbstract(index) {
        if (!index) return '';
        var words = [];
        Object.keys(index).forEach(function (word) {
            var positions = index[word];
            if (!Array.isArray(positions)) return;
            positions.forEach(function (pos) { words[pos] = word; });
        });
        // Gaps in the index leave holes; filter rather than print "undefined".
        return words.filter(function (w) { return w !== undefined; }).join(' ');
    }

    /* Crossref abstracts come back as JATS XML. It is rendered as text either
       way, so this is about legibility, not safety. */
    function stripJats(abstract) {
        if (typeof abstract !== 'string') return '';
        return abstract.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /**
     * Papers from OpenAlex, normalised to one shape that serves both modes:
     * the web feed reads source/title/snippet/url/meta, the paper cards read
     * the rest.
     */
    function fetchOpenAlex(query, perPage) {
        var url = 'https://api.openalex.org/works?search=' + encodeURIComponent(query)
            + '&per_page=' + perPage + '&sort=cited_by_count:desc';
        return safeFetch(url, function (r) {
            return r.json().then(function (data) {
                return (data.results || []).map(function (w) {
                    var abstract = w.abstract_inverted_index
                        ? reconstructAbstract(w.abstract_inverted_index) : '';
                    var cited = typeof w.cited_by_count === 'number' ? w.cited_by_count : null;
                    return {
                        source: 'OpenAlex',
                        // OpenAlex returns null titles more often than you would think.
                        title: w.title || 'Untitled work',
                        url: w.doi || w.id || '',
                        year: w.publication_year || null,
                        citedBy: cited,
                        venue: (w.primary_location && w.primary_location.source
                            && w.primary_location.source.display_name) || '',
                        authors: (w.authorships || [])
                            .map(function (a) { return a.author && a.author.display_name; })
                            .filter(Boolean),
                        abstract: abstract,
                        snippet: abstract || ('Cited by ' + (cited || 0) + '.'),
                        meta: w.publication_year,
                    };
                });
            });
        });
    }

    /* This slot used to query export.arxiv.org, which sends no
       Access-Control-Allow-Origin header -- so it always failed silently.
       Crossref covers similar ground and does support CORS. */
    function fetchCrossref(query, rows) {
        var url = 'https://api.crossref.org/works?query=' + encodeURIComponent(query)
            + '&rows=' + rows
            + '&select=title,DOI,issued,container-title,abstract,author,is-referenced-by-count';
        return safeFetch(url, function (r) {
            return r.json().then(function (data) {
                var items = (data.message && data.message.items) || [];
                return items.map(function (w) {
                    var parts = w.issued && w.issued['date-parts'] && w.issued['date-parts'][0];
                    var abstract = stripJats(w.abstract);
                    var venue = (w['container-title'] && w['container-title'][0]) || '';
                    return {
                        source: 'Crossref',
                        title: (w.title && w.title[0]) || 'Untitled work',
                        url: w.DOI ? 'https://doi.org/' + w.DOI : '',
                        year: (parts && parts[0]) || null,
                        citedBy: typeof w['is-referenced-by-count'] === 'number'
                            ? w['is-referenced-by-count'] : null,
                        venue: venue,
                        authors: (w.author || []).map(function (a) {
                            return [a.given, a.family].filter(Boolean).join(' ');
                        }).filter(Boolean),
                        abstract: abstract,
                        snippet: abstract || venue || 'No abstract supplied.',
                        meta: parts && parts[0],
                    };
                });
            });
        });
    }

    /* ------------------------------------------------------------------ render */

    function renderStrategy(prompts) {
        var engines = academic() ? SCHOLAR_ENGINES : WEB_ENGINES;
        dom.replace(ui.strategyList, prompts.map(function (p) {
            return el('div', { class: 'bg-primary border border-tertiary p-2 rounded' }, [
                // Model-generated query text: a text node.
                el('p', { class: 'text-xs text-fg-primary mb-2 font-mono break-words', text: p }),
                el('div', { class: 'flex flex-wrap gap-1' }, engines.map(function (e) {
                    return dom.link(e.url + encodeURIComponent(p), e.name,
                        'text-[9px] bg-secondary border border-tertiary px-1.5 py-0.5 rounded '
                        + 'text-fg-secondary hover:bg-accent hover:text-accent-fg transition-colors');
                })),
            ]);
        }));
        ui.strategy.classList.remove('hidden');
    }

    function emptyState(text) {
        dom.replace(ui.organic, el('p', {
            class: 'text-center text-fg-secondary py-10',
            text: text,
        }));
    }

    /** Normal mode: one compact card per web result. */
    function renderWebResults(results) {
        if (!results.length) { emptyState('No results found.'); return; }

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

    /** Academic mode: a paper card with byline, metadata and abstract. */
    function paperCard(paper) {
        var meta = [paper.year, paper.venue,
            paper.citedBy !== null ? 'Cited ' + paper.citedBy : null]
            .filter(function (x) { return x; }).join(' · ');

        var byline = paper.authors.length
            ? paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : '')
            : 'Unknown authors';

        return K.ui.resultCard({
            badge: paper.source,
            badgeClass: BADGES[paper.source],
            meta: meta,
            title: paper.title,
            url: paper.url,
            byline: byline,
            body: K.ui.expandableText(paper.abstract || 'Abstract not available via the API.',
                280, 'text-sm text-fg-secondary leading-relaxed bg-primary/40 p-3 rounded'),
            footer: el('div', { class: 'flex flex-wrap gap-2 mt-3 items-center' }, [
                paper.url ? dom.link(paper.url, 'View paper',
                    'text-xs bg-accent text-accent-fg px-3 py-1 rounded font-bold '
                    + 'hover:bg-accent-hover transition') : null,
                dom.link('https://scholar.google.com/scholar?q=' + encodeURIComponent(paper.title),
                    'Google Scholar',
                    'text-xs border border-tertiary text-fg-secondary px-3 py-1 rounded '
                    + 'hover:text-fg-primary transition'),
                K.ui.copyButton(function () { return paper.title; }, 'Copy title'),
            ]),
        });
    }

    /** Re-filter and re-sort the papers already fetched; no new requests. */
    function applyFilters() {
        var minYear = parseInt(ui.filterYear.value, 10);
        var mode = ui.filterSort.value;
        var list = papers.slice();

        if (!isNaN(minYear)) {
            list = list.filter(function (p) { return p.year && p.year >= minYear; });
        }
        if (mode === 'newest') {
            list.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
        } else if (mode === 'citations') {
            list.sort(function (a, b) { return (b.citedBy || 0) - (a.citedBy || 0); });
        }

        if (!list.length) emptyState(papers.length ? 'No papers match those filters.'
            : 'No papers found.');
        else dom.replace(ui.organic, list.map(paperCard));
        ui.stats.textContent = 'Showing ' + list.length + ' of ' + papers.length + ' papers';
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

        if (!noAI() && !apiKey()) {
            K.ui.toast('Set an API key, or tick "No AI" to search without one.', 'error');
            settings.open();
            return;
        }

        setLoading(true);
        ui.home.classList.add('hidden');
        ui.feed.classList.remove('hidden');
        ui.headerBox.classList.remove('hidden');
        ui.headerInput.value = query;
        ui.queryDisplay.textContent = query;
        ui.heading.textContent = academic() ? 'Papers' : 'Results';
        ui.filters.classList.add('hidden');
        ui.stats.textContent = 'Searching...';

        dom.replace(ui.organic, el('div', { class: 'flex justify-center py-20' },
            [dom.spinner('w-8 h-8')]));

        ui.placeholder.classList.add('hidden');
        ui.response.classList.add('hidden');
        dom.clear(ui.strategyList);
        ui.strategy.classList.add('hidden');

        if (noAI()) {
            // Nothing goes to a model: no expansion, no answer.
            ui.loading.classList.add('hidden');
            dom.replace(ui.response, el('div', {
                class: 'text-sm text-success border border-success/40 bg-success/10 rounded p-3',
                text: 'No AI: the query was searched directly, and nothing was sent to '
                    + 'an AI provider. Untick "No AI" for an answer with citations.',
            }));
            ui.response.classList.remove('hidden');
        } else {
            ui.loading.classList.remove('hidden');
        }

        expandQuery(query)
            .then(function (prompts) {
                renderStrategy(prompts);
                return runSearches(prompts);
            })
            .then(function (results) {
                if (noAI()) return null;
                return synthesise(query, results);
            })
            .catch(function (err) {
                ui.loading.classList.add('hidden');
                dom.replace(ui.response, el('p', { class: 'text-danger', text: err.message }));
                ui.response.classList.remove('hidden');
            })
            .then(function () { setLoading(false); });
    }

    /** Ask the model for sub-queries; fall back to the raw query if it will not. */
    function expandQuery(query) {
        if (noAI()) return Promise.resolve([query]);
        var prompt = K.prompts.searchStrategies(query, academic() ? 4 : 5,
            academic() ? 'academic' : 'web');

        return K.callJson(provider(), {
            apiKey: apiKey(), model: ui.model.value, temperature: 0.5, prompt: prompt,
        }).then(function (parsed) {
            var clean = K.listFrom(parsed, 'queries').filter(function (s) {
                return typeof s === 'string' && s.trim();
            });
            return clean.length ? clean.slice(0, 5) : [query];
        }).catch(function () {
            return [query];
        });
    }

    function runSearches(prompts) {
        var started = performance.now();
        var isAcademic = academic();

        var batches = prompts.map(function (p) {
            var fetchers = isAcademic
                ? [fetchOpenAlex(p, 5), fetchCrossref(p, 3)]
                : [fetchWikipedia(p), fetchOpenAlex(p, 3), fetchDuckDuckGo(p),
                    fetchHackerNews(p), fetchCrossref(p, 3)];
            return Promise.all(fetchers).then(function (groups) {
                return groups.reduce(function (a, b) { return a.concat(b); }, []);
            });
        });

        return Promise.all(batches).then(function (all) {
            // De-duplicate: by URL on the web, by title for papers (the same
            // paper arrives from OpenAlex and Crossref with different URLs).
            var seen = Object.create(null);
            var unique = [];
            all.forEach(function (batch) {
                batch.forEach(function (r) {
                    if (!r) return;
                    var key = isAcademic
                        ? r.title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 80)
                        : r.url;
                    if (!key || seen[key]) return;
                    seen[key] = true;
                    unique.push(r);
                });
            });

            var secs = ((performance.now() - started) / 1000).toFixed(2);
            if (isAcademic) {
                papers = unique;
                ui.filters.classList.remove('hidden');
                applyFilters();
                ui.stats.textContent += ' (' + secs + 's)';
            } else {
                ui.stats.textContent = unique.length + ' results (' + secs + 's)';
                renderWebResults(unique);
            }
            // Returned so the answer can be grounded in them.
            return unique;
        });
    }

    /**
     * Ground the answer in the results just retrieved, so every citation
     * points at a link already on the page.
     */
    function synthesise(query, results) {
        var isAcademic = academic();
        // Enough sources to cite, few enough to leave a small model room to answer.
        var sources = (results || []).slice(0, isAcademic ? 12 : 10).map(function (r) {
            var meta = isAcademic
                ? [r.authors && r.authors.slice(0, 3).join(', '), r.venue, r.year,
                    r.citedBy !== null && r.citedBy !== undefined
                        ? 'cited ' + r.citedBy : null]
                    .filter(function (x) { return x; }).join(' · ')
                : r.source + (r.meta ? ', ' + r.meta : '');
            return { title: r.title, url: r.url, snippet: r.snippet, meta: meta };
        });

        var started = performance.now();

        return K.callWithFallback(provider(), {
            apiKey: apiKey(),
            model: ui.model.value,
            temperature: parseFloat(ui.temp.value),
            fallback: K.prefs.modelFallback(),
            prompt: K.prompts.deepResearch(query, sources, isAcademic),
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
            // dom.markdown also typesets the LaTeX; citations then become
            // [answer:source] links into the sources this search retrieved.
            answerCount += 1;
            var answerNo = answerCount;
            var body = el('div');
            dom.markdown(body, res.text);
            dom.citations(body, answerNo, sources);
            var reasoning = K.ui.reasoningBlock(res.reasoning);
            if (reasoning) ui.response.appendChild(reasoning);
            ui.response.appendChild(body);
            var web = K.ui.webSourcesBlock(res.webSources);
            if (web) ui.response.appendChild(web);
            ui.response.appendChild(el('div', { class: 'mt-3 flex gap-2' }, [
                K.ui.copyButton(function () {
                    return dom.relabelCitations(res.text, answerNo);
                }, 'Copy answer'),
                K.ui.speakButton(function () { return K.ui.speakableText(body); }),
            ]));
            ui.response.classList.remove('hidden');
            K.ui.chime();
        });
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

    /* ------------------------------------------------------------------- modes */

    function renderMode() {
        var mode = academic() ? 'academic' : 'normal';
        ui.modeHint.textContent = MODE_HINTS[mode]
            + (noAI() ? ' No AI is on: nothing is sent to a model.' : '');
        ui.homeInput.placeholder = academic()
            ? 'Search the literature...' : 'Ask a complex question...';
        dom.replace(ui.pills, EXAMPLES[mode].map(function (example) {
            return el('button', {
                type: 'button',
                class: 'px-3 py-1.5 rounded-full border border-tertiary text-fg-secondary '
                    + 'text-xs hover:border-accent hover:text-accent transition',
                text: example,
                on: { click: function () { ui.homeInput.value = example; ui.homeInput.focus(); } },
            });
        }));
    }

    function reset() {
        papers = [];
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
            heading: document.getElementById('results-heading'),
            stats: document.getElementById('result-stats'),
            strategy: document.getElementById('search-strategy'),
            strategyList: document.getElementById('strategy-list'),
            filters: document.getElementById('filter-section'),
            filterYear: document.getElementById('filter-year'),
            filterSort: document.getElementById('filter-sort'),
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
            mode: document.getElementById('search-mode'),
            noAI: document.getElementById('no-ai'),
            modeHint: document.getElementById('mode-hint'),
            pills: document.getElementById('example-pills'),
        };

        // ?mode=academic opens straight into Academic mode; the old Neji
        // address forwards here with it.
        if (/[?&]mode=academic\b/.test(window.location.search)) ui.mode.value = 'academic';

        settings = K.ui.mountSettings({
            providers: ['gemini', 'anthropic', 'hf', 'openrouter'],
            onSave: function () {
                K.ui.fillModelSelect(ui.model, provider());
                syncModel();
                effort.sync();
            },
        });
        K.ui.fillModelSelect(ui.model, provider());
        var syncModel = K.ui.bindModelControls({
            model: ui.model, temp: ui.temp, tempOut: ui.tempOut, provider: provider,
        });
        // Thinking effort and the reasoning switch sit in the search box, before GO.
        var effort = K.ui.claudeControls(provider);
        ui.homeInput.insertAdjacentElement('afterend', effort.node);

        ui.temp.addEventListener('input', function () {
            ui.tempOut.textContent = ui.temp.value;
        });

        ui.homeGo.addEventListener('click', function () { search(ui.homeInput.value); });
        ui.headerGo.addEventListener('click', function () { search(ui.headerInput.value); });
        [ui.homeInput, ui.headerInput].forEach(function (input) {
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); search(input.value); }
            });
        });

        ui.mode.addEventListener('change', renderMode);
        ui.noAI.addEventListener('change', renderMode);
        ui.filterYear.addEventListener('input', applyFilters);
        ui.filterSort.addEventListener('change', applyFilters);

        document.getElementById('reset-search').addEventListener('click', reset);
        document.getElementById('open-settings').addEventListener('click', function () {
            settings.open();
        });
        document.getElementById('purge-btn').addEventListener('click', K.ui.purgeAll);

        renderMode();
        updateRam();
        setInterval(updateRam, 2000);
        ui.homeInput.focus();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
