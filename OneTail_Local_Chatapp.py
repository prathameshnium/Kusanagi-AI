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
tts_queue = queue.Queue()
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
        self.cot_var = tk.BooleanVar(value=False)
        self.config = self._load_config()
        self.ollama_client = None # Initialize to None
        self.ollama_process = None # To store the subprocess
        self._initialize_ollama()
        self.title("One Tail Chat app")
        self.geometry("1200x800")
        self.configure(bg=Style.BG_PRIMARY)
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.setup_styles()
        self.create_widgets()
        self.start_services()
        self.is_muted = False
        self.last_tok_per_sec = ""
        self.chat_sessions = {}
        self.current_chat_id = None
        self.chat_counter = 0


    def setup_styles(self):
        s = ttk.Style(self)
        s.theme_use('clam')
        s.configure('.', background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY, font=Style.UI_FONT, borderwidth=0)
        s.configure('TFrame', background=Style.BG_PRIMARY)
        s.configure('Sidebar.TFrame', background=Style.BG_SECONDARY)
        s.configure('Sidebar.TLabel', background=Style.BG_SECONDARY, foreground=Style.FG_PRIMARY)
        s.configure('Accent.Sidebar.TButton', background=Style.ACCENT, foreground=Style.ACCENT_FG, font=(Style.UI_FONT[0], Style.UI_FONT[1], 'bold'))
        s.map('Accent.Sidebar.TButton', background=[('active', "#e69a38")])
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
        ttk.Label(self.sidebar, text="One Tail Chat app", font=Style.TITLE_FONT, foreground=Style.ACCENT, style='Sidebar.TLabel').pack(pady=(10, 0), padx=15, anchor="w")
        ttk.Label(self.sidebar, text="Developed by Prathamesh Deshmukh", style='Sidebar.TLabel', font=("Segoe UI", 12, "bold"), foreground=Style.ACCENT).pack(pady=(0, 5), padx=15, anchor="w")
        ttk.Label(self.sidebar, text="One Tail Chat App", style='Sidebar.TLabel', foreground=Style.FG_SECONDARY).pack(pady=(0, 15), padx=15, anchor="w")

        # --- Status Section ---
        status_frame = ttk.Frame(self.sidebar, style='Sidebar.TFrame')
        status_frame.pack(fill=tk.X, padx=15, pady=5)
        self.status_light = ttk.Label(status_frame, text="●", font=("Segoe UI", 12), foreground=Style.FG_SECONDARY, style='Sidebar.TLabel')
        self.status_light.pack(side=tk.LEFT)
        self.status_label = ttk.Label(status_frame, text="Connecting...", style='Sidebar.TLabel')
        self.status_label.pack(side=tk.LEFT, padx=5)

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

        # --- History Tabs ---
        chat_history_frame = ttk.Frame(self.sidebar, style='Sidebar.TFrame')
        chat_history_frame.pack(fill=tk.BOTH, expand=True, padx=15, pady=10)

        # --- Chat History Controls ---
        chat_buttons_frame = ttk.Frame(chat_history_frame, style='Sidebar.TFrame')
        chat_buttons_frame.pack(fill=tk.X, pady=(5,0))
        ttk.Button(chat_buttons_frame, text=Style.ICON_NEW_CHAT, style='Tool.TButton', command=self.start_new_chat).pack(side=tk.LEFT, padx=(0,5))
        ttk.Button(chat_buttons_frame, text=Style.ICON_DELETE, style='Tool.TButton', command=self.remove_selected_chat).pack(side=tk.LEFT)

        self.chat_list_box = Listbox(chat_history_frame, bg=Style.BG_TERTIARY, fg=Style.FG_PRIMARY, selectbackground=Style.ACCENT, selectforeground=Style.ACCENT_FG, highlightthickness=0, borderwidth=0, exportselection=False)
        self.chat_list_box.pack(fill=tk.BOTH, expand=True, pady=5)
        self.chat_list_box.bind("<<ListboxSelect>>", lambda e: self.on_history_select(e, 'chat'))

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

        input_frame = ttk.Frame(main_area)
        input_frame.grid(row=2, column=0, sticky="ew", padx=5, pady=5)
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
        self.after(100, self.populate_models)
        self.add_placeholder()

    def on_closing(self):
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

    def on_send_click(self):
        prompt = self.entry_box.get()
        if not (prompt.strip() and prompt != ENTRY_PLACEHOLDER): return
        print(f"Sending prompt: \"{prompt}\"")
        
        if not self.model_var.get() or "No models" in self.model_var.get(): 
            messagebox.showerror("Model Error", "Please select a valid chat model.")
            return

        self.append_to_chat(f"You: {prompt}\n", "user_tag"); self.chat_box.see(tk.END)
        self.entry_box.config(state=tk.DISABLED); self.entry_box.delete(0, tk.END); self.add_placeholder()

        threading.Thread(target=self.normal_chat_thread, args=(prompt, self.chat_sessions[self.current_chat_id]), daemon=True).start()

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

    def normal_chat_thread(self, prompt, message_history):
        try:
            print("Executing normal chat thread...")
            self.after(0, lambda: self.append_to_chat(f"{self.model_var.get().split(':')[0].capitalize()} (Chat): ", "bot_name_tag"))
            
            print(f"Sending chat request to model '{self.model_var.get()}'...")
            response = self.ollama_client.chat(model=self.model_var.get(), messages=message_history + [{'role': 'user', 'content': prompt}], stream=True)
            self.stream_response_to_chat(response)
            message_history.append({'role': 'user', 'content': prompt})
        except Exception as e:
            self.after(0, self.append_to_chat, f"\nError in chat thread: {e}\n\n", "error_tag")
        finally:
            self.after(0, lambda: self.entry_box.config(state=tk.NORMAL))

    def populate_models(self):
        print("Populating available models...")
        try:
            if not self.ollama_client:
                raise ConnectionError("Ollama client not initialized.")

            models_list = self.ollama_client.list().get('models', [])
            model_names = sorted([m['model'] for m in models_list])
            self.status_light.config(foreground="#3AD900"); self.status_label.config(text="Connected")
            chat_models = [name for name in model_names if "embed" not in name]
            self.model_selector['values'] = chat_models or ["No models found"]
            
            if self.model_selector.get() not in chat_models:
                self.model_var.set(chat_models[0] if chat_models else "")
            if not self.current_chat_id: self.start_new_chat()
        except Exception as e:
            print(f"Ollama connection failed: {e}")
            self.status_light.config(foreground=Style.ERROR); self.status_label.config(text="Ollama Not Found")
            self.model_selector['values'] = ["Connection Failed"]; self.model_var.set("Connection Failed")
            if self.ollama_client:
                self.after(5000, self.populate_models)

    def remove_selected_chat(self):
        selected_indices = self.chat_list_box.curselection()
        if not selected_indices: return
        chat_to_remove = self.chat_list_box.get(selected_indices[0])
        if messagebox.askyesno("Confirm Removal", f"Delete chat '{chat_to_remove}'?"):
            del self.chat_sessions[chat_to_remove]
            self.chat_list_box.delete(selected_indices[0])
            if self.current_chat_id == chat_to_remove: self.start_new_chat()

    def on_history_select(self, event, listbox_type):
        source_listbox = self.chat_list_box
        
        selected_indices = source_listbox.curselection()
        if not selected_indices: return
        
        selected_id = source_listbox.get(selected_indices[0])

        self.current_chat_id = selected_id
        self.current_chat_label.config(text=self.current_chat_id)
        self.load_chat_history(self.current_chat_id)

    def load_chat_history(self, session_id):
        self.chat_box.config(state=tk.NORMAL); self.chat_box.delete(1.0, tk.END)
        message_history = self.chat_sessions.get(session_id, [])
        
        model_name = self.model_var.get().split(':')[0].capitalize() if self.model_var.get() else "AI"
        for msg in message_history:
            if msg['role'] == 'user':
                self.append_to_chat(f"You: {msg['content']}\n", "user_tag")
            else:
                self.append_to_chat(f"{model_name}: {msg['content']}\n\n")
        
        self.chat_box.config(state=tk.DISABLED); self.chat_box.see(tk.END)

    def start_new_chat(self):
        if not hasattr(self, 'chat_list_box'):
            self.after(100, self.start_new_chat)
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
            
    def open_settings_window(self):
        settings_dialog = SettingsWindow(self, self.config, self._save_and_update_config)
        self.wait_window(settings_dialog)

    
    def _save_and_update_config(self, new_config):
        self.config = new_config
        self._save_config(self.config)
        messagebox.showinfo("Settings Saved", "Settings have been saved. Restart the application for some changes to take full effect.")

    def _initialize_ollama(self):
        print("--- Initializing Ollama Connection ---")
        ollama_path = self.config.get("ollama_path")

        # This client is used to check for an externally running server
        self.ollama_client = ollama.Client(host='127.0.0.1', timeout=5)
        try:
            # Check if Ollama is already running
            print("Checking for existing Ollama server...")
            self.ollama_client.list()
            print("Connected to an existing Ollama server.")
            # Set a longer timeout for the rest of the session
            self.ollama_client = ollama.Client(host='127.0.0.1', timeout=120)
            return # Skip starting our own server
        except Exception:
            print("No existing Ollama server found. Attempting to start a local one.")

        if ollama_path and os.path.exists(ollama_path):
            try:
                self.ollama_process = self._start_ollama_server(ollama_path)
                
                # Set a longer timeout for operations
                self.ollama_client = ollama.Client(host='127.0.0.1', timeout=120)
                print("Waiting for local Ollama server to become responsive...")

                max_wait_time = 60 # seconds
                start_wait_time = time.time()
                server_ready = False
                while time.time() - start_wait_time < max_wait_time:
                    try:
                        # Use a lightweight request to check if the server is up
                        self.ollama_client.list() 
                        server_ready = True
                        print("Local Ollama server is responsive.")
                        break
                    except Exception:
                        self.after(0, lambda: self.status_label.config(text=f"Waiting... ({int(time.time() - start_wait_time)}s)"))
                        time.sleep(1) # Wait 1 second before retrying
                
                if not server_ready:
                    messagebox.showerror("Ollama Start Error", f"Local Ollama server did not respond within {max_wait_time} seconds. Check logs/ollama_server.log for details.")
                    self.on_closing()
                    return

            except Exception as e:
                messagebox.showerror("Ollama Start Error", f"Failed to start local Ollama server: {e}")
                self.ollama_client = None # Ensure client is None if startup fails
        else:
            self.ollama_client = None # Ensure client is None if path is invalid
            print("Ollama executable path is not configured or invalid. Cannot start local server.")
            messagebox.showwarning("Ollama Not Found", "Could not find a running Ollama instance or start a local one. Please configure the path to ollama.exe in settings or start Ollama manually.")

    def _start_ollama_server(self, ollama_path):
        print(f"Attempting to start Ollama server from: {ollama_path}")
        env = os.environ.copy()

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
            self.ollama_process.wait(timeout=5)
            print("Ollama server stopped.")

    def _load_config(self):
        config_path = "System_Config.json"
        script_dir = os.path.dirname(os.path.abspath(__file__))

        # Define default portable paths and settings
        default_config = {
            "ollama_path": "F:\\GitHub_assets\\Kusanagi-Assets\\Portable_AI_Assets\\ollama_main\\ollama.exe",
            "model_folder": "F:\\GitHub_assets\\Kusanagi-Assets\\Portable_AI_Assets\\common-ollama-models"
        }

        config_to_use = default_config.copy()

        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    loaded_config = json.load(f)
                    config_to_use.update(loaded_config)
            except (json.JSONDecodeError, IOError):
                pass  # Use defaults if file is corrupt or unreadable

        # Resolve paths to be absolute
        for path_key in ["ollama_path", "model_folder"]:
            if path_key in config_to_use and not os.path.isabs(config_to_use[path_key]):
                config_to_use[path_key] = os.path.join(script_dir, config_to_use[path_key])

        # Save the (potentially updated) config
        self._save_config(config_to_use)
        return config_to_use

    def _save_config(self, config):
        config_path = "System_Config.json"
        with open(config_path, 'w') as f:
            json.dump(config, f, indent=4)

