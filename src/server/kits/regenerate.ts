import "server-only";
import { appendQuestions, nextId, replaceCategory } from "@/kit/edit";
import { QUESTION_CATEGORIES, validateKit, type Kit, type QuestionCategory } from "@/kit/schema";
import { stateFromKit, type KitContext } from "@/pipeline/context";
import { PipelineError } from "@/pipeline/errors";
import type { Step } from "@/pipeline/run";
import { writeBrief } from "@/pipeline/steps/brief";
import { closeCoverageGaps } from "@/pipeline/steps/coverage";
import { generateCategory } from "@/pipeline/steps/questions";
import type { PipelineState } from "@/pipeline/types";
import { applyToLatestKit } from "./repository";

/**
 * Regenerating one section is a one-step job that reuses the pipeline step
 * that made the section in the first place — with the saved research, so
 * nothing is crawled again. The result is merged into the latest saved kit
 * (applyToLatestKit), never written over it, and must pass validation.
 */

export type Section = { kind: "brief" } | { kind: "questions"; category: QuestionCategory } | { kind: "gaps" };

type RegenState = PipelineState & { regenFrom: number };

const num = (id: string) => Number(id.slice(1));
/** Questions this job created: ids at or above the first id it was allowed to use. */
const created = (state: RegenState) => state.questions.filter((q) => num(q.id) >= state.regenFrom);

function save(kitId: string, change: (kit: Kit) => Kit) {
  return applyToLatestKit(kitId, (kit) => {
    const next = change(kit);
    const result = validateKit(next);
    if (!result.ok) throw new PipelineError("KIT_INVALID", `Regenerated kit failed validation: ${result.issues[0].path} ${result.issues[0].message}`);
    return result.kit;
  });
}

const step = (name: string, label: string, run: Step["run"]): Step => ({ name, label, run });

export const REGENERATE_KINDS = {
  "regenerate:brief": {
    steps: [step("brief", "Rewriting the company brief", writeBrief)],
    finish: async (job: { kitId: string }, state: PipelineState) => {
      const brief = state.brief!;
      await save(job.kitId, (kit) => ({
        ...kit,
        company_brief: { summary: brief.summary, what_they_do: brief.what_they_do, sources: brief.sources },
        research: kit.research ? { ...kit.research, hiring_process: brief.hiring_process } : kit.research,
      }));
    },
  },
  "regenerate:gaps": {
    steps: [step("coverage", "Writing questions for uncovered requirements", closeCoverageGaps)],
    finish: async (job: { kitId: string }, state: PipelineState) => {
      const s = state as RegenState;
      await save(job.kitId, (kit) => {
        const next = appendQuestions(kit, created(s));
        return { ...next, coverage: { ...next.coverage, passes: s.coverage.length, history: s.coverage } };
      });
    },
  },
  ...Object.fromEntries(
    QUESTION_CATEGORIES.map((category) => [
      `regenerate:questions:${category}`,
      {
        steps: [step(`questions:${category}`, `Rewriting ${category} questions`, generateCategory(category))],
        finish: async (job: { kitId: string }, state: PipelineState) => {
          await save(job.kitId, (kit) => replaceCategory(kit, category, created(state as RegenState)));
        },
      },
    ]),
  ),
};

/** The job name and starting state for regenerating a section of this kit. */
export function regenerationJob(section: Section, kit: Kit, context: KitContext): { kind: string; state: RegenState } {
  const base = stateFromKit(kit, context);
  const regenFrom = num(nextId(kit.questions, "q"));
  const state: RegenState = {
    ...base,
    // The saved kit is the truth: requirements as they are now, ids continuing after the highest in use.
    role: { ...base.role!, requirements: kit.role.requirements },
    nextId: { question: regenFrom, flashcard: num(nextId(kit.flashcards, "f")) },
    regenFrom,
    warnings: [],
  };

  if (section.kind === "questions") {
    const { category } = section;
    // The model sees the questions being kept (so it does not repeat them); the replaceable ones are dropped.
    state.questions = kit.questions.filter((q) => q.category !== category || q.origin === "user" || q.edited || q.pinned);
    state.plan = [...new Set([...(state.plan ?? []), category])];
    return { kind: `regenerate:questions:${category}`, state };
  }
  if (section.kind === "gaps") return { kind: "regenerate:gaps", state: { ...state, coverage: kit.coverage.history ?? [] } };
  return { kind: "regenerate:brief", state };
}
