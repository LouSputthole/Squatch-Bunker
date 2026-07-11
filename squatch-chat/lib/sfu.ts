import jwt from "jsonwebtoken";

/**
 * LiveKit SFU seam (HOSTED.md "Voice scaling"). The SFU deployment itself is
 * post-launch; this is the groundwork: detect whether an SFU is configured and
 * mint LiveKit-compatible access tokens. A LiveKit token is a plain HS256 JWT
 * (iss = API key, sub = participant identity, `video` grant), so the already-
 * installed jsonwebtoken covers it — no LiveKit server SDK needed yet.
 */

export function sfuConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET,
  );
}

// Join window only — LiveKit checks exp at connect time, not mid-session.
const TOKEN_TTL_SECONDS = 10 * 60;

/** Mint a LiveKit access token. identity = our userId, room = our channelId. */
export function mintSfuToken(identity: string, room: string, name?: string): string {
  return jwt.sign(
    {
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true },
      ...(name ? { name } : {}),
    },
    process.env.LIVEKIT_API_SECRET as string,
    {
      algorithm: "HS256",
      issuer: process.env.LIVEKIT_API_KEY as string,
      subject: identity,
      expiresIn: TOKEN_TTL_SECONDS,
    },
  );
}