class SettingsWindow(tk.Toplevel):


    def __init__(self, master, current_config, save_callback):


        super().__init__(master)


        self.title("Settings")


        self.geometry("500x250")


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


        # Buttons


        button_frame = ttk.Frame(main_frame, style='TFrame')


        button_frame.pack(fill=tk.X, pady=15)


        ttk.Button(button_frame, text="Save", command=self.save_settings, style='Accent.Sidebar.TButton').pack(side=tk.RIGHT, padx=5)


        ttk.Button(button_frame, text="Cancel", command=self.destroy, style='Tool.TButton').pack(side=tk.RIGHT)


    def load_settings(self):
        self.ollama_path_entry.insert(0, self.current_config.get("ollama_path", ""))
        self.model_folder_entry.insert(0, self.current_config.get("model_folder", ""))

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

    def save_settings(self):
        new_config = {
            "ollama_path": self.ollama_path_entry.get(),
            "model_folder": self.model_folder_entry.get()
        }
        self.save_callback(new_config)
        self.destroy()

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


if __name__ == "__main__":

    app = ResearchApp()

    console = scrolledtext.ScrolledText(app, height=8, bg=Style.BG_TERTIARY, font=Style.LOG_FONT)
    console.tag_config("log", foreground=Style.LOG_COLOR)
    console.tag_config("error", foreground=Style.ERROR)

    console.grid(row=1, column=0, columnspan=2, sticky="ew", padx=5, pady=5)

    sys.stdout = ConsoleRedirector(console, "log")

    sys.stderr = ConsoleRedirector(console, "error")

    app.mainloop()
