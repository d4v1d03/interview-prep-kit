import "server-only";
import type { JobRow } from "@/db/schema";
import { env, isProduction } from "@/lib/env";
import { createLlmFromEnv } from "@/llm/from-env";
import { contextFromState } from "@/pipeline/context";
import { toPipelineError, type PipelineErrorCode } from "@/pipeline/errors";
import { runStep, STEPS, type Step } from "@/pipeline/run";
import type { PipelineDeps, PipelineState } from "@/pipeline/types";
import { ApiError } from "@/server/http";
import { claimJob, getJob, saveGeneratedKit, saveJobProgress, setKitStatus } from "@/server/kits/repository";
import { REGENERATE_KINDS } from "@/server/kits/regenerate";

/**
 * Runs jobs one step per request. The browser calls tick() repeatedly; each
 * call claims the job's lease, runs exactly one pipeline step, saves the state
 * and releases the lease. Consequences:
 * - no request runs longer than one step, so serverless time limits hold;
 * - closing the tab pauses the job, and reopening the kit resumes it;
 * - a failing step is retried once, then the job stops with its error, and
 *   "retry" resumes from that step with everything before it kept.
 */

const LEASE_MS = 290_000;
const MAX_STEP_ATTEMPTS = 2;
const NOT_RETRYABLE: PipelineErrorCode[] = ["INVALID_INPUT", "LLM_AUTH", "KIT_INVALID"];

type JobKind = {
  steps: Step[];
  /** Called once, after the last step succeeds. */
  finish: (job: JobRow, state: PipelineState) => Promise<void>;
  /** Called when the job gives up. */
  fail?: (job: JobRow) => Promise<void>;
};

const KINDS: Record<string, JobKind> = {
  generate: {
    steps: STEPS,
    finish: async (job, state) => {
      const kit = state.kit!;
      await saveGeneratedKit(job.kitId, kit, contextFromState(state), `${kit.role.title} · ${kit.source.company}`);
    },
    fail: (job) => setKitStatus(job.kitId, "failed"),
  },
  // One-step jobs that regenerate a single section of a finished kit.
  ...REGENERATE_KINDS,
};

export function registerJobKind(name: string, kind: JobKind) {
  KINDS[name] = kind;
}

export type JobView = {
  id: string;
  kitId: string;
  kind: string;
  status: JobRow["status"];
  stepIndex: number;
  steps: { name: string; label: string }[];
  error: { code: string; message: string } | null;
  /** Honest notes gathered so far ("no hiring page found"), shown while the kit is still generating. */
  warnings: string[];
};

export function toJobView(job: JobRow): JobView {
  const kind = KINDS[job.kind];
  return {
    id: job.id,
    kitId: job.kitId,
    kind: job.kind,
    status: job.status,
    stepIndex: job.stepIndex,
    steps: (kind?.steps ?? []).map(({ name, label }) => ({ name, label })),
    error: job.error ?? null,
    warnings: ((job.state as PipelineState | null)?.warnings ?? []).slice(),
  };
}

export function pipelineDeps(): PipelineDeps {
  return {
    llm: createLlmFromEnv(),
    // Private and loopback targets are blocked in production (SSRF), allowed locally for the fixture sites.
    urlPolicy: { allowPrivate: env().ALLOW_PRIVATE_URLS === "true" || !isProduction() },
  };
}

export async function tick(userId: string, jobId: string, deps: () => PipelineDeps = pipelineDeps): Promise<JobView> {
  const job = await claimJob(userId, jobId, LEASE_MS);
  if (!job) {
    // Someone else is running this step (another tab), or the job is already finished.
    const current = await getJob(userId, jobId);
    if (!current) throw new ApiError(404, "NOT_FOUND", "That job does not exist.");
    return toJobView(current);
  }

  const kind = KINDS[job.kind];
  if (!kind) throw new ApiError(500, "INTERNAL", `Unknown job kind ${job.kind}.`);
  const token = job.leaseToken!;

  try {
    const state = await runStep(kind.steps[job.stepIndex], job.state as PipelineState, deps());
    const nextIndex = job.stepIndex + 1;
    if (nextIndex >= kind.steps.length) {
      await kind.finish(job, state);
      await saveJobProgress(job.id, token, { status: "succeeded", stepIndex: nextIndex, stepAttempts: 0, state: { warnings: state.warnings }, error: null });
    } else {
      await saveJobProgress(job.id, token, { stepIndex: nextIndex, stepAttempts: 0, state, error: null });
    }
  } catch (err) {
    const error = toPipelineError(err);
    if (error.code === "INTERNAL") console.error(err);
    const attempts = job.stepAttempts + 1;
    const giveUp = attempts >= MAX_STEP_ATTEMPTS || NOT_RETRYABLE.includes(error.code);
    await saveJobProgress(job.id, token, {
      status: giveUp ? "failed" : "running",
      stepAttempts: attempts,
      error: { code: error.code, message: error.message },
    });
    if (giveUp) await kind.fail?.(job);
  }

  return toJobView((await getJob(userId, jobId))!);
}
