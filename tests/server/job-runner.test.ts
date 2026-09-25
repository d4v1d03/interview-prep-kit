import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// A real Postgres (in-memory PGlite) running the real migrations; cookies are never touched here.
process.env.DATABASE_URL = "pglite://memory";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { getDb } = await import("@/db/client");
const { jobs, users } = await import("@/db/schema");
const { registerJobKind, tick } = await import("@/server/jobs/runner");
const repo = await import("@/server/kits/repository");
const { LlmError } = await import("@/llm/gemini");

type State = { input: unknown; warnings: string[]; log: string[]; llmCalls: never[] };

/** A controllable job kind: step "b" fails while `failuresLeft` > 0. */
let failuresLeft = 0;
const ran: string[] = [];
const finished: string[] = [];
const step = (name: string) => ({
  name,
  label: name,
  run: async (state: State) => {
    ran.push(name);
    if (name === "b" && failuresLeft > 0) {
      failuresLeft--;
      throw new LlmError("LLM_UNAVAILABLE", "model overloaded");
    }
    return { ...state, log: [...state.log, name] };
  },
});
registerJobKind("test", {
  steps: [step("a"), step("b"), step("c")] as never,
  finish: async (job) => {
    finished.push(job.id);
  },
});

const deps = () => ({ llm: { generateJson: async () => ({}) as never }, urlPolicy: { allowPrivate: true } });
let userId: string;
let otherUserId: string;

async function newJob(): Promise<{ kitId: string; jobId: string }> {
  const { kitId } = await repo.createKitWithJob(
    userId,
    { title: "t", companyUrl: "https://acme.com/", jd: "jd", days: 3, fingerprint: crypto.randomUUID() },
    {},
  );
  const jobId = await repo.createJob(userId, kitId, "test", { input: {}, warnings: [], log: [], llmCalls: [] });
  return { kitId, jobId };
}

beforeAll(async () => {
  const db = await getDb();
  [{ id: userId }] = await db.insert(users).values({ email: "a@example.com", passwordHash: "x" }).returning({ id: users.id });
  [{ id: otherUserId }] = await db.insert(users).values({ email: "b@example.com", passwordHash: "x" }).returning({ id: users.id });
});

describe("job runner", () => {
  it("runs exactly one step per tick and finishes the job", async () => {
    const { jobId } = await newJob();
    ran.length = 0;
    expect((await tick(userId, jobId, deps)).stepIndex).toBe(1);
    expect((await tick(userId, jobId, deps)).stepIndex).toBe(2);
    const last = await tick(userId, jobId, deps);
    expect(last).toMatchObject({ status: "succeeded", stepIndex: 3 });
    expect(ran).toEqual(["a", "b", "c"]);
    expect(finished).toContain(jobId);
  });

  it("lets only one of two simultaneous ticks run the step", async () => {
    const { jobId } = await newJob();
    ran.length = 0;
    await Promise.all([tick(userId, jobId, deps), tick(userId, jobId, deps)]);
    expect(ran).toEqual(["a"]);
  });

  it("retries a failing step once, then stops, and resumes from that step without redoing earlier ones", async () => {
    const { jobId } = await newJob();
    ran.length = 0;
    failuresLeft = 2;
    await tick(userId, jobId, deps); // a
    expect((await tick(userId, jobId, deps)).status).toBe("running"); // b fails, will retry
    const failed = await tick(userId, jobId, deps); // b fails again → give up
    expect(failed).toMatchObject({ status: "failed", stepIndex: 1, error: { code: "LLM_UNAVAILABLE" } });

    expect(await repo.resumeFailedJob(userId, jobId)).toBe(true);
    await tick(userId, jobId, deps); // b succeeds now
    const done = await tick(userId, jobId, deps); // c
    expect(done.status).toBe("succeeded");
    expect(ran).toEqual(["a", "b", "b", "b", "c"]); // "a" ran once: the resume did not start over
  });

  it("does not let a tick whose lease was taken over overwrite the newer state", async () => {
    const { jobId } = await newJob();
    const claimed = (await repo.claimJob(userId, jobId, 60_000))!;
    // Simulate the lease expiring and another tick claiming it.
    const db = await getDb();
    await db.update(jobs).set({ leaseUntil: new Date(0) }).where(eq(jobs.id, jobId));
    const newer = (await repo.claimJob(userId, jobId, 60_000))!;
    expect(await repo.saveJobProgress(jobId, claimed.leaseToken!, { stepIndex: 99 })).toBe(false);
    expect(await repo.saveJobProgress(jobId, newer.leaseToken!, { stepIndex: 1 })).toBe(true);
  });

  it("never lets another user tick, read or retry someone else's job", async () => {
    const { jobId, kitId } = await newJob();
    await expect(tick(otherUserId, jobId, deps)).rejects.toMatchObject({ status: 404 });
    expect(await repo.getKit(otherUserId, kitId)).toBeNull();
    expect(await repo.resumeFailedJob(otherUserId, jobId)).toBe(false);
    expect(await repo.deleteKit(otherUserId, kitId)).toBe(false);
  });
});
