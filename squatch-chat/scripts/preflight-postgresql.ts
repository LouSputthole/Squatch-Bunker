#!/usr/bin/env -S npx tsx

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma-postgresql/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !/^(?:postgres|postgresql):\/\//.test(databaseUrl)) {
  throw new Error(
    "[Campfire] PostgreSQL migration preflight requires a PostgreSQL DATABASE_URL.",
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

async function main() {
try {
  const [userTable] = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'User'
    ) AS "exists"
  `;

  if (userTable?.exists) {
    const duplicates = await prisma.$queryRaw<
      Array<{ field: string; duplicate_count: bigint }>
    >`
      SELECT 'stripeCustomerId' AS "field", COUNT(*) AS "duplicate_count"
      FROM "User"
      WHERE "stripeCustomerId" IS NOT NULL
      GROUP BY "stripeCustomerId"
      HAVING COUNT(*) > 1
      UNION ALL
      SELECT 'stripeSubscriptionId' AS "field", COUNT(*) AS "duplicate_count"
      FROM "User"
      WHERE "stripeSubscriptionId" IS NOT NULL
      GROUP BY "stripeSubscriptionId"
      HAVING COUNT(*) > 1
      LIMIT 1
    `;

    const duplicate = duplicates[0];
    if (duplicate) {
      throw new Error(
        `[Campfire] PostgreSQL migration preflight failed: duplicate User.${duplicate.field} values exist (${duplicate.duplicate_count} rows share one value). Resolve the duplicate records, take a new backup, and retry.`,
      );
    }
  }

  console.log("[Campfire] PostgreSQL migration preflight passed.");
} finally {
  await prisma.$disconnect();
}
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
