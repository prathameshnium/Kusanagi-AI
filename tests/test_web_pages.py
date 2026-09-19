"""Structural and security tests for the shipped web pages.

These encode the invariants the pages were rewritten to hold. They need no
browser and no network, so they are cheap enough to run on every change:

  - the Content-Security-Policy is present and actually strict
  - nothing is inline (script, style, event handler)
  - nothing is loaded from a third-party origin
  - every local asset a page references exists on disk
  - every element id a page script looks up exists in that page's HTML
  - connect-src matches the endpoints the page really uses, in both directions
"""
import io
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES_DIR = os.path.join(ROOT, "static", "pages")

# Endpoints each provider needs, so a page's connect-src can be checked against
# the providers it actually offers.
PROVIDER_ORIGINS = {
    "gemini": ["https://generativelanguage.googleapis.com"],
    "hf": ["https://router.huggingface.co"],
    "openrouter": ["https://openrouter.ai"],
    "ollama": ["http://localhost:11434", "http://127.0.0.1:11434"],
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def csp_of(html):
    match = re.search(
        r'<meta\s+http-equiv="Content-Security-Policy"\s+content="(.*?)"\s*>',
        html, re.S | re.I)
    assert match, "page has no Content-Security-Policy meta tag"
    raw = re.sub(r"\s+", " ", match.group(1)).strip()
    directives = {}
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        name, _, values = part.partition(" ")
        directives[name.strip()] = values.split()
    return directives


def page_script_for(name, html):
    """The static/pages/*.js file a page loads, if any."""
    match = re.search(r'src="[^"]*static/pages/([a-z]+\.js)"', html)
    if not match:
        return None, None
    path = os.path.join(PAGES_DIR, match.group(1))
    return match.group(1), io.open(path, encoding="utf-8").read()


def local_refs(html):
    """Local (non-absolute-URL) src/href values a page pulls in."""
    refs = re.findall(r'(?:src|href)="([^"]+)"', html)
    return [r for r in refs
            if not r.startswith(("http://", "https://", "data:", "#", "mailto:"))]


def resolve(page_path, ref):
    return os.path.normpath(os.path.join(os.path.dirname(page_path), ref))


# --------------------------------------------------------------------------
# Content-Security-Policy
# --------------------------------------------------------------------------

def test_every_page_has_a_csp(page_sources):
    for name, html in page_sources.items():
        csp_of(html)


def test_csp_denies_by_default(page_sources):
    for name, html in page_sources.items():
        assert csp_of(html).get("default-src") == ["'none'"], name


def test_csp_forbids_inline_and_eval(page_sources):
    """'unsafe-inline' or 'unsafe-eval' anywhere would undo the whole exercise."""
    for name, html in page_sources.items():
        for directive, values in csp_of(html).items():
            for bad in ("'unsafe-inline'", "'unsafe-eval'"):
                assert bad not in values, "%s: %s has %s" % (name, directive, bad)


def test_csp_restricts_scripts_and_styles_to_self(page_sources):
    for name, html in page_sources.items():
        csp = csp_of(html)
        assert csp.get("script-src") == ["'self'"], name
        assert csp.get("style-src") == ["'self'"], name


def test_csp_pins_base_uri_and_form_action(page_sources):
    for name, html in page_sources.items():
        csp = csp_of(html)
        assert csp.get("base-uri") == ["'none'"], name
        assert csp.get("form-action") == ["'none'"], name


def test_csp_allows_no_third_party_fonts_or_images(page_sources):
    for name, html in page_sources.items():
        csp = csp_of(html)
        assert csp.get("font-src") == ["'self'"], name
        for value in csp.get("img-src", []):
            assert not value.startswith("http"), "%s: img-src allows %s" % (name, value)


# --------------------------------------------------------------------------
# Nothing inline
# --------------------------------------------------------------------------

def test_no_inline_script_blocks(page_sources):
    """An inline <script> would be dead under script-src 'self' anyway."""
    for name, html in page_sources.items():
        assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html), name


def test_no_inline_event_handlers(page_sources):
    """onclick="doThing('${untrusted}')" is how the Neji XSS worked."""
    for name, html in page_sources.items():
        found = re.findall(r'\son[a-z]+\s*=\s*"', html, re.I)
        assert not found, "%s has inline handlers: %s" % (name, found)


