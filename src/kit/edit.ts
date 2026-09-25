import { findUncovered } from "./coverage";
import type { Kit, Question, QuestionCategory } from "./schema";

/**
 * Pure functions behind the builder. Shared by the browser (to update the kit
 * immediately) and the server (to apply regenerations to the latest saved kit).
 *
 * State model — every question carries:
 *   origin:  "generated" | "gap-pass" | "template" (written by the system) or "user"
 *   edited:  true once the user changes a system-written question
 *   pinned:  true when the user chooses to keep it as it is
 * Regeneration may only replace system-written questions that are neither
 * edited nor pinned. Everything else is the user's work and survives.
 */

export function isReplaceable(q: Question): boolean {
  return q.origin !== "user" && !q.edited && !q.pinned;
}

/** Next unused id for a prefix ("q", "f"): ids are never reused, so references stay unambiguous. */
export function nextId(items: { id: string }[], prefix: string): string {
  const max = items.reduce((m, item) => {
    const n = Number(item.id.slice(prefix.length));
    return item.id.startsWith(prefix) && Number.isInteger(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${max + 1}`;
}

/**
 * Regenerating one category: drop that category's replaceable questions, keep
 * everything else in place, append the fresh ones at the end of the category's
 * list. Other categories, flashcards and the brief are untouched.
 */
export function replaceCategory(kit: Kit, category: QuestionCategory, fresh: Question[]): Kit {
  const kept = kit.questions.filter((q) => q.category !== category || !isReplaceable(q));
  return reconcile({ ...kit, questions: [...kept, ...fresh.map((q) => ({ ...q, category }))] });
}

/** Adds questions (a gap pass) without touching existing ones. */
export function appendQuestions(kit: Kit, fresh: Question[]): Kit {
  return reconcile({ ...kit, questions: [...kit.questions, ...fresh] });
}

/**
 * Keeps derived parts consistent after any change: schedule entries pointing at
 * deleted questions are removed, and coverage is recomputed by code. New
 * questions are not scheduled until the user rebuilds the schedule (see scheduleIsStale).
 */
export function reconcile(kit: Kit): Kit {
  const ids = new Set(kit.questions.map((q) => q.id));
  return {
    ...kit,
    schedule: {
      ...kit.schedule,
      days: kit.schedule.days.map((d) => ({ ...d, question_ids: d.question_ids.filter((id) => ids.has(id)) })),
    },
    coverage: {
      ...kit.coverage,
      uncovered_requirement_ids: findUncovered(kit.role.requirements, kit.questions).map((r) => r.id),
    },
  };
}

/** Questions the current schedule does not include (added or regenerated since it was built). */
export function unscheduledQuestions(kit: Kit): Question[] {
  const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
  return kit.questions.filter((q) => !scheduled.has(q.id));
}

/** Moves a question one place up or down among the questions of its own category. */
export function moveWithinCategory(questions: Question[], id: string, direction: -1 | 1): Question[] {
  const index = questions.findIndex((q) => q.id === id);
  if (index === -1) return questions;
  const category = questions[index].category;
  let target = index + direction;
  while (target >= 0 && target < questions.length && questions[target].category !== category) target += direction;
  if (target < 0 || target >= questions.length) return questions;
  const next = [...questions];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Applies a user's change to a question, marking system-written questions as edited so regeneration keeps them. */
export function editQuestion(q: Question, patch: Partial<Question>): Question {
  const changesContent = ["prompt", "answer_outline", "difficulty", "category", "requirement_ids"].some((k) => k in patch);
  return { ...q, ...patch, edited: q.edited || (changesContent && q.origin !== "user") };
}
