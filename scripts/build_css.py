"""Compile static/src/input.css -> static/kusanagi.css with the Tailwind CLI.

    python scripts/build_css.py            # minified build
    python scripts/build_css.py --debug    # unminified, for reading the output

Why this exists: the pages used to pull https://cdn.tailwindcss.com, which is the
JIT "play" build. It compiles classes in the browser, so it needs 'unsafe-eval'
and cannot carry a subresource-integrity hash -- it is the single thing that would
stop this project having a real Content-Security-Policy. Building ahead of time
removes the runtime dependency and drops the payload from ~120 KB of compiler to
a few KB of actual rules.

No Node required. The standalone Tailwind binary is a single executable; this script
downloads it to a cache directory outside the repo on first run.

Run this after changing any HTML class name, or the class will not exist in the
compiled sheet and will silently do nothing.
"""
import argparse
import io
import os
import platform
import stat
import subprocess
import sys
import urllib.request

TAILWIND_VERSION = "v3.4.17"
ASSETS = {
    ("Windows", "AMD64"): "tailwindcss-windows-x64.exe",
    ("Windows", "ARM64"): "tailwindcss-windows-arm64.exe",
    ("Linux", "x86_64"): "tailwindcss-linux-x64",
    ("Linux", "aarch64"): "tailwindcss-linux-arm64",
    ("Darwin", "x86_64"): "tailwindcss-macos-x64",
    ("Darwin", "arm64"): "tailwindcss-macos-arm64",
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "static", "src", "input.css")
OUT = os.path.join(ROOT, "static", "kusanagi.css")
FONTS = os.path.join(ROOT, "static", "vendor", "fonts", "fonts.css")


def cache_dir():
    base = (os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME")
            or os.path.join(os.path.expanduser("~"), ".cache"))
    return os.path.join(base, "kusanagi-build", TAILWIND_VERSION)


def tailwind_binary():
    key = (platform.system(), platform.machine())
    asset = ASSETS.get(key)
    if not asset:
        raise SystemExit(
            "No standalone Tailwind build for %s/%s. Install the Tailwind CLI yourself "
            "and set TAILWIND_BIN to it." % key)

    override = os.environ.get("TAILWIND_BIN")
    if override:
        return override

    path = os.path.join(cache_dir(), asset)
    if os.path.exists(path):
        return path

    url = ("https://github.com/tailwindlabs/tailwindcss/releases/download/%s/%s"
           % (TAILWIND_VERSION, asset))
    os.makedirs(cache_dir(), exist_ok=True)
    print("downloading Tailwind %s (one time, ~40 MB, cached outside the repo)"
          % TAILWIND_VERSION)
    tmp = path + ".part"
    with urllib.request.urlopen(url, timeout=300) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, path)
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", action="store_true",
                    help="skip minification so the output is readable")
    args = ap.parse_args()

    if not os.path.exists(FONTS):
        raise SystemExit("missing %s -- run scripts/fetch_fonts.py first" % FONTS)

    cmd = [tailwind_binary(), "--config", os.path.join(ROOT, "tailwind.config.js"),
           "--input", SRC, "--output", OUT]
    if not args.debug:
        cmd.append("--minify")

    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    # The CLI writes its progress banner to stderr even on success.
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        raise SystemExit("tailwind build failed (exit %d)" % proc.returncode)

    # Prepend the self-hosted @font-face rules so every page needs exactly one
    # stylesheet link. url()s in fonts.css are relative to static/vendor/fonts/,
    # and the compiled sheet sits in static/, so they need one level of prefix.
    faces = io.open(FONTS, encoding="utf-8").read().replace("url('./", "url('./vendor/fonts/")
    css = io.open(OUT, encoding="utf-8").read()
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(faces + "\n" + css)

    print("built %s (%.1f KB)" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()
