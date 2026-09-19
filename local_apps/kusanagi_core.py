"""Shared foundation for the Kusanagi AI desktop apps.

Before this module existed, every app carried its own copy of get_project_root(),
its own Style palette, its own System_Config.json loader and its own Ollama
server manager. The copies had drifted: Visualize_AI's Style class had been
reduced to a single font plus the comment "# ... (rest of Style class is
unchanged)", so every other attribute it referenced raised AttributeError, and
all three server managers used Windows-only subprocess flags.

Import from here instead of copying:

    from kusanagi_core import PROJECT_ROOT, Style, load_config, OllamaServer
"""

import json
import os
import subprocess
import sys

__all__ = ["PROJECT_ROOT", "Style", "DEFAULT_CONFIG", "load_config",
           "log_path", "OllamaServer"]


# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

def get_project_root():
    """Repo root, whether running from source or from a PyInstaller bundle."""
    if getattr(sys, "frozen", False):
        # One-dir bundle: the executable sits at the root.
        return os.path.dirname(sys.executable)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))


PROJECT_ROOT = get_project_root()


def log_path(name):
    """Absolute path to a log file under <root>/logs, creating the directory."""
    directory = os.path.join(PROJECT_ROOT, "logs")
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, name)


# --------------------------------------------------------------------------
# Appearance -- mirrors static/src/input.css so the desktop and web apps match.
# --------------------------------------------------------------------------

class Style:
    UI_FONT = ("Segoe UI", 11)
    CHAT_FONT = ("Segoe UI", 11)
    TITLE_FONT = ("Segoe UI", 18, "bold")
    BUTTON_FONT = ("Segoe UI", 12, "bold")
    LOG_FONT = ("Courier New", 9)

    BG_PRIMARY = "#193549"
    BG_SECONDARY = "#002240"
    BG_TERTIARY = "#25435A"
    FG_PRIMARY = "#FFFFFF"
    FG_SECONDARY = "#97B1C2"
    ACCENT = "#ffab40"
    ACCENT_HOVER = "#ffc371"
    ACCENT_FG = "#002240"
    SUCCESS = "#3AD900"
    ERROR = "#FF628C"
    LINK_FG = "#64b5f6"
    LOG_COLOR = "#F1FA8C"
    BORDER = "#334155"

    ICON_LOAD = "\U0001F4C4"       # 📄
    ICON_SAVE = "\U0001F4BE"       # 💾
    ICON_CLEAR = "\U0001F5D1"      # 🗑
    ICON_SEND = "➤"           # ➤
    ICON_UNMUTE = "\U0001F50A"     # 🔊
    ICON_MUTE = "\U0001F507"       # 🔇
    ICON_NEW_CHAT = "➕"       # ➕
    ICON_DELETE = "➖"         # ➖


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

# Relative to PROJECT_ROOT. os.path.join keeps these correct off Windows too;
# the checked-in System_Config.json still uses backslashes, which load_config
# normalises below.
DEFAULT_CONFIG = {
    "ollama_path": os.path.join("Portable_AI_Assets", "ollama_main",
                                "ollama.exe" if os.name == "nt" else "ollama"),
    "model_folder": os.path.join("Portable_AI_Assets", "models"),
    "vector_cache_dir": os.path.join("Portable_AI_Assets", "vector_cache"),
    "embedding_model_name": "all-minilm",
}

# Keys holding filesystem paths; everything else is passed through untouched.
_PATH_KEYS = ("ollama_path", "model_folder", "vector_cache_dir")


def load_config(config_name="System_Config.json"):
    """Read System_Config.json, falling back to defaults for anything missing.

    Path values are resolved to absolute paths against PROJECT_ROOT. A configured
    path that does not exist falls back to the default location -- except the
    vector cache, which is created on demand and so is allowed to be absent.
    """
    config = dict(DEFAULT_CONFIG)
    path = os.path.join(PROJECT_ROOT, config_name)

    try:
        with open(path, "r", encoding="utf-8") as handle:
            from_file = json.load(handle)
        if isinstance(from_file, dict):
            config.update({k: v for k, v in from_file.items() if v})
    except FileNotFoundError:
        pass
    except (json.JSONDecodeError, OSError) as exc:
        print("Warning: could not read %s (%s); using defaults." % (path, exc))

    for key in _PATH_KEYS:
        value = config.get(key)
        if not value:
            continue
        # Written on Windows, possibly read elsewhere.
        value = str(value).replace("\\", os.sep)
        resolved = value if os.path.isabs(value) else os.path.join(PROJECT_ROOT, value)
        resolved = os.path.normpath(resolved)

        if not os.path.exists(resolved) and key != "vector_cache_dir":
            fallback = os.path.normpath(
                os.path.join(PROJECT_ROOT, DEFAULT_CONFIG[key].replace("\\", os.sep)))
            resolved = fallback

        config[key] = resolved

    return config


# --------------------------------------------------------------------------
# Ollama process management
# --------------------------------------------------------------------------

def _detach_kwargs():
    """Spawn flags that survive the parent exiting, per platform.

    DETACHED_PROCESS and CREATE_NEW_PROCESS_GROUP only exist on Windows; naming
    them unconditionally is what made the old copies raise AttributeError on
    Linux and macOS.
    """
    if os.name == "nt":
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) \
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return {"creationflags": flags}
    return {"start_new_session": True}


class OllamaServer:
    """Starts a bundled Ollama binary if one is not already listening.

    Used as a context manager, or with explicit start()/stop(). The log file is
    owned by this object and closed on stop -- the old copies opened it and
    dropped the handle.
    """

    def __init__(self, ollama_path, model_folder=None, log_name="ollama.log"):
        self.ollama_path = ollama_path
        self.model_folder = model_folder
        self.log_name = log_name
        self.process = None
        self._log_handle = None

    @property
    def available(self):
        return bool(self.ollama_path) and os.path.exists(self.ollama_path)

    def start(self):
        """Launch `ollama serve`. Returns the Popen, or None if it cannot run."""
        if self.process and self.process.poll() is None:
            return self.process
        if not self.available:
            print("Info: no bundled Ollama at %r; expecting an already-running server."
                  % self.ollama_path)
            return None

        env = os.environ.copy()
        if self.model_folder and os.path.exists(self.model_folder):
            env["OLLAMA_MODELS"] = self.model_folder

        self._log_handle = open(log_path(self.log_name), "a", encoding="utf-8")
        try:
            self.process = subprocess.Popen(
                [self.ollama_path, "serve"],
                env=env,
                stdout=self._log_handle,
                stderr=self._log_handle,
                **_detach_kwargs()
            )
        except OSError as exc:
            print("Error: could not start Ollama (%s)." % exc)
            self._close_log()
            self.process = None
        return self.process

    def stop(self, timeout=5):
        """Terminate the server we started, escalating to kill if it lingers."""
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                self.process.kill()
                try:
                    self.process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    print("Warning: Ollama did not exit after kill.")
        self.process = None
        self._close_log()

    def _close_log(self):
        if self._log_handle:
            try:
                self._log_handle.close()
            except OSError:
                pass
            self._log_handle = None

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc_info):
        self.stop()
        return False
