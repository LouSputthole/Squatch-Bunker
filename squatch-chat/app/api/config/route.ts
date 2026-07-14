import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sfuConfigured } from "@/lib/sfu";
import { billingConfiguration, getEdition } from "@/lib/edition";
import {
  assertTurnConfiguration,
  mintTurnCredentials,
} from "@/lib/turnCredentials";

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
  let turnUrls: string[] = [];
  let turnUrl = "";
  let turnUsername = "";
  let turnCredential = "";
  let turnExpiresAt: number | null = null;

  const turnConfiguration = assertTurnConfiguration();
  if (session && turnConfiguration.mode === "ephemeral") {
    const credentials = mintTurnCredentials(turnConfiguration.authSecret, session.userId, {
      ttlSeconds: turnConfiguration.ttlSeconds,
    });
    turnUrls = turnConfiguration.urls;
    turnUrl = turnUrls[0] || "";
    turnUsername = credentials.username;
    turnCredential = credentials.credential;
    turnExpiresAt = credentials.expiresAt;
  } else if (session && turnConfiguration.mode === "legacy") {
    turnUrls = turnConfiguration.urls;
    turnUrl = turnUrls[0] || "";
    turnUsername = turnConfiguration.username;
    turnCredential = turnConfiguration.credential;
  }

  const response = NextResponse.json({
    edition: getEdition(),
    billingEnabled: billingConfiguration().enabled,
    appUrl,
    socketUrl,
    socketPath,
    turnUrls,
    turnUrl,
    turnUsername,
    turnCredential,
    turnExpiresAt,
    sfuAvailable: sfuConfigured(),
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
