import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cardReviews, jobs, kits, type JobRow, type KitRow } from "@/db/schema";
import type { Kit } from "@/kit/schema";
import type { KitContext } from "@/pipeline/context";

/**
 * Persistence for kits and jobs. Every read and write is scoped by user id, so
 * no code path can reach another user's kit — ownership is enforced here, at
 * the data layer, not left to each route to remember.
 */

export type NewKit = { title: string; companyUrl: string; jd: string; days: number; fingerprint: string };

export async function listKits(userId: string) {
  const db = await getDb();
  return db
    .select({
      id: kits.id,
      title: kits.title,
      companyUrl: kits.companyUrl,
      days: kits.days,
      status: kits.status,
      createdAt: kits.createdAt,
      updatedAt: kits.updatedAt,
    })
    .from(kits)
    .where(eq(kits.userId, userId))
    .orderBy(desc(kits.createdAt));
}

export async function getKit(userId: string, kitId: string): Promise<KitRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(kits).where(and(eq(kits.id, kitId), eq(kits.userId, userId))).limit(1);
  return row ?? null;
}

export async function findKitByFingerprint(userId: string, fingerprint: string) {
  const db = await getDb();
  const [row] = await db
    .select({ id: kits.id, status: kits.status, createdAt: kits.createdAt, title: kits.title })
    .from(kits)
    .where(and(eq(kits.userId, userId), eq(kits.fingerprint, fingerprint)))
    .orderBy(desc(kits.createdAt))
    .limit(1);
  return row ?? null;
}

/** Creates the kit and the job that will generate it. Ids are made here so the two rows can reference each other. */
export async function createKitWithJob(userId: string, input: NewKit, initialState: unknown) {
  const db = await getDb();
  const kitId = randomUUID();
  const jobId = randomUUID();
  await db.insert(kits).values({ id: kitId, userId, status: "generating", ...input });
  await db.insert(jobs).values({ id: jobId, kitId, userId, kind: "generate", status: "running", state: initialState });
  return { kitId, jobId };
}

export async function createJob(userId: string, kitId: string, kind: string, initialState: unknown): Promise<string> {
  const db = await getDb();
  const jobId = randomUUID();
  await db.insert(jobs).values({ id: jobId, kitId, userId, kind, status: "running", state: initialState });
  return jobId;
}

export async function getJob(userId: string, jobId: string): Promise<JobRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  return row ?? null;
}

/** The most recent job for each of the given kits (used to resume progress when a page is reopened). */
export async function latestJobs(userId: string, kitIds: string[]): Promise<Map<string, JobRow>> {
  if (kitIds.length === 0) return new Map();
  const db = await getDb();
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.userId, userId), inArray(jobs.kitId, kitIds)))
    .orderBy(desc(jobs.createdAt));
  const latest = new Map<string, JobRow>();
  for (const row of rows) if (!latest.has(row.kitId)) latest.set(row.kitId, row);
  return latest;
}

/**
 * Claims a running job for one step: a single conditional UPDATE, so two
 * concurrent ticks (two tabs, a double click) can never both win. Returns the
 * claimed row with its lease token, or null if someone else holds the lease.
 */
export async function claimJob(userId: string, jobId: string, leaseMs: number): Promise<JobRow | null> {
  const db = await getDb();
  const token = randomUUID();
  const [row] = await db
    .update(jobs)
    .set({ leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs), updatedAt: new Date() })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        eq(jobs.status, "running"),
        or(isNull(jobs.leaseUntil), lt(jobs.leaseUntil, new Date())),
      ),
    )
    .returning();
  return row ?? null;
}

/** Saves a step's outcome and releases the lease — only if this tick still holds it. */
export async function saveJobProgress(
  jobId: string,
  token: string,
  patch: Partial<Pick<JobRow, "status" | "stepIndex" | "stepAttempts" | "state" | "error">>,
): Promise<boolean> {
  const db = await getDb();
  const updated = await db
    .update(jobs)
    .set({ ...patch, leaseToken: null, leaseUntil: null, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.leaseToken, token)))
    .returning({ id: jobs.id });
  return updated.length > 0;
}

/** Puts a failed job back to running at the step it failed on; earlier steps are kept. */
export async function resumeFailedJob(userId: string, jobId: string): Promise<boolean> {
  const db = await getDb();
  const updated = await db
    .update(jobs)
    .set({ status: "running", stepAttempts: 0, error: null, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.status, "failed")))
    .returning({ id: jobs.id, kitId: jobs.kitId, kind: jobs.kind });
  if (!updated.length) return false;
  if (updated[0].kind === "generate") {
    await db.update(kits).set({ status: "generating", updatedAt: new Date() }).where(eq(kits.id, updated[0].kitId));
  }
  return true;
}

export async function setKitStatus(kitId: string, status: KitRow["status"]) {
  const db = await getDb();
  await db.update(kits).set({ status, updatedAt: new Date() }).where(eq(kits.id, kitId));
}

/** Stores a newly generated kit and bumps the version, so any open editor knows its copy is stale. */
export async function saveGeneratedKit(kitId: string, kit: Kit, context: KitContext, title: string) {
  const db = await getDb();
  await db
    .update(kits)
    .set({ kit, context, title, status: "ready", version: sql`${kits.version} + 1`, updatedAt: new Date() })
    .where(eq(kits.id, kitId));
}

export async function deleteKit(userId: string, kitId: string): Promise<boolean> {
  const db = await getDb();
  const deleted = await db.delete(kits).where(and(eq(kits.id, kitId), eq(kits.userId, userId))).returning({ id: kits.id });
  return deleted.length > 0;
}

/**
 * Saves the user's edited kit only if nobody else wrote since they loaded it
 * (optimistic concurrency). Returns the new version, or null on a conflict.
 */
export async function updateKitIfVersion(userId: string, kitId: string, version: number, kit: Kit): Promise<number | null> {
  const db = await getDb();
  const [row] = await db
    .update(kits)
    .set({ kit, version: sql`${kits.version} + 1`, updatedAt: new Date() })
    .where(and(eq(kits.id, kitId), eq(kits.userId, userId), eq(kits.version, version), eq(kits.status, "ready")))
    .returning({ version: kits.version });
  return row?.version ?? null;
}

/**
 * Read-modify-write against the latest saved kit, retried if another write
 * lands in between. Regeneration results are applied this way, so they merge
 * into whatever the user has saved rather than replacing it with a stale copy.
 */
export async function applyToLatestKit(kitId: string, change: (kit: Kit) => Kit): Promise<void> {
  const db = await getDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db.select({ kit: kits.kit, version: kits.version }).from(kits).where(eq(kits.id, kitId)).limit(1);
    if (!row?.kit) throw new Error("Kit not found or not generated yet.");
    const updated = await db
      .update(kits)
      .set({ kit: change(row.kit), version: sql`${kits.version} + 1`, updatedAt: new Date() })
      .where(and(eq(kits.id, kitId), eq(kits.version, row.version)))
      .returning({ id: kits.id });
    if (updated.length) return;
  }
  throw new Error("The kit kept changing while the regeneration was being saved.");
}

export async function listReviews(userId: string, kitId: string) {
  const db = await getDb();
  return db
    .select({ cardId: cardReviews.cardId, confidence: cardReviews.confidence, reviewedAt: cardReviews.reviewedAt })
    .from(cardReviews)
    .where(and(eq(cardReviews.kitId, kitId), eq(cardReviews.userId, userId)));
}

export async function addReview(userId: string, kitId: string, cardId: string, confidence: number) {
  const db = await getDb();
  await db.insert(cardReviews).values({ userId, kitId, cardId, confidence });
}
