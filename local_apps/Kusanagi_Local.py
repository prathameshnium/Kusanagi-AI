import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import subprocess
import os
import sys
import webbrowser
try:
    import ollama
except ImportError:
    ollama = None

class Style:
    UI_FONT = ("Segoe UI", 11)
    TITLE_FONT = ("Segoe UI", 24, "bold")
    BUTTON_FONT = ("Segoe UI", 12, "bold")
    BG_PRIMARY = "#193549"
    BG_SECONDARY = "#1e293b"
    FG_PRIMARY = "#f8fafc"
    ACCENT = "#ffab40"
    ACCENT_FG = "#0f172a"
    LINK_FG = "#64b5f6"

class ConsoleRedirector:
    def __init__(self, text_widget):
        self.text_widget = text_widget

    def write(self, string):
        self.text_widget.config(state='normal')
        self.text_widget.insert(tk.END, string)
        self.text_widget.see(tk.END)
        self.text_widget.config(state='disabled')

    def flush(self):
        pass

class KusanagiApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Kusanagi AI - Local Application Launcher")
        self.geometry("800x750") # Increased height for console
        self.configure(bg=Style.BG_PRIMARY)
        
        self.setup_styles()
        self.create_widgets()

        # Redirect stdout and stderr to the console widget
        sys.stdout = ConsoleRedirector(self.console)
        sys.stderr = ConsoleRedirector(self.console)

        print("--- Kusanagi Console Initialized ---")

    def setup_styles(self):
        s = ttk.Style(self)
        s.theme_use('clam')
        s.configure('.', background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY, font=Style.UI_FONT)
        s.configure('TFrame', background=Style.BG_PRIMARY)
        s.configure('AppButton.TButton', font=Style.BUTTON_FONT, padding=(20, 15))
        s.configure('Accent.TButton', background=Style.ACCENT, foreground=Style.ACCENT_FG)
        s.map('Accent.TButton', background=[('active', '#ffc371')])
        s.configure('Link.TLabel', foreground=Style.LINK_FG, cursor="hand2")

    def create_widgets(self):
        main_frame = ttk.Frame(self, padding=40)
        main_frame.pack(expand=True, fill=tk.BOTH)

        # Header
        header_frame = ttk.Frame(main_frame)
        header_frame.pack(fill=tk.X, pady=(0, 30))

        header_label = ttk.Label(
            header_frame,
            text="Kusanagi Local Suite",
            font=Style.TITLE_FONT,
            foreground=Style.ACCENT,
            background=Style.BG_PRIMARY
        )
        header_label.pack(side=tk.LEFT, expand=True)

        settings_button = ttk.Button(
            header_frame,
            text="⚙️ Settings",
            command=self.open_settings,
            style='AppButton.TButton'
        )
        settings_button.pack(side=tk.RIGHT, padx=10)

        # App Grid
        app_grid = ttk.Frame(main_frame)
        app_grid.pack(expand=True, fill='x')
        
        apps = [
            ("OneTail Local Chatapp", "OneTail_Local_Chatapp.py", "A lightweight, local chat interface."),
            ("Orochimaru Local RAG", "Orochimaru_Local_Research_Assistent.py", "Analyze documents securely on your machine."),
            ("Visualize AI", "Visualize_AI.py", "Visualize the inner workings of AI models.")
        ]

        for i, (name, script, desc) in enumerate(apps):
            self.create_app_button(app_grid, name, script, desc).grid(row=i, column=0, pady=15, sticky="ew")

        # --- Console Output ---
        console_frame = ttk.LabelFrame(main_frame, text="Console Output", padding=10)
        console_frame.pack(fill=tk.BOTH, expand=True, pady=(20, 0))

        self.console = scrolledtext.ScrolledText(
            console_frame,
            wrap=tk.WORD,
            bg=Style.BG_SECONDARY,
            fg=Style.FG_PRIMARY,
            font=("Consolas", 10),
            height=10,
            state='disabled'
        )
        self.console.pack(fill=tk.BOTH, expand=True)


    def create_app_button(self, parent, name, script_name, description):
        button_frame = ttk.Frame(parent, style='TFrame')
        
        launch_button = ttk.Button(
            button_frame, 
            text=f"Launch {name}", 
            command=lambda s=script_name: self.launch_script(s),
            style='Accent.TButton'
        )
        launch_button.pack(side=tk.LEFT, padx=(0, 20))
        
        desc_frame = ttk.Frame(button_frame, style='TFrame')
        desc_frame.pack(side=tk.LEFT, fill=tk.X, expand=True)

        name_label = ttk.Label(desc_frame, text=name, font=("Segoe UI", 14, "bold"), background=Style.BG_PRIMARY)
        name_label.pack(anchor="w")

        desc_label = ttk.Label(desc_frame, text=description, background=Style.BG_PRIMARY, foreground="#94a3b8")
        desc_label.pack(anchor="w")
        
        return button_frame

    def open_settings(self):
        settings_win = tk.Toplevel(self)
        settings_win.title("Configuration Settings")
        settings_win.geometry("600x550")
        settings_win.configure(bg=Style.BG_SECONDARY)
        settings_win.transient(self)
        settings_win.grab_set()

        # --- Title ---
        title_label = ttk.Label(settings_win, text="Kusanagi Settings", font=Style.TITLE_FONT, foreground=Style.ACCENT, background=Style.BG_SECONDARY)
        title_label.pack(pady=20)
        
        # --- Models Frame ---
        models_frame = ttk.Frame(settings_win, style='TFrame', padding=10)
        models_frame.pack(fill=tk.BOTH, expand=True, padx=20)
        models_frame.column_configure(0, weight=1)
        models_frame.column_configure(1, weight=1)

        # LLM Models
        llm_frame = ttk.LabelFrame(models_frame, text="Available LLM Models", padding=10)
        llm_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 5))
        llm_list = tk.Listbox(llm_frame, bg=Style.BG_PRIMARY, fg=Style.FG_PRIMARY, selectbackground=Style.ACCENT, selectforeground=Style.ACCENT_FG, highlightthickness=0, borderwidth=0)
        llm_list.pack(fill=tk.BOTH, expand=True)

        # Embedding Models
        embed_frame = ttk.LabelFrame(models_frame, text="Available Embedding Models", padding=10)
        embed_frame.grid(row=0, column=1, sticky="nsew", padx=(5, 0))
        embed_list = tk.Listbox(embed_frame, bg=Style.BG_PRIMARY, fg=Style.FG_PRIMARY, selectbackground=Style.ACCENT, selectforeground=Style.ACCENT_FG, highlightthickness=0, borderwidth=0)
        embed_list.pack(fill=tk.BOTH, expand=True)

        def populate_models():
            if ollama is None:
                messagebox.showerror("Ollama Error", "The 'ollama' library is not installed. Please install it using 'pip install ollama'.", parent=settings_win)
                return

            try:
                print("Fetching models from Ollama...")
                models = ollama.list().get('models', [])
                llm_list.delete(0, tk.END)
                embed_list.delete(0, tk.END)
                
                if not models:
                    llm_list.insert(tk.END, "No models found.")
                    embed_list.insert(tk.END, "No models found.")
                    print("No Ollama models found.")
                    return

                chat_models = sorted([m['model'] for m in models if "embed" not in m.get('name', '').lower() and "minilm" not in m.get('name', '').lower()])
                embedding_models = sorted([m['model'] for m in models if "embed" in m.get('name', '').lower() or "minilm" in m.get('name', '').lower()])

                if chat_models:
                    for model in chat_models:
                        llm_list.insert(tk.END, model)
                else:
                    llm_list.insert(tk.END, "No chat models found.")
                
                if embedding_models:
                    for model in embedding_models:
                        embed_list.insert(tk.END, model)
                else:
                    embed_list.insert(tk.END, "No embedding models found.")
                print("Successfully populated model lists.")

            except Exception as e:
                print(f"Error fetching Ollama models: {e}")
                messagebox.showerror("Ollama Error", f"Could not connect to Ollama server.\nEnsure Ollama is running.\n\nError: {e}", parent=settings_win)

        # --- Info & Actions Frame ---
        info_frame = ttk.Frame(settings_win, style='TFrame')
        info_frame.pack(fill=tk.X, padx=20, pady=10)

        dev_label = ttk.Label(info_frame, text="Developer: Prathamesh Deshmukh", background=Style.BG_SECONDARY)
        dev_label.pack(side=tk.LEFT, anchor='w')

        license_label = ttk.Label(info_frame, text="License: MIT", style="Link.TLabel", background=Style.BG_SECONDARY)
        license_label.pack(side=tk.LEFT, anchor='w', padx=20)
        license_label.bind("<Button-1>", lambda e: self.open_license())

        refresh_button = ttk.Button(info_frame, text="Refresh Models", command=populate_models, style='Accent.TButton')
        refresh_button.pack(side=tk.RIGHT, anchor='e')
        
        # --- Initial Population ---
        populate_models()


    def open_license(self):
        try:
            license_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'LICENSE'))
            webbrowser.open(license_path)
        except Exception as e:
            print(f"Could not open license file: {e}")
            messagebox.showerror("Error", f"Could not find or open the LICENSE file.\n{e}")

    def launch_script(self, script_name):
        try:
            # Assumes scripts are in the same directory
            script_path = os.path.join(os.path.dirname(__file__), script_name)
            if os.path.exists(script_path):
                print(f"Launching {script_name}...")
                subprocess.Popen([sys.executable, script_path])
            else:
                print(f"Error: Script not found at {script_path}")
                messagebox.showerror("Error", f"Could not find {script_name}")
        except Exception as e:
            print(f"Failed to launch {script_name}: {e}")
            messagebox.showerror("Launch Error", f"An error occurred while launching the application: {e}")

if __name__ == "__main__":
    app = KusanagiApp()
    app.mainloop()