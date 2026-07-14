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
  const currentUserAccess =
    userAccess !== null &&
    userAccess.serverId === activeServer?.id &&
    userAccess.userId === user?.id
      ? userAccess
      : null;
  const userRole = currentUserAccess?.role ?? "member";
  const canManageChannels =
    currentUserAccess?.canManageChannels ?? false;

  useEffect(() => {
    activeServerIdRef.current = activeServer?.id ?? null;
  }, [activeServer]);

  // Server join/leave + presence listener + role fetch
  useEffect(() => {
    if (!activeServer) return;
    const socket = getSocket();
    const controller = new AbortController();
    const serverId = activeServer.id;
    // Send role with server join so realtime server can enforce mod permissions
    if (user) {
      fetch(`/api/servers/${serverId}/members`, {
        signal: controller.signal,
      })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (controller.signal.aborted || activeServerIdRef.current !== serverId) {
            return;
          }
          if (data?.members) {
            const me = data.members.find((m: { id: string; role?: string }) => m.id === user.id);
            const role = me?.role || "member";
            const canManageChannels =
              Array.isArray(data.currentUserPermissions) &&
              data.currentUserPermissions.includes("MANAGE_CHANNELS");
            setUserAccess({
              serverId,
              userId: user.id,
              role,
              canManageChannels,
            });
            socket.emit("server:join", { serverId, role });
          } else {
            setUserAccess({
              serverId,
              userId: user.id,
              role: "member",
              canManageChannels: false,
            });
            socket.emit("server:join", { serverId, role: "member" });
          }
        })
        .catch(() => {
          if (controller.signal.aborted || activeServerIdRef.current !== serverId) {
            return;
          }
          setUserAccess({
            serverId,
            userId: user.id,
            role: "member",
            canManageChannels: false,
          });
          socket.emit("server:join", { serverId, role: "member" });
        });
    } else {
      socket.emit("server:join", { serverId, role: "member" });
    }

    function handlePresence(data: { serverId: string; members: MemberPresence[] }) {
      if (data.serverId !== activeServerIdRef.current) return;
      // Filter out invisible users (unless it's ourselves)
      const visible = data.members.filter((m) => m.status !== "invisible" || m.userId === user?.id);
      const ids = new Set(visible.map((m) => m.userId));
      // Always include current user as online (they're using the app)
      if (user) ids.add(user.id);
      setOnlineMembers(ids);
      setMemberStatuses(new Map(data.members.map((m) => [m.userId, m.status])));
    }
    socket.on("presence:update", handlePresence);


    return () => {
      controller.abort();
      socket.off("presence:update", handlePresence);
      socket.emit("server:leave", serverId);
    };
  }, [activeServer, user]);

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
