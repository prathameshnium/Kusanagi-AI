/* Neji -- academic paper discovery over OpenAlex.
 *
 * This is where the worst of the old XSS lived: paper titles were escaped with
 * `title.replace(/'/g, "\\'")` and interpolated into an onclick attribute, which
 * any title containing a double quote walked straight out of. There are no inline
 * handlers here now, and every OpenAlex field is a text node.
 */
(function () {
    'use strict';

    var K = window.Kusanagi;
    var dom = K.dom;
    var el = dom.el;

    var SCHOLAR_LINKS = [
        { name: 'G.Scholar', url: 'https://scholar.google.com/scholar?q=' },
        { name: 'Semantic', url: 'https://www.semanticscholar.org/search?q=' },
        { name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/?term=' },
        { name: 'CORE', url: 'https://core.ac.uk/search?q=' },
    ];

    var EXAMPLES = [
        { label: 'Microplastics', query: 'Microplastics in marine ecosystems' },
        { label: 'Quantum computing', query: 'Quantum error correction algorithms' },
        { label: 'Longevity', query: 'Impact of intermittent fasting on longevity' },
    ];

    var LOCK_OPEN = 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z';
    var SHIELD = 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z';

    var incognito = false;
    var papers = [];
    var searching = false;
    var settings = null;
    var ui = {};

    function provider() { return K.keys.provider(); }
    function apiKey() { return K.keys.get(provider()); }

    /* ------------------------------------------------------------------- data */

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

    function searchOpenAlex(query) {
        var url = 'https://api.openalex.org/works?search=' + encodeURIComponent(query)
            + '&per_page=5&sort=cited_by_count:desc';
        return fetch(url)
            .then(function (r) { return r.ok ? r.json() : { results: [] }; })
            .then(function (data) {
                return (data.results || []).map(function (work) {
                    return {
                        source: 'OpenAlex',
                        // OpenAlex returns null titles more often than you would think,
                        // and the old code called .toLowerCase() on them.
                        title: work.title || 'Untitled work',
                        year: work.publication_year || null,
                        citedBy: typeof work.cited_by_count === 'number'
                            ? work.cited_by_count : null,
                        doi: work.doi || work.id || '',
                        host: (work.primary_location && work.primary_location.source
                            && work.primary_location.source.display_name) || 'Unknown source',
                        abstract: work.abstract_inverted_index
                            ? reconstructAbstract(work.abstract_inverted_index)
                            : 'Abstract not available via the API.',
                        authors: (work.authorships || [])
                            .map(function (a) { return a.author && a.author.display_name; })
                            .filter(Boolean),
                    };
                });
            })
            .catch(function () { return []; });
    }

    /** Ask the model for sub-queries. Never called in incognito mode. */
    function generateStrategies(query) {
        var prompt = 'You are a senior research librarian. The user wants papers on: "'
            + query + '".\nGenerate exactly 5 distinct, high-quality academic search '
            + 'queries.\nReturn ONLY a JSON array of strings.';

        return K.callJson(provider(), {
            apiKey: apiKey(),
            model: (K.models(provider())[0] || {}).id,
            temperature: 0.4,
            prompt: prompt,
        }).then(function (parsed) {
            var list = Array.isArray(parsed) ? parsed : (parsed && parsed.queries);
            var clean = (list || []).filter(function (s) {
                return typeof s === 'string' && s.trim();
            });
            return clean.length ? clean.slice(0, 5) : [query];
        }).catch(function () {
            return [query];
        });
    }

    /* ----------------------------------------------------------------- render */

    function strategyCard(text, heading, accentClass) {
        return el('div', {
            class: 'bg-tertiary p-3 rounded border-l-4 text-xs transition '
                + (accentClass || 'border-accent'),
        }, [
            el('div', { class: 'font-bold mb-1 '
                + (accentClass ? 'text-success' : 'text-accent'), text: heading }),
            el('div', { class: 'text-fg-primary font-mono mb-2 break-words', text: text }),
            el('div', { class: 'flex flex-wrap gap-1 pt-2 border-t border-primary/50' },
                SCHOLAR_LINKS.map(function (s) {
                    return dom.link(s.url + encodeURIComponent(text), s.name,
                        'bg-primary hover:bg-accent hover:text-accent-fg text-fg-secondary '
                        + 'px-2 py-1 rounded text-[10px] font-bold transition');
                })),
        ]);
    }

    function paperCard(paper) {
        var copyBtn = el('button', {
            type: 'button',
            class: 'text-fg-secondary hover:text-accent transition pt-1 shrink-0',
            'aria-label': 'Copy title',
        }, [dom.icon('M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3', 'w-4 h-4')]);
        copyBtn.addEventListener('click', function () {
            K.ui.copyToClipboard(paper.title, copyBtn);
        });

        var meta = [];
        if (paper.year) {
            meta.push(el('span', {
                class: 'bg-tertiary px-2 py-0.5 rounded text-accent font-bold',
                text: String(paper.year),
            }));
        }
        meta.push(el('span', { text: paper.host }));
        if (paper.citedBy !== null) {
            meta.push(el('span', { text: 'Cited ' + paper.citedBy }));
        }

        var byline = paper.authors.length
            ? paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : '')
            : 'Unknown authors';

        var titleEl = el('h3', {
            class: 'text-lg font-bold text-fg-primary group-hover:text-accent transition leading-tight',
            text: paper.title,
        });
        var titleNode = paper.doi
            ? (function () {
                var a = dom.link(paper.doi, null, 'hover:underline');
                a.appendChild(titleEl);
                return a;
            })()
            : titleEl;

        return el('div', {
            class: 'bg-secondary border border-tertiary p-5 rounded-xl hover:border-accent '
                + 'transition group relative',
        }, [
            el('div', {
                class: 'absolute top-0 right-0 bg-blue-900 text-blue-200 text-[10px] '
                    + 'font-bold px-2 py-1 rounded-bl',
                text: paper.source.toUpperCase(),
            }),

            el('div', { class: 'flex items-start gap-2 pr-16 mb-1' }, [copyBtn, titleNode]),

            el('div', { class: 'text-base font-semibold text-fg-primary mb-2 ml-6', text: byline }),

            el('div', {
                class: 'flex flex-wrap items-center gap-3 mb-3 text-xs text-fg-secondary ml-6',
            }, meta),

            K.ui.expandableText(paper.abstract, 250,
                'text-sm text-fg-secondary mb-3 opacity-90 bg-tertiary/30 p-3 rounded'),

            el('div', { class: 'flex flex-wrap gap-2 ml-1' }, [
                dom.link(paper.doi, 'View paper',
                    'text-xs bg-accent text-accent-fg px-3 py-1.5 rounded font-bold '
                    + 'hover:bg-accent-hover transition'),
                dom.link('https://scholar.google.com/scholar?q=' + encodeURIComponent(paper.title),
                    'Find on Google Scholar',
                    'text-xs border border-tertiary text-fg-secondary px-3 py-1.5 rounded '
                    + 'hover:text-fg-primary transition'),
            ]),
        ]);
    }

    function renderPapers(list) {
        if (!list.length) {
            dom.replace(ui.paperList, el('p', {
                class: 'text-fg-secondary text-center py-6',
                text: 'No results matching those filters.',
            }));
            return;
        }
        dom.replace(ui.paperList, list.map(paperCard));
    }

    function applyFilters() {
        var minYear = parseInt(ui.filterYear.value, 10);
        var mode = ui.filterSort.value;
        var filtered = papers.slice();

        if (!isNaN(minYear)) {
            filtered = filtered.filter(function (p) { return p.year && p.year >= minYear; });
        }

        if (mode === 'newest') {
            filtered.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
        } else if (mode === 'citations') {
            filtered.sort(function (a, b) { return (b.citedBy || 0) - (a.citedBy || 0); });
        }

        renderPapers(filtered);
        ui.count.textContent = 'Showing ' + filtered.length + ' of ' + papers.length + ' results';
    }

    /* ------------------------------------------------------------------- flow */

    function research() {
        if (searching) return;
        var query = ui.input.value.trim();
        if (!query) return;

        if (!incognito && !apiKey()) {
            K.ui.toast('Set an API key, or turn on incognito mode to search without one.',
                'error');
            settings.open();
            return;
        }

        searching = true;
        ui.searchBtn.disabled = true;
        ui.searchBtn.textContent = 'Searching...';

        ui.container.classList.remove('mt-[20vh]');
        ui.container.classList.add('mt-4', 'scale-90');
        ui.branding.classList.add('hidden');
        ui.pills.classList.add('hidden');
        ui.badge.classList.add('hidden');
        ui.sidebar.classList.remove('w-0', 'opacity-0');
        ui.sidebar.classList.add('w-80');
        ui.filters.classList.add('hidden');

        dom.replace(ui.strategyList, el('div', {
            class: incognito
                ? 'text-success text-xs font-mono p-2 border border-success/40 rounded bg-success/10'
                : 'text-fg-secondary italic',
            text: incognito
                ? 'Incognito active. No model contacted; running the query directly.'
                : 'Analysing research intent...',
        }));

        ui.results.classList.remove('hidden');
        dom.replace(ui.paperList, el('div', { class: 'text-center p-8' }, [
            dom.spinner('w-8 h-8'),
            el('p', { class: 'text-fg-secondary mt-2', text: 'Scanning OpenAlex...' }),
        ]));

        var plan = incognito ? Promise.resolve([query]) : generateStrategies(query);

        plan.then(function (strategies) {
            if (incognito) {
                dom.replace(ui.strategyList,
                    strategyCard(query, 'Direct search', 'border-success'));
            } else {
                dom.replace(ui.strategyList, strategies.map(function (s, i) {
                    return strategyCard(s, 'Prompt ' + (i + 1));
                }));
            }
            return Promise.all(strategies.map(searchOpenAlex));
        }).then(function (batches) {
            var seen = Object.create(null);
            papers = [];
            batches.forEach(function (batch) {
                batch.forEach(function (p) {
                    var key = p.title.toLowerCase().slice(0, 60);
                    if (seen[key]) return;
                    seen[key] = true;
                    papers.push(p);
                });
            });
            ui.filters.classList.remove('hidden');
            applyFilters();
        }).catch(function (err) {
            dom.replace(ui.paperList, el('p', {
                class: 'text-danger text-center p-4',
                text: 'Search failed. ' + err.message,
            }));
        }).then(function () {
            searching = false;
            ui.searchBtn.disabled = false;
            ui.searchBtn.textContent = 'Research';
        });
    }

    function reset() {
        papers = [];
        ui.input.value = '';
        ui.results.classList.add('hidden');
        ui.sidebar.classList.add('w-0', 'opacity-0');
        ui.sidebar.classList.remove('w-80');
        ui.container.classList.add('mt-[20vh]');
        ui.container.classList.remove('mt-4', 'scale-90');
        ui.branding.classList.remove('hidden');
        ui.pills.classList.remove('hidden');
        ui.badge.classList.toggle('hidden', !incognito);
        dom.clear(ui.paperList);
        dom.clear(ui.strategyList);
        ui.input.focus();
    }

    /* ----------------------------------------------------------------- chrome */

    function setPrivacyIcon() {
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('d', incognito ? SHIELD : LOCK_OPEN);
        dom.replace(ui.privacyIcon, path);
        ui.privacyIcon.classList.toggle('text-success', incognito);
    }

    function togglePrivacy() {
        incognito = !incognito;
        setPrivacyIcon();
        ui.privacyToggle.setAttribute('aria-pressed', String(incognito));
        ui.badge.classList.toggle('hidden', !incognito);
        checkStatus();
    }

    function checkStatus() {
        var has = !!apiKey();
        ui.dot.className = 'w-2 h-2 rounded-full '
            + (incognito ? 'bg-success' : (has ? 'bg-success' : 'bg-danger'));
        ui.statusText.textContent = incognito
            ? 'Incognito: no model'
            : (has ? K.providerLabel(provider()) + ' ready' : 'Setup required');
    }

    /* ------------------------------------------------------------------- init */

    function init() {
        ui = {
            input: document.getElementById('search-input'),
            searchBtn: document.getElementById('search-btn'),
            container: document.getElementById('search-container'),
            branding: document.getElementById('branding'),
            pills: document.getElementById('pills-section'),
            results: document.getElementById('results-area'),
            paperList: document.getElementById('paper-list'),
            count: document.getElementById('results-count'),
            sidebar: document.getElementById('strategy-sidebar'),
            strategyList: document.getElementById('strategy-list'),
            filters: document.getElementById('filter-section'),
            filterYear: document.getElementById('filter-year'),
            filterSort: document.getElementById('filter-sort'),
            privacyToggle: document.getElementById('privacy-toggle'),
            privacyIcon: document.getElementById('privacy-icon'),
            badge: document.getElementById('privacy-badge'),
            dot: document.getElementById('api-status-dot'),
            statusText: document.getElementById('api-status-text'),
        };

        settings = K.ui.mountSettings({
            providers: ['gemini', 'hf', 'openrouter'],
            onSave: checkStatus,
        });

        dom.replace(ui.pills, EXAMPLES.map(function (ex) {
            return el('button', {
                type: 'button',
                class: 'px-3 py-1.5 rounded-full border border-tertiary text-fg-secondary '
                    + 'text-xs hover:border-accent hover:text-accent transition',
                text: ex.label,
                on: {
                    click: function () { ui.input.value = ex.query; ui.input.focus(); },
                },
            });
        }));

        ui.searchBtn.addEventListener('click', research);
        ui.input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); research(); }
        });
        ui.privacyToggle.addEventListener('click', togglePrivacy);
        ui.filterYear.addEventListener('input', applyFilters);
        ui.filterSort.addEventListener('change', applyFilters);
        document.getElementById('reset-search').addEventListener('click', reset);
        document.getElementById('open-settings').addEventListener('click', function () {
            settings.open();
        });

        setPrivacyIcon();
        checkStatus();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
