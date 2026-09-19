import tkinter as tk
from tkinter import scrolledtext, ttk, Listbox, filedialog, messagebox
import time
import threading
import sys
import os
import shutil
import httpx
from multiprocessing import Pool, cpu_count
from concurrent.futures import ThreadPoolExecutor, as_completed

from kusanagi_core import (Style, load_config, save_config, OllamaServer, Speaker,
                           apply_theme, SettingsWindow, ConsoleRedirector)


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
ALL_REVIEWERS = {
    "Physicist": "You are a reviewer with expertise in Physics. Focus on the underlying physical principles, theoretical models, and the validity of any physical measurements presented.",
    "Chemist": "You are a reviewer with expertise in Chemistry. Focus on the chemical compositions, reactions, and material properties from a chemical standpoint.",
    "Material Synthesis Expert": "You are a reviewer with expertise in Material Synthesis. Focus on the novelty, reproducibility, and scalability of the synthesis techniques.",
    "Editor": "You are an editor. Review the paper for clarity, grammar, style, and overall structure. Ensure the arguments are presented logically and the paper is easy to understand.",
    "Chief Editor": "You are the Chief Editor. Your job is to read the user's request and all the reviews from the experts. Synthesize their points into a single, cohesive, and balanced final review. Address the user's prompt directly."
}

def parse_pages_worker(args):
    """Worker function to extract text from a range of PDF pages."""
    import fitz
    
    pdf_path, page_numbers = args
    page_chunks = []
    try:
        # Open the document once per worker process
        doc = fitz.open(pdf_path)
        for page_num in page_numbers:
            page = doc.load_page(page_num)
            text = page.get_text("text")
            if text:
                # Create chunks from the page text
                for i in range(0, len(text), 400):
                    page_chunks.append({"text": text[i:i+500], "page": page_num + 1})
        doc.close()
        return page_chunks
    except Exception as e:
        # DO NOT print from a child process. Return the exception to the parent.
        return e


