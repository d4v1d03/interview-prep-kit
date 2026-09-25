import type { Question, QuestionCategory, Requirement, ScheduleDay } from "./schema";

/**
 * Deterministic study schedule. The model never sees this step: allocation is
 * arithmetic, and the same kit always produces the same schedule.
 *
 * 1. Order questions: must-have first, then hardest first, then by category.
 * 2. Day N (the last) is never new material: it is a mock interview over the
 *    must-have questions. With one day, everything happens on day 1.
 * 3. Days 1..N-1 are learning days. Questions are cut into equal-count chunks in
 *    order, remainder to the earliest days — so hard, high-priority material
 *    lands first, not the night before.
 * 4. If there are more days than questions, the days between the last learning
 *    day and the mock become review days that cycle through the ordered list.
 *
 * Minutes are integers derived from difficulty, plus a daily flashcard block.
 */

export const MIN_DAYS = 1;
// The brief names 1 and 60 days as edge cases; any longer plan still allocates cleanly (review days cycle).
export const MAX_DAYS = 365;

const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 10, 2: 20, 3: 30 };
const FLASHCARD_BLOCK_MINUTES = 15;
const REVIEW_SET_SIZE = 5;
const CATEGORY_ORDER: QuestionCategory[] = ["system-design", "technical", "behavioural", "company-fit"];
const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  "system-design": "System design",
  technical: "Technical",
  behavioural: "Behavioural",
  "company-fit": "Company fit",
};

type ScheduleQuestion = Pick<Question, "id" | "requirement_ids" | "category" | "difficulty">;
type ScheduleRequirement = Pick<Requirement, "id" | "text" | "priority">;

export function buildSchedule(
  questions: ScheduleQuestion[],
  requirements: ScheduleRequirement[],
  days: number,
): { days_available: number; days: ScheduleDay[] } {
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new RangeError(`days must be an integer between ${MIN_DAYS} and ${MAX_DAYS} (got ${days})`);
  }
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const isMust = (q: ScheduleQuestion) => q.requirement_ids.some((id) => byId.get(id)?.priority === "must");
  const ordered = orderQuestions(questions, isMust);
  const describe = (qs: ScheduleQuestion[]) => focusFor(qs, byId, isMust);

  if (ordered.length === 0) {
    return {
      days_available: days,
      days: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        focus: "Read the company brief and the role breakdown",
        question_ids: [],
        minutes: 30,
      })),
    };
  }

  if (days === 1) {
    return {
      days_available: 1,
      days: [{ day: 1, focus: `All topics, hardest first — ${describe(ordered)}`, question_ids: ids(ordered), minutes: studyMinutes(ordered) }],
    };
  }

  const learningDays = Math.min(days - 1, ordered.length);
  const schedule: ScheduleDay[] = chunkFrontLoaded(ordered, learningDays).map((chunk, i) => ({
    day: i + 1,
    focus: describe(chunk),
    question_ids: ids(chunk),
    minutes: studyMinutes(chunk),
  }));

  const reviewDays = days - 1 - learningDays;
  const reviewSize = Math.min(REVIEW_SET_SIZE, ordered.length);
  for (let r = 0; r < reviewDays; r++) {
    const set = Array.from({ length: reviewSize }, (_, k) => ordered[(r * reviewSize + k) % ordered.length]);
    schedule.push({
      day: schedule.length + 1,
      focus: `Review — ${describe(set)}`,
      question_ids: ids(set),
      minutes: reviewMinutes(set),
    });
  }

  const mustQuestions = ordered.filter(isMust);
  const mock = mustQuestions.length ? mustQuestions : ordered.slice(0, REVIEW_SET_SIZE);
  schedule.push({
    day: days,
    focus: "Mock interview — answer the must-have questions out loud, then review weak flashcards",
    question_ids: ids(mock),
    minutes: reviewMinutes(mock),
  });

  return { days_available: days, days: schedule };
}

function orderQuestions(questions: ScheduleQuestion[], isMust: (q: ScheduleQuestion) => boolean): ScheduleQuestion[] {
  return questions
    .map((q, index) => ({ q, index }))
    .sort(
      (a, b) =>
        Number(isMust(b.q)) - Number(isMust(a.q)) ||
        b.q.difficulty - a.q.difficulty ||
        CATEGORY_ORDER.indexOf(a.q.category) - CATEGORY_ORDER.indexOf(b.q.category) ||
        a.index - b.index,
    )
    .map(({ q }) => q);
}

/** Splits into `parts` contiguous chunks whose sizes differ by at most one, larger chunks first. */
export function chunkFrontLoaded<T>(items: T[], parts: number): T[][] {
  const base = Math.floor(items.length / parts);
  const extra = items.length % parts;
  const chunks: T[][] = [];
  let offset = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < extra ? 1 : 0);
    chunks.push(items.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

const ids = (qs: ScheduleQuestion[]) => qs.map((q) => q.id);
const questionMinutes = (q: ScheduleQuestion) => MINUTES_BY_DIFFICULTY[q.difficulty] ?? 20;
const studyMinutes = (qs: ScheduleQuestion[]) => qs.reduce((sum, q) => sum + questionMinutes(q), 0) + FLASHCARD_BLOCK_MINUTES;
/** Revisiting is quicker than first study: half time per question, rounded up to whole minutes. */
const reviewMinutes = (qs: ScheduleQuestion[]) =>
  qs.reduce((sum, q) => sum + Math.ceil(questionMinutes(q) / 2), 0) + FLASHCARD_BLOCK_MINUTES;

/** "Technical — 5+ years with React; PostgreSQL tuning": the day's main category and its top requirements. */
function focusFor(
  qs: ScheduleQuestion[],
  byId: Map<string, ScheduleRequirement>,
  isMust: (q: ScheduleQuestion) => boolean,
): string {
  const counts = new Map<QuestionCategory, number>();
  for (const q of qs) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const main = [...counts].sort((a, b) => b[1] - a[1] || CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]))[0][0];

  const topics: string[] = [];
  for (const q of [...qs].sort((a, b) => Number(isMust(b)) - Number(isMust(a)))) {
    for (const id of q.requirement_ids) {
      const text = byId.get(id)?.text;
      if (text && !topics.includes(text)) topics.push(text);
    }
  }
  const shown = topics.slice(0, 2).map((t) => (t.length > 60 ? `${t.slice(0, 57)}…` : t));
  return shown.length ? `${CATEGORY_LABEL[main]}: ${shown.join("; ")}` : CATEGORY_LABEL[main];
}
