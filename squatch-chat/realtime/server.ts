import { createServer, Server as HttpServer } from "http";
import { pathToFileURL } from "url";
import { Server } from "socket.io";
import { parse } from "cookie";
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";
import { validateSessionToken } from "@/lib/auth";
import { requireMembership } from "@/lib/membership";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { memberHasPermission } from "@/lib/serverRoles";
import {
  registerRealtimeAuthorizationListener,
  type RealtimeAuthorizationChange,
} from "@/lib/realtimeControl";
import { usersHaveBlock } from "@/lib/userBlocks";
import { checkRateLimit } from "@/lib/rateLimit";

const COOKIE_NAME = process.env.COOKIE_NAME || "squatch-token";
const SOCKET_PATH = process.env.SOCKET_PATH || "/api/socketio";

// ─── Payload guards ───
// Socket payloads arrive untrusted from the client. These keep validation
// boring and consistent: every handler asserts the shape of the fields it
// actually reads before using them.
function isStr(v: unknown): v is string {
  return typeof v === "string";
}
function isObj(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}
// WebRTC SDP / ICE payloads are relayed opaquely and never inspected, so we
// only assert they are present and roughly shaped (object or string).
function isBlob(v: unknown): boolean {
  return (typeof v === "object" && v !== null) || typeof v === "string";
}

// CORS — never reflect arbitrary origins (that allows cross-site WebSocket
// hijacking when credentials are sent). Same-origin connections (the unified
// single-port server) are not subject to browser CORS at all, so they keep
// working regardless. Cross-origin connections must be explicitly allow-listed,
// plus — in self-hosted mode — private-LAN origins so "share the Network URL"
// and cross-port dev still work without exposing the box to public origins.
const SELF_HOSTED = !process.env.CORS_ORIGINS && !process.env.STRICT_CORS;
const ALLOWED_ORIGINS = new Set<string>();
{
  const raw = process.env.CORS_ORIGINS || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  for (const o of raw.split(",").map((s) => s.trim()).filter(Boolean)) ALLOWED_ORIGINS.add(o);
}

function isPrivateLanOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
    // RFC1918 private ranges + link-local — not public internet origins.
    return /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin header (native apps, server-to-server) carries no ambient-cookie
  // CSWSH risk.
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (SELF_HOSTED && isPrivateLanOrigin(origin)) return true;
  return false;
}

// ─── Process-level safety nets ───
// A malformed packet or rejected promise must never take down the shared
// process that also serves Next.js. Log and keep running.
process.on("uncaughtException", (err) => {
  console.error("[Campfire] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Campfire] unhandledRejection:", reason);
});

// ─── Shared State ───
const onlineUsers = new Map<string, Map<string, { username: string; socketId: string }>>();
const voiceRooms = new Map<string, Map<string, { username: string; socketId: string; muted: boolean; deafened: boolean; camera: boolean; avatar?: string | null }>>();
const voiceChannelServer = new Map<string, string>();
const userVoiceChannel = new Map<string, string>();
type PresenceStatus = "online" | "idle" | "dnd" | "invisible";
const userStatus = new Map<string, PresenceStatus>();
const serverMuted = new Set<string>();
const serverDeafened = new Set<string>();
const heartbeats = new Map<string, number>();
// Track every live socket per user so presence/voice are only torn down when a
// user's LAST tab disconnects (multi-tab no longer creates ghost seats).
const userSockets = new Map<string, Set<string>>();
interface LanternRoomState {
  hostId: string;
  holderId: string | null;
  queue: string[];
}
const lanternRooms = new Map<string, LanternRoomState>();
interface OffshootMemberState {
  username: string;
  socketId: string;
}
interface OffshootRoomState {
  id: string;
  name: string;
  creatorId: string;
  createdAt: number;
  members: Map<string, OffshootMemberState>;
}
const offshootRooms = new Map<string, Map<string, OffshootRoomState>>();
const offshootMembership = new Map<string, { channelId: string; offshootId: string }>();
const MAX_OFFSHOOTS_PER_PARENT = 3;
const MAX_OFFSHOOT_MEMBERS = 4;
const MAX_OFFSHOOT_NAME_LENGTH = 32;

const HEARTBEAT_INTERVAL = 15000;
const HEARTBEAT_TIMEOUT = 45000;
const SESSION_REVALIDATE_INTERVAL = 60_000;

// Wrap a socket handler so a thrown error (sync) or a rejected promise (async)
// is logged instead of crashing the shared server.
function safeHandler<A extends unknown[]>(fn: (...args: A) => void | Promise<void>) {
  return (...args: A) => {
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        result.catch((err) => console.error("[Campfire] handler error:", err));
      }
    } catch (err) {
      console.error("[Campfire] handler error:", err);
    }
  };
}

/**
 * Attach Socket.IO to any HTTP server. Works for:
 * - Unified server (single port with Next.js)
 * - Standalone mode (separate port)
 */
