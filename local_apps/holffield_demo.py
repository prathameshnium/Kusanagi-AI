import tkinter as tk
import numpy as np
import math
import random
from datetime import datetime

class HopfieldDemo:
    def __init__(self, root):
        self.root = root
        self.root.title("Visual Hopfield Network: Python Edition")
        self.root.configure(bg="#002240")

        # --- CONFIG ---
        self.N_SIDE = 5
        self.N = self.N_SIDE * self.N_SIDE
        self.GRID_CANVAS_SIZE = 200
        self.NET_CANVAS_SIZE = 400
        
        # --- STATE ---
        self.neurons = np.full(self.N, -1)
        self.weights = np.zeros((self.N, self.N))
        self.stored_patterns = 0
        
        # --- UI COLORS ---
        self.colors = {
            "bg_primary": "#193549",
            "bg_secondary": "#002240",
            "bg_tertiary": "#25435A",
            "fg_primary": "#FFFFFF",
            "fg_secondary": "#97B1C2",
            "accent": "#ffab40",
            "error": "#FF628C",
            "log": "#F1FA8C",
            "dot_excite": "#2ecc71",
            "dot_inhibit": "#e74c3c"
        }

        self.setup_ui()
        self.calculate_node_positions()
        self.draw_grid()
        self.draw_network()
        self.log_message("Hopfield network initialized.")

    def setup_ui(self):
        # Header
        header = tk.Label(self.root, text="VISUAL HOPFIELD NET", font=("Segoe UI", 18, "bold"), 
                         fg=self.colors["accent"], bg=self.colors["bg_secondary"])
        header.pack(pady=(10, 0))
        
        subtitle = tk.Label(self.root, text="5x5 Grid (25 Neurons) | Fully Connected Graph", 
                           font=("Segoe UI", 9), fg=self.colors["fg_secondary"], bg=self.colors["bg_secondary"])
        subtitle.pack(pady=(0, 20))

        # Main Container
        main_frame = tk.Frame(self.root, bg=self.colors["bg_secondary"])
        main_frame.pack(padx=20, pady=10)

        # Input Grid Panel
        grid_panel = tk.Frame(main_frame, bg=self.colors["bg_primary"], padx=15, pady=15, highlightbackground=self.colors["bg_tertiary"], highlightthickness=1)
        grid_panel.grid(row=0, column=0, padx=10, sticky="n")
        tk.Label(grid_panel, text="INPUT GRID", fg="white", bg=self.colors["bg_primary"], font=("Segoe UI", 10, "bold")).pack()
        self.grid_canvas = tk.Canvas(grid_panel, width=self.GRID_CANVAS_SIZE, height=self.GRID_CANVAS_SIZE, bg="black", highlightthickness=0)
        self.grid_canvas.pack(pady=10)
        self.grid_canvas.bind("<Button-1>", self.on_grid_click)
        tk.Label(grid_panel, text="Click to toggle pixels", fg=self.colors["fg_secondary"], bg=self.colors["bg_primary"], font=("Segoe UI", 8)).pack()

        # Network View Panel
        net_panel = tk.Frame(main_frame, bg=self.colors["bg_primary"], padx=15, pady=15, highlightbackground=self.colors["bg_tertiary"], highlightthickness=1)
        net_panel.grid(row=0, column=1, padx=10, sticky="n")
        tk.Label(net_panel, text="NEURAL NETWORK VIEW", fg="white", bg=self.colors["bg_primary"], font=("Segoe UI", 10, "bold")).pack()
        self.net_canvas = tk.Canvas(net_panel, width=self.NET_CANVAS_SIZE, height=self.NET_CANVAS_SIZE, bg="black", highlightthickness=0)
        self.net_canvas.pack(pady=10)
        
        legend_frame = tk.Frame(net_panel, bg=self.colors["bg_primary"])
        legend_frame.pack()
        for text, color in [("Excitation (+)", self.colors["dot_excite"]), ("Inhibition (-)", self.colors["dot_inhibit"])]:
            lbl = tk.Label(legend_frame, text=f"● {text}", fg=color, bg=self.colors["bg_primary"], font=("Segoe UI", 8))
            lbl.pack(side="left", padx=5)

        # Controls Panel
        ctrl_panel = tk.Frame(main_frame, bg=self.colors["bg_primary"], padx=15, pady=15, width=200, highlightbackground=self.colors["bg_tertiary"], highlightthickness=1)
        ctrl_panel.grid(row=0, column=2, padx=10, sticky="n")
        ctrl_panel.grid_propagate(False)

        btn_style = {"font": ("Segoe UI", 8, "bold"), "pady": 8, "cursor": "hand2"}
        self.btn_learn = tk.Button(ctrl_panel, text="1. LEARN PATTERN", bg=self.colors["accent"], command=self.learn, **btn_style)
        self.btn_learn.pack(fill="x", pady=2)
        
        self.btn_forget = tk.Button(ctrl_panel, text="2. FORGET PATTERN", bg=self.colors["accent"], command=self.forget, **btn_style)
        self.btn_forget.pack(fill="x", pady=2)
        
        self.btn_clear = tk.Button(ctrl_panel, text="3. CLEAR GRID", bg=self.colors["error"], fg="white", command=self.clear_grid, **btn_style)
        self.btn_clear.pack(fill="x", pady=2)
        
        tk.Frame(ctrl_panel, height=1, bg=self.colors["bg_tertiary"]).pack(fill="x", pady=10)
        
        self.btn_noise = tk.Button(ctrl_panel, text="4. ADD NOISE", bg=self.colors["fg_secondary"], command=self.add_noise, **btn_style)
        self.btn_noise.pack(fill="x", pady=2)
        
        self.btn_run = tk.Button(ctrl_panel, text="5. RUN", bg=self.colors["bg_tertiary"], fg="white", command=lambda: self.root.after(10, self.recover), **btn_style)
        self.btn_run.pack(fill="x", pady=2)

        # Stats
        self.energy_var = tk.StringVar(value="0.0")
        self.stable_var = tk.StringVar(value="Yes")
        self.pattern_var = tk.StringVar(value="0")
        
        stats_frame = tk.Frame(ctrl_panel, bg=self.colors["bg_primary"])
        stats_frame.pack(fill="x", pady=10)
        self.create_stat_row(stats_frame, "Energy:", self.energy_var)
        self.create_stat_row(stats_frame, "Stable:", self.stable_var)
        self.create_stat_row(stats_frame, "Patterns:", self.pattern_var)

        # Console Panel
        console_panel = tk.Frame(self.root, bg=self.colors["bg_primary"], highlightbackground=self.colors["bg_tertiary"], highlightthickness=1)
        console_panel.pack(fill="x", padx=30, pady=20)
        tk.Label(console_panel, text="EVENT LOG", bg=self.colors["bg_tertiary"], fg=self.colors["accent"], font=("Consolas", 9, "bold"), anchor="w", padx=10).pack(fill="x")
        self.console_text = tk.Text(console_panel, height=8, bg=self.colors["bg_primary"], fg=self.colors["log"], font=("Consolas", 8), borderwidth=0, padx=10, pady=5)
        self.console_text.pack(fill="x")

    def create_stat_row(self, parent, label, var):
        row = tk.Frame(parent, bg=self.colors["bg_primary"])
        row.pack(fill="x")
        tk.Label(row, text=label, fg=self.colors["fg_secondary"], bg=self.colors["bg_primary"], font=("Segoe UI", 8)).pack(side="left")
        tk.Label(row, textvariable=var, fg="white", bg=self.colors["bg_primary"], font=("Segoe UI", 8, "bold")).pack(side="right")

    def calculate_node_positions(self):
        self.node_positions = []
        center = self.NET_CANVAS_SIZE / 2
        radius = 160
        for i in range(self.N):
            angle = (i / self.N) * 2 * math.pi - math.pi/2
            x = center + radius * math.cos(angle)
            y = center + radius * math.sin(angle)
            self.node_positions.append((x, y))

    # --- LOGIC & DRAWING ---

    def log_message(self, msg):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.console_text.insert(tk.END, f"[{timestamp}] {msg}\n")
        self.console_text.see(tk.END)

    def draw_grid(self):
        self.grid_canvas.delete("all")
        cell_size = self.GRID_CANVAS_SIZE / self.N_SIDE
        for i in range(self.N):
            x = (i % self.N_SIDE) * cell_size
            y = (i // self.N_SIDE) * cell_size
            color = "white" if self.neurons[i] == 1 else "black"
            self.grid_canvas.create_rectangle(x, y, x+cell_size, y+cell_size, fill=color, outline="gray20")

    def draw_network(self):
        self.net_canvas.delete("all")
        # Connections
        for i in range(self.N):
            for j in range(i + 1, self.N):
                w = self.weights[i][j]
                if abs(w) > 0.1:
                    p1, p2 = self.node_positions[i], self.node_positions[j]
                    color = self.colors["dot_excite"] if w > 0 else self.colors["dot_inhibit"]
                    self.net_canvas.create_line(p1[0], p1[1], p2[0], p2[1], fill=color, width=min(abs(w)/2, 3))

        # Nodes
        for i, (x, y) in enumerate(self.node_positions):
            color = "white" if self.neurons[i] == 1 else "#333333"
            self.net_canvas.create_oval(x-8, y-8, x+8, y+8, fill=color, outline="white")
        
        self.update_energy()

    def update_energy(self):
        # E = -0.5 * sum(w_ij * s_i * s_j)
        e = -0.5 * np.dot(self.neurons, np.dot(self.weights, self.neurons))
        self.energy_var.set(f"{e:.1f}")

    def on_grid_click(self, event):
        cell_size = self.GRID_CANVAS_SIZE / self.N_SIDE
        col = int(event.x // cell_size)
        row = int(event.y // cell_size)
        idx = row * self.N_SIDE + col
        if 0 <= idx < self.N:
            self.neurons[idx] *= -1
            self.draw_grid()
            self.draw_network()
            self.stable_var.set("No")
            self.log_message(f"Toggled neuron {idx} to {'ON' if self.neurons[idx] > 0 else 'OFF'}")

    def learn(self):
        self.log_message("Learning current pattern...")
        pattern = self.neurons.reshape(-1, 1)
        new_weights = np.dot(pattern, pattern.T)
        np.fill_diagonal(new_weights, 0)
        self.weights += new_weights
        self.stored_patterns += 1
        self.pattern_var.set(str(self.stored_patterns))
        self.draw_network()
        self.stable_var.set("Yes (Learned)")

    def forget(self):
        if self.stored_patterns > 0:
            pattern = self.neurons.reshape(-1, 1)
            self.weights -= np.dot(pattern, pattern.T)
            np.fill_diagonal(self.weights, 0)
            self.stored_patterns -= 1
            self.pattern_var.set(str(self.stored_patterns))
            self.draw_network()
            self.log_message("Pattern forgotten.")
        else:
            self.log_message("Nothing to forget.")

    def add_noise(self):
        count = 0
        for i in range(self.N):
            if random.random() < 0.2:
                self.neurons[i] *= -1
                count += 1
        self.draw_grid()
        self.draw_network()
        self.stable_var.set("Unstable")
        self.log_message(f"Added noise: flipped {count} neurons.")

    def clear_grid(self):
        self.neurons.fill(-1)
        self.draw_grid()
        self.draw_network()
        self.log_message("Grid cleared.")

    def recover(self):
        self.log_message("Starting recovery...")
        self.btn_run.config(state="disabled", text="RUNNING...")
        
        def step():
            indices = list(range(self.N))
            random.shuffle(indices)

            # Convergence is signalled by falling out of this loop without any
            # neuron flipping -- a flip returns early and reschedules step().
            for i in indices:
                # Activation: sign(sum(w_ij * s_j))
                activation = np.dot(self.weights[i], self.neurons)
                new_state = 1 if activation >= 0 else -1
                
                if new_state != self.neurons[i]:
                    self.neurons[i] = new_state
                    self.draw_grid()
                    self.draw_network()
                    self.log_message(f"Neuron {i} flipped.")
                    # Visual delay
                    self.root.after(100, step)
                    return

            self.btn_run.config(state="normal", text="5. RUN")
            self.stable_var.set("Converged")
            self.log_message("Network converged.")

        step()

if __name__ == "__main__":
    root = tk.Tk()
    app = HopfieldDemo(root)
    root.mainloop()