def test_no_inline_style_attributes(page_sources):
    for name, html in page_sources.items():
        assert not re.search(r'\sstyle\s*=\s*"', html), name


def test_no_inline_style_blocks(page_sources):
    for name, html in page_sources.items():
        assert "<style" not in html, name


# --------------------------------------------------------------------------
# No third-party origins
# --------------------------------------------------------------------------

def test_pages_load_no_remote_scripts_or_styles(page_sources):
    for name, html in page_sources.items():
        for tag in re.findall(r"<(?:script|link)\b[^>]*>", html, re.I):
            url = re.search(r'(?:src|href)="(https?://[^"]+)"', tag)
            assert not url, "%s loads %s" % (name, url.group(1) if url else "")


def test_pages_reference_no_cdn_hosts(page_sources):
    banned = ("cdn.tailwindcss.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net",
              "fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com")
    for name, html in page_sources.items():
        for host in banned:
            assert host not in html, "%s still references %s" % (name, host)


# --------------------------------------------------------------------------
# Assets resolve
# --------------------------------------------------------------------------

def test_every_local_asset_exists(web_pages, page_sources):
    missing = []
    for name, path in web_pages:
        for ref in local_refs(page_sources[name]):
            target = resolve(path, ref.split("?")[0].split("#")[0])
            if not os.path.exists(target):
                missing.append("%s -> %s" % (name, ref))
    assert not missing, "unresolvable references: %s" % missing


def test_vendored_libraries_are_present(repo_root):
    for rel in ("static/vendor/marked.min.js",
                "static/vendor/purify.min.js",
                "static/vendor/katex/katex.min.js",
                "static/vendor/katex/katex.min.css",
                "static/vendor/pdfjs/pdf.min.mjs",
                "static/vendor/pdfjs/pdf.worker.min.mjs",
                "static/vendor/fonts/fonts.css",
                "static/kusanagi.css"):
        assert os.path.exists(os.path.join(repo_root, rel)), rel


def test_katex_stylesheet_only_references_fonts_we_shipped(repo_root):
    css_path = os.path.join(repo_root, "static", "vendor", "katex", "katex.min.css")
    css = io.open(css_path, encoding="utf-8").read()
    fonts_dir = os.path.join(os.path.dirname(css_path), "fonts")
    for ref in set(re.findall(r"url\(fonts/([^)]+)\)", css)):
        assert os.path.exists(os.path.join(fonts_dir, ref)), "missing KaTeX font %s" % ref


def test_font_stylesheet_only_references_fonts_we_shipped(repo_root):
    css_path = os.path.join(repo_root, "static", "vendor", "fonts", "fonts.css")
    css = io.open(css_path, encoding="utf-8").read()
    for ref in set(re.findall(r"url\('\./([^']+)'\)", css)):
        assert os.path.exists(os.path.join(os.path.dirname(css_path), ref)), ref


def test_self_hosted_faces_declare_unicode_ranges(repo_root):
    """Both families ship one file per subset with otherwise identical
    descriptors; without unicode-range only one of them ever loads."""
    css = io.open(os.path.join(repo_root, "static", "vendor", "fonts", "fonts.css"),
                  encoding="utf-8").read()
    assert css.count("@font-face") == css.count("unicode-range")


# --------------------------------------------------------------------------
# Page script wiring
# --------------------------------------------------------------------------

def test_every_page_loads_a_page_script(page_sources):
    for name, html in page_sources.items():
        script_name, _ = page_script_for(name, html)
        assert script_name, "%s loads no static/pages script" % name


def test_page_scripts_only_look_up_ids_that_exist(web_pages, page_sources):
    """Catches a renamed or deleted element before it becomes a null deref."""
    problems = []
    for name, _path in web_pages:
        html = page_sources[name]
        script_name, script = page_script_for(name, html)
        if not script:
            continue
        ids_in_html = set(re.findall(r'\bid="([^"]+)"', html))
        for looked_up in set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", script)):
            if looked_up not in ids_in_html:
                problems.append("%s: %s looks up #%s" % (name, script_name, looked_up))
    assert not problems, problems


