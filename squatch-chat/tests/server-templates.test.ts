import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { SERVER_TEMPLATES, resolveServerTemplate } from "@/lib/serverTemplates";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST as createServer } from "@/app/api/servers/route";

let userId: string;

function create(body: Record<string, unknown>) {
  return createServer(new Request("http://test.local/api/servers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `server-template-${suffix}@t.local`,
      username: `server_template_${suffix}`,
      passwordHash: "x",
    },
  });
  userId = user.id;
  authMock.getSession.mockResolvedValue({ userId, username: user.username });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveServerTemplate", () => {
  it("treats absent values as no template and rejects unknown ids", () => {
    expect(resolveServerTemplate(undefined)).toEqual({ ok: true, template: null });
    expect(resolveServerTemplate("")).toEqual({ ok: true, template: null });
    expect(resolveServerTemplate("gaming")).toMatchObject({ ok: true, template: { id: "gaming" } });
    expect(resolveServerTemplate("__proto__")).toEqual({ ok: false });
    expect(resolveServerTemplate(1)).toEqual({ ok: false });
  });
});

describe("POST /api/servers templates", () => {
  it("keeps the default single #campfire channel without a template", async () => {
    const response = await create({ name: "Blank camp" });
    expect(response.status).toBe(201);
    const { server } = await response.json();
    expect(server.channels).toHaveLength(1);
    expect(server.channels[0]).toMatchObject({ name: "campfire", type: "text" });
  });

  it("creates the template's channels in order", async () => {
    const template = SERVER_TEMPLATES.find((candidate) => candidate.id === "study")!;
    const response = await create({ name: "Study camp", templateId: "study" });
    expect(response.status).toBe(201);
    const { server } = await response.json();
    expect(server.channels.map((channel: { name: string; type: string; position: number }) => [
      channel.name,
      channel.type,
      channel.position,
    ])).toEqual(template.channels.map((channel, index) => [channel.name, channel.type, index]));
    expect(server.channels.find((channel: { name: string }) => channel.name === "resources"))
      .toMatchObject({ category: "General", topic: "Share study materials" });
    await expect(prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: server.id, userId } },
    })).resolves.toMatchObject({ role: "owner" });
  });

  it("rejects an unknown template without creating a server", async () => {
    const before = await prisma.server.count({ where: { ownerId: userId } });
    expect((await create({ name: "Bad camp", templateId: "nope" })).status).toBe(400);
    expect((await create({ name: "Bad camp", templateId: { id: "gaming" } })).status).toBe(400);
    await expect(prisma.server.count({ where: { ownerId: userId } })).resolves.toBe(before);
  });
});
