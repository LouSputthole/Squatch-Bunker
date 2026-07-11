/**
 * Stub for `next/headers` in the desktop socket-server bundle.
 *
 * lib/auth imports `cookies` from next/headers at module scope, but the realtime
 * layer only ever calls validateSessionToken (which works from a raw token
 * string) — never getSession() — so these request-scoped APIs are never invoked
 * here. Aliasing next/headers to this shim removes a fragile external subpath
 * require (next/headers resolves via next's exports map, which the standalone
 * require-hook can't resolve under Electron) without affecting the Next app
 * itself, whose next/headers usage is compiled separately into .next/server.
 */
function notAvailable(name: string): never {
  throw new Error(`next/headers.${name}() is not available in the Campfire desktop socket server`);
}

export async function cookies() {
  return notAvailable("cookies");
}
export async function headers() {
  return notAvailable("headers");
}
export async function draftMode() {
  return notAvailable("draftMode");
}
