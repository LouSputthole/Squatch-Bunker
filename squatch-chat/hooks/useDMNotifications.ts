"use client";
import { useEffect, useState, useRef } from "react";
import { getSocket } from "@/lib/socket";

function isFocusModeActive(): boolean {
  try {
    const raw = localStorage.getItem("squatch:focus-mode");
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.active) return false;
    if (data.until && Date.now() > data.until) return false;
    return true;
  } catch { return false; }
}

export function useDMNotifications(activeConversationId?: string | null) {
  const [unreadDMs, setUnreadDMs] = useState(0);
  const activeConvRef = useRef(activeConversationId);

  useEffect(() => {
    activeConvRef.current = activeConversationId;
    // Clear badge when DM panel is open
    if (activeConversationId) setUnreadDMs(0);
  }, [activeConversationId]);

  useEffect(() => {
    const socket = getSocket();

    function handleNewDM(data: { conversationId: string; author: { username: string }; content: string }) {
      // Don't count if we're currently in this conversation
      if (activeConvRef.current === data.conversationId) return;

      setUnreadDMs((prev) => prev + 1);

      // Desktop notification (suppressed when focus mode is active)
      if (!isFocusModeActive()) {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`New message from ${data.author?.username ?? "Someone"}`, {
            body: data.content?.slice(0, 100) ?? "",
            icon: "/Campfire-Logo.png",
          });
        } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
          Notification.requestPermission();
        }
      }
    }

    socket.on("dm:new", handleNewDM);

    return () => {
      socket.off("dm:new", handleNewDM);
    };
  }, []);

  return { unreadDMs, clearDMBadge: () => setUnreadDMs(0) };
}
