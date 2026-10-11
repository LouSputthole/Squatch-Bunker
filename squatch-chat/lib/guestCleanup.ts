import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  cleanupDeletedMessageUploads,
  type DeletableMessage,
  removeUnreferencedUpload,
} from "@/lib/messageRetention";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";

/**
 * Expired-guest sweep. Guests are 24h identities; once `guestExpiresAt`
 * passes, every session is refused (lib/auth.ts) and the account can never be
 * upgraded, so the rows only linger as ghost members.
 *
 * Two outcomes, chosen per guest:
 * - Deleted: a guest who left nothing other people rely on (no channel
 *   messages beyond their own "joined the server" notices, no DMs or DM thread
 *   holding anyone's messages, no owned server, polls, gatherings, journal
 *   entries, or private uploads, no open report filed by or against them) is
 *   removed outright with their personal rows and join notices.
 * - Retired: a guest whose words are part of other people's history (or who
 *   owns a camp) keeps the User row and name so that content still renders
 *   with an author, but loses memberships (except in servers they own, which
 *   still need an owner row), unsent scheduled messages, and everything
 *   scrubPersonalData removes; tokenVersion is bumped so no token can ever
 *   revive them. `isGuest && guestExpiresAt <= now` is the marker. Once
 *   retention removes their content, a later sweep deletes them.
 *   Terms section 4 and Privacy Policy section 7 describe this; keep in sync.
 *
 * Self-deleted accounts (lib/accountDeletion.ts) are turned into the same kind
 * of expired placeholder, so this sweep finishes deleting them too.
 */

export interface GuestSweepResult {
  deletedGuests: number;
  retiredGuests: number;
}

export const expiredGuest = (now: Date): Prisma.UserWhereInput => ({
  isGuest: true,
  guestExpiresAt: { lte: now },
});

/** Nothing anyone else can see or rely on would be lost by deleting the row. */
const leftNoTrace: Prisma.UserWhereInput = {
  messages: { none: { isSystem: false } },
  directMessages: { none: {} },
  ownedServers: { none: {} },
  privateUploads: { none: {} },
  journalEntries: { none: {} },
  createdPolls: { none: {} },
  createdGatherings: { none: {} },
  conversations1: { none: { messages: { some: {} } } },
  conversations2: { none: { messages: { some: {} } } },
  reportsFiled: { none: { status: "open" } },
  reportsAgainst: { none: { status: "open" } },
};

async function deleteGuest(userId: string, now: Date): Promise<{ avatar: string | null; banner: string | null } | null> {
  return prisma.$transaction(async (tx) => {
    // Re-check inside the transaction: content written since the candidate
    // query moves this guest to the retire path on the next pass.
    const user = await tx.user.findFirst({
      where: { id: userId, ...expiredGuest(now), ...leftNoTrace },
      select: { avatar: true, banner: true },
    });
    if (!user) return null;
    // Restrict-FK rows first; Cascade relations (notifications, reports,
    // blocks, poll votes, RSVPs) go with the user row.
    await tx.reaction.deleteMany({ where: { userId } });
    // Join notices are the guest's only messages here; others' reactions and
    // bookmarks on them cascade, and reply/thread links to them SET NULL.
    await tx.message.deleteMany({ where: { authorId: userId, isSystem: true } });
    await tx.directMessageReaction.deleteMany({ where: { userId } });
    await tx.bookmark.deleteMany({ where: { userId } });
    await tx.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } });
    await tx.conversation.deleteMany({ where: { OR: [{ user1Id: userId }, { user2Id: userId }] } });
    await tx.scheduledMessage.deleteMany({ where: { authorId: userId } });
    await tx.notificationPreference.deleteMany({ where: { userId } });
    // Notices they triggered in other people's inboxes spell out their name.
    await tx.notification.deleteMany({ where: { actorId: userId } });
    await tx.userNote.deleteMany({ where: { OR: [{ authorId: userId }, { targetUserId: userId }] } });
    await tx.oAuthAccount.deleteMany({ where: { userId } });
    await tx.serverMember.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
    return user;
  });
}

/** Files to remove once the transaction that scrubbed them has committed. */
export interface ScrubbedFiles {
  media: string[];
  files: DeletableMessage[];
}

/**
 * Remove what a deleted account or retired guest no longer needs while their
 * name stays as the author of content other people rely on: avatar, banner,
 * bio, and status message; reactions, DM reactions, poll votes, RSVPs,
 * bookmarks, Camp Journal entries, private notes by or about them, blocks they
 * made, friendships and requests, their inbox and notification settings,
 * notices they triggered in other inboxes, and reports they filed that are
 * already handled (open ones stay until a moderator closes them). Bumps
 * tokenVersion. Call removeScrubbedFiles after commit.
 */
