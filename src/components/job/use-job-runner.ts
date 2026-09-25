"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { JobView } from "@/server/jobs/runner";

export type Connection = "ok" | "reconnecting";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives a job from the browser: ask the server to run the next step, show the
 * result, repeat until the job succeeds or fails. The server decides what runs;
 * this hook only keeps asking. If the network drops it backs off and keeps
 * trying (showing "reconnecting"); if another tab holds the step, it waits.
 * `enabled` lets a list run several jobs one after another instead of at once.
 */
export function useJobRunner(initial: JobView | null, options: { enabled?: boolean; onSucceeded?: (job: JobView) => void } = {}) {
  const [job, setJob] = useState<JobView | null>(initial);
  const [connection, setConnection] = useState<Connection>("ok");
  const onSucceeded = useRef(options.onSucceeded);
  useEffect(() => {
    onSucceeded.current = options.onSucceeded;
  });

  const enabled = options.enabled ?? true;
  const jobId = job?.id;
  const running = job?.status === "running";

  useEffect(() => {
    if (!jobId || !running || !enabled) return;
    let cancelled = false;

    (async () => {
      let failures = 0;
      let lastStep = -1;
      while (!cancelled) {
        try {
          const { job: next } = await apiFetch<{ job: JobView }>(`/api/jobs/${jobId}/tick`, { method: "POST" });
          if (cancelled) return;
          failures = 0;
          setConnection("ok");
          setJob(next);
          if (next.status === "succeeded") onSucceeded.current?.(next);
          if (next.status !== "running") return;
          // No progress means another tab is running this step: check back shortly instead of hammering.
          await sleep(next.stepIndex === lastStep ? 2000 : 250);
          lastStep = next.stepIndex;
        } catch (err) {
          if (cancelled || (err instanceof ApiClientError && err.status === 401)) return;
          if (err instanceof ApiClientError && err.status === 404) return;
          failures++;
          setConnection("reconnecting");
          await sleep(Math.min(30_000, 1000 * 2 ** failures));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, running, enabled]);

  async function retry() {
    if (!job) return;
    const { job: next } = await apiFetch<{ job: JobView }>(`/api/jobs/${job.id}/retry`, { method: "POST" });
    setJob(next);
  }

  return { job, connection, retry };
}
