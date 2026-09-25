export type RetrievalErrorCode =
  | "INVALID_URL"
  | "BLOCKED_URL"
  | "DNS_FAILED"
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP_ERROR"
  | "UNSUPPORTED_CONTENT"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "ROBOTS_DISALLOWED"
  | "EMPTY_PAGE";

/** A retrieval failure with a machine-readable code, so callers can record and report it. */
export class RetrievalError extends Error {
  constructor(
    readonly code: RetrievalErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RetrievalError";
  }

  /** Worth another attempt: transient network trouble, rate limiting, or a server-side error. */
  get retryable(): boolean {
    if (this.code === "TIMEOUT" || this.code === "NETWORK") return true;
    return this.code === "HTTP_ERROR" && (this.status === 429 || (this.status ?? 0) >= 500);
  }
}

/** A source that was skipped, kept so the kit can say honestly what could not be read. */
export type SkippedSource = { url: string; code: RetrievalErrorCode; reason: string };
