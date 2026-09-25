import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from "./session";
import { ApiError } from "@/server/http";

/**
 * Data Access Layer: the authoritative auth check. `proxy.ts` only looks for
 * the cookie's presence; every page and endpoint that touches user data calls
 * one of these, which verifies the session against the database.
 * Memoised per request so a page and its children share one lookup.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

/** For pages: an invalid or expired session sends the visitor to log in again. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?reason=expired");
  return user;
}

/** For route handlers: a JSON 401 the client can act on, never an HTML redirect. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Your session has expired. Please log in again.");
  return user;
}
