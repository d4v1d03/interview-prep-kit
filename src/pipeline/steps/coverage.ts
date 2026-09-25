import { findUncovered, prioritiseGaps } from "@/kit/coverage";
import type { Question, QuestionCategory, Requirement } from "@/kit/schema";
import { LlmError, untrusted } from "@/llm/gemini";
import { normalise } from "../grounding";
import { ownerCategory } from "../plan";
import { GAP_SYSTEM, gapBatchSchema } from "../prompts";
import type { PipelineDeps, PipelineState } from "../types";

/**
 * Step 5 — the second pass. Code compares questions to requirements; any
 * requirement with no question is a gap. The model is asked for questions for
 * exactly those gaps, and code checks again. Two gap passes at most: after
 * that, further calls rarely help and each costs quota, so any requirement
 * still uncovered gets a plain template question written by code. The kit
 * therefore never ships with an uncovered must-have.
 */
export const MAX_GAP_PASSES = 2;

export async function closeCoverageGaps(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const requirements = state.role?.requirements ?? [];
  const plan = state.plan ?? [];
  const check = (s: PipelineState): [PipelineState, Requirement[]] => {
    const gaps = prioritiseGaps(findUncovered(requirements, s.questions));
    return [{ ...s, coverage: [...s.coverage, { pass: s.coverage.length + 1, uncovered: gaps.map((g) => g.id) }] }, gaps];
  };

  let [current, gaps] = check(state);
  for (let pass = 1; gaps.length && pass <= MAX_GAP_PASSES; pass++) {
    current = await gapPass(current, deps, gaps, plan);
    [current, gaps] = check(current);
  }

  if (gaps.length) {
    let n = current.nextId.question;
    const templates: Question[] = gaps.map((req) => templateQuestion(req, ownerCategory(req, plan), `q${n++}`));
    current = {
      ...current,
      questions: [...current.questions, ...templates],
      nextId: { ...current.nextId, question: n },
      warnings: [
        ...current.warnings,
        `${templates.length} requirement(s) still had no question after ${MAX_GAP_PASSES} gap passes and received a template question: ${gaps.map((g) => g.id).join(", ")}.`,
      ],
    };
  }
  return current;
}

async function gapPass(state: PipelineState, deps: PipelineDeps, gaps: Requirement[], plan: QuestionCategory[]): Promise<PipelineState> {
  const gapIds = new Set(gaps.map((g) => g.id));
  let out;
  try {
    out = await deps.llm.generateJson({
    name: `coverage-gap-pass-${state.coverage.length}`,
    system: GAP_SYSTEM,
    prompt: [
      `Role: ${state.role!.title} (seniority: ${state.role!.seniority})`,
      "",
      "These requirements have no interview question yet. Write exactly one question for each (id, category, priority, requirement):",
      ...gaps.map((g) => `- ${g.id} [${ownerCategory(g, plan)}] [${g.priority}] ${g.text}`),
      "",
      "Company context:",
      state.brief?.sources.length
        ? untrusted("company_brief", `${state.brief.summary}\n${state.brief.what_they_do}`)
        : "No company research is available. Do not invent company details.",
    ].join("\n"),
    schema: gapBatchSchema,
    temperature: 0.4,
    });
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    return { ...state, warnings: [...state.warnings, `A coverage gap pass failed (${err.message}).`] };
  }

  const existing = new Set(state.questions.map((q) => normalise(q.prompt)));
  let n = state.nextId.question;
  const added: Question[] = [];
  for (const q of out.questions) {
    const ids = [...new Set(q.requirement_ids)].filter((id) => gapIds.has(id));
    const key = normalise(q.prompt);
    if (!ids.length || !key || existing.has(key)) continue;
    existing.add(key);
    added.push({
      id: `q${n++}`,
      requirement_ids: ids,
      category: q.category,
      prompt: q.prompt.trim().slice(0, 800),
      answer_outline: q.answer_outline.trim().slice(0, 2000),
      difficulty: q.difficulty,
      origin: "gap-pass",
    });
  }
  return { ...state, questions: [...state.questions, ...added], nextId: { ...state.nextId, question: n } };
}

/** Code-written fallback: plain, honest, and tied to the requirement's own words. */
export function templateQuestion(req: Requirement, category: QuestionCategory, id: string): Question {
  const behavioural = req.kind === "behavioural";
  return {
    id,
    requirement_ids: [req.id],
    category,
    prompt: behavioural
      ? `Tell me about a time you demonstrated this: "${req.text}". What was the situation, what did you do, and what was the result?`
      : `The role asks for "${req.text}". Walk me through your most relevant experience with it, and a problem it helped you solve.`,
    answer_outline: behavioural
      ? "Situation and stakes; your specific actions; the measurable result; what you would do differently."
      : "A concrete project; your role and decisions; trade-offs you weighed; the outcome and what you learned.",
    difficulty: 2,
    origin: "template",
  };
}
