import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, unlink } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isInstanceAdmin } from "@/lib/instanceAdmin";
import {
  cleanupDeletedMessageUploads,
  collectThreadReplies,
  type DeletableMessage,
  localUploadPath,
} from "@/lib/messageRetention";
import { privateAttachmentUrl, resolvePrivateUploadPath } from "@/lib/privateUploads";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";
import { type ReportResolution, snippetOf } from "@/lib/reports";
import { deleteServerWithContent } from "@/lib/serverDeletion";

/**
 * Instance-wide moderation for the operator (INSTANCE_ADMIN_USER_IDS) on
 * /admin, through POST /api/admin/moderation, which checks isInstanceAdmin
 * before calling anything here. Every action writes an InstanceAuditLog row in
 * the same transaction as the change.
 *
 * - Suspend: User.disabledAt is set and tokenVersion bumped, so every session
 *   dies at once (lib/auth.ts and the socket handshake refuse disabled users,
 *   and open sockets are disconnected). Sign-in, guest upgrade, and
 *   GitHub/Google sign-in refuse the account. A suspended account stays
 *   visible (name, past messages, memberships) but can't do anything.
 * - Identity block (optional on suspend): SHA-256 hashes of the account's
 *   email and GitHub/Google ids go into BannedIdentity, checked at sign-up,
 *   guest upgrade, and GitHub/Google sign-up. Unsuspending lifts both.
 * - Remove: a message (with its thread replies, Journal copies, and inbox
 *   previews), a DM, or a file is deleted for everyone.
 * - Remove with evidence hold: the same, except the removed rows are frozen as
 *   JSON in an EvidenceHold row and their files are moved (not deleted) into a
 *   private evidence folder no route serves. Content that is gone from the live
 *   tables can't leak through a forgotten query, and later camp or account
 *   deletion can't touch the copy. Expired holds are purged by the hourly
 *   retention sweep (server.ts).
 * - Delete camp: the owner's cascade (lib/serverDeletion.ts), without the
 *   ownership check.
 */

export type ModerationResult = { ok: true } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ModerationResult => ({ ok: false, status, error });

/**
 * 18 U.S.C. 2258A(h), as amended by the REPORT Act (2024), requires a provider
 * that reports to the NCMEC CyberTipline to preserve the reported content and
 * related account information for 1 year. Not legal advice: the operator can
 * keep a copy longer outside the app if a legal request asks for it.
 */
export const EVIDENCE_HOLD_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getEvidenceRoot(): string {
  const configuredRoot = process.env.CAMPFIRE_UPLOAD_DIR?.trim();
  return configuredRoot
    ? resolve(configuredRoot, "evidence")
    : resolve(process.cwd(), "data", "evidence");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * ponytail: lowercase + trim only, the same normalization sign-up uses. Gmail
 * "+tag" or dot variants and any other address still get in, and an unsalted
 * hash of a guessable address can be confirmed by whoever holds the database.
 */
export function emailIdentityHash(email: string): string {
  return sha256(`email:${email.trim().toLowerCase()}`);
}

export function oauthIdentityHash(provider: string, providerAccountId: string): string {
  return sha256(`oauth:${provider}:${providerAccountId}`);
}

export async function isIdentityBanned(hashes: string[]): Promise<boolean> {
  return (await prisma.bannedIdentity.count({ where: { hash: { in: hashes } } })) > 0;
}

interface IdentitySource {
  email: string;
  isGuest: boolean;
  oauthAccounts: Array<{ provider: string; providerAccountId: string }>;
}

const identitySelect = {
  email: true,
  isGuest: true,
  oauthAccounts: { select: { provider: true, providerAccountId: true } },
} satisfies Prisma.UserSelect;

/** Guests' emails are made up, so only registered emails are worth blocking. */
function identitiesOf(user: IdentitySource) {
  return [
    ...(user.isGuest ? [] : [{ hash: emailIdentityHash(user.email), kind: "email" }]),
    ...user.oauthAccounts.map((account) => ({
      hash: oauthIdentityHash(account.provider, account.providerAccountId),
      kind: "oauth",
    })),
  ];
}

interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
}

function audit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  return tx.instanceAuditLog.create({ data: entry });
}

