/**
 * app.js – Squatch-Bunker main application logic
 */

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  userId: null,
  username: null,
  socket: null,
  currentRoomId: null,
  /** @type {Map<string, object>} roomId → room data */
  rooms: new Map(),
  /** @type {Map<string, object>} userId → member state for active room */
  activeRoomMembers: new Map(),
  muted: false,
  deafened: false,
  heartbeatIntervalId: null,
};

const voiceClient = new VoiceClient();

// ── DOM references ─────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const modalOverlay    = $('modal-overlay');
const usernameForm    = $('username-form');
const usernameInput   = $('username-input');
const joinBtn         = $('join-btn');
const channelList     = $('channel-list');
const emptyState      = $('empty-state');
const voiceRoomPanel  = $('voice-room-panel');
const roomHeaderName  = $('room-header-name');
const roomMemberCount = $('room-member-count');
const memberRoster    = $('member-roster');
const btnMic          = $('btn-mic');
const btnDeafen       = $('btn-deafen');
const btnDisconnect   = $('btn-disconnect');
const speakingIndicator = $('speaking-indicator');
const speakingLabel   = speakingIndicator.querySelector('.speaking-label');
const sidebarAvatar   = $('sidebar-avatar');
const sidebarUsername = $('sidebar-username');
const connectionStatus = $('connection-status');
const toastContainer  = $('toast-container');
const chatMessages    = $('chat-messages');
const chatForm        = $('chat-form');
const chatInput       = $('chat-input');

// ── Utilities ──────────────────────────────────────────────────────────────

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase() || '?';
}

function avatarColor(userId) {
  const colors = [
    '#5865f2', '#57f287', '#fee75c', '#eb459e',
    '#ed4245', '#3ba55d', '#faa61a', '#4f545c',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function setConnectionStatus(label, cls) {
  connectionStatus.textContent = label;
  connectionStatus.className = cls || '';
}

// ── Username modal ─────────────────────────────────────────────────────────

function checkExistingSession() {
  const userId   = sessionStorage.getItem('sb_userId');
  const username = sessionStorage.getItem('sb_username');
  if (userId && username) {
    return { userId, username };
  }
  return null;
}

async function registerUser(username) {
  const res = await fetch('/api/users/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Registration failed' }));
    throw new Error(err.error || 'Registration failed');
  }
  return res.json();
}

usernameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (!name) return;

  joinBtn.disabled = true;
  joinBtn.textContent = 'Connecting…';

  try {
    const { userId, username } = await registerUser(name);
    sessionStorage.setItem('sb_userId', userId);
    sessionStorage.setItem('sb_username', username);
    state.userId   = userId;
    state.username = username;
    modalOverlay.classList.add('hidden');
    onUserReady();
  } catch (err) {
    showToast(err.message, 'error');
    joinBtn.disabled = false;
    joinBtn.textContent = 'Enter the Bunker';
  }
});

// ── Socket connection ──────────────────────────────────────────────────────

