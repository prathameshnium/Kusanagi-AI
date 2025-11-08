# Kusanagi-AI: Free & Open-Source Local AI Toolkit for Researchers

<!-- Kusanagi-AI Logo Placeholder -->
![Kusanagi-AI Logo](https://static.wikia.nocookie.net/sword/images/5/54/Orochimaru%27s_Sword_of_Kusanagi.png/revision/latest?cb=20240901080411)

> Empowering researchers, particularly in Physics and Material Science, with accessible, privacy-focused AI tools designed to run efficiently on standard home laptops. Kusanagi-AI provides a robust, open-source platform for local AI experimentation and application, ensuring data ownership and control. Built to leverage the power of [Ollama](https://ollama.com/) for local large language model inference, this toolkit allows you to run advanced AI capabilities, including multiple models simultaneously, even on a decent laptop.

## About This Project

Kusanagi-AI was developed to address the growing need for accessible and privacy-conscious AI solutions within the research community. Our mission is to provide a free, open-source toolkit that enables researchers, especially those in Physics and Material Science, to leverage advanced AI capabilities directly on their personal computers. By focusing on local execution, Kusanagi-AI ensures complete data privacy and eliminates reliance on cloud services, making sophisticated AI analysis available without specialized hardware or extensive technical expertise. This project is a testament to the power of local AI, offering a controlled environment for deep learning and practical application.

## Technology Stack

Kusanagi-AI is built with a focus on local execution, privacy, and ease of use, leveraging powerful open-source technologies.

| Technology | Description | Logo |
| :--------- | :---------- | :--- |
| **Python** | The entire frontend and application logic are developed in Python, ensuring readability, flexibility, and a vast ecosystem of libraries for AI development. | ![Python Logo](https://www.python.org/static/community_logos/python-logo-only.png) |
| **Ollama** | Powers the local large language model inference, allowing Kusanagi-AI to run various models efficiently on your machine without cloud dependencies. It enables seamless management and interaction with models like Llama3, Gemma, Qwen, and TinyLlama. | ![Ollama Logo](https://seeklogo.com/images/O/ollama-logo-F62D6B7A7F-seeklogo.com.png) |
| **MXBAI Embeddings** | Utilizes the `mxbai-embed-large` model from [Mixedbread AI](https://mixedbread.ai/) for high-quality document embeddings, crucial for Retrieval-Augmented Generation (RAG) and semantic search capabilities within the research assistant. | ![Mixedbread AI Logo](https://mixedbread.ai/favicon.ico) |

## Features

*   **Local & Private**: All operations are performed 100% offline, guaranteeing your research data remains secure and private on your machine.
*   **Efficient Local LLM Inference**: Designed to run up to three large language models concurrently on a decent laptop, providing robust AI capabilities without specialized hardware.
*   **Research Assistant (Orochimaru)**: The flagship application, specifically tailored for academic use, with its frontend developed entirely in Python.
    *   **PDF Interaction**: Engage in Retrieval-Augmented Generation (RAG) with your PDF documents for in-depth analysis and information extraction.
    *   **Academic Review**: Generate concise summaries and critical peer reviews of research papers, aiding in literature analysis and understanding.
    *   **Ollama Integration**: Seamlessly manages a local Ollama instance for efficient model inference, supporting a wide range of open-source language models.
*   **Experimental Chatbots**: A collection of diverse chatbot scripts for exploring different AI models and conversational paradigms.
*   **AI Visualizer**: Tools and scripts for visualizing AI-related data, concepts, and model outputs, enhancing understanding and interpretation.

## Getting Started

Follow these steps to set up your local AI research environment.

### Prerequisites

*   **Python 3.8+**: The core programming language for Kusanagi-AI.
*   **Ollama**: Essential for running local large language models. Download and install Ollama from [https://ollama.com/](https://ollama.com/). Kusanagi-AI can also manage the Ollama server for you if configured correctly.

### Installation

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/your-username/Kusanagi-AI.git
    cd Kusanagi-AI
    ```

2.  **Install the required Python packages:**
    It is highly recommended to use a virtual environment to manage dependencies.
    ```sh
    pip install -r requirements.txt
    ```

3.  **Configure the System:**
    *   Open `System_Config.json` located in the project root.
    *   Ensure `ollama_path` accurately points to your Ollama executable (e.g., `F:\Portable_AI_Assets\ollama_main\ollama.exe`).
    *   Set `model_folder` to the directory where your Ollama models are stored.
    *   **Download Models**: Pull the necessary models using the Ollama CLI. The default embedding model is `mxbai-embed-large`, and you'll need at least one chat model.
    ```sh
    ollama pull mxbai-embed-large
    ollama pull llama3 # or any other preferred chat model
    ```

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
