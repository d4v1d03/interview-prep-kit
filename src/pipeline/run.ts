import { z } from "zod";
import { MAX_DAYS, MIN_DAYS } from "@/kit/schedule";
import type { LlmCallLog, LlmClient } from "@/llm/gemini";
import { PipelineError } from "./errors";
import { assembleKit } from "./steps/assemble";
import { writeBrief } from "./steps/brief";
import { closeCoverageGaps } from "./steps/coverage";
import { extractRequirements } from "./steps/extract";
import { generateCategory } from "./steps/questions";
import { research } from "./steps/research";
import { initialState, type PipelineDeps, type PipelineInput, type PipelineState } from "./types";

export type Step = {
  name: string;
  /** Shown to the user while the step runs. */
  label: string;
  run: (state: PipelineState, deps: PipelineDeps) => Promise<PipelineState>;
};

/**
 * The pipeline, in order. Each step reads what earlier steps found and adds to
 * it. The web app runs one step per request and saves the state in between;
 * the batch CLI runs them back to back. Same functions either way.
 */
export const STEPS: Step[] = [
  { name: "extract", label: "Reading the job description", run: extractRequirements },
  { name: "research", label: "Researching the company", run: research },
  { name: "brief", label: "Writing the company brief", run: writeBrief },
  { name: "questions:technical", label: "Writing technical questions", run: generateCategory("technical") },
  { name: "questions:system-design", label: "Writing system design questions", run: generateCategory("system-design") },
  { name: "questions:behavioural", label: "Writing behavioural questions", run: generateCategory("behavioural") },
  { name: "questions:company-fit", label: "Writing company-fit questions", run: generateCategory("company-fit") },
  { name: "coverage", label: "Checking every requirement has a question", run: closeCoverageGaps },
  { name: "assemble", label: "Building the schedule and checking the kit", run: assembleKit },
];

export const pipelineInputSchema = z.object({
  jd: z.string().trim().min(20, "The job description is too short to work with (under 20 characters).").max(50_000),
  companyUrl: z.string().trim().min(1, "A company website is required.").max(2000),
  days: z.number().int().min(MIN_DAYS).max(MAX_DAYS),
});

export function validateInput(input: unknown): PipelineInput {
  const parsed = pipelineInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PipelineError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

/** Runs one step, recording the model calls it made on the state (they end up in the kit's `generation` trail). */
export async function runStep(step: Step, state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const calls: LlmCallLog[] = [];
  const llm: LlmClient = {
    generateJson: (call) => deps.llm.generateJson({ ...call, onLog: (log) => calls.push(log) }),
  };
  const next = await step.run(state, { ...deps, llm });
  return { ...next, llmCalls: [...next.llmCalls, ...calls] };
}

/** Runs the whole pipeline in memory (the batch CLI path). */
export async function runPipeline(
  rawInput: unknown,
  deps: PipelineDeps,
  onStep?: (step: Step, index: number) => void,
): Promise<PipelineState> {
  let state = initialState(validateInput(rawInput));
  for (const [index, step] of STEPS.entries()) {
    onStep?.(step, index);
    state = await runStep(step, state, deps);
  }
  return state;
}
