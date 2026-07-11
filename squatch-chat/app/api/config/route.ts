import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * Runtime config endpoint. Returns connection URLs derived from the request.
 * In single-port mode, socketUrl === appUrl (same origin).
 *
 * TURN credentials are only included for authenticated sessions — this route is
 * otherwise public, and static TURN creds handed to anonymous callers let
 * anyone on the internet relay traffic through your TURN server.
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

  const session = await getSession();
  const turnUrl = (session && process.env.TURN_URL) || "";
  const turnUsername = (session && process.env.TURN_USERNAME) || "";
  const turnCredential = (session && process.env.TURN_CREDENTIAL) || "";

  return NextResponse.json({ appUrl, socketUrl, socketPath, turnUrl, turnUsername, turnCredential });
}
