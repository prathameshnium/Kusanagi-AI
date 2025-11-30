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
        self.geometry("1000x750") # Increased width for new column
        self.configure(bg=Style.BG_PRIMARY)
        
        self.setup_styles()
        self.create_widgets()

        # Redirect stdout and stderr to the console widget
        sys.stdout = ConsoleRedirector(self.console)
        sys.stderr = ConsoleRedirector(self.console)

        print("--- Kusanagi Console Initialized ---")
        self.populate_models()

    def setup_styles(self):
        s = ttk.Style(self)
        s.theme_use('clam')
        s.configure('.', background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY, font=Style.UI_FONT)
        s.configure('TFrame', background=Style.BG_PRIMARY)
        s.configure('AppButton.TButton', font=Style.BUTTON_FONT, padding=(20, 15))
        s.configure('Accent.TButton', background=Style.ACCENT, foreground=Style.ACCENT_FG)
        s.map('Accent.TButton', background=[('active', '#ffc371')])
        s.configure('Link.TLabel', foreground=Style.LINK_FG, cursor="hand2", background=Style.BG_PRIMARY)

    def create_widgets(self):
        # A root frame to hold content and footer
        root_frame = ttk.Frame(self)
        root_frame.pack(expand=True, fill=tk.BOTH)

        # --- Footer ---
        footer_frame = ttk.Frame(root_frame, style='TFrame')
        footer_frame.pack(side=tk.BOTTOM, fill=tk.X, pady=10, padx=40)

        dev_label = ttk.Label(footer_frame, text="Developer: Prathamesh Deshmukh", style='TLabel')
        dev_label.pack(side=tk.LEFT)
        
        license_label = ttk.Label(footer_frame, text="License: MIT", style="Link.TLabel")
        license_label.pack(side=tk.RIGHT)
        license_label.bind("<Button-1>", lambda e: self.open_license())
        
        # main_frame now goes inside root_frame and holds everything else
        main_frame = ttk.Frame(root_frame, padding=(40, 40, 40, 0))
        main_frame.pack(expand=True, fill=tk.BOTH)

        # Header
        header_label = ttk.Label(
            main_frame,
            text="Kusanagi Local Suite",
            font=Style.TITLE_FONT,
            foreground=Style.ACCENT,
        )
        header_label.pack(anchor='w', pady=(0, 30))

        # --- Main Content Frame (holds apps and models) ---
        content_frame = ttk.Frame(main_frame)
        content_frame.pack(fill=tk.BOTH, expand=True)
        content_frame.columnconfigure(0, weight=1)
        content_frame.columnconfigure(1, weight=1)
        content_frame.rowconfigure(0, weight=1)

        # --- Column 0: App Grid ---
        app_grid_frame = ttk.Frame(content_frame)
        app_grid_frame.grid(row=0, column=0, sticky='nsew', padx=(0, 20))
        
        apps = [
            ("OneTail Local Chatapp", "OneTail_Local_Chatapp.py", "A lightweight, local chat interface."),
            ("Orochimaru Local RAG", "Orochimaru_Local_Research_Assistent.py", "Analyze documents securely on your machine."),
            ("Visualize AI", "Visualize_AI.py", "Visualize the inner workings of AI models.")
        ]

        for i, (name, script, desc) in enumerate(apps):
            self.create_app_button(app_grid_frame, name, script, desc).grid(row=i, column=0, pady=15, sticky="ew")
        
        # --- Column 1: Model Lists ---
        models_container = ttk.Frame(content_frame)
        models_container.grid(row=0, column=1, sticky='nsew', padx=(20, 0))
        models_container.rowconfigure(1, weight=1) # Make listbox expand

        # Models Header
        models_header_frame = ttk.Frame(models_container)
        models_header_frame.grid(row=0, column=0, sticky='ew', pady=(0, 15))
        ttk.Label(models_header_frame, text="Available Models", font=("Segoe UI", 16, "bold")).pack(side=tk.LEFT)
        ttk.Button(models_header_frame, text="Refresh", command=self.populate_models, style='Accent.TButton').pack(side=tk.RIGHT)

        # All Models List
        all_models_frame = ttk.LabelFrame(models_container, text="All Portable Models Available", padding=5)
        all_models_frame.grid(row=1, column=0, sticky='nsew')
        all_models_frame.rowconfigure(0, weight=1)
        all_models_frame.columnconfigure(0, weight=1)

        self.model_list = tk.Listbox(all_models_frame, bg=Style.BG_SECONDARY, fg=Style.FG_PRIMARY, selectbackground=Style.ACCENT, selectforeground=Style.ACCENT_FG, highlightthickness=0, borderwidth=0)
        self.model_list.grid(row=0, column=0, sticky='nsew')
        
        model_scrollbar = ttk.Scrollbar(all_models_frame, orient=tk.VERTICAL, command=self.model_list.yview)
        model_scrollbar.grid(row=0, column=1, sticky='ns')
        self.model_list['yscrollcommand'] = model_scrollbar.set


        # --- Console Output ---
        console_frame = ttk.LabelFrame(main_frame, text="Console Output", padding=10)
        console_frame.pack(fill=tk.BOTH, expand=True, pady=(20, 0))

        self.console = scrolledtext.ScrolledText(
            console_frame,
            wrap=tk.WORD,
            bg=Style.BG_SECONDARY,
            fg=Style.FG_PRIMARY,
            font=("Consolas", 10),
            height=8,
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

    def populate_models(self):
        if ollama is None:
            messagebox.showerror("Ollama Error", "The 'ollama' library is not installed. Please install it using 'pip install ollama'.")
            return

        try:
            print("Fetching models from Ollama...")
            self.model_list.delete(0, tk.END)
            models = ollama.list().get('models', [])
            
            if not models:
                self.model_list.insert(tk.END, "No models found.")
                print("No Ollama models found.")
                return

            all_model_names = sorted([m['model'] for m in models])

            for model_name in all_model_names:
                self.model_list.insert(tk.END, model_name)
            
            print("Successfully populated model list.")

        except Exception as e:
            self.model_list.delete(0, tk.END)
            self.model_list.insert(tk.END, "Connection Error.")
            print(f"Error fetching Ollama models: {e}")
            messagebox.showerror("Ollama Error", f"Could not connect to Ollama server.\nEnsure Ollama is running.\n\nError: {e}")

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