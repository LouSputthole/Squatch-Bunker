import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createToken, setTokenCookie } from "@/lib/auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get("oauth_state")?.value;

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
      });
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Get user profile
      const userRes = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `Bearer ${access_token}`, "Accept": "application/json" },
      });
      const ghUser = await userRes.json() as {
        id: number;
        login: string;
        email: string | null;
        avatar_url: string | null;
      };

      // Get verified email (may be private on GitHub profile)
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { "Authorization": `Bearer ${access_token}` },
      });
      const emails = await emailRes.json() as Array<{ email: string; primary: boolean }>;
      const primaryEmail = emails.find((e) => e.primary)?.email ?? ghUser.email;

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
      });
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Get user info
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { "Authorization": `Bearer ${access_token}` },
      });
      const googleUser = await userRes.json() as {
        id: string;
        email: string;
        name: string;
        picture: string | null;
      };

      if (!googleUser.email) {
        return NextResponse.redirect(`${APP_URL}/?error=oauth_no_email`);
      }

      providerUserId = googleUser.id;
      email = googleUser.email;
      name = googleUser.name;
      avatar = googleUser.picture ?? null;
    } else {
      return NextResponse.redirect(`${APP_URL}/?error=unknown_provider`);
    }

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
    const token = createToken({ userId: user.id, username: user.username });
    const response = NextResponse.redirect(`${APP_URL}/chat`);
    setTokenCookie(response, token);

    // Clear the CSRF state cookie
    response.cookies.set("oauth_state", "", { httpOnly: true, maxAge: 0, path: "/" });

    return response;
  } catch (err) {
    console.error("[Campfire] OAuth error:", err);
    return NextResponse.redirect(`${APP_URL}/?error=oauth_failed`);
  }
}
