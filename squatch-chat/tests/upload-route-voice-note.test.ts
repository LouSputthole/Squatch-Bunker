import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { VOICE_NOTE_LABEL, VOICE_NOTE_MAX_BYTES } from "@/lib/uploadPolicy";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUser: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  checkWeightedLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: mocks.findUser } },
}));
vi.mock("fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
}));
vi.mock("@/lib/rateLimit", () => ({
  checkWeightedLimit: mocks.checkWeightedLimit,
}));

import { POST } from "@/app/api/upload/route";

function uploadRequest(file: File): NextRequest {
  const formData = new FormData();
  formData.append("file", file);
  return new NextRequest("http://test.local/api/upload", {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ userId: "voice-user", username: "voice_user" });
  mocks.findUser.mockResolvedValue({ tier: "premium", tierExpiresAt: null });
  mocks.checkWeightedLimit.mockReturnValue({ allowed: true, resetAt: Date.now() + 60_000 });
});

describe("POST /api/upload voice notes", () => {
  it("stores an accepted Campfire voice note with an audio extension", async () => {
    const response = await POST(
      uploadRequest(
        new File([new Uint8Array(1024)], `${VOICE_NOTE_LABEL}.webm`, {
          type: "audio/webm",
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: `${VOICE_NOTE_LABEL}.webm`,
      type: "audio/webm",
      kind: "voice-note",
      url: expect.stringMatching(/^\/uploads\/[a-f0-9]{16}\.webm$/),
    });
    expect(mocks.mkdir).toHaveBeenCalledOnce();
    expect(mocks.writeFile).toHaveBeenCalledOnce();
  });

  it("rejects an oversized voice note before writing it", async () => {
    const response = await POST(
      uploadRequest(
        new File(
          [new Uint8Array(VOICE_NOTE_MAX_BYTES + 1)],
          `${VOICE_NOTE_LABEL}.webm`,
          { type: "audio/webm" },
        ),
      ),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Voice note too large"),
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
