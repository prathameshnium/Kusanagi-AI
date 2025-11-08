# Kusanagi-AI

> A toolkit of local, privacy-focused AI applications built with Python. Includes a RAG-powered research assistant for PDFs, various chatbots, and visualization scripts.

## About This Project

I started Kusanagi-AI because I wanted to create a more privacy-focused and controlled environment to experiment with AI. I believe that running models locally is a fantastic way to learn, and it gives you complete ownership of your data and the entire process.

This is not a professional, polished setup. Instead, it's a personal playground,  a collection of scripts and applications I'm building for fun and to deepen my understanding of AI.

## Features

*   **Local & Private**: Everything is designed to run 100% offline. Your data never leaves your machine.
*   **Research Assistant (Orochimaru)**: The main application in this toolkit.
    *   Load and chat with your PDF documents using Retrieval-Augmented Generation (RAG).
    *   Summarize and generate critical reviews of research papers.
    *   Manages a local Ollama instance for model inference.
*   **Experimental Chatbots**: Various simple chatbot scripts to test different models and ideas.
*   **AI Visualizer**: Scripts to visualize AI-related data and concepts.

## Getting Started

Follow these steps to get the environment up and running.

### Prerequisites

*   Python 3.8+
*   [Ollama](https://ollama.com/): You need to have Ollama installed to run the local models. The scripts can even start the Ollama server for you if the path is configured correctly.

### Installation

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/your-username/Kusanagi-AI.git
    cd Kusanagi-AI
    ```

2.  **Install the required Python packages:**
    It's recommended to use a virtual environment.
    ```sh
    pip install -r requirements.txt
    ```

3.  **Configure the System:**
    *   Open `System_Config.json`.
    *   Ensure the `ollama_path` points to your Ollama executable (e.g., `F:\\Portable_AI_Assets\\ollama_main\\ollama.exe`).
    *   Set the `model_folder` to where you store your Ollama models.
    *   Make sure you have the embedding model specified in the config (default: `mxbai-embed-large`) and at least one chat model pulled via Ollama.
    ```sh
    ollama pull mxbai-embed-large
    ollama pull llama3 # or any other model you prefer
    ```

## Usage

The main application is the Research Assistant. To run it, execute the following command:

```sh
python Local_Research_Assistent.py
```

You can explore and run the other scripts like `Chatapp.py` and `Visualize_AI.py` to see different experiments.

## Portability and Included Assets

To make this project as portable and self-contained as possible, it includes several key components within the `Portable_AI_Assets` directory. This means you can get started without having to download everything separately.

-   **Ollama:** The `ollama.exe` executable is included. Ollama is a fantastic tool for running large language models locally.
-   **Models:** To get you started right away, the following models are also included:
    -   Gemma
    -   Qwen
    -   TinyLlama

**Important Note:** I do not claim any ownership over these open-source projects. They are the work of their respective creators, and I have included them here purely for convenience and to ensure the portability of this toolkit. I have immense respect for the open-source community and the developers behind these amazing tools.

Please find the original repositories for these projects below:

-   **Ollama:** [https://github.com/ollama/ollama](https://github.com/ollama/ollama)
-   **Gemma:** [https://github.com/google/gemma_pytorch](https://github.com/google/gemma_pytorch)
-   **Qwen:** [https://github.com/QwenLM/Qwen](https://github.com/QwenLM/Qwen)
-   **TinyLlama:** [https://github.com/jzhang38/TinyLlama](https://github.com/jzhang38/TinyLlama)

## Disclaimer

This is a personal project created for fun and educational purposes. The code is experimental and provided as-is. Feel free to explore, fork, and modify it for your own learning journey!
