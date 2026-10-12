import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  EXTENDED_UPLOAD_MAX_BYTES,
  STANDARD_UPLOAD_MAX_BYTES,
} from "@/lib/uploadPolicy";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  community: { value: false },
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/sfu", () => ({ sfuConfigured: () => false }));
vi.mock("@/lib/edition", () => ({
  billingConfiguration: () => ({ enabled: false }),
  getEdition: () => (mocks.community.value ? "community" : "cloud"),
  isCommunityEdition: () => mocks.community.value,
}));

import { GET } from "@/app/api/config/route";

let freeUserId: string;
let premiumUserId: string;

async function config() {
  const response = await GET(new Request("http://campfire.test/api/config"));
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(async () => {
  const [free, premium] = await Promise.all([
    prisma.user.create({
      data: { email: "config-free@t.local", username: "config_free", passwordHash: "x" },
    }),
    prisma.user.create({
      data: {
        email: "config-premium@t.local",
        username: "config_premium",
        passwordHash: "x",
        tier: "premium",
      },
    }),
  ]);
  freeUserId = free.id;
  premiumUserId = premium.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.getSession.mockReset();
  mocks.community.value = false;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/config capabilities", () => {
  it("reports only fully configured OAuth providers and password reset", async () => {
    mocks.getSession.mockResolvedValue(null);
    for (const name of [
      "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
      "RESEND_API_KEY", "CAMPFIRE_EMAIL_FROM",
    ]) {
      vi.stubEnv(name, "");
    }
    await expect(config()).resolves.toMatchObject({
      oauthProviders: [],
      passwordResetEnabled: false,
    });

    vi.stubEnv("GITHUB_CLIENT_ID", "gh-id");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-id-without-secret");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("CAMPFIRE_EMAIL_FROM", "Campfire <noreply@campfire.test>");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://campfire.test");
    await expect(config()).resolves.toMatchObject({
      oauthProviders: ["github"],
      passwordResetEnabled: true,
    });
  });

  it("reports the attachment ceiling the caller's tier actually gets", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await config()).maxUploadBytes).toBe(STANDARD_UPLOAD_MAX_BYTES);

    mocks.getSession.mockResolvedValue({ userId: freeUserId, username: "config_free" });
    expect((await config()).maxUploadBytes).toBe(STANDARD_UPLOAD_MAX_BYTES);

    mocks.getSession.mockResolvedValue({ userId: premiumUserId, username: "config_premium" });
    expect((await config()).maxUploadBytes).toBe(EXTENDED_UPLOAD_MAX_BYTES);

    // Community editions unlock extended uploads for everyone.
    mocks.community.value = true;
    mocks.getSession.mockResolvedValue(null);
    expect((await config()).maxUploadBytes).toBe(EXTENDED_UPLOAD_MAX_BYTES);
  });
});
