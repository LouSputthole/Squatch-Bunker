import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { DELETE } from "@/app/api/servers/[serverId]/sounds/[soundId]/route";

let serverId: string;
let soundId: string;
let bannedUploaderId: string;

beforeAll(async () => {
  const [owner, uploader] = await Promise.all([
    prisma.user.create({
      data: {
        email: "sound-owner@t.local",
        username: "sound_owner",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "sound-uploader@t.local",
        username: "sound_uploader",
        passwordHash: "x",
      },
    }),
  ]);
  bannedUploaderId = uploader.id;
  const server = await prisma.server.create({
    data: { name: "Sound authorization", ownerId: owner.id },
  });
  serverId = server.id;
  await Promise.all([
    prisma.serverMember.create({
      data: { serverId, userId: owner.id, role: "owner" },
    }),
    prisma.serverMember.create({
      data: {
        serverId,
        userId: uploader.id,
        role: "member",
        banned: true,
      },
    }),
  ]);
  const sound = await prisma.sound.create({
    data: {
      serverId,
      name: "old upload",
      dataUrl: "data:audio/wav;base64,AA==",
      createdBy: uploader.id,
    },
  });
  soundId = sound.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DELETE /api/servers/:serverId/sounds/:soundId authorization", () => {
  it("does not let a banned uploader delete their former server sound", async () => {
    authMock.getSession.mockResolvedValue({
      userId: bannedUploaderId,
      username: "sound_uploader",
    });

    const response = await DELETE(
      new NextRequest(`http://test.local/api/servers/${serverId}/sounds/${soundId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ serverId, soundId }) },
    );

    expect(response.status).toBe(403);
    await expect(
      prisma.sound.findUnique({ where: { id: soundId } }),
    ).resolves.not.toBeNull();
  });
});
