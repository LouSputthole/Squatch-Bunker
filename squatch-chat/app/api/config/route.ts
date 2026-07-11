import { NextResponse } from "next/server";

/**
 * Runtime config endpoint. Returns connection URLs derived from the request.
 * In single-port mode, socketUrl === appUrl (same origin).
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host") || requestUrl.host;
  const protocol = request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;

  // Single-port: socket runs on same origin unless explicitly overridden
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.includes("localhost")
    ? appUrl
    : (process.env.NEXT_PUBLIC_SOCKET_URL || appUrl);

  const socketPath = process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio";

  const turnUrl = process.env.TURN_URL || "";
  const turnUsername = process.env.TURN_USERNAME || "";
  const turnCredential = process.env.TURN_CREDENTIAL || "";

  return NextResponse.json({ appUrl, socketUrl, socketPath, turnUrl, turnUsername, turnCredential });
}
