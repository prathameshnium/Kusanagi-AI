"""Tests for saved chats, code copy, the update check, prompt caching, the
web-tool limit and the Orochimaru layout.

Static checks on the JavaScript and HTML, in the style of the rest of the
suite. They pin the properties that matter rather than the wording:

  - chats are saved only to a folder the user picks, and the code that does it
    can make no network request;
  - a saved chat can be read back, and says which version wrote it;
  - code blocks copy exactly what they show, and are not read aloud as chrome;
  - the update check downloads nothing and reloads past the browser cache;
  - the system prompt stays byte-identical so the prompt cache can hit;
  - Claude's web tools are uncapped unless the user sets a cap.
"""
import io
import os
import re
from html.parser import HTMLParser

import pytest

from conftest import strip_js_comments
from test_web_pages import csp_of

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


CHATS = strip_js_comments(read("static", "chats.js"))
OROCHIMARU = strip_js_comments(read("static", "pages", "orochimaru.js"))
DOM = strip_js_comments(read("static", "dom.js"))
UI = strip_js_comments(read("static", "ui.js"))
KEYS = strip_js_comments(read("static", "keys.js"))
PROVIDERS = strip_js_comments(read("static", "providers.js"))
PROMPTS = read("static", "prompts.js")
OROCHIMARU_HTML = read("web_apps", "Orochimaru_Web_Research_Assistent.html")


def function_body(source, signature):
    """Text of a function from its signature to the next top-level close."""
    return source.split(signature)[1].split("\n    }\n")[0]


# --------------------------------------------------------------------------
# chats.js: a folder the user picks, and nothing leaves the browser
# --------------------------------------------------------------------------

def test_chat_store_makes_no_network_requests():
    """Saved chats are the user's own files; they must never leave the browser."""
    for call in ("fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource",
                 "import(", "new Image", "postMessage"):
        assert call not in CHATS, "chats.js must not use %s" % call


def test_chats_go_to_a_folder_the_user_picks():
    """No folder is written to unless the user chose it, with write access."""
    pick = CHATS.split("pick: function")[1].split("restore: function")[0]
    assert "window.showDirectoryPicker(" in pick
    assert "mode: 'readwrite'" in pick
    assert "supported: typeof window.showDirectoryPicker === 'function'" in CHATS


def test_only_the_folder_handle_is_kept_in_indexeddb():
    """The chats themselves live in the folder, never in browser storage."""
    puts = re.findall(r"\.put\(([^)]*)\)", CHATS)
    assert puts == ["handle, KEY"], "only the folder handle may be stored: %s" % puts
    assert "localStorage" not in CHATS and "sessionStorage" not in CHATS


def test_chat_store_exposes_its_interface():
    """The page relies on every one of these; a missing one breaks saving."""
    api = CHATS.split("window.Kusanagi.chats = {")[1]
    for name in ("supported", "pick", "restore", "reconnect", "forget",
                 "list", "read", "write", "remove"):
        assert re.search(r"\n\s+%s:" % name, api), "chats.%s is missing" % name


def test_permission_is_only_requested_when_asked():
    """Browsers only allow a permission prompt from a click, so restore must not ask."""
    restore = CHATS.split("restore: function")[1].split("reconnect: function")[0]
    assert "granted(handle, false)" in restore
    reconnect = CHATS.split("reconnect: function")[1].split("forget: function")[0]
    assert "granted(dir, true)" in reconnect


# --------------------------------------------------------------------------
# Orochimaru: saving and reopening chats
# --------------------------------------------------------------------------

def test_chat_files_are_named_for_the_page_topic_and_time():
    """The history list and the folder filter both depend on this name."""
    assert "'Orochimaru - ' + chatTopic() + ' - ' + K.ui.fileStamp(when) + '.md'" in OROCHIMARU
    assert "function isChatFile(name) { return /^Orochimaru - .+\\.md$/.test(name); }" \
        in OROCHIMARU


def test_chat_data_is_hidden_in_an_html_comment():
    """Markdown viewers hide the data block, and reopening reads it back."""
    assert "var DATA_START = '<!-- kusanagi-chat ';" in OROCHIMARU
    assert "var DATA_END = ' -->';" in OROCHIMARU


def test_double_dash_cannot_end_the_data_comment_early():
    """A "--" in a chat would otherwise break the comment and lose the data."""
    body = function_body(OROCHIMARU, "function chatDocument()")
    assert ".replace(/--/g, '-\\\\u002d')" in body
    assert "DATA_START + data + DATA_END" in body


