import { RetrievalError, type SkippedSource } from "./errors";
import { Fetcher } from "./fetcher";
import { cleanHtml, type PageLink } from "./html";
import { canonicalKey, makeScope, scoreLink, type LinkKind } from "./ranking";
import { loadRobots, type RobotsRules } from "./robots";
import { guessCompanyName } from "./company-name";
import { parseCompanyUrl, type UrlPolicy } from "./url-guard";

export type PageKind = "home" | LinkKind;

export type CrawledPage = {
  url: string;
  title: string;
  kind: PageKind;
  description: string | null;
  text: string;
  /** Interview-process signals found in the page text, e.g. "take-home", "system design". */
  hiringSignals: string[];
};

export type CrawlResult = {
  startUrl: string;
  /** False when the homepage itself could not be read; the kit must then say so. */
  reachable: boolean;
  companyName: string;
  pages: CrawledPage[];
  skipped: SkippedSource[];
  notes: string[];
};

export type CrawlOptions = {
  policy: UrlPolicy;
  maxPages?: number;
  /** Wall-clock budget; the crawl returns what it has when this runs out. */
  budgetMs?: number;
  fetcher?: Fetcher;
};

type Candidate = { url: URL; text: string; score: number; kind: LinkKind; depth: number };

const MIN_SCORE = 4;
const MAX_DEPTH = 3;
const MAX_PER_SECTION = 2;
const MAX_SITEMAP_URLS = 3000;
const MIN_PAGE_CHARS = 150;

/** Phrases that mark a page as describing how the company interviews, not just listing jobs. */
const HIRING_SIGNALS: Record<string, RegExp> = {
  "take-home": /\btake[- ]home\b/i,
  "system design": /\bsystem[- ]design\b/i,
  "pair programming": /\bpair(?:ing)?[- ]programming\b|\bpairing (?:session|exercise|interview)\b/i,
  "live coding": /\blive[- ]coding\b|\bcoding (?:interview|exercise|challenge)\b/i,
  "technical interview": /\btechnical (?:interview|screen|round)\b/i,
  "behavioural interview": /\bbehaviou?ral (?:interview|round|questions)\b/i,
  "recruiter screen": /\brecruiter (?:call|screen|chat)\b|\bphone screen\b|\bintro(?:ductory)? call\b/i,
  onsite: /\bon-?site\b|\bfinal round\b|\bsuper ?day\b/i,
  "hiring manager": /\bhiring manager\b/i,
  "interview process": /\binterview(?:ing)? process\b|\bhow we hire\b|\bhiring process\b/i,
  "paid trial": /\bpaid (?:trial|work trial|project)\b|\bwork trial\b/i,
};

const HIRING_WORDS = /\b(hir(e|es|ing)|careers?|jobs?|interview\w*|recruit\w*|open (roles|positions)|apply)\b/i;

