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

# --- UI Constants ---
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

# --- Global Variables ---
update_queue = queue.Queue()
last_job_id = 0
after_id = None # To store the ID of the scheduled 'after' job
selected_model = None # Will be a tk.StringVar
model_frame = None # To hold the frame for model radio buttons
prediction_list = None


# --- Ollama & System Config ---
config = {}
ollama_client = None
ollama_process = None

def _load_config():
    """Loads System_Config.json, applies defaults, and resolves paths."""
    global config
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "System_Config.json")
    
    default_config = {
        "ollama_path": "Portable_AI_Assets/ollama_main/ollama.exe",
        "model_folder": "Portable_AI_Assets/common-ollama-models",
        "embedding_model_name": "mxbai-embed-large",
        "default_model": "tinyllama:latest"
    }
    
    config_to_use = default_config.copy()

    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                loaded_config = json.load(f)
                config_to_use.update(loaded_config)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: Could not read {config_path}. Using defaults. Error: {e}")
            pass

    # Resolve paths to be absolute
    for path_key in ["ollama_path", "model_folder"]:
        if path_key in config_to_use and not os.path.isabs(config_to_use[path_key]):
            config_to_use[path_key] = os.path.join(script_dir, config_to_use[path_key])
            
    config = config_to_use
    print(f"Info: Using configuration: {config}")

def _save_config(config):
    """Saves the current configuration to System_Config.json."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "System_Config.json")
    try:
        with open(config_path, 'w') as f:
            json.dump(config, f, indent=4)
        print(f"Info: Configuration saved to {config_path}")
    except IOError as e:
        print(f"Warning: Could not save configuration to {config_path}. Error: {e}")

def _start_ollama_server(ollama_path, model_folder):
    """Starts the Ollama server as a detached subprocess."""
    print(f"Attempting to start Ollama server from: {ollama_path}")
    env = os.environ.copy()
    if model_folder and os.path.exists(model_folder):
        env["OLLAMA_MODELS"] = model_folder
        print(f"Setting OLLAMA_MODELS environment variable to: {model_folder}")

    log_dir = "logs"
    os.makedirs(log_dir, exist_ok=True)
    ollama_log_path = os.path.join(log_dir, "ollama_visualizer.log")
    print(f"Redirecting Ollama server output to: {ollama_log_path}")
    log_file = open(ollama_log_path, "a", encoding="utf-8")

    process = subprocess.Popen(
        [ollama_path, "serve"],
        env=env,
        stdout=log_file,
        stderr=log_file,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    )
    return process

def _stop_ollama_server():
    """Stops the managed Ollama server process if it's running."""
    global ollama_process
    if ollama_process and ollama_process.poll() is None:
        print("Stopping managed Ollama server...")
        try:
            ollama_process.terminate()
            ollama_process.wait(timeout=5)
            print("Ollama server stopped.")
        except Exception as e:
            print(f"Error stopping ollama server: {e}")

def initialize_ollama():
    """
    Initializes connection to Ollama. Checks for a running instance,
    and if not found, attempts to start one using the path from System_Config.json.
    """
    global ollama_client, ollama_process, config
    
    _load_config()
    
    ollama_path = config.get("ollama_path")
    model_folder = config.get("model_folder")

    # First, try to connect to an existing server with a short timeout
    try:
        print("Checking for existing Ollama server...")
        temp_client = ollama.Client(host='127.0.0.1', timeout=3)
        temp_client.list()
        print("Connected to an existing Ollama server.")
        ollama_client = ollama.Client(host='127.0.0.1', timeout=60) # Use a longer timeout for operations
        return
    except Exception:
        print("No existing Ollama server found. Attempting to start a local one.")

    # If connection fails, try to start our own server
    if ollama_path and os.path.exists(ollama_path):
        try:
            ollama_process = _start_ollama_server(ollama_path, model_folder)
            ollama_client = ollama.Client(host='127.0.0.1', timeout=60)
            
            print("Waiting for local Ollama server to become responsive...")
            max_wait_time = 45
            start_wait_time = time.time()
            server_ready = False
            while time.time() - start_wait_time < max_wait_time:
                try:
                    ollama_client.list()
                    server_ready = True
                    print("Local Ollama server is responsive.")
                    break
                except Exception:
                    wait_time = int(time.time() - start_wait_time)
                    status_label.config(text=f"Starting...({wait_time}s)", fg=Style.ACCENT)
                    root.update() # Force UI update
                    time.sleep(1)
            
            if not server_ready:
                messagebox.showerror("Ollama Start Error", f"Local Ollama server did not respond within {max_wait_time} seconds.")
                ollama_client = None
        except Exception as e:
            messagebox.showerror("Ollama Start Error", f"Failed to start local Ollama server: {e}")
            ollama_client = None
    else:
        ollama_client = None
        messagebox.showwarning("Ollama Not Found", "Could not find a running Ollama instance or start a local one. Please configure 'ollama_path' in System_Config.json.")
    
    print(f"Debug: Ollama client initialized: {ollama_client is not None}")

