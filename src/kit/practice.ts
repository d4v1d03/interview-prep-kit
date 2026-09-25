import type { Flashcard, Requirement } from "./schema";

/**
 * Practice ordering: a confidence-weighted sort, not a spaced-repetition
 * schedule. Interview prep lasts days, not months, so long review intervals
 * would mostly never come due; what helps is seeing the weakest material first
 * every session. Order:
 *   1. cards last rated "again"
 *   2. cards never practised (nothing is known about them yet)
 *   3. cards last rated "unsure"
 *   4. cards last rated "knew it"
 * Within a group: cards tied to a must-have requirement first, then the card
 * practised longest ago, then kit order.
 */

export type Confidence = 1 | 2 | 3;
export const CONFIDENCE_LABEL: Record<Confidence, string> = { 1: "Again", 2: "Unsure", 3: "Knew it" };

export type Review = { cardId: string; confidence: number; reviewedAt: Date | string };
export type CardStats = { lastConfidence: Confidence; lastReviewedAt: number; reviews: number };

/** Latest rating and review count per card, from the append-only history. */
export function summarise(reviews: Review[]): Map<string, CardStats> {
  const stats = new Map<string, CardStats>();
  for (const r of reviews) {
    const at = new Date(r.reviewedAt).getTime();
    const prev = stats.get(r.cardId);
    if (!prev || at >= prev.lastReviewedAt) {
      stats.set(r.cardId, { lastConfidence: r.confidence as Confidence, lastReviewedAt: at, reviews: (prev?.reviews ?? 0) + 1 });
    } else {
      prev.reviews++;
    }
  }
  return stats;
}

const GROUP: Record<Confidence | 0, number> = { 1: 0, 0: 1, 2: 2, 3: 3 };

export function orderSession(cards: Flashcard[], stats: Map<string, CardStats>, requirements: Requirement[]): Flashcard[] {
  const must = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const key = (card: Flashcard) => {
    const s = stats.get(card.id);
    return {
      group: GROUP[s?.lastConfidence ?? 0],
      mustLinked: card.requirement_ids.some((id) => must.has(id)) ? 0 : 1,
      lastSeen: s?.lastReviewedAt ?? 0,
    };
  };
  return cards
    .map((card, index) => ({ card, index, k: key(card) }))
    .sort((a, b) => a.k.group - b.k.group || a.k.mustLinked - b.k.mustLinked || a.k.lastSeen - b.k.lastSeen || a.index - b.index)
    .map(({ card }) => card);
}

/** What has been practised and how it went, for the progress panel. */
export function progress(cards: Flashcard[], stats: Map<string, CardStats>) {
  const counts = { again: 0, unsure: 0, knew: 0, notYet: 0 };
  for (const card of cards) {
    const c = stats.get(card.id)?.lastConfidence;
    if (c === 1) counts.again++;
    else if (c === 2) counts.unsure++;
    else if (c === 3) counts.knew++;
    else counts.notYet++;
  }
  return { total: cards.length, covered: cards.length - counts.notYet, ...counts };
}