export async function crawlCompanySite(input: string, options: CrawlOptions): Promise<CrawlResult> {
  const started = Date.now();
  const maxPages = options.maxPages ?? 8;
  const budgetMs = options.budgetMs ?? 45_000;
  const fetcher = options.fetcher ?? new Fetcher({ policy: options.policy });
  const skipped: SkippedSource[] = [];
  const notes: string[] = [];

  let start: URL;
  try {
    start = parseCompanyUrl(input);
  } catch (err) {
    return unreachable(input, input, [skip(input, err)], notes);
  }

  const robots = await loadRobots(fetcher, start);
  if (robots.note) notes.push(robots.note);
  if (robots.crawlDelayMs) fetcher.setHostDelay(start.host, robots.crawlDelayMs);
  if (!robots.isAllowed(start)) {
    // If robots.txt could not be fetched at all, the site is down — say that, not "we were disallowed".
    const cause: SkippedSource = robots.failure
      ? { url: start.toString(), code: robots.failure.code, reason: `Company site unreachable: ${robots.failure.reason}` }
      : { url: start.toString(), code: "ROBOTS_DISALLOWED", reason: "robots.txt does not allow fetching the homepage." };
    return unreachable(start.toString(), guessCompanyName(start, null, ""), [cause], notes);
  }

  // Homepage: the one fetch the crawl cannot do without, so it gets the most retries.
  let home;
  try {
    home = await fetcher.fetchText(start, { accept: ["html"], attempts: 3 });
  } catch (err) {
    return unreachable(start.toString(), guessCompanyName(start, null, ""), [skip(start.toString(), err)], notes);
  }
  const homePage = cleanHtml(home.text, home.url);
  const finalUrl = new URL(home.url);
  const inScope = orScopes(makeScope(start), makeScope(finalUrl));

  const pages: CrawledPage[] = [toPage(home.url, homePage, "home")];
  const visited = new Set([canonicalKey(start), canonicalKey(finalUrl)]);
  const frontier = new Map<string, Candidate>();
  const addLinks = (links: PageLink[], depth: number) => {
    for (const link of links) addCandidate(frontier, visited, inScope, link, depth);
  };
  addLinks(homePage.links, 1);
  addLinks(await sitemapLinks(fetcher, finalUrl, robots, skipped), 2);

  const fetchedPerSection = new Map<string, number>();
  while (pages.length < maxPages) {
    if (Date.now() - started > budgetMs) {
      notes.push(`Crawl stopped after ${pages.length} pages: time budget reached.`);
      break;
    }
    const next = pickNext(frontier, pages, fetchedPerSection);
    if (!next) break;
    frontier.delete(canonicalKey(next.url));
    visited.add(canonicalKey(next.url));

    if (!robots.isAllowed(next.url)) {
      skipped.push({ url: next.url.toString(), code: "ROBOTS_DISALLOWED", reason: "Disallowed by robots.txt." });
      continue;
    }
    try {
      const res = await fetcher.fetchText(next.url, { accept: ["html"], attempts: 2 });
      const finalKey = canonicalKey(new URL(res.url));
      if (finalKey !== canonicalKey(next.url) && visited.has(finalKey)) continue; // redirected to a page we already have
      visited.add(finalKey);
      const page = cleanHtml(res.text, res.url);
      if (page.text.length < MIN_PAGE_CHARS) {
        // Usually a JavaScript-rendered shell. Reported, and it does not use up a page slot.
        skipped.push({ url: res.url, code: "EMPTY_PAGE", reason: "No readable text (the page is probably rendered by JavaScript)." });
        continue;
      }
      pages.push(toPage(res.url, page, next.kind));
      const section = sectionOf(next.url);
      fetchedPerSection.set(section, (fetchedPerSection.get(section) ?? 0) + 1);
      if (next.depth < MAX_DEPTH) addLinks(page.links, next.depth + 1);
    } catch (err) {
      skipped.push(skip(next.url.toString(), err));
    }
  }

  if (!pages.some((p) => p.kind === "hiring")) notes.push("No hiring or careers page was found on the company site.");
  if (!pages.some((p) => p.kind === "about")) notes.push("No about or company page was found beyond the homepage.");

  return {
    startUrl: start.toString(),
    reachable: true,
    companyName: guessCompanyName(finalUrl, homePage.siteName, homePage.title),
    pages,
    skipped,
    notes,
  };
}

function addCandidate(
  frontier: Map<string, Candidate>,
  visited: Set<string>,
  inScope: (url: URL) => boolean,
  link: PageLink,
  depth: number,
) {
  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    return;
  }
  const key = canonicalKey(url);
  if (visited.has(key) || !inScope(url)) return;
  const { score, kind } = scoreLink(url, link.text);
  const existing = frontier.get(key);
  if (!existing || score > existing.score) frontier.set(key, { url, text: link.text, score, kind, depth });
}

/**
 * Alternates between the two things we need to learn — how they hire and what
 * they do — so a site with forty job postings cannot use up the whole budget
 * before we read its about page. Within a kind, the highest score wins, and no
 * more than two pages are taken from one section (e.g. /jobs/*).
 */
