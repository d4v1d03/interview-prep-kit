import { z } from "zod";

/**
 * The kit structure from Appendix A of the brief. Field names are exact and
 * must not change; extensions (e.g. `research`, `warnings`, `evidence`) are
 * additive and optional so a kit stays valid under the published shape.
 */

export const REQUIREMENT_KINDS = ["technical", "behavioural", "domain"] as const;
export const PRIORITIES = ["must", "nice"] as const;
export const QUESTION_CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

const int = z.number().int();

export const requirementSchema = z.looseObject({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(PRIORITIES),
  /** Extension: the posting's own words this requirement was taken from. */
  evidence: z.string().optional(),
});

/**
 * Extension fields on a question carry the builder's state:
 * - origin: who produced it — the model, the user, the coverage fallback, or a gap pass
 * - edited: the user changed a generated question (so regeneration must keep it)
 * - pinned: the user asked to keep it regardless
 */
export const questionSchema = z.looseObject({
  id: z.string().min(1),
  requirement_ids: z.array(z.string()),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: int.min(1).max(3),
  origin: z.enum(["generated", "gap-pass", "template", "user"]).optional(),
  edited: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const flashcardSchema = z.looseObject({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  origin: z.enum(["generated", "user"]).optional(),
  edited: z.boolean().optional(),
});

export const scheduleDaySchema = z.looseObject({
  day: int.min(1),
  focus: z.string().min(1),
  question_ids: z.array(z.string()),
  minutes: int.min(1),
});

export const kitSchema = z.looseObject({
  source: z.looseObject({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: int.min(0),
    researched_at: z.string(),
    pages_used: z.array(z.string()),
  }),
  company_brief: z.looseObject({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
  }),
  role: z.looseObject({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(requirementSchema),
  }),
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: z.looseObject({
    days_available: int.min(1),
    days: z.array(scheduleDaySchema),
  }),
  coverage: z.looseObject({
    uncovered_requirement_ids: z.array(z.string()),
    passes: int.min(0),
    /** Extension: which requirements were uncovered at each check. */
    history: z.array(z.object({ pass: int, uncovered: z.array(z.string()) })).optional(),
  }),

  // ---- Extensions (optional, additive): the honesty trail of how the kit was made.
  /** Plain-language notes on what was thin, missing or degraded. */
  warnings: z.array(z.string()).optional(),
  research: z
    .looseObject({
      hiring_page_found: z.boolean(),
      hiring_pages: z.array(z.string()),
      hiring_signals: z.array(z.string()),
      hiring_process: z.object({ summary: z.string(), stages: z.array(z.string()), sources: z.array(z.string()) }).nullable(),
      discussion: z.looseObject({
        source: z.string(),
        query: z.string(),
        items: z.array(z.looseObject({ url: z.string(), title: z.string(), snippet: z.string(), date: z.string() })),
      }),
      skipped_sources: z.array(z.looseObject({ url: z.string(), code: z.string(), reason: z.string() })),
      crawl_notes: z.array(z.string()),
      dropped_requirements: z.array(z.object({ text: z.string(), reason: z.string() })),
    })
    .optional(),
  generation: z.looseObject({ question_categories: z.array(z.string()), model_calls: z.array(z.unknown()) }).optional(),
});

export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;
export type Kit = z.infer<typeof kitSchema>;

export type KitIssue = { path: string; message: string };

/**
 * Validates shape (via zod) and the cross-references zod cannot express:
 * unique ids, references that resolve, and a schedule with exactly the days
 * requested. A kit is only saved or written out when this returns no issues.
 */
export function validateKit(input: unknown): { ok: true; kit: Kit } | { ok: false; issues: KitIssue[] } {
  const parsed = kitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const kit = parsed.data;
  const issues: KitIssue[] = [];

  const requirementIds = uniqueIds(kit.role.requirements, "role.requirements", issues);
  const questionIds = uniqueIds(kit.questions, "questions", issues);
  uniqueIds(kit.flashcards, "flashcards", issues);

  kit.questions.forEach((q, i) => {
    for (const rid of q.requirement_ids) {
      if (!requirementIds.has(rid)) issues.push({ path: `questions.${i}.requirement_ids`, message: `unknown requirement "${rid}"` });
    }
  });
  kit.flashcards.forEach((f, i) => {
    for (const rid of f.requirement_ids) {
      if (!requirementIds.has(rid)) issues.push({ path: `flashcards.${i}.requirement_ids`, message: `unknown requirement "${rid}"` });
    }
  });

  const { days_available, days } = kit.schedule;
  if (days.length !== days_available) {
    issues.push({ path: "schedule.days", message: `has ${days.length} days but days_available is ${days_available}` });
  }
  days.forEach((d, i) => {
    if (d.day !== i + 1) issues.push({ path: `schedule.days.${i}.day`, message: `expected day ${i + 1}, got ${d.day}` });
    for (const qid of d.question_ids) {
      if (!questionIds.has(qid)) issues.push({ path: `schedule.days.${i}.question_ids`, message: `unknown question "${qid}"` });
    }
  });
  for (const rid of kit.coverage.uncovered_requirement_ids) {
    if (!requirementIds.has(rid)) issues.push({ path: "coverage.uncovered_requirement_ids", message: `unknown requirement "${rid}"` });
  }

  return issues.length ? { ok: false, issues } : { ok: true, kit };
}

function uniqueIds(items: { id: string }[], path: string, issues: KitIssue[]): Set<string> {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) issues.push({ path: `${path}.${i}.id`, message: `duplicate id "${item.id}"` });
    seen.add(item.id);
  });
  return seen;
}
