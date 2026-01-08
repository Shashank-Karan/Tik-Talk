

const CONFIG = {
    SERVER_URL: 'https://tik-talk-c9rp.onrender.com', // change this!
    MAX_MESSAGE_LENGTH: 1000
};

// dom elements
const elements = {
    connectionBar: document.getElementById('connectionBar'),
    connectionStatus: document.getElementById('connectionStatus'),
    currentUrl: document.getElementById('currentUrl'),
    userCount: document.getElementById('userCount'),
    chatContainer: document.getElementById('chatContainer'),
    welcomeMessage: document.getElementById('welcomeMessage'),
    typingIndicator: document.getElementById('typingIndicator'),
    typingUser: document.getElementById('typingUser'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn')
};

// state
let socket = null;
let currentRoomId = null;
let userData = null;
let typingTimeout = null;

// start everything
document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
    try {
        // get current website url
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];

        if (!currentTab || !currentTab.url) {
            showError('cannot access this page');
            return;
        }

        const url = currentTab.url;
        elements.currentUrl.textContent = new URL(url).hostname;

        connectToServer(url);
        setupEventListeners();

    } catch (error) {
        console.error('init error:', error);
        showError('failed to boot');
    }
}

// connect to socket server
function connectToServer(url) {
    updateConnectionStatus('connecting', '🔄', 'connecting...');

    socket = io(CONFIG.SERVER_URL, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        socket.emit('join-room', { url });
    });

    socket.on('room-joined', (data) => {
        currentRoomId = data.roomId;
        userData = data.userData;
        updateConnectionStatus('connected', '✅', `connected as ${userData.username}`);
        elements.userCount.textContent = data.userCount;
        if (data.recentMessages && data.recentMessages.length > 0) {
            elements.welcomeMessage.style.display = 'none';
            data.recentMessages.forEach(msg => appendMessage(msg));
        }
    });

    socket.on('new-message', (message) => {
        elements.welcomeMessage.style.display = 'none';
        appendMessage(message);
    });

    socket.on('user-joined', (data) => {
        elements.userCount.textContent = data.userCount;
        appendSystemMessage(`${data.userData.username} joined`);
    });

    socket.on('user-left', (data) => {
        elements.userCount.textContent = data.userCount;
        appendSystemMessage(`${data.username} left`);
    });

    socket.on('user-typing', (data) => {
        if (data.isTyping) {
            elements.typingUser.textContent = data.username;
            elements.typingIndicator.classList.add('active');
        } else {
            elements.typingIndicator.classList.remove('active');
        }
    });

    socket.on('rate-limited', (data) => {
        showRateLimitWarning(data.message);
    });

    socket.on('error', (data) => {
        showError(data.message);
    });

    socket.on('disconnect', () => {
        updateConnectionStatus('error', '❌', 'disconnected');
    });

    socket.on('connect_error', () => {
        updateConnectionStatus('error', '❌', 'server down');
    });
}

// setup button clicks and input
function setupEventListeners() {
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    elements.messageInput.addEventListener('input', () => {
        if (socket && socket.connected) {
            socket.emit('typing', true);
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.emit('typing', false);
            }, 2000);
        }
        // auto resize input box
        elements.messageInput.style.height = 'auto';
        elements.messageInput.style.height = Math.min(elements.messageInput.scrollHeight, 80) + 'px';
    });
}

// send message to server
function sendMessage() {
    const content = elements.messageInput.value.trim();
    if (!content || !socket || !socket.connected) return;

    socket.emit('send-message', {
        content,
        type: 'text'
    });

    elements.messageInput.value = '';
    elements.messageInput.style.height = 'auto';
    socket.emit('typing', false);
}

// show message in chat
function appendMessage(message) {
    const isOwn = message.oderId === userData?.oderId;
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isOwn ? 'own' : ''}`;

    const time = new Date(message.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });

    messageEl.innerHTML = `
    <div class="message-avatar">
      ${message.username.charAt(0)}
    </div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-username">${escapeHtml(message.username)}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-bubble">${escapeHtml(message.content)}</div>
    </div>
  `;

    elements.chatContainer.appendChild(messageEl);
    scrollToBottom();
}

// show system alerts
function appendSystemMessage(text) {
    const messageEl = document.createElement('div');
    messageEl.className = 'system-message';
    messageEl.textContent = text;
    elements.chatContainer.appendChild(messageEl);
    scrollToBottom();
}

// helpers
function updateConnectionStatus(state, icon, text) {
    elements.connectionBar.className = `connection-bar ${state}`;
    elements.connectionBar.querySelector('.status-icon').textContent = icon;
    elements.connectionStatus.textContent = text;
}

function showError(message) {
    updateConnectionStatus('error', '❌', message);
}

function showRateLimitWarning(message) {
    const warning = document.createElement('div');
    warning.className = 'rate-limit-warning';
    warning.textContent = message || 'slow down! too many messages.';
    document.body.appendChild(warning);
    setTimeout(() => warning.remove(), 3000);
}

function scrollToBottom() {
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
