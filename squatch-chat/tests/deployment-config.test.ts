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
    const releaseWorkflow = projectFile("../.github/workflows/release-gates.yml");

    expect(compose).toContain("${DB_PASSWORD:?Set DB_PASSWORD");
    expect(compose).not.toContain("${DB_PASSWORD:-postgres}");
    expect(compose).toMatch(
      /image: postgres:16-alpine@sha256:[a-f0-9]{64}/,
    );
    expect(dockerfile).toMatch(/^FROM node:22-alpine@sha256:[a-f0-9]{64} AS base$/m);
    expect(compose).toContain(
      "pg_isready -U ${DB_USER:-postgres} -d ${DB_NAME:-campfire}",
    );
    expect(compose).toContain('"127.0.0.1:${PORT:-3000}:3000"');
    expect(dockerfile).toContain('case "${DATABASE_URL:-}" in');
    expect(dockerfile).toContain("supports PostgreSQL DATABASE_URL values only");
    expect(dockerfile).toContain("npm run db:migrate");
    expect(dockerfile).toContain(
      "ARG CAMPFIRE_BUILD_JWT_SECRET=campfire-build-only-jwt-never-use-at-runtime-",
    );
    expect(dockerfile).toContain(
      'RUN JWT_SECRET="${CAMPFIRE_BUILD_JWT_SECRET}" npm run build',
    );
    expect(releaseWorkflow).toContain(
      '--env BUILD_ONLY_JWT="$build_only_jwt"',
    );
    expect(releaseWorkflow).toContain(
      'grep -r -F -l "$BUILD_ONLY_JWT" /app',
    );
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

  it("forwards the documented Community runtime settings", () => {
    const compose = projectFile("docker-compose.prod.yml");

    for (const variable of [
      "COOKIE_NAME",
      "INSTANCE_ADMIN_USER_IDS",
      "MAX_AVATAR_SIZE",
      "MAX_UPLOAD_SIZE",
      "RATE_LIMIT_REQUESTS",
      "RATE_LIMIT_WINDOW_MS",
      "GIPHY_API_KEY",
      "TENOR_API_KEY",
      "LIBRETRANSLATE_URL",
      "LIBRETRANSLATE_KEY",
      "SCHEDULER_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ]) {
      expect(compose).toContain(variable + ': "${' + variable);
    }
  });

  it("does not forward unsupported runtime/build-time overrides", () => {
    const compose = projectFile("docker-compose.prod.yml");

    for (const variable of [
      "SOCKET_PATH",
      "NEXT_PUBLIC_SOCKET_PATH",
      "NEXT_PUBLIC_SOCKET_URL",
      "COOKIE_SECURE",
      "CAMPFIRE_BIND_HOST",
      "LIVEKIT_URL",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
    ]) {
      expect(compose).not.toContain(`${variable}:`);
    }
  });
});
