import "dotenv/config";
import { defineConfig } from "prisma/config";

const DATABASE_URL = process.env["DATABASE_URL"];
const isSQLite = !DATABASE_URL || DATABASE_URL.startsWith("file:");
const DEFAULT_DB_URL = isSQLite
  ? "file:./dev.db"
  : "postgresql://postgres:postgres@127.0.0.1:5432/campfire?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: DATABASE_URL || DEFAULT_DB_URL,
  },
});