function pickNext(
  frontier: Map<string, Candidate>,
  pages: CrawledPage[],
  perSection: Map<string, number>,
): Candidate | undefined {
  const eligible = [...frontier.values()].filter(
    (c) => c.score >= MIN_SCORE && (perSection.get(sectionOf(c.url)) ?? 0) < MAX_PER_SECTION,
  );
  if (eligible.length === 0) return undefined;
  const count = (kind: PageKind) => pages.filter((p) => p.kind === kind).length;
  const wanted: LinkKind = count("hiring") <= count("about") ? "hiring" : "about";
  const best = (list: Candidate[]) => list.sort((a, b) => b.score - a.score || a.depth - b.depth)[0];
  return best(eligible.filter((c) => c.kind === wanted)) ?? best(eligible);
}

/** A page's section is its parent path, so /jobs/a and /jobs/b share one. */
function sectionOf(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length <= 1 ? "/" : `/${parts.slice(0, -1).join("/")}`;
}

/**
 * Sitemaps expose pages the navigation never links to — which is exactly where
 * handbooks and "how we hire" pages tend to be buried. Best effort: a missing
 * or oversized sitemap is not an error worth reporting.
 */
async function sitemapLinks(fetcher: Fetcher, site: URL, robots: RobotsRules, skipped: SkippedSource[]): Promise<PageLink[]> {
  const queue = robots.sitemaps.length ? robots.sitemaps.slice(0, 2) : [new URL("sitemap.xml", site).toString()];
  const links: PageLink[] = [];
  let fetched = 0;
  while (queue.length && fetched < 3 && links.length < MAX_SITEMAP_URLS) {
    const url = queue.shift()!;
    fetched++;
    try {
      const { text } = await fetcher.fetchText(url, { accept: ["xml", "text"], attempts: 1, maxBytes: 5_000_000 });
      const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
      if (/<sitemapindex/i.test(text)) queue.push(...locs.filter((l) => /hir|career|job|about|company|handbook/i.test(l)).slice(0, 2));
      else links.push(...locs.slice(0, MAX_SITEMAP_URLS).map((loc) => ({ url: loc, text: "" })));
    } catch (err) {
      if (robots.sitemaps.includes(url)) skipped.push(skip(url, err));
    }
  }
  return links;
}

function toPage(url: string, page: ReturnType<typeof cleanHtml>, kind: PageKind): CrawledPage {
  const haystack = `${page.title}\n${page.text}`;
  const hiringSignals = Object.entries(HIRING_SIGNALS)
    .filter(([, re]) => re.test(haystack))
    .map(([name]) => name);
  // The link's words are only a guess; the page's own text settles it. A page that walks
  // through an interview process is a hiring page whatever its URL, and a "hiring" link
  // whose page never mentions hiring (a /people/ merch store, say) is not.
  let effectiveKind: PageKind = kind;
  if (kind !== "home" && hiringSignals.length >= 3) effectiveKind = "hiring";
  else if (kind === "hiring" && hiringSignals.length === 0 && !HIRING_WORDS.test(`${page.title}\n${page.text.slice(0, 4000)}`)) {
    effectiveKind = "other";
  }
  return { url, title: page.title, kind: effectiveKind, description: page.description, text: page.text, hiringSignals };
}

function orScopes(a: (u: URL) => boolean, b: (u: URL) => boolean) {
  return (url: URL) => a(url) || b(url);
}

function skip(url: string, err: unknown): SkippedSource {
  if (err instanceof RetrievalError) return { url, code: err.code, reason: err.message };
  return { url, code: "NETWORK", reason: (err as Error)?.message ?? "Unknown error." };
}

function unreachable(startUrl: string, companyName: string, skipped: SkippedSource[], notes: string[]): CrawlResult {
  return { startUrl, reachable: false, companyName, pages: [], skipped, notes };
}
