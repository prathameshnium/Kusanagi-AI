"""Tests for the provider layer: static/providers.js, keys.js and the pages.

These are static checks on the JavaScript source. They cannot prove a request
succeeds, but they catch the failure modes this project has actually hit: a
provider half-removed, a model list that no page can reach, an endpoint missing
from connect-src, and a key ending up somewhere it should not.
"""
import io
import os
import re

import pytest

from conftest import strip_js_comments

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
PAGES = os.path.join(STATIC, "pages")

SUPPORTED = {"gemini", "hf", "openrouter", "ollama"}
RETIRED = {"groq"}


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


@pytest.fixture(scope="module")
def providers_js():
    return read("static", "providers.js")


@pytest.fixture(scope="module")
def providers_code(providers_js):
    """providers.js with comments removed, for absence assertions."""
    return strip_js_comments(providers_js)


@pytest.fixture(scope="module")
def keys_js():
    return read("static", "keys.js")


def block(source, declaration):
    """Text of a `var NAME = {...};` block."""
    match = re.search(r"var %s = \{(.*?)\n    \};" % declaration, source, re.S)
    assert match, "no %s block found" % declaration
    return match.group(1)


def model_table(providers_js):
    out = {}
    for match in re.finditer(r"^\s{8}(\w+):\s*\[(.*?)^\s{8}\],",
                             block(providers_js, "MODELS"), re.S | re.M):
        out[match.group(1)] = re.findall(r"id:\s*'([^']+)'", match.group(2))
    return out


# --------------------------------------------------------------------------
# Which providers exist
# --------------------------------------------------------------------------

def test_model_table_covers_exactly_the_supported_providers(providers_js):
    assert set(model_table(providers_js)) == SUPPORTED


def test_every_provider_has_a_label(providers_js):
    labels = set(re.findall(r"^\s{8}(\w+):", block(providers_js, "LABELS"), re.M))
    assert labels == SUPPORTED


def test_every_provider_has_a_handler(providers_js):
    handlers = set(re.findall(r"^\s{8}(\w+):", block(providers_js, "HANDLERS"), re.M))
    assert handlers == SUPPORTED


def test_key_store_lists_the_same_providers(keys_js):
    match = re.search(r"var PROVIDERS = \[([^\]]+)\]", keys_js)
    assert match
    assert set(re.findall(r"'([a-z]+)'", match.group(1))) == SUPPORTED


def test_no_model_list_is_empty(providers_js):
    for provider, models in model_table(providers_js).items():
        assert models, "%s has no models" % provider


def test_model_ids_are_unique_within_a_provider(providers_js):
    for provider, models in model_table(providers_js).items():
        assert len(models) == len(set(models)), "%s repeats a model id" % provider


# --------------------------------------------------------------------------
# Retired providers leave nothing behind
# --------------------------------------------------------------------------

@pytest.mark.parametrize("gone", sorted(RETIRED))
def test_retired_provider_is_not_referenced_anywhere(gone):
    """Half-removing a provider leaves a dead option in some dialog."""
    offenders = []
    for directory in (STATIC, PAGES):
        for name in sorted(os.listdir(directory)):
            if not name.endswith(".js"):
                continue
            source = io.open(os.path.join(directory, name), encoding="utf-8").read()
            for line_no, line in enumerate(source.splitlines(), start=1):
                if gone in line.lower() and "RETIRED" not in line and not line.strip().startswith(("*", "//", "/*")):
                    offenders.append("%s:%d %s" % (name, line_no, line.strip()[:70]))
    assert not offenders, offenders


@pytest.mark.parametrize("gone", sorted(RETIRED))
def test_retired_provider_keys_are_actively_purged(keys_js, gone):
    """Dropping a provider from PROVIDERS would orphan its key in localStorage,
    where nothing would ever clear it again."""
    match = re.search(r"var RETIRED = \[([^\]]+)\]", keys_js)
    assert match, "keys.js declares no RETIRED list"
    assert gone in match.group(1)
    assert "forgetRetired();" in keys_js


def test_forget_retired_runs_on_load_and_on_purge(keys_js):
    assert keys_js.count("forgetRetired()") >= 2


@pytest.mark.parametrize("gone", sorted(RETIRED))
def test_retired_provider_is_gone_from_every_page(gone, page_sources):
    for name, html in page_sources.items():
        assert gone not in html.lower(), "%s still mentions %s" % (name, gone)


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------

