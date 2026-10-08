"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Avatar from "@/components/Avatar";
import { BlockedUsersSettings } from "@/components/BlockedUsersSettings";
import { useEscape } from "@/hooks/useEscape";
import { useTheme, THEMES, THEME_LABELS } from "@/hooks/useTheme";
import { toast, toastResponseError } from "@/lib/toast";
import { getSocket } from "@/lib/socket";
import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH } from "@/lib/accountCredentials";
import {
  applyAudioOutputDevice,
  getMediaDeviceSettings,
  readAudioSettings,
  reconcileMediaDeviceSettings,
  requestVoiceStream,
  saveAudioSettings,
} from "@/lib/mediaDeviceSettings";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  username?: string;
  currentAvatar?: string | null;
  onAvatarChange?: (avatar: string | null) => void;
  onInputSensitivityChange?: (threshold: number) => void;
  onBlockChange?: (userId: string, blocked: boolean) => void;
  /** Renders a "Log out" button in the Account tab when provided. */
  onLogout?: () => void;
  /** Called after a successful username change (session cookie and socket already refreshed). */
  onUsernameChange?: (username: string) => void;
}

export default function SettingsModal(props: SettingsModalProps) {
  if (!props.open) return null;
  return <SettingsModalContent {...props} />;
}

function SettingsModalContent({ onClose, username, currentAvatar, onAvatarChange, onInputSensitivityChange, onBlockChange, onLogout, onUsernameChange }: SettingsModalProps) {
  const [initialSettings] = useState(readAudioSettings);
  const [tab, setTab] = useState<"audio" | "account" | "privacy" | "appearance">("audio");
  const { theme, setTheme, themes, customColors, setCustomColors } = useTheme();
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState(initialSettings.inputDevice ?? "");
  const [selectedOutput, setSelectedOutput] = useState(initialSettings.outputDevice ?? "");
  const [selectedVideo, setSelectedVideo] = useState(initialSettings.videoDevice ?? "");
  const [inputVolume, setInputVolume] = useState(initialSettings.inputVolume ?? 100);
  const [outputVolume, setOutputVolume] = useState(initialSettings.outputVolume ?? 100);
  const [testing, setTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [inputSensitivity, setInputSensitivity] = useState(initialSettings.inputSensitivity ?? 15);
  const [messageNotifications, setMessageNotifications] = useState(initialSettings.messageNotifications ?? true);
  const [uiSoundsMaster, setUiSoundsMaster] = useState(initialSettings.masterEnabled ?? true);
  const [uiSoundMessages, setUiSoundMessages] = useState(initialSettings.messageSend ?? true);
  const [uiSoundVoice, setUiSoundVoice] = useState(initialSettings.voice ?? true);
  const [uiSoundNotifications, setUiSoundNotifications] = useState(initialSettings.notifications ?? true);
  const [uiSoundVolume, setUiSoundVolume] = useState(initialSettings.volume ?? 0.3);

  const testStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micTestRequestRef = useRef(0);

  useEscape(onClose);

  useEffect(() => {
    onInputSensitivityChange?.(initialSettings.inputSensitivity ?? 15);
  }, [initialSettings.inputSensitivity, onInputSensitivityChange]);

  // Save settings on change
  const saveSettings = useCallback(() => {
    saveAudioSettings({
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
    });
  }, [selectedInput, selectedOutput, selectedVideo, inputVolume, outputVolume, inputSensitivity, messageNotifications, uiSoundsMaster, uiSoundMessages, uiSoundVoice, uiSoundNotifications, uiSoundVolume]);

  useEffect(() => { saveSettings(); }, [saveSettings]);

  // Enumerate devices
  useEffect(() => {
    let cancelled = false;

    async function refreshDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;

        setInputDevices(devices.filter((d) => d.kind === "audioinput"));
        setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
        setVideoDevices(devices.filter((d) => d.kind === "videoinput"));

        const reconciled = reconcileMediaDeviceSettings(readAudioSettings(), devices);
        const nextDevices = getMediaDeviceSettings(reconciled.settings);
        setSelectedInput(nextDevices.inputDevice);
        setSelectedOutput(nextDevices.outputDevice);
        setSelectedVideo(nextDevices.videoDevice);
        if (reconciled.changed) saveAudioSettings(reconciled.settings);
      } catch (err) {
        console.error("[Settings] Failed to enumerate devices:", err);
      }
    }

    async function initializeDevices() {
      try {
        // Request audio permission so labels are populated; video is optional.
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach((track) => track.stop());
      } catch {
        // Enumeration still returns default/permission-limited devices.
      }
      await refreshDevices();
    }

    function handleDeviceChange() {
      void refreshDevices();
    }

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    void initializeDevices();
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, []);

  const releaseMicTestResources = useCallback(() => {
    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    analyserRef.current = null;
    testStreamRef.current?.getTracks().forEach((track) => track.stop());
    testStreamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  // Mic test
  const startMicTest = useCallback(async () => {
    const requestId = ++micTestRequestRef.current;
    setTesting(true);
    try {
      const { stream, usedDefault } = await requestVoiceStream(
        navigator.mediaDevices,
        selectedInput,
      );

      if (requestId !== micTestRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (usedDefault) setSelectedInput("");
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
      if (requestId === micTestRequestRef.current) {
        setTesting(false);
        toast("Couldn't access your microphone. Check your browser's permission and device settings.", "error");
      }
    }
  }, [selectedInput]);

  const stopMicTest = useCallback(() => {
    micTestRequestRef.current += 1;
    releaseMicTestResources();
    setMicLevel(0);
    setTesting(false);
  }, [releaseMicTestResources]);

  useEffect(() => () => {
    micTestRequestRef.current += 1;
    releaseMicTestResources();
  }, [releaseMicTestResources]);

  // Play test sound through selected output
  const playTestSound = useCallback(async () => {
    let ctx: AudioContext | null = null;
    let audio: HTMLAudioElement | null = null;

    try {
      ctx = new AudioContext();
      audio = new Audio();
      const destination = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(destination);
      audio.srcObject = destination.stream;

      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(550, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime((outputVolume / 100) * 0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      await applyAudioOutputDevice(audio, selectedOutput);
      await audio.play();
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
      const activeContext = ctx;
      const activeAudio = audio;
      setTimeout(() => {
        activeAudio.pause();
        activeAudio.srcObject = null;
        void activeContext.close();
      }, 700);
    } catch {
      audio?.pause();
      if (audio) audio.srcObject = null;
      void ctx?.close();
      toast("Couldn't play through that output device", "error");
    }
  }, [outputVolume, selectedOutput]);

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
          {(["audio", "account", "privacy", "appearance"] as const).map((t) => (
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
                        ? "bg-[var(--danger)] hover:opacity-90 text-white"
                        : "bg-[var(--accent-2)] hover:bg-[var(--accent)] text-[var(--text)] hover:text-[var(--bg)]"
                    }`}
                    aria-pressed={testing}
                  >
                    {testing ? "Stop Test" : "Test Mic"}
                  </button>
                  {testing && (
                    <div className="flex-1 h-4 bg-[var(--panel-2)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)] transition-all duration-75 rounded-full"
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
                    title={messageNotifications ? "Disable message notifications" : "Enable message notifications"}
                    aria-label={messageNotifications ? "Disable message notifications" : "Enable message notifications"}
                    aria-pressed={messageNotifications}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                      messageNotifications ? "translate-x-5" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Chime and show a desktop notification when a new message arrives while Campfire is in the background.
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
                    aria-label="UI sounds"
                    aria-pressed={uiSoundsMaster}
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
                        aria-label="Message sounds"
                        aria-pressed={uiSoundMessages}
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
                        aria-label="Voice sounds"
                        aria-pressed={uiSoundVoice}
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
                        aria-label="Notification sounds"
                        aria-pressed={uiSoundNotifications}
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
              onLogout={onLogout}
              onUsernameChange={onUsernameChange}
            />
          )}

          {tab === "privacy" && (
            <BlockedUsersSettings onBlockChange={onBlockChange} />
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
  onLogout,
  onUsernameChange,
}: {
  username?: string;
  currentAvatar?: string | null;
  onAvatarChange?: (avatar: string | null) => void;
  onLogout?: () => void;
  onUsernameChange?: (username: string) => void;
}) {
  const avatarSource = currentAvatar ?? null;
  const [avatarState, setAvatarState] = useState(() => ({
    source: avatarSource,
    value: avatarSource,
  }));
  const avatar = avatarState.source === avatarSource ? avatarState.value : avatarSource;

  function setAvatar(value: string | null) {
    setAvatarState({
      source: avatarSource,
      value,
    });
  }
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusSaved, setStatusSaved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // null until /api/auth/me answers; guests rename by saving their account.
  const [isGuest, setIsGuest] = useState<boolean | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const shownName = savedName ?? username ?? "";

  // Prefill the current status so the field (and Save) reflect what's set.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const current = data?.user?.statusMessage;
        if (typeof current === "string") {
          setStatusMsg((typed) => (typed === "" ? current : typed));
        }
        if (typeof data?.user?.isGuest === "boolean") setIsGuest(data.user.isGuest);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveStatus() {
    setStatusSaving(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusMessage: statusMsg }),
      });
      if (!res.ok) {
        await toastResponseError(res, "Couldn't save your status");
        return;
      }
      setStatusSaved(true);
      setTimeout(() => setStatusSaved(false), 2000);
    } catch {
      toast("Couldn't save your status", "error");
    } finally {
      setStatusSaving(false);
    }
  }

  async function saveUsername() {
    const next = nameDraft.trim();
    if (next.length < MIN_USERNAME_LENGTH || next.length > MAX_USERNAME_LENGTH) {
      toast(`Username must be ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters`, "error");
      return;
    }
    if (next === shownName) return;
    setNameSaving(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: next }),
      });
      if (!res.ok) {
        await toastResponseError(res, "Couldn't change your username");
        return;
      }
      const data = await res.json();
      const updated: string = data?.user?.username ?? next;
      setSavedName(updated);
      setNameDraft("");
      // The socket handshake carried the old token + name; re-handshake with the new cookie.
      const socket = getSocket();
      socket.disconnect();
      socket.connect();
      onUsernameChange?.(updated);
      toast("Username updated", "success");
    } catch {
      toast("Couldn't change your username", "error");
    } finally {
      setNameSaving(false);
    }
  }

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
      } else {
        setError("Failed to remove avatar.");
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
            <Avatar
              username={username || "?"}
              avatarUrl={displaySrc}
              size={80}
              className="bg-[var(--accent-2)] text-[var(--text)] border-2 border-[var(--accent-2)]/30"
            />
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
                className="px-4 py-2 bg-[var(--danger)]/15 text-[var(--danger)] text-sm font-semibold rounded hover:bg-[var(--danger)]/25 transition-colors disabled:opacity-50"
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !statusSaving) void saveStatus();
            }}
            aria-label="Status message"
            placeholder="What are you up to? (max 128 chars)"
            className="flex-1 px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded text-sm focus:outline-none focus:border-[var(--accent-2)]"
          />
          <button
            onClick={() => void saveStatus()}
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
        <label htmlFor="settings-username" className="block text-sm font-semibold text-[var(--text)] mb-2">
          Username
        </label>
        {isGuest === false ? (
          <>
            <div className="flex gap-2">
              <input
                id="settings-username"
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value.slice(0, MAX_USERNAME_LENGTH))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !nameSaving) void saveUsername();
                }}
                placeholder={shownName || "New username"}
                autoComplete="username"
                className="flex-1 px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded text-sm focus:outline-none focus:border-[var(--accent-2)]"
              />
              <button
                onClick={() => void saveUsername()}
                disabled={nameSaving || !nameDraft.trim() || nameDraft.trim() === shownName}
                className="px-3 py-2 bg-[var(--accent-2)] text-[var(--text)] rounded text-sm hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
              >
                {nameSaving ? "..." : "Change"}
              </button>
            </div>
            <p className="text-xs text-[var(--muted)] mt-1">
              Currently <strong className="text-[var(--text)]">{shownName || "Unknown"}</strong>. {MIN_USERNAME_LENGTH}-{MAX_USERNAME_LENGTH} characters.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--text)] bg-[var(--panel-2)] px-3 py-2 rounded border border-[var(--accent-2)]/30">
              {shownName || "Unknown"}
            </p>
            {isGuest && (
              <p className="text-xs text-[var(--muted)] mt-1">
                Save your account to pick a permanent username.
              </p>
            )}
          </>
        )}
      </div>

      {onLogout && (
        <>
          <hr className="border-[var(--accent-2)]/20" />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">Log out</p>
              <p className="text-xs text-[var(--muted)]">Sign out of Campfire on this device.</p>
            </div>
            <button
              onClick={onLogout}
              className="px-4 py-2 bg-[var(--danger)]/15 text-[var(--danger)] text-sm font-semibold rounded hover:bg-[var(--danger)] hover:text-white transition-colors"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
