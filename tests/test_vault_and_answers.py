"""Tests for the encrypted key vault, answer formatting, and copy.

Static checks on the JavaScript, in the style of the rest of the suite. They
pin the properties that matter rather than the wording:

  - a remembered key is only ever written to disk encrypted, and the vault
    code can make no network request at all;
  - the key derivation stays strong;
  - answers are asked for in Markdown + LaTeX, and the renderer typesets LaTeX
    without ever turning it back into HTML;
  - retrieved text is fenced off as untrusted.
"""
import pytest
import io
import os
import re

from conftest import strip_js_comments

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


KEYS = strip_js_comments(read("static", "keys.js"))
PROMPTS = read("static", "prompts.js")
DOM = strip_js_comments(read("static", "dom.js"))


# --------------------------------------------------------------------------
# Keys never reach the web, and never hit the disk in plain text
# --------------------------------------------------------------------------

def test_key_store_makes_no_network_requests():
    """Saved keys and the vault password must never leave the browser."""
    for call in ("fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource",
                 "import(", "new Image", "postMessage"):
        assert call not in KEYS, "keys.js must not use %s" % call


def test_set_never_writes_a_key_to_local_storage():
    """Plain-text persistence is gone; remembering goes through the vault."""
    body = KEYS.split("set: function (provider, value)")[1].split("remove: function")[0]
    assert "local.set(" not in body
    assert "dropLegacyKey(provider)" in body, "a stale plain-text copy should be dropped"


def test_only_ciphertext_is_written_to_local_storage():
    """No key is written to localStorage in plain text, not even by the legacy
    migration, which used to copy old keys under new names."""
    writes = re.findall(r"local\.set\(([^,]+),", KEYS)
    allowed = {"VAULT", "NS + 'provider'", "NS + 'migrated'", "NS + 'model_fallback'", "NS + 'chime'"}
    for target in writes:
        assert target.strip() in allowed, "unexpected localStorage write: %s" % target


def test_stored_iteration_count_is_bounded():
    """A tampered blob must not be able to hang the tab with a huge count."""
    body = KEYS.split("function openBlob")[1].split("function sealBlob")[0]
    assert "blob.iter >= VAULT_ITERATIONS" in body and "blob.iter <= 5000000" in body


def test_keys_cannot_change_while_the_vault_is_locked():
    """Otherwise the vault's copy comes back on unlock and undoes the change."""
    assert "isLocked: function" in KEYS
    ui = strip_js_comments(read("static", "ui.js"))
    assert "if (vault.isLocked())" in ui
    index = strip_js_comments(read("static", "pages", "index.js"))
    assert index.count("if (refuseWhileLocked()) return;") == 2


def test_sources_cannot_fake_the_fence():
    assert "function fenceSafe" in PROMPTS
    body = PROMPTS.split("function sourcesBlock")[1].split("function deepResearch")[0]
    for field in ("item.title", "item.meta", "item.url", "item.snippet"):
        assert "fenceSafe(%s)" % field in body, field


def test_math_regex_avoids_lookbehind():
    """Lookbehind is a SyntaxError on Safari before 16.4 and would kill dom.js."""
    assert "(?<=" not in DOM and "(?<!" not in DOM


def test_vault_password_is_never_stored():
    for line in KEYS.splitlines():
        if re.search(r"\b(session|local)\.set\(", line):
            assert "password" not in line.lower(), line.strip()


def test_vault_uses_strong_authenticated_encryption():
    assert "'AES-GCM'" in KEYS and "length: 256" in KEYS
    assert "'PBKDF2'" in KEYS and "hash: 'SHA-256'" in KEYS
    iterations = int(re.search(r"VAULT_ITERATIONS = (\d+)", KEYS).group(1))
    assert iterations >= 600000, "OWASP's PBKDF2-SHA-256 floor is 600,000"
    assert "getRandomValues(new Uint8Array(16))" in KEYS, "16-byte random salt"
    assert "getRandomValues(new Uint8Array(12))" in KEYS, "12-byte random IV"
    # The derived key is created non-extractable, so script cannot export it.
    assert re.search(r"\{ name: 'AES-GCM', length: 256 \},\s*false,", KEYS)


def test_new_vault_requires_a_long_password():
    minimum = int(re.search(r"VAULT_MIN_PASSWORD = (\d+)", KEYS).group(1))
    assert minimum >= 12


def test_purge_destroys_the_vault():
    body = KEYS.split("purge: function")[1].split("},\n    };")[0]
    assert "vault.destroy()" in body


def test_settings_inputs_are_cleared_on_close():
    ui = strip_js_comments(read("static", "ui.js"))
    close = ui.split("function close()")[1].split("}")[0]
    for name in ("keyInput", "vaultPassword", "vaultConfirm", "unlockPassword"):
        assert "%s.value = ''" % name in close, name


