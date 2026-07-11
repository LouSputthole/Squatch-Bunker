"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Avatar from "@/components/Avatar";
import { useTheme, THEMES, THEME_LABELS } from "@/hooks/useTheme";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  username?: string;
  currentAvatar?: string | null;
  onAvatarChange?: (avatar: string | null) => void;
  onInputSensitivityChange?: (threshold: number) => void;
}

export default function SettingsModal({ open, onClose, username, currentAvatar, onAvatarChange, onInputSensitivityChange }: SettingsModalProps) {
  const [tab, setTab] = useState<"audio" | "account" | "appearance">("audio");
  const { theme, setTheme, themes, customColors, setCustomColors } = useTheme();
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [selectedVideo, setSelectedVideo] = useState<string>("");
  const [inputVolume, setInputVolume] = useState(100);
  const [outputVolume, setOutputVolume] = useState(100);
  const [testing, setTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [inputSensitivity, setInputSensitivity] = useState(15);
  const [messageNotifications, setMessageNotifications] = useState(true);
  const [uiSoundsMaster, setUiSoundsMaster] = useState(true);
  const [uiSoundMessages, setUiSoundMessages] = useState(true);
  const [uiSoundVoice, setUiSoundVoice] = useState(true);
  const [uiSoundNotifications, setUiSoundNotifications] = useState(true);
  const [uiSoundVolume, setUiSoundVolume] = useState(0.3);

  const testStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Load saved settings
  useEffect(() => {
    if (!open) return;

    const saved = localStorage.getItem("campfire-audio-settings");
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.inputDevice) setSelectedInput(s.inputDevice);
        if (s.outputDevice) setSelectedOutput(s.outputDevice);
        if (s.videoDevice) setSelectedVideo(s.videoDevice);
        if (s.inputVolume !== undefined) setInputVolume(s.inputVolume);
        if (s.outputVolume !== undefined) setOutputVolume(s.outputVolume);
        if (s.inputSensitivity !== undefined) {
          setInputSensitivity(s.inputSensitivity);
          onInputSensitivityChange?.(s.inputSensitivity);
        }
        if (s.messageNotifications !== undefined) setMessageNotifications(s.messageNotifications);
        if (s.masterEnabled !== undefined) setUiSoundsMaster(s.masterEnabled);
        if (s.messageSend !== undefined) setUiSoundMessages(s.messageSend);
        if (s.voice !== undefined) setUiSoundVoice(s.voice);
        if (s.notifications !== undefined) setUiSoundNotifications(s.notifications);
        if (s.volume !== undefined) setUiSoundVolume(s.volume);
      } catch { /* ignore */ }
    }
  }, [open]);

  // Save settings on change
  const saveSettings = useCallback(() => {
    localStorage.setItem("campfire-audio-settings", JSON.stringify({
      inputDevice: selectedInput,
      outputDevice: selectedOutput,
      videoDevice: selectedVideo,
      inputVolume,
      outputVolume,
      inputSensitivity,
      messageNotifications,
      masterEnabled: uiSoundsMaster,
      messageSend: uiSoundMessages,
      messageReceive: uiSoundMessages,
      voice: uiSoundVoice,
      notifications: uiSoundNotifications,
      volume: uiSoundVolume,
    }));
  }, [selectedInput, selectedOutput, selectedVideo, inputVolume, outputVolume, inputSensitivity, messageNotifications, uiSoundsMaster, uiSoundMessages, uiSoundVoice, uiSoundNotifications, uiSoundVolume]);

  useEffect(() => { saveSettings(); }, [saveSettings]);

  // Enumerate devices
  useEffect(() => {
    if (!open) return;

    async function loadDevices() {
      try {
        // Request audio permission so labels are populated; video is optional
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach((t) => t.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        setInputDevices(devices.filter((d) => d.kind === "audioinput"));
        setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
        setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
      } catch (err) {
        console.error("[Settings] Failed to enumerate devices:", err);
      }
    }

    loadDevices();
  }, [open]);

  // Mic test
  const startMicTest = useCallback(async () => {
    setTesting(true);
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedInput
          ? { deviceId: { exact: selectedInput }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function updateLevel() {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      }
      updateLevel();
    } catch (err) {
      console.error("[Settings] Mic test failed:", err);
      setTesting(false);
    }
  }, [selectedInput]);

  const stopMicTest = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    analyserRef.current = null;
    testStreamRef.current?.getTracks().forEach((t) => t.stop());
    testStreamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setMicLevel(0);
    setTesting(false);
  }, []);

  // Play test sound through selected output
  const playTestSound = useCallback(async () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(550, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime((outputVolume / 100) * 0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(() => ctx.close(), 700);
    } catch {
      // Audio not supported
    }
  }, [outputVolume]);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      stopMicTest();
    }
  }, [open, stopMicTest]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div
        className="bg-[var(--panel)] rounded-lg shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-[var(--accent-2)]/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--accent-2)]/30">
          <h2 id="settings-modal-title" className="text-lg font-bold text-[var(--text)]">Settings</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
            aria-label="Close settings"
            autoFocus
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--accent-2)]/30">
          {(["audio", "account", "appearance"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-semibold transition-colors capitalize ${
                tab === t
                  ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === "audio" && (
            <div className="space-y-6">
              {/* Input Device */}
              <div>
                <label className="block text-sm font-semibold text-[var(--text)] mb-2">
                  Input Device (Microphone)
                </label>
                <select
                  value={selectedInput}
                  onChange={(e) => { setSelectedInput(e.target.value); if (testing) { stopMicTest(); } }}
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">System Default</option>
                  {inputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Input Volume */}
              <div>
                <label className="block text-sm font-semibold text-[var(--text)] mb-2">
                  Input Volume: {inputVolume}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={inputVolume}
                  onChange={(e) => setInputVolume(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
              </div>

              {/* Mic Test */}
              <div>
                <label className="block text-sm font-semibold text-[var(--text)] mb-2">
                  Microphone Test
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={testing ? stopMicTest : startMicTest}
                    className={`px-4 py-2 text-sm font-semibold rounded transition-colors ${
                      testing
                        ? "bg-red-600 hover:bg-red-700 text-white"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {testing ? "Stop Test" : "Test Mic"}
                  </button>
                  {testing && (
                    <div className="flex-1 h-4 bg-[var(--panel-2)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all duration-75 rounded-full"
                        style={{ width: `${micLevel}%` }}
                      />
                    </div>
                  )}
                </div>
                {testing && (
                  <p className="text-xs text-[var(--muted)] mt-1">
                    Speak into your microphone to see the level indicator.
                  </p>
                )}
              </div>

              {/* Input Sensitivity */}
              <div>
                <label className="block text-sm font-semibold text-[var(--text)] mb-2">
                  Input Sensitivity: {inputSensitivity}
                </label>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={inputSensitivity}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setInputSensitivity(val);
                    onInputSensitivityChange?.(val);
                  }}
                  className="w-full accent-[var(--accent)]"
                />
                <p className="text-xs text-[var(--muted)] mt-1">
                  Lower = more sensitive (picks up quiet sounds). Higher = less sensitive (only loud speech triggers).
                </p>
              </div>

              <hr className="border-[var(--accent-2)]/20" />

              {/* Video Device (Webcam) */}
              <div>
                <label className="block text-sm font-semibold text-[var(--text)] mb-2">
                  Video Device (Webcam)
                </label>
                <select
                  value={selectedVideo}
                  onChange={(e) => setSelectedVideo(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">System Default</option>
                  {videoDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
                {videoDevices.length === 0 && (
                  <p className="text-xs text-[var(--muted)] mt-1">
                    No cameras detected. Connect a webcam and reopen settings.
                  </p>
                )}
              </div>

              <hr className="border-[var(--accent-2)]/20" />

              {/* Output Device */}
              <div>
                <label className="block text-sm font-semibold text-[var(--text)] mb-2">
                  Output Device (Speakers/Headphones)
                </label>
                <select
                  value={selectedOutput}
                  onChange={(e) => setSelectedOutput(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">System Default</option>
                  {outputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Output Volume */}
              <div>
                <label className="block text-sm font-semibold text-[var(--text)] mb-2">
                  Output Volume: {outputVolume}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={outputVolume}
                  onChange={(e) => setOutputVolume(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
              </div>

              {/* Output Test */}
              <div>
                <button
                  onClick={playTestSound}
                  className="px-4 py-2 bg-[var(--accent-2)] hover:bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold rounded transition-colors"
                >
                  Test Output Sound
                </button>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Plays a short tone through your selected output device.
                </p>
              </div>

              <hr className="border-[var(--accent-2)]/20" />

              {/* Message Notifications */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[var(--text)]">
                    Message Notifications
                  </label>
                  <button
                    onClick={() => setMessageNotifications((v) => !v)}
                    className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                      messageNotifications ? "bg-[var(--accent)]" : "bg-[var(--panel-2)] border border-[var(--accent-2)]/30"
                    }`}
                    title={messageNotifications ? "Disable message sounds" : "Enable message sounds"}
                    aria-label={messageNotifications ? "Disable message notification sounds" : "Enable message notification sounds"}
                    aria-pressed={messageNotifications}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                      messageNotifications ? "translate-x-5" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Play a sound when a new message arrives while the tab is in the background.
                </p>
              </div>

              <hr className="border-[var(--accent-2)]/20" />

              {/* UI Sounds */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[var(--text)]">UI Sounds</label>
                  <button
                    onClick={() => setUiSoundsMaster((v) => !v)}
                    className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                      uiSoundsMaster ? "bg-[var(--accent)]" : "bg-[var(--panel-2)] border border-[var(--accent-2)]/30"
                    }`}
                    title={uiSoundsMaster ? "Disable UI sounds" : "Enable UI sounds"}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                      uiSoundsMaster ? "translate-x-5" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>

                {uiSoundsMaster && (
                  <div className="pl-3 space-y-2 border-l border-[var(--accent-2)]/20">
                    {/* Message sounds */}
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[var(--muted)]">Message sounds</label>
                      <button
                        onClick={() => setUiSoundMessages((v) => !v)}
                        className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${
                          uiSoundMessages ? "bg-[var(--accent)]" : "bg-[var(--panel-2)] border border-[var(--accent-2)]/30"
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${
                          uiSoundMessages ? "translate-x-4" : "translate-x-0.5"
                        }`} />
                      </button>
                    </div>

                    {/* Voice sounds */}
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[var(--muted)]">Voice sounds</label>
                      <button
                        onClick={() => setUiSoundVoice((v) => !v)}
                        className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${
                          uiSoundVoice ? "bg-[var(--accent)]" : "bg-[var(--panel-2)] border border-[var(--accent-2)]/30"
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${
                          uiSoundVoice ? "translate-x-4" : "translate-x-0.5"
                        }`} />
                      </button>
                    </div>

                    {/* Notification sounds */}
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[var(--muted)]">Notification sounds</label>
                      <button
                        onClick={() => setUiSoundNotifications((v) => !v)}
                        className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${
                          uiSoundNotifications ? "bg-[var(--accent)]" : "bg-[var(--panel-2)] border border-[var(--accent-2)]/30"
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${
                          uiSoundNotifications ? "translate-x-4" : "translate-x-0.5"
                        }`} />
                      </button>
                    </div>

                    {/* Volume */}
                    <div>
                      <label className="text-xs text-[var(--muted)] block mb-1">
                        UI Sound Volume: {Math.round(uiSoundVolume * 100)}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={uiSoundVolume}
                        onChange={(e) => setUiSoundVolume(parseFloat(e.target.value))}
                        className="w-full accent-[var(--accent)]"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "account" && (
            <AccountTab
              username={username}
              currentAvatar={currentAvatar}
              onAvatarChange={onAvatarChange}
            />
          )}

          {tab === "appearance" && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-[var(--text)] mb-3">
                  Theme
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {themes.filter((t) => t !== "custom").map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all ${theme === t ? "bg-[var(--accent-2)]/20 ring-1 ring-[var(--accent-2)]" : "hover:bg-[var(--accent-2)]/10"}`}
                    >
                      <div className="flex w-full h-6 rounded overflow-hidden border border-[var(--accent-2)]/30">
                        <div className="flex-1" style={{ background: THEMES[t]["--bg"] }} />
                        <div className="flex-1" style={{ background: THEMES[t]["--panel"] }} />
                        <div className="flex-1" style={{ background: THEMES[t]["--accent-2"] }} />
                      </div>
                      <span className="text-[10px] text-[var(--text)]">{THEME_LABELS[t] || t}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom theme editor */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-semibold text-[var(--text)]">Custom Theme</label>
                  <button
                    onClick={() => setTheme("custom")}
                    className={`text-xs px-3 py-1 rounded transition-colors ${
                      theme === "custom"
                        ? "bg-[var(--accent-2)] text-[var(--text)]"
                        : "bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {theme === "custom" ? "Active" : "Apply"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["--bg", "--panel", "--panel-2", "--text", "--muted", "--accent", "--accent-2", "--danger"] as const).map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        type="color"
                        value={customColors[key] || "#000000"}
                        onChange={(e) => setCustomColors({ ...customColors, [key]: e.target.value })}
                        className="w-6 h-6 rounded cursor-pointer border border-[var(--accent-2)]/30"
                      />
                      <span className="text-xs text-[var(--muted)]">{key.replace("--", "")}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--muted)] mt-2">
                  Pick colors, then click Apply to use your custom theme.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountTab({
  username,
  currentAvatar,
  onAvatarChange,
}: {
  username?: string;
  currentAvatar?: string | null;
  onAvatarChange?: (avatar: string | null) => void;
}) {
  const [avatar, setAvatar] = useState<string | null>(currentAvatar ?? null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusSaved, setStatusSaved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAvatar(currentAvatar ?? null);
  }, [currentAvatar]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");

    if (file.size > 2 * 1024 * 1024) {
      setError("File too large. Maximum size is 2MB.");
      return;
    }

    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      setError("Invalid file type. Use JPEG, PNG, GIF, or WebP.");
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    // Upload
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/auth/avatar", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        setPreview(null);
        return;
      }
      setAvatar(data.avatar);
      setPreview(null);
      onAvatarChange?.(data.avatar);
    } catch {
      setError("Upload failed. Please try again.");
      setPreview(null);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemove() {
    setUploading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/avatar", { method: "DELETE" });
      if (res.ok) {
        setAvatar(null);
        setPreview(null);
        onAvatarChange?.(null);
      }
    } catch {
      setError("Failed to remove avatar.");
    } finally {
      setUploading(false);
    }
  }

  const displaySrc = preview || avatar;

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-[var(--text)] mb-3">
          Profile Picture
        </label>
        <div className="flex items-center gap-4">
          <div className="relative group">
            {displaySrc ? (
              <img
                src={displaySrc}
                alt="Avatar"
                className="w-20 h-20 rounded-full object-cover border-2 border-[var(--accent-2)]/30"
              />
            ) : (
              <Avatar
                username={username || "?"}
                size={80}
                className="bg-[var(--accent-2)] text-[var(--text)] border-2 border-[var(--accent-2)]/30"
              />
            )}
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2 bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {avatar ? "Change Avatar" : "Upload Avatar"}
            </button>
            {avatar && (
              <button
                onClick={handleRemove}
                disabled={uploading}
                className="px-4 py-2 bg-red-600/20 text-red-400 text-sm font-semibold rounded hover:bg-red-600/30 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </div>
        {error && <p className="text-xs text-[var(--danger)] mt-2">{error}</p>}
        <p className="text-xs text-[var(--muted)] mt-2">
          Recommended: Square image, at least 128x128px. Max 2MB. JPEG, PNG, GIF, or WebP.
        </p>
      </div>

      <hr className="border-[var(--accent-2)]/20" />

      <div>
        <label className="block text-sm font-semibold text-[var(--text)] mb-2">
          Status Message
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={statusMsg}
            onChange={(e) => setStatusMsg(e.target.value.slice(0, 128))}
            placeholder="What are you up to? (max 128 chars)"
            className="flex-1 px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded text-sm focus:outline-none focus:border-[var(--accent-2)]"
          />
          <button
            onClick={async () => {
              setStatusSaving(true);
              await fetch("/api/auth/me", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ statusMessage: statusMsg }),
              });
              setStatusSaving(false);
              setStatusSaved(true);
              setTimeout(() => setStatusSaved(false), 2000);
            }}
            disabled={statusSaving}
            className="px-3 py-2 bg-[var(--accent-2)] text-[var(--text)] rounded text-sm hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
          >
            {statusSaved ? "Saved!" : statusSaving ? "..." : "Save"}
          </button>
        </div>
        <p className="text-xs text-[var(--muted)] mt-1">{statusMsg.length}/128</p>
      </div>

      <hr className="border-[var(--accent-2)]/20" />

      <div>
        <label className="block text-sm font-semibold text-[var(--text)] mb-2">
          Username
        </label>
        <p className="text-sm text-[var(--text)] bg-[var(--panel-2)] px-3 py-2 rounded border border-[var(--accent-2)]/30">
          {username || "Unknown"}
        </p>
        <p className="text-xs text-[var(--muted)] mt-1">
          Username changes coming soon.
        </p>
      </div>
    </div>
  );
}
