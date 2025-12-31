// State
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let recordingSeconds = 0;
const MAX_RECORDING_TIME = 60;
let currentMemorySize = 5;
let useContext = false;
let customApiKey = null;
let isCustomMode = false;
let currentTheme = 'dark';

// Audio player state
let currentAudio = null;
let currentPlayBtn = null;

// DOM Elements
const recordBtn = document.getElementById('recordBtn');
const recordHint = document.getElementById('recordHint');
const timerText = document.getElementById('timerText');
const timerLabel = document.getElementById('timerLabel');
const timerRing = document.getElementById('timerRing');
const timerProgress = document.getElementById('timerProgress');
const conversationsList = document.getElementById('conversationsList');
const conversationCount = document.getElementById('conversationCount');
const clearBtn = document.getElementById('clearBtn');
const processingOverlay = document.getElementById('processingOverlay');
const processingText = document.getElementById('processingText');
const selectorBtns = document.querySelectorAll('.selector-btn:not(.custom-btn)');
const contextToggle = document.getElementById('contextToggle');
const customContextBtn = document.getElementById('customContextBtn');
const customModal = document.getElementById('customModal');
const modalClose = document.getElementById('modalClose');
const customContextSize = document.getElementById('customContextSize');
const customApiKeyInput = document.getElementById('customApiKey');
const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
const apiStatus = document.getElementById('apiStatus');
const resetApiKey = document.getElementById('resetApiKey');
const validateAndSave = document.getElementById('validateAndSave');
const themeToggle = document.getElementById('themeToggle');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadSettings();
    loadConversations();
    setupEventListeners();
});

// Theme Functions
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    currentTheme = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
}

function setupEventListeners() {
    recordBtn.addEventListener('click', toggleRecording);
    clearBtn.addEventListener('click', clearConversations);
    themeToggle.addEventListener('click', toggleTheme);
    
    // Context toggle
    contextToggle.addEventListener('change', async () => {
        useContext = contextToggle.checked;
        await updateSettings();
    });
    
    // Memory size selectors
    selectorBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            if (isCustomMode) {
                isCustomMode = false;
                customContextBtn.classList.remove('active');
            }
            const size = parseInt(btn.dataset.size);
            await setMemorySize(size, false);
        });
    });
    
    // Custom context button
    customContextBtn.addEventListener('click', () => {
        customModal.classList.add('active');
    });
    
    // Modal close
    modalClose.addEventListener('click', closeModal);
    customModal.addEventListener('click', (e) => {
        if (e.target === customModal) closeModal();
    });
    
    // Toggle API key visibility
    toggleKeyVisibility.addEventListener('click', () => {
        const type = customApiKeyInput.type === 'password' ? 'text' : 'password';
        customApiKeyInput.type = type;
    });
    
    // Reset API key
    resetApiKey.addEventListener('click', async () => {
        customApiKey = null;
        customApiKeyInput.value = '';
        isCustomMode = false;
        customContextBtn.classList.remove('active');
        
        await fetch('/api/reset-custom-key', { method: 'POST' });
        
        apiStatus.className = 'api-status success';
        apiStatus.textContent = 'API key removed. Your key was only stored temporarily and is now gone from the system.';
        
        // Reset to default size
        await setMemorySize(5, false);
        
        // Give user time to read the message before closing
        setTimeout(() => {
            closeModal();
        }, 3000);
    });
    
    // Validate and save
    validateAndSave.addEventListener('click', validateAndSaveCustom);
}

function closeModal() {
    customModal.classList.remove('active');
    apiStatus.className = 'api-status';
    apiStatus.textContent = '';
}

