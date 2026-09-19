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

import datetime
import importlib.util
import json
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

__all__ = ["PROJECT_ROOT", "Style", "DEFAULT_CONFIG", "load_config", "save_config",
           "log_path", "open_path", "OllamaServer", "ConsoleRedirector", "Speaker",
           "apply_theme", "SettingsWindow"]


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
    ICON_SEND = "\u27A4"           # ➤
    ICON_UNMUTE = "\U0001F50A"     # 🔊
    ICON_MUTE = "\U0001F507"       # 🔇
    ICON_NEW_CHAT = "\u2795"       # ➕
    ICON_DELETE = "\u2796"         # ➖


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


# --------------------------------------------------------------------------
# Writing configuration back
# --------------------------------------------------------------------------

def save_config(config, config_name="System_Config.json"):
    """Write System_Config.json. Returns True on success.

    The settings dialogs called `self._save_config(...)`, which was never defined
    anywhere -- so saving settings raised AttributeError in both apps. This is
    that missing function.

    Paths are stored relative to PROJECT_ROOT when they live inside it, so a
    moved or shared checkout keeps working.
    """
    out = {}
    for key, value in config.items():
        if key in _PATH_KEYS and value:
            value = str(value)
            try:
                relative = os.path.relpath(value, PROJECT_ROOT)
            except ValueError:
                relative = None          # different drive on Windows
            if relative and not relative.startswith(os.pardir):
                value = relative.replace(os.sep, "/")
        out[key] = value

    path = os.path.join(PROJECT_ROOT, config_name)
    try:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(out, handle, indent=4)
            handle.write("\n")
        return True
    except OSError as exc:
        print("Error: could not write %s (%s)." % (path, exc))
        return False


def open_path(path):
    """Open a file or folder in the desktop's default handler.

    os.startfile only exists on Windows; the apps called it directly, so this
    crashed with AttributeError everywhere else.
    """
    if not os.path.exists(path):
        return False
    try:
        if os.name == "nt":
            os.startfile(path)                                  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return True
    except OSError as exc:
        print("Could not open %s (%s)." % (path, exc))
        return False


# --------------------------------------------------------------------------
# Console redirection
# --------------------------------------------------------------------------

class ConsoleRedirector:
    """Send stdout/stderr to a Tk text widget.

    Replaces three copies that had drifted apart: one without tag support, one
    with, and one that also stamped each line with a time. `timestamps=True`
    gets the last of those.
    """

    def __init__(self, text_widget, tag=None, timestamps=False):
        self.text_widget = text_widget
        self.tag = tag
        self.timestamps = timestamps
        self._at_line_start = True

    @staticmethod
    def _stamp():
        return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]

    def write(self, text):
        if not text:
            return
        try:
            self.text_widget.config(state=tk.NORMAL)
            if self.timestamps:
                self._write_stamped(text)
            else:
                self.text_widget.insert(tk.END, text, self.tag)
            self.text_widget.see(tk.END)
            self.text_widget.config(state=tk.DISABLED)
        except tk.TclError:
            # The window was closed while a background thread was still
            # printing. Losing the line is better than a traceback storm.
            pass

    def _write_stamped(self, text):
        # Split so a single print() cannot produce several timestamps mid-line.
        lines = text.split("\n")
        if lines[0]:
            prefix = "[%s] " % self._stamp() if self._at_line_start else ""
            self.text_widget.insert(tk.END, prefix + lines[0], self.tag)
        for line in lines[1:]:
            self.text_widget.insert(tk.END, "\n")
            if line:
                self.text_widget.insert(tk.END, "[%s] %s" % (self._stamp(), line),
                                        self.tag)
        self._at_line_start = text.endswith("\n")

    def flush(self):
        """Required by the stdout interface; writes land immediately."""


# --------------------------------------------------------------------------
# Text to speech
# --------------------------------------------------------------------------