def get_next_word_predictions(prompt, temperature, num_predictions=5):
    """
    Generates multiple next-word predictions using a single Ollama API call.
    """
    global ollama_client
    
    if not selected_model:
        print("Debug: Prediction skipped, selected_model is None.")
        return {}
        
    model_name = selected_model.get()
    # Log only the last 100 characters of the prompt to avoid spamming logs.
    print(f"Debug: Attempting prediction with model '{model_name}' and prompt: '...{prompt[-100:]}'")
    
    predictions = {}
    if not prompt.strip() or not ollama_client:
        return {}

    if not model_name or "No models" in model_name or "Error" in model_name:
        print(f"Debug: Prediction skipped, invalid model name: '{model_name}'")
        return {"Error": -1}

    try:
        # Make a single API call to generate a longer sequence of text
        response = ollama_client.generate(
            model=model_name,
            prompt=prompt,
            stream=False,
            options={
                'temperature': temperature,
                'num_predict': 50,  # Predict more tokens to get a good sample of next words
                'top_k': 40,        # Consider top_k tokens for sampling
                'top_p': 0.9,       # Use nucleus sampling
            }
        )
        
        generated_text = response['response'].strip()
        
        # Split the generated text into words and count occurrences
        words = generated_text.split()
        
        # Consider only the first few words as potential "next words"
        # This is a heuristic; a more sophisticated approach might involve
        # analyzing token probabilities directly if the API exposed them.
        for i, word in enumerate(words[:num_predictions * 2]): # Look at a few more words than requested
            # Clean up word (remove punctuation, convert to lowercase for consistency)
            cleaned_word = word.strip('.,!?;:"\'').lower()
            if cleaned_word:
                predictions[cleaned_word] = predictions.get(cleaned_word, 0) + 1

    except Exception as e:
        print(f"Error calling Ollama: {e}")
        return {"Error": -1}

    if not predictions:
        return {}

    total_counts = sum(predictions.values())
    if total_counts == 0:
        return {}
        
    probabilities = {word: count / total_counts for word, count in predictions.items()}
    # Sort by probability and return the top N predictions.
    sorted_predictions = dict(sorted(probabilities.items(), key=lambda item: item[1], reverse=True)[:num_predictions])
    return sorted_predictions

def prediction_worker():
    """A worker thread to call the Ollama API without freezing the UI."""
    global last_job_id
    while True:
        job_id, text, temp = update_queue.get()
        if job_id < last_job_id:
            update_queue.task_done()
            continue
        
        predictions = get_next_word_predictions(text, temp)
        root.after(0, update_prediction_list, predictions)
        update_queue.task_done()

def on_text_changed(event=None):
    """Schedules a prediction update when the user types."""
    global after_id
    if after_id:
        root.after_cancel(after_id)
    after_id = root.after(250, perform_prediction)

def perform_prediction():
    """Queues the API call to be run in the background worker."""
    global last_job_id
    last_job_id += 1
    text = text_input.get("1.0", "end-1c")

    if not selected_model or "No models" in selected_model.get() or "Error" in selected_model.get():
        return

    temp = temperature_slider.get()
    update_queue.put((last_job_id, text, temp))

def update_prediction_list(predictions):
    """Clears and repopulates the prediction listbox on the UI thread."""
    prediction_list.delete(0, tk.END)
    if not predictions:
        prediction_list.insert(tk.END, "  Type to get suggestions...")
        return

    if "Error" in predictions:
        prediction_list.insert(tk.END, "  Error connecting to Ollama.")
        return

    for word, prob in predictions.items():
        bar_length = 20
        filled_length = int(bar_length * (prob if prob > 0 else 0))
        bar = '█' * filled_length + '─' * (bar_length - filled_length)
        prediction_list.insert(tk.END, f"  {word:<15} {bar} {prob:.0%}")

def on_suggestion_click(event):
    """Appends the selected suggestion to the input text."""
    selected_indices = prediction_list.curselection()
    if not selected_indices:
        return

    selected_text = prediction_list.get(selected_indices[0])
    word = selected_text.strip().split(' ')[0]

    text_input.insert(tk.END, word + " ")
    text_input.focus()
    text_input.mark_set("insert", tk.END)

