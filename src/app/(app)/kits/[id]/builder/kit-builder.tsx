"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { JobProgress } from "@/components/job/job-progress";
import { useJobRunner } from "@/components/job/use-job-runner";
import { unscheduledQuestions } from "@/kit/edit";
import { buildSchedule, MAX_DAYS, MIN_DAYS } from "@/kit/schedule";
import type { Kit, QuestionCategory } from "@/kit/schema";
import { apiFetch } from "@/lib/api-client";
import type { JobView } from "@/server/jobs/runner";
import { FlashcardsSection } from "./flashcards";
import { CATEGORY_LABEL, QuestionsSection } from "./questions";
import { Badge, inputClass, Section } from "./ui";
import { useKitDocument, type SaveStatus } from "./use-kit-document";

type Regeneration = { kind: "brief" } | { kind: "gaps" } | { kind: "questions"; category: QuestionCategory };

type Props = { kitId: string; kit: Kit; version: number; runningJob: JobView | null };

/**
 * The builder. Edits apply instantly and save in the background. Regenerating a
 * section first saves pending edits, then locks the editor (a disabled
 * fieldset) for the few seconds the job runs, then reloads the merged result —
 * so a regeneration can never overwrite an edit that was still in flight.
 */
export function KitBuilder({ kitId, kit: initial, version, runningJob }: Props) {
  const doc = useKitDocument(kitId, initial, version);
  const { kit, update } = doc;
  const [job, setJob] = useState<JobView | null>(runningJob);
  const [error, setError] = useState<string | null>(null);
  const locked = job?.status === "running";

  async function regenerate(section: Regeneration) {
    setError(null);
    if (section.kind === "brief" && kit.company_brief.edited && !window.confirm("You edited the brief. Regenerating replaces it. Continue?")) return;
    if (!(await doc.flush())) return setError("Your latest edits could not be saved, so nothing was regenerated.");
    try {
      const res = await apiFetch<{ job: JobView }>(`/api/kits/${kitId}/regenerate`, { method: "POST", body: JSON.stringify(section) });
      setJob(res.job);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[11rem_1fr]">
      <nav aria-label="Kit sections" className="lg:sticky lg:top-4 lg:self-start">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col">
          {[
            ["brief", "Company brief"],
            ["requirements", "Requirements"],
            ["questions", "Questions"],
            ["flashcards", "Flashcards"],
            ["schedule", "Schedule"],
            ["notes", "Research notes"],
          ].map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-muted hover:text-foreground">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <Link href={`/kits/${kitId}/practice`} className="mt-4 inline-block rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
          Practise flashcards →
        </Link>
        <div className="mt-3">
          <SaveIndicator status={doc.status} problem={doc.problem} onRetry={() => void doc.flush()} onReload={() => void doc.reload()} />
        </div>
      </nav>

      <div className="min-w-0 space-y-4">
        {job && (job.status !== "succeeded" || locked) && (
          <RegenerationStatus
            key={job.id}
            job={job}
            onUpdate={setJob}
            onSucceeded={() => void doc.reload()}
            onDismiss={() => setJob(null)}
          />
        )}
        {error && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            {error}
          </p>
        )}
        {kit.warnings?.length ? (
          <ul className="list-disc space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 pl-8 text-sm">
            {kit.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        <fieldset disabled={locked} className="min-w-0 space-y-4 disabled:opacity-60">
          <legend className="sr-only">Kit editor{locked ? " (locked while a section regenerates)" : ""}</legend>
          <BriefSection kit={kit} update={update} onRegenerate={() => void regenerate({ kind: "brief" })} />
          <RequirementsSection kit={kit} onFillGaps={() => void regenerate({ kind: "gaps" })} />
          <QuestionsSection kit={kit} update={update} onRegenerate={(category) => void regenerate({ kind: "questions", category })} />
          <FlashcardsSection kit={kit} update={update} />
          <ScheduleSection kit={kit} update={update} />
        </fieldset>
        <NotesSection kit={kit} />
      </div>
    </div>
  );
}

function RegenerationStatus({
  job: initial,
  onUpdate,
  onSucceeded,
  onDismiss,
}: {
  job: JobView;
  onUpdate: (job: JobView) => void;
  onSucceeded: () => void;
  onDismiss: () => void;
}) {
  const { job, connection, retry } = useJobRunner(initial, { onSucceeded });
  useEffect(() => {
    if (job) onUpdate(job);
  }, [job, onUpdate]);
  if (!job) return null;
  return (
    <div>
      <JobProgress job={job} connection={connection} onRetry={retry} compact={job.status === "running"} />
      {job.status === "failed" && (
        <Button variant="ghost" className="mt-2" onClick={onDismiss}>
          Dismiss — keep the kit as it is
        </Button>
      )}
    </div>
  );
}

function SaveIndicator({
  status,
  problem,
  onRetry,
  onReload,
}: {
  status: SaveStatus;
  problem: string | null;
  onRetry: () => void;
  onReload: () => void;
}) {
  return (
    <div aria-live="polite" className="text-xs">
      {status === "invalid" && <span className="text-danger">Not saved — {problem}</span>}
      {status === "saved" && <span className="text-success">✓ All changes saved</span>}
      {status === "unsaved" && <span className="text-muted">Unsaved changes…</span>}
      {status === "saving" && <span className="text-muted">Saving…</span>}
      {status === "error" && (
        <span className="text-danger">
          Couldn&apos;t save.{" "}
          <button type="button" className="underline" onClick={onRetry}>
            Try again
          </button>
        </span>
      )}
      {status === "conflict" && (
        <span className="text-warning">
          Changed in another tab.{" "}
          <button type="button" className="underline" onClick={onReload}>
            Load latest
          </button>{" "}
          (discards edits made here since the last save)
        </span>
      )}
    </div>
  );
}

function BriefSection({ kit, update, onRegenerate }: { kit: Kit; update: (c: (k: Kit) => Kit) => void; onRegenerate: () => void }) {
  const [editing, setEditing] = useState(false);
  const brief = kit.company_brief;
  const set = (patch: Partial<Kit["company_brief"]>) => update((k) => ({ ...k, company_brief: { ...k.company_brief, ...patch, edited: true } }));
  const hiring = kit.research?.hiring_process;

  return (
    <Section
      id="brief"
      title="Company brief"
      actions={
        <>
          <Button variant="secondary" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            {editing ? "Done" : "Edit"}
          </Button>
          <Button variant="ghost" onClick={onRegenerate}>
            ↻ Regenerate brief
          </Button>
        </>
      }
    >
      {editing ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium">
            Summary
            <textarea className={`${inputClass} mt-1`} rows={3} value={brief.summary} onChange={(e) => set({ summary: e.target.value })} />
          </label>
          <label className="block text-xs font-medium">
            What they do
            <textarea className={`${inputClass} mt-1`} rows={4} value={brief.what_they_do} onChange={(e) => set({ what_they_do: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p>{brief.summary}</p>
          <p className="text-muted">{brief.what_they_do}</p>
        </div>
      )}
      {hiring ? (
        <div className="mt-3 text-sm">
          <p className="font-medium">How they interview</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {hiring.stages.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">No published interview process was found.</p>
      )}
      {brief.sources.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Sources:{" "}
          {brief.sources.filter(isWebUrl).map((s, i) => (
            <span key={s}>
              {i > 0 && ", "}
              <a href={s} target="_blank" rel="noreferrer" className="underline">
                {s.replace(/^https?:\/\//, "")}
              </a>
            </span>
          ))}
        </p>
      )}
    </Section>
  );
}

function RequirementsSection({ kit, onFillGaps }: { kit: Kit; onFillGaps: () => void }) {
  const uncovered = new Set(kit.coverage.uncovered_requirement_ids);
  const count = (id: string) => kit.questions.filter((q) => q.requirement_ids.includes(id)).length;
  return (
    <Section
      id="requirements"
      title={`Requirements (${kit.role.requirements.length})`}
      actions={
        uncovered.size > 0 ? (
          <Button onClick={onFillGaps}>
            Fill {uncovered.size} coverage gap{uncovered.size === 1 ? "" : "s"}
          </Button>
        ) : (
          <Badge tone="success">Every requirement has a question</Badge>
        )
      }
    >
      <p className="text-sm text-muted">
        {kit.role.title} · {kit.role.seniority} · checked {kit.coverage.passes} time{kit.coverage.passes === 1 ? "" : "s"} for coverage
      </p>
      {kit.role.requirements.length === 0 ? (
        <p className="mt-2 text-sm">The posting states no specific requirements, so none were invented.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm">
          {kit.role.requirements.map((r) => (
            <li key={r.id} className={`rounded-md px-2 py-1.5 ${uncovered.has(r.id) ? "bg-danger/5 ring-1 ring-danger/40" : ""}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-muted">{r.id}</span>
                <Badge tone={r.priority === "must" ? "danger" : "neutral"}>{r.priority === "must" ? "Must" : "Nice"}</Badge>
                <Badge>{r.kind}</Badge>
                <span>{r.text}</span>
                <span className={`ml-auto text-xs ${uncovered.has(r.id) ? "font-medium text-danger" : "text-muted"}`}>
                  {uncovered.has(r.id) ? "No question" : `${count(r.id)} question${count(r.id) === 1 ? "" : "s"}`}
                </span>
              </div>
              {r.evidence && <p className="mt-0.5 text-xs italic text-muted">“{r.evidence}”</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ScheduleSection({ kit, update }: { kit: Kit; update: (c: (k: Kit) => Kit) => void }) {
  const [days, setDays] = useState(String(kit.schedule.days_available));
  const stale = unscheduledQuestions(kit);
  const daysValid = Number.isInteger(Number(days)) && Number(days) >= MIN_DAYS && Number(days) <= MAX_DAYS;
  const byId = new Map(kit.questions.map((q) => [q.id, q]));

  return (
    <Section
      id="schedule"
      title={`Schedule (${kit.schedule.days_available} days)`}
      actions={
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (daysValid) update((k) => ({ ...k, schedule: buildSchedule(k.questions, k.role.requirements, Number(days)) }));
          }}
        >
          <label className="text-xs font-medium">
            Days
            <input type="number" min={MIN_DAYS} max={MAX_DAYS} className={`${inputClass} mt-1 w-20`} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <Button type="submit" variant="secondary" disabled={!daysValid}>
            ↻ Rebuild schedule
          </Button>
        </form>
      }
    >
      {stale.length > 0 && (
        <p role="status" className="mb-3 rounded-md bg-warning/10 p-2 text-sm">
          {stale.length} question{stale.length === 1 ? " is" : "s are"} not in the schedule yet ({stale.map((q) => q.id).join(", ")}). Rebuild to include {stale.length === 1 ? "it" : "them"}.
        </p>
      )}
      <ol className="space-y-2 text-sm">
        {kit.schedule.days.map((d) => (
          <li key={d.day} className="rounded-md border border-border p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                Day {d.day} · {d.focus}
              </span>
              <span className="tabular-nums text-muted">{d.minutes} min</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {d.question_ids.map((id, i) => (
                <span key={id}>
                  {i > 0 && " · "}
                  <a href={`#${id}`} className="underline-offset-2 hover:underline" title={byId.get(id)?.prompt}>
                    {id} ({CATEGORY_LABEL[byId.get(id)?.category ?? "technical"]})
                  </a>
                </span>
              ))}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function NotesSection({ kit }: { kit: Kit }) {
  const research = kit.research;
  return (
    <Section id="notes" title="Research notes">
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">What was read, what was skipped, and what was discarded</summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="font-medium">Pages read ({kit.source.pages_used.length})</p>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {kit.source.pages_used.map((u) => (
                <li key={u} className="break-all">
                  {u}
                </li>
              ))}
            </ul>
          </div>
          {research && (
            <>
              <p>Hiring page found: {research.hiring_page_found ? "yes" : "no"}</p>
              <div>
                <p className="font-medium">Public discussion ({research.discussion.items.length})</p>
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {research.discussion.items.filter((d) => isWebUrl(d.url)).map((d) => (
                    <li key={d.url}>
                      <a href={d.url} target="_blank" rel="noreferrer" className="underline">
                        {d.date}
                      </a>{" "}
                      — {d.snippet.slice(0, 160)}…
                    </li>
                  ))}
                </ul>
              </div>
              {research.skipped_sources.length > 0 && (
                <div>
                  <p className="font-medium">Skipped sources</p>
                  <ul className="mt-1 list-disc pl-5 text-muted">
                    {research.skipped_sources.map((s) => (
                      <li key={s.url} className="break-all">
                        {s.url} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {research.dropped_requirements.length > 0 && (
                <div>
                  <p className="font-medium">Discarded requirements (not supported by the posting)</p>
                  <ul className="mt-1 list-disc pl-5 text-muted">
                    {research.dropped_requirements.map((d) => (
                      <li key={d.text}>
                        {d.text} — {d.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </details>
    </Section>
  );
}

/** Only http(s) links are rendered, so an edited kit cannot smuggle in a javascript: URL. */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
