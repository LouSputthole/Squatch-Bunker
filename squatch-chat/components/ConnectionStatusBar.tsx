"use client";
import { useState, useEffect } from "react";

interface ConnectionStatusBarProps {
  status: "connected" | "connecting" | "disconnected";
  queuedCount?: number;
}

export default function ConnectionStatusBar({ status, queuedCount = 0 }: ConnectionStatusBarProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const showTimer = setTimeout(() => {
      setShow(true);
      if (status === "connected") {
        hideTimer = setTimeout(() => setShow(false), 2000);
      }
    }, 0);
    return () => {
      clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [status]);

  const colors = {
    connected: "bg-green-600",
    connecting: "bg-amber-500",
    disconnected: "bg-red-600",
  };

  const messages = {
    connected: "✓ Connected",
    connecting: "Connecting...",
    disconnected:
      queuedCount > 0
        ? `Offline — ${queuedCount} message${queuedCount !== 1 ? "s" : ""} pending`
        : "Offline",
  };

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 text-white text-xs font-medium py-1 px-4 text-center transition-transform duration-300 ${colors[status]} ${show ? "translate-y-0" : "-translate-y-full"}`}
    >
      {messages[status]}
    </div>
  );
}
