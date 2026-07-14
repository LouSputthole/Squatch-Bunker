import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertFeature } from "@/lib/features";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { sfuConfigured, mintSfuToken } from "@/lib/sfu";

/**
 * POST /api/voice/sfu-token — mint a LiveKit access token for a voice channel.
 * SFU groundwork (HOSTED.md "Voice scaling"): gated on the sfu_voice premium
 * flag and channel membership; 503 until a LiveKit deployment is configured.
 * Clients that get a 503/403 stay on the mesh path.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!sfuConfigured()) {
    return NextResponse.json(
      { error: "SFU voice is not available on this instance" },
      { status: 503 },
    );
  }

  let body: { channelId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  if (!(await assertFeature(session.userId, "sfu_voice"))) {
    return NextResponse.json({ error: "Upgrade required" }, { status: 403 });
  }

  const access = await resolveChannelAccess(channelId, session.userId);
  if (!access?.canView) {
    return NextResponse.json({ error: "Not a member of this channel" }, { status: 403 });
  }

  return NextResponse.json({
    url: process.env.LIVEKIT_URL,
    token: mintSfuToken(session.userId, channelId, session.username),
  });
}
