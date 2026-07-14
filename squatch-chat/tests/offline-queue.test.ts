import { beforeEach, describe, expect, it, vi } from "vitest";

const socketMock = vi.hoisted(() => ({
  emit: vi.fn(),
  getSocket: vi.fn(),
}));

vi.mock("@/lib/socket", () => ({
  getSocket: socketMock.getSocket,
}));

import {
  flushOfflineMessage,
  type QueuedMessage,
} from "@/hooks/useOfflineQueue";

const queued: QueuedMessage = {
  id: "local-only-id",
  channelId: "channel-1",
  content: "Back around the fire",
  timestamp: 1,
};

beforeEach(() => {
  socketMock.emit.mockReset();
  socketMock.getSocket.mockReset();
  socketMock.getSocket.mockReturnValue({ emit: socketMock.emit });
});

describe("offline queue persistence", () => {
  it("publishes exactly the server-persisted message to authenticated realtime peers", async () => {
    const persisted = {
      id: "persisted-message-id",
      channelId: queued.channelId,
      content: queued.content,
      author: { id: "user-1", username: "camper", avatar: null },
    };
    const request = vi.fn().mockResolvedValue(
      Response.json({ message: persisted }, { status: 201 }),
    );

    await flushOfflineMessage(queued, request as typeof fetch);

    expect(socketMock.emit).toHaveBeenCalledTimes(1);
    expect(socketMock.emit).toHaveBeenCalledWith("message:send", {
      channelId: queued.channelId,
      message: persisted,
    });
  });

  it("does not publish rejected or malformed persistence responses", async () => {
    const rejected = vi.fn().mockResolvedValue(
      Response.json({ error: "No access" }, { status: 403 }),
    );
    const malformed = vi.fn().mockResolvedValue(
      Response.json({ message: { channelId: queued.channelId } }, { status: 201 }),
    );

    await flushOfflineMessage(queued, rejected as typeof fetch);
    await flushOfflineMessage(queued, malformed as typeof fetch);

    expect(socketMock.emit).not.toHaveBeenCalled();
  });
});
