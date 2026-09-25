import { LlmError } from "@/llm/gemini";

export type PipelineErrorCode =
  | "INVALID_INPUT"
  | "KIT_INVALID"
  | "LLM_AUTH"
  | "LLM_RATE_LIMITED"
  | "LLM_UNAVAILABLE"
  | "LLM_INVALID_OUTPUT"
  | "LLM_BLOCKED"
  | "INTERNAL";

export class PipelineError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

/** Any failure, as the `{ code, message }` shape used by the batch output and the API. */
export function toPipelineError(err: unknown): PipelineError {
  if (err instanceof PipelineError) return err;
  if (err instanceof LlmError) return new PipelineError(err.code, err.message);
  return new PipelineError("INTERNAL", (err as Error)?.message ?? "Unknown error.");
}
