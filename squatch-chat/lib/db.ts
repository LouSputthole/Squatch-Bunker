import { PrismaClient } from "@/generated/prisma/client";

type DbType = "postgres" | "sqlite";

/**
 * Returns true when DATABASE_URL is unset or starts with "file:",
 * indicating SQLite should be used instead of PostgreSQL.
 */
export function isSQLite(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return !url || url.startsWith("file:");
}

export function getDatabaseProvider(): "postgresql" | "sqlite" {
  return isSQLite() ? "sqlite" : "postgresql";
}

function detectDbType(): DbType {
  return isSQLite() ? "sqlite" : "postgres";
}

const dbType = detectDbType();

function createPrismaClient(): InstanceType<typeof PrismaClient> {
  if (isSQLite()) {
    // SQLite: set default URL if not provided
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = "file:./data/campfire.db";
    }
    // @ts-expect-error SQLite mode uses built-in driver, no adapter needed at runtime
    return new PrismaClient();
  }

  // PostgreSQL: use the PrismaPg driver adapter.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
  const connectionString =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/campfire?schema=public";
  const adapter = new PrismaPg(connectionString);
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClient> | undefined;
};

/** Lazy-initialized Prisma client — avoids connection during build */
export const prisma = new Proxy({} as InstanceType<typeof PrismaClient>, {
  get(_target, prop) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return (globalForPrisma.prisma as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** Returns which database backend is active */
export function getDbType(): DbType {
  return dbType;
}
