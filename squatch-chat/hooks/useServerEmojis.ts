"use client";

import { useEffect, useState } from "react";
import {
  EMPTY_CUSTOM_EMOJI_MAP,
  toCustomEmojiMap,
  type CustomEmojiMap,
} from "@/lib/customEmoji";

const CHANGED_EVENT = "campfire:server-emojis-changed";

/** Ask mounted useServerEmojis(serverId) hooks to refetch (after an add/delete). */
export function notifyServerEmojisChanged(serverId: string): void {
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { serverId } }));
}

/**
 * A server's custom emoji, fetched once per server id. Returns an empty map
 * outside a server (DMs) or until the list loads.
 */
export function useServerEmojis(serverId: string | null | undefined): CustomEmojiMap {
  const [loaded, setLoaded] = useState<{ serverId: string; emojis: CustomEmojiMap } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!serverId) return;
    function handleChanged(event: Event) {
      if ((event as CustomEvent<{ serverId?: string }>).detail?.serverId === serverId) {
        setReloadKey((key) => key + 1);
      }
    }
    window.addEventListener(CHANGED_EVENT, handleChanged);
    return () => window.removeEventListener(CHANGED_EVENT, handleChanged);
  }, [serverId]);

  useEffect(() => {
    if (!serverId) return;
    const controller = new AbortController();
    fetch(`/api/servers/${encodeURIComponent(serverId)}/emoji`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { emojis?: unknown } | null) => {
        setLoaded({ serverId, emojis: toCustomEmojiMap(data?.emojis) });
      })
      .catch(() => {
        // Custom emoji are decoration: on failure, `:name:` stays plain text.
      });
    return () => controller.abort();
  }, [serverId, reloadKey]);

  return serverId && loaded?.serverId === serverId ? loaded.emojis : EMPTY_CUSTOM_EMOJI_MAP;
}
