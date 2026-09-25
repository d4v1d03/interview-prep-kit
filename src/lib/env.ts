import { z } from "zod";

/**
 * Environment is validated lazily (on first use), not at import time, so that
 * `next build` and the batch CLI only fail on variables they actually need.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  /** Comma-separated model chain, most preferred first. */
  GEMINI_MODELS: z.string().min(1).optional(),
  GEMINI_MIN_INTERVAL_MS: z.coerce.number().int().min(0).optional(),
  /** "true" lets the web app fetch private/loopback addresses (never set this in production). */
  ALLOW_PRIVATE_URLS: z.enum(["true", "false"]).optional(),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable ${String(key)} (see .env.example)`);
  }
  return value as NonNullable<Env[K]>;
}

export const isProduction = () => env().NODE_ENV === "production";
