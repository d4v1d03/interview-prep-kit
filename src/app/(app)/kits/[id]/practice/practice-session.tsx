"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CONFIDENCE_LABEL, orderSession, progress, summarise, type Confidence, type Review } from "@/kit/practice";
import type { Flashcard, Requirement } from "@/kit/schema";
import { apiFetch } from "@/lib/api-client";

type Props = { kitId: string; cards: Flashcard[]; requirements: Requirement[]; reviews: Review[] };

/**
 * Overview → session → summary. The order is fixed when a session starts
 * (weakest first, see kit/practice.ts); each rating is saved as it is given,
 * so leaving halfway loses nothing. Keyboard: Space reveals, 1/2/3 rate.
 */
export function PracticeSession({ kitId, cards, requirements, reviews: initialReviews }: Props) {
  const [reviews, setReviews] = useState(initialReviews);
  const [queue, setQueue] = useState<Flashcard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionRatings, setSessionRatings] = useState<Confidence[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const stats = useMemo(() => summarise(reviews), [reviews]);
  const summary = progress(cards, stats);
  const card = queue?.[index];
  const finished = queue !== null && index >= queue.length;

  function start() {
    setQueue(orderSession(cards, stats, requirements));
    setIndex(0);
    setRevealed(false);
    setSessionRatings([]);
  }

  const rate = useCallback(
    async (confidence: Confidence) => {
      if (!card || !revealed) return;
      // Recorded locally at once so the session never waits on the network; the save follows.
      setReviews((r) => [...r, { cardId: card.id, confidence, reviewedAt: new Date().toISOString() }]);
      setSessionRatings((r) => [...r, confidence]);
      setIndex((i) => i + 1);
      setRevealed(false);
      try {
        await apiFetch(`/api/kits/${kitId}/practice`, { method: "POST", body: JSON.stringify({ cardId: card.id, confidence }) });
        setSaveError(null);
      } catch (err) {
        setSaveError(`Your rating for "${card.front.slice(0, 40)}" was not saved: ${(err as Error).message}`);
      }
    },
    [card, revealed, kitId],
  );

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select");
      if (e.repeat || e.metaKey || e.ctrlKey || typing) return;
      if (e.key === " " && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (["1", "2", "3"].includes(e.key) && revealed) {
        void rate(Number(e.key) as Confidence);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, rate]);

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="font-medium">This kit has no flashcards yet</p>
        <Link href={`/kits/${kitId}#flashcards`} className="mt-2 inline-block text-sm text-accent underline-offset-4 hover:underline">
          Add some in the builder →
        </Link>
      </div>
    );
  }

  if (card) {
    return (
      <div>
        <div className="flex items-center justify-between text-sm text-muted">
          <span aria-live="polite">
            Card {index + 1} of {queue!.length}
          </span>
          <button type="button" className="underline" onClick={() => setIndex(queue!.length)}>
            End session
          </button>
        </div>
        <article className="mt-3 rounded-lg border border-border bg-surface p-6" aria-live="polite">
          <p className="text-xs uppercase tracking-wide text-muted">
            {stats.get(card.id) ? `Last time: ${CONFIDENCE_LABEL[stats.get(card.id)!.lastConfidence]}` : "New card"}
          </p>
          <h2 className="mt-2 text-lg font-medium">{card.front}</h2>
          {revealed ? (
            <p className="mt-4 whitespace-pre-line border-t border-border pt-4">{card.back || <span className="text-muted">(no answer written)</span>}</p>
          ) : null}
        </article>

        {!revealed ? (
          <Button className="mt-4 w-full" onClick={() => setRevealed(true)} autoFocus>
            Reveal answer <kbd className="ml-2 rounded border border-accent-foreground/40 px-1 text-xs">Space</kbd>
          </Button>
        ) : (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">How confident were you?</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {([1, 2, 3] as Confidence[]).map((c) => (
                <Button key={c} variant={c === 1 ? "danger" : "secondary"} className="border border-border" onClick={() => void rate(c)} autoFocus={c === 2}>
                  {CONFIDENCE_LABEL[c]} <kbd className="ml-1 text-xs text-muted">{c}</kbd>
                </Button>
              ))}
            </div>
          </fieldset>
        )}
        {saveError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {saveError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {finished && (
        <div role="status" className="rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
          <p className="font-medium">Session complete — {sessionRatings.length} card{sessionRatings.length === 1 ? "" : "s"} practised</p>
          <p className="mt-1 text-muted">
            {sessionRatings.filter((c) => c === 3).length} known · {sessionRatings.filter((c) => c === 2).length} unsure ·{" "}
            {sessionRatings.filter((c) => c === 1).length} to go again. Next session starts with the ones you were least sure of.
          </p>
        </div>
      )}

      <ProgressPanel summary={summary} />

      <Button onClick={start} className="w-full sm:w-auto">
        {finished ? "Practise again" : summary.covered ? "Start a session — weakest cards first" : "Start practising"}
      </Button>

      <CardList title="Not practised yet" cards={cards.filter((c) => !stats.has(c.id))} empty="Every card has been practised at least once." />
      <CardList title="Needs another go" cards={cards.filter((c) => stats.get(c.id)?.lastConfidence === 1)} empty="Nothing marked “again”." />
    </div>
  );
}

function ProgressPanel({ summary }: { summary: ReturnType<typeof progress> }) {
  const segments = [
    { label: "Knew it", value: summary.knew, className: "bg-success" },
    { label: "Unsure", value: summary.unsure, className: "bg-warning" },
    { label: "Again", value: summary.again, className: "bg-danger" },
    { label: "Not practised", value: summary.notYet, className: "bg-border" },
  ];
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium">
        {summary.covered} of {summary.total} cards covered
      </p>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-border" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {segments.map((s) => (
          <div key={s.label} className={s.className} style={{ width: `${(s.value / Math.max(summary.total, 1)) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${s.className}`} aria-hidden />
            {s.label}: {s.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardList({ title, cards, empty }: { title: string; cards: Flashcard[]; empty: string }) {
  return (
    <div>
      <h2 className="text-sm font-medium">
        {title} ({cards.length})
      </h2>
      {cards.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {cards.map((c) => (
            <li key={c.id}>{c.front}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
