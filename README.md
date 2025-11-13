# Kusanagi-AI: Free & Open-Source Local AI Toolkit for Researchers

<p align="center" id="top">
  <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Kusanagi-AI.png" alt="Kusanagi-AI Logo" width="250"/>
</p>

<p align="center">
    <a href="https://github.com/prathameshnium/Kusanagi-AI/stargazers"><img src="https://img.shields.io/github/stars/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Stars"></a>
    <a href="https://github.com/prathameshnium/Kusanagi-AI/network/members"><img src="https://img.shields.io/github/forks/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Forks"></a>
    <a href="https://github.com/prathameshnium/Kusanagi-AI/issues"><img src="https://img.shields.io/github/issues/prathameshnium/Kusanagi-AI?style=for-the-badge&logo=github&color=ffab40&logoColor=white" alt="GitHub Issues"></a>
    <a href="https://prathameshdeshmukh.site/pages/Project_Kusanagi-AI.html"><img src="https://img.shields.io/badge/Project-Page-ffab40?style=for-the-badge&logo=read-the-docs&logoColor=white" alt="Project Page"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/github/license/prathameshnium/Kusanagi-AI?style=for-the-badge&color=ffab40" alt="License"></a>
    <img src="https://img.shields.io/badge/python-3.8+-blue.svg?style=for-the-badge&logo=python&color=ffab40" alt="Python Version">
</p>

