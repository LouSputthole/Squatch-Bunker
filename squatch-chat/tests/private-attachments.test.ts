import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST as uploadAttachment } from "@/app/api/attachments/route";
import {
  GET as readAttachment,
  HEAD as headAttachment,
} from "@/app/api/attachments/[attachmentId]/route";

interface TestUser {
  id: string;
  username: string;
}

let owner: TestUser;
let outsider: TestUser;
let mediaRoot: string;
let previousMediaRoot: string | undefined;

function signIn(user: TestUser | null) {
  authMock.getSession.mockResolvedValue(
    user ? { userId: user.id, username: user.username } : null,
  );
}

function uploadRequest(contents = "private trail map") {
  const form = new FormData();
  form.append("file", new File([contents], "trail-map.txt", { type: "text/plain" }));
  return new NextRequest("http://test.local/api/attachments", {
    method: "POST",
    body: form,
  });
}

function attachmentContext(attachmentId: string) {
  return { params: Promise.resolve({ attachmentId }) };
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [owner, outsider] = await Promise.all(
    ["owner", "outsider"].map((label) =>
      prisma.user.create({
        data: {
          email: `private-attachment-${label}-${suffix}@t.local`,
          username: `private_attachment_${label}_${suffix}`,
          passwordHash: "x",
          tier: "premium",
        },
      }),
    ),
  );
  mediaRoot = await mkdtemp(join(tmpdir(), "campfire-private-attachments-"));
  previousMediaRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = mediaRoot;
});

afterAll(async () => {
  if (previousMediaRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
  else process.env.CAMPFIRE_UPLOAD_DIR = previousMediaRoot;
  await rm(mediaRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("private attachment routes", () => {
  it("stores a pending upload outside the public uploads directory and limits preview to its owner", async () => {
    signIn(owner);
    const uploadResponse = await uploadAttachment(uploadRequest());
    expect(uploadResponse.status).toBe(201);
    const uploaded = await uploadResponse.json();
    expect(uploaded).toMatchObject({
      attachmentId: expect.any(String),
      name: "trail-map.txt",
      type: "text/plain",
      url: `/api/attachments/${uploaded.attachmentId}`,
    });

    const stored = await prisma.privateUpload.findUniqueOrThrow({
      where: { id: uploaded.attachmentId },
    });
    expect(stored).toMatchObject({
      ownerId: owner.id,
      originalName: "trail-map.txt",
      contentType: "text/plain",
      state: "pending",
    });
    await expect(
      access(join(mediaRoot, "private-uploads", stored.storageKey)),
    ).resolves.toBeUndefined();
    await expect(
      access(join(mediaRoot, "uploads", stored.storageKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const ownerHead = await headAttachment(
      new NextRequest(`http://test.local${uploaded.url}`, { method: "HEAD" }),
      attachmentContext(uploaded.attachmentId),
    );
    expect(ownerHead.status).toBe(200);
    expect(ownerHead.headers.get("content-length")).toBe(String(stored.byteSize));
    expect(ownerHead.headers.get("accept-ranges")).toBe("bytes");

    signIn(outsider);
    expect((await readAttachment(
      new NextRequest(`http://test.local${uploaded.url}`),
      attachmentContext(uploaded.attachmentId),
    )).status).toBe(404);

    signIn(null);
    expect((await readAttachment(
      new NextRequest(`http://test.local${uploaded.url}`),
      attachmentContext(uploaded.attachmentId),
    )).status).toBe(401);
  });
});
