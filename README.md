# Kusanagi-AI: Free & Open-Source Local AI Toolkit for Researchers

<p align="center" id="top">
  <img src="https://raw.githubusercontent.com/prathameshnium/static-files/main/projects/kusanagi-ai/logo/Kusanagi-AI.png" alt="Kusanagi-AI Logo" width="250"/>
</p>

<p align="center">
    <a href="https://github.com/prathameshnium/Kusanagi-AI/stargazers"><img src="https://img.shields.io/github/stars/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Stars"></a>
    <a href="https://github.com/prathameshnium/Kusanagi-AI/network/members"><img src="https://img.shields.io/github/forks/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Forks"></a>
    <a href="https://github.com/prathameshnium/Kusanagi-AI/issues"><img src="https://img.shields.io/github/issues/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Issues"></a>
    <a href="https://prathameshdeshmukh.site/pages/Project_Kusanagi-AI.html"><img src="https://img.shields.io/badge/Project-Page-ffab40?style=for-the-badge&logo=read-the-docs&logoColor=white" alt="Project Page"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/github/license/prathameshnium/Kusanagi-AI?style=for-the-badge&color=ffab40" alt="License"></a>
    <img src="https://img.shields.io/badge/python-3.8+-blue.svg?style=for-the-badge&logo=python&color=ffab40" alt="Python Version">
</p>

