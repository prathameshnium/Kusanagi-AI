import tkinter as tk
from tkinter import scrolledtext, ttk, messagebox

# This is a placeholder/mockup based on the Orochimaru and OneTail apps.
# It demonstrates what a local version of the "Kakashi" web app would look like.

class Style:
    UI_FONT = ("Segoe UI", 11)
    CHAT_FONT = ("Segoe UI", 11)
    TITLE_FONT = ("Segoe UI", 18, "bold")
    BG_PRIMARY = "#193549"
    BG_SECONDARY = "#002240"
    BG_TERTIARY = "#25435A"
    FG_PRIMARY = "#FFFFFF"
    FG_SECONDARY = "#97B1C2"
    ACCENT = "#ffab40"
    ACCENT_FG = "#002240"

class KakashiApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Kakashi - Local RAG App")
        self.geometry("1000x700")
        self.configure(bg=Style.BG_PRIMARY)

        self.setup_styles()
        self.create_widgets()

    def setup_styles(self):
        s = ttk.Style(self)
        s.theme_use('clam')
        s.configure('.', background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY, font=Style.UI_FONT)
        s.configure('TFrame', background=Style.BG_PRIMARY)
        s.configure('Sidebar.TFrame', background=Style.BG_SECONDARY)
        s.configure('Sidebar.TLabel', background=Style.BG_SECONDARY, foreground=Style.FG_PRIMARY)
        s.configure('Accent.TButton', background=Style.ACCENT, foreground=Style.ACCENT_FG, font=(Style.UI_FONT[0], Style.UI_FONT[1], 'bold'))
        s.map('Accent.TButton', background=[('active', "#e69a38")])
        s.configure('TEntry', fieldbackground=Style.BG_TERTIARY, foreground=Style.FG_PRIMARY, insertcolor=Style.ACCENT, borderwidth=0, padding=10)

    def create_widgets(self):
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(1, weight=1)

        # --- Sidebar ---
        sidebar = ttk.Frame(self, width=280, style='Sidebar.TFrame')
        sidebar.grid(row=0, column=0, sticky="ns", padx=(5,0), pady=5)
        sidebar.pack_propagate(False)

        ttk.Label(sidebar, text="Kakashi", font=Style.TITLE_FONT, foreground=Style.ACCENT, style='Sidebar.TLabel').pack(pady=10, padx=15, anchor="w")
        ttk.Label(sidebar, text="Local RAG AI Assistant", style='Sidebar.TLabel', foreground=Style.FG_SECONDARY).pack(pady=(0, 15), padx=15, anchor="w")

        ttk.Button(sidebar, text="+ Upload New Document", style='Accent.TButton').pack(fill=tk.X, padx=15, pady=10, ipady=4)

        ttk.Label(sidebar, text="LOADED DOCUMENTS", style='Sidebar.TLabel', font=("Segoe UI", 9, "bold")).pack(padx=15, anchor="w", pady=(10,5))
        doc_list = tk.Listbox(sidebar, bg=Style.BG_TERTIARY, fg=Style.FG_PRIMARY, selectbackground=Style.ACCENT, highlightthickness=0, borderwidth=0)
        doc_list.insert(tk.END, "  History_of_Science_101.pdf")
        doc_list.insert(tk.END, "  Intro_to_Physics_Lab.pdf")
        doc_list.pack(fill=tk.BOTH, expand=True, padx=15, pady=5)
        doc_list.selection_set(0)

        # --- Main Content ---
        main_area = ttk.Frame(self)
        main_area.grid(row=0, column=1, sticky="nsew", padx=5, pady=5)
        main_area.grid_rowconfigure(0, weight=1)
        main_area.grid_columnconfigure(0, weight=1)

        chat_box = scrolledtext.ScrolledText(main_area, wrap=tk.WORD, state=tk.DISABLED, bg=Style.BG_PRIMARY, fg=Style.FG_PRIMARY, font=Style.CHAT_FONT, relief=tk.FLAT, padx=10, pady=10)
        chat_box.grid(row=0, column=0, sticky="nsew", padx=5)
        chat_box.tag_config("accent", foreground=Style.ACCENT, font=(Style.CHAT_FONT[0], Style.CHAT_FONT[1], "bold"))

        # Add initial message
        chat_box.config(state=tk.NORMAL)
        chat_box.insert(tk.END, "Kakashi: ", "accent")
        chat_box.insert(tk.END, "Document 'History_of_Science_101.pdf' is loaded. How can I help?\n\n")
        chat_box.config(state=tk.DISABLED)

        # Tool bar
        tool_bar = ttk.Frame(main_area, style='TFrame')
        tool_bar.grid(row=1, column=0, sticky="ew", padx=5, pady=5)
        ttk.Button(tool_bar, text="Summarize Doc").pack(side=tk.LEFT, padx=2)
        ttk.Button(tool_bar, text="Explain Concept").pack(side=tk.LEFT, padx=2)
        ttk.Button(tool_bar, text="Generate Questions").pack(side=tk.LEFT, padx=2)

        # Input frame
        input_frame = ttk.Frame(main_area)
        input_frame.grid(row=2, column=0, sticky="ew", padx=5, pady=5)
        input_frame.grid_columnconfigure(0, weight=1)

        entry_box = ttk.Entry(input_frame, style='TEntry', font=("Segoe UI", 12))
        entry_box.grid(row=0, column=0, sticky="ew", ipady=8)
        entry_box.insert(0, "Ask a question or request a review...")

        send_button = ttk.Button(input_frame, text="➤", style='Accent.TButton', command=lambda: messagebox.showinfo("Info", "This is a UI mockup."))
        send_button.grid(row=0, column=1, padx=(10, 0), ipady=5)

if __name__ == "__main__":
    app = KakashiApp()
    app.mainloop()