class Speaker:
    """Queued text-to-speech with a mute toggle.

    pyttsx3 is optional: without it every method is a no-op rather than an
    AttributeError. The worker thread starts on first use, so importing this
    module never spins up an audio engine.
    """

    def __init__(self, engine_factory=None):
        self._queue = queue.Queue()
        self._thread = None
        self._factory = engine_factory
        self.muted = False

    @property
    def available(self):
        """True if speech is possible. Checks for the module without importing
        it, so nothing is loaded until something is actually spoken."""
        if self._factory:
            return True
        try:
            return importlib.util.find_spec("pyttsx3") is not None
        except (ImportError, ValueError):
            return False

    def _worker(self):
        try:
            if self._factory:
                engine = self._factory()
            else:
                import pyttsx3
                engine = pyttsx3.init()
        except Exception as exc:                                # noqa: BLE001
            print("Text-to-speech unavailable (%s)." % exc)
            return

        while True:
            muted, text = self._queue.get()
            try:
                if not muted:
                    engine.say(text)
                    engine.runAndWait()
            except Exception as exc:                            # noqa: BLE001
                print("Speech failed (%s)." % exc)
            finally:
                self._queue.task_done()

    def say(self, text):
        """Queue text to be spoken. Ignored when muted or unavailable."""
        if not text or self.muted or not self.available:
            return
        if self._thread is None:
            self._thread = threading.Thread(target=self._worker, daemon=True)
            self._thread.start()
        self._queue.put((self.muted, text))

    def toggle_mute(self):
        """Flip mute and drop anything still queued. Returns the new state."""
        self.muted = not self.muted
        if self.muted:
            self.clear()
        return self.muted

    def clear(self):
        with self._queue.mutex:
            self._queue.queue.clear()


# --------------------------------------------------------------------------
# Shared ttk theme
# --------------------------------------------------------------------------

def apply_theme(widget):
    """Apply the Kusanagi ttk theme. Call once per top-level window."""
    s = ttk.Style(widget)
    s.theme_use("clam")
    bold = (Style.UI_FONT[0], Style.UI_FONT[1], "bold")

    s.configure(".", background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY,
                font=Style.UI_FONT, borderwidth=0)
    s.configure("TFrame", background=Style.BG_PRIMARY)
    s.configure("TLabel", background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY)
    s.configure("Sidebar.TFrame", background=Style.BG_SECONDARY)
    s.configure("Sidebar.TLabel", background=Style.BG_SECONDARY,
                foreground=Style.FG_PRIMARY)

    s.configure("Accent.Sidebar.TButton", background=Style.ACCENT,
                foreground=Style.ACCENT_FG, font=bold)
    s.map("Accent.Sidebar.TButton", background=[("active", Style.ACCENT_HOVER)])

    s.configure("TEntry", fieldbackground=Style.BG_TERTIARY,
                foreground=Style.FG_PRIMARY, insertcolor=Style.ACCENT,
                borderwidth=0, padding=10)

    s.configure("TCombobox", fieldbackground=Style.BG_TERTIARY,
                background=Style.BG_TERTIARY, foreground=Style.FG_PRIMARY)
    s.map("TCombobox",
          fieldbackground=[("readonly", Style.BG_TERTIARY)],
          background=[("readonly", Style.BG_TERTIARY), ("active", Style.BG_TERTIARY)],
          foreground=[("readonly", Style.FG_PRIMARY)],
          selectbackground=[("readonly", Style.ACCENT)],
          selectforeground=[("readonly", Style.ACCENT_FG)])

    s.configure("Send.TButton", background=Style.ACCENT, foreground=Style.ACCENT_FG,
                font=(Style.UI_FONT[0], 14, "bold"))
    s.map("Send.TButton", background=[("active", Style.ACCENT_HOVER)])

    s.configure("Tool.TButton", background=Style.BG_TERTIARY,
                foreground=Style.FG_PRIMARY, font=(Style.UI_FONT[0], 10))
    s.map("Tool.TButton", background=[("active", Style.BG_PRIMARY)])

    s.configure("Tool.TCheckbutton", background=Style.BG_SECONDARY,
                foreground=Style.FG_PRIMARY, font=(Style.UI_FONT[0], 10))
    s.map("Tool.TCheckbutton", background=[("active", Style.BG_SECONDARY)],
          indicatorcolor=[("selected", Style.ACCENT)])

    s.configure("TopBar.TButton", background=Style.BG_PRIMARY,
                foreground=Style.FG_SECONDARY, font=(Style.UI_FONT[0], 12))
    s.map("TopBar.TButton", foreground=[("active", Style.FG_PRIMARY)])

    # Used by Orochimaru's tabbed sidebar; harmless elsewhere.
    s.configure("TNotebook", background=Style.BG_SECONDARY, borderwidth=0)
    s.configure("TNotebook.Tab", background=Style.BG_TERTIARY,
                foreground=Style.FG_SECONDARY, padding=[5, 2], font=Style.UI_FONT)
    s.map("TNotebook.Tab", background=[("selected", Style.BG_PRIMARY)],
          foreground=[("selected", Style.FG_PRIMARY)])

    # Kusanagi_Local's launcher buttons and status/link labels.
    s.configure("AppButton.TButton", font=Style.BUTTON_FONT, padding=(20, 15))
    s.configure("Accent.TButton", background=Style.ACCENT, foreground=Style.ACCENT_FG)
    s.map("Accent.TButton", background=[("active", Style.ACCENT_HOVER)])
    s.configure("Link.TLabel", foreground=Style.LINK_FG, cursor="hand2",
                background=Style.BG_PRIMARY)
    s.configure("Status.TLabel", background=Style.BG_PRIMARY)

    # Visualize_AI's sliders and model picker.
    s.map("TScale", background=[("!focus", Style.BG_PRIMARY)])
    s.configure("TMenubutton", background=Style.BG_PRIMARY,
                foreground=Style.FG_PRIMARY, borderwidth=0,
                arrowcolor=Style.FG_PRIMARY)
    s.configure("Sidebar.TRadiobutton", background=Style.BG_PRIMARY,
                foreground=Style.FG_PRIMARY, indicatorcolor=Style.BG_PRIMARY,
                bordercolor=Style.BG_PRIMARY)
    s.map("Sidebar.TRadiobutton",
          background=[("active", Style.BG_SECONDARY)],
          indicatorcolor=[("selected", Style.ACCENT), ("!selected", Style.FG_PRIMARY)])
    return s