async function validateAndSaveCustom() {
    const size = parseInt(customContextSize.value);
    const apiKey = customApiKeyInput.value.trim();
    
    // Validate size
    if (isNaN(size) || size < 1 || size > 100) {
        apiStatus.className = 'api-status error';
        apiStatus.textContent = 'Context size must be between 1 and 100.';
        return;
    }
    
    // Validate API key presence
    if (!apiKey) {
        apiStatus.className = 'api-status error';
        apiStatus.textContent = 'Please enter your OpenAI API key.';
        return;
    }
    
    // Validate API key format
    if (!apiKey.startsWith('sk-')) {
        apiStatus.className = 'api-status error';
        apiStatus.textContent = 'Invalid API key format. OpenAI keys start with "sk-".';
        return;
    }
    
    apiStatus.className = 'api-status';
    apiStatus.textContent = 'Validating API key...';
    
    try {
        const response = await fetch('/api/validate-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
        });
        
        const result = await response.json();
        
        if (result.valid) {
            customApiKey = apiKey;
            isCustomMode = true;
            
            // Update UI
            selectorBtns.forEach(btn => btn.classList.remove('active'));
            customContextBtn.classList.add('active');
            customContextBtn.textContent = `Custom (${size})`;
            
            // Set memory size with custom key
            await setMemorySize(size, true, apiKey);
            
            apiStatus.className = 'api-status success';
            apiStatus.textContent = 'API key validated! Settings saved.';
            
            setTimeout(closeModal, 1500);
        } else {
            apiStatus.className = 'api-status error';
            apiStatus.textContent = result.error || 'Invalid API key. Please check and try again.';
        }
    } catch (error) {
        apiStatus.className = 'api-status error';
        apiStatus.textContent = 'Error validating API key. Please try again.';
    }
}

// Recording Functions
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    // Stop any playing audio
    stopCurrentAudio();
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            stream.getTracks().forEach(track => track.stop());
            await processAudio(audioBlob);
        };
        
        mediaRecorder.start();
        isRecording = true;
        recordingSeconds = 0;
        
        // Update UI
        recordBtn.classList.add('recording');
        timerRing.classList.add('recording');
        recordHint.textContent = 'Click to stop recording';
        timerLabel.textContent = 'Recording';
        
        // Start timer
        timerInterval = setInterval(() => {
            recordingSeconds++;
            updateTimer();
            
            if (recordingSeconds >= MAX_RECORDING_TIME) {
                stopRecording();
            }
        }, 1000);
        
    } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Could not access microphone. Please check permissions.');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    isRecording = false;
    clearInterval(timerInterval);
    
    // Update UI
    recordBtn.classList.remove('recording');
    timerRing.classList.remove('recording');
    recordHint.textContent = 'Click to start recording';
    timerLabel.textContent = 'Ready';
    timerText.textContent = '0:00';
    timerProgress.style.strokeDashoffset = '283';
}

function updateTimer() {
    const minutes = Math.floor(recordingSeconds / 60);
    const seconds = recordingSeconds % 60;
    timerText.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Update progress ring (283 is the circumference)
    const progress = (recordingSeconds / MAX_RECORDING_TIME) * 283;
    timerProgress.style.strokeDashoffset = 283 - progress;
}

// Audio Player Functions
function stopCurrentAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        if (currentPlayBtn) {
            currentPlayBtn.innerHTML = getPlayIcon();
            currentPlayBtn.classList.remove('playing');
        }
        currentAudio = null;
        currentPlayBtn = null;
    }
}

function getPlayIcon() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
}

function getPauseIcon() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
}

function toggleAudio(url, btn) {
    // If same audio is playing, pause it
    if (currentAudio && currentPlayBtn === btn) {
        if (currentAudio.paused) {
            currentAudio.play();
            btn.innerHTML = getPauseIcon();
            btn.classList.add('playing');
        } else {
            currentAudio.pause();
            btn.innerHTML = getPlayIcon();
            btn.classList.remove('playing');
        }
        return;
    }
    
    // Stop any currently playing audio
    stopCurrentAudio();
    
    // Play new audio
    currentAudio = new Audio(url);
    currentPlayBtn = btn;
    
    currentAudio.play();
    btn.innerHTML = getPauseIcon();
    btn.classList.add('playing');
    
    // When audio ends, reset button
    currentAudio.onended = () => {
        btn.innerHTML = getPlayIcon();
        btn.classList.remove('playing');
        currentAudio = null;
        currentPlayBtn = null;
    };
}