def test_folder_notes_which_version_saved_it():
    """"Kusanagi AI.md" tells the user what wrote the files, and when."""
    body = function_body(OROCHIMARU, "function aboutDocument(count)")
    assert "'- Version: ' + K.VERSION" in body
    assert "K.chats.write('Kusanagi AI.md', aboutDocument(" in OROCHIMARU
    assert re.search(r"window\.Kusanagi\.VERSION = '[^']+';", UI), "ui.js must define VERSION"


def test_every_answer_is_saved_to_the_folder():
    """A chat that is only saved on request is lost when the tab closes."""
    after_answer = OROCHIMARU.split("addAI(res.text, sources, res.reasoning, res.webSources);")[1]
    assert "persist();" in after_answer.split("showCache(res.usage);")[0]
    queue = function_body(OROCHIMARU, "function persist()")
    assert "saving = saving.then(saveNow, saveNow);" in queue, \
        "saves must run one after another, or an older copy can land last"
    body = function_body(OROCHIMARU, "function saveNow()")
    assert "if (!folder || !folder.ready || !turns.length) return null;" in body
    assert "freeName(chatFileName(chatStarted))" in body, "a new chat must not overwrite an old file"
    assert "if (token !== chatToken) return null;" in body
    assert "K.chats.write(name, chatDocument())" in body


def test_a_reply_for_a_chat_no_longer_open_is_dropped():
    """Switching chats mid-answer must not write the answer into the other chat."""
    assert "chatToken += 1;" in function_body(OROCHIMARU, "function resetChat()")
    ask = function_body(OROCHIMARU, "function ask(messages, userFacing, sources, kept)")
    assert "var token = chatToken;" in ask
    assert ask.count("if (token !== chatToken) return") == 2


def test_reopened_chats_restore_their_turns():
    """Reopening must bring back the conversation, not just show the file."""
    body = function_body(OROCHIMARU, "function openChat(name)")
    assert "readChatDocument(text)" in body
    assert "cleanTurns(data.turns)" in body
    assert "addUser(" in body and "addAI(" in body
    assert "history = cleanHistory(data.history, shown);" in body, \
        "history sent to the model must match what the user sees"
    assert "chatFile = name;" in body, "later answers must go to the same file"


def test_orochimaru_loads_chats_between_keys_and_the_page():
    """K.chats must exist before orochimaru.js runs, and loads after keys.js."""
    order = re.findall(r'<script src="\.\./static/([^"]+)"', OROCHIMARU_HTML)
    assert "chats.js" in order
    assert order.index("keys.js") < order.index("chats.js") < order.index("pages/orochimaru.js")


# --------------------------------------------------------------------------
# Code blocks: a copy bar that copies exactly the code
# --------------------------------------------------------------------------

def test_rendered_code_blocks_get_a_copy_bar():
    """Copying code by hand-selecting picks up stray text and line breaks."""
    assert "codeCopy(target);" in DOM
    body = function_body(DOM, "function codeCopy(target)")
    assert "class: 'code-copy'" in body
    assert "ui.bindCopy(button, function () { return code.textContent; });" in body


def test_code_bar_is_not_read_aloud():
    """Speech should read the code, not the language label and "Copy"."""
    body = function_body(UI, "function speakableText(node)")
    assert ".code-head" in body


# --------------------------------------------------------------------------
# Update check
# --------------------------------------------------------------------------

def test_update_check_uses_head_requests_past_the_cache():
    """A cached answer would hide a new version; a GET would download it."""
    body = function_body(UI, "function versionOf(url)")
    assert "method: 'HEAD'" in body and "cache: 'no-store'" in body


def test_update_check_skips_vendor_files():
    """Vendor libraries are large and rarely change; polling them wastes data."""
    body = function_body(UI, "function ownAssets()")
    assert "url.pathname.indexOf('/vendor/') === -1" in body
    assert "url.origin === window.location.origin" in body


def test_reload_refetches_own_files_before_reloading():
    """A plain reload can run old cached scripts against the new page."""
    body = function_body(UI, "function reloadFresh()")
    assert "fetch(url, { cache: 'reload' })" in body
    assert body.index("cache: 'reload'") < body.index("window.location.reload()")
    assert "on: { click: reloadFresh }" in UI


def test_pages_with_the_update_check_allow_same_origin_requests(page_sources):
    """Without connect-src 'self' the CSP silently blocks the update check."""
    checked = 0
    for name, html in page_sources.items():
        if "static/ui.js" not in html:
            continue
        checked += 1
        assert "'self'" in csp_of(html).get("connect-src", []), \
            "%s loads ui.js but connect-src lacks 'self'" % name
    assert checked, "no page loads ui.js"


