"""Tests for local_apps/kusanagi_core.py -- the shared desktop-app foundation."""
import json
import os
import subprocess

import pytest

import kusanagi_core as core


# --------------------------------------------------------------------------
# Style
# --------------------------------------------------------------------------

# Every attribute the four desktop apps reference. Visualize_AI once shipped a
# Style class containing only UI_FONT plus the comment "# ... (rest of Style
# class is unchanged)", so every one of these raised AttributeError at runtime.
REQUIRED_STYLE_ATTRS = [
    "UI_FONT", "CHAT_FONT", "TITLE_FONT", "BUTTON_FONT", "LOG_FONT",
    "BG_PRIMARY", "BG_SECONDARY", "BG_TERTIARY",
    "FG_PRIMARY", "FG_SECONDARY",
    "ACCENT", "ACCENT_FG", "ERROR", "LINK_FG", "LOG_COLOR",
    "ICON_LOAD", "ICON_SAVE", "ICON_CLEAR", "ICON_SEND",
    "ICON_UNMUTE", "ICON_MUTE", "ICON_NEW_CHAT", "ICON_DELETE",
]


@pytest.mark.parametrize("attr", REQUIRED_STYLE_ATTRS)
def test_style_defines_every_attribute_the_apps_use(attr):
    assert hasattr(core.Style, attr), "Style.%s is referenced by an app" % attr


@pytest.mark.parametrize("attr", [a for a in REQUIRED_STYLE_ATTRS if "FONT" not in a])
def test_style_colours_and_icons_are_non_empty_strings(attr):
    value = getattr(core.Style, attr)
    assert isinstance(value, str) and value, "%s should be a non-empty string" % attr


def test_style_colours_are_valid_hex():
    for attr in ("BG_PRIMARY", "BG_SECONDARY", "BG_TERTIARY", "FG_PRIMARY",
                 "FG_SECONDARY", "ACCENT", "ACCENT_FG", "ERROR", "BORDER"):
        value = getattr(core.Style, attr)
        assert value.startswith("#") and len(value) == 7, "%s = %r" % (attr, value)
        int(value[1:], 16)


def test_style_palette_matches_the_web_stylesheet(repo_root):
    """The desktop palette mirrors static/src/input.css; drift makes them look
    like two different products."""
    import io
    import re

    css = io.open(os.path.join(repo_root, "static", "src", "input.css"),
                  encoding="utf-8").read()

    def css_var(name):
        match = re.search(r"--%s:\s*(#[0-9a-fA-F]{6})" % name, css)
        assert match, "--%s not found in input.css" % name
        return match.group(1).lower()

    assert core.Style.BG_PRIMARY.lower() == css_var("primary")
    assert core.Style.BG_SECONDARY.lower() == css_var("secondary")
    assert core.Style.BG_TERTIARY.lower() == css_var("tertiary")
    assert core.Style.ACCENT.lower() == css_var("accent")
    assert core.Style.ACCENT_FG.lower() == css_var("accent-fg")
    assert core.Style.FG_SECONDARY.lower() == css_var("fg-secondary")


# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

def test_project_root_is_the_repo_root(repo_root):
    assert os.path.normcase(core.PROJECT_ROOT) == os.path.normcase(repo_root)


def test_project_root_contains_the_expected_layout():
    for expected in ("local_apps", "web_apps", "static", "requirements.txt"):
        assert os.path.exists(os.path.join(core.PROJECT_ROOT, expected))


def test_log_path_creates_the_directory_and_returns_an_absolute_path():
    path = core.log_path("test-marker.log")
    assert os.path.isabs(path)
    assert os.path.isdir(os.path.dirname(path))
    assert path.endswith("test-marker.log")


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def test_load_config_returns_all_expected_keys():
    config = core.load_config()
    for key in ("ollama_path", "model_folder", "vector_cache_dir", "embedding_model_name"):
        assert key in config


def test_load_config_resolves_paths_to_absolute():
    config = core.load_config()
    for key in ("ollama_path", "model_folder", "vector_cache_dir"):
        assert os.path.isabs(config[key]), "%s should be absolute" % key