def test_shared_modules_are_loaded_before_the_page_script(page_sources):
    """dom.js/ui.js define what the page scripts use at DOMContentLoaded."""
    for name, html in page_sources.items():
        order = re.findall(r'src="[^"]*static/(?:pages/)?([a-z-]+\.js)"', html)
        if "index.js" in order or any(o.endswith(".js") and o in
                                      ("kakashi.js", "neji.js", "onetail.js",
                                       "orochimaru.js", "visualize.js") for o in order):
            page_script = order[-1]
            for dependency in ("keys.js", "providers.js", "dom.js", "ui.js"):
                assert dependency in order, "%s does not load %s" % (name, dependency)
                assert order.index(dependency) < order.index(page_script), \
                    "%s loads %s after %s" % (name, dependency, page_script)


# --------------------------------------------------------------------------
# connect-src matches reality, in both directions
# --------------------------------------------------------------------------

def origin_of(url):
    match = re.match(r"(https?)://([a-z0-9.\-]+(?::\d+)?)", url)
    return "%s://%s" % (match.group(1), match.group(2)) if match else None


def fetched_origins(script):
    """Origins the script actually requests, as opposed to merely links to.

    The page scripts are consistent about this: a URL that gets fetched is built
    into a `var url = '...'` local and handed to fetch()/safeFetch(), whereas a
    URL the user clicks lives in an object property (`url:` in a link table,
    `signup:` on the dashboard). Counting the latter as fetches would demand
    connect-src entries for Google Scholar and friends, which the pages never
    contact.
    """
    origins = set()
    for pattern in (r"\bvar\s+url\s*=\s*['\"`](https?://[^'\"`\s]+)",
                    r"\bfetch\(\s*['\"`](https?://[^'\"`\s]+)",
                    r"\bimport\(\s*['\"`](https?://[^'\"`\s]+)"):
        for match in re.finditer(pattern, script):
            found = origin_of(match.group(1))
            if found:
                origins.add(found)
    return origins


def declared_providers(script):
    match = re.search(r"providers:\s*\[([^\]]*)\]", script)
    if not match:
        return []
    return re.findall(r"'([a-z]+)'", match.group(1))


def test_every_endpoint_a_page_fetches_is_allowed(web_pages, page_sources):
    """A missing connect-src entry means a silent, permanent fetch failure."""
    problems = []
    for name, _path in web_pages:
        html = page_sources[name]
        script_name, script = page_script_for(name, html)
        if not script:
            continue
        allowed = set(csp_of(html).get("connect-src", []))

        for origin in fetched_origins(script):
            if origin not in allowed:
                problems.append("%s: fetches %s, not in connect-src" % (name, origin))

        # Origins implied by the providers this page offers.
        for provider in declared_providers(script):
            for origin in PROVIDER_ORIGINS[provider]:
                if origin not in allowed:
                    problems.append("%s: offers %s but %s is not in connect-src"
                                    % (name, provider, origin))
    assert not problems, problems


def test_no_stale_connect_src_entries(web_pages, page_sources):
    """An allowlisted origin nothing calls is either dead config or a leftover
    from a source that quietly stopped working (this is how the arXiv endpoint
    survived long after CORS had killed it)."""
    problems = []
    for name, _path in web_pages:
        html = page_sources[name]
        script_name, script = page_script_for(name, html)
        if not script:
            continue

        provider_origins = set()
        for provider in declared_providers(script):
            provider_origins.update(PROVIDER_ORIGINS[provider])
        used = fetched_origins(script) | provider_origins

        for origin in csp_of(html).get("connect-src", []):
            if origin in ("'self'", "'none'", "blob:", "data:"):
                continue
            if origin not in used:
                problems.append("%s: connect-src allows %s but nothing calls it"
                                % (name, origin))
    assert not problems, problems


def test_external_links_are_safe(page_sources):
    """Any target=_blank link needs rel=noopener to avoid tabnabbing."""
    problems = []
    for name, html in page_sources.items():
        for tag in re.findall(r"<a\b[^>]*>", html, re.I):
            if 'target="_blank"' in tag and "noopener" not in tag:
                problems.append("%s: %s" % (name, tag[:80]))
    assert not problems, problems


# --------------------------------------------------------------------------
# The rendering guarantee
# --------------------------------------------------------------------------

def js_sources():
    """Every first-party script we ship, excluding vendored libraries."""
    out = {}
    static = os.path.join(ROOT, "static")
    for directory in (static, PAGES_DIR):
        for entry in sorted(os.listdir(directory)):
            if entry.endswith(".js"):
                path = os.path.join(directory, entry)
                out[os.path.relpath(path, ROOT)] = io.open(path, encoding="utf-8").read()
    return out


