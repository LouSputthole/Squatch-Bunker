"use client";

import { useState, useCallback } from "react";
import type { Server, Channel } from "@/types/chat";

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServer] = useState<Server | null>(null);

  const fetchServers = useCallback(async (): Promise<Server[]> => {
    try {
      const res = await fetch("/api/servers");
      const data = await res.json();
      const list: Server[] = data.servers || [];
      setServers(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const activateServer = useCallback((server: Server, setActiveChannel: (ch: Channel | null) => void) => {
    setServers((prev) => {
      if (prev.some((s) => s.id === server.id)) return prev;
      return [...prev, server];
    });
    setActiveServer(server);
    const textChannels = server.channels.filter((c) => !c.type || c.type === "text");
    if (textChannels.length > 0) setActiveChannel(textChannels[0]);
  }, []);

  const selectServer = useCallback((server: Server, setActiveChannel: (ch: Channel | null) => void) => {
    setActiveServer(server);
    const textChannels = server.channels.filter((c) => !c.type || c.type === "text");
    setActiveChannel(textChannels[0] || null);
  }, []);

  const addChannel = useCallback((channel: Channel) => {
    setActiveServer((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, channels: [...prev.channels, channel] };
      setServers((servers) =>
        servers.map((s) => (s.id === updated.id ? updated : s))
      );
      return updated;
    });
  }, []);

  const renameActiveServer = useCallback((newName: string) => {
    setActiveServer((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, name: newName };
      setServers((list) => list.map((s) => (s.id === updated.id ? updated : s)));
      return updated;
    });
  }, []);

  const removeActiveServer = useCallback(() => {
    setActiveServer((prev) => {
      if (!prev) return prev;
      setServers((list) => list.filter((s) => s.id !== prev.id));
      return null;
    });
  }, []);

  return {
    servers,
    setServers,
    activeServer,
    setActiveServer,
    fetchServers,
    activateServer,
    selectServer,
    addChannel,
    renameActiveServer,
    removeActiveServer,
  };
}
