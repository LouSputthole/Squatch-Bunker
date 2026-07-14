import "dotenv/config";
import { defineConfig } from "prisma/config";

const DATABASE_URL = process.env["DATABASE_URL"];
const POSTGRESQL_DATABASE_URL = /^(?:postgres|postgresql):\/\//.test(DATABASE_URL ?? "")
  ? DATABASE_URL!
  : "postgresql://postgres:postgres@127.0.0.1:5432/campfire?schema=public";

export default defineConfig({
  schema: "prisma/schema.postgresql.prisma",
  migrations: {
    path: "prisma/migrations-postgresql",
  },
  datasource: {
    url: POSTGRESQL_DATABASE_URL,
  },
});
