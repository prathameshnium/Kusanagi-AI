"""Shared fixtures and path setup for the Kusanagi AI test suite."""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_APPS = os.path.join(ROOT, "local_apps")

# The desktop apps import kusanagi_core as a sibling module, so tests need the
# same import path they get when run as scripts.
if LOCAL_APPS not in sys.path:
    sys.path.insert(0, LOCAL_APPS)


@pytest.fixture(scope="session")
def repo_root():
    return ROOT


@pytest.fixture(scope="session")
def web_pages():
    """Every shipped HTML page, as (name, absolute path)."""
    pages = [("index.html", os.path.join(ROOT, "index.html"))]
    web_apps = os.path.join(ROOT, "web_apps")
    for name in sorted(os.listdir(web_apps)):
        if name.endswith(".html"):
            pages.append((name, os.path.join(web_apps, name)))
    return pages


@pytest.fixture(scope="session")
def page_sources(web_pages):
    """{name: html text} for every shipped page."""
    import io
    return {name: io.open(path, encoding="utf-8").read() for name, path in web_pages}


def strip_js_comments(source):
    """Remove // and /* */ comments from JavaScript, leaving string literals alone.

    Tests that assert something is *absent* from the code have to ignore prose,
    or a comment explaining why a thing was removed counts as the thing itself.
    Quote-aware so that the // in an https:// URL survives.
    """
    out = []
    i, n = 0, len(source)
    quote = None

    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""

        if quote:
            out.append(ch)
            if ch == "\\":
                if i + 1 < n:
                    out.append(nxt)
                    i += 2
                    continue
            elif ch == quote:
                quote = None
            i += 1
            continue

        if ch in ("'", '"', "`"):
            quote = ch
            out.append(ch)
            i += 1
            continue

        if ch == "/" and nxt == "/":
            while i < n and source[i] != "\n":
                i += 1
            continue

        if ch == "/" and nxt == "*":
            end = source.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue

        out.append(ch)
        i += 1

    return "".join(out)
