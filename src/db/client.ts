import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

/**
 * Production: Neon's HTTP driver — one stateless HTTPS round-trip per query, so
 * short-lived serverless functions have no connection pool to exhaust. The
 * trade-off is no interactive transactions; the app relies on single atomic
 * statements (conditional UPDATEs, ON CONFLICT) instead.
 *
 * Local development: `DATABASE_URL=pglite://<dir>` runs an embedded Postgres
 * (PGlite) so the app works with no database account. It is only imported when
 * asked for, and is migrated automatically on first use.
 */
const globalForDb = globalThis as unknown as { __db?: Promise<Db> };

export function getDb(): Promise<Db> {
  // Cached on globalThis so dev hot-reloads reuse one connection; a failed init is not cached.
  globalForDb.__db ??= createDb().catch((err) => {
    globalForDb.__db = undefined;
    throw err;
  });
  return globalForDb.__db;
}

async function createDb(): Promise<Db> {
  const url = requireEnv("DATABASE_URL");
  if (url.startsWith("pglite://")) {
    const { createPgliteDb } = await import("./pglite");
    // Same query-builder API; only `execute()` result shapes differ, and the app never reads them.
    return (await createPgliteDb(url.slice("pglite://".length), schema)) as unknown as Db;
  }
  return drizzle(neon(url), { schema });
}
