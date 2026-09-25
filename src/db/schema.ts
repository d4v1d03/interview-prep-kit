import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Kit } from "@/kit/schema";
import type { KitContext } from "@/pipeline/context";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stored lower-cased; uniqueness is enforced here, not in application code.
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Server-side sessions. The primary key is the SHA-256 of the cookie token, so a
 * leaked database dump cannot be replayed as live sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * A kit belongs to one user. `kit` holds the Appendix A document (null until the
 * first generation finishes); `context` keeps what the pipeline learned (crawl,
 * extraction, plan) so a single section can be regenerated without re-crawling.
 * `version` increments on every write: the builder sends the version it edited,
 * and a stale write is rejected instead of silently overwriting newer work.
 */
export const kits = pgTable(
  "kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    companyUrl: text("company_url").notNull(),
    jd: text("jd").notNull(),
    days: integer("days").notNull(),
    /** sha256 of (jd, company_url, days): the same posting submitted twice is recognised. */
    fingerprint: text("fingerprint").notNull(),
    status: text("status", { enum: ["generating", "ready", "failed"] }).notNull(),
    kit: jsonb("kit").$type<Kit>(),
    context: jsonb("context").$type<KitContext>(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kits_user_idx").on(t.userId, t.createdAt), index("kits_fingerprint_idx").on(t.userId, t.fingerprint)],
);

/**
 * Long-running work, one row per run. The browser drives it: each tick claims
 * the lease with a conditional UPDATE, runs one step, saves state, releases.
 * A lease that is never released (a crashed function) simply expires.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kitId: uuid("kit_id")
      .notNull()
      .references(() => kits.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
    stepIndex: integer("step_index").notNull().default(0),
    stepAttempts: integer("step_attempts").notNull().default(0),
    state: jsonb("state").$type<unknown>(),
    error: jsonb("error").$type<{ code: string; message: string } | null>(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** Random per claim; every save is conditional on it, so a tick whose lease expired cannot overwrite a newer one. */
    leaseToken: text("lease_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_kit_idx").on(t.kitId, t.createdAt)],
);

/**
 * Practice history: one row per flashcard rating. Kept apart from the kit
 * document so practising never collides with builder saves, and append-only so
 * the full history is there to order the next session.
 */
export const cardReviews = pgTable(
  "card_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kitId: uuid("kit_id")
      .notNull()
      .references(() => kits.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    /** 1 = again, 2 = unsure, 3 = knew it. */
    confidence: integer("confidence").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("card_reviews_kit_idx").on(t.kitId, t.userId)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type KitRow = typeof kits.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
