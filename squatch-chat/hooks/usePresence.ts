"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getSocket, setPresenceStatus } from "@/lib/socket";
import type { Server, User } from "@/types/chat";

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible";

interface MemberPresence {
  userId: string;
  username: string;
  status: PresenceStatus;
}

interface UserServerAccess {
  serverId: string;
  userId: string;
  role: string;
  canManageChannels: boolean;
}

export function usePresence(activeServer: Server | null, user: User | null) {
  const [onlineMembers, setOnlineMembers] = useState<Set<string>>(new Set());
  const [memberStatuses, setMemberStatuses] = useState<Map<string, PresenceStatus>>(new Map());
  const [userAccess, setUserAccess] = useState<UserServerAccess | null>(null);
  const [myStatus, setMyStatus] = useState<PresenceStatus>("online");
  const activeServerIdRef = useRef<string | null>(null);
  const myStatusRef = useRef<PresenceStatus>("online");
  // Key effects on ids: the server object is recreated on every channel
  // create/rename/reorder, which used to leave + rejoin the server room.
  const activeServerId = activeServer?.id ?? null;
  const userId = user?.id ?? null;
  const currentUserAccess =
    userAccess !== null &&
    userAccess.serverId === activeServerId &&
    userAccess.userId === userId
      ? userAccess
      : null;
  const userRole = currentUserAccess?.role ?? "member";
  const canManageChannels =
    currentUserAccess?.canManageChannels ?? false;

  useEffect(() => {
    activeServerIdRef.current = activeServerId;
  }, [activeServerId]);

  useEffect(() => {
    myStatusRef.current = myStatus;
  }, [myStatus]);

  // A reconnect gets a fresh server-side socket: re-send a chosen non-default
  // status (the server starts new users at "online" and keeps an existing one).
  useEffect(() => {
    const socket = getSocket();
    function resendStatus() {
      if (myStatusRef.current !== "online") socket.emit("presence:status", myStatusRef.current);
    }
    socket.on("connect", resendStatus);
    return () => { socket.off("connect", resendStatus); };
  }, []);

  // Server join/leave + presence listener + role fetch
  useEffect(() => {
    if (!activeServerId) return;
    const socket = getSocket();
    const controller = new AbortController();
    const serverId = activeServerId;
    let role = "member";
    // The role is advisory (the realtime server reads it from the DB).
    function joinServerRoom() {
      socket.emit("server:join", { serverId, role });
    }
    if (userId) {
      fetch(`/api/servers/${serverId}/members`, {
        signal: controller.signal,
      })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (controller.signal.aborted || activeServerIdRef.current !== serverId) {
            return;
          }
          if (data?.members) {
            const me = data.members.find((m: { id: string; role?: string }) => m.id === userId);
            role = me?.role || "member";
            const canManageChannels =
              Array.isArray(data.currentUserPermissions) &&
              data.currentUserPermissions.includes("MANAGE_CHANNELS");
            setUserAccess({
              serverId,
              userId,
              role,
              canManageChannels,
            });
          } else {
            setUserAccess({
              serverId,
              userId,
              role: "member",
              canManageChannels: false,
            });
          }
          joinServerRoom();
        })
        .catch(() => {
          if (controller.signal.aborted || activeServerIdRef.current !== serverId) {
            return;
          }
          setUserAccess({
            serverId,
            userId,
            role: "member",
            canManageChannels: false,
          });
          joinServerRoom();
        });
    } else {
      joinServerRoom();
    }

    function handlePresence(data: { serverId: string; members: MemberPresence[] }) {
      if (data.serverId !== activeServerIdRef.current) return;
      // Filter out invisible users (unless it's ourselves)
      const visible = data.members.filter((m) => m.status !== "invisible" || m.userId === userId);
      const ids = new Set(visible.map((m) => m.userId));
      // Always include current user as online (they're using the app)
      if (userId) ids.add(userId);
      setOnlineMembers(ids);
      setMemberStatuses(new Map(data.members.map((m) => [m.userId, m.status])));
    }
    socket.on("presence:update", handlePresence);
    // A reconnected socket is only in its user room; rejoin the viewed server.
    socket.on("connect", joinServerRoom);

    return () => {
      controller.abort();
      socket.off("presence:update", handlePresence);
      socket.off("connect", joinServerRoom);
      socket.emit("server:leave", serverId);
    };
  }, [activeServerId, userId]);

  // Auto-idle after 5 minutes of inactivity
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>;

    function resetIdle() {
      if (myStatus === "dnd") return; // Don't override DND
      if (myStatus === "idle") {
        setMyStatus("online");
        setPresenceStatus("online");
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (myStatus === "online") {
          setMyStatus("idle");
          setPresenceStatus("idle");
        }
      }, 5 * 60 * 1000);
    }

    window.addEventListener("mousemove", resetIdle);
    window.addEventListener("keydown", resetIdle);
    window.addEventListener("click", resetIdle);

    // Start initial timer
    idleTimer = setTimeout(() => {
      if (myStatus === "online") {
        setMyStatus("idle");
        setPresenceStatus("idle");
      }
    }, 5 * 60 * 1000);

    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener("mousemove", resetIdle);
      window.removeEventListener("keydown", resetIdle);
      window.removeEventListener("click", resetIdle);
    };
  }, [myStatus]);

  const changeStatus = useCallback((status: PresenceStatus) => {
    setMyStatus(status);
    setPresenceStatus(status);
  }, []);

  const resetPresence = () => {
    setOnlineMembers(new Set());
    setMemberStatuses(new Map());
  };

  // Optimistically include the current user without mirroring props into state.
  const visibleOnlineMembers = useMemo(() => {
    if (!activeServer || !user || onlineMembers.has(user.id)) return onlineMembers;
    const next = new Set(onlineMembers);
    next.add(user.id);
    return next;
  }, [activeServer, onlineMembers, user]);

  return {
    onlineMembers: visibleOnlineMembers,
    memberStatuses,
    userRole,
    canManageChannels,
    myStatus,
    changeStatus,
    resetPresence,
  };
}
