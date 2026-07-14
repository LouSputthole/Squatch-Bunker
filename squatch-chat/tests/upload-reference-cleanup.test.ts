import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { removeUnreferencedUpload } from "@/lib/messageRetention";

async function createUpload() {
  const mediaRoot = await mkdtemp(join(tmpdir(), "campfire-reference-"));
  const uploads = join(mediaRoot, "uploads");
  await mkdir(uploads, { recursive: true });
  const fileName = `${randomUUID()}.txt`;
  const filePath = join(uploads, fileName);
  await writeFile(filePath, "keep me");
  return { mediaRoot, filePath, publicUrl: `/uploads/${fileName}` };
}

afterAll(async () => {
  await prisma.$disconnect();
});

it("preserves a local upload that is still used as a profile banner", async () => {
  const upload = await createUpload();
  await prisma.user.create({
    data: {
      email: `cleanup-banner-${randomUUID()}@t.local`,
      username: `cleanup_banner_${randomUUID()}`,
      passwordHash: "x",
      banner: upload.publicUrl,
    },
  });

  const previousRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = upload.mediaRoot;
  try {
    await removeUnreferencedUpload(upload.publicUrl);
    await expect(access(upload.filePath)).resolves.toBeUndefined();
  } finally {
    if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
    await rm(upload.mediaRoot, { recursive: true, force: true });
  }
});

type ReferenceSeed = (url: string) => Promise<unknown>;

async function createUser(
  label: string,
  media: { avatar?: string; banner?: string } = {},
) {
  const suffix = randomUUID();
  return prisma.user.create({
    data: {
      email: `cleanup-${label}-${suffix}@t.local`,
      username: `cleanup_${label}_${suffix}`,
      passwordHash: "x",
      ...media,
    },
  });
}

async function createServer(
  label: string,
  media: { icon?: string; banner?: string } = {},
) {
  const owner = await createUser(`${label}_owner`);
  return prisma.server.create({
    data: { name: `Cleanup ${label}`, ownerId: owner.id, ...media },
  });
}

async function expectReferencePreserved(seed: ReferenceSeed) {
  const upload = await createUpload();
  await seed(upload.publicUrl);

  const previousRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = upload.mediaRoot;
  try {
    await removeUnreferencedUpload(upload.publicUrl);
    await expect(access(upload.filePath)).resolves.toBeUndefined();
  } finally {
    if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
    await rm(upload.mediaRoot, { recursive: true, force: true });
  }
}

const referenceCases: Array<[string, ReferenceSeed]> = [
  ["profile avatar", async (url) => createUser("avatar", { avatar: url })],
  ["server icon", async (url) => createServer("icon", { icon: url })],
  ["server banner", async (url) => createServer("banner", { banner: url })],
  ["direct message attachment", async (url) => {
    const [author, recipient] = await Promise.all([
      createUser("dm_author"),
      createUser("dm_recipient"),
    ]);
    const conversation = await prisma.conversation.create({
      data: { user1Id: author.id, user2Id: recipient.id },
    });
    return prisma.directMessage.create({
      data: {
        conversationId: conversation.id,
        authorId: author.id,
        content: "retained direct attachment",
        attachmentUrl: url,
      },
    });
  }],
  ["custom emoji", async (url) => {
    const server = await createServer("emoji");
    return prisma.customEmoji.create({
      data: {
        serverId: server.id,
        name: `cleanup_${randomUUID()}`,
        url,
        createdBy: server.ownerId,
      },
    });
  }],
  ["channel message attachment", async (url) => {
    const server = await createServer("message");
    const channel = await prisma.channel.create({
      data: { serverId: server.id, name: "cleanup-message", type: "text" },
    });
    return prisma.message.create({
      data: {
        channelId: channel.id,
        authorId: server.ownerId,
        content: "retained message attachment",
        attachmentUrl: url,
      },
    });
  }],
  ["journal attachment", async (url) => {
    const server = await createServer("journal");
    return prisma.journalEntry.create({
      data: {
        serverId: server.id,
        authorId: server.ownerId,
        content: "retained journal attachment",
        attachmentUrl: url,
      },
    });
  }],
];

it.each(referenceCases)("preserves a local upload used by %s", async (_label, seed) => {
  await expectReferencePreserved(seed);
});
