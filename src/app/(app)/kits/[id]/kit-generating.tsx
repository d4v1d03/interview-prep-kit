"use client";

import { useRouter } from "next/navigation";
import { JobProgress } from "@/components/job/job-progress";
import { useJobRunner } from "@/components/job/use-job-runner";
import type { JobView } from "@/server/jobs/runner";

/** Drives the kit's generation job and, once it succeeds, reloads the page to show the finished kit. */
export function KitGenerating({ job: initial }: { job: JobView }) {
  const router = useRouter();
  const { job, connection, retry } = useJobRunner(initial, { onSucceeded: () => router.refresh() });
  if (!job) return null;
  return (
    <div className="max-w-xl">
      <JobProgress job={job} connection={connection} onRetry={retry} />
      {job.status === "running" && (
        <p className="mt-3 text-xs text-muted">
          This usually takes under a minute. You can leave this page — generation pauses and picks up where it left off when you return.
        </p>
      )}
    </div>
  );
}
