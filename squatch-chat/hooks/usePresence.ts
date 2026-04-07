"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket, setPresenceStatus } from "@/lib/socket";
import type { Server, User } from "@/types/chat";

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible";

interface MemberPresence {
  userId: string;
  username: string;
  status: PresenceStatus;
}

export function usePresence(activeServer: Server | null, user: User | null) {
  const [onlineMembers, setOnlineMembers] = useState<Set<string>>(new Set());
  const [memberStatuses, setMemberStatuses] = useState<Map<string, PresenceStatus>>(new Map());
  const [userRole, setUserRole] = useState<string>("member");
  const [myStatus, setMyStatus] = useState<PresenceStatus>("online");
  const activeServerIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeServerIdRef.current = activeServer?.id ?? null;
  }, [activeServer]);

  // Server join/leave + presence listener + role fetch
  useEffect(() => {
    if (!activeServer) return;
    const socket = getSocket();
    socket.emit("server:join", activeServer.id);

    function handlePresence(data: { serverId: string; members: MemberPresence[] }) {
      if (data.serverId !== activeServerIdRef.current) return;
      // Filter out invisible users (unless it's ourselves)
      const visible = data.members.filter((m) => m.status !== "invisible" || m.userId === user?.id);
      setOnlineMembers(new Set(visible.map((m) => m.userId)));
      setMemberStatuses(new Map(data.members.map((m) => [m.userId, m.status])));
    }
    socket.on("presence:update", handlePresence);

    if (user) {
      fetch(`/api/servers/${activeServer.id}/members`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.members) {
            const me = data.members.find((m: { userId: string; role?: string }) => m.userId === user.id);
            setUserRole(me?.role || "member");
          }
        })
        .catch(() => setUserRole("member"));
    }

    return () => {
      socket.off("presence:update", handlePresence);
      socket.emit("server:leave", activeServer.id);
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

  return {
    onlineMembers,
    memberStatuses,
    userRole,
    myStatus,
    changeStatus,
    resetPresence,
  };
}
