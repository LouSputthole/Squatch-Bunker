import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createGatheringReminderNotifications } from "@/lib/notifications";

// Worker-created Ember Inbox reminders ~15 minutes before a gathering.

const tag = Math.random().toString(36).slice(2, 8);
const NOW = new Date("2031-03-01T18:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

type U = { id: string };
let owner: U, going: U, maybe: U, declined: U, muted: U, leaver: U, mod: U;
let serverId: string;
let soonId: string;
let hiddenLinkedId: string;
let laterId: string;

beforeAll(async () => {
  [owner, going, maybe, declined, muted, leaver, mod] = await Promise.all(
    ["owner", "going", "maybe", "declined", "muted", "leaver", "mod"].map((name) =>
      prisma.user.create({
        data: { email: `remind-${name}-${tag}@t.local`, username: `remind_${name}_${tag}`, passwordHash: "x" },
        select: { id: true },
      }),
    ),
  );
  const server = await prisma.server.create({
    data: {
      name: `Reminder Camp ${tag}`,
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: going.id, role: "member" },
          { userId: maybe.id, role: "member" },
          { userId: declined.id, role: "member" },
          { userId: muted.id, role: "member" },
          { userId: mod.id, role: "mod" },
        ],
      },
    },
  });
  serverId = server.id;
  const [stage, modRoom] = await Promise.all([
    prisma.channel.create({ data: { serverId, name: "stage", type: "voice" } }),
    prisma.channel.create({ data: { serverId, name: "mod-room" } }),
  ]);
  await prisma.channelPermission.create({
    data: { channelId: modRoom.id, role: "member", canView: false, canSend: false },
  });
  await prisma.notificationPreference.create({ data: { userId: muted.id, serverId, level: "none" } });

  const make = (title: string, startsAt: Date, channelId: string | null, rsvps: Array<[U, string]>) =>
    prisma.gathering.create({
      data: {
        serverId,
        channelId,
        creatorId: owner.id,
        title,
        startsAt,
        rsvps: { create: rsvps.map(([user, status]) => ({ userId: user.id, status })) },
      },
      select: { id: true },
    });
  soonId = (await make("Story night", minutes(10), stage.id, [
    [going, "going"], [maybe, "maybe"], [declined, "declined"], [muted, "going"], [leaver, "going"],
  ])).id;
  hiddenLinkedId = (await make("Council", minutes(14), modRoom.id, [[going, "going"], [mod, "going"]])).id;
  laterId = (await make("Tomorrow", minutes(60), null, [[going, "going"]])).id;
  await make("Already started", minutes(-1), null, [[going, "going"]]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createGatheringReminderNotifications", () => {
  it("reminds going/maybe members once, respecting policy, membership, and channel visibility", async () => {
    const created = await createGatheringReminderNotifications(NOW);
    const ids = created.map((n) => n.id).sort();
    expect(ids).toEqual([
      `gathering:${going.id}:${hiddenLinkedId}`,
      `gathering:${going.id}:${soonId}`,
      `gathering:${maybe.id}:${soonId}`,
      `gathering:${mod.id}:${hiddenLinkedId}`,
    ].sort());

    const soon = created.find((n) => n.id === `gathering:${going.id}:${soonId}`)!;
    expect(soon).toMatchObject({ type: "gathering", serverId, userId: going.id });
    expect(soon.channelId).not.toBeNull();
    expect(soon.title).toBe("Starting soon: Story night");
    expect(soon.body).toContain("#stage");
    expect(soon.body).toContain("starts in 10 min");

    // A member who can't see the linked channel gets no channel id or name.
    const hidden = created.find((n) => n.id === `gathering:${going.id}:${hiddenLinkedId}`)!;
    expect(hidden.channelId).toBeNull();
    expect(hidden.body).not.toContain("mod-room");
    const modView = created.find((n) => n.id === `gathering:${mod.id}:${hiddenLinkedId}`)!;
    expect(modView.body).toContain("#mod-room");

    expect(created.some((n) => n.id.includes(laterId))).toBe(false);
  });

  it("is idempotent across passes", async () => {
    expect(await createGatheringReminderNotifications(new Date(NOW.getTime() + 60_000))).toEqual([]);
    expect(await prisma.notification.count({ where: { id: { startsWith: "gathering:" }, serverId } })).toBe(4);
  });

  it("does not resend after the user clears their inbox inside the window", async () => {
    await prisma.notification.deleteMany({ where: { id: { startsWith: "gathering:" }, serverId } });
    expect(await createGatheringReminderNotifications(new Date(NOW.getTime() + 120_000))).toEqual([]);
    expect(await prisma.notification.count({ where: { id: { startsWith: "gathering:" }, serverId } })).toBe(0);
  });
});