export async function suspendUser(
  actorId: string,
  userId: string,
  reason: string,
  blockIdentity: boolean,
  now = new Date(),
): Promise<ModerationResult> {
  if (userId === actorId || isInstanceAdmin(userId)) {
    return fail(403, "Instance admins can't be suspended");
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: identitySelect });
  if (!user) return fail(404, "User not found");
  const identities = blockIdentity ? identitiesOf(user) : [];

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { disabledAt: now, disabledReason: reason, tokenVersion: { increment: 1 } },
    });
    for (const identity of identities) {
      await tx.bannedIdentity.upsert({ where: { hash: identity.hash }, create: identity, update: {} });
    }
    await audit(tx, {
      actorId,
      action: blockIdentity ? "suspend_user_and_block_identity" : "suspend_user",
      targetType: "user",
      targetId: userId,
      reason,
    });
  });
  await notifyRealtimeAuthorizationChange({ scope: "session", userId });
  return { ok: true };
}

export async function unsuspendUser(actorId: string, userId: string, reason: string): Promise<ModerationResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: identitySelect });
  if (!user) return fail(404, "User not found");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { disabledAt: null, disabledReason: null } });
    await tx.bannedIdentity.deleteMany({
      where: { hash: { in: identitiesOf(user).map((identity) => identity.hash) } },
    });
    await audit(tx, { actorId, action: "unsuspend_user", targetType: "user", targetId: userId, reason });
  });
  return { ok: true };
}

// ─── Removal and evidence holds ───

interface HeldFile {
  source: string;
  /** File name in the evidence folder; null when the file was already gone. */
  key: string | null;
}

async function moveFile(from: string, to: string) {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await unlink(from);
  }
}

/**
 * Move files into the evidence folder. If any move fails, the ones already
 * moved go back and the error is rethrown; `restore` does the same for a
 * transaction that fails afterwards.
 */
async function quarantine(holdId: string, files: Array<{ source: string; path: string }>) {
  const root = getEvidenceRoot();
  await mkdir(root, { recursive: true });
  const moved: Array<{ from: string; to: string }> = [];
  const restore = async () => {
    for (const { from, to } of moved) {
      await moveFile(to, from).catch((error) =>
        console.error("[Campfire] Could not restore a quarantined file:", to, error),
      );
    }
  };
  const held: HeldFile[] = [];
  try {
    for (const [index, file] of files.entries()) {
      const key = `${holdId}-${index}${extname(file.path)}`;
      const to = resolve(root, key);
      try {
        await moveFile(file.path, to);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        held.push({ source: file.source, key: null });
        continue;
      }
      moved.push({ from: file.path, to });
      held.push({ source: file.source, key });
    }
  } catch (error) {
    await restore();
    throw error;
  }
  return { held, restore };
}

interface RemovableRow {
  id: string;
  attachmentUrl: string | null;
  privateUploadId: string | null;
  privateUpload: { storageKey: string } | null;
}

/** The app's own files behind these rows (uploads and private attachments), once each. */
function localFilesOf(rows: RemovableRow[]) {
  const files = new Map<string, string>();
  for (const row of rows) {
    const publicPath = row.attachmentUrl ? localUploadPath(row.attachmentUrl) : null;
    if (publicPath) files.set(publicPath, row.attachmentUrl!);
    const privatePath = row.privateUpload ? resolvePrivateUploadPath(row.privateUpload.storageKey) : null;
    if (privatePath) files.set(privatePath, row.attachmentUrl ?? `private upload ${row.privateUploadId}`);
  }
  return [...files].map(([path, source]) => ({ path, source }));
}

interface Removal {
  actorId: string;
  reason: string;
  evidence: boolean;
  now: Date;
  targetType: "message" | "direct_message";
  targetId: string;
  rows: RemovableRow[];
  /** Deletes the rows (and their copies); returns copies whose files may need cleanup. */
  remove: (tx: Prisma.TransactionClient) => Promise<DeletableMessage[]>;
}

