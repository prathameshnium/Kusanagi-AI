"""Tests for the shared prompt layer and the model-fallback chain.

Static checks on the JavaScript. The runtime behaviour of the chain is driven
from the browser; what these guard is that the wiring stays in place -- that a
page cannot quietly go back to an inline prompt or a bare call() with no
fallback, and that a rejected key never triggers a retry storm.
"""
import io
import os
import re

import pytest

from conftest import strip_js_comments

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
PAGES = os.path.join(STATIC, "pages")

# Pages that actually send a prompt to a model.
MODEL_PAGES = ["kakashi.js", "neji.js", "onetail.js", "orochimaru.js", "visualize.js"]


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


@pytest.fixture(scope="module")
def prompts_js():
    return read("static", "prompts.js")


@pytest.fixture(scope="module")
def providers_code():
    return strip_js_comments(read("static", "providers.js"))


# --------------------------------------------------------------------------
# The prompt layer exists and says what it needs to
# --------------------------------------------------------------------------

def test_prompts_module_exports_every_builder(prompts_js):
    for name in ("deepResearch", "documentQa", "review", "summarise",
                 "chatSystemPrompt", "searchStrategies", "sourcesBlock"):
        assert re.search(r"\b%s: %s," % (name, name), prompts_js), name


@pytest.mark.parametrize("rule", [
    "Never invent a citation",
    "established consensus",
    "units",
    "cannot answer this from the available sources",
])
def test_rigour_preamble_keeps_its_core_rules(prompts_js, rule):
    """These are the four that stop a confident wrong answer: no fabricated
    citations, claims marked by standing, numbers with units, and permission
    to refuse."""
    block = prompts_js.split("var RIGOUR")[1].split("].join")[0]
    assert rule in block, "the rigour preamble no longer mentions %r" % rule


def test_citation_rules_require_resolvable_links(prompts_js):
    block = prompts_js.split("var CITATION_RULES")[1].split("].join")[0]
    assert "Markdown link" in block
    assert "<url>" in block
    assert "Do not list sources you did not cite" in block


def test_sources_block_is_numbered_to_match_inline_citations(prompts_js):
    """Inline [n] markers are only checkable if the list is numbered the same way."""
    assert "'[' + (index + 1) + '] '" in prompts_js
    assert "'SOURCES\\n'" in prompts_js


def test_source_snippets_are_truncated(prompts_js):
    """One long abstract must not crowd the question out of a small context."""
    assert "snippetLimit" in prompts_js
    assert re.search(r"limit = snippetLimit \|\| \d+", prompts_js)


def test_document_qa_refuses_rather_than_filling_gaps(prompts_js):
    body = prompts_js.split("function documentQa")[1].split("function review")[0]
    assert "do not fill the gap" in body
    assert "nothing else" in body


# --------------------------------------------------------------------------
# Pages use the shared prompts
# --------------------------------------------------------------------------

@pytest.mark.parametrize("page", MODEL_PAGES)
def test_pages_do_not_carry_inline_system_prompts(page):
    """A prompt inlined in a page drifts away from the shared standard."""
    source = strip_js_comments(read("static", "pages", page))
    smells = ["You are a", "You are Kakashi", "You are Orochimaru",
              "Return ONLY a JSON array"]
    found = [s for s in smells if s in source]
    assert not found, "%s has an inline prompt: %s" % (page, found)


def test_kakashi_grounds_its_answer_in_retrieved_results():
    """The search used to run alongside the answer without feeding it, so any
    citation the model produced was unverifiable."""
    source = strip_js_comments(read("static", "pages", "kakashi.js"))
    assert "K.prompts.deepResearch(query, sources)" in source
    assert "function synthesise(query, results)" in source
    assert "return unique;" in source, "runSearches must hand its results back"


def test_orochimaru_passes_retrieved_chunks_to_the_prompt():
    source = strip_js_comments(read("static", "pages", "orochimaru.js"))
    assert "K.prompts.documentQa(query, chunks, docNames())" in source
    assert "K.prompts.review(" in source
    assert "K.prompts.summarise(" in source


def test_onetail_sends_the_rigour_preamble_as_a_system_message():
    source = strip_js_comments(read("static", "pages", "onetail.js"))
    assert "K.prompts.chatSystemPrompt()" in source
    assert "role: 'system'" in source


