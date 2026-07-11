import { describe, it, expect, beforeAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { checkWeightedLimit } from "@/lib/rateLimit";

// POST /api/reports + the weighted rate limiter behind it and the upload
// throttle. Session is stubbed; everything else runs against the test DB.

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST } from "@/app/api/reports/route";

let reporter: { id: string };
let target: { id: string };

function post(body: unknown) {
  return POST(
    new Request("http://test.local/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  reporter = await prisma.user.create({
    data: { email: "rep-a@t.local", username: "rep_a", passwordHash: "x" },
  });
  target = await prisma.user.create({
    data: { email: "rep-b@t.local", username: "rep_b", passwordHash: "x" },
  });
  authMock.getSession.mockResolvedValue({ userId: reporter.id, username: "rep_a" });
});

describe("POST /api/reports", () => {
  it("rejects anonymous callers", async () => {
    authMock.getSession.mockResolvedValueOnce(null);
    const res = await post({ targetUserId: target.id, reason: "does not matter here" });
    expect(res.status).toBe(401);
  });

  it("creates a report, then 409s the duplicate", async () => {
    const res = await post({ targetUserId: target.id, reason: "spamming every channel with links" });
    expect(res.status).toBe(201);
    const { report } = await res.json();
    expect(report.id).toBeTruthy();

    const dup = await post({ targetUserId: target.id, reason: "spamming every channel with links" });
    expect(dup.status).toBe(409);
  });

  it("validates reason length, self-reports, and unknown targets", async () => {
    expect((await post({ targetUserId: target.id, reason: "short" })).status).toBe(400);
    expect((await post({ targetUserId: reporter.id, reason: "reporting myself somehow" })).status).toBe(400);
    expect((await post({ targetUserId: "nope", reason: "user that does not exist" })).status).toBe(404);
  });

  it("rejects a messageId that doesn't belong to the target", async () => {
    // Fresh reporter: the previous tests deliberately spent reporter A's
    // 5-per-hour budget (validation failures consume it too — that's the brake).
    const reporterB = await prisma.user.create({
      data: { email: "rep-c@t.local", username: "rep_c", passwordHash: "x" },
    });
    authMock.getSession.mockResolvedValueOnce({ userId: reporterB.id, username: "rep_c" });
    const res = await post({
      targetUserId: target.id,
      messageId: "not-a-real-message",
      reason: "message report with bogus message id",
    });
    expect(res.status).toBe(404);
  });

  it("rate-limits a reporter to 5 submissions per hour", async () => {
    // Reporter A already spent their budget above — the next call must 429.
    const res = await post({ targetUserId: target.id, reason: "budget is spent by now" });
    expect(res.status).toBe(429);
  });
});

describe("checkWeightedLimit", () => {
  it("consumes weight and rejects past the cap without burning budget", () => {
    const key = `t:${Math.random()}`;
    expect(checkWeightedLimit(key, 40, 100, 60_000).allowed).toBe(true);
    expect(checkWeightedLimit(key, 40, 100, 60_000).allowed).toBe(true);
    // 80 used; 40 more would exceed 100 → rejected, and NOT consumed…
    expect(checkWeightedLimit(key, 40, 100, 60_000).allowed).toBe(false);
    // …so a smaller weight still fits.
    expect(checkWeightedLimit(key, 20, 100, 60_000).allowed).toBe(true);
  });

  it("separate keys have separate budgets", () => {
    const a = `t:${Math.random()}`;
    const b = `t:${Math.random()}`;
    expect(checkWeightedLimit(a, 100, 100, 60_000).allowed).toBe(true);
    expect(checkWeightedLimit(b, 100, 100, 60_000).allowed).toBe(true);
  });
});