async function removeRows(removal: Removal): Promise<void> {
  const holdId = randomUUID();
  const { held, restore } = removal.evidence
    ? await quarantine(holdId, localFilesOf(removal.rows))
    : { held: [] as HeldFile[], restore: async () => {} };
  let copies: DeletableMessage[];
  try {
    copies = await prisma.$transaction(async (tx) => {
      const removedCopies = await removal.remove(tx);
      if (removal.evidence) {
        const uploadIds = removal.rows
          .map((row) => row.privateUploadId)
          .filter((id): id is string => !!id);
        await tx.privateUpload.deleteMany({ where: { id: { in: uploadIds } } });
        await tx.evidenceHold.create({
          data: {
            id: holdId,
            actorId: removal.actorId,
            targetType: removal.targetType,
            targetId: removal.targetId,
            reason: removal.reason,
            snapshot: JSON.stringify({ removedAt: removal.now, rows: removal.rows, files: held }),
            expiresAt: new Date(removal.now.getTime() + EVIDENCE_HOLD_DAYS * DAY_MS),
          },
        });
      }
      await audit(tx, {
        actorId: removal.actorId,
        action: removal.evidence ? "remove_with_evidence_hold" : "remove",
        targetType: removal.targetType,
        targetId: removal.targetId,
        reason: removal.reason,
      });
      return removedCopies;
    });
  } catch (error) {
    await restore();
    throw error;
  }
  if (!removal.evidence) await cleanupDeletedMessageUploads([...removal.rows, ...copies]);
}

/** Everything a removed message's evidence hold keeps, including the author's account details. */
const heldAuthor = { select: { id: true, username: true, email: true, createdAt: true } } as const;
const heldUpload = { select: { storageKey: true, originalName: true, contentType: true, byteSize: true } } as const;

/**
 * Remove a camp message (with its thread replies, Journal copies, and inbox
 * previews) or a DM, by id. Open reports on removed messages are resolved.
 */
export async function removeMessage(
  actorId: string,
  messageId: string,
  reason: string,
  evidence: boolean,
  now = new Date(),
): Promise<ModerationResult> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true } });
  if (!message) return removeDirectMessage(actorId, messageId, reason, evidence, now);

  const ids = [messageId, ...(await collectThreadReplies(prisma, [messageId])).map((reply) => reply.id)];
  const rows = await prisma.message.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      content: true,
      attachmentUrl: true,
      attachmentName: true,
      privateUploadId: true,
      parentMessageId: true,
      createdAt: true,
      editedAt: true,
      author: heldAuthor,
      channel: { select: { id: true, name: true, server: { select: { id: true, name: true } } } },
      privateUpload: heldUpload,
    },
  });
  await removeRows({
    actorId,
    reason,
    evidence,
    now,
    targetType: "message",
    targetId: messageId,
    rows,
    remove: async (tx) => {
      const copies = await tx.journalEntry.findMany({
        where: { sourceMessageId: { in: ids } },
        select: { id: true, attachmentUrl: true, privateUploadId: true },
      });
      await tx.journalEntry.deleteMany({ where: { id: { in: copies.map((copy) => copy.id) } } });
      await tx.notification.deleteMany({ where: { messageId: { in: ids } } });
      await tx.message.deleteMany({ where: { id: { in: ids } } });
      await tx.report.updateMany({ where: { messageId: { in: ids }, status: "open" }, data: { status: "resolved" } });
      return copies;
    },
  });
  await notifyRealtimeAuthorizationChange({ scope: "messages", channelId: message.channelId, messageIds: ids });
  return { ok: true };
}

async function removeDirectMessage(
  actorId: string,
  messageId: string,
  reason: string,
  evidence: boolean,
  now: Date,
): Promise<ModerationResult> {
  const row = await prisma.directMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversationId: true,
      content: true,
      attachmentUrl: true,
      attachmentName: true,
      privateUploadId: true,
      createdAt: true,
      author: heldAuthor,
      conversation: { select: { user1Id: true, user2Id: true } },
      privateUpload: heldUpload,
    },
  });
  if (!row) return fail(404, "Message not found");
  // ponytail: no DM delete event exists, so open DM windows drop it on reload.
  await removeRows({
    actorId,
    reason,
    evidence,
    now,
    targetType: "direct_message",
    targetId: messageId,
    rows: [row],
    remove: async (tx) => {
      await tx.notification.deleteMany({ where: { messageId } });
      await tx.directMessage.delete({ where: { id: messageId } });
      return [];
    },
  });
  return { ok: true };
}

