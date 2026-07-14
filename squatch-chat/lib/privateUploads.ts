import { resolve } from "node:path";
import type { Prisma } from "@/generated/prisma/client";

export const PRIVATE_UPLOAD_DIRECTORY = "private-uploads";

export function getPrivateUploadRoot(): string {
  const configuredRoot = process.env.CAMPFIRE_UPLOAD_DIR?.trim();
  return configuredRoot
    ? resolve(configuredRoot, PRIVATE_UPLOAD_DIRECTORY)
    : resolve(process.cwd(), "data", PRIVATE_UPLOAD_DIRECTORY);
}

export function resolvePrivateUploadPath(
  storageKey: string,
  root = getPrivateUploadRoot(),
): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(storageKey)) return null;
  return resolve(root, storageKey);
}

export function privateAttachmentUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}`;
}

export type PrivateUploadClaimKind = "channel-message" | "direct-message";

export class PrivateUploadClaimError extends Error {
  constructor() {
    super("Attachment is unavailable");
    this.name = "PrivateUploadClaimError";
  }
}

interface ClaimPrivateUploadInput {
  attachmentId: string;
  ownerId: string;
  claimKind: PrivateUploadClaimKind;
  claimId: string;
}

export async function claimPrivateUpload(
  transaction: Pick<Prisma.TransactionClient, "privateUpload">,
  input: ClaimPrivateUploadInput,
) {
  const claimed = await transaction.privateUpload.updateMany({
    where: {
      id: input.attachmentId,
      ownerId: input.ownerId,
      state: "pending",
      claimKind: null,
      claimId: null,
    },
    data: {
      state: "claimed",
      claimKind: input.claimKind,
      claimId: input.claimId,
      claimedAt: new Date(),
    },
  });
  if (claimed.count !== 1) throw new PrivateUploadClaimError();
  const upload = await transaction.privateUpload.findUnique({
    where: { id: input.attachmentId },
  });
  if (!upload) throw new PrivateUploadClaimError();
  return upload;
}

export type RemoteAttachmentResult =
  | { ok: true; url: string | null }
  | { ok: false };

export function parseRemoteAttachmentUrl(value: unknown): RemoteAttachmentResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, url: null };
  }
  if (typeof value !== "string") return { ok: false };
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return { ok: false };
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false };
  }
}

export type ByteRange = { start: number; end: number };

export function parseSingleByteRange(
  header: string | null,
  size: number,
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return "unsatisfiable";

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "unsatisfiable";
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function replaceUnpairedSurrogates(value: string): string {
  let safe = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        safe += value[index] + value[index + 1];
        index += 1;
      } else {
        safe += "\uFFFD";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      safe += "\uFFFD";
    } else {
      safe += value[index];
    }
  }
  return safe;
}

export function privateContentDisposition(originalName: string): string {
  const safeName = replaceUnpairedSurrogates(originalName);
  const asciiName = safeName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\\r\n]/g, "_")
    .slice(0, 180) || "attachment";
  const encodedName = encodeURIComponent(safeName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
