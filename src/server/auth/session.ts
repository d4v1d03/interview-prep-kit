import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { isProduction } from "@/lib/env";

export const SESSION_COOKIE = "session";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;
/** Sessions used in their last 15 days are extended, so active users are not logged out mid-prep. */
const RENEW_WITHIN_MS = 15 * DAY_MS;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await (await getDb()).insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  // The database row is the only authority on expiry (it can be renewed or revoked);
  // the cookie just carries the token, so it gets the browser's maximum lifetime.
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: 400 * 24 * 60 * 60,
  });
}

export type SessionUser = { id: string; email: string };

/**
 * Resolves the cookie to a user, or null if it is missing, unknown or expired.
 * Expired rows are deleted on sight. Callable from Server Components (which
 * cannot write cookies), which is why renewal only touches the row.
 */
export async function validateSessionToken(token: string): Promise<SessionUser | null> {
  const db = await getDb();
  const id = hashToken(token);
  const [row] = await db
    .select({ userId: users.id, email: users.email, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (row.expiresAt.getTime() - Date.now() < RENEW_WITHIN_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id));
  }
  return { id: row.userId, email: row.email };
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await (await getDb()).delete(sessions).where(eq(sessions.id, hashToken(token)));
  store.delete(SESSION_COOKIE);
}