export async function scrubPersonalData(tx: Prisma.TransactionClient, userId: string): Promise<ScrubbedFiles> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { avatar: true, banner: true } });
  const journal = await tx.journalEntry.findMany({
    where: { authorId: userId },
    select: { id: true, attachmentUrl: true, privateUploadId: true },
  });
  await tx.journalEntry.deleteMany({ where: { authorId: userId } });
  await tx.reaction.deleteMany({ where: { userId } });
  await tx.directMessageReaction.deleteMany({ where: { userId } });
  await tx.pollVote.deleteMany({ where: { userId } });
  await tx.gatheringRsvp.deleteMany({ where: { userId } });
  await tx.bookmark.deleteMany({ where: { userId } });
  await tx.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } });
  await tx.userBlock.deleteMany({ where: { blockerId: userId } });
  await tx.userNote.deleteMany({ where: { OR: [{ authorId: userId }, { targetUserId: userId }] } });
  await tx.notification.deleteMany({ where: { OR: [{ userId }, { actorId: userId }] } });
  await tx.notificationPreference.deleteMany({ where: { userId } });
  await tx.report.deleteMany({ where: { reporterId: userId, status: { not: "open" } } });
  await tx.user.update({
    where: { id: userId },
    data: { avatar: null, banner: null, bio: null, statusMessage: null, tokenVersion: { increment: 1 } },
  });
  return {
    media: [user?.avatar, user?.banner].filter((url): url is string => !!url),
    files: journal,
  };
}

export async function removeScrubbedFiles(scrubbed: ScrubbedFiles): Promise<void> {
  await Promise.all(scrubbed.media.map(removeUnreferencedUpload));
  await cleanupDeletedMessageUploads(scrubbed.files);
}

/**
 * Delete one expired guest (or a deleted account's placeholder, see
 * lib/accountDeletion.ts) now if they left no trace. Returns false, changing
 * nothing, while something other people rely on remains.
 */
export async function deleteExpiredGuest(userId: string, now = new Date()): Promise<boolean> {
  const removed = await deleteGuest(userId, now);
  if (!removed) return false;
  await notifyRealtimeAuthorizationChange({ scope: "session", userId });
  await Promise.all(
    [removed.avatar, removed.banner].filter((url): url is string => !!url).map(removeUnreferencedUpload),
  );
  return true;
}

async function retireGuest(userId: string): Promise<ScrubbedFiles> {
  return prisma.$transaction(async (tx) => {
    await tx.serverMember.deleteMany({ where: { userId, server: { ownerId: { not: userId } } } });
    await tx.scheduledMessage.deleteMany({ where: { authorId: userId, sent: false } });
    return scrubPersonalData(tx, userId);
  });
}

/** An expired guest still holding something retireGuest removes. */
const notYetRetired: Prisma.UserWhereInput[] = [
  { memberships: { some: { role: { not: "owner" } } } },
  { scheduledMessages: { some: { sent: false } } },
  { avatar: { not: null } },
  { banner: { not: null } },
  { bio: { not: null } },
  { statusMessage: { not: null } },
  { reactions: { some: {} } },
  { dmReactions: { some: {} } },
  { pollVotes: { some: {} } },
  { gatheringRsvps: { some: {} } },
  { bookmarks: { some: {} } },
  { journalEntries: { some: {} } },
  { sentRequests: { some: {} } },
  { recvRequests: { some: {} } },
  { blocksCreated: { some: {} } },
  { authoredNotes: { some: {} } },
  { targetedNotes: { some: {} } },
  { notifications: { some: {} } },
  { notificationPreferences: { some: {} } },
  { reportsFiled: { some: { status: { not: "open" } } } },
];

export async function sweepExpiredGuests(now = new Date(), limit = 100): Promise<GuestSweepResult> {
  const take = Math.max(1, Math.min(limit, 500));
  const result: GuestSweepResult = { deletedGuests: 0, retiredGuests: 0 };

  const deletable = await prisma.user.findMany({
    where: { ...expiredGuest(now), ...leftNoTrace },
    orderBy: { guestExpiresAt: "asc" },
    take,
    select: { id: true },
  });
  for (const { id } of deletable) {
    try {
      if (await deleteExpiredGuest(id, now)) result.deletedGuests += 1;
    } catch (error) {
      console.error("[Campfire] Failed to delete expired guest:", id, error);
    }
  }

  // Only guests still holding something to remove are selected, so retired
  // guests drop out of this query and can't starve newer ones. The owner's own
  // membership row is the only one with role "owner" (no ownership transfer exists).
  const retirable = await prisma.user.findMany({
    where: { ...expiredGuest(now), OR: notYetRetired },
    orderBy: { guestExpiresAt: "asc" },
    take,
    select: { id: true },
  });
  for (const { id } of retirable) {
    try {
      const scrubbed = await retireGuest(id);
      result.retiredGuests += 1;
      await notifyRealtimeAuthorizationChange({ scope: "session", userId: id });
      await removeScrubbedFiles(scrubbed);
    } catch (error) {
      console.error("[Campfire] Failed to retire expired guest:", id, error);
    }
  }

  return result;
}
