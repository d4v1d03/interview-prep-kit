import type { Question, Requirement } from "./schema";

/**
 * Coverage is decided here, not by the model: a requirement is covered when at
 * least one question references its id. No similarity scores, no judgement
 * calls — which is what makes the result checkable and repeatable.
 */
export function findUncovered(requirements: Requirement[], questions: Pick<Question, "requirement_ids">[]): Requirement[] {
  const referenced = new Set(questions.flatMap((q) => q.requirement_ids));
  return requirements.filter((r) => !referenced.has(r.id));
}

/** Must-haves first, so a gap pass with a limited budget spends it where it matters most. */
export function prioritiseGaps(gaps: Requirement[]): Requirement[] {
  return [...gaps].sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "must" ? -1 : 1));
}
