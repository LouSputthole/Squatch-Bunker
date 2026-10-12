import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { deleteExpiredGuest, expiredGuest, removeScrubbedFiles, scrubPersonalData } from "@/lib/guestCleanup";
import { removePrivateUploadsForOwnerDeletion } from "@/lib/messageRetention";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";

/**
 * Self-service account deletion (Settings -> Account -> Delete account).
 *
 * Everything personal goes at once: email, password, profile, GitHub/Google
 * links, memberships and their "joined the server" notices, scheduled
 * messages, and everything scrubPersonalData (lib/guestCleanup.ts) removes:
 * friends, blocks the user made, private notes, bookmarks, Camp Journal,
 * reactions, poll votes, RSVPs, notifications (including notices they
 * triggered in other people's inboxes), handled reports they filed, and files
 * nothing else uses. Sessions are revoked. Reports they filed that are still
 * open stay with the placeholder until a moderator closes them.
 *
 * What they posted for other people (camp messages, DMs, polls, gatherings)
 * stays, like an expired guest's (lib/guestCleanup.ts): the row becomes an
 * expired-guest placeholder named "Deleted user#<tag>" so that content still
 * renders. With no such content it is deleted right away; otherwise the
 * hourly guest sweep deletes it once that content is gone. A DM conversation
 * whose other side is already such a placeholder serves no one and is deleted.
 * Privacy Policy sections 7 and 9 (app/privacy/privacy.ts) describe exactly
 * this; keep them in sync.
 *
 * Camps can't change hands yet, so an owner must delete their camps first.
 */

export type AccountDeletionResult =
  | { ok: true; removed: boolean }
  | { ok: false; reason: "not_found" | "subscription" }
  | { ok: false; reason: "owns_camps"; camps: string[] };

export async function deleteAccount(userId: string, now = new Date()): Promise<AccountDeletionResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        tier: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        ownedServers: { select: { name: true } },
      },
    });
    if (!user) return { ok: false, reason: "not_found" } as const;
    if (user.ownedServers.length > 0) {
      return { ok: false, reason: "owns_camps", camps: user.ownedServers.map((server) => server.name) } as const;
    }
    // Billing is off for now, but never leave a live Stripe subscription charging a deleted account.
    if (
      user.tier === "premium"
      || (user.stripeSubscriptionId && !["canceled", "incomplete_expired"].includes(user.subscriptionStatus ?? ""))
    ) {
      return { ok: false, reason: "subscription" } as const;
    }

    const deadConversations = (await tx.conversation.findMany({
      where: {
        OR: [
          { user1Id: userId, user2: expiredGuest(now) },
          { user2Id: userId, user1: expiredGuest(now) },
        ],
      },
      select: { id: true },
    })).map((conversation) => conversation.id);
    const deadDms = await tx.directMessage.findMany({
      where: { conversationId: { in: deadConversations } },
      select: { id: true, attachmentUrl: true, privateUploadId: true },
    });

    await tx.directMessage.deleteMany({ where: { conversationId: { in: deadConversations } } });
    await tx.conversation.deleteMany({ where: { id: { in: deadConversations } } });
    // Join notices spell out the old username.
    await tx.message.deleteMany({ where: { authorId: userId, isSystem: true } });
    await tx.scheduledMessage.deleteMany({ where: { authorId: userId } });
    await tx.oAuthAccount.deleteMany({ where: { userId } });
    await tx.serverMember.deleteMany({ where: { userId } });
    const scrubbed = await scrubPersonalData(tx, userId);
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@campfire.local`,
        username: `Deleted user#${randomBytes(6).toString("hex")}`,
        passwordHash: "deleted",
        isGuest: true,
        guestExpiresAt: now,
        tier: "free",
        tierExpiresAt: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionStatus: null,
        billingCheckoutPendingAt: null,
        billingEventAt: null,
        resetToken: null,
        resetExpiry: null,
        quietHoursStart: null,
        quietHoursEnd: null,
      },
    });
    return { ok: true as const, scrubbed: { ...scrubbed, files: [...scrubbed.files, ...deadDms] } };
  });
  if (!outcome.ok) return outcome;

  await notifyRealtimeAuthorizationChange({ scope: "session", userId });
  // The deletion is committed and every session revoked, so a failure from
  // here on is tidying up, not a failed deletion: report success either way
  // (the hourly guest sweep retries deleting the placeholder).
  try {
    await removeScrubbedFiles(outcome.scrubbed);
    await removePrivateUploadsForOwnerDeletion(userId);
    return { ok: true, removed: await deleteExpiredGuest(userId, now) };
  } catch (error) {
    console.error("[Campfire] Account deleted, but cleanup afterwards failed:", userId, error);
    return { ok: true, removed: false };
  }
}
