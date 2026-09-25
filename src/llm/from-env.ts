import { env, requireEnv } from "@/lib/env";
import { GeminiClient, type LlmCallLog } from "./gemini";

/** The one place model configuration is read, shared by the web app and the batch CLI. */
export function createLlmFromEnv(onCall?: (log: LlmCallLog) => void): GeminiClient {
  const e = env();
  return new GeminiClient({
    apiKey: requireEnv("GEMINI_API_KEY"),
    models: e.GEMINI_MODELS?.split(",").map((m) => m.trim()).filter(Boolean),
    minIntervalMs: e.GEMINI_MIN_INTERVAL_MS,
    onCall,
  });
}
