import type { Kit } from "@/kit/schema";
import type { PipelineState } from "./types";

/**
 * What a finished pipeline leaves behind besides the kit itself: the crawl,
 * the extraction, the brief with its hiring process, the category plan and the
 * id counters. Stored with the kit so one section can be regenerated later
 * without crawling or extracting again.
 */
export type KitContext = Pick<PipelineState, "input" | "research" | "role" | "brief" | "plan" | "warnings" | "nextId">;

export function contextFromState(state: PipelineState): KitContext {
  const { input, research, role, brief, plan, warnings, nextId } = state;
  return { input, research, role, brief, plan, warnings, nextId };
}

/** Rebuilds pipeline state from a saved kit and its context, so pipeline steps can run against it again. */
export function stateFromKit(kit: Kit, context: KitContext): PipelineState {
  return {
    ...context,
    questions: kit.questions,
    flashcards: kit.flashcards,
    coverage: kit.coverage.history ?? [],
    llmCalls: [],
    kit,
  };
}