def test_innerhtml_is_confined_to_the_sanitising_helper():
    """dom.markdown() is the only place allowed to assign innerHTML, and it runs
    DOMPurify. Everything else builds nodes."""
    offenders = []
    for rel, source in js_sources().items():
        if rel.replace("\\", "/") == "static/dom.js":
            continue
        for line_no, line in enumerate(source.splitlines(), start=1):
            if re.search(r"\.innerHTML\s*=", line):
                offenders.append("%s:%d" % (rel, line_no))
    assert not offenders, "innerHTML assigned outside dom.js: %s" % offenders


def test_dom_helper_sanitises_before_assigning():
    source = io.open(os.path.join(ROOT, "static", "dom.js"), encoding="utf-8").read()
    assignment = re.search(r"target\.innerHTML\s*=\s*([^;]+);", source, re.S)
    assert assignment, "dom.js no longer assigns innerHTML the way this test expects"
    assert "DOMPurify.sanitize" in assignment.group(1)


def test_dom_helper_degrades_to_text_without_dompurify():
    """If the sanitiser is missing we must not render raw markup."""
    source = io.open(os.path.join(ROOT, "static", "dom.js"), encoding="utf-8").read()
    assert "typeof DOMPurify === 'undefined'" in source
    assert "target.textContent = source" in source


def test_no_eval_or_function_constructor():
    for rel, source in js_sources().items():
        assert not re.search(r"\beval\s*\(", source), rel
        assert not re.search(r"\bnew\s+Function\s*\(", source), rel


def test_no_api_keys_are_logged():
    """A key in console output ends up in bug reports and screen shares."""
    for rel, source in js_sources().items():
        for line_no, line in enumerate(source.splitlines(), start=1):
            if "console." in line and re.search(r"\b(apiKey|api_key)\b", line):
                pytest.fail("%s:%d logs a key: %s" % (rel, line_no, line.strip()))


def test_gemini_key_is_sent_as_a_header_not_a_query_parameter():
    """A key in the URL leaks into history, Referer and proxy logs."""
    source = io.open(os.path.join(ROOT, "static", "providers.js"), encoding="utf-8").read()
    assert "x-goog-api-key" in source
    assert "?key=" not in source


def test_safe_url_rejects_dangerous_schemes():
    source = io.open(os.path.join(ROOT, "static", "dom.js"), encoding="utf-8").read()
    allowed = re.search(r"SAFE_SCHEMES\s*=\s*\[([^\]]+)\]", source)
    assert allowed, "dom.js no longer declares SAFE_SCHEMES"
    schemes = re.findall(r"'([^']+)'", allowed.group(1))
    assert set(schemes) <= {"http:", "https:", "mailto:"}
    for dangerous in ("javascript:", "data:", "vbscript:"):
        assert dangerous not in schemes


# --------------------------------------------------------------------------
# Generated stylesheet
# --------------------------------------------------------------------------

def test_compiled_css_is_not_stale(repo_root):
    """static/kusanagi.css is generated; if the source is newer it was not rebuilt."""
    built = os.path.join(repo_root, "static", "kusanagi.css")
    source = os.path.join(repo_root, "static", "src", "input.css")
    assert os.path.getmtime(built) >= os.path.getmtime(source), \
        "static/kusanagi.css is older than input.css -- run scripts/build_css.py"


def test_compiled_css_carries_the_self_hosted_fonts(repo_root):
    css = io.open(os.path.join(repo_root, "static", "kusanagi.css"),
                  encoding="utf-8").read()
    assert "@font-face" in css
    assert "vendor/fonts/" in css
    assert "fonts.googleapis.com" not in css


@pytest.mark.parametrize("cls", ["btn", "btn-accent", "btn-secondary", "btn-danger",
                                 "home-button", "settings-modal", "prob-bar-fill",
                                 "glass-card", "step-number", "is-dimmed", "is-invisible"])
def test_component_classes_survived_compilation(repo_root, cls):
    css = io.open(os.path.join(repo_root, "static", "kusanagi.css"),
                  encoding="utf-8").read()
    assert ".%s" % cls in css, "%s was purged from the build" % cls
