import { backoffDelay, parseRetryAfter, sleep } from "@/lib/backoff";
import { RetrievalError } from "./errors";
import { assertUrlAllowed, type UrlPolicy } from "./url-guard";

export const USER_AGENT_TOKEN = "InterviewPrepKitBot";
const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+interview preparation research; respects robots.txt)`;

/** Content we are prepared to handle; anything else is refused before the body is read. */
const CONTENT_TYPES = {
  html: ["text/html", "application/xhtml+xml"],
  text: ["text/plain"],
  xml: ["application/xml", "text/xml"],
  json: ["application/json"],
} as const;
export type ContentKind = keyof typeof CONTENT_TYPES;

export type FetchOptions = {
  accept: ContentKind[];
  /** Total attempts including the first. */
  attempts?: number;
  maxBytes?: number;
  timeoutMs?: number;
};

export type FetchedText = { url: string; status: number; contentType: string; text: string };

export type FetcherConfig = {
  policy: UrlPolicy;
  /** Minimum gap between two requests to the same host (politeness / rate limiting). */
  minGapMs?: number;
  /** Test seam; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

const MAX_REDIRECTS = 5;

/**
 * One fetcher per crawl. It owns the per-host rate limit, so every request made
 * during a crawl — pages, robots.txt, sitemaps — shares the same politeness budget.
 */
export class Fetcher {
  private readonly lastRequestAt = new Map<string, number>();
  private readonly hostGapMs = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: FetcherConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Honour a robots.txt Crawl-delay for a host (capped so one site cannot stall a run). */
  setHostDelay(host: string, ms: number) {
    this.hostGapMs.set(host, Math.min(ms, 5000));
  }

  async fetchText(input: string | URL, opts: FetchOptions): Promise<FetchedText> {
    const attempts = opts.attempts ?? 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.fetchOnce(new URL(input), opts);
      } catch (err) {
        const error = toRetrievalError(err);
        if (!error.retryable || attempt >= attempts) throw error;
        await sleep(backoffDelay(attempt, { baseMs: 500, maxMs: 8000, retryAfterMs: retryAfterOf(err) }));
      }
    }
  }

  private async fetchOnce(start: URL, opts: FetchOptions): Promise<FetchedText> {
    const timeoutMs = opts.timeoutMs ?? 8000;
    const maxBytes = opts.maxBytes ?? 5_000_000;
    const signal = AbortSignal.timeout(timeoutMs);
    let url = start;

    // Redirects are followed by hand so every hop passes the URL guard again.
    for (let hop = 0; ; hop++) {
      await assertUrlAllowed(url, this.config.policy);
      await this.throttle(url.host);

      const res = await this.fetchImpl(url, {
        redirect: "manual",
        signal,
        headers: { "user-agent": USER_AGENT, accept: acceptHeader(opts.accept) },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel();
        if (hop >= MAX_REDIRECTS) throw new RetrievalError("TOO_MANY_REDIRECTS", `Too many redirects from ${start}.`);
        url = new URL(res.headers.get("location")!, url);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw Object.assign(new RetrievalError("HTTP_ERROR", `${url} returned HTTP ${res.status}.`, res.status), {
          retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        });
      }

      const contentType = res.headers.get("content-type") ?? "";
      const mime = contentType.split(";")[0].trim().toLowerCase();
      const allowed = opts.accept.flatMap((kind) => CONTENT_TYPES[kind] as readonly string[]);
      if (!allowed.includes(mime)) {
        await res.body?.cancel();
        throw new RetrievalError("UNSUPPORTED_CONTENT", `${url} is ${mime || "an unknown type"}, not ${opts.accept.join("/")}.`);
      }

      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel();
        throw new RetrievalError("TOO_LARGE", `${url} is larger than ${maxBytes} bytes.`);
      }
      const bytes = await readCapped(res, maxBytes, url);
      return { url: url.toString(), status: res.status, contentType, text: decode(bytes, contentType) };
    }
  }

  private async throttle(host: string) {
    const gap = this.hostGapMs.get(host) ?? this.config.minGapMs ?? 250;
    const wait = (this.lastRequestAt.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt.set(host, Date.now());
  }
}

/** Reads the body while counting bytes, so a server that lies about (or omits) Content-Length is still capped. */
async function readCapped(res: Response, maxBytes: number, url: URL): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RetrievalError("TOO_LARGE", `${url} is larger than ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function acceptHeader(kinds: ContentKind[]): string {
  return kinds.flatMap((kind) => CONTENT_TYPES[kind]).join(", ");
}

function retryAfterOf(err: unknown): number | undefined {
  return (err as { retryAfterMs?: number }).retryAfterMs;
}

function toRetrievalError(err: unknown): RetrievalError {
  if (err instanceof RetrievalError) return err;
  const name = (err as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError") return new RetrievalError("TIMEOUT", "The request timed out.");
  // fetch() reports every socket failure as "fetch failed"; the useful code is on `cause`.
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new RetrievalError("DNS_FAILED", "The host name could not be resolved.");
  return new RetrievalError("NETWORK", code ? `Connection failed (${code}).` : ((err as Error)?.message ?? "Network error."));
}
