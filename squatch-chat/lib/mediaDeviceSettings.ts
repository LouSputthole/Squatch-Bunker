export const AUDIO_SETTINGS_STORAGE_KEY = "campfire-audio-settings";
export const MEDIA_DEVICE_SETTINGS_EVENT = "campfire:media-device-settings";

export interface AudioSettings {
  inputDevice?: string;
  outputDevice?: string;
  videoDevice?: string;
  inputVolume?: number;
  outputVolume?: number;
  inputSensitivity?: number;
  messageNotifications?: boolean;
  masterEnabled?: boolean;
  messageSend?: boolean;
  messageReceive?: boolean;
  voice?: boolean;
  notifications?: boolean;
  volume?: number;
}

export interface MediaDeviceSettings {
  inputDevice: string;
  outputDevice: string;
  videoDevice: string;
}

export function parseAudioSettings(value: string | null): AudioSettings {
  if (!value) return {};

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object"
      ? parsed as AudioSettings
      : {};
  } catch {
    return {};
  }
}

export function readAudioSettings(): AudioSettings {
  if (typeof window === "undefined") return {};

  try {
    return parseAudioSettings(window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function getMediaDeviceSettings(settings: AudioSettings): MediaDeviceSettings {
  return {
    inputDevice: typeof settings.inputDevice === "string" ? settings.inputDevice : "",
    outputDevice: typeof settings.outputDevice === "string" ? settings.outputDevice : "",
    videoDevice: typeof settings.videoDevice === "string" ? settings.videoDevice : "",
  };
}

export function readMediaDeviceSettings(): MediaDeviceSettings {
  return getMediaDeviceSettings(readAudioSettings());
}

type EnumeratedMediaDevice = Pick<MediaDeviceInfo, "deviceId" | "kind">;

export function reconcileMediaDeviceSettings(
  settings: AudioSettings,
  devices: readonly EnumeratedMediaDevice[],
): { settings: AudioSettings; changed: boolean } {
  const availableDeviceIds = new Map<MediaDeviceKind, Set<string>>([
    ["audioinput", new Set()],
    ["audiooutput", new Set()],
    ["videoinput", new Set()],
  ]);

  for (const device of devices) {
    availableDeviceIds.get(device.kind)?.add(device.deviceId);
  }

  let reconciled = settings;
  let changed = false;
  const selections: ReadonlyArray<{
    setting: "inputDevice" | "outputDevice" | "videoDevice";
    kind: MediaDeviceKind;
  }> = [
    { setting: "inputDevice", kind: "audioinput" },
    { setting: "outputDevice", kind: "audiooutput" },
    { setting: "videoDevice", kind: "videoinput" },
  ];

  for (const { setting, kind } of selections) {
    const selectedDeviceId = settings[setting];
    if (
      typeof selectedDeviceId === "string"
      && selectedDeviceId
      && !availableDeviceIds.get(kind)?.has(selectedDeviceId)
    ) {
      if (!changed) reconciled = { ...settings };
      reconciled[setting] = "";
      changed = true;
    }
  }

  return { settings: reconciled, changed };
}

export function saveAudioSettings(settings: AudioSettings): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("[Settings] Could not persist audio settings:", error);
  }

  window.dispatchEvent(new CustomEvent<MediaDeviceSettings>(MEDIA_DEVICE_SETTINGS_EVENT, {
    detail: getMediaDeviceSettings(settings),
  }));
}

export function buildVoiceAudioConstraints(deviceId: string): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

export function buildCameraVideoConstraints(deviceId: string): MediaTrackConstraints {
  return {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

type UserMediaRequester = Pick<MediaDevices, "getUserMedia">;

export interface MediaStreamRequestResult {
  stream: MediaStream;
  usedDefault: boolean;
}

function isStaleMediaDeviceError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const name = "name" in error ? error.name : undefined;
  return name === "NotFoundError" || name === "OverconstrainedError";
}

async function requestPreferredDeviceStream(
  mediaDevices: UserMediaRequester,
  deviceId: string,
  preferredConstraints: MediaStreamConstraints,
  defaultConstraints: MediaStreamConstraints,
): Promise<MediaStreamRequestResult> {
  try {
    return {
      stream: await mediaDevices.getUserMedia(preferredConstraints),
      usedDefault: false,
    };
  } catch (error) {
    if (!deviceId || !isStaleMediaDeviceError(error)) throw error;
    return {
      stream: await mediaDevices.getUserMedia(defaultConstraints),
      usedDefault: true,
    };
  }
}

export function requestVoiceStream(
  mediaDevices: UserMediaRequester,
  deviceId: string,
): Promise<MediaStreamRequestResult> {
  return requestPreferredDeviceStream(
    mediaDevices,
    deviceId,
    {
      audio: buildVoiceAudioConstraints(deviceId),
      video: false,
    },
    {
      audio: buildVoiceAudioConstraints(""),
      video: false,
    },
  );
}

export function requestCameraStream(
  mediaDevices: UserMediaRequester,
  deviceId: string,
): Promise<MediaStreamRequestResult> {
  return requestPreferredDeviceStream(
    mediaDevices,
    deviceId,
    {
      audio: false,
      video: buildCameraVideoConstraints(deviceId),
    },
    {
      audio: false,
      video: buildCameraVideoConstraints(""),
    },
  );
}

type SinkSelectableMediaElement = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export async function applyAudioOutputDevice(
  element: HTMLMediaElement,
  deviceId: string,
): Promise<boolean> {
  const sinkElement = element as SinkSelectableMediaElement;
  if (typeof sinkElement.setSinkId !== "function") return false;

  try {
    await sinkElement.setSinkId(deviceId || "");
    return true;
  } catch (error) {
    console.warn("[Audio] Could not select output device; using the browser default:", error);
    return false;
  }
}

export async function replaceActiveAudioTrack(
  currentStream: MediaStream,
  replacementStream: MediaStream,
  senders: Iterable<RTCRtpSender>,
): Promise<boolean> {
  const previousTracks = currentStream.getAudioTracks();
  const previousTrack = previousTracks[0] ?? null;
  const replacementTracks = replacementStream.getAudioTracks();
  const replacementTrack = replacementTracks[0];

  if (!replacementTrack) {
    replacementStream.getTracks().forEach((track) => track.stop());
    return false;
  }

  // A device change must preserve mute/PTT state. If the old stream is already
  // missing its audio track, default to muted rather than opening the mic.
  replacementTrack.enabled = previousTrack?.enabled ?? false;

  const audioSenders = Array.from(senders).filter((sender) => sender.track?.kind === "audio");
  const replacedSenders: RTCRtpSender[] = [];

  try {
    for (const sender of audioSenders) {
      await sender.replaceTrack(replacementTrack);
      replacedSenders.push(sender);
    }
  } catch {
    await Promise.allSettled(
      replacedSenders.map((sender) => sender.replaceTrack(previousTrack)),
    );
    replacementStream.getTracks().forEach((track) => track.stop());
    return false;
  }

  replacementStream.getTracks()
    .filter((track) => track !== replacementTrack)
    .forEach((track) => track.stop());
  previousTracks.forEach((track) => track.stop());
  return true;
}
