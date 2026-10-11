import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  OFFICIAL_CLOUD_URL,
  buildServerPing,
  reportTelemetry,
  serverInstallId,
  startTelemetryReporter,
  telemetryEnabled,
  telemetryOptedOut,
  telemetryTarget,
} from "@/lib/telemetry";
import { TELEMETRY_PING_PATH, parseTelemetryPing } from "@/lib/telemetryProtocol";

const COLLECTOR = "https://collector.campfire.test/api/telemetry/ping";
const SECRET = "telemetry-test-secret-0123456789-abcdef";
const PROD = { NODE_ENV: "production", CAMPFIRE_CLOUD_URL: "https://campfire.test", JWT_SECRET: SECRET };
const DAY_MS = 24 * 60 * 60 * 1_000;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("telemetryTarget", () => {
  it("prefers an explicit URL, else derives the ping path from the cloud origin", () => {
    expect(telemetryTarget({ CAMPFIRE_TELEMETRY_URL: COLLECTOR, CAMPFIRE_CLOUD_URL: "https://other.test" }))
      .toBe(COLLECTOR);
    expect(telemetryTarget({ CAMPFIRE_CLOUD_URL: "https://campfire.test" }))
      .toBe(`https://campfire.test${TELEMETRY_PING_PATH}`);
    expect(telemetryTarget({})).toBe(
      OFFICIAL_CLOUD_URL ? new URL(TELEMETRY_PING_PATH, OFFICIAL_CLOUD_URL).href : null,
    );
  });

  it("requires HTTPS except on localhost", () => {
    expect(telemetryTarget({ CAMPFIRE_CLOUD_URL: "http://campfire.test" })).toBeNull();
    expect(telemetryTarget({ CAMPFIRE_CLOUD_URL: "ftp://campfire.test" })).toBeNull();
    expect(telemetryTarget({ CAMPFIRE_CLOUD_URL: "not a url" })).toBeNull();
    expect(telemetryTarget({ CAMPFIRE_CLOUD_URL: "http://localhost:3000" }))
      .toBe(`http://localhost:3000${TELEMETRY_PING_PATH}`);
    expect(telemetryTarget({ CAMPFIRE_CLOUD_URL: "http://127.0.0.1:3000" }))
      .toBe(`http://127.0.0.1:3000${TELEMETRY_PING_PATH}`);
    // An explicit collector URL follows the same rule and never falls back.
    expect(telemetryTarget({ CAMPFIRE_TELEMETRY_URL: "http://localhost:3000/api/telemetry/ping" }))
      .toBe("http://localhost:3000/api/telemetry/ping");
    expect(telemetryTarget({
      CAMPFIRE_TELEMETRY_URL: "http://collector.campfire.test/api/telemetry/ping",
      CAMPFIRE_CLOUD_URL: "https://campfire.test",
    })).toBeNull();
  });
});

describe("telemetryEnabled", () => {
  it("is on for a production server with a known target", () => {
    expect(telemetryEnabled(PROD)).toBe(true);
    expect(telemetryEnabled({ ...PROD, CAMPFIRE_TELEMETRY: "on" })).toBe(true);
    expect(telemetryEnabled({ ...PROD, DO_NOT_TRACK: "0" })).toBe(true);
  });

  it.each(["0", "false", "OFF", " no "])("honours CAMPFIRE_TELEMETRY=%j", (value) => {
    expect(telemetryEnabled({ ...PROD, CAMPFIRE_TELEMETRY: value })).toBe(false);
  });

  it.each(["1", "true", "TRUE"])("honours DO_NOT_TRACK=%j", (value) => {
    expect(telemetryEnabled({ ...PROD, DO_NOT_TRACK: value })).toBe(false);
  });

  it("stays silent in development unless a collector URL is set explicitly", () => {
    expect(telemetryEnabled({ ...PROD, NODE_ENV: "development" })).toBe(false);
    expect(telemetryEnabled({ ...PROD, NODE_ENV: undefined })).toBe(false);
    expect(telemetryEnabled({ ...PROD, NODE_ENV: "development", CAMPFIRE_TELEMETRY_URL: COLLECTOR })).toBe(true);
  });

  it("never pings from the collector itself or without a target", () => {
    expect(telemetryEnabled({ ...PROD, CAMPFIRE_TELEMETRY_COLLECTOR: "1" })).toBe(false);
    expect(telemetryEnabled({ ...PROD, CAMPFIRE_CLOUD_URL: "http://campfire.test" })).toBe(false);
  });
});

