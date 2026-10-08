import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sfuConfigured } from "@/lib/sfu";
import { billingConfiguration, getEdition } from "@/lib/edition";
import { emailConfiguration } from "@/lib/email";
import { assertFeature, getTier, hasFeature } from "@/lib/features";
import {
  EXTENDED_UPLOAD_MAX_BYTES,
  STANDARD_UPLOAD_MAX_BYTES,
} from "@/lib/uploadPolicy";
import {
  assertTurnConfiguration,
  mintTurnCredentials,
} from "@/lib/turnCredentials";

/** Same check as /api/auth/oauth/[provider]: both client id and secret set. */
function configuredOAuthProviders(): string[] {
  const providers: string[] = [];
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) providers.push("github");
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) providers.push("google");
  return providers;
}

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

  // The attachment ceiling /api/attachments enforces for this caller: their
  // own tier when signed in, otherwise this edition's default.
  let extendedUpload = hasFeature(getTier(null), "extended_upload");
  if (session) {
    try {
      extendedUpload = await assertFeature(session.userId, "extended_upload");
    } catch (error) {
      console.error("[Campfire] Config upload-limit lookup failed:", error);
    }
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
    oauthProviders: configuredOAuthProviders(),
    passwordResetEnabled: emailConfiguration().enabled,
    maxUploadBytes: extendedUpload ? EXTENDED_UPLOAD_MAX_BYTES : STANDARD_UPLOAD_MAX_BYTES,
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
