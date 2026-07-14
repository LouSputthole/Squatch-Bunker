#!/usr/bin/env -S npx tsx

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma-postgresql/client";

const expectedMigrations = [
  "20260711000000_init",
  "20260711000001_reports",
  "20260711000002_friendship_pair_unique",
];
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !/^(?:postgres|postgresql):\/\//.test(databaseUrl)) {
  throw new Error(
    "[Campfire] verify-postgresql-baseline requires a PostgreSQL DATABASE_URL.",
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

async function main() {
try {
  const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT "migration_name"
    FROM "_prisma_migrations"
    WHERE "rolled_back_at" IS NULL
    ORDER BY "migration_name"
  `;
  const actualMigrations = applied.map((row) => row.migration_name);

  if (JSON.stringify(actualMigrations) !== JSON.stringify(expectedMigrations)) {
    throw new Error(
      `[Campfire] Expected the 0.0.3 PostgreSQL baseline ${expectedMigrations.join(", ")}; found ${actualMigrations.join(", ") || "none"}.`,
    );
  }

  console.log(
    `[Campfire] PostgreSQL 0.0.3 baseline contains exactly ${expectedMigrations.length} migrations.`,
  );
} finally {
  await prisma.$disconnect();
}
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
