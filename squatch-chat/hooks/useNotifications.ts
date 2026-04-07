"use client";
import { useEffect, useState, useCallback } from "react";

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
      if (Notification.permission === "default") {
        Notification.requestPermission().then(setPermission);
      }
    }
  }, []);

  const notify = useCallback((title: string, body: string, onClick?: () => void) => {
    if (!document.hidden) return;
    // Play sound
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
      setTimeout(() => ctx.close(), 400);
    } catch {}
    // Show notification
    if (permission === "granted") {
      const n = new Notification(title, { body });
      if (onClick) n.onclick = onClick;
    }
  }, [permission]);

  return { notify, permission };
}
