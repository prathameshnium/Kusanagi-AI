"""Consolidate scattered Ollama model folders into a single manifests/ + blobs/ pair.

    python scripts/consolidate_models.py                    # dry run, default location
    python scripts/consolidate_models.py --apply
    python scripts/consolidate_models.py --models-dir D:/ollama/models --apply

Pulling models with different OLLAMA_MODELS values leaves several sibling folders
that each hold their own manifests/ and blobs/. Ollama only reads one, so models
appear to vanish. This merges them back together.

Previously this file lived at the repo root with the author's own absolute path
hardcoded into it, and moved files the moment it was run. It now defaults to the
configured model folder, takes a path, and does nothing until you pass --apply.
"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "local_apps"))
from kusanagi_core import load_config  # noqa: E402

CANONICAL = ("manifests", "blobs")


def merge_tree(src, dst, apply, moved):
    """Move everything under src into dst, keeping existing files in dst."""
    for entry in os.listdir(src):
        source = os.path.join(src, entry)
        target = os.path.join(dst, entry)

        if os.path.isdir(source):
            if not os.path.exists(target):
                if apply:
                    os.makedirs(target, exist_ok=True)
            merge_tree(source, target, apply, moved)
        elif os.path.exists(target):
            print("    skip (already present): %s" % os.path.relpath(target, dst))
        else:
            moved.append(target)
            if apply:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                shutil.move(source, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models-dir",
                        help="model folder to tidy (default: from System_Config.json)")
    parser.add_argument("--apply", action="store_true",
                        help="actually move files; without this it only reports")
    args = parser.parse_args()

    models_dir = args.models_dir or load_config().get("model_folder")
    if not models_dir or not os.path.isdir(models_dir):
        raise SystemExit("Model folder not found: %r\n"
                         "Pass --models-dir, or fix model_folder in System_Config.json."
                         % models_dir)

    print("Model folder: %s" % models_dir)
    if not args.apply:
        print("DRY RUN -- nothing will be moved. Re-run with --apply.\n")

    strays = [name for name in sorted(os.listdir(models_dir))
              if os.path.isdir(os.path.join(models_dir, name)) and name not in CANONICAL]

    if not strays:
        print("Nothing to consolidate: only %s present." % " and ".join(CANONICAL))
        return 0

    moved = []
    for name in strays:
        stray = os.path.join(models_dir, name)
        print("  %s" % name)
        for canonical in CANONICAL:
            source = os.path.join(stray, canonical)
            if not os.path.isdir(source):
                continue
            target = os.path.join(models_dir, canonical)
            if args.apply:
                os.makedirs(target, exist_ok=True)
            merge_tree(source, target, args.apply, moved)

        if args.apply and os.path.isdir(stray) and not os.listdir(stray):
            os.rmdir(stray)

    verb = "Moved" if args.apply else "Would move"
    print("\n%s %d file(s)." % (verb, len(moved)))
    if not args.apply and moved:
        print("Re-run with --apply to do it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
