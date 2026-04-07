"use client";

import { useState, useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";
import type { Server, User } from "@/types/chat";

export function usePresence(activeServer: Server | null, user: User | null) {
  const [onlineMembers, setOnlineMembers] = useState<Set<string>>(new Set());
  const [userRole, setUserRole] = useState<string>("member");
  const activeServerIdRef = useRef<string | null>(null);

  // Sync ref
  useEffect(() => {
    activeServerIdRef.current = activeServer?.id ?? null;
  }, [activeServer]);

  // Server join/leave + presence listener + role fetch
  useEffect(() => {
    if (!activeServer) return;
    const socket = getSocket();
    socket.emit("server:join", activeServer.id);

    function handlePresence(data: { serverId: string; members: { userId: string; username: string }[] }) {
      if (data.serverId !== activeServerIdRef.current) return;
      setOnlineMembers(new Set(data.members.map((m) => m.userId)));
    }
    socket.on("presence:update", handlePresence);

    // Fetch role
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

  const resetPresence = () => setOnlineMembers(new Set());

  return { onlineMembers, userRole, resetPresence };
}