function connectSocket() {
  const socket = window.io();
  state.socket = socket;

  socket.on('connect', () => {
    console.log('[socket] connected', socket.id);
    setConnectionStatus('Connected', 'connected');
    // Identify ourselves to the server
    socket.emit('identify', { userId: state.userId, username: state.username });
    // Reload room list in case server restarted
    loadRooms();
  });

  socket.on('disconnect', () => {
    setConnectionStatus('Disconnected', 'error');
    showToast('Disconnected from server', 'error');
    handleLocalLeave(false);
  });

  socket.on('connect_error', () => {
    setConnectionStatus('Connection error', 'error');
  });

  // ── Room presence events ──

  socket.on('room:state', ({ roomId, members }) => {
    if (roomId !== state.currentRoomId) return;
    state.activeRoomMembers.clear();
    for (const m of members) {
      state.activeRoomMembers.set(m.userId, m);
    }
    renderMemberRoster();
    updateRoomOccupancyInSidebar(roomId, members.length);
  });

  socket.on('presence:member-joined', ({ roomId, member }) => {
    if (roomId !== state.currentRoomId) return;
    state.activeRoomMembers.set(member.userId, member);
    renderMemberRoster();
    updateRoomOccupancyInSidebar(roomId, state.activeRoomMembers.size);
    showToast(`${member.username} joined the channel`);
    // Initiate WebRTC connection to new member
    if (member.userId !== state.userId) {
      voiceClient.onNewMember(member.userId);
    }
  });

  socket.on('presence:member-left', ({ roomId, userId }) => {
    if (roomId !== state.currentRoomId) return;
    const member = state.activeRoomMembers.get(userId);
    if (member) {
      showToast(`${member.username} left the channel`);
    }
    state.activeRoomMembers.delete(userId);
    renderMemberRoster();
    updateRoomOccupancyInSidebar(roomId, state.activeRoomMembers.size);
    voiceClient.onMemberLeft(userId);
  });

  socket.on('presence:state-update', ({ roomId, userId, ...patch }) => {
    if (roomId !== state.currentRoomId) return;
    const member = state.activeRoomMembers.get(userId);
    if (member) {
      Object.assign(member, patch);
      state.activeRoomMembers.set(userId, member);
      renderMemberRoster();
    }
  });

  // ── WebRTC signaling ──

  socket.on('signal:offer', ({ fromUserId, sdp }) => {
    voiceClient.handleOffer(fromUserId, sdp);
  });

  socket.on('signal:answer', ({ fromUserId, sdp }) => {
    voiceClient.handleAnswer(fromUserId, sdp);
  });

  socket.on('signal:ice-candidate', ({ fromUserId, candidate }) => {
    voiceClient.handleIceCandidate(fromUserId, candidate);
  });

  // ── Chat ──

  socket.on('chat:history', ({ messages }) => {
    chatMessages.innerHTML = '';
    for (const msg of messages) {
      appendChatMessage(msg, false);
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  socket.on('chat:message', (msg) => {
    appendChatMessage(msg, true);
  });

  // ── VAD callback ──
  voiceClient.onSpeakingChange = (speaking) => {
    if (!state.currentRoomId || state.muted) return;
    socket.emit('speaking', { roomId: state.currentRoomId, speaking });
    updateSpeakingIndicator(speaking);
  };

  return socket;
}

// ── Room list ──────────────────────────────────────────────────────────────

async function loadRooms() {
  try {
    const res = await fetch('/api/rooms?serverId=default');
    if (!res.ok) throw new Error('Failed to load rooms');
    const rooms = await res.json();
    state.rooms.clear();
    for (const room of rooms) {
      state.rooms.set(room.id, room);
    }
    renderChannelList();
  } catch (err) {
    console.error('[app] loadRooms error:', err);
    showToast('Could not load channels', 'error');
  }
}

function renderChannelList() {
  channelList.innerHTML = '';
  for (const [roomId, room] of state.rooms.entries()) {
    const item = document.createElement('div');
    item.className = 'channel-item' + (roomId === state.currentRoomId ? ' active' : '');
    item.dataset.roomId = roomId;

    const cap = room.capacity === 0 ? '∞' : room.capacity;
    const occ = room.occupancy ?? 0;

    item.innerHTML = `
      <span class="channel-icon">🔊</span>
      <span class="channel-name">${escapeHtml(room.name)}</span>
      <span class="channel-occupancy">${occ}/${cap}</span>
    `;

    item.addEventListener('click', () => handleChannelClick(roomId));
    channelList.appendChild(item);
  }
}

function updateRoomOccupancyInSidebar(roomId, count) {
  const item = channelList.querySelector(`[data-room-id="${roomId}"]`);
  if (!item) return;
  const room = state.rooms.get(roomId);
  if (!room) return;
  const cap = room.capacity === 0 ? '∞' : room.capacity;
  const occ = item.querySelector('.channel-occupancy');
  if (occ) occ.textContent = `${count}/${cap}`;
}

// ── Join / Leave logic ─────────────────────────────────────────────────────

async function handleChannelClick(roomId) {
  if (!state.socket || !state.socket.connected) {
    showToast('Not connected to server', 'error');
    return;
  }

  if (roomId === state.currentRoomId) return; // already there

  // Leave current room first if in one
  if (state.currentRoomId) {
    await handleLocalLeave(true);
  }

  await joinRoom(roomId);
}

async function joinRoom(roomId) {
  const room = state.rooms.get(roomId);
  if (!room) return;

  state.currentRoomId = roomId;

  // Update sidebar active state
  renderChannelList();

  // Show voice panel
  emptyState.classList.add('hidden');
  voiceRoomPanel.classList.remove('hidden');
  roomHeaderName.textContent = room.name;
  roomMemberCount.textContent = '0 members';
  memberRoster.innerHTML = '<div style="color:var(--color-text-muted);font-size:13px;padding:8px;">Joining…</div>';

  // Tell server
  state.socket.emit('join-room', {
    roomId,
    userId: state.userId,
    username: state.username,
  });

  // Start heartbeat
  startHeartbeat(roomId);

  // Initialize voice (room:state event will give us the member list)
  // We pass empty array here; connectToPeer calls happen after room:state
  await voiceClient.joinRoom(roomId, state.userId, state.socket, []);
}

// ── Chat ───────────────────────────────────────────────────────────────────

function appendChatMessage(msg, scroll) {
  const isSelf = msg.userId === state.userId;
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg' + (isSelf ? ' self' : '');
  wrap.dataset.msgId = msg.id;

  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  wrap.innerHTML = `
    <span class="chat-avatar" style="background:${avatarColor(msg.userId)};">${initials(msg.username)}</span>
    <div class="chat-bubble">
      <span class="chat-author">${escapeHtml(msg.username)}</span>
      <span class="chat-time">${time}</span>
      <div class="chat-text">${escapeHtml(msg.content)}</div>
    </div>
  `;
  chatMessages.appendChild(wrap);
  if (scroll) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = chatInput.value.trim();
  if (!content || !state.currentRoomId || !state.socket?.connected) return;
  state.socket.emit('chat:message', { roomId: state.currentRoomId, content });
  chatInput.value = '';
});

function handleLocalLeave(emitEvent) {
  if (!state.currentRoomId) return;
  const roomId = state.currentRoomId;

  stopHeartbeat();

  if (emitEvent && state.socket && state.socket.connected) {
    state.socket.emit('leave-room', { roomId });
  }

  voiceClient.leaveRoom();

  state.currentRoomId = null;
  state.activeRoomMembers.clear();

  // Reset mute/deafen state visually
  state.muted = false;
  state.deafened = false;
  updateMicButton();
  updateDeafenButton();
  updateSpeakingIndicator(false);

  // UI
  chatMessages.innerHTML = '';
  emptyState.classList.remove('hidden');
  voiceRoomPanel.classList.add('hidden');
  renderChannelList();
}

// ── Heartbeat ──────────────────────────────────────────────────────────────

function startHeartbeat(roomId) {
  stopHeartbeat();
  state.heartbeatIntervalId = setInterval(() => {
    if (state.socket && state.socket.connected && state.currentRoomId) {
      state.socket.emit('heartbeat', { roomId: state.currentRoomId });
    }
  }, 10_000);
}

function stopHeartbeat() {
  if (state.heartbeatIntervalId !== null) {
    clearInterval(state.heartbeatIntervalId);
    state.heartbeatIntervalId = null;
  }
}

// ── Member Roster rendering ────────────────────────────────────────────────

function renderMemberRoster() {
  memberRoster.innerHTML = '';
  const count = state.activeRoomMembers.size;
  roomMemberCount.textContent = count === 1 ? '1 member' : `${count} members`;

  for (const [, member] of state.activeRoomMembers.entries()) {
    const isSelf = member.userId === state.userId;
    const card = document.createElement('div');
    card.className = 'member-card' + (member.speaking ? ' speaking' : '');
    card.dataset.userId = member.userId;

    const bg = avatarColor(member.userId);
    const ini = initials(member.username);

    let overlayIcon = '';
    if (member.deafened) overlayIcon = '🔕';
    else if (member.muted)   overlayIcon = '🔇';

    let icons = '';
    if (member.speaking)  icons += '<span class="icon-speaking" title="Speaking">🟢</span>';
    if (member.muted)     icons += '<span class="icon-muted" title="Muted">🔇</span>';
    if (member.deafened)  icons += '<span class="icon-deafened" title="Deafened">🔕</span>';

    card.innerHTML = `
      <div class="member-avatar" style="background:${bg};">
        ${ini}
        ${overlayIcon ? `<span class="overlay-icon">${overlayIcon}</span>` : ''}
      </div>
      <div class="member-username" title="${escapeHtml(member.username)}">
        ${escapeHtml(member.username)}${isSelf ? ' (you)' : ''}
      </div>
      <div class="member-icons">${icons}</div>
    `;

    memberRoster.appendChild(card);
  }

  if (count === 0) {
    memberRoster.innerHTML = '<div style="color:var(--color-text-muted);font-size:13px;padding:8px;">No one else is here yet.</div>';
  }
}

// ── Control bar ────────────────────────────────────────────────────────────

btnMic.addEventListener('click', () => {
  if (!state.currentRoomId) return;
  state.muted = !state.muted;
  voiceClient.setMuted(state.muted);
  state.socket.emit('mute-toggle', { roomId: state.currentRoomId, muted: state.muted });
  updateMicButton();
  if (state.muted) updateSpeakingIndicator(false);
});

btnDeafen.addEventListener('click', () => {
  if (!state.currentRoomId) return;
  state.deafened = !state.deafened;
  voiceClient.setDeafened(state.deafened);
  state.socket.emit('deafen-toggle', { roomId: state.currentRoomId, deafened: state.deafened });
  // Deafening also mutes
  if (state.deafened && !state.muted) {
    state.muted = true;
    voiceClient.setMuted(true);
    state.socket.emit('mute-toggle', { roomId: state.currentRoomId, muted: true });
  }
  updateDeafenButton();
  updateMicButton();
});

btnDisconnect.addEventListener('click', () => {
  handleLocalLeave(true);
});

function updateMicButton() {
  if (state.muted) {
    btnMic.textContent = '🔇';
    btnMic.classList.add('muted');
    btnMic.title = 'Unmute microphone';
    speakingLabel.textContent = 'Muted';
  } else {
    btnMic.textContent = '🎤';
    btnMic.classList.remove('muted');
    btnMic.title = 'Mute microphone';
    speakingLabel.textContent = 'Mic on';
  }
}

function updateDeafenButton() {
  if (state.deafened) {
    btnDeafen.textContent = '🔕';
    btnDeafen.classList.add('deafened');
    btnDeafen.title = 'Undeafen';
  } else {
    btnDeafen.textContent = '🔊';
    btnDeafen.classList.remove('deafened');
    btnDeafen.title = 'Deafen';
  }
}

function updateSpeakingIndicator(speaking) {
  if (state.muted || !state.currentRoomId) {
    speakingIndicator.classList.remove('active');
    speakingLabel.textContent = state.muted ? 'Muted' : 'Mic off';
    return;
  }
  if (speaking) {
    speakingIndicator.classList.add('active');
    speakingLabel.textContent = 'Speaking';
  } else {
    speakingIndicator.classList.remove('active');
    speakingLabel.textContent = 'Mic on';
  }
}

// ── Sidebar user info ──────────────────────────────────────────────────────

function updateSidebarUser() {
  sidebarAvatar.textContent   = initials(state.username);
  sidebarAvatar.style.background = avatarColor(state.userId);
  sidebarUsername.textContent = state.username;
}

// ── HTML escape ────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

function onUserReady() {
  updateSidebarUser();
  connectSocket();
  loadRooms();
}

// On page load
(function init() {
  setConnectionStatus('Waiting…');
  const session = checkExistingSession();
  if (session) {
    state.userId   = session.userId;
    state.username = session.username;
    modalOverlay.classList.add('hidden');
    onUserReady();
  }
  // Otherwise, the modal is shown and waits for form submission
})();