# --------------------------------------------------------------------------
# Prompt caching (the frozen system prompt is tested in test_vault_and_answers)
# --------------------------------------------------------------------------

def test_per_turn_context_travels_in_the_user_turn():
    """Excerpts and skills change every turn, so they go in the message."""
    assert "function chatTurn(question, chunks, documentNames, strict, skillIds)" in PROMPTS
    body = function_body(PROMPTS, "function chatTurn(")
    assert "sourcesBlock(excerpts(chunks)" in body
    assert "K.prompts.chatTurn(query, chunks, docNames(), strictMode(), activeSkills)" \
        in OROCHIMARU
    assert "{ role: 'system', content: K.prompts.chatSystemPrompt() }" in OROCHIMARU


def test_one_shot_prompts_get_no_tail_cache_breakpoint():
    """Only conversations resend their tail; elsewhere it adds the write premium."""
    assert "if (cache && opts && opts.conversation) body.cache_control" in PROVIDERS
    assert "conversation: true," in OROCHIMARU


def test_usage_reports_cache_reads_and_writes():
    """The page shows the cache hit rate; it needs both counts from the API."""
    assert "data.usage.cache_read_input_tokens" in PROVIDERS
    assert "data.usage.cache_creation_input_tokens" in PROVIDERS
    assert "cache_read_tokens: usage.cache_read" in PROVIDERS
    assert "cache_write_tokens: usage.cache_write" in PROVIDERS
    assert "prompt_tokens: usage.input_tokens + usage.cache_read + usage.cache_write" \
        in PROVIDERS


# --------------------------------------------------------------------------
# Web tool limit
# --------------------------------------------------------------------------

def test_web_tools_are_uncapped_unless_the_user_sets_a_limit():
    """A default cap cut research short; max_uses is sent only when chosen."""
    assert PROVIDERS.count("max_uses") == 1
    assert "var limit = parseInt(option('webLimit'), 10);" in PROVIDERS
    assert "if (limit > 0) tools.forEach(function (t) { t.max_uses = limit; });" in PROVIDERS


def test_web_limit_preference_offers_the_documented_values():
    """An unknown stored value falls back to the default, so the list must match the UI."""
    assert "webLimit: { default: '', values: ['', '5', '10', '25'] }" in KEYS


def test_claude_controls_offer_a_web_select():
    """The chat box is where the web tools and their limit are switched."""
    body = function_body(UI, "function claudeControls(provider)")
    for value, label in (("off", "Web: off"), ("", "Web: no limit"), ("5", "Web: 5 each"),
                         ("10", "Web: 10 each"), ("25", "Web: 25 each")):
        assert "['%s', '%s']" % (value, label) in body, label
    assert "prefs.setClaude('webLimit', web.value)" in body


# --------------------------------------------------------------------------
# Orochimaru layout
# --------------------------------------------------------------------------

class _Ancestry(HTMLParser):
    """Records the ids of every element enclosing each id'd element."""

    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
            "meta", "source", "track", "wbr"}

    def __init__(self):
        HTMLParser.__init__(self)
        self.stack = []
        self.parents = {}
        self.elements = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        ident = attrs.get("id")
        if ident:
            self.parents[ident] = [a for _, a in self.stack if a]
            self.elements[ident] = (tag, attrs)
        if tag not in self.VOID:
            self.stack.append((tag, ident))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


@pytest.fixture(scope="module")
def layout():
    parser = _Ancestry()
    parser.feed(OROCHIMARU_HTML)
    return parser


def test_model_picker_sits_in_the_chat_box(layout):
    """The model is chosen where the question is typed, not in the sidebar."""
    assert "chat-controls" in layout.parents["model-select"]
    assert "sidebar" not in layout.parents["model-select"]


def test_sidebar_can_be_toggled_accessibly(layout):
    """On narrow screens the sidebar is hidden behind a labelled button."""
    tag, attrs = layout.elements["sidebar"]
    assert "app-sidebar" in attrs.get("class", "").split()
    tag, attrs = layout.elements["sidebar-toggle"]
    assert tag == "button" and attrs.get("aria-controls") == "sidebar"
    assert "aria-expanded" in attrs


def test_sidebar_sections_are_collapsible_panels():
    """Each section folds away so the sidebar stays short."""
    aside = OROCHIMARU_HTML.split('<aside id="sidebar"')[1].split("</aside>")[0]
    panels = re.findall(r'<details[^>]*class="panel[^"]*"[^>]*>\s*<summary>([^<]+)', aside)
    titles = [p.strip() for p in panels]
    for title in ("Documents", "Chat history", "Skills", "Settings"):
        assert title in titles, "%s is not a <details class=\"panel\">" % title