def test_load_config_falls_back_to_defaults_when_file_is_missing():
    config = core.load_config("definitely-not-a-real-config.json")
    assert config["embedding_model_name"] == core.DEFAULT_CONFIG["embedding_model_name"]


def test_load_config_survives_malformed_json(tmp_path, monkeypatch):
    """A corrupt config should warn and fall back, not crash the app on launch."""
    monkeypatch.setattr(core, "PROJECT_ROOT", str(tmp_path))
    (tmp_path / "broken.json").write_text("{ this is not json", encoding="utf-8")

    config = core.load_config("broken.json")
    assert config["embedding_model_name"] == core.DEFAULT_CONFIG["embedding_model_name"]


def test_load_config_ignores_empty_values(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "PROJECT_ROOT", str(tmp_path))
    (tmp_path / "c.json").write_text(
        json.dumps({"embedding_model_name": "", "ollama_path": ""}), encoding="utf-8")

    config = core.load_config("c.json")
    assert config["embedding_model_name"] == core.DEFAULT_CONFIG["embedding_model_name"]


def test_load_config_normalises_windows_separators(tmp_path, monkeypatch):
    """System_Config.json is edited on Windows; the apps also run elsewhere."""
    monkeypatch.setattr(core, "PROJECT_ROOT", str(tmp_path))
    (tmp_path / "vc").mkdir()
    (tmp_path / "c.json").write_text(
        json.dumps({"vector_cache_dir": "vc\\nested"}), encoding="utf-8")

    resolved = core.load_config("c.json")["vector_cache_dir"]
    assert "\\" not in resolved.replace(str(tmp_path), "") or os.sep == "\\"
    assert os.path.isabs(resolved)


def test_vector_cache_may_not_exist_yet(tmp_path, monkeypatch):
    """It is created on demand, so a missing path must not be replaced by the
    default the way a missing ollama binary is."""
    monkeypatch.setattr(core, "PROJECT_ROOT", str(tmp_path))
    (tmp_path / "c.json").write_text(
        json.dumps({"vector_cache_dir": "not/created/yet"}), encoding="utf-8")

    resolved = core.load_config("c.json")["vector_cache_dir"]
    assert resolved.endswith(os.path.join("not", "created", "yet"))


def test_absolute_paths_in_config_are_left_alone(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "PROJECT_ROOT", str(tmp_path))
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (tmp_path / "c.json").write_text(
        json.dumps({"model_folder": str(elsewhere)}), encoding="utf-8")

    assert core.load_config("c.json")["model_folder"] == str(elsewhere)


# --------------------------------------------------------------------------
# Ollama process management
# --------------------------------------------------------------------------

def test_detach_kwargs_are_valid_for_this_platform():
    """The old per-app copies named subprocess.DETACHED_PROCESS unconditionally,
    which does not exist off Windows -- so the apps raised AttributeError there."""
    kwargs = core._detach_kwargs()
    if os.name == "nt":
        assert "creationflags" in kwargs
        assert isinstance(kwargs["creationflags"], int)
    else:
        assert kwargs == {"start_new_session": True}


def test_detach_kwargs_are_accepted_by_popen():
    """Whatever the flags are, Popen must actually take them."""
    proc = subprocess.Popen([os.sys.executable, "-c", "pass"], **core._detach_kwargs())
    proc.wait(timeout=30)
    assert proc.returncode == 0


def test_server_reports_unavailable_for_a_missing_binary():
    server = core.OllamaServer(os.path.join("nope", "ollama"))
    assert server.available is False
    assert server.start() is None


def test_server_reports_unavailable_for_an_empty_path():
    assert core.OllamaServer("").available is False
    assert core.OllamaServer(None).available is False


def test_stopping_a_server_that_never_started_is_a_no_op():
    server = core.OllamaServer("")
    server.stop()
    server.stop()
    assert server.process is None


def test_server_closes_its_log_handle():
    """The old copies opened the log file and dropped the handle."""
    server = core.OllamaServer(os.sys.executable, log_name="test-handle.log")
    assert server.available is True
    server.start()
    server.stop()
    assert server._log_handle is None


def test_server_works_as_a_context_manager():
    with core.OllamaServer("") as server:
        assert server.process is None
    assert server._log_handle is None