/**
 * Remove one stored file wherever it is used: a message, DM, or Journal
 * attachment, an avatar, banner, camp icon, or custom emoji. References are
 * cleared and the file deleted, or moved into an evidence hold.
 */
export async function removeFile(
  actorId: string,
  address: string,
  reason: string,
  evidence: boolean,
  now = new Date(),
): Promise<ModerationResult> {
  let pathname: string;
  let attachmentId: string | undefined;
  try {
    pathname = new URL(address, "http://campfire.invalid").pathname;
    const encodedId = /^\/api\/attachments\/([^/]+)$/.exec(pathname)?.[1];
    attachmentId = encodedId === undefined ? undefined : decodeURIComponent(encodedId);
  } catch {
    return fail(400, "That isn't a file address");
  }

  const upload = attachmentId
    ? await prisma.privateUpload.findUnique({
      where: { id: attachmentId },
      select: { id: true, storageKey: true, originalName: true, contentType: true, byteSize: true, owner: heldAuthor },
    })
    : null;
  if (attachmentId && !upload) return fail(404, "File not found");
  const url = upload ? privateAttachmentUrl(upload.id) : pathname;
  const path = upload ? resolvePrivateUploadPath(upload.storageKey) : localUploadPath(pathname);
  if (!path) return fail(400, "Paste a /uploads/, /avatars/, or /api/attachments/ address");
  if (!upload && !existsSync(path)) return fail(404, "File not found");

  const holdId = randomUUID();
  let held: HeldFile[] = [];
  let restore = async () => {};
  let usedBy: unknown = null;
  if (evidence) {
    const [messages, directMessages, users, servers] = await Promise.all([
      prisma.message.findMany({ where: { attachmentUrl: url }, select: { id: true, channelId: true, author: heldAuthor } }),
      prisma.directMessage.findMany({ where: { attachmentUrl: url }, select: { id: true, conversationId: true, author: heldAuthor } }),
      prisma.user.findMany({ where: { OR: [{ avatar: url }, { banner: url }] }, select: heldAuthor.select }),
      prisma.server.findMany({ where: { OR: [{ icon: url }, { banner: url }] }, select: { id: true, name: true, ownerId: true } }),
    ]);
    usedBy = { messages, directMessages, users, servers };
    ({ held, restore } = await quarantine(holdId, [{ source: url, path }]));
  }

  try {
    await prisma.$transaction(async (tx) => {
      const cleared = { attachmentUrl: null, attachmentName: null };
      await tx.message.updateMany({ where: { attachmentUrl: url }, data: cleared });
      await tx.directMessage.updateMany({ where: { attachmentUrl: url }, data: cleared });
      await tx.journalEntry.updateMany({ where: { attachmentUrl: url }, data: cleared });
      await tx.user.updateMany({ where: { avatar: url }, data: { avatar: null } });
      await tx.user.updateMany({ where: { banner: url }, data: { banner: null } });
      await tx.server.updateMany({ where: { icon: url }, data: { icon: null } });
      await tx.server.updateMany({ where: { banner: url }, data: { banner: null } });
      await tx.customEmoji.deleteMany({ where: { url } });
      if (upload) await tx.privateUpload.delete({ where: { id: upload.id } });
      if (evidence) {
        await tx.evidenceHold.create({
          data: {
            id: holdId,
            actorId,
            targetType: "file",
            targetId: url,
            reason,
            snapshot: JSON.stringify({ removedAt: now, upload, usedBy, files: held }),
            expiresAt: new Date(now.getTime() + EVIDENCE_HOLD_DAYS * DAY_MS),
          },
        });
      }
      await audit(tx, {
        actorId,
        action: evidence ? "remove_with_evidence_hold" : "remove",
        targetType: "file",
        targetId: url,
        reason,
      });
    });
  } catch (error) {
    await restore();
    throw error;
  }
  if (!evidence) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return { ok: true };
}

export async function deleteCamp(actorId: string, serverId: string, reason: string): Promise<ModerationResult> {
  const deleted = await deleteServerWithContent(serverId, (tx) =>
    audit(tx, { actorId, action: "delete_camp", targetType: "server", targetId: serverId, reason }),
  );
  return deleted ? { ok: true } : fail(404, "Camp not found");
}