export function attachSocketIO(
  httpServer: HttpServer,
  options: { rateLimitNow?: () => number } = {},
): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
      credentials: true,
    },
    path: SOCKET_PATH,
  });

  // Auth middleware — run the SAME validation the HTTP session uses so a socket
  // can't be authorized by a token the HTTP layer would reject.
  // validateSessionToken pins HS256, loads the user, and enforces tokenVersion
  // revocation and guest expiry (previously the socket path did none of this).
  // Password resets disconnect active sockets immediately through the realtime
  // control bridge, and a periodic sweep closes sessions invalidated by expiry,
  // user deletion, or a missed cross-process notification.
  io.use(async (socket, next) => {
    const rawCookie = socket.handshake.headers.cookie;
    if (!rawCookie) return next(new Error("Unauthorized"));
    const parsed = parse(rawCookie);
    const token = parsed[COOKIE_NAME];
    if (!token) return next(new Error("Unauthorized"));
    const payload = await validateSessionToken(token);
    if (!payload) return next(new Error("Unauthorized"));
    socket.data.userId = payload.userId;
    socket.data.username = payload.username;
    socket.data.sessionToken = token;
    next();
  });

  function voiceParticipantsPayload(channelId: string) {
    const room = voiceRooms.get(channelId);
    return {
      channelId,
      participants: room
        ? Array.from(room.entries()).map(([userId, info]) => ({
            userId,
            username: info.username,
            muted: info.muted,
            deafened: info.deafened,
            camera: info.camera,
            avatar: info.avatar,
          }))
        : [],
    };
  }

  async function channelServerId(channelId: string): Promise<string | null> {
    const cached = voiceChannelServer.get(channelId);
    if (cached) return cached;
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true, type: true },
    });
    if (!channel) return null;
    if (channel.type === "voice") voiceChannelServer.set(channelId, channel.serverId);
    return channel.serverId;
  }

  /**
   * A voice room is also projected into the server-wide channel list. Build a
   * recipient set and authorize each socket separately so a hidden room never
   * leaks its id or participant roster through that projection.
   */
  async function broadcastVoiceParticipantsAuthorized(channelId: string): Promise<void> {
    const candidates = new Set<string>(
      io.sockets.adapter.rooms.get(`voice:${channelId}`) ?? [],
    );
    const serverId = await channelServerId(channelId);
    if (serverId) {
      for (const socketId of io.sockets.adapter.rooms.get(`server:${serverId}`) ?? []) {
        candidates.add(socketId);
      }
    }

    const payload = voiceParticipantsPayload(channelId);
    const accessByUser = new Map<string, Promise<boolean>>();
    await Promise.all(Array.from(candidates, async (socketId) => {
      const recipient = io.sockets.sockets.get(socketId);
      const userId = recipient?.data.userId as string | undefined;
      if (!recipient || !userId) return;
      let allowed = accessByUser.get(userId);
      if (!allowed) {
        allowed = resolveChannelAccess(channelId, userId)
          .then((access) => access?.canView === true);
        accessByUser.set(userId, allowed);
      }
      if (await allowed) recipient.emit("voice:participants-update", payload);
    }));
  }

  function broadcastVoiceParticipantsScoped(channelId: string): void {
    void broadcastVoiceParticipantsAuthorized(channelId).catch((error) => {
      console.error("[Campfire] voice roster authorization failed:", error);
    });
  }

  function realtimeOffshootPayload(channelId: string) {
    const rooms = offshootRooms.get(channelId);
    return {
      channelId,
      offshoots: rooms
        ? Array.from(rooms.values())
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((room) => ({
              id: room.id,
              name: room.name,
              creatorId: room.creatorId,
              members: Array.from(room.members.entries()).map(([userId, member]) => ({
                userId,
                username: member.username,
              })),
            }))
        : [],
      limits: {
        maxOffshoots: MAX_OFFSHOOTS_PER_PARENT,
        maxMembers: MAX_OFFSHOOT_MEMBERS,
      },
    };
  }

  function broadcastRealtimeOffshoots(channelId: string): void {
    io.to(`voice:${channelId}`).emit("offshoot:update", realtimeOffshootPayload(channelId));
  }

  function removeUserFromRealtimeOffshoot(channelId: string, userId: string): void {
    const assignment = offshootMembership.get(userId);
    if (!assignment || assignment.channelId !== channelId) return;
    const rooms = offshootRooms.get(assignment.channelId);
    const room = rooms?.get(assignment.offshootId);
    offshootMembership.delete(userId);
    if (!rooms || !room) return;

    room.members.delete(userId);
    if (room.creatorId === userId || room.members.size === 0) {
      for (const memberId of room.members.keys()) {
        const current = offshootMembership.get(memberId);
        if (
          current?.channelId === assignment.channelId
          && current.offshootId === assignment.offshootId
        ) {
          offshootMembership.delete(memberId);
        }
      }
      rooms.delete(assignment.offshootId);
      if (rooms.size === 0) offshootRooms.delete(assignment.channelId);
    }
    broadcastRealtimeOffshoots(assignment.channelId);
  }

  function realtimeLanternPayload(channelId: string) {
    const state = lanternRooms.get(channelId);
    const room = voiceRooms.get(channelId);
    if (!state) {
      return { channelId, active: false, hostId: null, holderId: null, queue: [] };
    }
    return {
      channelId,
      active: true,
      hostId: state.hostId,
      holderId: state.holderId,
      queue: state.queue
        .filter((userId) => room?.has(userId))
        .map((userId) => ({
          userId,
          username: room?.get(userId)?.username || "Camper",
        })),
    };
  }

  function broadcastRealtimeLantern(channelId: string): void {
    io.to(`voice:${channelId}`).emit("lantern:update", realtimeLanternPayload(channelId));
  }

  function removeUserFromRealtimeLantern(channelId: string, userId: string): void {
    const state = lanternRooms.get(channelId);
    const room = voiceRooms.get(channelId);
    if (!state) return;
    state.queue = state.queue.filter((queuedId) => queuedId !== userId);
    if (state.holderId === userId) {
      let next: string | undefined;
      while (state.queue.length > 0 && !next) {
        const candidate = state.queue.shift();
        if (candidate && room?.has(candidate)) next = candidate;
      }
      state.holderId = next ?? null;
    }
    if (!room || room.size === 0) {
      lanternRooms.delete(channelId);
    } else if (state.hostId === userId) {
      state.hostId = state.holderId && room.has(state.holderId)
        ? state.holderId
        : (room.keys().next().value as string);
    }
    broadcastRealtimeLantern(channelId);
  }

  async function evictVoiceParticipant(channelId: string, userId: string): Promise<void> {
    const room = voiceRooms.get(channelId);
    const entry = room?.get(userId);
    const socketIds = new Set(userSockets.get(userId) ?? []);
    if (entry) socketIds.add(entry.socketId);
    let wasParticipant = !!entry
      || userVoiceChannel.get(userId) === channelId
      || offshootMembership.get(userId)?.channelId === channelId;
    await Promise.all(Array.from(socketIds, async (socketId) => {
      const participantSocket = io.sockets.sockets.get(socketId);
      if (participantSocket?.rooms.has(`voice:${channelId}`)) {
        wasParticipant = true;
        await participantSocket.leave(`voice:${channelId}`);
      }
    }));
    if (!wasParticipant) return;

    if (entry) {
      room?.delete(userId);
      io.to(`voice:${channelId}`).emit("voice:user-left", {
        channelId,
        userId,
        socketId: entry.socketId,
      });
    }
    if (userVoiceChannel.get(userId) === channelId) userVoiceChannel.delete(userId);
    removeUserFromRealtimeOffshoot(channelId, userId);
    if (room?.size === 0) voiceRooms.delete(channelId);
    removeUserFromRealtimeLantern(channelId, userId);
    await broadcastVoiceParticipantsAuthorized(channelId);
  }

  async function refreshChannelForUser(channelId: string, userId: string): Promise<void> {
    const [access, channel] = await Promise.all([
      resolveChannelAccess(channelId, userId),
      prisma.channel.findUnique({ where: { id: channelId }, select: { type: true } }),
    ]);
    const socketIds = userSockets.get(userId) ?? new Set<string>();
    if (!access?.canView) {
      await Promise.all(Array.from(socketIds, async (socketId) => {
        const memberSocket = io.sockets.sockets.get(socketId);
        if (memberSocket) await memberSocket.leave(`channel:${channelId}`);
      }));
    }
    if (!access?.canView || channel?.type !== "voice") {
      await evictVoiceParticipant(channelId, userId);
    }
  }

  async function joinedChannelsForServer(userId: string, serverId: string): Promise<string[]> {
    const ids = new Set<string>();
    for (const socketId of userSockets.get(userId) ?? []) {
      const memberSocket = io.sockets.sockets.get(socketId);
      for (const room of memberSocket?.rooms ?? []) {
        if (room.startsWith("channel:")) ids.add(room.slice("channel:".length));
        if (room.startsWith("voice:")) ids.add(room.slice("voice:".length));
      }
    }
    for (const [channelId, participants] of voiceRooms) {
      if (participants.has(userId)) ids.add(channelId);
    }
    if (ids.size === 0) return [];

    const channels = await prisma.channel.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, serverId: true },
    });
    const persisted = new Map(channels.map((channel) => [channel.id, channel.serverId]));
    return Array.from(ids).filter((channelId) => (
      persisted.get(channelId) === serverId
      || (!persisted.has(channelId) && voiceChannelServer.get(channelId) === serverId)
    ));
  }

  function broadcastPresenceState(serverId: string): void {
    const serverMap = onlineUsers.get(serverId);
    const members = serverMap
      ? Array.from(serverMap.entries()).map(([userId, info]) => ({
          userId,
          username: info.username,
          status: userStatus.get(userId) || "online",
        }))
      : [];
    io.to(`server:${serverId}`).emit("presence:update", { serverId, members });
  }

  async function refreshMemberForServer(serverId: string, userId: string): Promise<void> {
    const membership = await requireMembership(serverId, userId);
    const channels = await joinedChannelsForServer(userId, serverId);
    if (!membership) {
      await Promise.all(Array.from(userSockets.get(userId) ?? [], async (socketId) => {
        const memberSocket = io.sockets.sockets.get(socketId);
        if (memberSocket) await memberSocket.leave(`server:${serverId}`);
      }));
      onlineUsers.get(serverId)?.delete(userId);
      if (onlineUsers.get(serverId)?.size === 0) onlineUsers.delete(serverId);
      serverMuted.delete(`${serverId}:${userId}`);
      serverDeafened.delete(`${serverId}:${userId}`);
      broadcastPresenceState(serverId);
    }
    await Promise.all(
      channels.map((channelId) => refreshChannelForUser(channelId, userId)),
    );
  }

  async function refreshChannelAuthorization(
    channelId: string,
    userId?: string,
  ): Promise<void> {
    const users = new Set<string>();
    if (userId) {
      users.add(userId);
    } else {
      for (const socketId of io.sockets.adapter.rooms.get(`channel:${channelId}`) ?? []) {
        const id = io.sockets.sockets.get(socketId)?.data.userId as string | undefined;
        if (id) users.add(id);
      }
      for (const socketId of io.sockets.adapter.rooms.get(`voice:${channelId}`) ?? []) {
        const id = io.sockets.sockets.get(socketId)?.data.userId as string | undefined;
        if (id) users.add(id);
      }
      for (const id of voiceRooms.get(channelId)?.keys() ?? []) users.add(id);
    }
    await Promise.all(
      Array.from(users, (id) => refreshChannelForUser(channelId, id)),
    );
  }

  async function refreshRealtimeAuthorization(
    change: RealtimeAuthorizationChange,
  ): Promise<void> {
    if (change.scope === "session") {
      io.in(`user:${change.userId}`).disconnectSockets(true);
      return;
    }
    if (change.scope === "channel") {
      await refreshChannelAuthorization(change.channelId, change.userId);
      return;
    }
    if (change.scope === "member") {
      await refreshMemberForServer(change.serverId, change.userId);
      return;
    }
    const users = change.userId ? [change.userId] : Array.from(userSockets.keys());
    await Promise.all(
      users.map((userId) => refreshMemberForServer(change.serverId, userId)),
    );
  }

  const unregisterAuthorizationListener = registerRealtimeAuthorizationListener(
    refreshRealtimeAuthorization,
  );
  httpServer.once("close", unregisterAuthorizationListener);

  // Heartbeat cleanup
  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [socketId, lastBeat] of heartbeats) {
      if (now - lastBeat > HEARTBEAT_TIMEOUT) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
          console.log(`[Campfire] Heartbeat timeout: ${sock.data.username}`);
          sock.disconnect(true);
        }
        heartbeats.delete(socketId);
      }
    }
  }, HEARTBEAT_INTERVAL);
  heartbeatTimer.unref();

  const sessionRevalidationTimer = setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.data.sessionToken as string | undefined;
      if (!token) {
        socket.disconnect(true);
        continue;
      }
      void validateSessionToken(token)
        .then((payload) => {
          if (!payload && socket.connected) socket.disconnect(true);
        })
        .catch((error) => {
          console.error("[Campfire] realtime session revalidation failed:", error);
          if (socket.connected) socket.disconnect(true);
        });
    }
  }, SESSION_REVALIDATE_INTERVAL);
  sessionRevalidationTimer.unref();
  httpServer.once("close", () => {
    clearInterval(heartbeatTimer);
    clearInterval(sessionRevalidationTimer);
  });

  // Connection handler
  io.on("connection", (socket) => {
    const currentUserId = socket.data.userId as string;
    const currentUsername = socket.data.username as string;
    console.log(`[Campfire] Authenticated socket: ${currentUsername}`);

    heartbeats.set(socket.id, Date.now());
    if (!userSockets.has(currentUserId)) userSockets.set(currentUserId, new Set());
    userSockets.get(currentUserId)!.add(socket.id);
    socket.join(`user:${currentUserId}`);
    socket.on("heartbeat", safeHandler(() => { heartbeats.set(socket.id, Date.now()); }));
    userStatus.set(currentUserId, "online");

    // Drop high-frequency / broadcast emits that exceed the shared rate limit.
    // Keyed per authenticated user + event so reconnects and extra tabs cannot reset it.
    function overLimit(event: string): boolean {
      const result = checkRateLimit(
        `realtime:${currentUserId}:${event}`,
        options.rateLimitNow?.() ?? Date.now(),
      );
      return !result.allowed;
    }

    // Relay a WebRTC signaling packet only when BOTH the sender and the named
    // target socket are members of the same voice room. Without this a client
    // could address any socket id and have the server forward attacker-chosen
    // SDP/ICE to it.
    function sameVoiceRoom(targetSocketId: string, channelId: string): boolean {
      const room = `voice:${channelId}`;
      if (!socket.rooms.has(room)) return false;
      const target = io.sockets.sockets.get(targetSocketId);
      return !!target && target.rooms.has(room);
    }


    function lanternPayload(channelId: string) {
      const state = lanternRooms.get(channelId);
      const room = voiceRooms.get(channelId);
      if (!state) {
        return { channelId, active: false, hostId: null, holderId: null, queue: [] };
      }
      return {
        channelId,
        active: true,
        hostId: state.hostId,
        holderId: state.holderId,
        queue: state.queue
          .filter((userId) => room?.has(userId))
          .map((userId) => ({ userId, username: room?.get(userId)?.username || "Camper" })),
      };
    }

    function broadcastLantern(channelId: string) {
      io.to(`voice:${channelId}`).emit("lantern:update", lanternPayload(channelId));
    }

    function advanceLantern(channelId: string) {
      const state = lanternRooms.get(channelId);
      const room = voiceRooms.get(channelId);
      if (!state) return;
      let next: string | undefined;
      while (state.queue.length > 0 && !next) {
        const candidate = state.queue.shift();
        if (candidate && room?.has(candidate)) next = candidate;
      }
      state.holderId = next || null;
    }

    function removeFromLantern(channelId: string, userId: string) {
      const state = lanternRooms.get(channelId);
      const room = voiceRooms.get(channelId);
      if (!state) return;
      state.queue = state.queue.filter((queuedId) => queuedId !== userId);
      if (state.holderId === userId) advanceLantern(channelId);
      if (!room || room.size === 0) {
        lanternRooms.delete(channelId);
      } else if (state.hostId === userId) {
        state.hostId = state.holderId && room.has(state.holderId)
          ? state.holderId
          : (room.keys().next().value as string);
      }
      broadcastLantern(channelId);
    }

    async function canControlLantern(channelId: string, state: LanternRoomState) {
      if (state.hostId === currentUserId) return true;
      const serverId = voiceChannelServer.get(channelId);
      return !!serverId && memberHasPermission(serverId, currentUserId, "MOVE_MEMBERS");
    }
    function offshootPayload(channelId: string) {
      const rooms = offshootRooms.get(channelId);
      return {
        channelId,
        offshoots: rooms
          ? Array.from(rooms.values())
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((room) => ({
                id: room.id,
                name: room.name,
                creatorId: room.creatorId,
                members: Array.from(room.members.entries()).map(([userId, member]) => ({
                  userId,
                  username: member.username,
                })),
              }))
          : [],
        limits: {
          maxOffshoots: MAX_OFFSHOOTS_PER_PARENT,
          maxMembers: MAX_OFFSHOOT_MEMBERS,
        },
      };
    }

    function broadcastOffshoots(channelId: string) {
      io.to(`voice:${channelId}`).emit("offshoot:update", offshootPayload(channelId));
    }

    function isCurrentVoiceParticipant(channelId: string): boolean {
      const participant = voiceRooms.get(channelId)?.get(currentUserId);
      return participant?.socketId === socket.id && socket.rooms.has(`voice:${channelId}`);
    }

    function emitOffshootError(channelId: string, code: string, message: string) {
      socket.emit("offshoot:error", { channelId, code, message });
    }

    function closeOffshoot(channelId: string, offshootId: string) {
      const rooms = offshootRooms.get(channelId);
      const room = rooms?.get(offshootId);
      if (!room || !rooms) return;
      for (const memberId of room.members.keys()) {
        const assignment = offshootMembership.get(memberId);
        if (assignment?.channelId === channelId && assignment.offshootId === offshootId) {
          offshootMembership.delete(memberId);
        }
      }
      rooms.delete(offshootId);
      if (rooms.size === 0) offshootRooms.delete(channelId);
    }

    function removeUserFromOffshoot(userId: string, shouldBroadcast = true) {
      const assignment = offshootMembership.get(userId);
      if (!assignment) return;
      const rooms = offshootRooms.get(assignment.channelId);
      const room = rooms?.get(assignment.offshootId);
      offshootMembership.delete(userId);

      if (!room || !rooms) return;
      room.members.delete(userId);
      if (room.creatorId === userId || room.members.size === 0) {
        closeOffshoot(assignment.channelId, room.id);
      }
      if (shouldBroadcast) broadcastOffshoots(assignment.channelId);
    }

    function leaveCurrentOffshoot(shouldBroadcast = true) {
      removeUserFromOffshoot(currentUserId, shouldBroadcast);
    }
    // ─── Channel Rooms ───
    socket.on("channel:join", safeHandler(async (channelId: string) => {
      if (!isStr(channelId)) return;
      const access = await resolveChannelAccess(channelId, currentUserId);
      if (!access?.canView) return;
      socket.join(`channel:${channelId}`);
    }));
    socket.on("channel:leave", safeHandler((channelId: string) => {
      if (!isStr(channelId)) return;
      socket.leave(`channel:${channelId}`);
    }));

    // ─── Server Presence ───
    socket.on("server:join", safeHandler(async (data: string | { serverId: string }) => {
      const serverId = typeof data === "string" ? data : data?.serverId;
      if (!isStr(serverId)) return;
      // Authoritative role comes from the DB — never trust a client-supplied
      // role. Non-members (or banned users) get no presence and no role.
      const membership = await requireMembership(serverId, currentUserId);
      if (!membership) return;
      socket.join(`server:${serverId}`);
      if (!onlineUsers.has(serverId)) onlineUsers.set(serverId, new Map());
      onlineUsers.get(serverId)!.set(currentUserId, { username: currentUsername, socketId: socket.id });
      broadcastPresence(serverId);
    }));

    socket.on("server:leave", safeHandler((serverId: string) => {
      if (!isStr(serverId)) return;
      socket.leave(`server:${serverId}`);
      removeFromPresence(serverId, currentUserId);
    }));

    // ─── Messages ───
    socket.on("message:send", safeHandler(async (data: { channelId: string; message: { id: string } }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isObj(data.message) || !isStr(data.message.id)) return;
      if (overLimit("message:send")) return;
      const access = await resolveChannelAccess(data.channelId, currentUserId);
      if (!access?.canSend) return;
      // Never trust the client's claimed identity — stamp the real author.
      const message = await prisma.message.findFirst({
        where: {
          id: data.message.id,
          channelId: data.channelId,
          authorId: currentUserId,
        },
        include: {
          author: { select: { id: true, username: true, avatar: true } },
          replyTo: {
            select: { id: true, content: true, author: { select: { id: true, username: true } } },
          },
          poll: {
            include: {
              options: { orderBy: { position: "asc" }, include: { votes: { select: { userId: true } } } },
              votes: { select: { userId: true, optionId: true } },
            },
          },
        },
      });
      if (!message) return;
      socket.to(`channel:${data.channelId}`).emit(`message:channel:${data.channelId}`, message);
    }));

    socket.on("message:edit", safeHandler(async (data: { channelId: string; messageId: string; content: string; updatedAt: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.messageId)) return;
      if (overLimit("message:edit")) return;
      const access = await resolveChannelAccess(data.channelId, currentUserId);
      if (!access?.canView) return;
      const msg = await prisma.message.findFirst({
        where: { id: data.messageId, channelId: data.channelId },
        select: { content: true, updatedAt: true },
      });
      if (!msg) return;
      socket.to(`channel:${data.channelId}`).emit(`message:edited:${data.channelId}`, {
        messageId: data.messageId,
        content: msg.content,
        updatedAt: msg.updatedAt,
      });
    }));

    socket.on("message:delete", safeHandler(async (data: { channelId: string; messageId: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.messageId)) return;
      if (overLimit("message:delete")) return;
      const access = await resolveChannelAccess(data.channelId, currentUserId);
      if (!access?.canView) return;
      // Only relay after the authorized HTTP mutation really removed the row.
      const msg = await prisma.message.findFirst({ where: { id: data.messageId, channelId: data.channelId }, select: { id: true } });
      if (msg) return;
      socket.to(`channel:${data.channelId}`).emit(`message:deleted:${data.channelId}`, { messageId: data.messageId });
    }));

    socket.on("message:react", safeHandler(async (data: { channelId: string; messageId: string; reactions: Record<string, { count: number; users: string[]; userIds: string[] }> }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.messageId)) return;
      if (overLimit("message:react")) return;
      const access = await resolveChannelAccess(data.channelId, currentUserId);
      if (!access?.canView) return;
      const message = await prisma.message.findFirst({
        where: { id: data.messageId, channelId: data.channelId },
        include: { reactions: { include: { user: { select: { username: true } } } } },
      });
      if (!message) return;
      const reactions: Record<string, { count: number; users: string[]; userIds: string[] }> = {};
      for (const reaction of message.reactions) {
        reactions[reaction.emoji] ??= { count: 0, users: [], userIds: [] };
        reactions[reaction.emoji].count += 1;
        reactions[reaction.emoji].users.push(reaction.user.username);
        reactions[reaction.emoji].userIds.push(reaction.userId);
      }
      socket.to(`channel:${data.channelId}`).emit(`message:reacted:${data.channelId}`, {
        messageId: data.messageId,
        reactions,
      });
    }));


    socket.on("poll:update", safeHandler(async (data: { pollId: string; channelId: string }) => {
      if (!isObj(data) || !isStr(data.pollId) || !isStr(data.channelId)) return;
      if (overLimit("poll:update")) return;
      const access = await resolveChannelAccess(data.channelId, currentUserId);
      if (!access?.canView) return;
      const poll = await prisma.poll.findFirst({
        where: { id: data.pollId, channelId: data.channelId },
        include: {
          options: {
            orderBy: { position: "asc" },
            include: { votes: { select: { userId: true } } },
          },
          votes: { select: { userId: true, optionId: true } },
        },
      });
      if (!poll) return;
      io.to(`channel:${data.channelId}`).emit(`poll:updated:${data.channelId}`, poll);
    }));
    // ─── Channel Lifecycle ───
    // The REST routes (already authorized) perform the actual mutation; these
    // events notify the rest of the server so channel lists update without a
    // refresh. Payload content is never trusted — the broadcast is re-read
    // from the DB, so a member can only trigger truthful updates.
    const CHANNEL_BROADCAST_SELECT = {
      id: true, serverId: true, name: true, type: true, category: true,
      description: true, topic: true, position: true, createdAt: true,
      roomMode: true, roomScene: true, retentionDays: true,
    } as const;

    async function relayChannelSnapshot(event: "channel:created" | "channels:updated", data: { serverId: string; channelIds: string[] }) {
      if (!isObj(data) || !isStr(data.serverId) || !Array.isArray(data.channelIds)) return;
      const ids = data.channelIds.filter(isStr).slice(0, 100);
      if (ids.length === 0) return;
      if (!(await requireMembership(data.serverId, currentUserId))) return;
      // Only channels that really exist in THIS server are broadcast.
      const channels = await prisma.channel.findMany({
        where: { id: { in: ids }, serverId: data.serverId },
        select: CHANNEL_BROADCAST_SELECT,
      });
      if (channels.length === 0) return;
      const recipients = io.sockets.adapter.rooms.get(`server:${data.serverId}`) ?? [];
      await Promise.all(Array.from(recipients, async (socketId) => {
        const recipient = io.sockets.sockets.get(socketId);
        const userId = recipient?.data.userId as string | undefined;
        if (!recipient || !userId) return;
        const visible = (
          await Promise.all(channels.map(async (channel) => (
            (await resolveChannelAccess(channel.id, userId))?.canView ? channel : null
          )))
        ).filter((channel): channel is (typeof channels)[number] => channel !== null);
        if (visible.length > 0) {
          recipient.emit(event, { serverId: data.serverId, channels: visible });
        }
      }));
    }

    socket.on("channel:created", safeHandler(async (data: { serverId: string; channelId: string }) => {
      if (!isObj(data) || !isStr(data.channelId)) return;
      if (!isStr(data.serverId) || overLimit("channel:created")) return;
      await relayChannelSnapshot("channel:created", { serverId: data.serverId, channelIds: [data.channelId] });
    }));

    socket.on("channels:updated", safeHandler(async (data: { serverId: string; channelIds: string[] }) => {
      if (!isObj(data) || !isStr(data.serverId) || !Array.isArray(data.channelIds) || overLimit("channels:updated")) return;
      await relayChannelSnapshot("channels:updated", data);
    }));

    socket.on("channel:deleted", safeHandler(async (data: { serverId: string; channelId: string }) => {
      if (!isObj(data) || !isStr(data.serverId) || !isStr(data.channelId)) return;
      if (overLimit("channel:deleted")) return;
      if (!(await requireMembership(data.serverId, currentUserId))) return;
      // Normal case: the REST DELETE (already authorized) removed the row
      // before this notification fires. If the row still exists the deletion
      // didn't happen — don't broadcast a lie.
      const channel = await prisma.channel.findUnique({ where: { id: data.channelId }, select: { id: true } });
      if (channel) return;
      socket.to(`server:${data.serverId}`).emit("channel:deleted", { serverId: data.serverId, channelId: data.channelId });
    }));

    // ─── Presence Status ───
    socket.on("presence:status", safeHandler((status: string) => {
      if (!isStr(status) || !["online", "idle", "dnd", "invisible"].includes(status)) return;
      if (overLimit("presence:status")) return;
      userStatus.set(currentUserId, status as PresenceStatus);
      for (const [serverId, members] of onlineUsers) {
        if (members.has(currentUserId)) broadcastPresence(serverId);
      }
    }));

    // ─── Typing ───
    // Typing fires often, but it still leaks presence into a channel — enforce
    // the same channel membership message:send requires before broadcasting.
    socket.on("typing:start", safeHandler(async (channelId: string) => {
      if (!isStr(channelId)) return;
      const access = await resolveChannelAccess(channelId, currentUserId);
      if (!access?.canSend) return;
      socket.to(`channel:${channelId}`).emit("typing:update", { channelId, userId: currentUserId, username: currentUsername, isTyping: true });
    }));
    socket.on("typing:stop", safeHandler(async (channelId: string) => {
      if (!isStr(channelId)) return;
      const access = await resolveChannelAccess(channelId, currentUserId);
      if (!access?.canSend) return;
      socket.to(`channel:${channelId}`).emit("typing:update", { channelId, userId: currentUserId, username: currentUsername, isTyping: false });
    }));

    // ─── Voice Chat (WebRTC Signaling) ───
    socket.on("voice:join", safeHandler(async (data: string | { channelId: string; serverId?: string; avatar?: string | null }) => {
      const channelId = typeof data === "string" ? data : data?.channelId;
      const avatar = typeof data === "string" ? undefined : data?.avatar;
      if (!isStr(channelId)) return;

      const [access, channel] = await Promise.all([
        resolveChannelAccess(channelId, currentUserId),
        prisma.channel.findUnique({
          where: { id: channelId },
          select: { type: true },
        }),
      ]);
      if (!access?.canView || channel?.type !== "voice") {
        socket.emit("voice:error", { channelId, error: "Not authorized to join this voice channel" });
        return;
      }
      const serverId = access.serverId;

      const prevChannel = userVoiceChannel.get(currentUserId);
      if (prevChannel && prevChannel !== channelId) leaveVoiceChannel(prevChannel);
      userVoiceChannel.set(currentUserId, channelId);
      socket.join(`voice:${channelId}`);
      voiceChannelServer.set(channelId, serverId);
      if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Map());

      const existing = Array.from(voiceRooms.get(channelId)!.entries()).map(
        ([userId, info]) => ({ userId, username: info.username, socketId: info.socketId, muted: info.muted, deafened: info.deafened, camera: info.camera, avatar: info.avatar })
      );
      socket.emit("voice:participants", { channelId, participants: existing });

      voiceRooms.get(channelId)!.set(currentUserId, {
        username: currentUsername, socketId: socket.id, muted: false, deafened: false, camera: false, avatar: avatar || null,
      });
      socket.emit("offshoot:update", offshootPayload(channelId));
      if (lanternRooms.has(channelId)) {
        socket.emit("lantern:update", lanternPayload(channelId));
      }

      socket.to(`voice:${channelId}`).emit("voice:user-joined", { channelId, userId: currentUserId, username: currentUsername, socketId: socket.id });
      broadcastVoiceParticipants(channelId);
    }));

    socket.on("voice:leave", safeHandler((channelId: string) => {
      if (!isStr(channelId)) return;
      leaveVoiceChannel(channelId);
    }));

    socket.on("voice:mute", safeHandler((data: { channelId: string; muted: boolean }) => {
      if (!isObj(data) || !isStr(data.channelId)) return;
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) { room.get(currentUserId)!.muted = data.muted; broadcastVoiceParticipants(data.channelId); }
    }));

    socket.on("voice:deafen", safeHandler((data: { channelId: string; deafened: boolean }) => {
      if (!isObj(data) || !isStr(data.channelId)) return;
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) {
        room.get(currentUserId)!.deafened = data.deafened;
        if (data.deafened) room.get(currentUserId)!.muted = true;
        broadcastVoiceParticipants(data.channelId);
      }
    }));

    socket.on("voice:camera", safeHandler((data: { channelId: string; camera: boolean }) => {
      if (!isObj(data) || !isStr(data.channelId)) return;
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) { room.get(currentUserId)!.camera = data.camera; broadcastVoiceParticipants(data.channelId); }
    }));

    socket.on("voice:speaking", safeHandler((data: { channelId: string; speaking: boolean }) => {
      if (!isObj(data) || !isStr(data.channelId)) return;
      if (overLimit("voice:speaking")) return;
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      socket.to(`voice:${data.channelId}`).emit("voice:speaking", { userId: currentUserId, speaking: data.speaking });
    }));

    socket.on("lantern:state", safeHandler((channelId: string) => {
      if (!isStr(channelId) || !voiceRooms.get(channelId)?.has(currentUserId)) return;
      socket.emit("lantern:update", lanternPayload(channelId));
    }));

    socket.on("lantern:start", safeHandler((channelId: string) => {
      if (!isStr(channelId) || overLimit("lantern:start")) return;
      if (!voiceRooms.get(channelId)?.has(currentUserId)) return;
      if (!lanternRooms.has(channelId)) {
        lanternRooms.set(channelId, { hostId: currentUserId, holderId: currentUserId, queue: [] });
      }
      broadcastLantern(channelId);
    }));

    socket.on("lantern:request", safeHandler((channelId: string) => {
      if (!isStr(channelId) || overLimit("lantern:request")) return;
      if (!voiceRooms.get(channelId)?.has(currentUserId)) return;
      const state = lanternRooms.get(channelId);
      if (!state || state.holderId === currentUserId || state.queue.includes(currentUserId)) return;
      if (!state.holderId) state.holderId = currentUserId;
      else state.queue.push(currentUserId);
      broadcastLantern(channelId);
    }));

    socket.on("lantern:pass", safeHandler(async (data: { channelId: string; targetUserId: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.targetUserId) || overLimit("lantern:pass")) return;
      const room = voiceRooms.get(data.channelId);
      const state = lanternRooms.get(data.channelId);
      if (!room?.has(currentUserId) || !room.has(data.targetUserId) || !state) return;
      if (state.holderId !== currentUserId && !(await canControlLantern(data.channelId, state))) return;
      state.queue = state.queue.filter((userId) => userId !== data.targetUserId);
      if (state.holderId && state.holderId !== data.targetUserId && room.has(state.holderId)) {
        state.queue = state.queue.filter((userId) => userId !== state.holderId);
      }
      state.holderId = data.targetUserId;
      broadcastLantern(data.channelId);
    }));

    socket.on("lantern:release", safeHandler((channelId: string) => {
      if (!isStr(channelId) || overLimit("lantern:release")) return;
      const state = lanternRooms.get(channelId);
      if (!state || state.holderId !== currentUserId) return;
      advanceLantern(channelId);
      broadcastLantern(channelId);
    }));

    socket.on("lantern:stop", safeHandler(async (channelId: string) => {
      if (!isStr(channelId) || overLimit("lantern:stop")) return;
      const state = lanternRooms.get(channelId);
      if (!state || !voiceRooms.get(channelId)?.has(currentUserId)) return;
      if (!(await canControlLantern(channelId, state))) return;
      lanternRooms.delete(channelId);
      broadcastLantern(channelId);
    }));
    socket.on("offshoot:state", safeHandler((channelId: string) => {
      if (!isStr(channelId) || !isCurrentVoiceParticipant(channelId)) return;
      socket.emit("offshoot:update", offshootPayload(channelId));
    }));

    socket.on("offshoot:create", safeHandler((data: { channelId: string; name?: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || (data.name !== undefined && !isStr(data.name))) return;
      if (overLimit("offshoot:create")) return;
      if (!isCurrentVoiceParticipant(data.channelId)) {
        emitOffshootError(data.channelId, "parent_membership_required", "Join the parent voice room first.");
        return;
      }
      if (offshootMembership.has(currentUserId)) {
        emitOffshootError(data.channelId, "already_in_offshoot", "Rejoin the main camp before starting another side fire.");
        return;
      }
      let rooms = offshootRooms.get(data.channelId);
      if (!rooms) {
        rooms = new Map();
        offshootRooms.set(data.channelId, rooms);
      }
      if (rooms.size >= MAX_OFFSHOOTS_PER_PARENT) {
        emitOffshootError(data.channelId, "offshoot_limit", "This camp already has the maximum number of side fires.");
        return;
      }
      const normalizedName = data.name?.trim().replace(/\s+/g, " ").slice(0, MAX_OFFSHOOT_NAME_LENGTH);
      const id = globalThis.crypto.randomUUID();
      const room: OffshootRoomState = {
        id,
        name: normalizedName || `Side fire ${rooms.size + 1}`,
        creatorId: currentUserId,
        createdAt: Date.now(),
        members: new Map([[currentUserId, { username: currentUsername, socketId: socket.id }]]),
      };
      rooms.set(id, room);
      offshootMembership.set(currentUserId, { channelId: data.channelId, offshootId: id });
      broadcastOffshoots(data.channelId);
    }));

    socket.on("offshoot:join", safeHandler((data: { channelId: string; offshootId: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.offshootId)) return;
      if (overLimit("offshoot:join")) return;
      if (!isCurrentVoiceParticipant(data.channelId)) {
        emitOffshootError(data.channelId, "parent_membership_required", "Join the matching parent voice room first.");
        return;
      }
      const room = offshootRooms.get(data.channelId)?.get(data.offshootId);
      if (!room) {
        emitOffshootError(data.channelId, "offshoot_not_found", "That side fire is no longer available.");
        return;
      }
      if (room.members.has(currentUserId)) return;
      if (room.members.size >= MAX_OFFSHOOT_MEMBERS) {
        emitOffshootError(data.channelId, "offshoot_capacity", "That side fire is full.");
        return;
      }
      leaveCurrentOffshoot(false);
      room.members.set(currentUserId, { username: currentUsername, socketId: socket.id });
      offshootMembership.set(currentUserId, { channelId: data.channelId, offshootId: data.offshootId });
      broadcastOffshoots(data.channelId);
    }));
    socket.on("offshoot:leave", safeHandler((data: { channelId: string }) => {
      if (!isObj(data) || !isStr(data.channelId)) return;
      if (!isCurrentVoiceParticipant(data.channelId)) {
        emitOffshootError(data.channelId, "parent_membership_required", "Join the matching parent voice room first.");
        return;
      }
      const assignment = offshootMembership.get(currentUserId);
      if (assignment?.channelId !== data.channelId) return;
      leaveCurrentOffshoot();
    }));

    socket.on("offshoot:close", safeHandler(async (data: { channelId: string; offshootId: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.offshootId)) return;
      if (overLimit("offshoot:close")) return;
      if (!isCurrentVoiceParticipant(data.channelId)) {
        emitOffshootError(data.channelId, "parent_membership_required", "Join the matching parent voice room first.");
        return;
      }
      const room = offshootRooms.get(data.channelId)?.get(data.offshootId);
      if (!room) {
        emitOffshootError(data.channelId, "offshoot_not_found", "That side fire is no longer available.");
        return;
      }
      const serverId = voiceChannelServer.get(data.channelId);
      const canClose = room.creatorId === currentUserId
        || (!!serverId && await memberHasPermission(serverId, currentUserId, "MOVE_MEMBERS"));
      if (!canClose) {
        emitOffshootError(data.channelId, "offshoot_close_forbidden", "Only the creator or a room moderator can close this side fire.");
        return;
      }
      closeOffshoot(data.channelId, data.offshootId);
      broadcastOffshoots(data.channelId);
    }));

    // Soundboard — relay a one-shot sound to everyone else in the voice channel.
    // The clicker plays it locally; this broadcasts to the rest of the room.
    socket.on("soundboard:play", safeHandler((data: { channelId: string; src: string; name?: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.src)) return;
      if (overLimit("soundboard:play")) return;
      // Must actually be in that voice channel.
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      // Allowlist the source: built-in static path or an inline audio data URL only
      // (stops it being used to make every client fetch an arbitrary attacker URL).
      const okSrc = data.src.startsWith("/soundboard/") || data.src.startsWith("data:audio/");
      if (!okSrc || data.src.length > 1_000_000) return;
      socket.to(`voice:${data.channelId}`).emit("soundboard:play", { src: data.src, name: data.name, by: currentUsername });
    }));

    // ─── Ember Reactions ───
    socket.on("ember:react", safeHandler((data: { channelId: string; emoji: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.emoji)) return;
      const ALLOWED = ["laugh", "applause", "agree", "wow", "skull", "clink", "nod"];
      if (!ALLOWED.includes(data.emoji)) return;
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      socket.to(`voice:${data.channelId}`).emit("ember:reaction", { userId: currentUserId, username: currentUsername, emoji: data.emoji });
    }));

    // ─── Screen Share ───
    socket.on("screen:start", safeHandler((data: { channelId: string }) => {
      if (!isObj(data) || !isStr(data.channelId)) return;
      if (overLimit("screen:start")) return;
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      socket.to(`voice:${data.channelId}`).emit("screen:started", { userId: currentUserId, username: currentUsername, socketId: socket.id });
    }));
    socket.on("screen:stop", safeHandler((data: { channelId: string }) => {
      if (!isObj(data) || !isStr(data.channelId)) return;
      if (overLimit("screen:stop")) return;
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      socket.to(`voice:${data.channelId}`).emit("screen:stopped", { userId: currentUserId });
    }));
    // Only relay signaling between two sockets that share the target voice room
    // (both sender and `data.to` must be members of `voice:${channelId}`).
    socket.on("screen:offer", safeHandler((data: { to: string; channelId: string; offer: RTCSessionDescriptionInit }) => {
      if (!isObj(data) || !isStr(data.to) || !isStr(data.channelId) || !isBlob(data.offer)) return;
      if (!sameVoiceRoom(data.to, data.channelId)) return;
      io.to(data.to).emit("screen:offer", { from: socket.id, fromUserId: currentUserId, fromUsername: currentUsername, offer: data.offer });
    }));
    socket.on("screen:answer", safeHandler((data: { to: string; channelId: string; answer: RTCSessionDescriptionInit }) => {
      if (!isObj(data) || !isStr(data.to) || !isStr(data.channelId) || !isBlob(data.answer)) return;
      if (!sameVoiceRoom(data.to, data.channelId)) return;
      io.to(data.to).emit("screen:answer", { from: socket.id, answer: data.answer });
    }));
    socket.on("screen:ice-candidate", safeHandler((data: { to: string; channelId: string; candidate: RTCIceCandidateInit }) => {
      if (!isObj(data) || !isStr(data.to) || !isStr(data.channelId) || !isBlob(data.candidate)) return;
      if (!sameVoiceRoom(data.to, data.channelId)) return;
      io.to(data.to).emit("screen:ice-candidate", { from: socket.id, candidate: data.candidate });
    }));

    // ─── Moderation ───
    type VoiceModerationPermission = "MUTE_MEMBERS" | "MOVE_MEMBERS";

    async function getVoiceModerationContext(
      channelId: string,
      targetUserId: string,
      permission: VoiceModerationPermission,
    ): Promise<{ serverId: string } | null> {
      if (targetUserId === currentUserId) return null;
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { serverId: true, type: true },
      });
      if (!channel || channel.type !== "voice") return null;

      const [permitted, server, members] = await Promise.all([
        memberHasPermission(channel.serverId, currentUserId, permission),
        prisma.server.findUnique({
          where: { id: channel.serverId },
          select: { ownerId: true },
        }),
        prisma.serverMember.findMany({
          where: {
            serverId: channel.serverId,
            userId: { in: [currentUserId, targetUserId] },
          },
          select: {
            userId: true,
            role: true,
            banned: true,
            memberRoles: {
              select: { role: { select: { position: true } } },
            },
          },
        }),
      ]);
      if (!permitted || !server) return null;

      const byUser = new Map(members.map((member) => [member.userId, member]));
      const authority = (userId: string): number | null => {
        if (server.ownerId === userId) return Number.MAX_SAFE_INTEGER;
        const member = byUser.get(userId);
        if (!member || member.banned) return null;
        const legacyPosition: Record<string, number> = {
          owner: 100,
          admin: 80,
          mod: 50,
          member: 0,
        };
        return Math.max(
          legacyPosition[member.role] ?? 0,
          ...member.memberRoles.map(({ role }) => role.position),
        );
      };
      const callerAuthority = authority(currentUserId);
      const targetAuthority = authority(targetUserId);
      if (
        callerAuthority === null
        || targetAuthority === null
        || callerAuthority <= targetAuthority
      ) {
        return null;
      }
      return { serverId: channel.serverId };
    }

    socket.on("mod:server-mute", safeHandler(async (data: { channelId: string; targetUserId: string; muted: boolean }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.targetUserId) || typeof data.muted !== "boolean") return;
      const ctx = await getVoiceModerationContext(data.channelId, data.targetUserId, "MUTE_MEMBERS");
      if (!ctx) return;
      const key = `${ctx.serverId}:${data.targetUserId}`;
      if (data.muted) serverMuted.add(key); else serverMuted.delete(key);
      const room = voiceRooms.get(data.channelId);
      if (room?.has(data.targetUserId)) { room.get(data.targetUserId)!.muted = data.muted; broadcastVoiceParticipants(data.channelId); }
      const targetEntry = room?.get(data.targetUserId);
      if (targetEntry) io.to(targetEntry.socketId).emit("mod:force-mute", { muted: data.muted, by: currentUsername });
    }));

    socket.on("mod:server-deafen", safeHandler(async (data: { channelId: string; targetUserId: string; deafened: boolean }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.targetUserId) || typeof data.deafened !== "boolean") return;
      const ctx = await getVoiceModerationContext(data.channelId, data.targetUserId, "MUTE_MEMBERS");
      if (!ctx) return;
      const key = `${ctx.serverId}:${data.targetUserId}`;
      if (data.deafened) serverDeafened.add(key); else serverDeafened.delete(key);
      const room = voiceRooms.get(data.channelId);
      if (room?.has(data.targetUserId)) {
        const entry = room.get(data.targetUserId)!;
        entry.deafened = data.deafened;
        if (data.deafened) entry.muted = true;
        broadcastVoiceParticipants(data.channelId);
        io.to(entry.socketId).emit("mod:force-deafen", { deafened: data.deafened, by: currentUsername });
      }
    }));

    socket.on("mod:kick-voice", safeHandler(async (data: { channelId: string; targetUserId: string }) => {
      if (!isObj(data) || !isStr(data.channelId) || !isStr(data.targetUserId)) return;
      const ctx = await getVoiceModerationContext(data.channelId, data.targetUserId, "MOVE_MEMBERS");
      if (!ctx) return;
      const room = voiceRooms.get(data.channelId);
      const targetEntry = room?.get(data.targetUserId);
      if (targetEntry) {
        io.to(targetEntry.socketId).emit("mod:kicked-from-voice", { channelId: data.channelId, by: currentUsername });
        await evictVoiceParticipant(data.channelId, data.targetUserId);
      }
    }));

    socket.on("mod:move-user", safeHandler(async (data: { fromChannelId: string; toChannelId: string; targetUserId: string }) => {
      if (!isObj(data) || !isStr(data.fromChannelId) || !isStr(data.toChannelId) || !isStr(data.targetUserId)) return;
      if (data.fromChannelId === data.toChannelId) return;
      const channels = await prisma.channel.findMany({
        where: { id: { in: [data.fromChannelId, data.toChannelId] } },
        select: { id: true, serverId: true, type: true },
      });
      const fromChannel = channels.find((channel) => channel.id === data.fromChannelId);
      const toChannel = channels.find((channel) => channel.id === data.toChannelId);
      if (
        !fromChannel
        || !toChannel
        || fromChannel.type !== "voice"
        || toChannel.type !== "voice"
        || fromChannel.serverId !== toChannel.serverId
      ) {
        return;
      }

      const [ctx, targetAccess] = await Promise.all([
        getVoiceModerationContext(data.fromChannelId, data.targetUserId, "MOVE_MEMBERS"),
        resolveChannelAccess(data.toChannelId, data.targetUserId),
      ]);
      if (
        !ctx
        || ctx.serverId !== fromChannel.serverId
        || targetAccess?.serverId !== fromChannel.serverId
        || !targetAccess.canView
      ) {
        return;
      }
      const room = voiceRooms.get(data.fromChannelId);
      const targetEntry = room?.get(data.targetUserId);
      const targetSocket = targetEntry
        ? io.sockets.sockets.get(targetEntry.socketId)
        : undefined;
      if (!targetEntry || !targetSocket?.rooms.has(`voice:${data.fromChannelId}`)) return;

      // Do not mutate any room or facilitation state until every check passes.
      room!.delete(data.targetUserId);
      removeFromLantern(data.fromChannelId, data.targetUserId);
      removeUserFromOffshoot(data.targetUserId);
      await targetSocket.leave(`voice:${data.fromChannelId}`);
      io.to(`voice:${data.fromChannelId}`).emit("voice:user-left", { channelId: data.fromChannelId, userId: data.targetUserId, socketId: targetEntry.socketId });
      broadcastVoiceParticipants(data.fromChannelId);
      await targetSocket.join(`voice:${data.toChannelId}`);
      if (!voiceRooms.has(data.toChannelId)) voiceRooms.set(data.toChannelId, new Map());
      voiceRooms.get(data.toChannelId)!.set(data.targetUserId, { username: targetEntry.username, socketId: targetEntry.socketId, muted: targetEntry.muted, deafened: targetEntry.deafened, camera: targetEntry.camera, avatar: targetEntry.avatar });
      userVoiceChannel.set(data.targetUserId, data.toChannelId);
      voiceChannelServer.set(data.toChannelId, ctx.serverId);
      targetSocket.emit("mod:moved-to-channel", { fromChannelId: data.fromChannelId, toChannelId: data.toChannelId, by: currentUsername });
      io.to(`voice:${data.toChannelId}`).emit("voice:user-joined", { channelId: data.toChannelId, userId: data.targetUserId, username: targetEntry.username, socketId: targetEntry.socketId });
      broadcastVoiceParticipants(data.toChannelId);
    }));

    // ─── WebRTC Signaling ───
    // Only relay signaling between two sockets that share the target voice room
    // (both sender and `data.to` must be members of `voice:${channelId}`).
    socket.on("voice:offer", safeHandler((data: { to: string; channelId: string; offer: RTCSessionDescriptionInit }) => {
      if (!isObj(data) || !isStr(data.to) || !isStr(data.channelId) || !isBlob(data.offer)) return;
      if (!sameVoiceRoom(data.to, data.channelId)) return;
      io.to(data.to).emit("voice:offer", { from: socket.id, fromUserId: currentUserId, fromUsername: currentUsername, offer: data.offer });
    }));
    socket.on("voice:answer", safeHandler((data: { to: string; channelId: string; answer: RTCSessionDescriptionInit }) => {
      if (!isObj(data) || !isStr(data.to) || !isStr(data.channelId) || !isBlob(data.answer)) return;
      if (!sameVoiceRoom(data.to, data.channelId)) return;
      io.to(data.to).emit("voice:answer", { from: socket.id, answer: data.answer });
    }));
    socket.on("voice:ice-candidate", safeHandler((data: { to: string; channelId: string; candidate: RTCIceCandidateInit }) => {
      if (!isObj(data) || !isStr(data.to) || !isStr(data.channelId) || !isBlob(data.candidate)) return;
      if (!sameVoiceRoom(data.to, data.channelId)) return;
      io.to(data.to).emit("voice:ice-candidate", { from: socket.id, candidate: data.candidate });
    }));

    // ─── Voice Helpers ───
    function leaveVoiceChannel(channelId: string) {
      socket.leave(`voice:${channelId}`);
      const room = voiceRooms.get(channelId);
      if (!room) return;
      const entry = room.get(currentUserId);
      if (entry && entry.socketId === socket.id) {
        room.delete(currentUserId);
        if (userVoiceChannel.get(currentUserId) === channelId) userVoiceChannel.delete(currentUserId);
        socket.to(`voice:${channelId}`).emit("voice:user-left", { channelId, userId: currentUserId, socketId: socket.id });
        leaveCurrentOffshoot();
        if (room.size === 0) voiceRooms.delete(channelId);
        removeFromLantern(channelId, currentUserId);
        broadcastVoiceParticipants(channelId);
      }
    }

    function broadcastVoiceParticipants(channelId: string) {
      broadcastVoiceParticipantsScoped(channelId);
    }

    // ─── DM Typing ───
    // Both participants subscribe to the conversation room via `dm:join`; typing
    // is then relayed there. The sender is taken from the socket session, never
    // from the client payload.
    socket.on("dm:join", safeHandler(async (conversationId: string) => {
      if (!isStr(conversationId)) return;
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { user1Id: true, user2Id: true } });
      if (!conv || (conv.user1Id !== currentUserId && conv.user2Id !== currentUserId)) return;
      const otherUserId = conv.user1Id === currentUserId ? conv.user2Id : conv.user1Id;
      if (await usersHaveBlock(currentUserId, otherUserId)) return;
      socket.join(`conv:${conversationId}`);
    }));

    socket.on("dm:leave", safeHandler((conversationId: string) => {
      if (!isStr(conversationId)) return;
      socket.leave(`conv:${conversationId}`);
    }));

    socket.on("dm:send", safeHandler(async (data: { conversationId: string; messageId: string }) => {
      if (!isObj(data) || !isStr(data.conversationId) || !isStr(data.messageId)) return;
      if (overLimit("dm:send")) return;
      const conversation = await prisma.conversation.findUnique({
        where: { id: data.conversationId },
        select: { user1Id: true, user2Id: true },
      });
      if (!conversation || (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId)) return;
      const recipientId = conversation.user1Id === currentUserId
        ? conversation.user2Id : conversation.user1Id;
      if (await usersHaveBlock(currentUserId, recipientId)) return;

      const message = await prisma.directMessage.findFirst({
        where: {
          id: data.messageId,
          conversationId: data.conversationId,
          authorId: currentUserId,
        },
        include: { author: { select: { id: true, username: true, avatar: true } } },
      });
      if (!message) return;

      socket.to(`conv:${data.conversationId}`).emit("dm:message", message);
      io.to(`user:${recipientId}`).emit("dm:notification", message);
    }));

    socket.on("dm:typing", safeHandler(async (data: { conversationId: string }) => {
      if (!isObj(data) || !isStr(data.conversationId)) return;
      const conv = await prisma.conversation.findUnique({ where: { id: data.conversationId }, select: { user1Id: true, user2Id: true } });
      if (!conv || (conv.user1Id !== currentUserId && conv.user2Id !== currentUserId)) return;
      const otherUserId = conv.user1Id === currentUserId ? conv.user2Id : conv.user1Id;
      if (await usersHaveBlock(currentUserId, otherUserId)) return;
      socket.to(`conv:${data.conversationId}`).emit("dm:typing", { conversationId: data.conversationId, userId: currentUserId, username: currentUsername });
    }));

    // ─── Disconnect ───
    socket.on("disconnect", safeHandler(() => {
      console.log(`[Campfire] Disconnected: ${currentUsername}`);
      heartbeats.delete(socket.id);
      // Leave any voice room this specific socket occupied (guarded by socketId).
      for (const [channelId] of voiceRooms) leaveVoiceChannel(channelId);

      const sockets = userSockets.get(currentUserId);
      if (sockets) sockets.delete(socket.id);
      const lastSocket = !sockets || sockets.size === 0;
      if (lastSocket) {
        // Only the user's final tab tears down user-level presence/voice state.
        userSockets.delete(currentUserId);
        userVoiceChannel.delete(currentUserId);
        userStatus.delete(currentUserId);
        for (const [serverId] of onlineUsers) removeFromPresence(serverId, currentUserId, true);
      }
    }));

    function removeFromPresence(serverId: string, userId: string, force = false) {
      const serverMap = onlineUsers.get(serverId);
      if (!serverMap) return;
      const entry = serverMap.get(userId);
      if (entry && (force || entry.socketId === socket.id)) { serverMap.delete(userId); broadcastPresence(serverId); }
      if (serverMap.size === 0) onlineUsers.delete(serverId);
    }

    function broadcastPresence(serverId: string) {
      const serverMap = onlineUsers.get(serverId);
      if (!serverMap) return;
      const members = Array.from(serverMap.entries()).map(([userId, info]) => ({ userId, username: info.username, status: userStatus.get(userId) || "online" }));
      io.to(`server:${serverId}`).emit("presence:update", { serverId, members });
    }
  });

  return io;
}

// ─── Standalone Mode ───
// When run DIRECTLY (`npx tsx realtime/server.ts`), start on its own port.
// When merely imported (the unified `npm run host` server), do nothing here —
// otherwise we'd wrongly bind port 3001 as a side effect of the import.
let io: Server | undefined;

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const PORT = config.socketPort;
  const httpServer = createServer();
  io = attachSocketIO(httpServer);
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Campfire] Realtime server running on 0.0.0.0:${PORT}`);
  });
}

export { io };
