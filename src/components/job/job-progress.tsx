"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JobView } from "@/server/jobs/runner";
import type { Connection } from "./use-job-runner";

type Props = {
  job: JobView;
  connection: Connection;
  onRetry: () => Promise<void>;
  /** Compact single-line form for lists. */
  compact?: boolean;
};

/** Friendly explanations for the failure codes a job can end with. */
const FAILURE_HELP: Record<string, string> = {
  LLM_RATE_LIMITED: "The AI provider's free quota is used up for now. Retrying later usually works.",
  LLM_UNAVAILABLE: "The AI provider is overloaded or unreachable at the moment. Retry in a minute.",
  LLM_INVALID_OUTPUT: "The AI returned something unusable twice. Retrying usually works.",
  LLM_AUTH: "The server's AI key was rejected. This needs fixing by whoever runs the app.",
  LLM_BLOCKED: "The AI provider refused to process this posting.",
  INVALID_INPUT: "The job description or company address could not be used.",
};

export function JobProgress({ job, connection, onRetry, compact }: Props) {
  const total = job.steps.length;
  const done = Math.min(job.stepIndex, total);
  const current = job.steps[job.stepIndex];
  const percent = total ? Math.round((done / total) * 100) : 0;
  const elapsed = useElapsed(job.status === "running");

  if (compact) {
    return (
      <div className="text-sm">
        {job.status === "failed" ? (
          <span className="text-danger">Failed: {job.error?.message}</span>
        ) : job.status === "running" ? (
          <span className="text-muted">
            {current?.label ?? "Finishing"}… ({done}/{total})
          </span>
        ) : null}
        <ProgressBar percent={percent} failed={job.status === "failed"} />
      </div>
    );
  }

  return (
    <section aria-labelledby="progress-heading" className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="progress-heading" className="font-semibold">
          {job.status === "failed" ? "Generation stopped" : job.status === "succeeded" ? "Kit ready" : "Building your kit"}
        </h2>
        {job.status === "running" && <span className="text-sm tabular-nums text-muted">{elapsed}s</span>}
      </div>

      <ProgressBar percent={percent} failed={job.status === "failed"} />

      <p aria-live="polite" className="sr-only">
        {job.status === "running" && current ? `Step ${done + 1} of ${total}: ${current.label}` : job.status}
      </p>

      <ol className="mt-4 space-y-1.5 text-sm">
        {job.steps.map((step, i) => {
          const state = i < done ? "done" : i === done && job.status === "running" ? "active" : i === done && job.status === "failed" ? "failed" : "pending";
          return (
            <li key={step.name} className="flex items-center gap-2">
              <StepIcon state={state} />
              <span className={state === "pending" ? "text-muted" : state === "failed" ? "text-danger" : ""}>{step.label}</span>
            </li>
          );
        })}
      </ol>

      {connection === "reconnecting" && (
        <p role="status" className="mt-4 text-sm text-warning">
          Lost contact with the server — reconnecting. Your progress is saved.
        </p>
      )}

      {job.warnings.length > 0 && (
        <div className="mt-4 rounded-md bg-background p-3 text-sm">
          <p className="font-medium">Found so far</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            {job.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {job.status === "failed" && job.error && (
        <div role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">
          <p className="font-medium text-danger">{FAILURE_HELP[job.error.code] ?? "Something went wrong while generating."}</p>
          <p className="mt-1 text-muted">{job.error.message}</p>
          <p className="mt-2 text-muted">Everything completed before this step is kept; retrying continues from here.</p>
          <RetryButton onRetry={onRetry} />
        </div>
      )}
    </section>
  );
}

function RetryButton({ onRetry }: { onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 flex items-center gap-3">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onRetry();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Retrying…" : "Retry from this step"}
      </Button>
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}

function ProgressBar({ percent, failed }: { percent: number; failed: boolean }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Generation progress"
      className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border"
    >
      <div className={`h-full transition-all duration-500 ${failed ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.max(percent, 3)}%` }} />
    </div>
  );
}

function StepIcon({ state }: { state: "done" | "active" | "failed" | "pending" }) {
  if (state === "done") return <span aria-label="done" className="text-success">✓</span>;
  if (state === "failed") return <span aria-label="failed" className="text-danger">✕</span>;
  if (state === "active")
    return <span aria-label="in progress" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
  return <span aria-hidden className="inline-block h-3 w-3 rounded-full border border-border" />;
}

function useElapsed(active: boolean): number {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.round((now - started) / 1000);
}