class ResearchApp(tk.Tk):
    def __init__(self):
        super().__init__()
        print("--- App Initializing ---")

        self.app_config = self._load_config()
        self.cot_var = tk.BooleanVar(value=False)

        # 1. Initialize core attributes
        self.ollama_client = None
        self.ollama_server = None  # OllamaServer, when we manage one ourselves
        self.stop_loading_event = threading.Event()
        self.speaker = Speaker()
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

        # Configure the root window's grid layout
        self.grid_rowconfigure(0, weight=1)  # Main content row
        self.grid_rowconfigure(1, weight=0)  # Console row
        self.grid_columnconfigure(1, weight=1)

        apply_theme(self)
        self.reviewer_var = tk.StringVar()
        self.create_widgets()

        # Create and redirect the console for logging
        self._create_and_redirect_console()

        self._initialize_ollama() # Moved after create_widgets
        self.start_services()


    def _create_and_redirect_console(self):
        """Build the log pane in grid row 1 and send stdout/stderr to it.

        __init__ has always called this, but the method was never defined, so
        launching the app raised AttributeError before the window appeared. The
        grid row was reserved for it (`grid_rowconfigure(1, ...)`) and the class
        carried an unused ConsoleRedirector, so this restores what was intended.
        """
        frame = ttk.Frame(self, style='TFrame')
        frame.grid(row=1, column=0, columnspan=2, sticky="ew", padx=5, pady=(0, 5))
        frame.grid_columnconfigure(0, weight=1)

        header = ttk.Frame(frame, style='TFrame')
        header.grid(row=0, column=0, sticky="ew")
        ttk.Label(header, text="Console", style='TLabel',
                  font=(Style.UI_FONT[0], 9, "bold")).pack(side=tk.LEFT)
        self.console_toggle = ttk.Button(header, text="Hide", style='Tool.TButton',
                                         command=self._toggle_console)
        self.console_toggle.pack(side=tk.RIGHT)

        self.console = tk.Text(frame, height=7, wrap=tk.WORD, state=tk.DISABLED,
                               bg=Style.BG_SECONDARY, fg=Style.LOG_COLOR,
                               insertbackground=Style.ACCENT, borderwidth=0,
                               highlightthickness=0, font=Style.LOG_FONT)
        self.console.grid(row=1, column=0, sticky="ew", pady=(4, 0))
        self.console.tag_configure("log", foreground=Style.LOG_COLOR)
        self.console.tag_configure("error", foreground=Style.ERROR)

        sys.stdout = ConsoleRedirector(self.console, "log", timestamps=True)
        sys.stderr = ConsoleRedirector(self.console, "error", timestamps=True)
        print("Console ready.")

    def _toggle_console(self):
        if self.console.winfo_viewable():
            self.console.grid_remove()
            self.console_toggle.config(text="Show")
        else:
            self.console.grid()
            self.console_toggle.config(text="Hide")

    def _save_config(self, config):
        """Persist the config. Was called in three places but never defined."""
        return save_config(config)

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
        full_text = self._temp_review_full_text

        threading.Thread(target=self.review_thread, args=(full_text, self.current_chat_id, reviewer_role), daemon=True).start()

    def create_widgets(self):
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
        
        self.embed_model_var = tk.StringVar()
        self.embed_selector = ttk.Combobox(embed_frame, textvariable=self.embed_model_var, state="readonly")
        self.embed_selector.pack(fill=tk.X, pady=(5,0))
        self.embed_selector.bind("<<ComboboxSelected>>", self.on_embedding_model_select)

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
        ttk.Button(right_buttons_frame, text="Speak Last", style='TopBar.TButton', command=self.speak_last_response).pack(side=tk.RIGHT, padx=5)
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

    def speak_last_response(self):
        if not self.current_chat_id or not self.chat_sessions.get(self.current_chat_id):
            return

        message_history = self.chat_sessions[self.current_chat_id]
        if not message_history:
            return

        last_bot_response = None
        for msg in reversed(message_history):
            if msg['role'] == 'assistant':
                last_bot_response = msg['content']
                break
        
        if last_bot_response:
            self.speak_text(last_bot_response)

    def add_placeholder(self):
        self.entry_box.delete(0, tk.END); self.entry_box.config(foreground=Style.FG_SECONDARY); self.entry_box.insert(0, ENTRY_PLACEHOLDER)

    def append_to_chat(self, text, tag=None):
        self.chat_box.config(state=tk.NORMAL); self.chat_box.insert(tk.END, text, tag or "bot_tag"); self.chat_box.config(state=tk.DISABLED)

    def finalize_response(self):
        self.append_to_chat("\n\n"); self.chat_box.see(tk.END)


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
        full_response, token_batch = "", []
        token_count, start_time, last_update_time, update_interval = 0, time.time(), time.time(), 0.05
        first_token_received = False

        for chunk in response_stream:
            if not first_token_received:
                self.after(0, lambda: self.entry_box.config(state=tk.NORMAL)); first_token_received = True
            
            token = chunk['message']['content']
            full_response += token
            token_batch.append(token)
            token_count += 1
            if token_count % 25 == 0:
                print(f"  [Stream] Received token {token_count}...")

            if time.time() - last_update_time > update_interval:
                self.after(0, self.append_to_chat, "".join(token_batch)); token_batch.clear(); last_update_time = time.time()

        if token_batch: self.after(0, self.append_to_chat, "".join(token_batch))

        self.last_tok_per_sec = f"Tok/s: {token_count / (time.time() - start_time):.2f}" if time.time() > start_time else "Tok/s: --"
        if self.current_chat_id: self.chat_sessions[self.current_chat_id].append({'role': 'assistant', 'content': full_response})
        print("Finished streaming response.")
        self.after(0, self.finalize_response)

    def find_relevant_chunks(self, query_vector, doc_id, top_k=5):
        print(f"Finding top {top_k} relevant chunks for document '{doc_id}'...")
        if doc_id not in self.pdf_text_db:
            print(f"  - Error: Document ID '{doc_id}' not found in text database.")
            return []

        mmap_path = os.path.join(self.vector_cache_dir, f"{doc_id}.mmap")
        if not os.path.exists(mmap_path):
            print(f"  - Error: Vector cache file not found at {mmap_path}")
            return []

        num_chunks = len(self.pdf_text_db[doc_id])
        if num_chunks == 0:
            print("  - Warning: Document has no chunks to search.")
            return []
        print(f"  - Found {num_chunks} chunks for document '{doc_id}'.")
        
        try:
            # Vectors are pre-normalized, so we can load them directly.
            mmap_vectors = np.memmap(mmap_path, dtype=np.float16, mode='r', shape=(num_chunks, len(query_vector)))
            print(f"  - Successfully loaded vector cache from {mmap_path}")
        except ValueError:
            print(f"  - Warning: Could not load mmap for {doc_id} with expected shape. Re-processing might be needed.")
            return []

        # Normalize the query vector. Use float32 for precision.
        query_vector = np.array(query_vector, dtype=np.float32)
        query_norm = np.linalg.norm(query_vector)
        if query_norm == 0:
            print("  - Error: Query vector is zero, cannot compute similarity.")
            return [] # Cannot compare with a zero vector.
        
        query_vector_norm = query_vector / query_norm
        print("  - Query vector normalized.")

        # The dot product of two normalized vectors is the cosine similarity.
        # Cast query vector to the same dtype as mmap_vectors for dot product.
        similarities = np.dot(mmap_vectors, query_vector_norm.astype(mmap_vectors.dtype))
        print("  - Calculated similarities for all chunks.")

        # Get the indices of the top k similarities, sorted from highest to lowest.
        top_k_indices = np.argsort(similarities)[-top_k:][::-1]
        print(f"  - Identified top {len(top_k_indices)} indices: {top_k_indices}")

        relevant_chunks = []
        for i in top_k_indices:
            chunk_info = self.pdf_text_db[doc_id][i]
            similarity_score = similarities[i]
            relevant_chunks.append((chunk_info['text'], similarity_score, chunk_info['page']))
            print(f"    - Retrieved chunk from Page {chunk_info['page']} with similarity: {similarity_score:.4f}")
        
        print("Finished finding relevant chunks.")
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

    def on_embedding_model_select(self, event=None):
        new_model = self.embed_model_var.get()
        # Use the model name without the tag for logic/comparison
        new_model_name = new_model.split(':')[0]

        if not new_model or new_model_name == self.embedding_model_name:
            return

        print(f"User selected new embedding model: {new_model_name}")

        # If a document is already loaded and processed, its vectors are now invalid.
        if self.pdf_text_db:
             messagebox.showwarning("Model Changed", 
                                  "You have changed the embedding model.\n\n"
                                  "The vector data for all loaded documents is now invalid. "
                                  "Please remove and reload your documents to use the new model.")
             # For safety, clear all vector caches and in-memory text databases
             for doc_id in list(self.pdf_text_db.keys()):
                 self.remove_vector_cache(doc_id)
             self.pdf_text_db.clear()
             self.doc_list_box.delete(0, tk.END)
             self.start_new_chat()
        
        self.embedding_model_name = new_model_name
        self.app_config["embedding_model_name"] = new_model_name
        self._save_config(self.app_config)
        print(f"Saved new embedding model '{new_model_name}' to config.")

    def _embed_chunk_task(self, chunk_text):
        """Worker task for thread pool to embed and normalize a text chunk."""
        import numpy as np
        
        # --- DEBUG PRINTS ADDED ---
        print(f"DEBUG: Thread started. Text length: {len(chunk_text)}")
        try:
            print(f"DEBUG: Sending request to Ollama for model {self.embedding_model_name}...")
            
            # The ollama client is thread-safe.
            response = self.ollama_client.embeddings(model=self.embedding_model_name, prompt=chunk_text)
            
            print("DEBUG: Received response from Ollama.")
            
            vector = np.array(response['embedding'], dtype=np.float32)
            norm = np.linalg.norm(vector)
            if norm > 0:
                vector /= norm
            
            return vector.astype(np.float16)
            
        except Exception as e:
            print(f"DEBUG: Error inside thread: {e}")
            raise e

    def populate_models(self):
        print("\n--- Populating Models ---")
        try:
            if not self.ollama_client:
                print("1. Ollama client not initialized. Aborting.")
                raise ConnectionError("Ollama client not initialized.")

            # --- Consolidation Check ---
            # Always check for unconsolidated models first.
            model_folder_path = self.app_config.get('model_folder')
            if os.path.exists(model_folder_path):
                subdirs = [d for d in os.listdir(model_folder_path) if os.path.isdir(os.path.join(model_folder_path, d))]
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

                base_dir = os.path.abspath(os.path.join(model_folder_path, '..'))
                text_embedding_dir = os.path.join(base_dir, 'text_embedding_model')

                if nested_model_folders or os.path.exists(text_embedding_dir):
                    print("     - DIAGNOSIS: Found potential unconsolidated model folders. Consolidating now.")
                    self._consolidate_models(model_folder_path, nested_model_folders)
                    print("     - Rerunning model population after consolidation...")
                    self.after(100, self.populate_models)
                    return
            # --- End Consolidation Check ---

            print("1. Calling ollama_client.list() to get models...")
            models_response = self.ollama_client.list()
            print(f"2. Raw response from Ollama: {models_response}")

            models_list = models_response.get('models', [])
            if not models_list:
                print("3. WARNING: 'models' key not found in response or is empty. No models will be loaded.")
                model_folder_path = self.app_config.get('model_folder')
                print("   - This usually means the OLLAMA_MODELS path is incorrect or the directory is empty.")
                print(f"   - Current OLLAMA_MODELS path set at server start: '{model_folder_path}'")
                if os.path.exists(model_folder_path):
                    if not os.listdir(model_folder_path):
                        print("   - DIAGNOSIS: The directory exists but is empty. Please place your Ollama models inside it.")
                    else:
                        print(f"   - DIAGNOSIS: The directory '{model_folder_path}' exists and is not empty, but Ollama found no models.")
                        subdirs = [d for d in os.listdir(model_folder_path) if os.path.isdir(os.path.join(model_folder_path, d))]
                        if 'manifests' not in subdirs or 'blobs' not in subdirs:
                            print(f"     - PROBLEM: The folder '{model_folder_path}' is missing the required 'manifests' and/or 'blobs' subdirectories.")
                        else:
                             print("   - The folder structure appears correct. Check for corrupted model files.")
                else:
                    print("   - DIAGNOSIS: The directory does not exist. Please check 'model_folder' in System_Config.json.")

            model_names = sorted([m['model'] for m in models_list])
            print(f"3. Extracted and sorted model names: {model_names}")

            self.status_light.config(foreground="#3AD900"); self.status_label.config(text="Connected")
            
            # --- Separate Chat and Embedding Models ---
            chat_models = [name for name in model_names if "embed" not in name and "minilm" not in name]
            embedding_models = [name for name in model_names if "embed" in name or "minilm" in name]
            
            print(f"4a. Filtered chat models: {chat_models}")
            print(f"4b. Filtered embedding models: {embedding_models}")

            # --- Populate UI ComboBoxes ---
            self.model_selector['values'] = chat_models or ["No models found"]
            self.embed_selector['values'] = embedding_models or ["No models found"]
            
            # --- Select Active Embedding Model ---
            desired_model = self.app_config.get("embedding_model_name")
            selected_embedding_model = None

            if desired_model and embedding_models:
                for model in embedding_models:
                    # Use a stricter check to match the model from config
                    if model == desired_model or model.startswith(f"{desired_model}:"):
                        selected_embedding_model = model
                        break
            
            if not selected_embedding_model and embedding_models:
                selected_embedding_model = embedding_models[0]

            if selected_embedding_model:
                self.embed_model_var.set(selected_embedding_model)
                self.embedding_model_name = selected_embedding_model.split(':')[0]
                self.embedding_model_available = True
                self.load_pdf_button.config(state=tk.NORMAL)
                print(f"   - SUCCESS: Auto-selected embedding model: '{self.embedding_model_name}'")
            else:
                self.embedding_model_available = False
                self.embed_model_var.set("No models found")
                self.load_pdf_button.config(state=tk.DISABLED)
                print("   - WARNING: No embedding models were found. Document features will be disabled.")

            # --- Select Active Chat Model ---
            current_selection = self.model_selector.get()
            if not current_selection or current_selection not in chat_models:
                new_selection = chat_models[0] if chat_models else ""
                self.model_var.set(new_selection)
                print(f"7. Current model selection ('{current_selection}') is invalid. Setting to: '{new_selection}'")

            if not self.current_chat_id:
                print("8. No current chat session. Starting a new one.")
                self.start_new_chat()
            print("--- Model Population Complete ---")

        except Exception as e:
            print("\n--- Ollama Connection/Population FAILED ---")
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
            print(f"--- Starting PDF Processing for '{pdf_id}' ---")
            self.after(0, lambda: self.load_pdf_button.config(state=tk.DISABLED))
            
            # --- Stage 1: Parallel Text Extraction and Chunking ---
            print(f"[Stage 1/3] Parsing text from '{os.path.basename(pdf_path)}'...")
            self.after(0, lambda: self.status_label.config(text=f"Parsing '{pdf_id}'...", foreground=Style.ACCENT))
            try:
                doc = fitz.open(pdf_path)
                page_count = doc.page_count
                doc.close()
                print(f"  - PDF has {page_count} pages.")
            except Exception as e:
                raise ValueError(f"Could not open or read PDF: {e}")

            if page_count == 0:
                raise ValueError("PDF is empty.")

            num_processes_parse = min(cpu_count(), page_count) if page_count > 0 else 1
            page_batches = np.array_split(range(page_count), num_processes_parse)
            parse_args = [(pdf_path, batch.tolist()) for batch in page_batches if batch.size > 0]
            
            chunks = []
            with Pool(processes=num_processes_parse) as pool:
                processed_pages = 0
                print(f"  - Starting text extraction with {len(parse_args)} worker process(es)...")
                for i, result_batch in enumerate(pool.imap(parse_pages_worker, parse_args)):
                    if isinstance(result_batch, Exception):
                        raise ValueError(f"Parsing batch {i+1} failed in worker. Error: {result_batch}")
                    chunks.extend(result_batch)
                    processed_pages += len(parse_args[i][1])
                    print(f"  - Processed batch {i+1}/{len(parse_args)}, pages done: {processed_pages}/{page_count}")
                    self.after(0, lambda p=processed_pages: self.status_label.config(text=f"Parsing page: {p}/{page_count}"))
            print(f"  - Text extraction complete. Found {len(chunks)} text chunks.")

            if not chunks:
                raise ValueError("Could not extract any text from PDF.")
            
            self.pdf_text_db[pdf_id] = chunks
            total_chunks = len(chunks)

            # --- Stage 2: Threaded Embedding Generation ---
            print(f"[Stage 2/3] Generating embeddings for {total_chunks} chunks...")
            self.after(0, lambda: self.status_label.config(text=f"Embedding 0/{total_chunks}", foreground=Style.ACCENT))

            worker_args = [chunk['text'] for chunk in chunks]
            # Set concurrency to 1 to prevent overloading the local Ollama server.
            num_threads = 1

            results = [None] * total_chunks # Pre-allocate list to store results in order
            
            with ThreadPoolExecutor(max_workers=num_threads) as executor:
                print(f"  - Starting embedding generation with {num_threads} worker thread(s)...")
                # Create a map of future to its index to reorder results
                future_to_index = {executor.submit(self._embed_chunk_task, text): i for i, text in enumerate(worker_args)}

                processed_count = 0
                for future in as_completed(future_to_index):
                    index = future_to_index[future]
                    try:
                        result = future.result()
                        results[index] = result
                    except Exception as e:
                        # An exception was raised in the worker
                        raise ValueError(f"Embedding chunk {index + 1} failed in worker. Error: {e}")

                    processed_count += 1
                    if (processed_count % 10 == 0) or (processed_count == total_chunks):
                        print(f"  - Embedded chunk {processed_count}/{total_chunks}")
                        self.after(0, lambda p=processed_count: self.status_label.config(text=f"Embedding: {p}/{total_chunks}"))

            print("  - Embedding generation complete.")

            # --- Stage 3: Vector Saving ---
            print(f"[Stage 3/3] Saving {len(results)} vectors to disk...")
            self.after(0, lambda: self.status_label.config(text=f"Saving 0/{total_chunks}", foreground=Style.ACCENT))
            
            if not results:
                raise ValueError("Embedding process returned no results.")

            first_vector = results[0]
            mmap_shape = (total_chunks, len(first_vector))
            mmap_path = os.path.join(self.vector_cache_dir, f"{pdf_id}.mmap")
            mmap_vectors = np.memmap(mmap_path, dtype=np.float16, mode='w+', shape=mmap_shape)
            print(f"  - Created memory-mapped file at '{mmap_path}' with shape {mmap_shape}.")

            for i, vector in enumerate(results):
                mmap_vectors[i] = vector
                if (i + 1) % 50 == 0 or (i + 1) == total_chunks:
                     print(f"  - Serialized vector {i+1}/{total_chunks}")
                     self.after(0, lambda p=i+1: self.status_label.config(text=f"Saving: {p}/{total_chunks}"))
            
            mmap_vectors.flush()
            print("  - Flushed all vectors to disk.")

            print(f"--- Successfully processed and embedded '{pdf_id}' ---")
            self.after(0, lambda: self.append_to_chat(f"Ready to chat with '{pdf_id}'.\n\n", "thinking_tag"))

        except Exception as e:
            print(f"--- Error processing PDF '{pdf_id}': {e} ---", file=sys.stderr)
            # Bind the text now. Python unbinds `e` when the except block ends, so
            # a lambda closing over it raises NameError by the time after() runs it
            # -- i.e. the error dialog itself used to crash.
            detail = str(e)
            self.after(0, lambda msg=detail: messagebox.showerror(
                "Processing Error", "Failed to process '{}'.\n\nDetails: {}".format(pdf_id, msg)))
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
        settings_dialog = SettingsWindow(self, self.app_config, self._on_settings_saved)
        self.wait_window(settings_dialog)


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

        # Try to connect to an existing server first
        try:
            print("1. Checking for an existing Ollama server...")
            # Set a longer connect timeout to avoid long hangs on startup
            timeout = httpx.Timeout(30.0, connect=5.0)
            external_client = ollama.Client(host='127.0.0.1', timeout=timeout)
            external_models = external_client.list().get('models', [])
            external_model_names = [m['model'] for m in external_models]
            print(f"2. Found existing server with models: {external_model_names}")

            # Check if the existing server has a suitable embedding model
            found_on_external = False
            for name in external_model_names:
                if "embed" in name or "minilm" in name:
                    found_on_external = True
                    break

            if found_on_external:
                print("3. SUCCESS: Existing server has a suitable embedding model.")
                print("   - Using the existing Ollama server.")
                self.ollama_client = ollama.Client(host='127.0.0.1', timeout=300)
                self.populate_models()
                return # Success, we are done.
            else:
                print("3. WARNING: Existing server found, but it does NOT have a suitable embedding model.")
                print("   - Could not find a suitable embedding model (e.g. 'all-minilm', 'mxbai-embed-large').")
                print("   - The application will now attempt to start its own managed Ollama server.")
                # Attempt to shut down our own previously managed server if it's still running,
                # as it might be the one without the model.
                if self.ollama_server:
                    print("   - Shutting down previously managed Ollama server to restart it correctly.")
                    self._stop_ollama_server()
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
            self.ollama_server = OllamaServer(ollama_path, model_folder,
                                              log_name='ollama_server.log')
            self.ollama_server.start()
            self.ollama_client = ollama.Client(host='127.0.0.1', timeout=300)
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

    def _stop_ollama_server(self):
        if self.ollama_server:
            self.ollama_server.stop()

    def _load_config(self):
        # Shared with every other desktop app -- see local_apps/kusanagi_core.py.
        self.app_config = load_config()
        print("Info: using configuration: %s" % self.app_config)

    def speak_text(self, text):
        """Queue text for the shared Speaker (no-op when muted or unavailable)."""
        self.speaker.say(text)

    def toggle_mute(self):
        muted = self.speaker.toggle_mute()
        self.mute_button.config(text=Style.ICON_MUTE if muted else Style.ICON_UNMUTE)

    def _on_settings_saved(self, new_config):
        """SettingsWindow has already written the file; reload what we cached."""
        self.app_config = load_config()


if __name__ == "__main__":
    # Required for multiprocessing to work when bundled by PyInstaller
    import multiprocessing
    multiprocessing.freeze_support()

    app = ResearchApp()
    app.mainloop()
