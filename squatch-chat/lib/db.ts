import { PrismaClient as PostgresqlPrismaClient } from "@/generated/prisma-postgresql/client";
import { PrismaClient as SqlitePrismaClient } from "@/generated/prisma/client";

type AppPrismaClient = SqlitePrismaClient;
type DbType = "postgres" | "sqlite";

const DEFAULT_SQLITE_URL = "file:./data/campfire.db";
const DEFAULT_POSTGRESQL_URL =
  "postgresql://postgres:postgres@localhost:5432/campfire?schema=public";

export function isSQLiteUrl(databaseUrl: string | undefined): boolean {
  return !databaseUrl || databaseUrl.startsWith("file:");
}

/**
 * Returns true when DATABASE_URL is unset or starts with "file:",
 * indicating SQLite should be used instead of PostgreSQL.
 */
export function isSQLite(): boolean {
  return isSQLiteUrl(process.env.DATABASE_URL);
}

export function getDatabaseProvider(): "postgresql" | "sqlite" {
  return isSQLite() ? "sqlite" : "postgresql";
}

/**
 * Creates a client generated for the same provider as its driver adapter.
 *
 * Both generated schemas come from prisma/schema.prisma, so their model APIs
 * stay identical even though Prisma emits separate provider-specific classes.
 */
export function createPrismaClient(
  databaseUrl = process.env.DATABASE_URL,
): AppPrismaClient {
  if (isSQLiteUrl(databaseUrl)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3");
    const adapter = new PrismaBetterSqlite3({
      url: databaseUrl || DEFAULT_SQLITE_URL,
    });
    return new SqlitePrismaClient({ adapter });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
  const adapter = new PrismaPg(databaseUrl || DEFAULT_POSTGRESQL_URL);

  // The schemas are mechanically kept model-for-model identical. The cast
  // exposes one stable application type while retaining provider-specific
  // generated clients at runtime.
  return new PostgresqlPrismaClient({ adapter }) as unknown as AppPrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  prisma: AppPrismaClient | undefined;
};

/** Lazy-initialized Prisma client - avoids opening a database during builds. */
export const prisma = new Proxy({} as AppPrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return (globalForPrisma.prisma as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** Returns which database backend is active. */
export function getDbType(): DbType {
  return isSQLite() ? "sqlite" : "postgres";
}
