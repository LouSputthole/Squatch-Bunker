import { NextRequest, NextResponse } from "next/server";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  const state = crypto.randomUUID();
  const callbackUrl = `${APP_URL}/api/auth/oauth/${provider}/callback`;

  let authUrl: string;

  if (provider === "github") {
    if (!GITHUB_CLIENT_ID) {
      return NextResponse.json({ error: "GitHub OAuth not configured" }, { status: 501 });
    }
    const searchParams = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: callbackUrl,
      scope: "user:email",
      state,
    });
    authUrl = `https://github.com/login/oauth/authorize?${searchParams}`;
  } else if (provider === "google") {
    if (!GOOGLE_CLIENT_ID) {
      return NextResponse.json({ error: "Google OAuth not configured" }, { status: 501 });
    }
    const searchParams = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${searchParams}`;
  } else {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  // Store state in cookie for CSRF protection
  const response = NextResponse.redirect(authUrl);
  response.cookies.set("oauth_state", state, { httpOnly: true, maxAge: 300, path: "/" });
  return response;
}