> Empowering researchers, particularly in Physics and Material Science, with accessible, privacy-focused AI tools designed to run efficiently on standard home laptops. Kusanagi-AI provides a robust, open-source platform for local AI experimentation and application, ensuring data ownership and control. Built to leverage the power of [Ollama](https://ollama.com/) for local large language model inference, this toolkit allows you to run advanced AI capabilities, including multiple models simultaneously, even on a decent laptop.

## Table of Contents

- [About This Project](#about-this-project)
- [Technology Stack](#technology-stack)
- [Features](#features)
- [Screenshots](#screenshots)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Advanced Configuration](#advanced-configuration)
- [Usage](#usage)
- [Portability and Included Assets](#portability-and-included-assets)
- [Project Stats](#project-stats)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## About This Project

Kusanagi-AI was developed to address the growing need for accessible and privacy-conscious AI solutions within the research community. Our mission is to provide a free, open-source toolkit that enables researchers, especially those in Physics and Materials Science, to leverage advanced AI capabilities directly on their personal computers. By focusing on local execution, Kusanagi-AI ensures complete data privacy and eliminates reliance on cloud services, making sophisticated AI analysis available without specialised hardware or extensive technical expertise. This project is a testament to the power of local AI, offering a controlled environment for deep learning and practical application.

## Technology Stack
<p align="center">
  <a href="https://www.python.org" target="_blank" rel="noreferrer"> <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/python/python-original.svg" alt="python" width="40" height="40"/> </a>
  <a href="https://ollama.com/" target="_blank" rel="noreferrer"> <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/ollama.png" alt="ollama" width="45" height="45"/> </a>
  <a href="https://www.numpy.org" target="_blank" rel="noreferrer"> <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/numpy/numpy-original.svg" alt="numpy" width="40" height="40"/> </a>
  <a href="https://tkdocs.com/index.html" target="_blank" rel="noreferrer"> <img src="http://pascal.ortiz.free.fr/_images/logo_tkinter.png" alt="tkinter" width="40" height="40"/> </a>
</p>
Kusanagi-AI is built with a focus on local execution, privacy, and ease of use. The core technologies include:
-   **Python**: The entire frontend and application logic are developed in Python, leveraging its vast ecosystem of libraries for AI development.
-   **Ollama**: Powers the local large language model inference, allowing Kusanagi-AI to run various models efficiently on your machine without cloud dependencies.
-   **Tkinter**: Used for creating the native graphical user interfaces for the applications, ensuring they are lightweight and cross-platform.
-   **MXBAI Embeddings**: Utilises the `mxbai-embed-large` model from Mixedbread AI for high-quality document embeddings, crucial for the RAG capabilities.

## Features

*   **Local & Private**: All operations are performed 100% offline, guaranteeing your research data remains secure and private on your machine.
*   **Efficient Local LLM Inference**: Designed to run up to three large language models concurrently on a decent laptop, providing robust AI capabilities without specialized hardware.
*   **Research Assistant (Orochimaru)**: A flagship RAG application tailored for academic use, with its frontend developed entirely in Python.
    *   **PDF Interaction**: Engage in Retrieval-Augmented Generation (RAG) with your PDF documents for in-depth analysis and information extraction.
    *   **Academic Review**: Generate concise summaries and critical peer reviews of research papers, aiding in literature analysis and understanding.
    *   **Ollama Integration**: Seamlessly manages a local Ollama instance for efficient model inference, supporting a wide range of open-source language models.
*   **Experimental Chatbots**: A collection of diverse chatbot scripts for exploring different AI models and conversational paradigms.
*   **AI Visualizer**: Tools and scripts for visualising AI-related data, concepts, and model outputs, enhancing understanding and interpretation.
 
## Screenshots

### Orochimaru - Local Research Assistant

<p align="center"><i>A quick demonstration of Orochimaru's RAG capabilities with a research paper.</i><br><img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Demos/Orochimaru-Demo.gif" alt="Orochimaru Demo GIF" width="800"/></p>

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

## Advanced Configuration

For more granular control, you can modify the `System_Config.json` file. This allows you to customize paths and model settings for different applications within the toolkit.

<details>
  <summary>Click to see configuration options</summary>

```json
{
    "ollama_path": "Portable_AI_Assets/ollama_main/ollama.exe",
    "model_folder": "Portable_AI_Assets/common-ollama-models",
    "vector_cache_dir": "Portable_AI_Assets/vector_cache",
    "embedding_model_name": "mxbai-embed-large",
    "default_model": "tinyllama:latest"
}
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
  <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Gemma.jpg" alt="Gemma Logo" width="150"/>
  <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Qwen.jpg" alt="Qwen Logo" width="130"/>
  <img src="https://github.com/prathameshnium/Kusanagi-AI/raw/main/_assets/Images/Tinylamma.jpg" alt="TinyLlama Logo" width="87"/>
</p>

**Important Note on Open-Source Projects**: We deeply respect and acknowledge the intellectual property of the original creators of the included open-source projects. Kusanagi-AI merely integrates these tools for enhanced portability and user convenience. We do not claim ownership over these projects.

Please refer to the original repositories for detailed information and licensing:

-   **Ollama:** [https://github.com/ollama/ollama](https://github.com/ollama/ollama)
-   **Gemma:** [https://github.com/google/gemma_pytorch](https://github.com/google/gemma_pytorch)
-   **Qwen:** [https://github.com/QwenLM/Qwen](https://github.com/QwenLM/Qwen)
-   **TinyLlama:** [https://github.com/jzhang38/TinyLlama](https://github.com/jzhang38/TinyLlama)

## Project Stats
<p align="center">
  <img src="https://github-readme-stats.vercel.app/api/top-langs/?username=prathameshnium&repo=Kusanagi-AI&layout=compact&theme=transparent&bg_color=193549&title_color=ffab40&text_color=ffffff" alt="Top Languages" />
  &nbsp;
  <img src="https://github-readme-activity-graph.vercel.app/graph?username=prathameshnium&repo=Kusanagi-AI&bg_color=193549&color=ffffff&line=ffab40&point=ffffff&area=true&hide_border=true" alt="Activity Graph" />
</p>

## Project Structure
<details>
  <summary>Click to expand</summary>

```
Kusanagi-AI/
├── Portable_AI_Assets/
├── Orochimaru_Local_Research_Assistent.py
├── OneTail_Local_Chatapp.py
├── Visualize_AI.py
├── System_Config.json
└── requirements.txt
```
</details>

## Roadmap

We are continuously working to enhance Kusanagi-AI. Here are some of the features and improvements on our roadmap:

-   **Enhanced RAG Capabilities**:
    -   **Multi-Document Chat**: Enable querying and synthesizing information across multiple documents simultaneously.
    -   **Fact-Checking Mode**: Implement the "Checker" feature to validate statements and claims against the provided text, highlighting supporting evidence.
    -   **Advanced Reviewer Personas**: Introduce more specialized reviewer roles for nuanced academic feedback.

-   **UI and UX Improvements**:
    -   **Integrated Visualizer**: Merge the AI Visualizer into the main applications to provide real-time insights into model behavior.
    -   **UI Theming**: Add options for users to customize the look and feel of the applications.

-   **Core Functionality Expansion**:
    -   **Support for More Filetypes**: Extend document processing capabilities beyond PDFs to include formats like `.docx`, `.txt`, and source code files.
    -   **Model Fine-Tuning**: Provide scripts and guides for users to fine-tune models on their specific research datasets.

## Contributing

This project is proudly developed and maintained by **Prathamesh Deshmukh**.

We welcome contributions from the community! Whether it's bug reports, feature suggestions, or code contributions, your input is valuable. Please feel free to open an issue or submit a pull request on GitHub.

## License

This project is released under the [MIT License](./License).

## Disclaimer

Kusanagi-AI is a open-source project provided for educational and research purposes. While designed for robust local AI operations, it is offered "as-is" without warranty. Users are encouraged to explore, adapt, and extend its functionalities for their specific needs.

<p align="right"><a href="#top">Back to top</a></p>