describe("telemetryOptedOut", () => {
  // Also gates /admin's GitHub release lookup, which must work before a cloud URL exists.
  it("is only the operator's explicit switches, not the missing-target or dev cases", () => {
    expect(telemetryOptedOut({})).toBe(false);
    expect(telemetryOptedOut({ NODE_ENV: "development", CAMPFIRE_TELEMETRY: "on", DO_NOT_TRACK: "0" })).toBe(false);
    expect(telemetryOptedOut({ CAMPFIRE_TELEMETRY: " OFF " })).toBe(true);
    expect(telemetryOptedOut({ DO_NOT_TRACK: "true" })).toBe(true);
  });
});

describe("serverInstallId", () => {
  it("is stable per secret, differs across secrets, and fits the protocol", () => {
    const id = serverInstallId({ JWT_SECRET: SECRET });
    expect(serverInstallId({ JWT_SECRET: SECRET })).toBe(id);
    expect(serverInstallId({ JWT_SECRET: `${SECRET}-other` })).not.toBe(id);
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(id).toHaveLength(32);
  });
});

describe("buildServerPing", () => {
  it("counts registered accounts and recent message authors, nothing else", async () => {
    const before = await buildServerPing(PROD);
    const suffix = randomUUID().slice(0, 8);
    const [member, guest] = await Promise.all([
      prisma.user.create({
        data: { email: `ping-member-${suffix}@t.local`, username: `ping_member_${suffix}`, passwordHash: "x" },
      }),
      prisma.user.create({
        data: { email: `ping-guest-${suffix}@t.local`, username: `ping_guest_${suffix}`, passwordHash: "x", isGuest: true },
      }),
    ]);
    const server = await prisma.server.create({ data: { name: `Ping ${suffix}`, ownerId: member.id } });
    const channel = await prisma.channel.create({ data: { serverId: server.id, name: `ping-${suffix}`, type: "text" } });
    await prisma.message.createMany({
      data: [
        { channelId: channel.id, authorId: guest.id, content: "recent" },
        { channelId: channel.id, authorId: member.id, content: "old", createdAt: new Date(Date.now() - 30 * DAY_MS) },
      ],
    });

    const ping = await buildServerPing(PROD);
    expect(parseTelemetryPing(ping)).toEqual(ping);
    expect(ping).toMatchObject({
      v: 1,
      kind: "server",
      mode: null,
      edition: "community",
      installId: serverInstallId(PROD),
      platform: `${process.platform}-${process.arch}`,
    });
    expect(ping.users).toBe((before.users ?? 0) + 1);
    expect(ping.activeUsers).toBe((before.activeUsers ?? 0) + 1);
  });
});

describe("reportTelemetry", () => {
  it("POSTs exactly the protocol fields as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await reportTelemetry(COLLECTOR, PROD);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(COLLECTOR);
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    const body = JSON.parse(init.body);
    expect(parseTelemetryPing(body)).toEqual(body);
    expect(Object.keys(body).sort()).toEqual(
      ["activeUsers", "edition", "installId", "kind", "mode", "platform", "users", "v", "version"],
    );
  });

  it("swallows network and HTTP failures with one short line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND\n    at somewhere")));
    await expect(reportTelemetry(COLLECTOR, PROD)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("[Campfire] Usage ping failed: getaddrinfo ENOTFOUND");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(reportTelemetry(COLLECTOR, PROD)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("startTelemetryReporter", () => {
  it("does nothing, not even the notice, when disabled", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    startTelemetryReporter({ ...PROD, CAMPFIRE_TELEMETRY: "off" })();
    expect(log).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("announces itself once, pings after a minute, then daily until stopped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const stop = startTelemetryReporter({ ...PROD, CAMPFIRE_TELEMETRY_URL: COLLECTOR });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/anonymous usage ping.*CAMPFIRE_TELEMETRY=off/);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(DAY_MS);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    stop();
    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
