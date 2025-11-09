# Kusanagi-AI: Free & Open-Source Local AI Toolkit for Researchers

<p align="center">
  <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Kusanagi-AI.png" alt="Kusanagi-AI Logo" width="250"/>
</p>

<p align="center">
    <a href="https://github.com/prathameshnium/Kusanagi-AI/stargazers"><img src="https://img.shields.io/github/stars/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Stars"></a>
    <a href="https://github.com/prathameshnium/Kusanagi-AI/network/members"><img src="https://img.shields.io/github/forks/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Forks"></a>
    <a href="https://github.com/prathameshnium/Kusanagi-AI/issues"><img src="https://img.shields.io/github/issues/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Issues"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/github/license/prathameshnium/Kusanagi-AI?style=for-the-badge&color=ffab40" alt="License"></a>
    <img src="https://img.shields.io/badge/python-3.8+-blue.svg?style=for-the-badge&logo=python&color=ffab40" alt="Python Version">
</p>

> Empowering researchers, particularly in Physics and Material Science, with accessible, privacy-focused AI tools designed to run efficiently on standard home laptops. Kusanagi-AI provides a robust, open-source platform for local AI experimentation and application, ensuring data ownership and control. Built to leverage the power of [Ollama](https://ollama.com/) for local large language model inference, this toolkit allows you to run advanced AI capabilities, including multiple models simultaneously, even on a decent laptop.

## About This Project

Kusanagi-AI was developed to address the growing need for accessible and privacy-conscious AI solutions within the research community. Our mission is to provide a free, open-source toolkit that enables researchers, especially those in Physics and Materials Science, to leverage advanced AI capabilities directly on their personal computers. By focusing on local execution, Kusanagi-AI ensures complete data privacy and eliminates reliance on cloud services, making sophisticated AI analysis available without specialised hardware or extensive technical expertise. This project is a testament to the power of local AI, offering a controlled environment for deep learning and practical application.

## Technology Stack
<p align="center">
  <a href="https://www.python.org" target="_blank" rel="noreferrer"> <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/python/python-original.svg" alt="python" width="40" height="40"/> </a>
  <a href="https://ollama.com/" target="_blank" rel="noreferrer"> <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/ollama.png" alt="ollama" width="45" height="45"/> </a>
  <a href="https://www.numpy.org" target="_blank" rel="noreferrer"> <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/numpy/numpy-original.svg" alt="numpy" width="40" height="40"/> </a>
  <a href="https://tkdocs.com/index.html" target="_blank" rel="noreferrer"> <img src="https://upload.wikimedia.org/wikipedia/commons/c/c6/Tk_logo.svg" alt="tkinter" width="35" height="35"/> </a>
</p>
Kusanagi-AI is built with a focus on local execution, privacy, and ease of use. The core technologies include:
-   **Python**: The entire frontend and application logic are developed in Python, leveraging its vast ecosystem of libraries for AI development.
-   **Ollama**: Powers the local large language model inference, allowing Kusanagi-AI to run various models efficiently on your machine without cloud dependencies.
-   **Tkinter**: Used for creating the native graphical user interfaces for the applications, ensuring they are lightweight and cross-platform.
-   **MXBAI Embeddings**: Utilises the `mxbai-embed-large` model from Mixedbread AI for high-quality document embeddings, crucial for the RAG capabilities.

## Features

*   **Local & Private**: All operations are performed 100% offline, guaranteeing your research data remains secure and private on your machine.
*   **Efficient Local LLM Inference**: Designed to run up to three large language models concurrently on a decent laptop, providing robust AI capabilities without specialized hardware.
*   **Research Assistant (Orochimaru)**: The flagship application, specifically tailored for academic use, with its frontend developed entirely in Python.
    *   **PDF Interaction**: Engage in Retrieval-Augmented Generation (RAG) with your PDF documents for in-depth analysis and information extraction.
    *   **Academic Review**: Generate concise summaries and critical peer reviews of research papers, aiding in literature analysis and understanding.
    *   **Ollama Integration**: Seamlessly manages a local Ollama instance for efficient model inference, supporting a wide range of open-source language models.
*   **Experimental Chatbots**: A collection of diverse chatbot scripts for exploring different AI models and conversational paradigms.
*   **AI Visualizer**: Tools and scripts for visualising AI-related data, concepts, and model outputs, enhancing understanding and interpretation.

## Screenshots

### Orochimaru - Local Research Assistant

![Orochimaru Screenshot](https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Orochimaru_Screenshot.jpg)

### One Tail - Local Chat App

![One Tail Screenshot](https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/One_Tail_Screenshot.jpg)

## Getting Started

Follow these steps to set up your local AI research environment.

### Prerequisites

*   **Python 3.8+**: The core programming language for Kusanagi-AI.
*   **Ollama**: Essential for running local large language models. Download and install Ollama from [https://ollama.com/](https://ollama.com/). Kusanagi-AI can also manage the Ollama server for you if configured correctly.

### Installation

1.  **Clone the repository:**
    <details>
      <summary>Click to expand</summary>
      
      ```sh
      git clone https://github.com/prathameshnium/Kusanagi-AI.git
      cd Kusanagi-AI
      ```
    </details>

2.  **Install the required Python packages:**
    It is highly recommended to use a virtual environment to manage dependencies.
    <details>
      <summary>Click to expand</summary>
      
      ```sh
      pip install -r requirements.txt
      ```
    </details>

3.  **Configure the System:**
    *   Open `System_Config.json` located in the project root.
    *   Ensure `ollama_path` accurately points to your Ollama executable (e.g., `F:\Portable_AI_Assets\ollama_main\ollama.exe`).
    *   Set `model_folder` to the directory where your Ollama models are stored.
    *   **Download Models**: Pull the necessary models using the Ollama CLI. The default embedding model is `mxbai-embed-large`, and you'll need at least one chat model.
    <details>
      <summary>Click to expand</summary>
      
      ```sh
      ollama pull mxbai-embed-large
      ollama pull llama3 # or any other preferred chat model
      ```
    </details>

## Usage

The primary tool in this toolkit is the Research Assistant. To launch it, execute the following command:

```sh
python Orochimaru_Local_Research_Assistent.py
```

Explore other scripts like `OneTail_Local_Chatapp.py` and `Visualize_AI.py` to discover additional functionalities and experiments.

## Portability and Included Assets

Kusanagi-AI is designed for maximum portability and ease of use, incorporating several key components directly within the `Portable_AI_Assets` directory. This approach minimizes initial setup time and ensures a self-contained environment.

-   **Ollama Executable**: A pre-packaged `ollama.exe` is included for convenience, facilitating local model serving.
-   **Starter Models**: To jumpstart your research, a selection of foundational models such as Gemma, Qwen, and TinyLlama are provided.

<p align="center">
  <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Gemma.jpg" alt="Gemma" width="150"/>
  <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Qwen.jpg" alt="Qwen" width="130"/>
  <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Tinylamma.jpg" alt="TinyLlama" width="87"/>
</p>

**Important Note on Open-Source Projects**: We deeply respect and acknowledge the intellectual property of the original creators of the included open-source projects. Kusanagi-AI merely integrates these tools for enhanced portability and user convenience. We do not claim ownership over these projects.

Please refer to the original repositories for detailed information and licensing:

-   **Ollama:** [https://github.com/ollama/ollama](https://github.com/ollama/ollama)
-   **Gemma:** [https://github.com/google/gemma_pytorch](https://github.com/google/gemma_pytorch)
-   **Qwen:** [https://github.com/QwenLM/Qwen](https://github.com/QwenLM/Qwen)
-   **TinyLlama:** [https://github.com/jzhang38/TinyLlama](https://github.com/jzhang38/TinyLlama)

## Contributing

We welcome contributions from the community! Whether it's bug reports, feature suggestions, or code contributions, your input is valuable. Please refer to our contribution guidelines (if available) or open an issue on GitHub.

## License

This project is released under the [MIT License](https://opensource.org/licenses/MIT).

## Disclaimer

Kusanagi-AI is a open-source project provided for educational and research purposes. While designed for robust local AI operations, it is offered "as-is" without warranty. Users are encouraged to explore, adapt, and extend its functionalities for their specific needs.
