import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  applyAudioOutputDevice,
  buildCameraVideoConstraints,
  buildVoiceAudioConstraints,
  parseAudioSettings,
  reconcileMediaDeviceSettings,
  requestCameraStream,
  requestVoiceStream,
  replaceActiveAudioTrack,
} from "@/lib/mediaDeviceSettings";

interface FakeTrack {
  kind: "audio";
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
}

function createTrack(enabled: boolean): FakeTrack {
  return {
    kind: "audio",
    enabled,
    stop: vi.fn(),
  };
}

function createStream(tracks: FakeTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function createSender(track: FakeTrack, shouldFail = false): RTCRtpSender {
  const sender = {
    track,
    replaceTrack: vi.fn(async (nextTrack: FakeTrack | null) => {
      if (shouldFail) throw new Error("replace failed");
      if (nextTrack) sender.track = nextTrack;
    }),
  };
  return sender as unknown as RTCRtpSender;
}

describe("media device settings", () => {
  it("parses saved settings defensively", () => {
    expect(parseAudioSettings('{"inputDevice":"mic-1"}')).toEqual({ inputDevice: "mic-1" });
    expect(parseAudioSettings("not-json")).toEqual({});
    expect(parseAudioSettings("null")).toEqual({});
  });

  it("uses exact saved devices and omits deviceId for system default", () => {
    expect(buildVoiceAudioConstraints("mic-1")).toMatchObject({
      deviceId: { exact: "mic-1" },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(buildVoiceAudioConstraints("")).not.toHaveProperty("deviceId");

    expect(buildCameraVideoConstraints("camera-1")).toMatchObject({
      deviceId: { exact: "camera-1" },
      width: { ideal: 640 },
      height: { ideal: 480 },
    });
    expect(buildCameraVideoConstraints("")).not.toHaveProperty("deviceId");
  });

  it("clears unavailable persisted devices while preserving available devices and other settings", () => {
    const devices = [
      { kind: "audioinput" as const, deviceId: "mic-2" },
      { kind: "audiooutput" as const, deviceId: "speaker-1" },
      { kind: "videoinput" as const, deviceId: "camera-2" },
    ];
    const result = reconcileMediaDeviceSettings({
      inputDevice: "missing-mic",
      outputDevice: "speaker-1",
      videoDevice: "missing-camera",
      inputVolume: 75,
      messageNotifications: false,
    }, devices);

    expect(result.changed).toBe(true);
    expect(result.settings).toEqual({
      inputDevice: "",
      outputDevice: "speaker-1",
      videoDevice: "",
      inputVolume: 75,
      messageNotifications: false,
    });
    expect(reconcileMediaDeviceSettings(result.settings, devices).changed).toBe(false);
  });

  it("keeps the system default after an unplugged preferred microphone is replugged", () => {
    const unplugged = reconcileMediaDeviceSettings(
      { inputDevice: "mic-1" },
      [{ kind: "audioinput", deviceId: "mic-2" }],
    );
    expect(unplugged).toEqual({
      settings: { inputDevice: "" },
      changed: true,
    });

    const replugged = reconcileMediaDeviceSettings(
      unplugged.settings,
      [
        { kind: "audioinput", deviceId: "mic-1" },
        { kind: "audioinput", deviceId: "mic-2" },
      ],
    );
    expect(replugged).toEqual({
      settings: { inputDevice: "" },
      changed: false,
    });
  });

  it("retries a stale saved microphone once with the system default", async () => {
    const fallbackStream = createStream([createTrack(true)]);
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException("device disappeared", "NotFoundError"))
      .mockResolvedValueOnce(fallbackStream);

    await expect(requestVoiceStream({ getUserMedia }, "missing-mic")).resolves.toEqual({
      stream: fallbackStream,
      usedDefault: true,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: expect.objectContaining({ deviceId: { exact: "missing-mic" } }),
      video: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: expect.not.objectContaining({ deviceId: expect.anything() }),
      video: false,
    });
  });

  it("retries a stale saved camera once with the system default", async () => {
    const fallbackStream = createStream([]);
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException("constraint failed", "OverconstrainedError"))
      .mockResolvedValueOnce(fallbackStream);

    await expect(requestCameraStream({ getUserMedia }, "missing-camera")).resolves.toEqual({
      stream: fallbackStream,
      usedDefault: true,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: false,
      video: expect.objectContaining({ deviceId: { exact: "missing-camera" } }),
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: false,
      video: expect.not.objectContaining({ deviceId: expect.anything() }),
    });
  });

  it("does not retry permission and other non-stale media errors", async () => {
    const denied = new DOMException("permission denied", "NotAllowedError");
    const getUserMedia = vi.fn().mockRejectedValue(denied);

    await expect(requestVoiceStream({ getUserMedia }, "mic-1")).rejects.toBe(denied);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("selects an output sink when supported and keeps default playback otherwise", async () => {
    const setSinkId = vi.fn(async () => undefined);
    const supported = { setSinkId } as unknown as HTMLMediaElement;

    await expect(applyAudioOutputDevice(supported, "speaker-1")).resolves.toBe(true);
    expect(setSinkId).toHaveBeenCalledWith("speaker-1");

    await expect(applyAudioOutputDevice(supported, "")).resolves.toBe(true);
    expect(setSinkId).toHaveBeenLastCalledWith("");

    await expect(
      applyAudioOutputDevice({} as HTMLMediaElement, "speaker-1"),
    ).resolves.toBe(false);
  });

  it("falls back without throwing when the browser rejects a sink", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const element = {
      setSinkId: vi.fn(async () => { throw new Error("unsupported sink"); }),
    } as unknown as HTMLMediaElement;

    await expect(applyAudioOutputDevice(element, "speaker-1")).resolves.toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("replaces outgoing audio without unmuting and stops the old track only after success", async () => {
    const oldTrack = createTrack(false);
    const newTrack = createTrack(true);
    const senderA = createSender(oldTrack);
    const senderB = createSender(oldTrack);

    await expect(replaceActiveAudioTrack(
      createStream([oldTrack]),
      createStream([newTrack]),
      [senderA, senderB],
    )).resolves.toBe(true);

    expect(newTrack.enabled).toBe(false);
    expect(senderA.replaceTrack).toHaveBeenCalledWith(newTrack);
    expect(senderB.replaceTrack).toHaveBeenCalledWith(newTrack);
    expect(oldTrack.stop).toHaveBeenCalledOnce();
    expect(newTrack.stop).not.toHaveBeenCalled();
  });

  it("rolls senders back and keeps the old track alive when replacement fails", async () => {
    const oldTrack = createTrack(true);
    const newTrack = createTrack(true);
    const senderA = createSender(oldTrack);
    const senderB = createSender(oldTrack, true);

    await expect(replaceActiveAudioTrack(
      createStream([oldTrack]),
      createStream([newTrack]),
      [senderA, senderB],
    )).resolves.toBe(false);

    expect(senderA.replaceTrack).toHaveBeenNthCalledWith(1, newTrack);
    expect(senderA.replaceTrack).toHaveBeenNthCalledWith(2, oldTrack);
    expect(oldTrack.stop).not.toHaveBeenCalled();
    expect(newTrack.stop).toHaveBeenCalledOnce();
  });
});

describe("media device wiring", () => {
  it("connects SettingsModal and VoicePanel to the shared device contract", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const [settingsSource, voiceSource] = await Promise.all([
      readFile(`${root}/components/SettingsModal.tsx`, "utf8"),
      readFile(`${root}/components/VoicePanel.tsx`, "utf8"),
    ]);

    expect(settingsSource).toContain("saveAudioSettings({");
    expect(settingsSource).toContain("applyAudioOutputDevice(audio, selectedOutput)");
    expect(settingsSource).toContain("reconcileMediaDeviceSettings(");
    expect(settingsSource).toContain('navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange)');
    expect(settingsSource).toMatch(/requestVoiceStream\(\s*navigator\.mediaDevices,\s*selectedInput/);
    expect(voiceSource).toContain("window.addEventListener(MEDIA_DEVICE_SETTINGS_EVENT");
    expect(voiceSource).toContain('navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange)');
    expect(voiceSource).toContain("reconcileMediaDeviceSettings(");
    expect(voiceSource).toMatch(/requestVoiceStream\(\s*navigator\.mediaDevices/);
    expect(voiceSource).toMatch(/requestCameraStream\(\s*navigator\.mediaDevices/);
    expect(voiceSource).toContain("replaceActiveAudioTrack(");
    expect(voiceSource).toContain("applyAudioOutputDevice(audio, mediaDeviceSettingsRef.current.outputDevice)");
  });
});
