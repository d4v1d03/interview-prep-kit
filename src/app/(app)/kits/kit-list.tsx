"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { JobProgress } from "@/components/job/job-progress";
import { useJobRunner } from "@/components/job/use-job-runner";
import type { JobView } from "@/server/jobs/runner";

type KitSummary = {
  id: string;
  title: string;
  status: "generating" | "ready" | "failed";
  days: number;
  createdAt: string;
  createdLabel: string;
  job: JobView | null;
};

/**
 * The list also drives any kits still generating — one at a time, oldest
 * first, because parallel runs would only compete for the same free-tier
 * model quota. The rest show as queued until their turn.
 */
export function KitList({ kits }: { kits: KitSummary[] }) {
  const router = useRouter();
  const queue = kits
    .filter((k) => k.job?.status === "running")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((k) => k.id);
  const [finished, setFinished] = useState<string[]>([]);
  const active = queue.find((id) => !finished.includes(id));

  return (
    <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
      {kits.map((kit) => (
        <li key={kit.id} className="p-4">
          <KitRow
            kit={kit}
            runnable={kit.id === active}
            queued={queue.includes(kit.id) && kit.id !== active && !finished.includes(kit.id)}
            onDone={() => {
              setFinished((f) => [...f, kit.id]);
              router.refresh();
            }}
          />
        </li>
      ))}
    </ul>
  );
}

function KitRow({ kit, runnable, queued, onDone }: { kit: KitSummary; runnable: boolean; queued: boolean; onDone: () => void }) {
  const { job, connection, retry } = useJobRunner(kit.job, { enabled: runnable, onSucceeded: onDone });
  const status = job?.status === "failed" ? "failed" : job?.status === "running" ? "generating" : kit.status;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link href={`/kits/${kit.id}`} className="font-medium underline-offset-4 hover:underline">
          {kit.title}
        </Link>
        <p className="text-xs text-muted">
          {kit.days}-day plan · created {kit.createdLabel}
        </p>
      </div>
      <div className="sm:w-64">
        {status === "ready" ? (
          <StatusBadge tone="success">Ready</StatusBadge>
        ) : queued ? (
          <StatusBadge tone="muted">Queued</StatusBadge>
        ) : job ? (
          <JobProgress job={job} connection={connection} onRetry={retry} compact />
        ) : (
          <StatusBadge tone="danger">Failed</StatusBadge>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ tone, children }: { tone: "success" | "muted" | "danger"; children: React.ReactNode }) {
  const tones = { success: "bg-success/10 text-success", muted: "bg-border text-muted", danger: "bg-danger/10 text-danger" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