> Empowering researchers, particularly in Physics and Material Science, with accessible, privacy-focused AI tools designed to run efficiently on standard home laptops. Kusanagi-AI provides a robust, open-source platform for local AI experimentation and application, ensuring data ownership and control. Built to leverage the power of [Ollama](https://ollama.com/) for local large language model inference, this toolkit allows you to run advanced AI capabilities, including multiple models simultaneously, even on a decent laptop.

## Table of Contents

- [About This Project](#about-this-project)
- [Technology Stack](#technology-stack)
- [Features](#features)
- [Screenshots](#screenshots)
- [Getting Started](#getting-started)
  - [Application Suite](#application-suite)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Tests](#tests)
- [Advanced Configuration](#advanced-configuration)
- [Usage](#usage)
- [Portability and Included Assets](#portability-and-included-assets)
- [Project Stats](#project-stats)
- [Project Structure](#project-structure)
- [Answer Quality](#answer-quality)
- [Security and Privacy](#security-and-privacy)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## About This Project

Kusanagi-AI was developed to address the growing need for accessible and privacy-conscious AI solutions within the research community. Our mission is to provide a free, open-source toolkit that enables researchers, especially those in Physics and Materials Science, to leverage advanced AI capabilities directly on their personal computers. By focusing on local execution, Kusanagi-AI ensures complete data privacy and eliminates reliance on cloud services, making sophisticated AI analysis available without specialised hardware or extensive technical expertise. This project is a testament to the power of local AI, offering a controlled environment for deep learning and practical application.

## Technology Stack
<p align="center">
  <a href="https://www.python.org" target="_blank" rel="noreferrer"> <img src="https://raw.githubusercontent.com/prathameshnium/static-files/main/icons/python.svg" alt="python" width="40" height="40"/> </a>
  <a href="https://ollama.com/" target="_blank" rel="noreferrer"> <img src="https://raw.githubusercontent.com/prathameshnium/static-files/main/icons/ollama.png" alt="ollama" width="45" height="45"/> </a>
  <a href="https://www.numpy.org" target="_blank" rel="noreferrer"> <img src="https://raw.githubusercontent.com/prathameshnium/static-files/main/icons/numpy.svg" alt="numpy" width="40" height="40"/> </a>
  <a href="https://tkdocs.com/index.html" target="_blank" rel="noreferrer"> <img src="http://pascal.ortiz.free.fr/_images/logo_tkinter.png" alt="tkinter" width="40" height="40"/> </a>
</p>
Kusanagi-AI is built with a focus on local execution, privacy, and ease of use. The core technologies include:
-   **Python + Tkinter**: The desktop apps, fully offline, with native lightweight GUIs.
-   **Ollama**: Powers the local large language model inference, allowing Kusanagi-AI to run various models efficiently on your machine without cloud dependencies.
-   **Plain JavaScript, no build step for scripts**: The browser suite is static HTML with one script per page, self-hosted libraries (pdf.js, KaTeX, marked, DOMPurify) and a precompiled Tailwind stylesheet. No backend, no bundler, no CDN.
-   **Embeddings** (desktop): Ships configured for `all-minilm` (small and fast). `mxbai-embed-large` is also recognised if you prefer quality over footprint -- set `embedding_model_name` in `System_Config.json`. The browser suite needs no embedding model: it ranks passages with BM25.

## Features

*   **Local & Private**: The desktop apps run 100% offline against Ollama. The browser apps parse documents in the tab and talk straight to the provider you configured; nothing passes through a Kusanagi server, because there is none.
*   **Efficient Local LLM Inference**: Designed to run up to three large language models concurrently on a decent laptop, providing robust AI capabilities without specialized hardware.
*   **Research Assistant (Orochimaru)**: The flagship, as a desktop app and as a browser app.
    *   **Multi-document RAG**: Load PDFs, Word, PowerPoint, OpenDocument, HTML, RTF or text files and ask across all of them at once, with `[answer:source]` citations to the excerpts actually used.
    *   **Skills**: Around 30 toggles -- summary, physicist / chemist / editor review, fact check, literature review, data extraction, BibTeX, quiz, flashcards, LaTeX, code review and more -- picked from a menu or typed as `/command`.
    *   **Saved chats**: Optionally written as Markdown files to a folder you choose, sorted into categories, and reopened later.
*   **Agentic Search (Kakashi)**: Searches the open web or academic papers and writes an answer cited against what it found, or skips the AI entirely.
*   **AI Visualizer**: Shows next-token predictions as you type.
 
## Screenshots

### Orochimaru — research assistant

<p align="center"><i>RAG over your own documents (PDF, Word, text, CSV, Markdown, HTML and more): load a paper, ask questions against it, switch on a summary or critical-review skill.</i></p>

![Orochimaru Screenshot](https://raw.githubusercontent.com/prathameshnium/static-files/main/projects/kusanagi-ai/Orochimaru_Screenshot.jpg)

### OneTail — local chat

![One Tail Screenshot](https://raw.githubusercontent.com/prathameshnium/static-files/main/projects/kusanagi-ai/One_Tail_Screenshot.jpg)

## Getting Started

Follow these steps to set up your local AI research environment.

### Application Suite

There are two ways to run Kusanagi-AI.

**Desktop (fully offline, no API key).** Tkinter apps that talk to a local Ollama.
Start them from the menu:

```sh
python local_apps/launcher.py
```

-   **`local_apps/Orochimaru_Local_Research_Assistent.py`** — the full RAG assistant: load PDFs, Word, text, CSV and other documents, chat, request expert reviews.
-   **`local_apps/OneTail_Local_Chatapp.py`** — lightweight multi-model chat.
-   **`local_apps/Visualize_AI.py`** — next-token predictions in real time.
-   **`local_apps/Kusanagi_Local.py`** — console and model manager.
-   **`local_apps/holffield_demo.py`** — Hopfield associative-memory demo.

All five share `local_apps/kusanagi_core.py`, which owns the project paths, the
colour palette, `System_Config.json` loading and the Ollama process manager.

**Browser (your own API key, nothing installed).** The pages in `web_apps/` run
against Gemini, Anthropic (Claude), Hugging Face, OpenRouter or a local Ollama. Open
[the dashboard](https://prathameshnium.github.io/Kusanagi-AI/index.html), or serve
them locally:

```sh
python scripts/serve.py
```

Serve them rather than double-clicking the HTML files. Two things need a real
origin: the strict `Content-Security-Policy` each page carries (`'self'` grants
nothing on a `file://` document), and Orochimaru's PDF reader, which loads
pdf.js as an ES module. The command above needs no network — everything it
serves is in this repository.

Saving chats to a folder uses the File System Access API, so it works in
Chrome and Edge; Firefox and Safari can still download a chat as Markdown.

### Prerequisites

*   **Python 3.8+**: The core programming language for Kusanagi-AI.
*   **Ollama**: Essential for running local large language models. Download and install Ollama from [https://ollama.com/](https://ollama.com/). Kusanagi-AI can also manage the Ollama server for you if configured correctly.

### Installation

1.  **Clone the repository:**
    <details>
      <summary>Click to expand</summary>
      
      ```sh
      git clone https://github.com/prathameshnium/Kusanagi-AI.git
      cd Kusanagi-AI
      ```
    </details>

2.  **Install the required Python packages:**
    It is highly recommended to use a virtual environment to manage dependencies.
    <details>
      <summary>Click to expand</summary>
      
      ```sh
      pip install -r requirements.txt
      ```
    </details>

3.  **Configure the System:**
    *   Open `System_Config.json` located in the project root.
    *   Ensure `ollama_path` accurately points to your Ollama executable (e.g., `F:\Portable_AI_Assets\ollama_main\ollama.exe`).
    *   Set `model_folder` to the directory where your Ollama models are stored.
    *   **Download Models**: Pull the necessary models using the Ollama CLI (or the PowerShell helpers in `scripts_to_pull/`). The default embedding model is `all-minilm`, and you'll need at least one chat model.
    <details>
      <summary>Click to expand</summary>
      
      ```sh
      ollama pull all-minilm
      ollama pull llama3 # or any other preferred chat model
      ```
    </details>

## Advanced Configuration

For more granular control, you can modify the `System_Config.json` file. This allows you to customize paths and model settings for different applications within the toolkit.

<details>
  <summary>Click to see configuration options</summary>

```json
{
    "ollama_path": "Portable_AI_Assets/ollama_main/ollama.exe",
    "model_folder": "Portable_AI_Assets/common-ollama-models",
    "vector_cache_dir": "Portable_AI_Assets/vector_cache",
    "embedding_model_name": "all-minilm",
    "default_model": "tinyllama:latest"
}
```
</details>

## Usage

The menu is the easiest way in, from the repository root:

```sh
python local_apps/launcher.py
```

Any app can also be started directly:

```sh
python local_apps/Orochimaru_Local_Research_Assistent.py
```

The flagship tool is **Orochimaru**: load a PDF, ask questions against it, and
request a summary or a critical review from a physicist, chemist or editor
persona. `OneTail_Local_Chatapp.py` is a lighter chat client, and
`Visualize_AI.py` shows next-token probabilities as you type.

For the browser versions, start the local server and pick a tool from the
dashboard:

```sh
python scripts/serve.py
```

## Portability and Included Assets

The desktop apps are built to run from a portable `Portable_AI_Assets` directory beside the repository, holding an Ollama executable and its models, so the whole setup can live on one drive. That directory is **not** part of this repository: no binaries or model weights are committed. Download Ollama yourself and pull the models you want (`scripts_to_pull/` has helpers for TinyLlama, Llama 3.2, Phi-3.5, all-minilm and mxbai-embed-large). Models that work well on a laptop include Gemma, Qwen and TinyLlama.

<p align="center">
  <img src="https://raw.githubusercontent.com/prathameshnium/static-files/main/icons/Gemma.jpg" alt="Gemma Logo" width="150"/>
  <img src="https://raw.githubusercontent.com/prathameshnium/static-files/main/icons/Qwen.jpg" alt="Qwen Logo" width="130"/>
  <img src="https://raw.githubusercontent.com/prathameshnium/static-files/main/icons/Tinylamma.jpg" alt="TinyLlama Logo" width="87"/>
</p>

**Important Note on Open-Source Projects**: We deeply respect and acknowledge the intellectual property of the original creators of these open-source projects. Kusanagi-AI merely works with these tools for enhanced portability and user convenience. We do not claim ownership over these projects.

Please refer to the original repositories for detailed information and licensing:

-   **Ollama:** [https://github.com/ollama/ollama](https://github.com/ollama/ollama)
-   **Gemma:** [https://github.com/google/gemma_pytorch](https://github.com/google/gemma_pytorch)
-   **Qwen:** [https://github.com/QwenLM/Qwen](https://github.com/QwenLM/Qwen)
-   **TinyLlama:** [https://github.com/jzhang38/TinyLlama](https://github.com/jzhang38/TinyLlama)

## Project Stats
<p align="center">
  <img src="https://github-readme-stats.vercel.app/api/top-langs/?username=prathameshnium&repo=Kusanagi-AI&layout=compact&theme=transparent&bg_color=193549&title_color=ffab40&text_color=ffffff" alt="Top Languages" />
  &nbsp;
  <img src="https://github-readme-activity-graph.vercel.app/graph?username=prathameshnium&repo=Kusanagi-AI&bg_color=193549&color=ffffff&line=ffab40&point=ffffff&area=true&hide_border=true" alt="Activity Graph" />
</p>

## Project Structure
<details>
  <summary>Click to expand</summary>

```
Kusanagi-AI/
├── index.html                  Dashboard: configure providers, launch a tool
├── web_apps/                   Kakashi, Orochimaru, Visualize (+ Neji and
│                               OneTail, which only forward to the merged apps)
├── static/
│   ├── keys.js                 API-key store (session-scoped by default)
│   ├── providers.js            Gemini / Anthropic / HF / OpenRouter / Ollama,
│   │                           streaming, Claude options and web tools
│   ├── dom.js                  Safe DOM construction + Markdown sanitising
│   ├── prompts.js              Shared system prompts and the skills list
│   ├── ui.js                   Settings dialog, toasts, result cards, read aloud
│   ├── chats.js                Saving chats as Markdown to a chosen folder
│   ├── theme.js                Black / blue theme switch
│   ├── thinking.js             "Thinking..." phrases (generated)
│   ├── pages/                  One script per page
│   ├── kusanagi.css            Compiled Tailwind (generated)
│   ├── src/input.css           Stylesheet source — edit this one
│   └── vendor/                 Self-hosted libraries and fonts (see its README)
├── local_apps/
│   ├── kusanagi_core.py        Shared paths, palette, config, Ollama manager
│   ├── launcher.py             Desktop menu
│   └── *.py                    The desktop apps
├── scripts/
│   ├── serve.py                Local web server for the suite
│   ├── build_css.py            Compile static/src/input.css → static/kusanagi.css
│   ├── check_models.py         Validate model IDs against the live APIs
│   ├── make_thinking.py        Regenerate static/thinking.js
│   └── fetch_fonts.py          Re-vendor the webfonts
├── scripts_to_pull/            PowerShell helpers to pull Ollama models
├── tests/                      pytest suite (no browser, no network)
├── Portable_AI_Assets/         Ollama binary + models (not in git)
├── System_Config.json
└── requirements.txt
```
</details>

### Tests

```sh
pip install pytest
python -m pytest tests/
```

No browser and no network needed. Alongside the usual unit tests of
`kusanagi_core.py`, the suite asserts the security properties the web apps are
supposed to have, so a regression fails the build rather than shipping:

- every page's CSP is present and actually strict (no `unsafe-inline`/`unsafe-eval`)
- no inline scripts, styles or `on*=` handlers anywhere
- no third-party origin is referenced, and every local asset resolves
- every element id a page script looks up exists in that page's HTML
- `connect-src` matches the endpoints each page really uses, **in both
  directions** — a missing entry breaks a fetch, a stale one is usually a data
  source that quietly died
- `innerHTML` appears nowhere outside the sanitising helper in `dom.js`
- no provider is half-removed, and a retired provider's stored key is purged

Model IDs go stale silently, so they are checked separately against the live
APIs (this needs network, and keys for the providers you want covered):

```sh
python scripts/check_models.py --gemini-key "$GEMINI_API_KEY"
```

### Rebuilding the stylesheet

`static/kusanagi.css` is generated. After changing any CSS or any HTML class:

```sh
python scripts/build_css.py
```

No Node required — the script fetches the standalone Tailwind binary on first run
and caches it outside the repo.

## Answer quality

The prompts in `static/prompts.js` are built from one shared rigour preamble, so
the standard is the same across the suite and can be raised in one place. It
targets the specific ways chat models fail on technical questions:

- **No invented citations.** A DOI, author list or year may only appear if it
  came from the sources supplied in the prompt.
- **Claims are marked by standing** — established, contested, or the model's own
  inference — so a guess cannot pass as consensus.
- **Numbers carry units and measurement conditions.** A permittivity with no
  temperature, field or sample geometry is not an answer.
- **Refusing is a valid answer.** "I cannot answer this from the available
  sources" is explicitly requested over a plausible fabrication.

**Kakashi is grounded.** It searches Wikipedia, OpenAlex, Crossref, DuckDuckGo
and Hacker News, then passes those results into the prompt and requires inline
`[n]` citations resolving to a Sources list of real links. Previously the search
and the answer ran independently — the model answered from memory while results
appeared beside it — so nothing it cited could be checked against what was found.
Neji was merged into it as **Academic mode** (the old Neji address forwards
there): papers only, from OpenAlex and Crossref, shown with authors, year,
citations and abstract, filterable by year and sortable by date or citations,
with the answer written as a short literature review. **No AI**, in either mode,
searches the raw query without contacting any model, so it needs no key and
nothing is sent to an AI provider.

**Orochimaru** (the web chat; OneTail was merged into it, and the old OneTail
address forwards there) is a multi-turn research chat. With no documents loaded
it answers from general knowledge, citing papers it recalls with a DOI only when
certain and otherwise a Google Scholar search for the exact title, so a link can
never point at an invented record. Documents can be PDF, Word (`.docx`),
OpenDocument (`.odt`), PowerPoint (`.pptx`), HTML, RTF, or any text format
(`.txt`, `.md`, `.csv`, `.tsv`, `.dat`, `.json`, `.xml`, `.tex`, ...). Once
documents are loaded, **Answer from** picks the grounding: *Documents + general
knowledge* (the default) uses the excerpts first and labels every sentence that
comes from outside them; *Documents only* answers from the retrieved excerpts
and refuses anything they do not cover. Retrieved text is fenced and the model
is told never to follow instructions inside it.

**Retrieval** runs over every loaded document at once. Documents are cut into
overlapping ~1,000-character pieces that end on a sentence, and **Search documents by** picks
how pieces are ranked: *Smart (BM25)*, the default, weights rare words above
common ones and matches word forms ("measured" meets "measuring"), and folds in
the previous question so a follow-up finds the passage the chat is about;
*Original (exact words)* counts the query words as written, for when the
precise term matters. With Claude as the provider, a file can instead be **sent
whole**, so the model reads all of it (PDFs and images as they are) — see
Security and privacy for what that means.

Citations are academic-style: the model writes `[n]` and the page shows it as
`[answer:source]` (so `[1:2]` is the second source of the first answer), linked
to that answer's reference list. The page builds the list from the sources it
actually sent, so no link in it can be invented.

**Skills** are toggles, grouped into answer style (Explain simply, Expert depth,
Concise, Shorter, Socratic tutor — one at a time), review (Summarise, Physicist /
Chemist / Editor review, Fact check, Devil's advocate), research (Literature
review, Compare, Extract data, Research plan, BibTeX), study (Quiz me,
Flashcards, Glossary), writing (Outline, Proofread, Doc co-authoring, Slide
outline, LaTeX) and code. While one is on it shapes every answer. Type `/` in
the chat box to pick one: `/skill` on its own switches it on and runs it at once
(over the loaded documents, or on the last answer), and `/skill question`
switches it on and asks.

**Chats.** Answers stream in as they are written. Under **Chat history**,
choose a folder and each chat is saved there as a Markdown file as you go,
readable anywhere and reopenable later; chats can be filed into categories.
**No history** pauses saving for the current chat, and **Clear** deletes the
chat's file and drops every loaded document. Any chat can also be downloaded as
Markdown. On wide screens the sidebar folds away.

**Claude options.** With Anthropic as the provider, Settings (and the controls
beside each chat or search box) set thinking **effort**, a **Reasoning** box with
Claude's summarised thinking, prompt caching (on by default, so each turn
re-reads the documents and history at about a tenth of the price), US-only
inference, fast mode, and Claude's own **web search and fetch**, with an
optional cap per answer.

**Formatting.** Every prose answer is Markdown with all mathematics, symbols and
chemical formulas in LaTeX, typeset in the page by the vendored KaTeX (with
`trust` off, so TeX cannot create links). Code blocks get a language label and a
Copy button. Each answer has **Copy** (the Markdown source, LaTeX intact) and
**Read aloud** buttons; the chat header has **Copy chat** and **Read chat
aloud**. Read aloud can use voices on this device or the browser's online
voices, with pause, previous and next. Pages open in **black mode** (true
black); the moon button switches to the blue theme, and the choice is remembered.

## Security and privacy

What the web apps actually guarantee, and what they do not.

**Providers.** Google Gemini, Anthropic (Claude), Hugging Face, OpenRouter, or a
local Ollama.
If a model is retired, rate-limited or overloaded, the app falls back to the
next model from the *same* provider and tells you which one answered. It never
switches provider on its own — silently re-sending your question, or your
document excerpts, to a different company is not a decision a retry should
make. Turn it off in Settings.

**Your keys.** A key you enter is held in `sessionStorage` and disappears when the
tab closes. Ticking *Remember on this device* stores it **encrypted**: the browser
derives a key from a password you choose (at least 8 characters, 12+ recommended;
PBKDF2-SHA-256, 600,000 rounds, random salt) and seals your keys with AES-256-GCM. Only that ciphertext is written to
`localStorage`. The password is never stored and never sent anywhere; you type it
once per tab session to unlock, and if it is lost the keys cannot be recovered —
purge and re-enter them. Keys an older version saved unencrypted are flagged on the
dashboard with a one-click *Encrypt them*. Nothing in the key store makes a network
request: the only place a key ever travels is the request to the provider that
issued it. There is no Kusanagi server: requests go from your browser straight to
the provider. Gemini keys are
sent in the `x-goog-api-key` header rather than the query string, so they do not
end up in browser history or in proxy logs; the others use `Authorization:
Bearer`. OpenRouter's optional `HTTP-Referer`/`X-Title` headers are deliberately
not sent, since they feed a public leaderboard. Anthropic only accepts browser
requests that opt in with `anthropic-dangerous-direct-browser-access`, and warns
that a key used this way is visible to the page: give Kusanagi a dedicated key
with an expiry, in a workspace with a spend limit. A key whose prefix belongs to a
different provider is refused, at save time and again before any request, so a
mis-pasted key is never sent to the wrong company. *Purge all keys* clears both
stores.

**Your documents.** Documents opened with **Load document** (or *Read here
(private)* on a drop) are parsed in the browser and held in memory; only the
excerpts retrieved for a question are sent to whichever provider you configured,
as part of the prompt. **Send whole file to AI** is different: the provider
(currently Anthropic only) receives the entire file with every message, inline
rather than through a file store, and the page asks before each file goes. For
work that must not leave the machine at all, use the desktop app against a local
Ollama.

**Your chats.** Nothing is saved until you choose a folder; then chats are plain
Markdown files on your disk. The browser remembers only the folder handle (in
IndexedDB) and asks for permission again each session. **No history** stops
saving on this device, but is not private mode: the provider still receives
every message.

**Read aloud.** Device voices run locally. Online voices send the text being
read to the browser vendor's speech service (Microsoft for Edge, Google for
Chrome); the Settings dialog says so where you pick one.

**Claude's web tools.** When web search or fetch is on, Anthropic runs the
searches and fetches itself; the browser still talks only to
`api.anthropic.com`. The pages Claude used are listed under the answer.

**Untrusted content.** Paper titles, abstracts and model output are third-party
text. It is rendered as text nodes, never by assigning to `innerHTML`; the one
exception is Markdown from a model, which goes through DOMPurify. Outbound links
are scheme-checked, so a `javascript:` DOI renders as inert text.

**Content-Security-Policy.** Every page ships `default-src 'none'` with an
explicit allowlist: no inline script, no inline style, no third-party origin, and
a `connect-src` naming exactly the APIs that page uses. An injected script could
not reach an endpoint that is not on that list. `frame-ancestors` cannot be set
from a `<meta>` tag; `scripts/serve.py` sends it as a header, and a production
deployment should too.

**Dependencies.** Every library and font is committed under `static/vendor/`, so
no page load reaches a CDN. See [`static/vendor/README.md`](static/vendor/README.md)
for versions and why they were chosen.

Found something? Please [open an issue](https://github.com/prathameshnium/Kusanagi-AI/issues).

## Roadmap

We are continuously working to enhance Kusanagi-AI. Here are some of the features and improvements on our roadmap:

-   **Enhanced RAG Capabilities**:
    -   **Multi-Document Chat**: Done in the web Orochimaru (retrieval ranks across every loaded document); the desktop app remains.
    -   **Fact-Checking Mode**: A *Fact check* skill is in the web app; highlighting the supporting passage in the source remains.
    -   **Advanced Reviewer Personas**: Introduce more specialized reviewer roles for nuanced academic feedback.

-   **UI and UX Improvements**:
    -   **Integrated Visualizer**: Merge the AI Visualizer into the main applications to provide real-time insights into model behavior.
    -   **UI Theming**: Black mode is in; further themes could follow the same CSS variables.

-   **Core Functionality Expansion**:
    -   **Support for More Filetypes**: Done for Word, OpenDocument, PowerPoint, HTML, RTF and text formats; spreadsheets (`.xlsx`) and scanned PDFs (OCR) remain.
    -   **Model Fine-Tuning**: Provide scripts and guides for users to fine-tune models on their specific research datasets.

## Contributing

This project is proudly developed and maintained by **Prathamesh Deshmukh**.

We welcome contributions from the community! Whether it's bug reports, feature suggestions, or code contributions, your input is valuable. Please feel free to open an issue or submit a pull request on GitHub.

## License

This project is released under the [MIT License](./LICENSE).

## Disclaimer

Kusanagi-AI is a open-source project provided for educational and research purposes. While designed for robust local AI operations, it is offered "as-is" without warranty. Users are encouraged to explore, adapt, and extend its functionalities for their specific needs.

<p align="right"><a href="#top">Back to top</a></p>
