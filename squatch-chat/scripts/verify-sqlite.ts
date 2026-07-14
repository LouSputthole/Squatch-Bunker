#!/usr/bin/env -S npx tsx

import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../lib/db";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.startsWith("file:")) {
  throw new Error(
    "[Campfire] verify-sqlite requires a file: SQLite DATABASE_URL.",
  );
}

const prisma = createPrismaClient(databaseUrl);
const marker = randomUUID().replaceAll("-", "");
const userId = `release-sqlite-smoke-${marker}`;
const username = `release_sqlite_${marker.slice(0, 20)}`;
const persistenceId = "release-sqlite-persistence";
const legacyOwnerId = "legacy-owner";
const legacyMemberId = "legacy-member";
const recoveryUploadId = "release-sqlite-private-upload";
const recoveryStorageKey = "release-sqlite-private-smoke.txt";

async function main() {
try {
  const integrity = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
    "PRAGMA integrity_check",
  );
  if (Object.values(integrity[0] ?? {})[0] !== "ok") {
    throw new Error("[Campfire] SQLite integrity_check failed.");
  }

  await prisma.user.create({
    data: {
      id: userId,
      email: `${username}@example.invalid`,
      username,
      passwordHash: "release-smoke-not-a-real-password-hash",
    },
  });
  const created = await prisma.user.findUnique({ where: { id: userId } });
  if (!created || created.username !== username) {
    throw new Error("[Campfire] SQLite create/read smoke check failed.");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { statusMessage: "release-sqlite-updated" },
  });
  const updated = await prisma.user.findUnique({ where: { id: userId } });
  if (updated?.statusMessage !== "release-sqlite-updated") {
    throw new Error("[Campfire] SQLite update smoke check failed.");
  }

  await prisma.user.delete({ where: { id: userId } });
  if (await prisma.user.findUnique({ where: { id: userId } })) {
    throw new Error("[Campfire] SQLite delete smoke check failed.");
  }

  if (process.env.CAMPFIRE_SQLITE_PERSISTENCE === "seed") {
    await prisma.user.upsert({
      where: { id: persistenceId },
      create: {
        id: persistenceId,
        email: "release-sqlite-persistence@example.invalid",
        username: "release_sqlite_persistence",
        passwordHash: "release-persistence-not-a-real-hash",
        statusMessage: "beta-sqlite-persistence",
      },
      update: { statusMessage: "beta-sqlite-persistence" },
    });
  } else if (process.env.CAMPFIRE_SQLITE_PERSISTENCE === "verify") {
    const persistent = await prisma.user.findUnique({
      where: { id: persistenceId },
    });
    if (persistent?.statusMessage !== "beta-sqlite-persistence") {
      throw new Error(
        "[Campfire] SQLite persistence marker did not survive restart or restore.",
      );
    }
  }

  if (process.env.CAMPFIRE_SQLITE_LEGACY === "1") {
    const [block, friendship, message, owner, member] = await Promise.all([
      prisma.userBlock.findFirst({
        where: { blockerId: legacyOwnerId, blockedId: legacyMemberId },
      }),
      prisma.friendship.findUnique({ where: { id: "legacy-block" } }),
      prisma.message.findUnique({ where: { id: "legacy-message" } }),
      prisma.user.findUnique({ where: { id: legacyOwnerId } }),
      prisma.user.findUnique({ where: { id: legacyMemberId } }),
    ]);

    if (!block || friendship || message?.content !== "still here") {
      throw new Error(
        "[Campfire] SQLite upgrade did not preserve and convert legacy data.",
      );
    }
    if (
      owner?.stripeCustomerId !== "cus_legacy_owner" ||
      owner.stripeSubscriptionId !== "sub_legacy_owner" ||
      member?.stripeCustomerId !== "cus_legacy_member" ||
      member.stripeSubscriptionId !== "sub_legacy_member"
    ) {
      throw new Error(
        "[Campfire] SQLite upgrade did not preserve legacy billing identifiers.",
      );
    }
  }

  if (process.env.CAMPFIRE_SQLITE_RECOVERY === "seed") {
    const owner = await prisma.user.findUnique({ where: { id: legacyOwnerId } });
    if (!owner) {
      throw new Error("[Campfire] Legacy owner is missing before recovery seed.");
    }
    await prisma.privateUpload.upsert({
      where: { id: recoveryUploadId },
      create: {
        id: recoveryUploadId,
        ownerId: legacyOwnerId,
        storageKey: recoveryStorageKey,
        originalName: recoveryStorageKey,
        contentType: "text/plain",
        byteSize: 32,
      },
      update: {
        storageKey: recoveryStorageKey,
        originalName: recoveryStorageKey,
        contentType: "text/plain",
        byteSize: 32,
      },
    });
  } else if (process.env.CAMPFIRE_SQLITE_RECOVERY === "verify") {
    const upload = await prisma.privateUpload.findUnique({
      where: { id: recoveryUploadId },
    });
    if (
      upload?.ownerId !== legacyOwnerId ||
      upload.storageKey !== recoveryStorageKey
    ) {
      throw new Error(
        "[Campfire] SQLite recovery did not preserve the PrivateUpload record.",
      );
    }
  }

  console.log("[Campfire] SQLite integrity and CRUD smoke check passed.");
} finally {
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
}
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
