import robotsParser from "robots-parser";
import { RetrievalError, type RetrievalErrorCode } from "./errors";
import { USER_AGENT_TOKEN, type Fetcher } from "./fetcher";

export type RobotsRules = {
  isAllowed(url: URL): boolean;
  crawlDelayMs: number | undefined;
  sitemaps: string[];
  /** Human-readable note when robots.txt shaped the crawl, for the kit's honesty trail. */
  note?: string;
  /** Set when robots.txt itself could not be fetched, so the caller can report the real cause. */
  failure?: { code: RetrievalErrorCode; reason: string };
};

const ALLOW_ALL: RobotsRules = { isAllowed: () => true, crawlDelayMs: undefined, sitemaps: [] };

/**
 * Follows RFC 9309: a 4xx means "no rules", so crawl; a 5xx or an unreachable
 * robots.txt means "assume everything is disallowed". A site that answers
 * /robots.txt with its HTML app shell parses to no rules, which is also correct.
 */
export async function loadRobots(fetcher: Fetcher, site: URL): Promise<RobotsRules> {
  const robotsUrl = new URL("/robots.txt", site.origin).toString();
  try {
    const { text } = await fetcher.fetchText(robotsUrl, { accept: ["text", "html"], attempts: 2, maxBytes: 500_000 });
    const robots = robotsParser(robotsUrl, text);
    const delay = robots.getCrawlDelay(USER_AGENT_TOKEN);
    return {
      isAllowed: (url) => robots.isAllowed(url.toString(), USER_AGENT_TOKEN) !== false,
      crawlDelayMs: delay ? delay * 1000 : undefined,
      sitemaps: robots.getSitemaps(),
    };
  } catch (err) {
    if (err instanceof RetrievalError) {
      if (err.code === "HTTP_ERROR" && err.status !== undefined && err.status < 500) return ALLOW_ALL;
      if (err.code === "UNSUPPORTED_CONTENT") return ALLOW_ALL;
    }
    const reason = (err as Error).message;
    return {
      isAllowed: () => false,
      crawlDelayMs: undefined,
      sitemaps: [],
      note: `robots.txt could not be read (${reason}); treating the site as off-limits.`,
      failure: { code: err instanceof RetrievalError ? err.code : "NETWORK", reason },
    };
  }
}
