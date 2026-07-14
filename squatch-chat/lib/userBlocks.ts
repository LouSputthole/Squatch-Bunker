import { prisma } from "@/lib/db";

/** Return true when either user has blocked the other. */
export async function usersHaveBlock(userAId: string, userBId: string): Promise<boolean> {
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
    select: { id: true },
  });
  return block !== null;
}

/**
 * Idempotently create a directional block and remove any friendship or pending
 * request between the pair in the same transaction.
 */
export async function createUserBlock(blockerId: string, blockedId: string) {
  return prisma.$transaction(async (tx) => {
    const block = await tx.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      update: {},
      create: { blockerId, blockedId },
    });

    await tx.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: blockerId, addresseeId: blockedId },
          { requesterId: blockedId, addresseeId: blockerId },
        ],
      },
    });

    return block;
  });
}

/** Idempotently remove only the caller's directional block. */
export async function removeUserBlock(blockerId: string, blockedId: string): Promise<void> {
  await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
}
