import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: checks that a session cookie exists, never the database.
 * It keeps signed-out visitors off protected pages cheaply; the authoritative
 * check is the Data Access Layer (src/server/auth/dal.ts), which every
 * protected page and endpoint calls.
 */
const PUBLIC_API = ["/api/health"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_API.includes(pathname)) return NextResponse.next();
  if (request.cookies.has("session")) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Please log in." } },
      { status: 401 },
    );
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/kits/:path*", "/api/:path*"],
};