# --------------------------------------------------------------------------
# Answers: Markdown + LaTeX, rendered safely
# --------------------------------------------------------------------------

def test_prose_prompts_ask_for_latex():
    assert "in LaTeX" in PROMPTS.split("var FORMAT")[1].split("].join")[0]
    for builder in ("deepResearch", "documentQa", "review", "summarise", "chatSystemPrompt"):
        body = PROMPTS.split("function %s(" % builder)[1].split("\n    }\n")[0]
        assert "FORMAT" in body, "%s does not ask for the shared format" % builder


def test_json_prompts_do_not_carry_the_prose_format():
    for builder in ("tokenProbabilities", "searchStrategies"):
        body = PROMPTS.split("function %s(" % builder)[1].split("\n    }\n")[0]
        assert "FORMAT" not in body and "RIGOUR" not in body, builder


def test_chat_references_are_linked_without_invented_dois():
    block = PROMPTS.split("var REFERENCES_FROM_MEMORY")[1].split("].join")[0]
    # Match the whole instruction, not a bare URL substring: this checks prompt
    # wording, it does not sanitise a URL.
    assert re.search(r"then a link: https://doi\.org/<DOI>", block)
    assert "only if you are certain" in block
    assert re.search(r"\]\(https://scholar\.google\.com/scholar\?q=", block)
    assert "REFERENCES_FROM_MEMORY" in PROMPTS.split("function chatSystemPrompt")[1]


def test_retrieved_text_is_marked_untrusted():
    assert "END OF SOURCES" in PROMPTS
    block = PROMPTS.split("var UNTRUSTED_SOURCES")[1].split("].join")[0]
    assert "ignore them" in block
    for builder in ("deepResearch", "documentQa", "review", "summarise"):
        body = PROMPTS.split("function %s(" % builder)[1].split("\n    }\n")[0]
        assert "UNTRUSTED_SOURCES" in body, builder


def test_math_is_restored_as_text_not_markup():
    """TeX goes back into the DOM as nodeValue, so it can never become HTML;
    KaTeX then typesets it with trust off."""
    restore = DOM.split("function restoreMath")[1].split("function typesetMath")[0]
    assert "node.nodeValue" in restore and "innerHTML" not in restore
    typeset = DOM.split("function typesetMath")[1]
    assert "trust: false" in typeset
    assert "protectMath(source)" in DOM and "restoreMath(target" in DOM


def test_answer_pages_load_katex():
    for page in ("Kakashi_Search.html", "Orochimaru_Web_Research_Assistent.html"):
        html = read("web_apps", page)
        assert "vendor/katex/katex.min.js" in html, page
        assert "vendor/katex/auto-render.min.js" in html, page
        assert "vendor/katex/katex.min.css" in html, page


def test_prose_styles_are_compiled():
    css = read("static", "kusanagi.css")
    for rule in (".prose ul", ".prose ol", ".prose h2", ".prose a", ".katex-display"):
        assert rule in css, "%s missing from the compiled CSS" % rule


# --------------------------------------------------------------------------
# Copy
# --------------------------------------------------------------------------

def test_chat_offers_copy_message_and_copy_chat():
    source = strip_js_comments(read("static", "pages", "orochimaru.js"))
    assert "K.ui.copyButton(" in source
    assert "chatAsMarkdown" in source
    assert 'id="copy-chat"' in read("web_apps", "Orochimaru_Web_Research_Assistent.html")


# --------------------------------------------------------------------------
# Read aloud, per answer
# --------------------------------------------------------------------------

def test_every_answer_can_be_read_aloud():
    for page in ("orochimaru.js", "kakashi.js"):
        source = strip_js_comments(read("static", "pages", page))
        assert "K.ui.speakButton(" in source, page
        assert "K.ui.speakableText(body)" in source, page


def test_speech_reads_rendered_text_not_tex():
    ui = strip_js_comments(read("static", "ui.js"))
    body = ui.split("function speakableText")[1].split("function bindSpeak")[0]
    assert ".katex-html" in body and "annotation" in body


def test_long_answers_are_spoken_in_pieces():
    """Chrome cuts a single long utterance off after ~15 seconds."""
    ui = strip_js_comments(read("static", "ui.js"))
    assert "function speechPieces" in ui
    assert "speechPieces(text)" in ui


# --------------------------------------------------------------------------
# OneTail merged into Orochimaru
# --------------------------------------------------------------------------

def test_onetail_page_only_forwards_to_orochimaru():
    html = read("web_apps", "OneTail_Web_Chatapp.html")
    assert 'http-equiv="refresh"' in html
    assert "url=Orochimaru_Web_Research_Assistent.html" in html
    assert "<script" not in html
    assert not os.path.exists(os.path.join(ROOT, "static", "pages", "onetail.js"))


def test_dashboard_no_longer_lists_onetail():
    assert "OneTail_Web_Chatapp" not in read("static", "pages", "index.js")


