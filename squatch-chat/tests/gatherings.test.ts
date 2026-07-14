import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  gatheringTiming,
  parseGatheringMutation,
  parseRsvpStatus,
} from "@/lib/gatherings";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import {
  GET as listGatherings,
  POST as createGathering,
} from "@/app/api/servers/[serverId]/gatherings/route";
import {
  PATCH as updateGathering,
  DELETE as deleteGathering,
} from "@/app/api/gatherings/[gatheringId]/route";
import {
  PUT as putRsvp,
  DELETE as deleteRsvp,
} from "@/app/api/gatherings/[gatheringId]/rsvp/route";

let server: { id: string };
let channel: { id: string };
let hiddenChannel: { id: string; name: string; type: string };
let otherChannel: { id: string };
let owner: { id: string; username: string };
let creator: { id: string; username: string };
let attendee: { id: string; username: string };
let manager: { id: string; username: string };
let outsider: { id: string; username: string };

beforeAll(async () => {
  const users = await Promise.all(
    ["owner", "creator", "attendee", "manager", "outsider"].map((name) =>
      prisma.user.create({
        data: {
          email: `gather-${name}@t.local`,
          username: `gather_${name}`,
          passwordHash: "x",
        },
      }),
    ),
  );
  [owner, creator, attendee, manager, outsider] = users;
  server = await prisma.server.create({
    data: {
      name: "Gathering Tests",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: creator.id, role: "member" },
          { userId: attendee.id, role: "member" },
          { userId: manager.id, role: "admin" },
        ],
      },
    },
  });
  channel = await prisma.channel.create({
    data: { serverId: server.id, name: "story-fire", type: "voice" },
  });
  hiddenChannel = await prisma.channel.create({
    data: { serverId: server.id, name: "keepers-only", type: "text" },
  });
  await prisma.channelPermission.createMany({
    data: [
      {
        channelId: hiddenChannel.id,
        role: "member",
        canView: false,
        canSend: false,
      },
      {
        channelId: hiddenChannel.id,
        role: "admin",
        canView: false,
        canSend: false,
      },
    ],
  });
  const other = await prisma.server.create({
    data: {
      name: "Other Gathering Server",
      ownerId: outsider.id,
      members: { create: { userId: outsider.id, role: "owner" } },
    },
  });
  otherChannel = await prisma.channel.create({
    data: { serverId: other.id, name: "elsewhere", type: "voice" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function signIn(user: { id: string; username: string } | null) {
  authMock.getSession.mockResolvedValue(
    user ? { userId: user.id, username: user.username } : null,
  );
}

function serverParams() {
  return { params: Promise.resolve({ serverId: server.id }) };
}

function gatheringParams(gatheringId: string) {
  return { params: Promise.resolve({ gatheringId }) };
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function futureIso(hours = 2) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function makeGathering(creatorId = creator.id) {
  return prisma.gathering.create({
    data: {
      serverId: server.id,
      channelId: channel.id,
      creatorId,
      title: `Gathering ${crypto.randomUUID()}`,
      startsAt: new Date(futureIso()),
      durationMinutes: 60,
    },
  });
}

async function makeHiddenGathering(creatorId = owner.id) {
  return prisma.gathering.create({
    data: {
      serverId: server.id,
      channelId: hiddenChannel.id,
      creatorId,
      title: `Hidden Gathering ${crypto.randomUUID()}`,
      startsAt: new Date(futureIso()),
      durationMinutes: 60,
    },
  });
}

describe("Gathering domain rules", () => {
  it("classifies upcoming, reminder, active, and ended timing", () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    expect(
      gatheringTiming("2026-07-12T13:00:00.000Z", 60, now).phase,
    ).toBe("upcoming");
    expect(
      gatheringTiming("2026-07-12T12:10:00.000Z", 60, now).phase,
    ).toBe("reminder");
    expect(
      gatheringTiming("2026-07-12T11:30:00.000Z", 60, now).phase,
    ).toBe("active");
    expect(
      gatheringTiming("2026-07-12T10:00:00.000Z", 60, now).phase,
    ).toBe("ended");
  });

  it("validates future time, duration, and RSVP status", () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    expect(
      parseGatheringMutation(
        { title: "Too late", startsAt: "2026-07-12T11:00:00.000Z" },
        { now },
      ).ok,
    ).toBe(false);
    expect(
      parseGatheringMutation(
        {
          title: "Valid camp",
          startsAt: "2026-07-12T13:00:00.000Z",
          durationMinutes: 10,
        },
        { now },
      ).ok,
    ).toBe(false);
    expect(parseRsvpStatus("going")).toBe("going");
    expect(parseRsvpStatus("interested")).toBeNull();
  });
});

describe("server Gathering list and create routes", () => {
  it("requires an active membership", async () => {
    signIn(null);
    expect(
      (
        await listGatherings(
          new Request(`http://test.local/api/servers/${server.id}/gatherings`),
          serverParams(),
        )
      ).status,
    ).toBe(401);

    signIn(outsider);
    expect(
      (
        await listGatherings(
          new Request(`http://test.local/api/servers/${server.id}/gatherings`),
          serverParams(),
        )
      ).status,
    ).toBe(403);
  });

  it("creates and lists a validated Gathering with a visible linked channel", async () => {
    signIn(creator);
    const created = await createGathering(
      jsonRequest(
        `http://test.local/api/servers/${server.id}/gatherings`,
        "POST",
        {
          title: "Story night",
          description: "Bring a favorite tale",
          startsAt: futureIso(),
          durationMinutes: 90,
          channelId: channel.id,
        },
      ),
      serverParams(),
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.gathering).toMatchObject({
      title: "Story night",
      durationMinutes: 90,
      participantCount: 0,
      participantCounts: { going: 0, maybe: 0, declined: 0 },
      canManage: true,
      channelId: channel.id,
      channel: { id: channel.id },
    });

    const listed = await listGatherings(
      new Request(`http://test.local/api/servers/${server.id}/gatherings`),
      serverParams(),
    );
    expect(listed.status).toBe(200);
    expect(
      (await listed.json()).gatherings.some(
        (gathering: { id: string }) => gathering.id === body.gathering.id,
      ),
    ).toBe(true);
  });

  it("rejects a linked channel owned by another server", async () => {
    signIn(creator);
    const response = await createGathering(
      jsonRequest("http://test.local/gatherings", "POST", {
        title: "Wrong fire",
        startsAt: futureIso(),
        durationMinutes: 60,
        channelId: otherChannel.id,
      }),
      serverParams(),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a same-server linked channel hidden from the creator", async () => {
    signIn(creator);
    const response = await createGathering(
      jsonRequest("http://test.local/gatherings", "POST", {
        title: "Forged keepers fire",
        startsAt: futureIso(),
        durationMinutes: 60,
        channelId: hiddenChannel.id,
      }),
      serverParams(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Not authorized to link this channel",
    });
  });

  it("keeps the Gathering visible but redacts a hidden linked channel", async () => {
    const gathering = await makeHiddenGathering();
    signIn(attendee);

    const response = await listGatherings(
      new Request(`http://test.local/api/servers/${server.id}/gatherings`),
      serverParams(),
    );
    expect(response.status).toBe(200);
    const listed = (await response.json()).gatherings.find(
      (item: { id: string }) => item.id === gathering.id,
    );
    expect(listed).toMatchObject({
      id: gathering.id,
      title: gathering.title,
      channelId: null,
      channel: null,
    });
    expect(JSON.stringify(listed)).not.toContain(hiddenChannel.id);
    expect(JSON.stringify(listed)).not.toContain(hiddenChannel.name);
  });
});

describe("Gathering update and delete authorization", () => {
  it("allows the creator or MANAGE_SERVER and rejects other members", async () => {
    const gathering = await makeGathering();
    signIn(attendee);
    expect(
      (
        await updateGathering(
          jsonRequest("http://test.local/gathering", "PATCH", {
            title: "Hijacked title",
          }),
          gatheringParams(gathering.id),
        )
      ).status,
    ).toBe(403);

    signIn(creator);
    const updated = await updateGathering(
      jsonRequest("http://test.local/gathering", "PATCH", {
        title: "Creator updated",
      }),
      gatheringParams(gathering.id),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).gathering.title).toBe("Creator updated");

    signIn(manager);
    expect(
      (
        await deleteGathering(
          new Request("http://test.local/gathering", { method: "DELETE" }),
          gatheringParams(gathering.id),
        )
      ).status,
    ).toBe(200);
  });

  it("validates updated future time and linked-channel ownership", async () => {
    const gathering = await makeGathering();
    signIn(creator);
    expect(
      (
        await updateGathering(
          jsonRequest("http://test.local/gathering", "PATCH", {
            startsAt: new Date(Date.now() - 60_000).toISOString(),
          }),
          gatheringParams(gathering.id),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await updateGathering(
          jsonRequest("http://test.local/gathering", "PATCH", {
            channelId: otherChannel.id,
          }),
          gatheringParams(gathering.id),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await updateGathering(
          jsonRequest("http://test.local/gathering", "PATCH", {
            channelId: hiddenChannel.id,
          }),
          gatheringParams(gathering.id),
        )
      ).status,
    ).toBe(403);
  });

  it("redacts a hidden link from a manager's update response", async () => {
    const gathering = await makeHiddenGathering();
    signIn(manager);

    const response = await updateGathering(
      jsonRequest("http://test.local/gathering", "PATCH", {
        title: "Manager updated",
      }),
      gatheringParams(gathering.id),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).gathering).toMatchObject({
      title: "Manager updated",
      channelId: null,
      channel: null,
    });
  });
});

describe("Gathering RSVP routes", () => {
  it("validates status, upserts one RSVP, and returns participant counts", async () => {
    const gathering = await makeGathering();
    signIn(outsider);
    expect(
      (
        await putRsvp(
          jsonRequest("http://test.local/rsvp", "PUT", { status: "going" }),
          gatheringParams(gathering.id),
        )
      ).status,
    ).toBe(403);

    signIn(attendee);
    expect(
      (
        await putRsvp(
          jsonRequest("http://test.local/rsvp", "PUT", {
            status: "interested",
          }),
          gatheringParams(gathering.id),
        )
      ).status,
    ).toBe(400);

    const going = await putRsvp(
      jsonRequest("http://test.local/rsvp", "PUT", { status: "going" }),
      gatheringParams(gathering.id),
    );
    expect(going.status).toBe(200);
    expect((await going.json()).gathering).toMatchObject({
      myRsvp: "going",
      participantCount: 1,
      participantCounts: { going: 1, maybe: 0, declined: 0 },
    });

    const maybe = await putRsvp(
      jsonRequest("http://test.local/rsvp", "PUT", { status: "maybe" }),
      gatheringParams(gathering.id),
    );
    expect((await maybe.json()).gathering.participantCounts).toMatchObject({
      going: 0,
      maybe: 1,
    });

    const cleared = await deleteRsvp(
      new Request("http://test.local/rsvp", { method: "DELETE" }),
      gatheringParams(gathering.id),
    );
    expect((await cleared.json()).gathering.myRsvp).toBeNull();
  });

  it("redacts a hidden link from an attendee's RSVP response", async () => {
    const gathering = await makeHiddenGathering();
    signIn(attendee);

    const response = await putRsvp(
      jsonRequest("http://test.local/rsvp", "PUT", { status: "going" }),
      gatheringParams(gathering.id),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).gathering).toMatchObject({
      channelId: null,
      channel: null,
      myRsvp: "going",
    });
  });

  it("rejects RSVP changes after a Gathering has ended", async () => {
    const gathering = await prisma.gathering.create({
      data: {
        serverId: server.id,
        creatorId: creator.id,
        title: "Already over",
        startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        durationMinutes: 30,
      },
    });
    signIn(attendee);
    expect(
      (
        await putRsvp(
          jsonRequest("http://test.local/rsvp", "PUT", { status: "going" }),
          gatheringParams(gathering.id),
        )
      ).status,
    ).toBe(409);
  });
});
