import tkinter as tk
from tkinter import ttk
import subprocess
import os
import sys

class Style:
    UI_FONT = ("Segoe UI", 11)
    TITLE_FONT = ("Segoe UI", 24, "bold")
    BUTTON_FONT = ("Segoe UI", 12, "bold")
    BG_PRIMARY = "#0f172a"
    BG_SECONDARY = "#1e293b"
    FG_PRIMARY = "#f8fafc"
    ACCENT = "#ffab40"
    ACCENT_FG = "#0f172a"

class KusanagiApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Kusanagi AI - Local Application Launcher")
        self.geometry("800x600")
        self.configure(bg=Style.BG_PRIMARY)
        
        self.setup_styles()
        self.create_widgets()

    def setup_styles(self):
        s = ttk.Style(self)
        s.theme_use('clam')
        s.configure('.', background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY, font=Style.UI_FONT)
        s.configure('TFrame', background=Style.BG_PRIMARY)
        s.configure('AppButton.TButton', font=Style.BUTTON_FONT, padding=(20, 15))
        s.configure('Accent.TButton', background=Style.ACCENT, foreground=Style.ACCENT_FG)
        s.map('Accent.TButton', background=[('active', '#ffc371')])

    def create_widgets(self):
        main_frame = ttk.Frame(self, padding=40)
        main_frame.pack(expand=True, fill=tk.BOTH)

        # Header
        header_label = ttk.Label(
            main_frame,
            text="Kusanagi Local Suite",
            font=Style.TITLE_FONT,
            foreground=Style.ACCENT,
            background=Style.BG_PRIMARY
        )
        header_label.pack(pady=(20, 40))

        # App Grid
        app_grid = ttk.Frame(main_frame)
        app_grid.pack(expand=True)
        
        apps = [
            ("OneTail Local Chatapp", "OneTail_Local_Chatapp.py", "A lightweight, local chat interface."),
            ("Orochimaru Local RAG", "Orochimaru_Local_Research_Assistent.py", "Analyze documents securely on your machine."),
            ("Visualize AI", "Visualize_AI.py", "Visualize the inner workings of AI models.")
        ]

        for i, (name, script, desc) in enumerate(apps):
            self.create_app_button(app_grid, name, script, desc).grid(row=i, column=0, pady=15, sticky="ew")

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

    def launch_script(self, script_name):
        try:
            # Assumes scripts are in the same directory
            script_path = os.path.join(os.path.dirname(__file__), script_name)
            if os.path.exists(script_path):
                print(f"Launching {script_name}...")
                subprocess.Popen([sys.executable, script_path])
            else:
                print(f"Error: Script not found at {script_path}")
                tk.messagebox.showerror("Error", f"Could not find {script_name}")
        except Exception as e:
            print(f"Failed to launch {script_name}: {e}")
            tk.messagebox.showerror("Launch Error", f"An error occurred while launching the application: {e}")

if __name__ == "__main__":
    app = KusanagiApp()
    app.mainloop()