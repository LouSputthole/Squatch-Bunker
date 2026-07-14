export const VOICE_ROOM_MODES = [
  { id: "hangout", label: "Hangout", description: "An open fire for everyday conversation", defaultScene: "campfire" },
  { id: "game-night", label: "Game Night", description: "High-energy play, callouts, and watch parties", defaultScene: "night" },
  { id: "quiet-room", label: "Quiet Room", description: "Low-pressure company for focus or winding down", defaultScene: "rain" },
  { id: "workshop", label: "Workshop", description: "Build, teach, review, and share screens together", defaultScene: "cave" },
  { id: "story-time", label: "Story Time", description: "A listening circle made for Pass the Lantern", defaultScene: "forest" },
] as const;

export const VOICE_ROOM_SCENES = [
  { id: "campfire", label: "Campfire" },
  { id: "forest", label: "Forest" },
  { id: "rain", label: "Rainstorm" },
  { id: "ocean", label: "Ocean" },
  { id: "night", label: "Night Sky" },
  { id: "cave", label: "Cave" },
] as const;

export type VoiceRoomMode = (typeof VOICE_ROOM_MODES)[number]["id"];
export type VoiceRoomScene = (typeof VOICE_ROOM_SCENES)[number]["id"];

const MODE_IDS = new Set<string>(VOICE_ROOM_MODES.map((mode) => mode.id));
const SCENE_IDS = new Set<string>(VOICE_ROOM_SCENES.map((scene) => scene.id));

export function isVoiceRoomMode(value: unknown): value is VoiceRoomMode {
  return typeof value === "string" && MODE_IDS.has(value);
}

export function isVoiceRoomScene(value: unknown): value is VoiceRoomScene {
  return typeof value === "string" && SCENE_IDS.has(value);
}

export function voiceRoomModeLabel(value: string | null | undefined): string {
  return VOICE_ROOM_MODES.find((mode) => mode.id === value)?.label || "Hangout";
}

export function normalizeVoiceRoomConfig(input: {
  mode?: unknown;
  scene?: unknown;
}): { roomMode: VoiceRoomMode; roomScene: VoiceRoomScene } | null {
  const mode = input.mode ?? "hangout";
  if (!isVoiceRoomMode(mode)) return null;

  const selectedMode = VOICE_ROOM_MODES.find((candidate) => candidate.id === mode)!;
  const scene = input.scene ?? selectedMode.defaultScene;
  if (!isVoiceRoomScene(scene)) return null;

  return { roomMode: mode, roomScene: scene };
}
