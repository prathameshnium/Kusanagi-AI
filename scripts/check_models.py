"""Validate the model IDs in static/providers.js against the live provider APIs.

    python scripts/check_models.py              # public catalogues only
    python scripts/check_models.py --gemini-key $GEMINI_KEY
    python scripts/check_models.py --hf-token $HF_TOKEN

Model IDs rot quietly: a retired ID produces a 404 at request time, which the
UI reports as a provider error, so nobody connects it to the hardcoded list.
This project shipped `gemini-2.0-flash` (shut down), two retired `gemini-1.5-*`
entries, Groq models that no longer existed, and Ollama defaults that none of
the pull scripts ever fetched. Run this after touching MODELS.

Exit code is non-zero if any listed ID is missing from a catalogue we could
actually reach, so it works in CI when the keys are available.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROVIDERS_JS = os.path.join(ROOT, "static", "providers.js")
TIMEOUT = 45


def get_json(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def declared_models():
    """Parse the MODELS table out of providers.js, per provider."""
    source = open(PROVIDERS_JS, encoding="utf-8").read()
    block = re.search(r"var MODELS = \{(.*?)\n    \};", source, re.S)
    if not block:
        raise SystemExit("could not find the MODELS table in providers.js")

    out = {}
    # The trailing newline is optional: the last provider in the table is
    # followed by the closing brace, not another entry.
    for match in re.finditer(r"^\s{8}(\w+):\s*\[(.*?)^\s{8}\],", block.group(1),
                             re.S | re.M):
        out[match.group(1)] = re.findall(r"id:\s*'([^']+)'", match.group(2))
    if not out:
        raise SystemExit("parsed no providers out of the MODELS table")
    return out


# --------------------------------------------------------------------------
# catalogues
# --------------------------------------------------------------------------

def openrouter_ids():
    data = get_json("https://openrouter.ai/api/v1/models")
    return {m["id"] for m in data.get("data", [])}


def gemini_ids(key):
    if not key:
        return None
    data = get_json("https://generativelanguage.googleapis.com/v1beta/models",
                    {"x-goog-api-key": key})
    ids = set()
    for model in data.get("models", []):
        name = model.get("name", "")
        if "generateContent" in (model.get("supportedGenerationMethods") or []):
            ids.add(name.split("/", 1)[-1])
    return ids


def hf_ids(token):
    if not token:
        return None
    data = get_json("https://router.huggingface.co/v1/models",
                    {"Authorization": "Bearer %s" % token})
    return {m["id"].split(":")[0] for m in data.get("data", [])}


def ollama_ids():
    """Ollama models are whatever the user pulled; check the pull scripts instead."""
    pulled = set()
    directory = os.path.join(ROOT, "scripts_to_pull")
    if not os.path.isdir(directory):
        return None
    for name in os.listdir(directory):
        if not name.endswith(".ps1"):
            continue
        text = open(os.path.join(directory, name), encoding="utf-8", errors="replace").read()
        pulled.update(re.findall(r"pull\s+([A-Za-z0-9._:-]+)", text))
    return pulled or None


# --------------------------------------------------------------------------

def report(provider, listed, available, note=""):
    if available is None:
        print("  --  %-11s skipped (%s)" % (provider, note or "no credential"))
        return 0
    missing = [m for m in listed if m not in available]
    for model in listed:
        mark = "ok " if model in available else "GONE"
        print("  %s %-11s %s" % (mark, provider, model))
    return len(missing)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gemini-key", default=os.environ.get("GEMINI_API_KEY"))
    parser.add_argument("--hf-token", default=os.environ.get("HF_TOKEN"))
    args = parser.parse_args()

    listed = declared_models()
    print("Checking %d providers from static/providers.js\n"
          % len(listed))

    failures = 0
    checks = [
        ("openrouter", openrouter_ids, (), "network"),
        ("gemini", gemini_ids, (args.gemini_key,), "pass --gemini-key"),
        ("hf", hf_ids, (args.hf_token,), "pass --hf-token"),
        ("ollama", ollama_ids, (), "no scripts_to_pull"),
    ]

    for provider, fetch, fetch_args, note in checks:
        if provider not in listed:
            continue
        try:
            available = fetch(*fetch_args)
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            print("  --  %-11s skipped (%s)" % (provider, exc))
            continue
        failures += report(provider, listed[provider], available, note)
        print()

    if failures:
        print("%d model id(s) no longer exist. Update MODELS in providers.js." % failures)
    else:
        print("All checkable model ids are live.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
