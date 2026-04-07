import { NextResponse } from "next/server";

/**
 * Runtime configuration endpoint.
 * Returns the actual server URLs so clients can connect regardless of
 * what was baked at build time. This is critical for self-hosted setups
 * where the host IP isn't known until the server starts.
 */
export async function GET(request: Request) {
  // Derive the host from the incoming request if env vars aren't set
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host") || requestUrl.host;
  const protocol = request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;
  const socketPort = process.env.SOCKET_PORT || "3001";

  // For socket URL: if not explicitly set, derive from the request host
  let socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (!socketUrl || socketUrl.includes("localhost")) {
    const hostname = host.split(":")[0];
    socketUrl = `${protocol}://${hostname}:${socketPort}`;
  }

  const socketPath = process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio";

  // TURN server config (optional, for voice across NATs)
  const turnUrl = process.env.TURN_URL || "";
  const turnUsername = process.env.TURN_USERNAME || "";
  const turnCredential = process.env.TURN_CREDENTIAL || "";

  return NextResponse.json({
    appUrl,
    socketUrl,
    socketPath,
    turnUrl,
    turnUsername,
    turnCredential,
  });
}
