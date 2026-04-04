import "dotenv/config";
import { defineConfig } from "prisma/config";

const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/squatchchat?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] || DEFAULT_DB_URL,
  },
});
