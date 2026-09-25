/**
 * Deterministic link ranking. A candidate link is scored from the words in its
 * URL path and anchor text against two vocabularies — "how they hire" and "what
 * they do" — so no path is hard-coded: /careers, /jobs, /handbook/hiring/interviewing
 * and a footer link reading "We're hiring!" all score, wherever they live.
 */

export type LinkKind = "hiring" | "about" | "other";
export type RankedLink = { url: string; text: string; score: number; kind: LinkKind };

type Vocabulary = Record<string, number>;

const HIRING: Vocabulary = {
  "how we hire": 14,
  "hiring process": 14,
  "interview process": 14,
  interviewing: 12,
  interview: 12,
  interviews: 12,
  hiring: 10,
  careers: 10,
  career: 10,
  jobs: 9,
  "join us": 9,
  "join the team": 9,
  "work with us": 9,
  "open roles": 9,
  "open positions": 9,
  recruiting: 8,
  recruitment: 8,
  join: 5,
  handbook: 5,
  talent: 4,
  "life at": 4,
  people: 3,
  benefits: 2,
};

const ABOUT: Vocabulary = {
  "about us": 10,
  about: 9,
  "what we do": 9,
  "who we are": 9,
  company: 7,
  mission: 7,
  story: 5,
  values: 5,
  culture: 5,
  product: 5,
  products: 5,
  platform: 4,
  solutions: 4,
  customers: 4,
  team: 3,
  engineering: 3,
  pricing: 1,
};

const PENALTIES: Vocabulary = {
  login: -20,
  "log in": -20,
  signin: -20,
  "sign in": -20,
  signup: -15,
  "sign up": -15,
  register: -15,
  account: -10,
  cart: -20,
  checkout: -20,
  privacy: -15,
  terms: -15,
  legal: -12,
  cookie: -12,
  cookies: -12,
  gdpr: -12,
  status: -6,
  download: -6,
  "press kit": -6,
};

const NON_PAGE_EXTENSION = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|mp4|mp3|mov|xml|json|css|js|txt|rss|atom)$/i;
// Source-code viewers (e.g. an "edit this page" link into the company's own Git host).
const SOURCE_VIEW = /\/(?:-\/)?(?:blob|tree|raw|edit|commits?|blame)\//i;
const LOCALE_SEGMENT = /^\/(?!en(?:-[a-z]{2})?\/)[a-z]{2}(?:-[a-z]{2})?\//i;

/** Words of a string, space-padded so phrase lookups match whole words only. */
function words(s: string): string {
  const tokens = s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return ` ${tokens.join(" ")} `;
}

function vocabularyScore(haystack: string, vocab: Vocabulary): number {
  let score = 0;
  for (const [phrase, weight] of Object.entries(vocab)) {
    if (haystack.includes(` ${phrase} `)) score += weight;
  }
  return score;
}

export function scoreLink(url: URL, anchorText: string): { score: number; kind: LinkKind } {
  if (NON_PAGE_EXTENSION.test(url.pathname)) return { score: -100, kind: "other" };
  if (SOURCE_VIEW.test(url.pathname)) return { score: -100, kind: "other" };

  const haystack = words(`${url.pathname} ${anchorText}`);
  const hiring = vocabularyScore(haystack, HIRING);
  const about = vocabularyScore(haystack, ABOUT);
  const kind: LinkKind = hiring === 0 && about === 0 ? "other" : hiring >= about ? "hiring" : "about";

  let score = Math.max(hiring, about) + Math.min(hiring, about) / 4 + vocabularyScore(haystack, PENALTIES);
  const depth = url.pathname.split("/").filter(Boolean).length;
  if (depth > 2) score -= depth - 2; // prefer section pages over deep leaf pages
  if (url.search) score -= 2;
  if (LOCALE_SEGMENT.test(url.pathname)) score -= 6; // translated copies of pages we can read in English
  return { score, kind };
}

/** Hosting platforms where the registrable domain is shared by unrelated sites. */
const SHARED_HOSTING = /\.(github\.io|gitlab\.io|vercel\.app|netlify\.app|pages\.dev|web\.app|firebaseapp\.com|herokuapp\.com|azurewebsites\.net|cloudfront\.net|notion\.site|webflow\.io|framer\.(app|website)|wixsite\.com|squarespace\.com|substack\.com|medium\.com|blogspot\.com|wordpress\.com)$/i;

/** "about.gitlab.com" → "gitlab.com"; "jobs.acme.co.uk" → "acme.co.uk". Null for IPs and localhost. */
export function registrableDomain(hostname: string): string | null {
  if (!hostname.includes(".") || /^[\d.]+$/.test(hostname) || hostname.includes(":")) return null;
  const labels = hostname.split(".");
  const genericSecondLevel = labels.length > 2 && /^(co|com|org|net|ac|gov|edu)$/.test(labels[labels.length - 2]);
  return labels.slice(genericSecondLevel ? -3 : -2).join(".");
}

/**
 * The crawl stays inside the company's own site. For a site at the root of its
 * domain that means any host under the same registrable domain — GitLab's
 * interview guide lives on handbook.gitlab.com, not about.gitlab.com — except
 * on shared hosting (*.github.io etc.), where it means the exact host only.
 * When the start URL has a path, the crawl also stays under that path: several
 * companies may share one host (http://localhost:8099/acme/ must not wander
 * into /globex/).
 */
export function makeScope(start: URL): (url: URL) => boolean {
  const bareHost = (h: string) => h.replace(/^www\./, "");
  const startHost = bareHost(start.hostname);
  const prefix = start.pathname.endsWith("/") ? start.pathname : start.pathname.replace(/[^/]*$/, "");
  const domain = prefix === "/" && !SHARED_HOSTING.test(startHost) ? registrableDomain(startHost) : null;
  return (url) => {
    if (url.protocol !== start.protocol && !(start.protocol === "http:" && url.protocol === "https:")) return false;
    if (url.port !== start.port) return false;
    const host = bareHost(url.hostname);
    const sameSite = host === startHost || (domain !== null && (host === domain || host.endsWith(`.${domain}`)));
    return sameSite && url.pathname.startsWith(prefix);
  };
}

/** Canonical form used to avoid fetching the same page twice (/about vs /about/ vs /about#team). */
export function canonicalKey(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.hostname.replace(/^www\./, "")}:${url.port}${path}${url.search}`;
}
