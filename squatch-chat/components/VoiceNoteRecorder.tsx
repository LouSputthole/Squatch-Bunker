"use client";

import { useEffect, useRef, useState } from "react";
import {
  VOICE_NOTE_LABEL,
  VOICE_NOTE_MAX_BYTES,
  VOICE_NOTE_MAX_DURATION_SECONDS,
} from "@/lib/uploadPolicy";

const RECORDER_FORMATS = [
  {
    recorderType: "audio/webm;codecs=opus",
    fileType: "audio/webm",
    extension: "webm",
  },
  {
    recorderType: "audio/ogg;codecs=opus",
    fileType: "audio/ogg",
    extension: "ogg",
  },
  {
    recorderType: "audio/mp4",
    fileType: "audio/mp4",
    extension: "m4a",
  },
] as const;

type RecorderMode = "idle" | "recording" | "preview" | "sending";

interface VoiceNotePreview {
  file: File;
  url: string;
  durationSeconds: number;
}

interface VoiceNoteRecorderProps {
  disabled?: boolean;
  onSend: (file: File) => Promise<void>;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function recordingError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone access was denied. Allow mic access to record a voice note.";
  }
  return "Campfire could not start the microphone. Check your device and try again.";
}

export function VoiceNoteRecorder({
  disabled = false,
  onSend,
}: VoiceNoteRecorderProps) {
  const [mode, setMode] = useState<RecorderMode>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [preview, setPreview] = useState<VoiceNotePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardOnStopRef = useRef(false);
  const previewUrlRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);

  function clearRecordingTimers() {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    stopTimeoutRef.current = null;
    tickIntervalRef.current = null;
  }

  function stopMicrophone() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
  }

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      discardOnStopRef.current = true;
      clearRecordingTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        recorder.stop();
      }
      recorderRef.current = null;
      stopMicrophone();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, []);

  async function startRecording() {
    setError(null);
    clearPreview();

    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError("Voice notes are not supported in this browser.");
      return;
    }

    const format = RECORDER_FORMATS.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate.recorderType),
    );
    if (!format) {
      setError("This browser cannot record a supported Campfire voice-note format.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (micError) {
      setError(recordingError(micError));
      return;
    }

    if (unmountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType: format.recorderType,
        audioBitsPerSecond: 64_000,
      });
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardOnStopRef.current = false;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        discardOnStopRef.current = true;
        setError("Recording stopped because the microphone reported an error.");
        if (recorder.state !== "inactive") recorder.stop();
      };
      recorder.onstop = () => {
        clearRecordingTimers();
        stopMicrophone();
        recorderRef.current = null;
        if (unmountedRef.current) return;

        const durationSeconds = Math.min(
          VOICE_NOTE_MAX_DURATION_SECONDS,
          Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000)),
        );
        if (discardOnStopRef.current) {
          chunksRef.current = [];
          setMode("idle");
          return;
        }

        const blob = new Blob(chunksRef.current, { type: format.fileType });
        chunksRef.current = [];
        if (blob.size === 0) {
          setError("No audio was captured. Check your microphone and try again.");
          setMode("idle");
          return;
        }
        if (blob.size > VOICE_NOTE_MAX_BYTES) {
          setError("That voice note is too large to send. Try a shorter recording.");
          setMode("idle");
          return;
        }

        const file = new File(
          [blob],
          `${VOICE_NOTE_LABEL}.${format.extension}`,
          { type: format.fileType },
        );
        const url = URL.createObjectURL(file);
        previewUrlRef.current = url;
        setPreview({ file, url, durationSeconds });
        setMode("preview");
      };

      recorder.start(1000);
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setMode("recording");

      tickIntervalRef.current = setInterval(() => {
        const elapsed = Math.min(
          VOICE_NOTE_MAX_DURATION_SECONDS,
          Math.floor((Date.now() - startedAtRef.current) / 1000),
        );
        setElapsedSeconds(elapsed);
      }, 250);
      stopTimeoutRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, VOICE_NOTE_MAX_DURATION_SECONDS * 1000);
    } catch (recorderError) {
      stopMicrophone();
      setError(recordingError(recorderError));
      setMode("idle");
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }

  function cancelRecording() {
    discardOnStopRef.current = true;
    clearRecordingTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stopMicrophone();
    setMode("idle");
    setElapsedSeconds(0);
  }

  function cancelPreview() {
    clearPreview();
    setError(null);
    setMode("idle");
  }

  async function sendPreview() {
    if (!preview) return;
    setMode("sending");
    setError(null);
    try {
      await onSend(preview.file);
      if (unmountedRef.current) return;
      clearPreview();
      setMode("idle");
    } catch (sendError) {
      if (unmountedRef.current) return;
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Campfire could not send that voice note.",
      );
      setMode("preview");
    }
  }

  const panelOpen = mode !== "idle" || error !== null;
  const recording = mode === "recording";

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={disabled || mode === "preview" || mode === "sending"}
        className={`px-2 py-3 transition-colors disabled:opacity-30 ${
          recording
            ? "text-red-400 animate-pulse"
            : "text-[var(--muted)] hover:text-[var(--text)]"
        }`}
        title={recording ? "Stop voice note" : "Record voice note"}
        aria-label={recording ? "Stop voice note" : "Record voice note"}
        aria-expanded={panelOpen}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
        </svg>
      </button>

      {panelOpen && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-[var(--accent-2)]/40 bg-[var(--panel)] p-3 shadow-xl"
          aria-live="polite"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">
              🔥 {VOICE_NOTE_LABEL}
            </span>
            {mode === "recording" && (
              <span className="font-mono text-xs text-red-400">
                {formatDuration(elapsedSeconds)} / 2:00
              </span>
            )}
          </div>

          {error && (
            <p className="mb-2 text-xs text-red-400" role="alert">
              {error}
            </p>
          )}

          {mode === "idle" && error && (
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
            >
              Close
            </button>
          )}

          {mode === "recording" && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--muted)]">Recording microphone…</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/30"
                >
                  Stop & preview
                </button>
              </div>
            </div>
          )}

          {(mode === "preview" || mode === "sending") && preview && (
            <div className="space-y-2">
              <audio controls preload="metadata" src={preview.url} className="w-full" />
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-[var(--muted)]">
                  {formatDuration(preview.durationSeconds)}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelPreview}
                    disabled={mode === "sending"}
                    className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={sendPreview}
                    disabled={mode === "sending"}
                    className="rounded bg-[var(--accent-2)] px-3 py-1 text-xs font-semibold text-[var(--bg)] hover:bg-[var(--accent)] disabled:opacity-50"
                  >
                    {mode === "sending" ? "Sending…" : "Send voice note"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
