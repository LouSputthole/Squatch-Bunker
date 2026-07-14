import { unlink } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { resolvePrivateUploadPath } from "@/lib/privateUploads";
import { resolveUserMediaPath } from "@/lib/userMedia";

const DAY_MS = 24 * 60 * 60 * 1_000;
export const ALLOWED_RETENTION_DAYS = [1, 7, 30] as const;

export function isRetentionDays(value: unknown): value is (typeof ALLOWED_RETENTION_DAYS)[number] {
  return typeof value === "number" && ALLOWED_RETENTION_DAYS.includes(value as 1 | 7 | 30);
}

export function localUploadPath(url: string): string | null {
  if (!url.startsWith("/uploads/")) return null;
  return resolveUserMediaPath(url);
}

export async function removeUnreferencedUpload(url: string) {
  const path = localUploadPath(url);
  if (!path) return;

  try {
    const referenceCounts = await Promise.all([
      prisma.message.count({ where: { attachmentUrl: url } }),
      prisma.directMessage.count({ where: { attachmentUrl: url } }),
      prisma.journalEntry.count({ where: { attachmentUrl: url } }),
      prisma.user.count({ where: { OR: [{ avatar: url }, { banner: url }] } }),
      prisma.server.count({ where: { OR: [{ icon: url }, { banner: url }] } }),
      prisma.customEmoji.count({ where: { url } }),
    ]);
    if (referenceCounts.some((count) => count > 0)) return;

    await unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error("[Campfire] Failed to remove unreferenced upload:", path, error);
    }
  }
}

async function unlinkPrivateStorageKey(storageKey: string) {
  const path = resolvePrivateUploadPath(storageKey);
  if (!path) return;
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[Campfire] Failed to remove private attachment:", path, error);
    }
  }
}

export async function removeUnreferencedPrivateUpload(attachmentId: string) {
  try {
    const upload = await prisma.privateUpload.findUnique({
      where: { id: attachmentId },
      select: { storageKey: true },
    });
    if (!upload) return false;

    const deleted = await prisma.privateUpload.deleteMany({
      where: {
        id: attachmentId,
        message: { is: null },
        directMessage: { is: null },
        journalEntries: { none: {} },
      },
    });
    if (deleted.count !== 1) return false;
    await unlinkPrivateStorageKey(upload.storageKey);
    return true;
  } catch (error) {
    console.error(
      "[Campfire] Failed to remove unreferenced private attachment:",
      attachmentId,
      error,
    );
    return false;
  }
}

/**
 * Remove only uploads that have no surviving message, DM, or journal reference.
 * A non-zero retained count must block account deletion because the owner FK is RESTRICT.
 */
export async function removePrivateUploadsForOwnerDeletion(ownerId: string) {
  const uploads = await prisma.privateUpload.findMany({
    where: { ownerId },
    select: { id: true },
  });
  let deletedUploads = 0;
  for (const upload of uploads) {
    if (await removeUnreferencedPrivateUpload(upload.id)) deletedUploads += 1;
  }
  return {
    deletedUploads,
    retainedUploads: uploads.length - deletedUploads,
  };
}

export interface AbandonedPrivateUploadSweepResult {
  deletedUploads: number;
  examinedUploads: number;
}

export async function sweepAbandonedPrivateUploads(
  now = new Date(),
  maxAgeMs = DAY_MS,
  limit = 500,
): Promise<AbandonedPrivateUploadSweepResult> {
  const cutoff = new Date(now.getTime() - Math.max(1, maxAgeMs));
  const stale = await prisma.privateUpload.findMany({
    where: {
      state: "pending",
      claimKind: null,
      claimId: null,
      claimedAt: null,
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 2_000)),
    select: { id: true, storageKey: true },
  });

  let deletedUploads = 0;
  for (const upload of stale) {
    const deleted = await prisma.privateUpload.deleteMany({
      where: {
        id: upload.id,
        state: "pending",
        claimKind: null,
        claimId: null,
        message: { is: null },
        directMessage: { is: null },
        journalEntries: { none: {} },
      },
    });
    if (deleted.count !== 1) continue;
    deletedUploads += 1;
    await unlinkPrivateStorageKey(upload.storageKey);
  }
  return { deletedUploads, examinedUploads: stale.length };
}

export interface RetentionSweepResult {
  deletedMessages: number;
  processedChannels: number;
}

/**
 * Delete a bounded batch of expired messages from each leave-no-trace room.
 * Journal entries keep content snapshots and attachment references, so saved
 * moments survive source-message expiration.
 */
export async function sweepExpiredMessages(
  now = new Date(),
  perChannelLimit = 500,
): Promise<RetentionSweepResult> {
  const channels = await prisma.channel.findMany({
    where: { retentionDays: { not: null } },
    select: { id: true, retentionDays: true },
  });

  let deletedMessages = 0;
  for (const channel of channels) {
    if (!isRetentionDays(channel.retentionDays)) continue;
    const cutoff = new Date(now.getTime() - channel.retentionDays * DAY_MS);
    const expired = await prisma.message.findMany({
      where: { channelId: channel.id, createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
      take: Math.max(1, Math.min(perChannelLimit, 2_000)),
      select: { id: true, attachmentUrl: true, privateUploadId: true },
    });
    if (expired.length === 0) continue;

    const removed = await prisma.message.deleteMany({
      where: { id: { in: expired.map((message) => message.id) } },
    });
    deletedMessages += removed.count;

    const attachmentUrls = new Set(
      expired.map((message) => message.attachmentUrl).filter((url): url is string => !!url),
    );
    const privateUploadIds = new Set(
      expired.map((message) => message.privateUploadId).filter((id): id is string => !!id),
    );
    await Promise.all([
      ...[...attachmentUrls].map(removeUnreferencedUpload),
      ...[...privateUploadIds].map(removeUnreferencedPrivateUpload),
    ]);
  }

  return { deletedMessages, processedChannels: channels.length };
}
