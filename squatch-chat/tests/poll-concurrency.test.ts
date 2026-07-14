import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const poll = {
    id: "poll-single",
    serverId: "server-1",
    channelId: "channel-1",
    messageId: "message-1",
    creatorId: "owner-1",
    question: "Pick one",
    allowMultiple: false,
    closesAt: null,
    closedAt: null,
    createdAt: new Date("2026-07-13T00:00:00Z"),
    options: [
      { id: "option-a", pollId: "poll-single", text: "A", position: 0, votes: [] },
      { id: "option-b", pollId: "poll-single", text: "B", position: 1, votes: [] },
    ],
    votes: [],
  };
  const transactionVotes = {
    findUnique: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  };
  const prisma = {
    poll: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    $transaction: vi.fn(
      async (
        operation: (tx: { pollVote: typeof transactionVotes }) => Promise<unknown>,
        options?: { isolationLevel?: string },
      ) => {
        void options;
        return operation({ pollVote: transactionVotes });
      },
    ),
  };
  return {
    poll,
    prisma,
    transactionVotes,
    getSession: vi.fn(),
    resolveChannelAccess: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/channelAccess", () => ({
  resolveChannelAccess: mocks.resolveChannelAccess,
}));
vi.mock("@/lib/serverRoles", () => ({ memberHasPermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { POST as votePoll } from "@/app/api/polls/[pollId]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ userId: "member-1", username: "member" });
  mocks.resolveChannelAccess.mockResolvedValue({
    serverId: "server-1",
    canView: true,
    canSend: true,
  });
  mocks.prisma.poll.findUnique.mockResolvedValue(mocks.poll);
  mocks.prisma.poll.findUniqueOrThrow.mockResolvedValue(mocks.poll);
  mocks.transactionVotes.findUnique.mockResolvedValue(null);
  mocks.transactionVotes.deleteMany.mockResolvedValue({ count: 0 });
  mocks.transactionVotes.create.mockResolvedValue({ id: "vote-1" });
});

describe("single-choice poll concurrency", () => {
  it("retries a serialization conflict and commits the vote atomically", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce({ code: "P2034" });

    const response = await votePoll(
      new Request("http://test.local/api/polls/poll-single", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optionId: "option-a" }),
      }),
      { params: Promise.resolve({ pollId: "poll-single" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.$transaction.mock.calls.map((call) => call[1])).toEqual([
      { isolationLevel: "Serializable" },
      { isolationLevel: "Serializable" },
    ]);
    expect(mocks.transactionVotes.create).toHaveBeenCalledOnce();
  });
});
