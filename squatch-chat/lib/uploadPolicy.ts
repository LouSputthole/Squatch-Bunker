export const VOICE_NOTE_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_NOTE_MAX_DURATION_SECONDS = 120;
export const VOICE_NOTE_LABEL = "Campfire voice note";

const STANDARD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/zip": "zip",
};

const VOICE_NOTE_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
};

export interface UploadCandidate {
  name: string;
  type: string;
  size: number;
}

export type UploadPolicyResult =
  | {
      allowed: true;
      extension: string;
      kind: "file" | "voice-note";
      maxBytes: number;
    }
  | {
      allowed: false;
      error: string;
      status: 400 | 413;
    };

function normalizeMime(type: string): string {
  return type.split(";", 1)[0].trim().toLowerCase();
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function sizeLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Resolve the storage extension and size ceiling for one upload. Voice notes
 * intentionally require both an explicit audio MIME and its matching extension
 * so a generic upload cannot opt into executable or ambiguous media formats.
 */
export function evaluateUploadPolicy(
  file: UploadCandidate,
  generalMaxBytes: number,
): UploadPolicyResult {
  const mime = normalizeMime(file.type);
  const extension = fileExtension(file.name);
  const voiceExtension = VOICE_NOTE_TYPES[mime];

  if (voiceExtension) {
    if (extension !== voiceExtension) {
      return {
        allowed: false,
        error: "Voice note type and file extension do not match.",
        status: 400,
      };
    }
    if (file.size > VOICE_NOTE_MAX_BYTES) {
      return {
        allowed: false,
        error: `Voice note too large. Maximum size is ${sizeLabel(VOICE_NOTE_MAX_BYTES)}.`,
        status: 413,
      };
    }
    return {
      allowed: true,
      extension: voiceExtension,
      kind: "voice-note",
      maxBytes: VOICE_NOTE_MAX_BYTES,
    };
  }

  const standardExtension = STANDARD_TYPES[mime];
  if (!standardExtension) {
    return { allowed: false, error: "File type not allowed.", status: 400 };
  }
  if (file.size > generalMaxBytes) {
    return {
      allowed: false,
      error: `File too large. Maximum size is ${sizeLabel(generalMaxBytes)}.`,
      status: 413,
    };
  }

  return {
    allowed: true,
    extension: standardExtension,
    kind: "file",
    maxBytes: generalMaxBytes,
  };
}
