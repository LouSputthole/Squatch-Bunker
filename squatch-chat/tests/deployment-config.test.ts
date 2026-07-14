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
    expect(dockerfile).toContain(
      "COPY --chown=node:node --from=builder /app/LICENSE ./LICENSE",
    );
    expect(releaseWorkflow).toContain(
      '--env BUILD_ONLY_JWT="$build_only_jwt"',
    );
    expect(releaseWorkflow).toContain(
      'grep -r -F -l "$BUILD_ONLY_JWT" /app',
    );
  });

  it("ships the AGPL license and exposes the corresponding source", () => {
    const license = projectFile("LICENSE");
    const billingPage = projectFile("app/billing/page.tsx");
    const loginPage = projectFile("app/(auth)/login/page.tsx");

    expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(billingPage).toContain("Licensed AGPL-3.0-only");
    expect(billingPage).toContain(
      "https://github.com/LouSputthole/Squatch-Bunker",
    );
    expect(billingPage).toContain("View the corresponding source");
    expect(loginPage).toContain("AGPL-3.0-only");
    expect(loginPage).toContain(
      "https://github.com/LouSputthole/Squatch-Bunker/blob/main/squatch-chat/LICENSE",
    );
    expect(loginPage).toContain(
      "https://github.com/LouSputthole/Squatch-Bunker",
    );
    expect(loginPage).toContain("View corresponding source");
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
      "CAMPFIRE_BETA_ACCESS_CODE",
      "TURN_URLS",
      "TURN_AUTH_SECRET",
      "TURN_CREDENTIAL_TTL_SECONDS",
      "TURN_ALLOW_LEGACY_STATIC_CREDENTIALS",
      "TURN_URL",
      "TURN_USERNAME",
      "TURN_CREDENTIAL",
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

  it("documents ephemeral multi-transport TURN and gates legacy credentials", () => {
    const compose = projectFile("docker-compose.prod.yml");
    const envExample = projectFile(".env.example");
    const deploy = projectFile("docs/DEPLOY.md");
    const turnUrls =
      '["turn:turn.campfire.example.com:3478?transport=udp",'
      + '"turn:turn.campfire.example.com:3478?transport=tcp",'
      + '"turns:turn.campfire.example.com:5349?transport=tcp"]';

    expect(envExample).toContain("# TURN_URLS='" + turnUrls + "'");
    expect(envExample).toContain("openssl rand -hex 32");
    expect(envExample).toContain("TURN_AUTH_SECRET");
    expect(envExample).toContain("Non-beta compatibility only");
    expect(envExample).toContain("TURN_ALLOW_LEGACY_STATIC_CREDENTIALS");

    expect(compose).toContain(
      'TURN_CREDENTIAL_TTL_SECONDS: "${TURN_CREDENTIAL_TTL_SECONDS:-900}"',
    );
    expect(compose).toContain(
      'TURN_ALLOW_LEGACY_STATIC_CREDENTIALS: "${TURN_ALLOW_LEGACY_STATIC_CREDENTIALS:-0}"',
    );

    for (const directive of [
      "tls-listening-port=5349",
      "use-auth-secret",
      "static-auth-secret=PASTE-EXACT-TURN_AUTH_SECRET-HERE",
      "realm=turn.campfire.example.com",
      "stale-nonce=600",
      "user-quota=4",
      "total-quota=40",
      "max-bps=3000000",
      "bps-capacity=25000000",
      "min-port=49160",
      "max-port=49200",
      "cert=/etc/coturn/tls/fullchain.pem",
      "pkey=/etc/coturn/tls/privkey.pem",
      "no-tlsv1",
      "no-tlsv1_1",
      "no-dtls",
      "no-tcp-relay",
      "denied-peer-ip=10.0.0.0-10.255.255.255",
      "denied-peer-ip=169.254.0.0-169.254.255.255",
      "denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "syslog",
      "new-log-timestamp",
      "sudo ufw allow 3478/tcp",
      "sudo ufw allow 3478/udp",
      "sudo ufw allow 5349/tcp",
      "sudo ufw allow 49160:49200/udp",
      "SIGUSR2",
      "Non-beta legacy compatibility",
    ]) {
      expect(deploy).toContain(directive);
    }
    expect(deploy).toContain("TURN_URLS='" + turnUrls + "'");
    expect(deploy).not.toContain(
      "user=campfire:REPLACE-WITH-LONG-RANDOM-PASSWORD",
    );

    for (const acceptanceGate of [
      "Wrong credential.",
      "Expired credential.",
      "UDP and plain TCP.",
      "UDP-blocked TLS fallback.",
      "TTL survival and reconnect.",
      "Quota and recovery.",
      "Secret rotation.",
      "Two-device media acceptance.",
    ]) {
      expect(deploy).toContain(acceptanceGate);
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
