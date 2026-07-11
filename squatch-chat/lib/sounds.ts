// Sound settings stored in localStorage key "campfire-audio-settings"
// Structure: { masterEnabled: boolean, messageSend: boolean, messageReceive: boolean, voice: boolean, notifications: boolean, volume: number }

function getSettings() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem("campfire-audio-settings") || "{}");
  } catch { return {}; }
}

function canPlay(type: "messageSend" | "messageReceive" | "voice" | "notifications"): boolean {
  const s = getSettings();
  if (!s) return false;
  if (s.masterEnabled === false) return false;
  if (s[type] === false) return false;
  return true;
}

function getVolume(): number {
  const s = getSettings();
  return s?.volume ?? 0.3;
}

function createContext() {
  try { return new AudioContext(); } catch { return null; }
}

export const sounds = {
  messageSent() {
    if (!canPlay("messageSend")) return;
    const ctx = createContext(); if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(getVolume() * 0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
    setTimeout(() => ctx.close(), 300);
  },

  messageReceived() {
    if (!canPlay("messageReceive")) return;
    const ctx = createContext(); if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(getVolume() * 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(); osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close(), 350);
  },

  voiceJoin() {
    if (!canPlay("voice")) return;
    const ctx = createContext(); if (!ctx) return;
    // Campfire crackle: white noise burst
    const bufferSize = ctx.sampleRate * 0.3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(getVolume() * 0.2, ctx.currentTime);
    source.start();
    setTimeout(() => ctx.close(), 500);
  },

  voiceLeave() {
    if (!canPlay("voice")) return;
    const ctx = createContext(); if (!ctx) return;
    // Ember fade: descending tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(getVolume() * 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 600);
  },

  notification() {
    if (!canPlay("notifications")) return;
    const ctx = createContext(); if (!ctx) return;
    // Gentle chime: two-note sequence
    const vol = getVolume() * 0.25;
    [880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "triangle";
      const t = ctx.currentTime + i * 0.12;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t); osc.stop(t + 0.25);
    });
    setTimeout(() => ctx.close(), 700);
  },
};