export async function closeReport(
  actorId: string,
  reportId: string,
  resolution: ReportResolution,
  reason: string,
): Promise<ModerationResult> {
  const closed = await prisma.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({ where: { id: reportId }, data: { status: resolution } });
    if (updated.count === 0) return false;
    await audit(tx, { actorId, action: `report_${resolution}`, targetType: "report", targetId: reportId, reason });
    return true;
  });
  return closed ? { ok: true } : fail(404, "Report not found");
}

const EVIDENCE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

/** Delete expired evidence holds and their files (hourly, from server.ts). */
export async function sweepExpiredEvidenceHolds(now = new Date(), limit = 100): Promise<number> {
  const expired = await prisma.evidenceHold.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true, snapshot: true },
  });
  const root = getEvidenceRoot();
  let purged = 0;
  for (const hold of expired) {
    let files: HeldFile[] = [];
    try {
      files = (JSON.parse(hold.snapshot) as { files?: HeldFile[] }).files ?? [];
    } catch {
      // A snapshot that doesn't parse names no files to remove.
    }
    try {
      for (const { key } of files) {
        if (!key || !EVIDENCE_KEY.test(key)) continue;
        await unlink(resolve(root, key)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      await prisma.evidenceHold.delete({ where: { id: hold.id } });
      purged += 1;
    } catch (error) {
      console.error("[Campfire] Failed to purge an expired evidence hold:", hold.id, error);
    }
  }
  return purged;
}

// ─── Lookup for /admin ───

export interface ModerationLookup {
  user: {
    id: string;
    username: string;
    isGuest: boolean;
    createdAt: string;
    disabledAt: string | null;
    disabledReason: string | null;
    isInstanceAdmin: boolean;
    messages: number;
    ownedCamps: number;
  } | null;
  message: { id: string; snippet: string; author: string; channelName: string; serverName: string } | null;
  directMessage: { id: string; snippet: string; author: string; createdAt: string } | null;
  server: { id: string; name: string; owner: string; members: number } | null;
  file: { address: string } | null;
}

/** Find whatever an id, username, or file address names. */
export async function lookupModerationTarget(query: string): Promise<ModerationLookup> {
  const isFile = /^(https?:\/\/[^/]+)?\/(uploads|avatars|api\/attachments)\//.test(query);
  if (isFile) return { user: null, message: null, directMessage: null, server: null, file: { address: query } };

  const [user, message, directMessage, server] = await Promise.all([
    prisma.user.findFirst({
      where: { OR: [{ id: query }, { username: query }] },
      select: {
        id: true,
        username: true,
        isGuest: true,
        createdAt: true,
        disabledAt: true,
        disabledReason: true,
        _count: { select: { messages: true, ownedServers: true } },
      },
    }),
    prisma.message.findUnique({
      where: { id: query },
      select: {
        id: true,
        content: true,
        author: { select: { username: true } },
        channel: { select: { name: true, server: { select: { name: true } } } },
      },
    }),
    prisma.directMessage.findUnique({
      where: { id: query },
      select: { id: true, content: true, createdAt: true, author: { select: { username: true } } },
    }),
    prisma.server.findUnique({
      where: { id: query },
      select: { id: true, name: true, owner: { select: { username: true } }, _count: { select: { members: true } } },
    }),
  ]);
  return {
    user: user && {
      id: user.id,
      username: user.username,
      isGuest: user.isGuest,
      createdAt: user.createdAt.toISOString(),
      disabledAt: user.disabledAt?.toISOString() ?? null,
      disabledReason: user.disabledReason,
      isInstanceAdmin: isInstanceAdmin(user.id),
      messages: user._count.messages,
      ownedCamps: user._count.ownedServers,
    },
    message: message && {
      id: message.id,
      snippet: snippetOf(message.content),
      author: message.author.username,
      channelName: message.channel.name,
      serverName: message.channel.server.name,
    },
    directMessage: directMessage && {
      id: directMessage.id,
      snippet: snippetOf(directMessage.content),
      author: directMessage.author.username,
      createdAt: directMessage.createdAt.toISOString(),
    },
    server: server && {
      id: server.id,
      name: server.name,
      owner: server.owner.username,
      members: server._count.members,
    },
    file: null,
  };
}