def test_remote_endpoints_are_https(providers_js):
    for url in re.findall(r"^\s+\w+: '(https?://[^']+)'", block(providers_js, "ENDPOINTS"),
                          re.M):
        assert url.startswith("https://"), url


def test_ollama_default_is_loopback_only(providers_js):
    match = re.search(r"var OLLAMA_DEFAULT = '([^']+)'", providers_js)
    assert match
    assert re.match(r"^http://(localhost|127\.0\.0\.1):\d+$", match.group(1))


def test_legacy_huggingface_host_is_gone(providers_code):
    """api-inference.huggingface.co is the retired route; the router replaced it."""
    assert "api-inference.huggingface.co" not in providers_code
    assert "router.huggingface.co" in providers_code


def test_retired_gemini_models_are_not_listed(providers_js):
    """gemini-2.0-flash is shut down and the 1.5 line is retired; requests to
    them fail at runtime with an error the UI blames on the user's key."""
    listed = model_table(providers_js)["gemini"]
    for dead in ("gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro",
                 "gemini-1.5-flash-8b", "gemini-2.0-flash-lite"):
        assert dead not in listed, "%s no longer exists" % dead


def test_ollama_defaults_are_models_the_pull_scripts_fetch(providers_js):
    """Offering a local model nobody has pulled just produces a confusing error."""
    pulled = set()
    directory = os.path.join(ROOT, "scripts_to_pull")
    for name in os.listdir(directory):
        if name.endswith(".ps1"):
            text = io.open(os.path.join(directory, name), encoding="utf-8",
                           errors="replace").read()
            pulled.update(re.findall(r"pull\s+([A-Za-z0-9._:-]+)", text))
    for model in model_table(providers_js)["ollama"]:
        assert model in pulled, "%s is offered but no pull script fetches it" % model


# --------------------------------------------------------------------------
# Key handling
# --------------------------------------------------------------------------

def test_gemini_key_travels_in_a_header(providers_code):
    assert "x-goog-api-key" in providers_code
    assert "?key=" not in providers_code
    assert "key=' + apiKey" not in providers_code


def test_bearer_auth_for_openai_compatible_providers(providers_js):
    assert "Authorization: 'Bearer ' + apiKey" in providers_js


def test_openrouter_attribution_headers_are_not_sent(providers_code):
    """HTTP-Referer / X-Title feed OpenRouter's public leaderboard and would
    announce which page a researcher is using."""
    assert "HTTP-Referer" not in providers_code
    assert "X-Title" not in providers_code


def test_keys_are_never_written_to_a_url(providers_js):
    for line_no, line in enumerate(providers_js.splitlines(), start=1):
        if "apiKey" in line and ("encodeURIComponent(apiKey" in line or "?key=" in line):
            pytest.fail("providers.js:%d puts a key in a URL" % line_no)


def test_requests_are_time_bounded(providers_js):
    assert "AbortController" in providers_js
    assert "DEFAULT_TIMEOUT_MS" in providers_js


# --------------------------------------------------------------------------
# Pages agree with the provider layer
# --------------------------------------------------------------------------

def page_scripts():
    return {name: io.open(os.path.join(PAGES, name), encoding="utf-8").read()
            for name in sorted(os.listdir(PAGES)) if name.endswith(".js")}


def test_pages_only_offer_supported_providers():
    for name, source in page_scripts().items():
        for match in re.finditer(r"providers:\s*\[([^\]]*)\]", source):
            offered = set(re.findall(r"'([a-z]+)'", match.group(1)))
            unknown = offered - SUPPORTED
            assert not unknown, "%s offers unknown provider(s) %s" % (name, unknown)


def test_dashboard_lists_every_supported_provider():
    source = io.open(os.path.join(PAGES, "index.js"), encoding="utf-8").read()
    match = re.search(r"var PROVIDERS = \[(.*?)\n    \];", source, re.S)
    assert match, "index.js has no PROVIDERS table"
    listed = set(re.findall(r"id:\s*'([a-z]+)'", match.group(1)))
    assert listed == SUPPORTED


def test_dashboard_signup_links_are_https():
    source = io.open(os.path.join(PAGES, "index.js"), encoding="utf-8").read()
    for url in re.findall(r"signup:\s*'([^']+)'", source):
        assert url.startswith("https://"), url


def test_default_settings_providers_are_supported():
    source = io.open(os.path.join(STATIC, "ui.js"), encoding="utf-8").read()
    match = re.search(r"opts\.providers \|\| \[([^\]]+)\]", source)
    assert match
    assert set(re.findall(r"'([a-z]+)'", match.group(1))) <= SUPPORTED
