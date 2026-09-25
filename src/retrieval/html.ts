import * as cheerio from "cheerio";

export type PageLink = { url: string; text: string };

export type CleanPage = {
  title: string;
  siteName: string | null;
  description: string | null;
  /** Readable main-content text with "## " heading markers; untrusted, never instructions. */
  text: string;
  links: PageLink[];
};

const HIDDEN = [
  "[hidden]",
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
].join(",");
const NEVER_CONTENT = "script,style,noscript,template,svg,canvas,iframe,object,embed,head";
const PAGE_CHROME = "nav,header,footer,aside,form,button,[role=navigation],[role=banner],[role=contentinfo]";
const BLOCKS = "p,li,dt,dd,tr,blockquote,pre,section,article,div,br,h1,h2,h3,h4,h5,h6";

export function cleanHtml(html: string, pageUrl: string, maxChars = 12_000): CleanPage {
  const $ = cheerio.load(html);
  const base = resolveBase($("base[href]").attr("href"), pageUrl);

  const title = collapse($("title").first().text()) || collapse($("h1").first().text());
  const siteName = $('meta[property="og:site_name"]').attr("content")?.trim() || null;
  const description =
    ($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content"))?.trim() ||
    null;

  // 1. Content a visitor cannot see is dropped before anything else reads the page:
  //    hidden text is where injected instructions like to live.
  $(HIDDEN).remove();
  $(NEVER_CONTENT).remove();

  // 2. Links come from the whole page — careers links often live only in the footer.
  const links = extractLinks($, base);

  // 3. Text comes from the main content, without navigation chrome.
  $(PAGE_CHROME).remove();
  const main = $("main, [role=main], article").first();
  const root = main.length && collapse(main.text()).length > 200 ? main : $("body");
  root.find("h1,h2,h3,h4,h5,h6").each((_, el) => {
    $(el).prepend("\n## ");
  });
  root.find(BLOCKS).each((_, el) => {
    $(el).append("\n");
  });

  return { title, siteName, description, text: normaliseText(root.text()).slice(0, maxChars), links };
}

function extractLinks($: cheerio.CheerioAPI, base: URL): PageLink[] {
  const byUrl = new Map<string, string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim() ?? "";
    if (!href || /^(javascript|mailto|tel|data):/i.test(href) || href.startsWith("#")) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";
    const text = collapse($(el).text() || $(el).attr("aria-label") || $(el).attr("title") || "").slice(0, 120);
    const key = url.toString();
    const existing = byUrl.get(key);
    if (existing === undefined || text.length > existing.length) byUrl.set(key, text);
  });
  return [...byUrl].map(([url, text]) => ({ url, text }));
}

function resolveBase(baseHref: string | undefined, pageUrl: string): URL {
  try {
    return new URL(baseHref ?? pageUrl, pageUrl);
  } catch {
    return new URL(pageUrl);
  }
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function normaliseText(s: string): string {
  return s
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