def populate_models():
    """Fetches local models from the initialized Ollama client."""
    global selected_model, ollama_client, model_frame
    print("Debug: Entered populate_models")

    if not ollama_client:
        print("Debug: populate_models - ollama_client is None, exiting.")
        status_light.config(foreground=Style.ERROR)  # Red
        status_label.config(text="Ollama Not Found", fg=Style.ERROR)
        error_message = "Ollama not found"
        # Use a placeholder for selected_model to avoid crashes
        if not selected_model:
            selected_model = tk.StringVar(value=error_message)
        else:
            selected_model.set(error_message)
        
        # Avoid adding multiple error labels
        if not any(isinstance(w, ttk.Label) and "Ollama not found" in w.cget("text") for w in sidebar_frame.winfo_children()):
            error_label = ttk.Label(sidebar_frame, text=error_message, foreground=Style.ERROR, background=Style.BG_PRIMARY)
            error_label.pack(fill=tk.X, pady=(5, 10))
        return

    try:
        print("Debug: populate_models - trying to fetch models.")
        status_label.config(text="Fetching models...", fg=Style.FG_SECONDARY)
        root.update()

        response_data = ollama_client.list()
        print(f"Info: Models returned from Ollama: {response_data}")
        print(f"Debug: Type of response_data: {type(response_data)}")

        models_list = []
        # The ollama-python library can return a pydantic object or a dict.
        # A pydantic object will have a .models attribute.
        if hasattr(response_data, 'models'):
            print("Debug: Response has a .models attribute, using that.")
            models_list = response_data.models
        # A dictionary will have a 'models' key.
        elif isinstance(response_data, dict):
            print("Debug: Response is a dict, using .get('models').")
            models_list = response_data.get('models', [])
        else:
            print("Warning: Could not extract models from response. The format is not recognized.")

        print(f"Debug: Found {len(models_list)} models in the list.")
        
        model_names = []
        if models_list:
            first_model = models_list[0]
            # If the items in the list are dicts (older library versions)
            if isinstance(first_model, dict):
                print("Debug: Parsing models as dictionaries.")
                model_names = [m.get('name') for m in models_list if m.get('name')]
            # If they are objects (pydantic models in newer versions)
            elif hasattr(first_model, 'model'):
                print("Debug: Parsing models as objects with .model attribute.")
                model_names = [m.model for m in models_list]
            elif hasattr(first_model, 'name'):
                print("Debug: Parsing models as objects with .name attribute.")
                model_names = [m.name for m in models_list]
        
        if not model_names:
            model_names = ["No models found"]
        
        print(f"Debug: Parsed model names: {model_names}")

        default_model = ""
        config_default = config.get("default_model")
        
        # Try to find the exact default model from config
        if config_default in model_names:
            default_model = config_default
        # Fallback: try to find a model from the same family (e.g., 'tinyllama' in 'tinyllama:chat')
        elif config_default:
            base_model_name = config_default.split(':')[0]
            for name in model_names:
                if name.startswith(base_model_name):
                    default_model = name
                    print(f"Info: Config model '{config_default}' not found, but found a matching family model: '{name}'")
                    break
        
        # If still no model, pick the first one available that is not an embedding model
        if not default_model:
            for name in model_names:
                if "embed" not in name and "No models" not in name:
                    default_model = name
                    break
        
        # If still nothing, just pick the first in the list
        if not default_model and model_names:
            default_model = model_names[0]

        print(f"Info: Default model selected: '{default_model}'")
        
        # Initialize or set the StringVar
        if not selected_model:
            selected_model = tk.StringVar(value=default_model)
        else:
            selected_model.set(default_model)
            
        print(f"Debug: selected_model is now a StringVar with value: '{selected_model.get()}'")

        # Clear previous model radio buttons if they exist
        if model_frame:
            model_frame.destroy()

        model_frame = tk.Frame(sidebar_frame, bg=Style.BG_PRIMARY)
        model_frame.pack(fill=tk.X, pady=(5, 10))

        for name in model_names:
            rb = ttk.Radiobutton(model_frame, text=name, variable=selected_model, value=name, style='Sidebar.TRadiobutton', command=on_text_changed)
            rb.pack(fill=tk.X, anchor='w')
        
        status_light.config(foreground=Style.ACCENT)  # Green
        status_label.config(text="Ready", fg=Style.ACCENT)
        print("Debug: populate_models finished successfully.")

    except Exception as e:
        import traceback
        print(f"ERROR: Connection failed during model population: {e}")
        traceback.print_exc()
        status_light.config(foreground=Style.ERROR)
        status_label.config(text="Connection Failed", fg=Style.ERROR)
        error_message = "Connection Failed"
        if not selected_model:
            selected_model = tk.StringVar(value=error_message)
        else:
            selected_model.set(error_message)
        
        if not any(isinstance(w, ttk.Label) and "Connection Failed" in w.cget("text") for w in sidebar_frame.winfo_children()):
            error_label = ttk.Label(sidebar_frame, text=error_message, foreground=Style.ERROR, background=Style.BG_PRIMARY)
            error_label.pack(fill=tk.X, pady=(5, 10))
        print("Debug: populate_models finished with an exception.")

