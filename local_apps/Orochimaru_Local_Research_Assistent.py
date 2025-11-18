import tkinter as tk
from tkinter import scrolledtext, ttk, Listbox, filedialog, messagebox
import re
import time
import threading
import queue
import subprocess
import sys
import os
import gc
import datetime
import json
import signal
import shutil

# --- PROJECT ROOT ---
# Assumes the script is in a subdirectory of the project root (e.g., 'local_apps')
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# --- RAG & File Processing Imports ---
try:
    import fitz  # PyMuPDF
except ImportError:
    messagebox.showerror("Dependency Error", "PyMuPDF missing.\nPlease run 'pip install PyMuPDF'")
    exit()

try:
    import numpy as np
except ImportError:
    messagebox.showerror("Dependency Error", "NumPy missing.\nPlease run 'pip install numpy'")
    exit()

try:
    import psutil
except ImportError:
    messagebox.showerror("Dependency Error", "psutil missing.\nPlease run 'pip install psutil'")
    exit()

# --- Standard App Imports ---
try:
    import ollama
    # Create a single, reusable client for efficiency
    # ollama_client is initialized later in ResearchApp.__init__ based on config
    ollama_client = None
except ImportError:
    messagebox.showerror("Dependency Error", "Ollama library missing.\nPlease run 'pip install ollama'")
    exit()

try:
    import pyttsx3
except ImportError:
    print("Warning: 'pyttsx3' not found. TTS will be disabled.")
    pyttsx3 = None

# --- UI CONSTANTS ---
class Style:
    UI_FONT = ("Segoe UI", 11)
    CHAT_FONT = ("Segoe UI", 11)
    TITLE_FONT = ("Segoe UI", 18, "bold")
    LOG_FONT = ("Courier New", 9)
    BG_PRIMARY = "#193549"
    BG_SECONDARY = "#002240"
    BG_TERTIARY = "#25435A"
    FG_PRIMARY = "#FFFFFF"
    FG_SECONDARY = "#97B1C2"
    ACCENT = "#ffab40"
    ACCENT_FG = "#002240"
    ERROR = "#FF628C"
    LOG_COLOR = "#F1FA8C"
    ICON_LOAD = "📄"
    ICON_SAVE = "💾"
    ICON_CLEAR = "🗑️"
    ICON_SEND = "➤"
    ICON_UNMUTE = "🔊"
    ICON_MUTE = "🔇"
    ICON_NEW_CHAT = "➕"
    ICON_DELETE = "➖"

# --- GLOBAL STATE & PROMPTS ---
ENTRY_PLACEHOLDER = "Ask a question or type a command..."
NORMAL_RAG_SYSTEM_PROMPT = """You are an accurate and helpful AI assistant specializing in document analysis.
Your primary goal is to answer the user's question SOLELY based on the provided document context.
Strictly adhere to the following rules:
1.  **Answer only from the provided context.** Do not use any outside knowledge.
2.  If the answer is not explicitly present in the provided context, state clearly and concisely: "I cannot find the answer to your question in the provided document." Do NOT attempt to guess or infer.
3.  Do not make up any information.
4.  If applicable, cite the page number(s) from which you extracted the information. The page numbers are provided in the context as '[Page X]:'.
"""
SUMMARIZE_SYSTEM_PROMPT = "You are a helpful AI assistant. Your user wants you to summarize a research paper. Provide a concise summary of the document provided."
REVIEW_SYSTEM_PROMPT = "You are a helpful AI assistant with expertise in research papers. Your user wants you to provide a peer review of a research paper. Provide a critical review of the document, focusing on its strengths and weaknesses."
tts_queue = queue.Queue()
ALL_REVIEWERS = {
    "Physicist": "You are a reviewer with expertise in Physics. Focus on the underlying physical principles, theoretical models, and the validity of any physical measurements presented.",
    "Chemist": "You are a reviewer with expertise in Chemistry. Focus on the chemical compositions, reactions, and material properties from a chemical standpoint.",
    "Material Synthesis Expert": "You are a reviewer with expertise in Material Synthesis. Focus on the novelty, reproducibility, and scalability of the synthesis techniques.",
    "Editor": "You are an editor. Review the paper for clarity, grammar, style, and overall structure. Ensure the arguments are presented logically and the paper is easy to understand.",
    "Chief Editor": "You are the Chief Editor. Your job is to read the user's request and all the reviews from the experts. Synthesize their points into a single, cohesive, and balanced final review. Address the user's prompt directly."
}
def tts_worker():
    engine = pyttsx3.init()
    while True:
        is_muted, text = tts_queue.get()
        if not is_muted:
            engine.say(text)
            engine.runAndWait()
        tts_queue.task_done()

