import type { Flashcard, Question, QuestionCategory, Requirement } from "@/kit/schema";
import { LlmError, untrusted } from "@/llm/gemini";
import { normalise } from "../grounding";
import { ownerCategory } from "../plan";
import { questionBatchSchema, questionSystem } from "../prompts";
import type { PipelineDeps, PipelineState } from "../types";

/** Questions written when a category has no requirements of its own (e.g. company fit from the brief alone). */
const GENERIC_COUNT: Partial<Record<QuestionCategory, number>> = { "company-fit": 3, behavioural: 2, "system-design": 2 };
const MAX_QUESTIONS_PER_CALL = 20;

/**
 * Step 4 (one per category) — each category is its own call with its own
 * instructions. The call sees the requirements that category owns, how many
 * questions each needs, and what research found about the hiring process —
 * so a published take-home or system-design round shapes the questions.
 */
export function generateCategory(category: QuestionCategory) {
  return async function generateQuestions(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
    const plan = state.plan ?? [];
    if (!plan.includes(category)) return state;

    const requirements = state.role?.requirements ?? [];
    const owned = requirements.filter((r) => ownerCategory(r, plan) === category);
    // System design questions may draw on any technical requirement, not only design-flavoured ones.
    const referenceable = category === "system-design" ? requirements.filter((r) => r.kind === "technical") : owned;
    const generic = GENERIC_COUNT[category] ?? 0;
    if (owned.length === 0 && generic === 0) return state;

    const perRequirement = questionsPerRequirement(owned);
    let out;
    try {
      out = await deps.llm.generateJson({
        name: `questions-${category}`,
        system: questionSystem(category),
        prompt: buildPrompt(state, owned, referenceable, perRequirement, generic),
        schema: questionBatchSchema,
        temperature: 0.5,
      });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      // One failed category must not sink the kit: its requirements become gaps the coverage pass fills.
      return { ...state, warnings: [...state.warnings, `${category} questions could not be generated (${err.message}).`] };
    }

    const knownIds = new Set(requirements.map((r) => r.id));
    const allowsUnlinked = owned.length === 0 || category === "company-fit";
    const existingPrompts = new Set(state.questions.map((q) => normalise(q.prompt)));
    let { question: qn, flashcard: fn } = state.nextId;

    const questions: Question[] = [];
    for (const q of out.questions) {
      const ids = unique(q.requirement_ids.filter((id) => knownIds.has(id)));
      const key = normalise(q.prompt);
      if ((!ids.length && !allowsUnlinked) || !key || existingPrompts.has(key)) continue;
      existingPrompts.add(key);
      questions.push({
        id: `q${qn++}`,
        requirement_ids: ids,
        category,
        prompt: q.prompt.trim().slice(0, 800),
        answer_outline: q.answer_outline.trim().slice(0, 2000),
        difficulty: q.difficulty,
        origin: "generated",
      });
    }
    const flashcards: Flashcard[] = out.flashcards
      .filter((f) => f.front.trim())
      .map((f) => ({
        id: `f${fn++}`,
        front: f.front.trim().slice(0, 300),
        back: f.back.trim().slice(0, 1000),
        requirement_ids: unique(f.requirement_ids.filter((id) => knownIds.has(id))),
        origin: "generated" as const,
      }));

    return {
      ...state,
      questions: [...state.questions, ...questions],
      flashcards: [...state.flashcards, ...flashcards],
      nextId: { question: qn, flashcard: fn },
    };
  };
}

/** Must-haves get two questions and nice-to-haves one — trimmed to one each if that would be too many for one call. */
export function questionsPerRequirement(owned: Requirement[]): Map<string, number> {
  const generous = owned.reduce((n, r) => n + (r.priority === "must" ? 2 : 1), 0) <= MAX_QUESTIONS_PER_CALL;
  return new Map(owned.map((r) => [r.id, r.priority === "must" && generous ? 2 : 1]));
}

function buildPrompt(
  state: PipelineState,
  owned: Requirement[],
  referenceable: Requirement[],
  perRequirement: Map<string, number>,
  generic: number,
): string {
  const role = state.role!;
  const lines: string[] = [
    `Role: ${role.title} (seniority: ${role.seniority})`,
    "",
  ];

  if (owned.length) {
    lines.push("Write questions for these requirements (id, priority, requirement → number of questions):");
    for (const r of owned) lines.push(`- ${r.id} [${r.priority}] ${r.text} → ${perRequirement.get(r.id)}`);
  } else {
    lines.push(`No requirement belongs to this category. Write ${generic} questions based on the role and company context.`);
  }
  const extra = referenceable.filter((r) => !owned.includes(r));
  if (extra.length) {
    lines.push("", "Other requirements you may reference if a question genuinely tests them:");
    for (const r of extra) lines.push(`- ${r.id} [${r.priority}] ${r.text}`);
  }

  const brief = state.brief;
  const signals = [...new Set(state.research?.crawl.pages.flatMap((p) => p.hiringSignals) ?? [])];
  lines.push("", "What we know about how this company interviews:");
  if (brief?.hiring_process) {
    lines.push(untrusted("hiring_process", `${brief.hiring_process.summary}\nStages: ${brief.hiring_process.stages.join(" → ")}`));
    lines.push("Tailor the questions to these stages (for example, if there is a take-home, include a question about discussing or extending it).");
  } else if (signals.length) {
    lines.push(`The company's pages mention: ${signals.join(", ")}.`);
  } else {
    lines.push("Nothing was published. Do not assume a particular process.");
  }

  lines.push("", "Company context:");
  lines.push(
    brief && brief.sources.length
      ? untrusted("company_brief", `${brief.summary}\n${brief.what_they_do}`)
      : "No company research is available. Do not invent company details.",
  );
  return lines.join("\n");
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];
