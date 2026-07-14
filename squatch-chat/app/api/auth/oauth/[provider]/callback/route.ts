import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createToken, setTokenCookie } from "@/lib/auth";
import { betaAccessRequired } from "@/lib/betaAccess";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const SECURE_COOKIE = APP_URL.startsWith("https://");

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get(`oauth_state_${provider}`)?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(`${APP_URL}/?error=oauth_failed`);
  }

  try {
    let providerUserId: string;
    let email: string;
    let name: string;
    let avatar: string | null = null;

    if (provider === "github") {
      // Exchange code for access token
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!tokenRes.ok) throw new Error(`GitHub token exchange failed with HTTP ${tokenRes.status}`);
      const { access_token } = await tokenRes.json() as { access_token: string };
      if (typeof access_token !== "string" || !access_token) {
        throw new Error("GitHub token exchange returned no access token");
      }

      // Get user profile
      const userRes = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `Bearer ${access_token}`, "Accept": "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!userRes.ok) throw new Error(`GitHub user lookup failed with HTTP ${userRes.status}`);
      const ghUser = await userRes.json() as {
        id: number;
        login: string;
        avatar_url: string | null;
      };

      // Get verified email (may be private on GitHub profile)
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { "Authorization": `Bearer ${access_token}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!emailRes.ok) throw new Error(`GitHub email lookup failed with HTTP ${emailRes.status}`);
      const emails = await emailRes.json() as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primaryEmail = emails.find((entry) => entry.primary && entry.verified)?.email
        ?? emails.find((entry) => entry.verified)?.email;

      if (!primaryEmail) {
        return NextResponse.redirect(`${APP_URL}/?error=oauth_no_email`);
      }

      providerUserId = String(ghUser.id);
      email = primaryEmail;
      name = ghUser.login;
      avatar = ghUser.avatar_url ?? null;
    } else if (provider === "google") {
      // Exchange code for access token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID ?? "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          code,
          grant_type: "authorization_code",
          redirect_uri: `${APP_URL}/api/auth/oauth/google/callback`,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!tokenRes.ok) throw new Error(`Google token exchange failed with HTTP ${tokenRes.status}`);
      const { access_token } = await tokenRes.json() as { access_token: string };
      if (typeof access_token !== "string" || !access_token) {
        throw new Error("Google token exchange returned no access token");
      }

      // Get user info
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { "Authorization": `Bearer ${access_token}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!userRes.ok) throw new Error(`Google user lookup failed with HTTP ${userRes.status}`);
      const googleUser = await userRes.json() as {
        id: string;
        email: string;
        verified_email: boolean;
        name: string;
        picture: string | null;
      };

      if (!googleUser.email || googleUser.verified_email !== true) {
        return NextResponse.redirect(`${APP_URL}/?error=oauth_no_email`);
      }

      providerUserId = googleUser.id;
      email = googleUser.email;
      name = googleUser.name;
      avatar = googleUser.picture ?? null;
    } else {
      return NextResponse.redirect(`${APP_URL}/?error=unknown_provider`);
    }

    email = email.trim().toLowerCase();
    // Find existing OAuth account link
    const oauthAccount = await prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: providerUserId } },
      include: { user: true },
    });

    let user = oauthAccount?.user;

    if (!user) {
      // Check if an account with this email already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      user = existingUser ?? undefined;

      if (!user) {
        if (betaAccessRequired()) {
          return NextResponse.redirect(
            new URL("/?error=beta_access_required", APP_URL),
          );
        }

        // Create new user — sanitize username and ensure uniqueness
        const baseUsername = name.slice(0, 20).replace(/[^a-zA-Z0-9_]/g, "_");
        let username = baseUsername;
        let suffix = 1;
        while (await prisma.user.findUnique({ where: { username } })) {
          username = `${baseUsername.slice(0, 17)}_${suffix++}`;
        }

        user = await prisma.user.create({
          data: {
            email,
            username,
            passwordHash: `oauth_${crypto.randomUUID()}`,
            avatar,
          },
        });
      }

      // Link this OAuth provider to the user
      await prisma.oAuthAccount.create({
        data: { userId: user.id, provider, providerAccountId: providerUserId },
      });
    }

    // Create session token and set auth cookie
    const token = createToken({ userId: user.id, username: user.username, tokenVersion: user.tokenVersion });
    const response = NextResponse.redirect(`${APP_URL}/chat`);
    setTokenCookie(response, token);

    // Clear the CSRF state cookie
    response.cookies.set(`oauth_state_${provider}`, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: SECURE_COOKIE,
      maxAge: 0,
      path: "/api/auth/oauth/",
    });

    return response;
  } catch (err) {
    console.error("[Campfire] OAuth error:", err);
    return NextResponse.redirect(`${APP_URL}/?error=oauth_failed`);
  }
}
