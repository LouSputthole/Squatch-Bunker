import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = process.env.COOKIE_NAME || "squatch-token";
const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password", "/api/auth/login", "/api/auth/register", "/api/auth/guest", "/join", "/explore", "/setup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static files, images, and api routes that handle their own auth
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/Campfire") || pathname.endsWith(".png") || pathname.endsWith(".ico")) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;

  // Protect /chat routes
  if (pathname.startsWith("/chat") && !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect root to chat or login
  if (pathname === "/") {
    if (token) {
      return NextResponse.redirect(new URL("/chat", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