def test_system_prompt_is_not_trimmed_away_by_history_limits():
    """Prepending it to the trimmed slice keeps it present on long chats."""
    source = strip_js_comments(read("static", "pages", "onetail.js"))
    assert re.search(r"\[\{ role: 'system'.*\}\]\s*\n?\s*\.concat\(history\.slice",
                     source, re.S)


def test_prompts_js_is_loaded_by_every_page_that_uses_it(page_sources):
    for name, html in page_sources.items():
        script = re.search(r'src="[^"]*static/pages/([a-z]+\.js)"', html)
        if not script or script.group(1) not in MODEL_PAGES:
            continue
        source = read("static", "pages", script.group(1))
        if "K.prompts" not in source:
            continue
        assert "static/prompts.js" in html, "%s uses prompts but does not load it" % name
        assert html.index("prompts.js") < html.index(script.group(1)), \
            "%s loads prompts.js after the page script" % name


# --------------------------------------------------------------------------
# Fallback chain
# --------------------------------------------------------------------------

def test_fallback_is_exported(providers_code):
    assert "callWithFallback: callWithFallback," in providers_code


def test_fallback_stays_within_one_provider(providers_code):
    """Re-sending a researcher's question to a different company because one
    model was busy is not a decision this layer should make silently."""
    body = providers_code.split("function callWithFallback")[1].split("function callJson")[0]
    assert "models(provider)" in body
    assert "PROVIDERS" not in body


def test_auth_and_billing_failures_are_not_retryable(providers_code):
    """Walking the whole chain on a bad key wastes six requests to learn nothing."""
    body = providers_code.split("function providerError")[1].split("function toMessages")[0]
    for status, section in (("401", "key rejected"), ("402", "out of credit")):
        assert section in body
    # Only the transient branches set the flag.
    retry_lines = [l for l in body.splitlines() if "retryable = true" in l]
    assert len(retry_lines) == 3, "expected 404 / 429 / 5xx to be the retryable set"


@pytest.mark.parametrize("status", ["404", "429", "500"])
def test_transient_failures_are_retryable(providers_code, status):
    body = providers_code.split("function providerError")[1].split("function toMessages")[0]
    marker = "resp.status >= 500" if status == "500" else "resp.status === %s" % status
    assert marker in body
    branch = body.split(marker)[1].split("else if")[0].split("} else {")[0]
    assert "retryable = true" in branch, "%s should be retryable" % status


def test_timeouts_are_retryable(providers_code):
    assert "timeout.retryable = true" in providers_code


def test_empty_completions_are_retryable(providers_code):
    """A safety refusal or blank completion is worth trying another model for."""
    assert "empty.retryable = true" in providers_code
    assert "blank.retryable = true" in providers_code


def test_fallback_reports_which_model_answered(providers_code):
    body = providers_code.split("function callWithFallback")[1].split("function callJson")[0]
    assert "model: model," in body
    assert "attempts" in body


@pytest.mark.parametrize("page", ["kakashi.js", "onetail.js", "orochimaru.js"])
def test_answer_paths_use_the_fallback_chain(page):
    source = strip_js_comments(read("static", "pages", page))
    assert "K.callWithFallback(" in source, "%s does not use the fallback" % page
    assert "fallback: K.prefs.modelFallback()" in source, \
        "%s ignores the user's fallback preference" % page


@pytest.mark.parametrize("page", ["kakashi.js", "onetail.js", "orochimaru.js"])
def test_pages_tell_the_user_when_a_different_model_answered(page):
    source = strip_js_comments(read("static", "pages", page))
    assert "res.model !== ui.model.value" in source, \
        "%s silently substitutes a model" % page


# --------------------------------------------------------------------------
# The preference
# --------------------------------------------------------------------------

def test_fallback_preference_defaults_to_on():
    keys = strip_js_comments(read("static", "keys.js"))
    assert "modelFallback" in keys
    assert "!== '0'" in keys, "default should be on unless explicitly disabled"


def test_preference_store_is_separate_from_the_key_store():
    """A preference must never be mistaken for a credential."""
    keys = read("static", "keys.js")
    assert "window.Kusanagi.prefs = prefs;" in keys
    assert "var prefs = {" in keys
    prefs_block = keys.split("var prefs = {")[1].split("\n    };")[0]
    assert "_key" not in prefs_block


def test_settings_dialog_exposes_the_toggle():
    ui = read("static", "ui.js")
    assert "settings-fallback" in ui
    assert "prefs.setModelFallback(fallbackBox.checked)" in ui
    assert "prefs.modelFallback()" in ui