def test_document_mode_toggle_is_wired():
    html = read("web_apps", "Orochimaru_Web_Research_Assistent.html")
    assert 'id="answer-mode"' in html
    assert 'value="strict"' in html and 'value="normal"' in html
    source = strip_js_comments(read("static", "pages", "orochimaru.js"))
    assert "ui.mode.value === 'strict'" in source


def test_strict_mode_forbids_background_knowledge():
    body = PROMPTS.split("function chatTurn")[1].split("var REVIEW_PERSONAS")[0]
    strict = body.split("var mode = strict")[1].split(": [")[0]
    assert "nothing else" in strict
    assert "not even with a labelled guess" in strict
    assert "(background, not from the documents)" in body.split(": [")[1]


# --------------------------------------------------------------------------
# Neji merged into Kakashi
# --------------------------------------------------------------------------

def test_neji_page_only_forwards_to_kakashi_academic_mode():
    html = read("web_apps", "Neji_Search.html")
    assert "url=Kakashi_Search.html?mode=academic" in html
    assert "<script" not in html
    assert not os.path.exists(os.path.join(ROOT, "static", "pages", "neji.js"))
    assert "Neji_Search" not in read("static", "pages", "index.js")


def test_kakashi_has_both_modes_and_no_ai():
    html = read("web_apps", "Kakashi_Search.html")
    assert 'id="search-mode"' in html and 'value="academic"' in html
    assert 'id="no-ai"' in html
    assert 'id="filter-year"' in html and 'id="filter-sort"' in html
    source = strip_js_comments(read("static", "pages", "kakashi.js"))
    assert "mode=academic" in source, "the Neji redirect must land in Academic mode"
    assert "fetchOpenAlex(p, 5), fetchCrossref(p, 3)" in source


def test_no_ai_mode_never_calls_a_model():
    source = strip_js_comments(read("static", "pages", "kakashi.js"))
    expand = source.split("function expandQuery")[1].split("function runSearches")[0]
    first_line = expand.split("{", 1)[1].strip().splitlines()[0]
    assert first_line == "if (noAI()) return Promise.resolve([query]);", \
        "No AI must return before any model is asked to expand the query"
    flow = source.split("function search(query)")[1].split("function expandQuery")[0]
    assert "if (noAI()) return null;" in flow, "no answer may be requested in No AI mode"
    assert "!noAI() && !apiKey()" in flow, "No AI must work without a key"


def test_academic_answer_is_a_literature_review():
    body = PROMPTS.split("function deepResearch(")[1].split("\n    }\n")[0]
    assert "academic" in body and "literature review" in body


def test_general_knowledge_is_the_default_answer_mode():
    html = read("web_apps", "Orochimaru_Web_Research_Assistent.html")
    assert '<option value="normal" selected>' in html
    assert '<option value="strict" selected>' not in html


@pytest.mark.parametrize("ext", ["pdf", "docx", "odt", "pptx", "txt", "md", "csv",
                                 "tsv", "dat", "json", "html", "rtf"])
def test_orochimaru_accepts_common_document_types(ext):
    html = read("web_apps", "Orochimaru_Web_Research_Assistent.html")
    accept = html.split('id="doc-upload" accept="')[1].split('"')[0]
    assert "." + ext in accept.split(",")
    source = strip_js_comments(read("static", "pages", "orochimaru.js"))
    assert "'%s'" % ext in source


def test_office_files_cannot_unzip_without_limit():
    source = strip_js_comments(read("static", "pages", "orochimaru.js"))
    assert "MAX_UNZIPPED_BYTES" in source and "budget.left < 0" in source


def test_skills_are_toggles_that_reach_the_prompt():
    html = read("web_apps", "Orochimaru_Web_Research_Assistent.html")
    assert 'id="skill-list"' in html and 'id="active-skills"' in html
    source = strip_js_comments(read("static", "pages", "orochimaru.js"))
    assert "'aria-pressed': String(on)" in source
    assert "function toggleSkill(id, quiet)" in source
    assert "skillsBlock(skillIds)" in PROMPTS.split("function chatTurn")[1].split("\n    }\n")[0]


def test_chat_system_prompt_is_frozen_for_the_prompt_cache():
    """Anthropic's cache is a prefix match: anything that varies per turn in
    the system prompt would make every turn a cache miss."""
    body = PROMPTS.split("function chatSystemPrompt(")[1].split("\n    }\n")[0]
    assert body.startswith(")"), "chatSystemPrompt must take no arguments"
    source = strip_js_comments(read("static", "pages", "orochimaru.js"))
    assert "history.slice(-MAX_TURNS / 2)" in source
    providers = read("static", "providers.js")
    assert "cache_control: { type: 'ephemeral' } }]" in providers
    assert "if (cache && opts && opts.conversation)" in providers
