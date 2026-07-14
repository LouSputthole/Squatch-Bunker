import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";

// SFU groundwork: the token route's gate order (auth → configured → feature →
// membership) is the contract that keeps mesh as the fallback, and the minted
// JWT must carry the exact claims LiveKit validates (iss = API key,
// sub = identity, video grant). Auth/feature/membership are stubbed; the JWT
// is verified for real.

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

const featuresMock = vi.hoisted(() => ({ assertFeature: vi.fn() }));
vi.mock("@/lib/features", () => featuresMock);

const channelAccessMock = vi.hoisted(() => ({ resolveChannelAccess: vi.fn() }));
vi.mock("@/lib/channelAccess", () => channelAccessMock);

import { POST } from "@/app/api/voice/sfu-token/route";
import { sfuConfigured, mintSfuToken } from "@/lib/sfu";

const SESSION = { userId: "user_1", username: "lou", tokenVersion: 0 };

function post(body: unknown = { channelId: "chan_1" }) {
  return POST(
    new Request("http://test.local/api/voice/sfu-token", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function configureSfu() {
  vi.stubEnv("LIVEKIT_URL", "wss://sfu.test.local");
  vi.stubEnv("LIVEKIT_API_KEY", "APIkey123");
  vi.stubEnv("LIVEKIT_API_SECRET", "secret456");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LIVEKIT_URL", "");
  vi.stubEnv("LIVEKIT_API_KEY", "");
  vi.stubEnv("LIVEKIT_API_SECRET", "");
  authMock.getSession.mockResolvedValue(SESSION);
  featuresMock.assertFeature.mockResolvedValue(true);
  channelAccessMock.resolveChannelAccess.mockResolvedValue({
    membership: { role: "member" },
    serverId: "srv_1",
    canView: true,
    canSend: true,
  });
});

describe("sfuConfigured", () => {
  it("is false until all three LIVEKIT_* vars are set", () => {
    expect(sfuConfigured()).toBe(false);
    vi.stubEnv("LIVEKIT_URL", "wss://sfu.test.local");
    vi.stubEnv("LIVEKIT_API_KEY", "APIkey123");
    expect(sfuConfigured()).toBe(false);
    vi.stubEnv("LIVEKIT_API_SECRET", "secret456");
    expect(sfuConfigured()).toBe(true);
  });
});

describe("POST /api/voice/sfu-token", () => {
  it("401 when unauthenticated", async () => {
    authMock.getSession.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });

  it("503 when no LiveKit deployment is configured (mesh fallback signal)", async () => {
    expect((await post()).status).toBe(503);
  });

  it("400 on bad JSON or missing channelId", async () => {
    configureSfu();
    expect((await post("not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it("403 without the sfu_voice feature", async () => {
    configureSfu();
    featuresMock.assertFeature.mockResolvedValue(false);
    expect((await post()).status).toBe(403);
    expect(featuresMock.assertFeature).toHaveBeenCalledWith("user_1", "sfu_voice");
  });

  it("403 when not a member of the channel's server", async () => {
    configureSfu();
    channelAccessMock.resolveChannelAccess.mockResolvedValue(null);
    expect((await post()).status).toBe(403);
  });

  it("403 when the member cannot view the voice channel", async () => {
    configureSfu();
    channelAccessMock.resolveChannelAccess.mockResolvedValue({
      membership: { role: "member" },
      serverId: "srv_1",
      canView: false,
      canSend: false,
    });
    expect((await post()).status).toBe(403);
  });

  it("mints a LiveKit-valid token: HS256 by the API secret, iss=key, sub=user, room grant", async () => {
    configureSfu();
    const res = await post({ channelId: "chan_1" });
    expect(res.status).toBe(200);
    const { url, token } = await res.json();
    expect(url).toBe("wss://sfu.test.local");

    const claims = jwt.verify(token, "secret456", {
      algorithms: ["HS256"],
      issuer: "APIkey123",
    }) as jwt.JwtPayload;
    expect(claims.sub).toBe("user_1");
    expect(claims.name).toBe("lou");
    expect(claims.video).toEqual({
      room: "chan_1",
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    expect(claims.exp! - claims.iat!).toBe(600);
  });

  it("mintSfuToken omits the name claim when not provided", () => {
    configureSfu();
    const claims = jwt.verify(mintSfuToken("u2", "r2"), "secret456") as jwt.JwtPayload;
    expect("name" in claims).toBe(false);
  });
});
