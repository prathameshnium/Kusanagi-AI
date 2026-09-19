"""Menu for the Kusanagi AI desktop suite.

    python local_apps/launcher.py

Paths resolve against this file, not the shell's working directory. The previous
version used os.path.abspath("."), so running it the documented way -- from the
repo root -- looked for Kusanagi_Local.py in the repo root and failed.
"""

import os
import subprocess
import sys

APPS = [
    ("Kusanagi (console + model manager)", "Kusanagi_Local.py"),
    ("Orochimaru (research assistant, RAG over PDFs)", "Orochimaru_Local_Research_Assistent.py"),
    ("OneTail (multi-model chat)", "OneTail_Local_Chatapp.py"),
    ("Visualize AI (token probability inspector)", "Visualize_AI.py"),
    ("Hopfield demo (associative memory)", "holffield_demo.py"),
]


def app_dir():
    """Directory holding the app scripts, for source and PyInstaller runs."""
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        return bundled
    return os.path.dirname(os.path.abspath(__file__))


def choose():
    print("Kusanagi AI Suite")
    print("-" * 40)
    for index, (label, script) in enumerate(APPS, start=1):
        marker = "" if os.path.exists(os.path.join(app_dir(), script)) else "   (missing)"
        print("  %d: %s%s" % (index, label, marker))
    print("  q: quit")

    try:
        answer = input("\nChoose an application: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return None

    if answer in ("q", "quit", "exit", ""):
        return None
    if not answer.isdigit() or not (1 <= int(answer) <= len(APPS)):
        print("Not a valid choice.")
        return None
    return APPS[int(answer) - 1]


def main():
    selection = choose()
    if not selection:
        return 0

    label, script = selection
    path = os.path.join(app_dir(), script)
    if not os.path.exists(path):
        print("Error: %s is missing from %s." % (script, app_dir()))
        return 1

    print("Starting %s ..." % label)
    try:
        # cwd is the repo root so the apps resolve System_Config.json and
        # Portable_AI_Assets the same way however the launcher was invoked.
        return subprocess.run([sys.executable, path],
                              cwd=os.path.dirname(app_dir()) or None).returncode
    except KeyboardInterrupt:
        return 130
    except OSError as exc:
        print("Could not start %s: %s" % (script, exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