def on_closing():
    """Handles window close event."""
    _stop_ollama_server()
    root.destroy()

# --- UI Setup ---
root = tk.Tk()
root.title("Next Word Prediction Visualizer")
root.geometry("600x450")
root.configure(bg=Style.BG_PRIMARY)
root.protocol("WM_DELETE_WINDOW", on_closing) # Handle window closing

# --- Style ---
style = ttk.Style(root)
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

# --- Main Frame ---
main_frame = ttk.Frame(root, padding="10")
main_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

# --- Right Sidebar for Controls ---
sidebar_frame = ttk.Frame(root, padding="10", width=180, style='TFrame')
sidebar_frame.pack(side=tk.RIGHT, fill=tk.Y)
sidebar_frame.pack_propagate(False)

# --- Connection Status Indicator ---
status_frame = ttk.Frame(sidebar_frame, style='TFrame')
status_frame.pack(fill=tk.X, pady=5, anchor='n')
status_light = ttk.Label(status_frame, text="●", font=("Segoe UI", 12), style='TLabel')
status_light.pack(side=tk.LEFT)
status_label = ttk.Label(status_frame, text="Initializing...", font=Style.UI_FONT, style='TLabel', foreground=Style.FG_SECONDARY)
status_label.pack(side=tk.LEFT, padx=5)

# --- Input Text Area ---
text_input = tk.Text(main_frame, height=8, wrap=tk.WORD, bg=Style.BG_TERTIARY, fg=Style.FG_PRIMARY,
                     insertbackground=Style.ACCENT, selectbackground=Style.ACCENT,
                     borderwidth=0, highlightthickness=0, font=(Style.UI_FONT[0], 13))
text_input.pack(fill=tk.X, pady=(0, 10), padx=5)
text_input.config(padx=10, pady=10)
text_input.bind("<KeyRelease>", on_text_changed)

# --- Temperature Slider ---
ttk.Label(sidebar_frame, text="Temperature", font=(Style.UI_FONT[0], 12, "bold"), style='TLabel').pack(anchor='center', pady=(0, 5))
temperature_slider = ttk.Scale(sidebar_frame, from_=2.0, to=0.0, orient=tk.VERTICAL,
                               command=on_text_changed, length=200)
temperature_slider.set(0.7)
temperature_slider.pack(anchor='center', pady=10)

# --- Model Selection ---
ttk.Label(sidebar_frame, text="Model", font=(Style.UI_FONT[0], 12, "bold"), style='TLabel').pack(anchor='center', pady=(20, 5))

# --- Prediction Listbox ---
ttk.Label(main_frame, text="Next Word Suggestions:", font=(Style.UI_FONT[0], 12, "bold"), style='TLabel').pack(anchor='w', pady=(10, 5))
prediction_list = tk.Listbox(main_frame, bg=Style.BG_TERTIARY, fg=Style.FG_PRIMARY,
                             borderwidth=0, highlightthickness=0,
                             font=(Style.CHAT_FONT[0], 12), selectbackground=Style.ACCENT,
                             selectforeground=Style.BG_TERTIARY,
                             exportselection=False)
prediction_list.pack(fill=tk.BOTH, expand=True)
prediction_list.insert(tk.END, "  Initializing...")
prediction_list.bind("<Double-1>", on_suggestion_click)

# --- Start the background worker thread ---
threading.Thread(target=prediction_worker, daemon=True).start()

# --- Initialize Ollama and Populate Models ---
initialize_ollama()
populate_models()

# --- Update UI based on initialization status ---
if not ollama_client:
    prediction_list.delete(0, tk.END)
    prediction_list.insert(tk.END, "  Ollama connection failed.")
elif selected_model and "No models" in selected_model.get():
    prediction_list.delete(0, tk.END)
    prediction_list.insert(tk.END, "  No Ollama models found.")
    status_label.config(text="No Models", fg=Style.FG_SECONDARY)
elif selected_model and "Error" in selected_model.get():
    prediction_list.delete(0, tk.END)
    prediction_list.insert(tk.END, "  Error during model setup.")
else:
    prediction_list.delete(0, tk.END)
    prediction_list.insert(tk.END, "  Type to get suggestions...")


# --- Run the app ---
root.mainloop()
