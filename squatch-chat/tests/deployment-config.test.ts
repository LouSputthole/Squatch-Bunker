import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function projectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("hosted deployment safety", () => {
  it("keeps local state and desktop outputs out of Docker build contexts", () => {
    const dockerIgnore = projectFile(".dockerignore");
    for (const pattern of [
      "data/",
      "public/uploads/",
      "public/avatars/",
      "desktop/.stage/",
      "desktop/dist/",
      "*.db",
    ]) {
      expect(dockerIgnore).toContain(pattern);
    }
  });

  it("requires explicit secrets and a PostgreSQL database", () => {
    const compose = projectFile("docker-compose.prod.yml");
    const dockerfile = projectFile("Dockerfile");

    expect(compose).toContain("${DB_PASSWORD:?Set DB_PASSWORD");
    expect(compose).not.toContain("${DB_PASSWORD:-postgres}");
    expect(dockerfile).toContain('case "${DATABASE_URL:-}" in');
    expect(dockerfile).toContain("supports PostgreSQL DATABASE_URL values only");
    expect(dockerfile).toContain("npm run db:migrate");
  });

  it("persists public and private media under one configured container root", () => {
    const compose = projectFile("docker-compose.prod.yml");

    expect(compose).toContain('CAMPFIRE_UPLOAD_DIR: "/app/media"');
    expect(compose).toContain(
      "campfire-private-uploads:/app/media/private-uploads",
    );
    expect(compose).toContain(
      'CAMPFIRE_TRUST_PROXY_HOPS: "${CAMPFIRE_TRUST_PROXY_HOPS:-}"',
    );
  });
});