// API Functions
async function processAudio(audioBlob) {
    showProcessing('Transcribing audio...');
    
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.wav');
        
        showProcessing('Processing with AI...');
        
        const response = await fetch('/api/process', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || error.error || 'Processing failed');
        }
        
        const result = await response.json();
        
        // Reload conversations to show new one
        await loadConversations();
        
        // Auto-play the response (stop any current audio first)
        stopCurrentAudio();
        const audio = new Audio(result.output_audio_url);
        audio.play();
        
    } catch (error) {
        console.error('Error processing audio:', error);
        alert('Error: ' + error.message);
    } finally {
        hideProcessing();
    }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        
        useContext = settings.use_context;
        contextToggle.checked = useContext;
        currentMemorySize = settings.memory_size;
        isCustomMode = settings.is_custom;
        
        if (isCustomMode) {
            selectorBtns.forEach(btn => btn.classList.remove('active'));
            customContextBtn.classList.add('active');
            customContextBtn.textContent = `Custom (${currentMemorySize})`;
        } else {
            updateSelectorUI(currentMemorySize);
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function loadConversations() {
    try {
        const [conversationsRes, statsRes] = await Promise.all([
            fetch('/api/conversations'),
            fetch('/api/stats')
        ]);
        
        const conversations = await conversationsRes.json();
        const stats = await statsRes.json();
        
        conversationCount.textContent = `${stats.count} / ${stats.limit}`;
        
        renderConversations(conversations);
        
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

function renderConversations(conversations) {
    if (conversations.length === 0) {
        conversationsList.innerHTML = `
            <div class="empty-state">
                <p>No conversations yet</p>
                <span>Start by clicking the record button</span>
            </div>
        `;
        return;
    }
    
    // Render in reverse order (newest first)
    const html = conversations.slice().reverse().map(conv => `
        <div class="conversation-card">
            <div class="conversation-card-header">
                <span class="conversation-number">#${conv.id}</span>
            </div>
            <div class="conversation-card-body">
                <div class="message-block">
                    <span class="message-label user">You</span>
                    <p class="message-text">${escapeHtml(conv.user_text)}</p>
                    <div class="audio-player">
                        <button class="play-btn" onclick="toggleAudio('${conv.input_audio_url}', this)">
                            ${getPlayIcon()}
                        </button>
                        <span class="audio-label">Input audio</span>
                    </div>
                </div>
                <div class="message-block">
                    <span class="message-label ai">Assistant</span>
                    <p class="message-text">${escapeHtml(conv.ai_text)}</p>
                    <div class="audio-player">
                        <button class="play-btn" onclick="toggleAudio('${conv.output_audio_url}', this)">
                            ${getPlayIcon()}
                        </button>
                        <span class="audio-label">Response audio</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
    
    conversationsList.innerHTML = html;
}

async function setMemorySize(size, isCustom = false, apiKey = null) {
    try {
        const body = { size, is_custom: isCustom };
        if (apiKey) body.api_key = apiKey;
        
        const response = await fetch('/api/memory-size', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (response.ok) {
            currentMemorySize = size;
            if (!isCustom) {
                updateSelectorUI(size);
            }
            await loadConversations();
        }
    } catch (error) {
        console.error('Error setting memory size:', error);
    }
}

async function updateSettings() {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ use_context: useContext })
        });
    } catch (error) {
        console.error('Error updating settings:', error);
    }
}

function updateSelectorUI(size) {
    selectorBtns.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.size) === size);
    });
    customContextBtn.classList.remove('active');
    customContextBtn.textContent = 'Custom';
}

async function clearConversations() {
    if (!confirm('Start a new session? This will clear all conversations.')) {
        return;
    }
    
    // Stop any playing audio
    stopCurrentAudio();
    
    try {
        await fetch('/api/clear', { method: 'POST' });
        await loadConversations();
    } catch (error) {
        console.error('Error clearing conversations:', error);
    }
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showProcessing(text) {
    processingText.textContent = text;
    processingOverlay.classList.add('active');
}

function hideProcessing() {
    processingOverlay.classList.remove('active');
}
