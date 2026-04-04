import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/api/auth/login", "/api/auth/register", "/api/auth/guest", "/join"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static files and API routes that don't need auth check here
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/sasquatch")) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const token = request.cookies.get("squatch-token")?.value;

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
