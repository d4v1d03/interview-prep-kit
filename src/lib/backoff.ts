export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with full jitter: attempt 1 waits up to base, attempt 2 up
 * to 2×base, and so on, capped. A server-supplied Retry-After always wins, since
 * the provider knows its own window better than we do.
 */
export function backoffDelay(attempt: number, opts: { baseMs: number; maxMs: number; retryAfterMs?: number }): number {
  if (opts.retryAfterMs !== undefined) return Math.min(opts.retryAfterMs, opts.maxMs);
  const ceiling = Math.min(opts.maxMs, opts.baseMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/** Parses an HTTP Retry-After header (delta-seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
