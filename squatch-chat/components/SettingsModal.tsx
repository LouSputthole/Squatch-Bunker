"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<"audio" | "account">("audio");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [inputVolume, setInputVolume] = useState(100);
  const [outputVolume, setOutputVolume] = useState(100);
  const [testing, setTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

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
        if (s.inputVolume !== undefined) setInputVolume(s.inputVolume);
        if (s.outputVolume !== undefined) setOutputVolume(s.outputVolume);
      } catch { /* ignore */ }
    }
  }, [open]);

  // Save settings on change
  const saveSettings = useCallback(() => {
    localStorage.setItem("campfire-audio-settings", JSON.stringify({
      inputDevice: selectedInput,
      outputDevice: selectedOutput,
      inputVolume,
      outputVolume,
    }));
  }, [selectedInput, selectedOutput, inputVolume, outputVolume]);

  useEffect(() => { saveSettings(); }, [saveSettings]);

  // Enumerate devices
  useEffect(() => {
    if (!open) return;

    async function loadDevices() {
      try {
        // Request permission first so labels are populated
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach((t) => t.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        setInputDevices(devices.filter((d) => d.kind === "audioinput"));
        setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
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
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[var(--panel)] rounded-lg shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-[var(--accent-2)]/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--accent-2)]/30">
          <h2 className="text-lg font-bold text-[var(--text)]">Settings</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          >
            x
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--accent-2)]/30">
          <button
            onClick={() => setTab("audio")}
            className={`px-6 py-2 text-sm font-semibold transition-colors ${
              tab === "audio"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            Audio
          </button>
          <button
            onClick={() => setTab("account")}
            className={`px-6 py-2 text-sm font-semibold transition-colors ${
              tab === "account"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            Account
          </button>
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
            </div>
          )}

          {tab === "account" && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--muted)]">
                Account settings coming soon. This will include profile editing, password changes, and display preferences.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