class ResearchApp(tk.Tk):
    def __init__(self):
        super().__init__()
        print("--- App Initializing ---")

        self.app_config = self._load_config()
        self.cot_var = tk.BooleanVar(value=False)

        # 1. Initialize core attributes
        self.ollama_client = None
        self.ollama_process = None # To store the subprocess
        self.stop_loading_event = threading.Event()
        self.is_muted = False
        self.embedding_model_available = False
        self.last_tok_per_sec = ""
        self.pdf_text_db = {}
        self.chat_sessions = {}
        self.current_chat_id = None
        self.chat_counter = 0
        self.processing_thread = None
        self._temp_review_doc_id = None
        self._temp_review_full_text = None
        self.vector_cache_dir = self.app_config.get("vector_cache_dir", "vector_cache")
        os.makedirs(self.vector_cache_dir, exist_ok=True)
        self.title("Orochimaru - Local RAG AI")
        self.geometry("1200x800")
        self.configure(bg=Style.BG_PRIMARY)
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.setup_styles()
        self.embedding_model_name = self.app_config.get("embedding_model_name", "mxbai-embed-large")
        self.reviewer_var = tk.StringVar()
        self.create_widgets()
        self._initialize_ollama() # Moved after create_widgets
        self.start_services()


    def setup_styles(self):
        s = ttk.Style(self)
        s.theme_use('clam')
        s.configure('.', background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY, font=Style.UI_FONT, borderwidth=0)
        s.configure('TFrame', background=Style.BG_PRIMARY)
        s.configure('Sidebar.TFrame', background=Style.BG_SECONDARY)
        s.configure('Sidebar.TLabel', background=Style.BG_SECONDARY, foreground=Style.FG_PRIMARY)
        s.configure('Accent.Sidebar.TButton', background=Style.ACCENT, foreground=Style.ACCENT_FG, font=(Style.UI_FONT[0], Style.UI_FONT[1], 'bold'))
        s.map('Accent.Sidebar.TButton', background=[('active', "#e69a38")])
        s.configure('TNotebook', background=Style.BG_SECONDARY, borderwidth=0)
        s.configure('TNotebook.Tab', background=Style.BG_TERTIARY, foreground=Style.FG_SECONDARY, padding=[5, 2], font=Style.UI_FONT)
        s.map('TNotebook.Tab', background=[('selected', Style.BG_PRIMARY)], foreground=[('selected', Style.FG_PRIMARY)])
        s.configure('TEntry', fieldbackground=Style.BG_TERTIARY, foreground=Style.FG_PRIMARY, insertcolor=Style.ACCENT, borderwidth=0, padding=10)
        s.configure('TCombobox', fieldbackground=Style.BG_TERTIARY, background=Style.BG_TERTIARY, foreground=Style.FG_PRIMARY)
        s.map('TCombobox', fieldbackground=[('readonly', Style.BG_TERTIARY)], background=[('readonly', Style.BG_TERTIARY)], foreground=[('readonly', Style.FG_PRIMARY)])
        s.map('TCombobox', selectbackground=[('readonly', Style.ACCENT)], selectforeground=[('readonly', Style.ACCENT_FG)])
        s.map('TCombobox', background=[('active', Style.BG_TERTIARY)])
        s.configure('Send.TButton', background=Style.ACCENT, foreground=Style.ACCENT_FG, font=(Style.UI_FONT[0], 14, "bold"))
        s.map('Send.TButton', background=[('active', "#D9A800")])
        s.configure('Tool.TButton', background=Style.BG_TERTIARY, foreground=Style.FG_PRIMARY, font=(Style.UI_FONT[0], 10))
        s.map('Tool.TButton', background=[('active', Style.BG_PRIMARY)])
        s.configure('Tool.TCheckbutton', background=Style.BG_SECONDARY, foreground=Style.FG_PRIMARY, font=(Style.UI_FONT[0], 10))
        s.map('Tool.TCheckbutton', background=[('active', Style.BG_SECONDARY)], indicatorcolor=[('selected', Style.ACCENT)])
        s.configure('TopBar.TButton', background=Style.BG_PRIMARY, foreground=Style.FG_SECONDARY, font=(Style.UI_FONT[0], 12))
        s.map('TopBar.TButton', foreground=[('active', Style.FG_PRIMARY)])

    def _show_reviewer_menu(self):
        menu = tk.Menu(self, tearoff=0)
        for role in ALL_REVIEWERS.keys():
            menu.add_command(label=role, command=lambda r=role: self._start_review_with_role(r))
        
        # Display the menu at the current mouse position
        try:
            menu.tk_popup(self.winfo_pointerx(), self.winfo_pointery())
        finally:
            menu.grab_release()

    def _start_review_with_role(self, reviewer_role):
        # Retrieve the temporarily stored document info
        doc_id = self._temp_review_doc_id
        full_text = self._temp_review_full_text

        threading.Thread(target=self.review_thread, args=(full_text, self.current_chat_id, reviewer_role), daemon=True).start()

    def create_widgets(self):
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(1, weight=1)
        self._create_sidebar()
        self._create_main_content()

    def _create_sidebar(self):
        self.sidebar = ttk.Frame(self, width=320, style='Sidebar.TFrame')
        self.sidebar.grid(row=0, column=0, sticky="ns", padx=(5,0), pady=5)
        self.sidebar.pack_propagate(False)

        # --- Header Section ---
        ttk.Label(self.sidebar, text="Orochimaru", font=Style.TITLE_FONT, foreground=Style.ACCENT, style='Sidebar.TLabel').pack(pady=(10, 0), padx=15, anchor="w")
        ttk.Label(self.sidebar, text="Developed by Prathamesh Deshmukh", style='Sidebar.TLabel', font=("Segoe UI", 12, "bold"), foreground=Style.ACCENT).pack(pady=(0, 5), padx=15, anchor="w")
        ttk.Label(self.sidebar, text="Local RAG AI Assistant", style='Sidebar.TLabel', foreground=Style.FG_SECONDARY).pack(pady=(0, 15), padx=15, anchor="w")

        # --- Status Section ---
        status_frame = ttk.Frame(self.sidebar, style='Sidebar.TFrame')
        status_frame.pack(fill=tk.X, padx=15, pady=5)
        self.status_light = ttk.Label(status_frame, text="●", font=("Segoe UI", 12), foreground=Style.FG_SECONDARY, style='Sidebar.TLabel')
        self.status_light.pack(side=tk.LEFT)
        self.status_label = ttk.Label(status_frame, text="Connecting...", style='Sidebar.TLabel')
        self.status_label.pack(side=tk.LEFT, padx=5)

        # --- Document Loading Section ---
        self.load_pdf_button = ttk.Button(self.sidebar, text=f"{Style.ICON_LOAD} Load Document", style='Accent.Sidebar.TButton', command=lambda: self.load_new_pdf())
        self.load_pdf_button.pack(fill=tk.X, padx=15, pady=10, ipady=5)

        ttk.Separator(self.sidebar, orient='horizontal').pack(fill='x', padx=15, pady=10)

        # --- Model Controls Section ---
        model_controls_frame = ttk.Frame(self.sidebar, style='Sidebar.TFrame')
        model_controls_frame.pack(fill=tk.X, padx=15, pady=(0, 10))

        ttk.Label(model_controls_frame, text="Chat Model:", style='Sidebar.TLabel').pack(anchor='w')
        self.model_var = tk.StringVar()
        self.model_selector = ttk.Combobox(model_controls_frame, textvariable=self.model_var, state="readonly")
        self.model_selector.pack(fill=tk.X, pady=(5,0))

        ttk.Label(model_controls_frame, text="Temperature:", style='Sidebar.TLabel').pack(anchor='w', pady=(10,0))
        self.temperature_var = tk.DoubleVar(value=0.0)
        self.temperature_slider = ttk.Scale(model_controls_frame, from_=0.0, to=1.0, orient=tk.HORIZONTAL, variable=self.temperature_var, command=self._update_temperature_label)
        self.temperature_slider.pack(fill=tk.X, pady=(5,0))
        self.temp_label = ttk.Label(model_controls_frame, text=f"Value: {self.temperature_var.get():.2f}", style='Sidebar.TLabel')
        self.temp_label.pack(anchor='w')



        ttk.Separator(self.sidebar, orient='horizontal').pack(fill='x', padx=15, pady=15)

        # --- Embedding Model Section ---
        embed_frame = ttk.Frame(self.sidebar, style='Sidebar.TFrame')
        embed_frame.pack(fill=tk.X, padx=15, pady=(0, 10))
        ttk.Label(embed_frame, text="Embedding Model:", style='Sidebar.TLabel').pack(anchor='w')
        self.embed_status_label = ttk.Label(embed_frame, text=f"{self.embedding_model_name} (Checking...)", style='Sidebar.TLabel', foreground=Style.FG_SECONDARY)
        self.embed_status_label.pack(anchor='w')

        # --- History Tabs ---
        self.history_notebook = ttk.Notebook(self.sidebar, style='TNotebook')
        self.history_notebook.pack(fill=tk.BOTH, expand=True, padx=15, pady=10)

        chat_history_frame = ttk.Frame(self.history_notebook, style='Sidebar.TFrame')
        doc_history_frame = ttk.Frame(self.history_notebook, style='Sidebar.TFrame')

        self.history_notebook.add(chat_history_frame, text="Chats")
        self.history_notebook.add(doc_history_frame, text="Documents")

        # --- Chat History Controls ---
        chat_buttons_frame = ttk.Frame(chat_history_frame, style='Sidebar.TFrame')
        chat_buttons_frame.pack(fill=tk.X, pady=(5,0))
        ttk.Button(chat_buttons_frame, text=Style.ICON_NEW_CHAT, style='Tool.TButton', command=self.start_new_chat).pack(side=tk.LEFT, padx=(0,5))
        ttk.Button(chat_buttons_frame, text=Style.ICON_DELETE, style='Tool.TButton', command=self.remove_selected_chat).pack(side=tk.LEFT)

        self.chat_list_box = Listbox(chat_history_frame, bg=Style.BG_TERTIARY, fg=Style.FG_PRIMARY, selectbackground=Style.ACCENT, selectforeground=Style.ACCENT_FG, highlightthickness=0, borderwidth=0, exportselection=False)
        self.chat_list_box.pack(fill=tk.BOTH, expand=True, pady=5)
        self.chat_list_box.bind("<<ListboxSelect>>", lambda e: self.on_history_select(e, 'chat'))

        # --- Document History Controls ---
        doc_buttons_frame = ttk.Frame(doc_history_frame, style='Sidebar.TFrame')
        doc_buttons_frame.pack(fill=tk.X, pady=(5,0))
        ttk.Button(doc_buttons_frame, text=Style.ICON_DELETE, style='Tool.TButton', command=self.remove_selected_pdf).pack(side=tk.LEFT)

        self.doc_list_box = Listbox(doc_history_frame, bg=Style.BG_TERTIARY, fg=Style.FG_PRIMARY, selectbackground=Style.ACCENT, selectforeground=Style.ACCENT_FG, highlightthickness=0, borderwidth=0, exportselection=False)
        self.doc_list_box.pack(fill=tk.BOTH, expand=True, pady=5)
        self.doc_list_box.bind("<<ListboxSelect>>", lambda e: self.on_history_select(e, 'doc'))

    def _update_temperature_label(self, value):
        self.temp_label.config(text=f"Value: {float(value):.2f}")

    def on_check_mode_button_click(self):
        messagebox.showinfo("Not Implemented", "Check mode is not yet implemented.")

    def _create_main_content(self):
        main_area = ttk.Frame(self)
        main_area.grid(row=0, column=1, sticky="nsew", padx=5, pady=5)
        main_area.grid_rowconfigure(1, weight=1)
        main_area.grid_columnconfigure(0, weight=1)

        top_bar = ttk.Frame(main_area)
        top_bar.grid(row=0, column=0, sticky="ew", padx=5, pady=(0,5))
        self.current_chat_label = ttk.Label(top_bar, text="New Chat", font=(Style.UI_FONT[0], 12, "bold"))
        self.current_chat_label.pack(side=tk.LEFT, padx=(0, 20))
        self.stats_label = ttk.Label(top_bar, text="RAM: --%", font=Style.UI_FONT, foreground=Style.FG_SECONDARY)
        self.stats_label.pack(side=tk.LEFT, padx=0)
        
        # Right-aligned buttons
        right_buttons_frame = ttk.Frame(top_bar)
        right_buttons_frame.pack(side=tk.RIGHT)

        ttk.Button(right_buttons_frame, text="⚙️", style='TopBar.TButton', command=self.open_settings_window).pack(side=tk.RIGHT, padx=5)
        ttk.Button(right_buttons_frame, text=Style.ICON_CLEAR, style='TopBar.TButton', command=lambda: self.clear_chat()).pack(side=tk.RIGHT)
        ttk.Button(right_buttons_frame, text=Style.ICON_SAVE, style='TopBar.TButton', command=lambda: self.save_chat()).pack(side=tk.RIGHT, padx=5)
        self.mute_button = ttk.Button(right_buttons_frame, text=Style.ICON_UNMUTE, style='TopBar.TButton', command=lambda: self.toggle_mute())
        self.mute_button.pack(side=tk.RIGHT, padx=5)
        if not pyttsx3: self.mute_button.config(state=tk.DISABLED, text=Style.ICON_MUTE) # Disable if TTS not available

        self.chat_box = scrolledtext.ScrolledText(main_area, wrap=tk.WORD, state=tk.DISABLED, bg=Style.BG_PRIMARY, fg=Style.FG_PRIMARY, font=Style.CHAT_FONT, relief=tk.FLAT, borderwidth=0, highlightthickness=0, padx=10, pady=10)
        self.chat_box.grid(row=1, column=0, sticky="nsew", padx=5)
        self.chat_box.tag_config("user_tag", foreground=Style.FG_PRIMARY, font=(Style.CHAT_FONT[0], Style.CHAT_FONT[1], "bold"))
        self.chat_box.tag_config("bot_name_tag", foreground=Style.ACCENT, font=(Style.CHAT_FONT[0], Style.CHAT_FONT[1], "bold"))
        self.chat_box.tag_config("thinking_tag", foreground=Style.FG_SECONDARY, font=(Style.CHAT_FONT[0], Style.CHAT_FONT[1], "italic"))
        self.chat_box.tag_config("error_tag", foreground=Style.ERROR, font=(Style.CHAT_FONT[0], Style.CHAT_FONT[1], "bold"))

        # --- Action Buttons ---
        action_buttons_frame = ttk.Frame(main_area)
        action_buttons_frame.grid(row=2, column=0, sticky="ew", padx=5, pady=(5,0))
        action_buttons_frame.grid_columnconfigure(0, weight=1)
        action_buttons_frame.grid_columnconfigure(1, weight=1)
        action_buttons_frame.grid_columnconfigure(2, weight=1)
        action_buttons_frame.grid_columnconfigure(3, weight=1)

        ttk.Button(action_buttons_frame, text="Summarize Document", style='Accent.Sidebar.TButton', command=self.on_summarize_button_click).grid(row=0, column=0, sticky="ew", padx=(0,5))
        ttk.Button(action_buttons_frame, text="Review Document", style='Accent.Sidebar.TButton', command=self.on_review_button_click).grid(row=0, column=1, sticky="ew", padx=5)
        ttk.Button(action_buttons_frame, text="Paraphrase", style='Accent.Sidebar.TButton', command=self.on_paraphrase_button_click).grid(row=0, column=2, sticky="ew", padx=5)
        ttk.Button(action_buttons_frame, text="Checker", style='Accent.Sidebar.TButton', command=self.on_check_mode_button_click).grid(row=0, column=3, sticky="ew", padx=(5,0))

        input_frame = ttk.Frame(main_area)
        input_frame.grid(row=3, column=0, sticky="ew", padx=5, pady=5)
        input_frame.grid_columnconfigure(0, weight=1)
        self.entry_box = ttk.Entry(input_frame, style='TEntry')
        self.entry_box.grid(row=0, column=0, sticky="ew", ipady=5)
        self.entry_box.bind("<FocusIn>", self.on_entry_focus_in)
        self.entry_box.bind("<FocusOut>", self.on_entry_focus_out)
        self.bind('<Return>', lambda event: self.on_send_click())
        ttk.Button(input_frame, text=Style.ICON_SEND, command=self.on_send_click, style='Send.TButton').grid(row=0, column=1, padx=(10, 0))

    def start_services(self):
        print("--- Starting Application Services (TTS, Model Polling, UI Updates) ---")
        if pyttsx3: 
            print("Starting TTS worker thread...")
            threading.Thread(target=tts_worker, daemon=True).start()
        self.after(1000, lambda: self.update_system_stats())
        self.add_placeholder()
        
    def on_closing(self):
        self.stop_loading_event.set()
        self._stop_ollama_server()
        self.destroy()

    def on_entry_focus_in(self, event):
        if self.entry_box.get() == ENTRY_PLACEHOLDER:
            self.entry_box.delete(0, tk.END); self.entry_box.config(foreground=Style.FG_PRIMARY)

    def on_entry_focus_out(self, event):
        if not self.entry_box.get(): self.add_placeholder()

    def add_placeholder(self):
        self.entry_box.delete(0, tk.END); self.entry_box.config(foreground=Style.FG_SECONDARY); self.entry_box.insert(0, ENTRY_PLACEHOLDER)

    def append_to_chat(self, text, tag=None):
        self.chat_box.config(state=tk.NORMAL); self.chat_box.insert(tk.END, text, tag or "bot_tag"); self.chat_box.config(state=tk.DISABLED)

    def finalize_response(self):
        self.append_to_chat("\n\n"); self.chat_box.see(tk.END)

    def speak_text(self, text):
        if text and pyttsx3: tts_queue.put((self.is_muted, text))

    def toggle_mute(self):
        self.is_muted = not self.is_muted
        self.mute_button.config(text=Style.ICON_MUTE if self.is_muted else Style.ICON_UNMUTE)
        if self.is_muted:
            with tts_queue.mutex: tts_queue.queue.clear()

    def run_loading_animation(self):
        animation_chars = ['Thinking... o', 'Thinking... oO', 'Thinking... oOo', 'Thinking... oOoO', 'Thinking... oOoOo', 'Thinking... oOoOoO', 'Thinking... oOoOoOo', 'Thinking... oOoOoOoO']
        idx = 0
        while not self.stop_loading_event.is_set():
            self.after(0, lambda t=animation_chars[idx % len(animation_chars)]: self.status_label.config(text=t, foreground=Style.ACCENT))
            time.sleep(0.2); idx += 1
        self.after(0, lambda: self.status_label.config(text="Idle.", foreground="#3AD900"))

    def on_send_click(self):
        prompt = self.entry_box.get()
        if not (prompt.strip() and prompt != ENTRY_PLACEHOLDER): return
        print(f"Sending prompt: \"{prompt}\"")
        
        if not self.model_var.get() or "No models" in self.model_var.get(): 
            messagebox.showerror("Model Error", "Please select a valid chat model.")
            return

        is_rag_chat = self.current_chat_id in self.pdf_text_db
        if is_rag_chat and not self.embedding_model_available:
            messagebox.showerror("Embedding Model Error", f"Cannot query document because the embedding model '{self.embedding_model_name}' is not available.")
            return

        self.append_to_chat(f"You: {prompt}\n", "user_tag"); self.chat_box.see(tk.END)
        self.entry_box.config(state=tk.DISABLED); self.entry_box.delete(0, tk.END); self.add_placeholder()

        target_thread = self.rag_chat_thread if is_rag_chat else self.normal_chat_thread
        args = (prompt,) if is_rag_chat else (prompt, self.chat_sessions[self.current_chat_id])
        threading.Thread(target=target_thread, args=args, daemon=True).start()

    def stream_response_to_chat(self, response_stream):
        print("Streaming response to chat window...")
        full_response, tts_buffer, token_batch = "", "", []
        token_count, start_time, last_update_time, update_interval = 0, time.time(), time.time(), 0.05
        first_token_received = False

        sentence_enders = re.compile(r'([.!?\n])') # Regex to split by sentence endings, keeping the delimiter

        for chunk in response_stream:
            if not first_token_received:
                self.after(0, lambda: self.entry_box.config(state=tk.NORMAL)); first_token_received = True
            
            token = chunk['message']['content']
            full_response += token
            token_batch.append(token)
            tts_buffer += token
            token_count += 1

            if time.time() - last_update_time > update_interval:
                self.after(0, self.append_to_chat, "".join(token_batch)); token_batch.clear(); last_update_time = time.time()

            # Process tts_buffer for complete sentences
            parts = sentence_enders.split(tts_buffer)
            new_tts_buffer = ""
            for i in range(0, len(parts), 2):
                sentence = parts[i]
                if i + 1 < len(parts): # If there's a delimiter
                    delimiter = parts[i+1]
                    if delimiter in ['.', '?', '!', '\n']: # Only consider these as sentence endings for TTS
                        self.speak_text((sentence + delimiter).strip())
                    else: # Keep other delimiters (like spaces) in the buffer
                        new_tts_buffer += sentence + delimiter
                else: # No delimiter, keep in buffer
                    new_tts_buffer += sentence
            tts_buffer = new_tts_buffer

        if token_batch: self.after(0, self.append_to_chat, "".join(token_batch))
        if tts_buffer.strip(): # Speak any remaining text in the buffer
            self.speak_text(tts_buffer.strip())

        self.last_tok_per_sec = f"Tok/s: {token_count / (time.time() - start_time):.2f}" if time.time() > start_time else "Tok/s: --"
        if self.current_chat_id: self.chat_sessions[self.current_chat_id].append({'role': 'assistant', 'content': full_response})
        print("Finished streaming response.")
        self.after(0, self.finalize_response)

    def find_relevant_chunks(self, query_vector, doc_id, top_k=5):
        if doc_id not in self.pdf_text_db:
            return []

        mmap_path = os.path.join(self.vector_cache_dir, f"{doc_id}.mmap")
        if not os.path.exists(mmap_path):
            return []

        num_chunks = len(self.pdf_text_db[doc_id])
        if num_chunks == 0:
            return []
        
        try:
            mmap_vectors = np.memmap(mmap_path, dtype=np.float16, mode='r', shape=(num_chunks, len(query_vector)))
        except ValueError:
            print(f"Warning: Could not load mmap for {doc_id} with expected shape. Re-processing might be needed.")
            return []

        query_vector_norm = query_vector / np.linalg.norm(query_vector)
        
        norms = np.linalg.norm(mmap_vectors, axis=1)
        mmap_vectors_norm = mmap_vectors / norms[:, np.newaxis]
        mmap_vectors_norm[norms == 0] = 0

        similarities = np.dot(mmap_vectors_norm, query_vector_norm)

        top_k_indices = np.argsort(similarities)[::-1][:top_k]

        relevant_chunks = []
        for i in top_k_indices:
            chunk_info = self.pdf_text_db[doc_id][i]
            relevant_chunks.append((chunk_info['text'], similarities[i], chunk_info['page']))
        
        return relevant_chunks

    def rag_chat_thread(self, prompt):
        try:
            print("Executing RAG chat thread...")
            self.stop_loading_event.clear(); threading.Thread(target=self.run_loading_animation, daemon=True).start()
            self.after(0, lambda: self.append_to_chat(f"{self.model_var.get().split(':')[0].capitalize()} (Doc): ", "bot_name_tag"))

            print("Generating embeddings for RAG query...")
            query_vector = self.ollama_client.embeddings(model=self.embedding_model_name, prompt=prompt)['embedding']
            print("Finding relevant chunks from document...")
            chunks = self.find_relevant_chunks(query_vector, self.current_chat_id, top_k=5)
            context = "\n\n".join([f"[Page {p}]: {t}" for t, _, p in chunks]) or "No relevant context found."
            
            system_prompt = f"{NORMAL_RAG_SYSTEM_PROMPT}\n\n--- CONTEXT ---\n{context}\n--- END CONTEXT ---"
            messages = [{'role': 'system', 'content': system_prompt}, {'role': 'user', 'content': prompt}]
            print(f"Sending chat request to model '{self.model_var.get()}'...")
            response = self.ollama_client.chat(model=self.model_var.get(), messages=messages, stream=True)
            self.stream_response_to_chat(response)
            self.chat_sessions[self.current_chat_id].append({'role': 'user', 'content': prompt})
        except Exception as e:
            self.after(0, self.append_to_chat, f"\nError in RAG thread: {e}\n\n", "error_tag")
        finally:
            self.stop_loading_event.set(); self.after(0, lambda: self.entry_box.config(state=tk.NORMAL))

    def normal_chat_thread(self, prompt, message_history):
        try:
            print("Executing normal chat thread...")
            self.stop_loading_event.clear(); threading.Thread(target=self.run_loading_animation, daemon=True).start()
            self.after(0, lambda: self.append_to_chat(f"{self.model_var.get().split(':')[0].capitalize()} (Chat): ", "bot_name_tag"))
            
            print(f"Sending chat request to model '{self.model_var.get()}'...")
            response = self.ollama_client.chat(model=self.model_var.get(), messages=message_history + [{'role': 'user', 'content': prompt}], stream=True)
            self.stream_response_to_chat(response)
            message_history.append({'role': 'user', 'content': prompt})
        except Exception as e:
            self.after(0, self.append_to_chat, f"\nError in chat thread: {e}\n\n", "error_tag")
        finally:
            self.stop_loading_event.set(); self.after(0, lambda: self.entry_box.config(state=tk.NORMAL))

    def summarize_thread(self, doc_text, chat_id):
        try:
            print("Executing summarize thread...")
            self.stop_loading_event.clear()
            threading.Thread(target=self.run_loading_animation, daemon=True).start()
            
            self.after(0, lambda: self.append_to_chat(f"{self.model_var.get().split(':')[0].capitalize()} (Summary):\n", "bot_name_tag"))
            
            prompt = "Provide a concise summary of the document."
            self.chat_sessions[chat_id].append({'role': 'user', 'content': prompt})

            summary_prompt = f"Please provide a concise summary of the following document:\n\n{doc_text}"
            messages = [{'role': 'system', 'content': SUMMARIZE_SYSTEM_PROMPT}, {'role': 'user', 'content': summary_prompt}]
            response = self.ollama_client.chat(model=self.model_var.get(), messages=messages, stream=True)
            self.stream_response_to_chat(response)

        except Exception as e:
            self.after(0, self.append_to_chat, f"\nError during summarization: {e}\n\n", "error_tag")
        finally:
            self.stop_loading_event.set()
            self.after(0, lambda: self.entry_box.config(state=tk.NORMAL))

    def _summarize_document_logic(self, doc_id):
        if doc_id not in self.pdf_text_db or not self.pdf_text_db[doc_id]:
            return messagebox.showerror("Error", f"No text content found for '{doc_id}'. Was it processed correctly?")

        full_text = "\n".join([chunk['text'] for chunk in self.pdf_text_db[doc_id]])

        threading.Thread(target=self.summarize_thread, args=(full_text, self.current_chat_id), daemon=True).start()

    def on_summarize_button_click(self):
        selected_indices = self.doc_list_box.curselection()
        if not selected_indices:
            return messagebox.showinfo("No Document", "Please select a document to summarize.")
        
        doc_id = self.doc_list_box.get(selected_indices[0])

        if self.processing_thread and self.processing_thread.is_alive():
            return messagebox.showwarning("Busy", "Please wait for the current processing to finish.")
        
        self._summarize_document_logic(doc_id)

    def on_review_button_click(self):
        selected_indices = self.doc_list_box.curselection()
        if not selected_indices:
            return messagebox.showinfo("No Document", "Please select a document to review.")
        
        doc_id = self.doc_list_box.get(selected_indices[0])

        if self.processing_thread and self.processing_thread.is_alive():
            return messagebox.showwarning("Busy", "Please wait for the current processing to finish.")

        if doc_id not in self.pdf_text_db or not self.pdf_text_db[doc_id]:
            return messagebox.showerror("Error", f"No text content found for '{doc_id}'. Was it processed correctly?")

        full_text = "\n".join([chunk['text'] for chunk in self.pdf_text_db[doc_id]])

        self._temp_review_doc_id = doc_id
        self._temp_review_full_text = full_text

        self._show_reviewer_menu()

    def review_thread(self, doc_text, chat_id, reviewer_role):
        try:
            print(f"Executing review thread with role: {reviewer_role}...")
            self.stop_loading_event.clear()
            threading.Thread(target=self.run_loading_animation, daemon=True).start()
            
            self.after(0, lambda: self.append_to_chat(f"{self.model_var.get().split(':')[0].capitalize()} (Review - {reviewer_role}):\n", "bot_name_tag"))
            
            prompt = f"Provide a critical review of the document from the perspective of a {reviewer_role}."
            self.chat_sessions[chat_id].append({'role': 'user', 'content': prompt})

            reviewer_prompt = ALL_REVIEWERS.get(reviewer_role, REVIEW_SYSTEM_PROMPT)
            review_prompt = f"Please provide a critical review of the following document:\n\n{doc_text}"
            messages = [{'role': 'system', 'content': reviewer_prompt}, {'role': 'user', 'content': review_prompt}]
            response = self.ollama_client.chat(model=self.model_var.get(), messages=messages, stream=True)
            self.stream_response_to_chat(response)

        except Exception as e:
            self.after(0, self.append_to_chat, f"\nError during review: {e}\n\n", "error_tag")
        finally:
            self.stop_loading_event.set()
            self.after(0, lambda: self.entry_box.config(state=tk.NORMAL))



    def on_paraphrase_button_click(self):
        if not self.current_chat_id or not self.chat_sessions.get(self.current_chat_id):
            return messagebox.showinfo("No Chat", "Please select a chat with a previous response to paraphrase.")
        
        message_history = self.chat_sessions[self.current_chat_id]
        if not message_history:
            return messagebox.showinfo("No Response", "No previous responses in this chat to paraphrase.")
        
        last_bot_response = None
        for msg in reversed(message_history):
            if msg['role'] == 'assistant':
                last_bot_response = msg['content']
                break
        
        if not last_bot_response:
            return messagebox.showinfo("No Response", "No previous AI responses in this chat to paraphrase.")

        threading.Thread(target=self.paraphrase_thread, args=(last_bot_response, self.current_chat_id), daemon=True).start()

    def paraphrase_thread(self, text_to_paraphrase, chat_id):
        try:
            print("Executing paraphrase thread...")
            self.stop_loading_event.clear()
            threading.Thread(target=self.run_loading_animation, daemon=True).start()
            
            self.after(0, lambda: self.append_to_chat(f"{self.model_var.get().split(':')[0].capitalize()} (Paraphrase):\n", "bot_name_tag"))
            
            prompt = f"Please paraphrase the following text:\n\n---\n{text_to_paraphrase}\n---"
            self.chat_sessions[chat_id].append({'role': 'user', 'content': "Paraphrase the last response."})

            messages = [{'role': 'system', 'content': "You are a helpful AI assistant. Your task is to paraphrase the given text, rephrasing it in a different style or tone while preserving the original meaning."}, {'role': 'user', 'content': prompt}]
            response = self.ollama_client.chat(model=self.model_var.get(), messages=messages, stream=True)
            self.stream_response_to_chat(response)

        except Exception as e:
            self.after(0, self.append_to_chat, f"\nError during paraphrasing: {e}\n\n", "error_tag")
        finally:
            self.stop_loading_event.set()
            self.after(0, lambda: self.entry_box.config(state=tk.NORMAL))

    def populate_models(self):
        print("\n--- Populating Models ---")
        try:
            if not self.ollama_client:
                print("1. Ollama client not initialized. Aborting.")
                raise ConnectionError("Ollama client not initialized.")

            print("1. Calling ollama_client.list() to get models...")
            models_response = self.ollama_client.list()
            print(f"2. Raw response from Ollama: {models_response}")

            models_list = models_response.get('models', [])
            if not models_list:
                print("3. WARNING: 'models' key not found in response or is empty. No models will be loaded.")
                model_folder_path = self.app_config.get('model_folder')
                print(f"   - This usually means the OLLAMA_MODELS path is incorrect or the directory is empty.")
                print(f"   - Current OLLAMA_MODELS path set at server start: '{model_folder_path}'")
                if os.path.exists(model_folder_path):
                    if not os.listdir(model_folder_path):
                        print(f"   - DIAGNOSIS: The directory exists but is empty. Please place your Ollama models inside it.")
                    else:
                        print(f"   - DIAGNOSIS: The directory '{model_folder_path}' exists and is not empty.")
                        subdirs = [d for d in os.listdir(model_folder_path) if os.path.isdir(os.path.join(model_folder_path, d))]
                        
                        # Check for signs of nested model directories
                        nested_model_folders = []
                        for subdir in subdirs:
                            if subdir not in ['manifests', 'blobs']:
                                nested_path = os.path.join(model_folder_path, subdir)
                                try:
                                    nested_subdirs = [d for d in os.listdir(nested_path) if os.path.isdir(os.path.join(nested_path, d))]
                                    if 'manifests' in nested_subdirs and 'blobs' in nested_subdirs:
                                        nested_model_folders.append(subdir)
                                except OSError:
                                    pass # Ignore if we can't read a subdir

                        if nested_model_folders:
                            print(f"     - PROBLEM: Found nested model folders: {nested_model_folders}")
                            print(f"     - The main model folder '{model_folder_path}' should contain the merged contents of all models.")
                            print(f"     - ACTION: Automatically consolidating model files...")
                            
                            # Automatically consolidate models
                            self._consolidate_models(model_folder_path, nested_model_folders)
                            
                            # Repopulate after consolidation
                            print("     - Rerunning model population after consolidation...")
                            self.after(100, self.populate_models)
                            return
                        elif 'manifests' not in subdirs or 'blobs' not in subdirs:
                            print(f"     - PROBLEM: The folder '{model_folder_path}' is missing the required 'manifests' and/or 'blobs' subdirectories.")
                            print(f"     - ACTION: Please ensure this path points to a valid Ollama models directory.")
                        else:
                            print(f"   - The folder structure appears correct, but Ollama still finds no models.")
                            print(f"   - Please double-check that the files inside '{os.path.join(model_folder_path, 'manifests')}' are correct and not corrupted.")
                else:
                    print(f"   - DIAGNOSIS: The directory does not exist. Please check the 'model_folder' path in your System_Config.json.")

            model_names = sorted([m['model'] for m in models_list])
            print(f"3. Extracted and sorted model names: {model_names}")

            self.status_light.config(foreground="#3AD900"); self.status_label.config(text="Connected")
            
            chat_models = [name for name in model_names if "embed" not in name]
            print(f"4. Filtered chat models (names not containing 'embed'): {chat_models}")

            self.model_selector['values'] = chat_models or ["No models found"]
            print(f"5. Set model selector values to: {self.model_selector['values']}")
            
            # Check for embedding model for offline portability
            print(f"\n6. Checking for required embedding model: '{self.embedding_model_name}'")
            if any(self.embedding_model_name in n for n in model_names):
                self.embedding_model_available = True
                self.embed_status_label.config(text=f'{self.embedding_model_name} (Ready)', foreground="#3AD900")
                self.load_pdf_button.config(state=tk.NORMAL)
                print("   - SUCCESS: Embedding model found.")
            else:
                self.embedding_model_available = False
                self.embed_status_label.config(text=f'{self.embedding_model_name} (Not Found)', foreground=Style.ERROR)
                self.load_pdf_button.config(state=tk.DISABLED)
                print(f"   - WARNING: Embedding model '{self.embedding_model_name}' not found. Document features will be disabled.")

            current_selection = self.model_selector.get()
            if current_selection not in chat_models:
                new_selection = chat_models[0] if chat_models else ""
                self.model_var.set(new_selection)
                print(f"7. Current model selection ('{current_selection}') is invalid. Setting to: '{new_selection}'")

            if not self.current_chat_id:
                print("8. No current chat session. Starting a new one.")
                self.start_new_chat()
            print("--- Model Population Complete ---")

        except Exception as e:
            print(f"\n--- Ollama Connection/Population FAILED ---")
            print(f"ERROR: {e}")
            self.status_light.config(foreground=Style.ERROR); self.status_label.config(text="Ollama Not Found")
            self.model_selector['values'] = ["Connection Failed"]; self.model_var.set("Connection Failed")
            self.load_pdf_button.config(state=tk.DISABLED) # Also disable on connection failure
            if self.ollama_client:
                print("Retrying in 5 seconds...")
                self.after(5000, lambda: self.populate_models())

    def update_system_stats(self):
        self.stats_label.config(text=f"RAM: {psutil.virtual_memory().percent}%  |  {self.last_tok_per_sec}")
        self.after(1000, lambda: self.update_system_stats())

    def load_new_pdf(self):
        if self.processing_thread and self.processing_thread.is_alive(): return messagebox.showwarning("Busy", "Please wait...")
        if not self.embedding_model_available: return messagebox.showerror("Model Error", f"{self.embedding_model_name} not found.")
        
        file_path = filedialog.askopenfilename(title="Select PDF", filetypes=[("PDF Documents", "*.pdf")])
        if not file_path:
            print("User cancelled PDF selection.")
            return

        pdf_name = os.path.basename(file_path)
        print(f"Loading document: {pdf_name}")
        if pdf_name in self.chat_sessions: return messagebox.showinfo("Already Loaded", f"'{pdf_name}' is already loaded.")

        try:
            doc = fitz.open(file_path)
            if doc.is_encrypted or doc.page_count == 0: raise ValueError("PDF is encrypted or empty.")
            doc.close()
        except Exception as e:
            return messagebox.showerror("PDF Error", f"Cannot read PDF: {e}")

        self.chat_sessions[pdf_name] = []
        self.pdf_text_db[pdf_name] = []
        self.doc_list_box.insert(tk.END, pdf_name)
        self.doc_list_box.selection_clear(0, tk.END)
        self.doc_list_box.selection_set(tk.END)
        self.on_history_select(None, 'doc')
        
        self.processing_thread = threading.Thread(target=self.process_and_embed_pdf, args=(file_path, pdf_name), daemon=True)
        self.processing_thread.start()

    def process_and_embed_pdf(self, pdf_path, pdf_id):
        try:
            print(f"Processing and embedding '{pdf_id}'...")
            self.after(0, lambda: self.load_pdf_button.config(state=tk.DISABLED))
            self.after(0, lambda: self.status_label.config(text=f"Embedding '{pdf_id}'...", foreground=Style.ACCENT))
            doc = fitz.open(pdf_path)
            chunks = []
            for page in doc:
                text = page.get_text("text")
                if text:
                    for i in range(0, len(text), 800):
                        chunks.append({"text": text[i:i+1000], "page": page.number + 1})
            doc.close()

            if not chunks: raise ValueError("Could not extract text from PDF.")
            
            self.pdf_text_db[pdf_id] = chunks
            total_chunks = len(chunks)
            last_update = time.time()
            mmap_vectors = None

            for i, chunk in enumerate(chunks):
                if time.time() - last_update > 0.1:
                    self.after(0, lambda i=i: self.status_label.config(text=f"Embedding: {i+1}/{total_chunks}"))
                    last_update = time.time()
                
                response = self.ollama_client.embeddings(model=self.embedding_model_name, prompt=chunk["text"])
                vector = np.array(response['embedding'], dtype=np.float16)
                
                if mmap_vectors is None:
                    mmap_shape = (total_chunks, len(vector))
                    mmap_vectors = np.memmap(os.path.join(self.vector_cache_dir, f"{pdf_id}.mmap"), dtype=np.float16, mode='w+', shape=mmap_shape)
                
                mmap_vectors[i] = vector
            mmap_vectors.flush()
            print(f"Successfully embedded '{pdf_id}'.")
            self.after(0, lambda: self.append_to_chat(f"Ready to chat with '{pdf_id}'.\n\n", "thinking_tag"))

        except Exception as e:
            print(f"Error processing PDF '{pdf_id}': {e}")
            self.after(0, lambda: messagebox.showerror("Processing Error", f"Failed to process '{pdf_id}'.\n\nDetails: {e}"))
            self.remove_document_data(pdf_id)
        finally:
            self.after(0, lambda: self.load_pdf_button.config(state=tk.NORMAL))
            self.after(0, lambda: self.status_label.config(text="Idle."))

    def remove_document_data(self, doc_id):
        if doc_id in self.pdf_text_db: del self.pdf_text_db[doc_id]
        if doc_id in self.chat_sessions:
            del self.chat_sessions[doc_id]
            try:
                idx = list(self.chat_list_box.get(0, tk.END)).index(doc_id)
                self.chat_list_box.delete(idx)
            except ValueError: pass
        try:
            idx = list(self.doc_list_box.get(0, tk.END)).index(doc_id)
            self.doc_list_box.delete(idx)
        except ValueError: pass
        self.remove_vector_cache(doc_id)
        if self.current_chat_id == doc_id: self.start_new_chat()

    def remove_selected_pdf(self):
        selected_indices = self.doc_list_box.curselection()
        if not selected_indices: return
        pdf_to_remove = self.doc_list_box.get(selected_indices[0])
        if messagebox.askyesno("Confirm Removal", f"Delete '{pdf_to_remove}'?"):
            self.remove_document_data(pdf_to_remove)
            if pdf_to_remove in self.chat_sessions:
                del self.chat_sessions[pdf_to_remove]
                try:
                    idx = list(self.chat_list_box.get(0, tk.END)).index(pdf_to_remove)
                    self.chat_list_box.delete(idx)
                except ValueError: pass

    def remove_selected_chat(self):
        selected_indices = self.chat_list_box.curselection()
        if not selected_indices: return
        chat_to_remove = self.chat_list_box.get(selected_indices[0])
        if messagebox.askyesno("Confirm Removal", f"Delete chat '{chat_to_remove}'?"):
            del self.chat_sessions[chat_to_remove]
            self.chat_list_box.delete(selected_indices[0])
            if self.current_chat_id == chat_to_remove: self.start_new_chat()

    def on_history_select(self, event, listbox_type):
        source_listbox = self.chat_list_box if listbox_type == 'chat' else self.doc_list_box
        
        selected_indices = source_listbox.curselection()
        if not selected_indices: return
        
        # Deselect from the other listbox
        if listbox_type == 'chat':
            self.doc_list_box.selection_clear(0, tk.END)
        else:
            self.chat_list_box.selection_clear(0, tk.END)

        selected_id = source_listbox.get(selected_indices[0])
        if self.processing_thread and self.processing_thread.is_alive():
            messagebox.showwarning("Busy", "Cannot switch items while processing.")
            return

        self.current_chat_id = selected_id
        self.current_chat_label.config(text=self.current_chat_id)
        self.load_chat_history(self.current_chat_id)

    def load_chat_history(self, session_id):
        self.chat_box.config(state=tk.NORMAL); self.chat_box.delete(1.0, tk.END)
        message_history = self.chat_sessions.get(session_id, [])
        
        if session_id in self.pdf_text_db and not os.path.exists(os.path.join(self.vector_cache_dir, f"{session_id}.mmap")):
            self.append_to_chat(f"Data for '{session_id}' is not loaded. Please reload the PDF.", "error_tag")
        else:
            model_name = self.model_var.get().split(':')[0].capitalize() if self.model_var.get() else "AI"
            for msg in message_history:
                if msg['role'] == 'user':
                    self.append_to_chat(f"You: {msg['content']}\n", "user_tag")
                else:
                    self.append_to_chat(f"{model_name}: {msg['content']}\n\n")
        
        self.chat_box.config(state=tk.DISABLED); self.chat_box.see(tk.END)

    def start_new_chat(self):
        if not hasattr(self, 'chat_list_box'):
            self.after(100, lambda: self.start_new_chat())
            return
        self.chat_counter += 1
        new_chat_name = f"Chat {self.chat_counter}"
        while new_chat_name in self.chat_sessions: self.chat_counter += 1; new_chat_name = f"Chat {self.chat_counter}"
        
        self.chat_sessions[new_chat_name] = []
        self.chat_list_box.insert(tk.END, new_chat_name)
        self.chat_list_box.selection_clear(0, tk.END)
        self.chat_list_box.selection_set(tk.END)
        self.on_history_select(None, 'chat')

    def clear_chat(self):
        if messagebox.askyesno("Clear Chat", "Clear the current conversation?"): self.load_chat_history(self.current_chat_id)

    def save_chat(self):
        content = self.chat_box.get(1.0, tk.END)
        if not content.strip(): return
        file_path = filedialog.asksaveasfilename(initialfile=f"{self.current_chat_id or 'chat'}.txt",defaultextension=".txt")
        if file_path:
            with open(file_path, "w", encoding="utf-8") as f: f.write(content)
            
    def remove_vector_cache(self, pdf_id):
        mmap_path = os.path.join(self.vector_cache_dir, f"{pdf_id}.mmap")
        if os.path.exists(mmap_path):
            try:
                os.remove(mmap_path)
                print(f"Removed vector cache for {pdf_id}: {mmap_path}")
            except Exception as e:
                print(f"Error removing vector cache for {pdf_id}: {e}")

    def open_settings_window(self):
        settings_dialog = SettingsWindow(self, self.app_config, self._save_and_update_config)
        self.wait_window(settings_dialog)

    def _save_and_update_config(self, new_config):
        self.app_config = new_config
        self._save_config(self.app_config)
        messagebox.showinfo("Settings Saved", "Settings have been saved. Restart the application for some changes to take full effect.")

    def _consolidate_models(self, model_folder_path, nested_model_folders):
        print("--- Consolidating Models ---")
        
        def move_contents(src_dir, dst_dir):
            if not os.path.exists(dst_dir):
                os.makedirs(dst_dir)
            for item in os.listdir(src_dir):
                s = os.path.join(src_dir, item)
                d = os.path.join(dst_dir, item)
                try:
                    shutil.move(s, d)
                    print(f"Moved {s} to {d}")
                except shutil.Error as e:
                    print(f"Could not move {s} to {d}: {e}. It might already exist.")


        main_manifests_dir = os.path.join(model_folder_path, 'manifests')
        main_blobs_dir = os.path.join(model_folder_path, 'blobs')

        # Consolidate nested model folders
        for folder in nested_model_folders:
            nested_dir = os.path.join(model_folder_path, folder)
            nested_manifests = os.path.join(nested_dir, 'manifests')
            nested_blobs = os.path.join(nested_dir, 'blobs')
            
            if os.path.exists(nested_manifests):
                print(f"Moving manifests from {nested_dir}...")
                move_contents(nested_manifests, main_manifests_dir)
            if os.path.exists(nested_blobs):
                print(f"Moving blobs from {nested_dir}...")
                move_contents(nested_blobs, main_blobs_dir)
            
            # Clean up empty directories
            try:
                if os.path.exists(nested_manifests) and not os.listdir(nested_manifests): os.rmdir(nested_manifests)
                if os.path.exists(nested_blobs) and not os.listdir(nested_blobs): os.rmdir(nested_blobs)
                if os.path.exists(nested_dir) and not os.listdir(nested_dir): os.rmdir(nested_dir)
                print(f"Cleaned up {nested_dir}")
            except OSError as e:
                print(f"Could not remove {nested_dir}: {e}")

        # Consolidate text embedding model
        base_dir = os.path.abspath(os.path.join(model_folder_path, '..'))
        text_embedding_dir = os.path.join(base_dir, 'text_embedding_model')

        if os.path.exists(text_embedding_dir):
            print("Consolidating text embedding model...")
            embedding_manifests = os.path.join(text_embedding_dir, 'manifests')
            embedding_blobs = os.path.join(text_embedding_dir, 'blobs')

            if os.path.exists(embedding_manifests):
                move_contents(embedding_manifests, main_manifests_dir)
            if os.path.exists(embedding_blobs):
                move_contents(embedding_blobs, main_blobs_dir)

            try:
                if os.path.exists(embedding_manifests) and not os.listdir(embedding_manifests): os.rmdir(embedding_manifests)
                if os.path.exists(embedding_blobs) and not os.listdir(embedding_blobs): os.rmdir(embedding_blobs)
                if os.path.exists(text_embedding_dir) and not os.listdir(text_embedding_dir): os.rmdir(text_embedding_dir)
                print(f"Cleaned up {text_embedding_dir}")
            except OSError as e:
                print(f"Could not remove {text_embedding_dir}: {e}")
        
        print("--- Consolidation Complete ---")



    def _initialize_ollama(self):
        print("--- Initializing Ollama Connection ---")
        ollama_path = self.app_config.get("ollama_path")
        model_folder = self.app_config.get("model_folder")
        embedding_model_needed = self.app_config.get("embedding_model_name")

        # Try to connect to an existing server first
        try:
            print("1. Checking for an existing Ollama server...")
            external_client = ollama.Client(host='127.0.0.1', timeout=5)
            external_models = external_client.list().get('models', [])
            external_model_names = [m['model'] for m in external_models]
            print(f"2. Found existing server with models: {external_model_names}")

            # Check if the existing server has the required embedding model
            if any(embedding_model_needed in name for name in external_model_names):
                print("3. SUCCESS: Existing server has the required embedding model.")
                print("   - Using the existing Ollama server.")
                self.ollama_client = ollama.Client(host='127.0.0.1', timeout=120)
                self.populate_models()
                return # Success, we are done.
            else:
                print("3. WARNING: Existing server found, but it does NOT have the required embedding model.")
                print(f"   - Required model: '{embedding_model_needed}'")
                print("   - The application will now attempt to start its own managed Ollama server.")
                print("   - Please ensure the external Ollama server is shut down if you encounter port conflicts.")

        except Exception:
            print("1. No existing Ollama server found. Proceeding to start a local one.")
            pass # This is expected if no server is running, so we just continue

        # If we are here, it means either no server was running or the existing one was unsuitable.
        # We will now start our own managed server.
        print("\n--- Starting Managed Ollama Server ---")
        if not ollama_path or not os.path.exists(ollama_path):
            self.ollama_client = None
            print("ERROR: Ollama executable path is not configured or invalid. Cannot start local server.")
            messagebox.showerror("Ollama Not Found", "Ollama executable not found. Please configure the path to ollama.exe in settings.")
            self.status_light.config(foreground=Style.ERROR); self.status_label.config(text="Ollama Not Found")
            self.model_selector['values'] = ["Connection Failed"]; self.model_var.set("Connection Failed")
            self.load_pdf_button.config(state=tk.DISABLED)
            return

        print(f"1. Executable path: {ollama_path}")
        print(f"2. Model folder to be used: {model_folder}")
        try:
            self.ollama_process = self._start_ollama_server(ollama_path, model_folder)
            self.ollama_client = ollama.Client(host='127.0.0.1', timeout=120)
            print("3. Waiting for managed Ollama server to become responsive...")
            self.after(100, lambda: self._check_server_readiness(time.time(), 60))
        except Exception as e:
            messagebox.showerror("Ollama Start Error", f"Failed to start local Ollama server: {e}")
            self.ollama_client = None

    def _check_server_readiness(self, start_time, max_wait):
        """Non-blocking check for Ollama server readiness."""
        elapsed_time = time.time() - start_time
        if elapsed_time > max_wait:
            messagebox.showerror("Ollama Start Error", f"Local Ollama server did not respond within {max_wait} seconds. Check logs/ollama_server.log for details.")
            self.on_closing()
            return

        try:
            # Use a lightweight request to check if the server is up
            self.ollama_client.list()
            print("Local Ollama server is responsive.")
            # Now that the server is ready, populate the models.
            self.populate_models()
        except Exception:
            # Server not ready, update status and schedule the next check
            self.status_label.config(text=f"Waiting... ({int(elapsed_time)}s)")
            self.after(1000, lambda: self._check_server_readiness(start_time, max_wait))

    def _start_ollama_server(self, ollama_path, model_folder):
        print(f"Attempting to start Ollama server from: {ollama_path}")
        env = os.environ.copy()
        if model_folder and os.path.exists(model_folder):
            env["OLLAMA_MODELS"] = model_folder
            print(f"Setting OLLAMA_MODELS environment variable to: {model_folder}")
        else:
            print(f"Warning: Model folder '{model_folder}' not found. Ollama will use its default.")

        # Create a log file for the server process
        log_dir = "logs"
        os.makedirs(log_dir, exist_ok=True)
        ollama_log_path = os.path.join(log_dir, "ollama_server.log")
        print(f"Redirecting Ollama server output to: {ollama_log_path}")
        log_file = open(ollama_log_path, "a", encoding="utf-8")

        # Start Ollama server in a detached process
        process = subprocess.Popen(
            [ollama_path, "serve"],
            env=env,
            stdout=log_file,
            stderr=log_file,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        )
        return process

    def _stop_ollama_server(self):
        if self.ollama_process and self.ollama_process.poll() is None:
            print("Stopping Ollama server...")
            # Terminate the process group to ensure all child processes are killed
            self.ollama_process.terminate()
            try:
                self.ollama_process.wait(timeout=5)
                print("Ollama server stopped.")
            except subprocess.TimeoutExpired:
                print("Ollama server did not terminate in time. Forcing kill.")
                self.ollama_process.kill()


    def _load_config(self):
        print("\n--- Loading Configuration ---")
        config_path = os.path.join(PROJECT_ROOT, "System_Config.json")
        print(f"1. Project Root: '{PROJECT_ROOT}'")
        print(f"2. Checking for config file at: '{config_path}'")

        default_config = {
            "ollama_path": os.path.join("Portable_AI_Assets", "ollama_main", "ollama.exe"),
            # NOTE: Ollama can only be started with one model directory. All models, including the
            # embedding model required for document analysis (e.g., 'mxbai-embed-large'), must be
            # located within this single 'model_folder' directory.
            "model_folder": os.path.join("Portable_AI_Assets", "AI-models"),
            "vector_cache_dir": os.path.join("Portable_AI_Assets", "vector_cache"),
            "embedding_model_name": "mxbai-embed-large"
        }
        print(f"3. Default config loaded: {json.dumps(default_config, indent=2)}")

        config_from_file = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config_from_file = json.load(f)
                print(f"4. Successfully loaded config from file: {json.dumps(config_from_file, indent=2)}")
            except (json.JSONDecodeError, IOError) as e:
                print(f"4. WARNING: Could not read or parse '{config_path}'. Using default settings. Error: {e}")
        else:
            print("4. Config file not found. Using default settings.")

        # Start with defaults, then layer config from file on top
        final_config = default_config.copy()
        final_config.update(config_from_file)
        print(f"5. Merged config (defaults + file): {json.dumps(final_config, indent=2)}")

        print("\n--- Resolving and Validating Paths ---")
        # All paths are treated as relative to the project root for portability.
        for key in ["ollama_path", "model_folder", "vector_cache_dir"]:
            print(f"\nProcessing path for '{key}':")
            path_value = final_config[key]
            print(f"  - Initial value: '{path_value}'")
            
            # If path is not absolute, resolve it relative to the project root
            if not os.path.isabs(path_value):
                print("  - Path is relative. Resolving against project root.")
                absolute_path = os.path.normpath(os.path.join(PROJECT_ROOT, path_value))
            else:
                print("  - Path is absolute.")
                absolute_path = os.path.normpath(path_value)
            print(f"  - Resolved absolute path: '{absolute_path}'")

            # If the resolved path from the config is invalid, fall back to the default path
            if not os.path.exists(absolute_path) and key != "vector_cache_dir":
                print(f"  - WARNING: Path does not exist: '{absolute_path}'")
                default_relative_path = default_config[key]
                absolute_path = os.path.normpath(os.path.join(PROJECT_ROOT, default_relative_path))
                print(f"  - Falling back to default path: '{absolute_path}'")
            
            final_config[key] = absolute_path # Update config with the validated, absolute path
            print(f"  - Final path for '{key}': '{final_config[key]}'")
            if os.path.exists(final_config[key]):
                print("    - Path validation: OK")
            elif key != "vector_cache_dir":
                 print("    - Path validation: FAILED - Path does not exist.")
        
        # Ensure the vector cache directory exists.
        try:
            print(f"\nEnsuring vector cache directory exists at: '{final_config['vector_cache_dir']}'")
            os.makedirs(final_config["vector_cache_dir"], exist_ok=True)
        except OSError as e:
            print(f"Error creating vector cache directory '{final_config['vector_cache_dir']}': {e}")

        print(f"\n--- Configuration Loading Complete ---")
        print(f"Final configuration object: {json.dumps(final_config, indent=2)}")
        return final_config

    def _save_config(self, app_config):
        config_path = os.path.join(PROJECT_ROOT, "System_Config.json")
        # When saving, try to make paths relative to the project root for portability
        relative_config = {}
        for key, value in app_config.items():
            if isinstance(value, str) and os.path.isabs(value) and key in ["ollama_path", "model_folder", "vector_cache_dir"]:
                try:
                    # This will make the path relative if it's on the same drive
                    relative_config[key] = os.path.relpath(value, PROJECT_ROOT)
                except ValueError:
                    # Paths are on different drives, so keep the absolute path
                    relative_config[key] = value
            else:
                relative_config[key] = value

        with open(config_path, 'w') as f:
            json.dump(relative_config, f, indent=4)

