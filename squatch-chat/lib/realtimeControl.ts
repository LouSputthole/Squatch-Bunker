/**
 * Authorization changes that can invalidate already-open realtime rooms.
 *
 * The optional userId narrows a channel/server refresh when the caller knows
 * only one member changed. Omitting it asks every attached realtime server to
 * sweep all connected users in that scope.
 */
export type RealtimeAuthorizationChange =
  | { scope: "session"; userId: string }
  | { scope: "member"; serverId: string; userId: string }
  | { scope: "channel"; channelId: string; userId?: string }
  | { scope: "server"; serverId: string; userId?: string };

export type RealtimeAuthorizationListener = (
  change: RealtimeAuthorizationChange,
) => void | Promise<void>;

type RealtimeControlGlobal = typeof globalThis & {
  __campfireRealtimeAuthorizationListeners__?: Set<RealtimeAuthorizationListener>;
};

function listeners(): Set<RealtimeAuthorizationListener> {
  const shared = globalThis as RealtimeControlGlobal;
  return shared.__campfireRealtimeAuthorizationListeners__
    ??= new Set<RealtimeAuthorizationListener>();
}

/**
 * Register one local Socket.IO authorization refresher.
 *
 * This globalThis registry intentionally bridges the custom Node server and
 * Next.js route modules in the same process. Multi-replica hosting must publish
 * the same change over distributed pub/sub and invoke the local listeners on
 * every replica; this registry is the in-process adapter, not that transport.
 */
export function registerRealtimeAuthorizationListener(
  listener: RealtimeAuthorizationListener,
): () => void {
  listeners().add(listener);
  return () => listeners().delete(listener);
}

/**
 * Notify every realtime server attached in this process after a committed DB
 * mutation. Listeners re-read authoritative membership/channel access; callers
 * never grant or revoke access merely by supplying this payload.
 */
export async function notifyRealtimeAuthorizationChange(
  change: RealtimeAuthorizationChange,
): Promise<void> {
  const results = await Promise.allSettled(
    Array.from(listeners(), (listener) => Promise.resolve().then(() => listener(change))),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[Campfire] realtime authorization refresh failed:", result.reason);
    }
  }
}
