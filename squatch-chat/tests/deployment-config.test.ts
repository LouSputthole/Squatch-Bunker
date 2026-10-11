import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { needsBuild, productionEnv } from "@/scripts/host-prod.mjs";
import { launchChecklist } from "@/scripts/launch-checklist";

function projectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const READY_CLOUD_ENV = {
  CAMPFIRE_EDITION: "cloud",
  DATABASE_URL: "postgresql://campfire:secret@db.example.com/campfire?sslmode=require",
  JWT_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
  NEXT_PUBLIC_APP_URL: "https://campfire.example.com",
  RESEND_API_KEY: "re_test",
  CAMPFIRE_EMAIL_FROM: "Campfire <account@campfire.example.com>",
  STRICT_CORS: "true",
  CORS_ORIGINS: "https://campfire.example.com",
  CAMPFIRE_TRUST_PROXY_HOPS: "2",
  INSTANCE_ADMIN_USER_IDS: "user-1",
  TURN_URLS: '["turn:turn.campfire.example.com:3478?transport=udp"]',
  TURN_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("Campfire Online on Fly.io", () => {
  it("runs one always-on machine with health checks, media volume, and cloud settings", () => {
    const fly = projectFile("fly.toml");

    expect(fly).toContain('auto_stop_machines = "off"');
    expect(fly).toContain("internal_port = 3000");
    expect(fly).toContain("force_https = true");
    expect(fly).toContain('path = "/api/health"');
    expect(fly).toContain('destination = "/app/media"');
    // Free Cloud allows 100 MB uploads; Fly ignores the threshold without both increment and limit.
    expect(fly).toMatch(/^\s*auto_extend_size_threshold = \d+$/m);
    expect(fly).toMatch(/^\s*auto_extend_size_increment = "\d+GB"$/m);
    expect(fly).toMatch(/^\s*auto_extend_size_limit = "\d+GB"$/m);
    expect(fly).toContain('CAMPFIRE_UPLOAD_DIR = "/app/media"');
    expect(fly).toContain('CAMPFIRE_EDITION = "cloud"');
    expect(fly).toContain('STRICT_CORS = "true"');
    expect(fly).toContain('CAMPFIRE_TELEMETRY_COLLECTOR = "1"');
    expect(fly).toContain('CAMPFIRE_TRUST_PROXY_HOPS = "2"');
    // Secrets live in `fly secrets`, never in the committed config.
    for (const secret of ["DATABASE_URL", "JWT_SECRET", "RESEND_API_KEY", "TURN_AUTH_SECRET"]) {
      expect(fly).not.toMatch(new RegExp(`^\\s*${secret}\\s*=`, "m"));
    }
  });

  it("gates each deploy on the launch check and migrations, with both in the image", () => {
    const fly = projectFile("fly.toml");
    const scripts = JSON.parse(projectFile("package.json")).scripts;
    const dockerfile = projectFile("Dockerfile");

    expect(fly).toContain('release_command = "npm run deploy:release"');
    expect(scripts["deploy:release"]).toBe("tsx scripts/launch-checklist.ts && npm run db:migrate");
    expect(dockerfile).toContain("/app/scripts/launch-checklist.ts ./scripts/");
    expect(dockerfile).toContain("/app/scripts/preflight-postgresql.ts ./scripts/");
  });
});

describe("launch checklist", () => {
  it("passes a complete cloud environment with no advice beyond free billing", () => {
    const result = launchChecklist(READY_CLOUD_ENV);
    expect(result.edition).toBe("cloud");
    expect(result.errors).toEqual([]);
    expect(result.advice).toEqual([
      expect.stringContaining("Cloud billing is disabled"),
    ]);
  });

  it("applies production rules even when NODE_ENV says development", () => {
    const result = launchChecklist({ CAMPFIRE_EDITION: "cloud", NODE_ENV: "development" });
    expect(result.errors).toEqual(expect.arrayContaining([
      "Cloud production requires a PostgreSQL DATABASE_URL",
      "Cloud production requires an HTTPS NEXT_PUBLIC_APP_URL",
      "Cloud production requires STRICT_CORS=true and CORS_ORIGINS",
    ]));
  });

  it("fails on broken TURN or beta settings and advises on missing launch extras", () => {
    const broken = launchChecklist({
      ...READY_CLOUD_ENV,
      TURN_AUTH_SECRET: "too-short",
      CAMPFIRE_BETA_ACCESS_CODE: "short",
    });
    expect(broken.errors).toEqual([
      expect.stringContaining("CAMPFIRE_BETA_ACCESS_CODE"),
      expect.stringContaining("TURN_AUTH_SECRET"),
    ]);

    const bare = launchChecklist({
      ...READY_CLOUD_ENV,
      TURN_URLS: "",
      TURN_AUTH_SECRET: "",
      INSTANCE_ADMIN_USER_IDS: "",
      CAMPFIRE_TRUST_PROXY_HOPS: "",
    });
    expect(bare.errors).toEqual([]);
    expect(bare.advice.join("\n")).toMatch(/TURN_URLS/);
    expect(bare.advice.join("\n")).toMatch(/INSTANCE_ADMIN_USER_IDS/);
    expect(bare.advice.join("\n")).toMatch(/CAMPFIRE_TRUST_PROXY_HOPS/);
  });
});

describe("npm run host:prod", () => {
  it("runs production, keeping plain-HTTP LAN sign-in working", () => {
    expect(productionEnv({}).NODE_ENV).toBe("production");
    expect(productionEnv({ NODE_ENV: "development" }).NODE_ENV).toBe("production");
    expect(productionEnv({}).COOKIE_SECURE).toBe("0");
    expect(productionEnv({ NEXT_PUBLIC_APP_URL: "http://192.168.1.20:3000" }).COOKIE_SECURE).toBe("0");
  });

  it("keeps Secure cookies behind HTTPS and never overrides an explicit choice", () => {
    expect(productionEnv({ NEXT_PUBLIC_APP_URL: "https://campfire.example.com" }).COOKIE_SECURE)
      .toBeUndefined();
    expect(productionEnv({}, { NEXT_PUBLIC_APP_URL: "https://campfire.example.com" }).COOKIE_SECURE)
      .toBeUndefined();
    expect(productionEnv({ COOKIE_SECURE: "1" }).COOKIE_SECURE).toBe("1");
    expect(productionEnv({}, { COOKIE_SECURE: "1" }).COOKIE_SECURE).toBeUndefined();
  });

  it("builds when there is no build or package.json is newer than it", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-host-prod-"));
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      expect(needsBuild(dir)).toBe(true);

      mkdirSync(join(dir, ".next"));
      writeFileSync(join(dir, ".next", "BUILD_ID"), "build");
      utimesSync(join(dir, "package.json"), new Date(1_000_000), new Date(1_000_000));
      utimesSync(join(dir, ".next", "BUILD_ID"), new Date(2_000_000), new Date(2_000_000));
      expect(needsBuild(dir)).toBe(false);

      utimesSync(join(dir, "package.json"), new Date(3_000_000), new Date(3_000_000));
      expect(needsBuild(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("hosted deployment safety", () => {
  it("keeps local state and desktop outputs out of Docker build contexts", () => {
    const dockerIgnore = projectFile(".dockerignore");
    for (const pattern of [
      "data/",
      "public/uploads/",
      "public/avatars/",
      "desktop/.stage/",
      "desktop/dist/",
      "desktop/node_modules/",
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
      "LIBRETRANSLATE_URL",
      "LIBRETRANSLATE_KEY",
      "SCHEDULER_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      // The usage-ping opt-outs and target: docs/TELEMETRY.md tells self-hosters to opt out in .env.
      "CAMPFIRE_TELEMETRY",
      "DO_NOT_TRACK",
      "CAMPFIRE_CLOUD_URL",
      "CAMPFIRE_TELEMETRY_URL",
    ]) {
      expect(compose).toContain(variable + ': "${' + variable);
    }
  });

  it("keeps CI's production servers from pinging Campfire Online", () => {
    const releaseWorkflow = projectFile("../.github/workflows/release-gates.yml");
    // Workflow-level, so every job's servers and the Compose stack inherit it.
    expect(releaseWorkflow).toMatch(/^env:\n {2}CAMPFIRE_TELEMETRY: "off"$/m);
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
      'TURN_CREDENTIAL_TTL_SECONDS: "${TURN_CREDENTIAL_TTL_SECONDS:-}"',
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