class ConsoleRedirector:

    def __init__(self, text_widget, tag=None):

        self.text_widget = text_widget
        self.tag = tag

    def write(self, text):

        self.text_widget.config(state=tk.NORMAL)

        self.text_widget.insert(tk.END, text, self.tag)

        self.text_widget.see(tk.END)

        self.text_widget.config(state=tk.DISABLED)

    def flush(self): pass


class SettingsWindow(tk.Toplevel):


    def __init__(self, master, current_config, save_callback):


        super().__init__(master)


        self.title("Settings")


        self.geometry("500x350") # Increased height for new field


        self.current_config = current_config


        self.save_callback = save_callback





        self.configure(bg=Style.BG_PRIMARY)


        self.grab_set() # Make it a modal window


        self.transient(master) # Set to be on top of the main window





        self.create_widgets()


        self.load_settings()





    def create_widgets(self):


        main_frame = ttk.Frame(self, style='TFrame')


        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)





        # Ollama Path


        ollama_frame = ttk.Frame(main_frame, style='TFrame')


        ollama_frame.pack(fill=tk.X, pady=5)


        ttk.Label(ollama_frame, text="Ollama Executable Path:", style='TLabel').pack(side=tk.LEFT, anchor='w', padx=(0, 10))


        self.ollama_path_entry = ttk.Entry(ollama_frame, style='TEntry')


        self.ollama_path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)


        ttk.Button(ollama_frame, text="Browse", command=self.browse_ollama_path, style='Tool.TButton').pack(side=tk.RIGHT, padx=(5,0))





        # Model Folder


        model_frame = ttk.Frame(main_frame, style='TFrame')


        model_frame.pack(fill=tk.X, pady=5)


        ttk.Label(model_frame, text="Model Folder Path:", style='TLabel').pack(side=tk.LEFT, anchor='w', padx=(0, 10))


        self.model_folder_entry = ttk.Entry(model_frame, style='TEntry')


        self.model_folder_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)


        ttk.Button(model_frame, text="Browse", command=self.browse_model_folder, style='Tool.TButton').pack(side=tk.RIGHT, padx=(5,0))





        # Vector Cache Directory


        vector_cache_frame = ttk.Frame(main_frame, style='TFrame')


        vector_cache_frame.pack(fill=tk.X, pady=5)


        ttk.Label(vector_cache_frame, text="Vector Cache Directory:", style='TLabel').pack(side=tk.LEFT, anchor='w', padx=(0, 10))


        self.vector_cache_entry = ttk.Entry(vector_cache_frame, style='TEntry')


        self.vector_cache_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)


        ttk.Button(vector_cache_frame, text="Browse", command=self.browse_vector_cache_dir, style='Tool.TButton').pack(side=tk.RIGHT, padx=(5,0))





        # Embedding Model Name


        embed_model_frame = ttk.Frame(main_frame, style='TFrame')


        embed_model_frame.pack(fill=tk.X, pady=5)


        ttk.Label(embed_model_frame, text="Embedding Model Name:", style='TLabel').pack(side=tk.LEFT, anchor='w', padx=(0, 10))


        self.embed_model_entry = ttk.Entry(embed_model_frame, style='TEntry')


        self.embed_model_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)





        # Buttons


        button_frame = ttk.Frame(main_frame, style='TFrame')


        button_frame.pack(fill=tk.X, pady=15)


        ttk.Button(button_frame, text="Open Config File", command=self.open_config_file, style='Tool.TButton').pack(side=tk.LEFT, padx=5)


        ttk.Button(button_frame, text="Save", command=self.save_settings, style='Accent.Sidebar.TButton').pack(side=tk.RIGHT, padx=5)


        ttk.Button(button_frame, text="Cancel", command=self.destroy, style='Tool.TButton').pack(side=tk.RIGHT)





    def open_config_file(self):
        config_path = os.path.join(PROJECT_ROOT, "System_Config.json")
        if os.path.exists(config_path):
            os.startfile(config_path)
        else:
            messagebox.showerror("Error", "System_Config.json not found.")





    def load_settings(self):


        self.ollama_path_entry.insert(0, self.current_config.get("ollama_path", ""))


        self.model_folder_entry.insert(0, self.current_config.get("model_folder", ""))


        self.vector_cache_entry.insert(0, self.current_config.get("vector_cache_dir", ""))


        self.embed_model_entry.insert(0, self.current_config.get("embedding_model_name", "mxbai-embed-large"))





    def browse_ollama_path(self):


        file_path = filedialog.askopenfilename(title="Select Ollama Executable", filetypes=[("Executables", "*.exe"), ("All Files", "*.*")] )


        if file_path:


            self.ollama_path_entry.delete(0, tk.END)


            self.ollama_path_entry.insert(0, file_path)





    def browse_model_folder(self):


        folder_path = filedialog.askdirectory(title="Select Model Folder")


        if folder_path:


            self.model_folder_entry.delete(0, tk.END)


            self.model_folder_entry.insert(0, folder_path)





    def browse_vector_cache_dir(self):


        folder_path = filedialog.askdirectory(title="Select Vector Cache Directory")


        if folder_path:


            self.vector_cache_entry.delete(0, tk.END)


            self.vector_cache_entry.insert(0, folder_path)





    def save_settings(self):


        new_config = {


            "ollama_path": self.ollama_path_entry.get(),


            "model_folder": self.model_folder_entry.get(),


            "vector_cache_dir": self.vector_cache_entry.get(),


            "embedding_model_name": self.embed_model_entry.get()


        }


        self.save_callback(new_config)


        self.destroy()


if __name__ == "__main__":

    app = ResearchApp()

    console = scrolledtext.ScrolledText(app, height=8, bg=Style.BG_TERTIARY, font=Style.LOG_FONT)
    console.tag_config("log", foreground=Style.LOG_COLOR)
    console.tag_config("error", foreground=Style.ERROR)

    console.grid(row=1, column=0, columnspan=2, sticky="ew", padx=5, pady=5)

    sys.stdout = ConsoleRedirector(console, "log")

    sys.stderr = ConsoleRedirector(console, "error")

    app.mainloop()
