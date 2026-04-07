import { PrismaClient as PrismaClientPg } from "@/generated/prisma/client";
import { PrismaClient as PrismaClientSqlite } from "@/generated/prisma-sqlite/client";
import { PrismaPg } from "@prisma/adapter-pg";

type DbType = "postgres" | "sqlite";

function detectDbType(): DbType {
  const url = process.env.DATABASE_URL;
  if (url && (url.startsWith("postgresql://") || url.startsWith("postgres://"))) {
    return "postgres";
  }
  return "sqlite";
}

const dbType = detectDbType();

function createPrismaClient(): InstanceType<typeof PrismaClientPg> | InstanceType<typeof PrismaClientSqlite> {
  if (dbType === "postgres") {
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/campfire?schema=public";
    const adapter = new PrismaPg(connectionString);
    return new PrismaClientPg({ adapter });
  }

  // SQLite fallback — default to file:./data/campfire.db if DATABASE_URL is not set
  const sqliteUrl = process.env.DATABASE_URL || "file:./data/campfire.db";
  process.env.DATABASE_URL = sqliteUrl;
  return new PrismaClientSqlite();
}

const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClientPg> | InstanceType<typeof PrismaClientSqlite>;
};

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Returns which database backend is active */
export function getDbType(): DbType {
  return dbType;
}