# --------------------------------------------------------------------------
# Settings dialog
# --------------------------------------------------------------------------

class SettingsWindow(tk.Toplevel):
    """Edit the paths in System_Config.json.

    One dialog for every app; OneTail and Orochimaru each carried their own
    near-identical copy. `save_callback(new_config)` is invoked with the edited
    values so the caller can reload whatever it needs.
    """

    FIELDS = [
        ("ollama_path", "Ollama executable:", "file"),
        ("model_folder", "Model folder:", "dir"),
        ("vector_cache_dir", "Vector cache:", "dir"),
        ("embedding_model_name", "Embedding model:", None),
    ]

    def __init__(self, master, current_config, save_callback):
        super().__init__(master)
        self.title("Settings")
        self.geometry("560x320")
        self.configure(bg=Style.BG_PRIMARY)
        self.resizable(False, False)
        self.current_config = current_config or {}
        self.save_callback = save_callback
        self.entries = {}

        apply_theme(self)
        self._build()

        self.transient(master)
        self.grab_set()
        self.bind("<Escape>", lambda _e: self.destroy())

    def _build(self):
        frame = ttk.Frame(self, style="TFrame")
        frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=12)

        for key, label, kind in self.FIELDS:
            row = ttk.Frame(frame, style="TFrame")
            row.pack(fill=tk.X, pady=6)

            ttk.Label(row, text=label, style="TLabel", width=18,
                      anchor="w").pack(side=tk.LEFT)

            entry = ttk.Entry(row, style="TEntry")
            entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
            entry.insert(0, str(self.current_config.get(key, "")))
            self.entries[key] = entry

            if kind:
                ttk.Button(row, text="Browse", style="Tool.TButton",
                           command=lambda k=key, t=kind: self._browse(k, t)
                           ).pack(side=tk.LEFT, padx=(8, 0))

        buttons = ttk.Frame(frame, style="TFrame")
        buttons.pack(fill=tk.X, pady=(16, 0))
        ttk.Button(buttons, text="Open config file", style="Tool.TButton",
                   command=self._open_config).pack(side=tk.LEFT)
        ttk.Button(buttons, text="Cancel", style="Tool.TButton",
                   command=self.destroy).pack(side=tk.RIGHT)
        ttk.Button(buttons, text="Save", style="Accent.Sidebar.TButton",
                   command=self._save).pack(side=tk.RIGHT, padx=8)

    def _browse(self, key, kind):
        if kind == "file":
            pattern = [("Executables", "*.exe"), ("All files", "*.*")] \
                if os.name == "nt" else [("All files", "*.*")]
            chosen = filedialog.askopenfilename(parent=self, title="Select Ollama",
                                                filetypes=pattern)
        else:
            chosen = filedialog.askdirectory(parent=self, title="Select folder")
        if chosen:
            self.entries[key].delete(0, tk.END)
            self.entries[key].insert(0, chosen)

    @staticmethod
    def _open_config():
        path = os.path.join(PROJECT_ROOT, "System_Config.json")
        if not open_path(path):
            messagebox.showerror("Error", "System_Config.json not found.")

    def _save(self):
        new_config = {key: self.entries[key].get().strip()
                      for key, _label, _kind in self.FIELDS}
        if save_config(new_config):
            messagebox.showinfo(
                "Settings saved",
                "Saved. Restart the app for path changes to take full effect.",
                parent=self)
        else:
            messagebox.showerror("Error", "Could not write System_Config.json.",
                                 parent=self)
            return
        if self.save_callback:
            self.save_callback(new_config)
        self.destroy()
