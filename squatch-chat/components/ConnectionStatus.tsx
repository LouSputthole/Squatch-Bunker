"use client";

import { useState, useEffect } from "react";
import { getSocket } from "@/lib/socket";

type Status = "connected" | "connecting" | "offline";

export default function ConnectionStatus() {
  const [status, setStatus] = useState<Status>("connected");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    function onConnect() {
      setStatus("connected");
      // Show "Connected" briefly then hide
      setVisible(true);
      setTimeout(() => setVisible(false), 2000);
    }

    function onDisconnect() {
      setStatus("offline");
      setVisible(true);
    }

    function onReconnectAttempt() {
      setStatus("connecting");
      setVisible(true);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
    };
  }, []);

  if (!visible) return null;

  const config = {
    connected: { bg: "bg-green-600", text: "Connected" },
    connecting: { bg: "bg-amber-600", text: "Reconnecting..." },
    offline: { bg: "bg-red-600", text: "Connection lost — retrying..." },
  }[status];

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 ${config.bg} text-white text-xs text-center py-1 font-medium animate-slide-down`}>
      {config.text}
    </div>
  );
}
