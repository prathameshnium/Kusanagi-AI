import tkinter as tk
from tkinter import ttk, messagebox
from tkinter.font import Font
import ollama
import threading
import queue
import time
import json
import os
import subprocess
import sys

# --- UI Constants ---
class Style:
    UI_FONT = ("Segoe UI", 11)
    # ... (rest of Style class is unchanged)

# --- Project Root ---
def get_project_root():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        return os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

PROJECT_ROOT = get_project_root()

class VisualizeApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Next Word Prediction Visualizer")
        self.geometry("600x450")

        # --- Instance Variables ---
        self.app_config = {}
        self.ollama_client = None
        self.ollama_process = None
        self.update_queue = queue.Queue()
        self.last_job_id = 0
        self.after_id = None
        self.selected_model = tk.StringVar()
        self.model_frame = None
        self.prediction_list = None
        
        self.protocol("WM_DELETE_WINDOW", self.on_closing)

        # --- Initialization ---
        self._load_config()
        self.setup_styles()
        self.create_widgets()
        self.initialize_ollama()
        
        threading.Thread(target=self.prediction_worker, daemon=True).start()

    def setup_styles(self):
        style = ttk.Style(self)
        style.theme_use('clam')
        style.configure('.', font=Style.UI_FONT, background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY)
        style.configure('TFrame', background=Style.BG_PRIMARY)
        style.configure('TLabel', background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY)
        style.map('TScale', background=[('!focus', Style.BG_PRIMARY)])
        style.configure('TMenubutton', 
                        background=Style.BG_PRIMARY, foreground=Style.FG_PRIMARY, 
                        borderwidth=0, arrowcolor=Style.FG_PRIMARY)
        style.configure('Sidebar.TRadiobutton',
                        background=Style.BG_PRIMARY,
                        foreground=Style.FG_PRIMARY,
                        indicatorcolor=Style.BG_PRIMARY,
                        bordercolor=Style.BG_PRIMARY)
        style.map('Sidebar.TRadiobutton',
                  background=[('active', Style.BG_SECONDARY)],
                  indicatorcolor=[('selected', Style.ACCENT), ('!selected', Style.FG_PRIMARY)])

    def create_widgets(self):
        self.configure(bg=Style.BG_PRIMARY)
        
        main_frame = ttk.Frame(self, padding="10")
        main_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.sidebar_frame = ttk.Frame(self, padding="10", width=180, style='TFrame')
        self.sidebar_frame.pack(side=tk.RIGHT, fill=tk.Y)
        self.sidebar_frame.pack_propagate(False)

        status_frame = ttk.Frame(self.sidebar_frame, style='TFrame')
        status_frame.pack(fill=tk.X, pady=5, anchor='n')
        self.status_light = ttk.Label(status_frame, text="●", font=("Segoe UI", 12))
        self.status_light.pack(side=tk.LEFT)
        self.status_label = ttk.Label(status_frame, text="Initializing...", font=Style.UI_FONT, foreground=Style.FG_SECONDARY)
        self.status_label.pack(side=tk.LEFT, padx=5)

        self.text_input = tk.Text(main_frame, height=8, wrap=tk.WORD, bg=Style.BG_TERTIARY, fg=Style.FG_PRIMARY,
                             insertbackground=Style.ACCENT, selectbackground=Style.ACCENT,
                             borderwidth=0, highlightthickness=0, font=(Style.UI_FONT[0], 13))
        self.text_input.pack(fill=tk.X, pady=(0, 10), padx=5)
        self.text_input.config(padx=10, pady=10)
        self.text_input.bind("<KeyRelease>", self.on_text_changed)

        ttk.Label(self.sidebar_frame, text="Temperature", font=(Style.UI_FONT[0], 12, "bold")).pack(anchor='center', pady=(0, 5))
        self.temperature_slider = ttk.Scale(self.sidebar_frame, from_=2.0, to=0.0, orient=tk.VERTICAL,
                                       command=self.on_text_changed, length=200)
        self.temperature_slider.set(0.7)
        self.temperature_slider.pack(anchor='center', pady=10)

        ttk.Label(self.sidebar_frame, text="Model", font=(Style.UI_FONT[0], 12, "bold")).pack(anchor='center', pady=(20, 5))

        ttk.Label(main_frame, text="Next Word Suggestions:", font=(Style.UI_FONT[0], 12, "bold")).pack(anchor='w', pady=(10, 5))
        self.prediction_list = tk.Listbox(main_frame, bg=Style.BG_TERTIARY, fg=Style.FG_PRIMARY,
                                     borderwidth=0, highlightthickness=0,
                                     font=(Style.CHAT_FONT[0], 12), selectbackground=Style.ACCENT,
                                     selectforeground=Style.BG_TERTIARY,
                                     exportselection=False)
        self.prediction_list.pack(fill=tk.BOTH, expand=True)
        self.prediction_list.insert(tk.END, "  Initializing...")
        self.prediction_list.bind("<Double-1>", self.on_suggestion_click)

    def _load_config(self):
        config_path = os.path.join(PROJECT_ROOT, "System_Config.json")
        default_config = {
            "ollama_path": os.path.join("Portable_AI_Assets", "ollama_main", "ollama.exe"),
            "model_folder": os.path.join("Portable_AI_Assets", "models"),
            "vector_cache_dir": os.path.join("Portable_AI_Assets", "vector_cache"),
            "embedding_model_name": "mxbai-embed-large",
            "default_model": "tinyllama:latest"
        }
        
        config_from_file = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config_from_file = json.load(f)
            except (json.JSONDecodeError, IOError):
                pass

        final_config = default_config.copy()
        final_config.update(config_from_file)

        for key in ["ollama_path", "model_folder", "vector_cache_dir"]:
            path_value = final_config.get(key, "")
            if not os.path.isabs(path_value):
                absolute_path = os.path.normpath(os.path.join(PROJECT_ROOT, path_value))
            else:
                absolute_path = os.path.normpath(path_value)
            
            if not os.path.exists(absolute_path) and key != "vector_cache_dir":
                default_relative_path = default_config[key]
                absolute_path = os.path.normpath(os.path.join(PROJECT_ROOT, default_relative_path))
            
            final_config[key] = absolute_path
        
        self.app_config = final_config
        print(f"Info: Using configuration: {self.app_config}")

    def _start_ollama_server(self, ollama_path, model_folder):
        env = os.environ.copy()
        if model_folder and os.path.exists(model_folder):
            env["OLLAMA_MODELS"] = model_folder
        
        log_dir = os.path.join(PROJECT_ROOT, "logs")
        os.makedirs(log_dir, exist_ok=True)
        log_file = open(os.path.join(log_dir, "ollama_visualizer.log"), "a", encoding="utf-8")

        process = subprocess.Popen(
            [ollama_path, "serve"], env=env, stdout=log_file, stderr=log_file,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        )
        return process

    def _stop_ollama_server(self):
        if self.ollama_process and self.ollama_process.poll() is None:
            self.ollama_process.terminate()
            try:
                self.ollama_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.ollama_process.kill()

    def initialize_ollama(self):
        ollama_path = self.app_config.get("ollama_path")
        model_folder = self.app_config.get("model_folder")

        try:
            self.ollama_client = ollama.Client(host='127.0.0.1', timeout=3)
            self.ollama_client.list()
            self.after(100, self.populate_models)
            return
        except Exception:
            pass

        if ollama_path and os.path.exists(ollama_path):
            self.ollama_process = self._start_ollama_server(ollama_path, model_folder)
            self.ollama_client = ollama.Client(host='127.0.0.1', timeout=60)
            self.after(100, lambda: self._check_server_readiness(time.time(), 45))
        else:
            self.ollama_client = None
            messagebox.showwarning("Ollama Not Found", "Could not find or start Ollama.")

    def _check_server_readiness(self, start_time, max_wait):
        if time.time() - start_time > max_wait:
            messagebox.showerror("Ollama Start Error", "Local server did not respond in time.")
            return

        try:
            self.ollama_client.list()
            self.after(100, self.populate_models)
        except Exception:
            wait_time = int(time.time() - start_time)
            self.status_label.config(text=f"Starting...({wait_time}s)", foreground=Style.ACCENT)
            self.after(1000, lambda: self._check_server_readiness(start_time, max_wait))

    def get_next_word_predictions(self, prompt, temperature, num_predictions=5):
        # ... (implementation remains the same, just change global access to self)
        if not self.selected_model: return {}
        model_name = self.selected_model.get()
        if not prompt.strip() or not self.ollama_client or "No models" in model_name or "Error" in model_name:
            return {"Error": -1}
        try:
            response = self.ollama_client.generate(
                model=model_name, prompt=prompt, stream=False,
                options={'temperature': temperature, 'num_predict': 50, 'top_k': 40, 'top_p': 0.9}
            )
            words = response['response'].strip().split()
            predictions = {}
            for word in words[:num_predictions * 2]:
                cleaned_word = word.strip('.,!?;:"\'').lower()
                if cleaned_word:
                    predictions[cleaned_word] = predictions.get(cleaned_word, 0) + 1
            
            total_counts = sum(predictions.values())
            if total_counts == 0: return {}
            
            probabilities = {word: count / total_counts for word, count in predictions.items()}
            return dict(sorted(probabilities.items(), key=lambda item: item[1], reverse=True)[:num_predictions])
        except Exception as e:
            print(f"Error calling Ollama: {e}")
            return {"Error": -1}

    def prediction_worker(self):
        while True:
            job_id, text, temp = self.update_queue.get()
            if job_id < self.last_job_id:
                self.update_queue.task_done()
                continue
            
            predictions = self.get_next_word_predictions(text, temp)
            self.after(0, self.update_prediction_list, predictions)
            self.update_queue.task_done()

    def on_text_changed(self, event=None):
        if self.after_id:
            self.after_cancel(self.after_id)
        self.after_id = self.after(250, self.perform_prediction)

    def perform_prediction(self):
        self.last_job_id += 1
        text = self.text_input.get("1.0", "end-1c")
        if not self.selected_model or "No models" in self.selected_model.get() or "Error" in self.selected_model.get():
            return
        temp = self.temperature_slider.get()
        self.update_queue.put((self.last_job_id, text, temp))

    def update_prediction_list(self, predictions):
        self.prediction_list.delete(0, tk.END)
        if not predictions:
            self.prediction_list.insert(tk.END, "  Type to get suggestions...")
            return
        if "Error" in predictions:
            self.prediction_list.insert(tk.END, "  Error connecting to Ollama.")
            return
        for word, prob in predictions.items():
            bar = '█' * int(20 * (prob if prob > 0 else 0)) + '─' * (20 - int(20 * (prob if prob > 0 else 0)))
            self.prediction_list.insert(tk.END, f"  {word:<15} {bar} {prob:.0%}")

    def on_suggestion_click(self, event):
        selected_indices = self.prediction_list.curselection()
        if not selected_indices: return
        word = self.prediction_list.get(selected_indices[0]).strip().split(' ')[0]
        self.text_input.insert(tk.END, word + " ")
        self.text_input.focus()
        self.text_input.mark_set("insert", tk.END)

    def populate_models(self):
        if not self.ollama_client:
            self.status_light.config(foreground=Style.ERROR)
            self.status_label.config(text="Ollama Not Found", foreground=Style.ERROR)
            return

        try:
            self.status_label.config(text="Fetching models...", foreground=Style.FG_SECONDARY)
            self.update()

            response_data = self.ollama_client.list()
            models_list = response_data.get('models', [])
            model_names = sorted([m['model'] for m in models_list]) or ["No models found"]

            default_model = self.app_config.get("default_model")
            if default_model not in model_names:
                default_model = next((name for name in model_names if "embed" not in name and "No models" not in name), model_names[0])
            
            self.selected_model.set(default_model)

            if self.model_frame: self.model_frame.destroy()
            self.model_frame = tk.Frame(self.sidebar_frame, bg=Style.BG_PRIMARY)
            self.model_frame.pack(fill=tk.X, pady=(5, 10))

            for name in model_names:
                rb = ttk.Radiobutton(self.model_frame, text=name, variable=self.selected_model, value=name, style='Sidebar.TRadiobutton', command=self.on_text_changed)
                rb.pack(fill=tk.X, anchor='w')
            
            self.status_light.config(foreground=Style.ACCENT)
            self.status_label.config(text="Ready", foreground=Style.ACCENT)

        except Exception as e:
            self.status_light.config(foreground=Style.ERROR)
            self.status_label.config(text="Connection Failed", foreground=Style.ERROR)
            self.selected_model.set("Connection Failed")

    def on_closing(self):
        self._stop_ollama_server()
        self.destroy()

if __name__ == "__main__":
    app = VisualizeApp()
    app.mainloop()
