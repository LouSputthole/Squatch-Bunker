"use client";
import { useEffect, useState, useCallback } from "react";
import { readAudioSettings } from "@/lib/mediaDeviceSettings";
import { sounds } from "@/lib/sounds";

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === "undefined" ? "default" : Notification.permission
  );

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    let active = true;
    const permissionRequest = Notification.permission === "default"
      ? Notification.requestPermission()
      : Promise.resolve(Notification.permission);
    void permissionRequest.then((nextPermission) => {
      if (active) setPermission(nextPermission);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const notify = useCallback((title: string, body: string, onClick?: () => void) => {
    if (!document.hidden) return;
    // Settings → Audio: "Message Notifications" gates background alerts (chime +
    // desktop popup); the chime also honours UI Sounds master / Notification
    // sounds / UI volume via lib/sounds.
    const settings = readAudioSettings();
    if (settings.messageNotifications === false) return;
    sounds.notification();
    if (permission === "granted") {
      try {
        const n = new Notification(title, { body });
        if (onClick) {
          n.onclick = () => {
            window.focus();
            n.close();
            onClick();
          };
        }
      } catch {
        // Some embedded browsers expose Notification but refuse construction.
      }
    }
  }, [permission]);

  return { notify, permission };
}
