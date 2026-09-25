/**
 * Applies the SQL migrations in ./drizzle to DATABASE_URL, using the same
 * Neon HTTP driver the app uses (or embedded PGlite for pglite:// URLs), so no
 * extra Postgres driver is needed:  npm run db:migrate
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

config({ path: [".env.local", ".env"], quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

if (url.startsWith("pglite://")) {
  // Local development applies migrations automatically on first use; nothing to do here.
  console.log("PGlite database: migrations run automatically when the app starts.");
} else {
  await migrate(drizzle(neon(url)), { migrationsFolder: "drizzle" });
  console.log("Migrations applied.");
}
