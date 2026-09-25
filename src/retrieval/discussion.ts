import { RetrievalError, type SkippedSource } from "./errors";
import { Fetcher } from "./fetcher";

export type DiscussionItem = { url: string; title: string; snippet: string; date: string };

export type DiscussionResult = {
  source: "hacker-news";
  query: string;
  items: DiscussionItem[];
  skipped: SkippedSource[];
};

/**
 * Public discussion of the company's interviews, from Hacker News via the
 * Algolia search API (free, keyless, and intended for programmatic use).
 * Reddit, Glassdoor and Google were ruled out: they need OAuth, forbid scraping
 * in their terms, or both.
 *
 * Search engines match loosely, so every hit is re-checked here: the company
 * name must appear as a whole word within a short distance of an interview
 * term. A generic name ("Acme") with no real discussion should come back empty,
 * not with other people's anecdotes.
 */
const INTERVIEW_TERMS = /\b(interview(?:s|ed|ing)?|hiring process|take[- ]home|onsite|on-site|recruiter|coding challenge|system design round)\b/gi;
const PROXIMITY_CHARS = 250;
const MAX_ITEMS = 6;

type AlgoliaHit = {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  created_at: string;
};

export async function searchInterviewDiscussion(
  companyName: string,
  options: { fetcher?: Fetcher; since?: Date } = {},
): Promise<DiscussionResult> {
  const fetcher = options.fetcher ?? new Fetcher({ policy: { allowPrivate: false } });
  const query = `${companyName} interview`;
  const since = Math.floor((options.since ?? new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000)).getTime() / 1000);
  const api = new URL("https://hn.algolia.com/api/v1/search");
  api.searchParams.set("query", query);
  api.searchParams.set("tags", "(story,comment)");
  api.searchParams.set("numericFilters", `created_at_i>${since}`);
  api.searchParams.set("hitsPerPage", "50");

  let hits: AlgoliaHit[];
  try {
    const { text } = await fetcher.fetchText(api, { accept: ["json"], attempts: 3, timeoutMs: 10_000 });
    hits = (JSON.parse(text) as { hits?: AlgoliaHit[] }).hits ?? [];
  } catch (err) {
    const code = err instanceof RetrievalError ? err.code : "NETWORK";
    return { source: "hacker-news", query, items: [], skipped: [{ url: api.toString(), code, reason: (err as Error).message }] };
  }

  const items: DiscussionItem[] = [];
  for (const hit of hits) {
    const title = hit.title ?? hit.story_title ?? "";
    const body = stripHtml(hit.comment_text ?? hit.story_text ?? "");
    const snippet = relevantSnippet(`${title}. ${body}`, companyName);
    if (!snippet) continue;
    items.push({
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      title: title || "Hacker News comment",
      snippet,
      date: hit.created_at.slice(0, 10),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return { source: "hacker-news", query, items, skipped: [] };
}

/** The passage around the first place the company and an interview term appear together, or null. */
export function relevantSnippet(text: string, companyName: string): string | null {
  const name = new RegExp(`\\b${escapeRegExp(companyName)}\\b`, "gi");
  const nameAt = [...text.matchAll(name)].map((m) => m.index!);
  if (nameAt.length === 0) return null;
  for (const term of text.matchAll(INTERVIEW_TERMS)) {
    const at = term.index!;
    if (nameAt.some((n) => Math.abs(n - at) <= PROXIMITY_CHARS)) {
      const from = Math.max(0, Math.min(...nameAt.filter((n) => Math.abs(n - at) <= PROXIMITY_CHARS), at) - 120);
      return text.slice(from, from + 480).replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
