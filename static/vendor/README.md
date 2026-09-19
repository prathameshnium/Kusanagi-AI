# Vendored third-party assets

Everything the web apps load is served from this repository. No page makes a
request to a CDN, a font host or any other third party.

That is not only about supply-chain risk, though it is mostly about that: an
unpinned `<script src="https://cdn.example/lib.js">` executes whatever that host
returns today, with full access to the page and to the API key the user just
typed into it. It is also what makes the strict `Content-Security-Policy` on each
page possible (`default-src 'none'; script-src 'self'`), and it stops every
visitor being announced to Google Fonts.

## What is here

| Path | Version | Upstream |
|---|---|---|
| `marked.min.js` | 12.0.2 | https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js |
| `purify.min.js` | 3.2.7 | https://cdn.jsdelivr.net/npm/dompurify@3.2.7/dist/purify.min.js |
| `katex/katex.min.js`<br>`katex/katex.min.css`<br>`katex/auto-render.min.js`<br>`katex/fonts/*.woff2` | 0.16.22 | https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/ |
| `pdfjs/pdf.min.mjs`<br>`pdfjs/pdf.worker.min.mjs` | 4.10.38 (legacy build) | https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/ |
| `fonts/*.woff2`, `fonts/fonts.css` | — | Google Fonts (Inter, JetBrains Mono) |

Tailwind is **not** here: it is compiled ahead of time into `static/kusanagi.css`
by `scripts/build_css.py`. The old setup used `cdn.tailwindcss.com`, which is the
in-browser JIT compiler — it cannot be version-pinned, cannot carry a
subresource-integrity hash, and needs `'unsafe-eval'`.

## Version choices that matter

- **pdf.js 4.x, not 3.x.** 3.11.174 is affected by CVE-2024-4367, where a crafted
  PDF can execute arbitrary JavaScript through a font glyph — a real concern for
  an app whose whole job is opening PDFs a researcher was sent. 4.x is ESM-only,
  which is why Orochimaru imports it dynamically and why that one app needs to be
  served over http rather than opened from `file://`. The reader also passes
  `isEvalSupported: false` as a second line of defence.
- **DOMPurify 3.2.7, not 3.0.6.** Several sanitiser bypasses were fixed in
  between. This is the only thing standing between model output and the DOM.
- **KaTeX 0.16.22.** Later than the 0.16.9 previously used, which predates the
  `\htmlData` and `maxExpand` advisories.
- **woff2 only.** The KaTeX stylesheet's `woff` and `ttf` `src` entries were
  stripped, since every browser that runs this suite supports woff2. That is
  ~600 KB of fonts rather than ~1.8 MB.

## Refreshing

Fonts regenerate from upstream:

```bash
python scripts/fetch_fonts.py
python scripts/build_css.py
```

The JavaScript and KaTeX assets were fetched by hand. To bump one, download the
new version to the same path, update the table above, and re-test the app that
uses it — in particular check that `Kusanagi.dom.markdown()` still strips
`<script>`, `onerror` and `javascript:` hrefs, since that is the guarantee the
whole rendering layer rests on.

Do not add a library here without also adding it to the loading `<script>` tags
of the pages that need it. There is no bundler; the pages list their own
dependencies.
