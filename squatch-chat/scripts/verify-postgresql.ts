#!/usr/bin/env -S npx tsx

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma-postgresql/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !/^(?:postgres|postgresql):\/\//.test(databaseUrl)) {
  throw new Error(
    "[Campfire] verify-postgresql requires a PostgreSQL DATABASE_URL.",
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
const marker = randomUUID().replaceAll("-", "");
const userId = `release-smoke-${marker}`;
const username = `release_smoke_${marker.slice(0, 20)}`;
const email = `${username}@example.invalid`;
const legacyRequesterId = "release-upgrade-requester";
const legacyAddresseeId = "release-upgrade-addressee";
const legacyBilling: Record<
  string,
  { stripeCustomerId: string; stripeSubscriptionId: string }
> = {
  [legacyRequesterId]: {
    stripeCustomerId: "cus_release_upgrade_requester",
    stripeSubscriptionId: "sub_release_upgrade_requester",
  },
  [legacyAddresseeId]: {
    stripeCustomerId: "cus_release_upgrade_addressee",
    stripeSubscriptionId: "sub_release_upgrade_addressee",
  },
};

async function main() {
try {
  const [version] = await prisma.$queryRaw<
    Array<{ server_version_num: string }>
  >`SELECT current_setting('server_version_num') AS server_version_num`;

  if (!version || Number(version.server_version_num) < 160000) {
    throw new Error(
      `[Campfire] PostgreSQL 16 or newer is required; server reported ${version?.server_version_num ?? "unknown"}.`,
    );
  }

  await prisma.user.create({
    data: {
      id: userId,
      email,
      username,
      passwordHash: "release-smoke-not-a-real-password-hash",
    },
  });

  const created = await prisma.user.findUnique({ where: { id: userId } });
  if (!created || created.email !== email) {
    throw new Error("[Campfire] PostgreSQL create/read smoke check failed.");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { statusMessage: "release-smoke-updated" },
  });

  const updated = await prisma.user.findUnique({ where: { id: userId } });
  if (updated?.statusMessage !== "release-smoke-updated") {
    throw new Error("[Campfire] PostgreSQL update smoke check failed.");
  }

  await prisma.user.delete({ where: { id: userId } });
  const deleted = await prisma.user.findUnique({ where: { id: userId } });
  if (deleted) {
    throw new Error("[Campfire] PostgreSQL delete smoke check failed.");
  }

  if (process.env.CAMPFIRE_VERIFY_LEGACY_BLOCK === "1") {
    const [block, friendship, legacyUsers] = await Promise.all([
      prisma.userBlock.findFirst({
        where: {
          blockerId: legacyAddresseeId,
          blockedId: legacyRequesterId,
        },
      }),
      prisma.friendship.findUnique({ where: { id: "release-upgrade-block" } }),
      prisma.user.findMany({
        where: { id: { in: [legacyRequesterId, legacyAddresseeId] } },
        select: {
          id: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
        },
      }),
    ]);

    if (!block || friendship) {
      throw new Error(
        "[Campfire] PostgreSQL upgrade did not preserve the legacy blocked relationship.",
      );
    }
    for (const user of legacyUsers) {
      const expected = legacyBilling[user.id];
      if (
        !expected ||
        user.stripeCustomerId !== expected.stripeCustomerId ||
        user.stripeSubscriptionId !== expected.stripeSubscriptionId
      ) {
        throw new Error(
          `[Campfire] PostgreSQL upgrade did not preserve billing identifiers for ${user.id}.`,
        );
      }
    }

    if (legacyUsers.length !== 2) {
      throw new Error(
        "[Campfire] PostgreSQL upgrade did not preserve both legacy users.",
      );
    }
  }
  console.log(
    `[Campfire] PostgreSQL ${version.server_version_num} migration and CRUD smoke check passed.`,
  );
} finally {
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  if (process.env.CAMPFIRE_VERIFY_LEGACY_BLOCK === "1") {
    await prisma.user
      .deleteMany({
        where: { id: { in: [legacyRequesterId, legacyAddresseeId] } },
      })
      .catch(() => undefined);
  }
  await prisma.$disconnect();
}
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
