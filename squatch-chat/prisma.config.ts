import "dotenv/config";
import { defineConfig } from "prisma/config";

const DATABASE_URL = process.env["DATABASE_URL"];
const SQLITE_DATABASE_URL = DATABASE_URL?.startsWith("file:")
  ? DATABASE_URL
  : "file:./dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: SQLITE_DATABASE_URL,
  },
});
