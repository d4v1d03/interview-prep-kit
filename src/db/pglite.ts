import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/**
 * Development-only embedded Postgres, migrated from the same SQL files as
 * production. `pglite://memory` keeps everything in memory (used by tests).
 */
export async function createPgliteDb<S extends Record<string, unknown>>(dataDir: string, schema: S) {
  let client: PGlite;
  if (dataDir === "memory") {
    client = new PGlite();
  } else {
    const dir = path.resolve(dataDir);
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve("drizzle") });
  return db;
}
