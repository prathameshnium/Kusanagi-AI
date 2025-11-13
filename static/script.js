// --- MOCK JAVASCRIPT to simulate the app's functionality ---
const chatHistory = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const kageSummitButton = document.getElementById('btn-kage-summit');

// --- Event Listeners ---
sendButton.addEventListener('click', handleSend);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
});
// Special listener for the Kage Summit button
kageSummitButton.addEventListener('click', () => {
    let prompt = chatInput.value.trim();
    if (prompt === '') {
        prompt = "Provide a general peer review of this document.";
    }
    handleSend(prompt, true); // Pass 'true' to trigger Kage Summit
});

// --- Main Send Function ---
const handleSend = (prompt, isKageSummit = false) => {
    if (!prompt) {
        prompt = chatInput.value.trim();
    }
    if (prompt === '') return;

    addMessage('user', prompt);
    chatInput.value = '';
    
    // Disable all inputs
    setInputsDisabled(true);

    if (isKageSummit) {
        // --- KAGE SUMMIT SIMULATION ---
        simulateKageSummit(prompt);
    } else {
        // --- NORMAL CHAT SIMULATION ---
        addMessage('ai', 'Thinking...', true); // Add thinking message
        setTimeout(() => {
            removeThinkingMessage();
            const aiResponse = "According to the document, Marie Curie was a physicist and chemist... [Source 4, Page 27]";
            addMessage('ai', aiResponse);
            setInputsDisabled(false);
        }, 1500);
    }
};

// --- Kage Summit Simulation ---
async function simulateKageSummit(prompt) {
    addMessage('ai', 'Assembling Kage Summit...', true);
    
    // This 'await' simulates the time for RAG/embedding
    await sleep(1500);
    removeThinkingMessage();

    const reviews = [
        { expert: "Physicist", review: "The theoretical models presented are sound. However, the interpretation of the diffraction data on page 12 could be clearer." },
        { expert: "Chemist", review: "The material synthesis section is robust and reproducible. I question the purity of the precursors mentioned in [Source 8, Page 19]." },
        { expert: "Chief Editor", review: "A strong paper. The council agrees that the methodology is sound, but the conclusion needs to more directly address the chemical purity concerns raised by the Chemist." }
    ];

    for (const review of reviews) {
        addMessage(review.expert, 'Thinking...', true, review.expert);
        await sleep(1500); // Wait 1.5s for each expert
        removeThinkingMessage(review.expert);
        addMessage(review.expert, review.review);
    }
    
    setInputsDisabled(false);
}

// --- Helper Functions ---
const addMessage = (role, text, isThinking = false, id = null) => {
    const messageWrapper = document.createElement('div');
    let messageId = isThinking ? (id ? `thinking-${id}` : 'thinking') : '';

    if (role === 'user') {
        messageWrapper.className = "flex items-start space-x-4 justify-end";
        messageWrapper.innerHTML = `
            <div class="bg-accent text-accent-fg p-4 rounded-lg max-w-2xl">
                <p class="font-bold mb-1">You</p>
                <p>${text}</p>
            </div>
            <div class="flex-shrink-0 w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center font-bold">You</div>
        `;
    } else {
        messageWrapper.className = "flex items-start space-x-4";
        if (messageId) messageWrapper.id = messageId;
        
        let author = "Kusanagi"; // CHANGED
        let authorColor = "text-accent";
        let avatar = "AI";

        // Check for special roles
        if (role !== 'ai') {
            author = role;
            avatar = role.substring(0, 2).toUpperCase();
        }

        let messageContent = `
            <p class="font-bold ${authorColor} mb-1">${author}</p>
            <p>${text}</p>
        `;
        
        if (isThinking) {
            messageContent = `<p class="text-fg-secondary italic">${text}</p>`;
        }

        messageWrapper.innerHTML = `
            <div class="flex-shrink-0 w-10 h-10 bg-tertiary rounded-full flex items-center justify-center font-bold ${authorColor}">${avatar}</div>
            <div class="bg-tertiary p-4 rounded-lg max-w-2xl">
                ${messageContent}
            </div>
        `;
    }
    chatHistory.appendChild(messageWrapper);
    chatHistory.scrollTop = chatHistory.scrollHeight;
};

const removeThinkingMessage = (id = null) => {
    const thinkingId = id ? `thinking-${id}` : 'thinking';
    const thinkingMessage = document.getElementById(thinkingId);
    if (thinkingMessage) {
        thinkingMessage.remove();
    }
};

const setInputsDisabled = (isDisabled) => {
    chatInput.disabled = isDisabled;
    sendButton.disabled = isDisabled;
    if (!isDisabled) chatInput.focus();
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
