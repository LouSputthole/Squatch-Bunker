import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { removeUnreferencedUpload } from "@/lib/messageRetention";
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
 * - Retired: a guest whose words are part of other people's history keeps the
 *   User row so those messages still render with an author, but loses every
 *   tie that makes them look present: memberships (except in servers they own,
 *   which still need an owner row), friendships, RSVPs, bookmarks, inbox rows,
 *   preferences, and unsent scheduled messages; tokenVersion is bumped so no
 *   token can ever revive them. `isGuest && guestExpiresAt <= now` is the
 *   marker. Once retention removes their content, a later sweep deletes them.
 */

export interface GuestSweepResult {
  deletedGuests: number;
  retiredGuests: number;
}

const expiredGuest = (now: Date): Prisma.UserWhereInput => ({
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
    await tx.userNote.deleteMany({ where: { OR: [{ authorId: userId }, { targetUserId: userId }] } });
    await tx.oAuthAccount.deleteMany({ where: { userId } });
    await tx.serverMember.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
    return user;
  });
}

async function retireGuest(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.serverMember.deleteMany({ where: { userId, server: { ownerId: { not: userId } } } }),
    prisma.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
    prisma.gatheringRsvp.deleteMany({ where: { userId } }),
    prisma.bookmark.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.notificationPreference.deleteMany({ where: { userId } }),
    prisma.scheduledMessage.deleteMany({ where: { authorId: userId, sent: false } }),
    prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
  ]);
}

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
      const removed = await deleteGuest(id, now);
      if (!removed) continue;
      result.deletedGuests += 1;
      await notifyRealtimeAuthorizationChange({ scope: "session", userId: id });
      await Promise.all(
        [removed.avatar, removed.banner].filter((url): url is string => !!url).map(removeUnreferencedUpload),
      );
    } catch (error) {
      console.error("[Campfire] Failed to delete expired guest:", id, error);
    }
  }

  // Only guests that still look present are selected, so retired guests drop
  // out of this query and can't starve newer ones. The owner's own membership
  // row is the only one with role "owner" (no ownership transfer exists).
  const retirable = await prisma.user.findMany({
    where: {
      ...expiredGuest(now),
      OR: [
        { memberships: { some: { role: { not: "owner" } } } },
        { sentRequests: { some: {} } },
        { recvRequests: { some: {} } },
        { gatheringRsvps: { some: {} } },
        { scheduledMessages: { some: { sent: false } } },
      ],
    },
    orderBy: { guestExpiresAt: "asc" },
    take,
    select: { id: true },
  });
  for (const { id } of retirable) {
    try {
      await retireGuest(id);
      result.retiredGuests += 1;
      await notifyRealtimeAuthorizationChange({ scope: "session", userId: id });
    } catch (error) {
      console.error("[Campfire] Failed to retire expired guest:", id, error);
    }
  }

  return result;
}
