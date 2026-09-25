import { LlmError, untrusted } from "@/llm/gemini";
import type { CrawledPage } from "@/retrieval/crawler";
import { planCategories } from "../plan";
import { BRIEF_SYSTEM, briefSchema } from "../prompts";
import type { CompanyBrief, PipelineDeps, PipelineState } from "../types";

const PAGE_CHARS = 5000;
const TOTAL_CHARS = 22_000;
const KIND_ORDER = ["home", "about", "hiring", "other"] as const;

/**
 * Step 3 — the company brief, written only from pages we actually fetched.
 * If the site could not be read there is nothing to summarise, so no model
 * call is made and the brief says plainly that research was unavailable.
 * Ends by planning which question categories the kit needs.
 */
export async function writeBrief(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const { crawl, discussion } = state.research!;
  const company = state.role?.company ?? crawl.companyName;
  const warnings = [...state.warnings];
  let brief: CompanyBrief;

  if (!crawl.reachable || crawl.pages.length === 0) {
    brief = {
      summary: `No company research is available for ${company}: ${crawl.skipped[0]?.reason ?? "the website could not be read."} Everything in this kit is based on the job description alone.`,
      what_they_do: "Unknown — the company website could not be retrieved, so this kit makes no claims about what the company does.",
      sources: [],
      hiring_process: null,
    };
  } else {
    const pages = selectPages(crawl.pages);
    const pageBlocks = pages.map((p) => untrusted("company_page", `URL: ${p.url}\nTITLE: ${p.title}\n\n${p.text}`)).join("\n\n");
    const discussionBlock = discussion.items.length
      ? untrusted(
          "public_discussion",
          discussion.items.map((d) => `URL: ${d.url}\nDATE: ${d.date}\n${d.snippet}`).join("\n\n"),
        )
      : "No public discussion of this company's interviews was found.";

    let out;
    try {
      out = await deps.llm.generateJson({
        name: "company-brief",
        system: BRIEF_SYSTEM,
        prompt: `Company: ${company}\nRole being prepared for: ${state.role?.title ?? "unknown"}\n\nPages from the company website:\n\n${pageBlocks}\n\nPublic discussion:\n${discussionBlock}`,
        schema: briefSchema,
        temperature: 0.2,
      });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      // The research still happened; show what the site says about itself rather than failing the kit.
      warnings.push(`The company brief could not be written (${err.message}); it shows the site's own description instead.`);
      const next = { ...state, warnings, brief: selfDescribedBrief(company, pages) };
      return { ...next, plan: planCategories(next) };
    }

    // Sources must be pages we actually gave the model; anything else is dropped.
    const known = new Set([...pages.map((p) => p.url), ...discussion.items.map((d) => d.url)]);
    const sources = out.sources.filter((u) => known.has(u));
    let hiring = out.hiring_process;
    if (hiring) {
      const hiringSources = hiring.sources.filter((u) => known.has(u));
      hiring = hiringSources.length && hiring.stages.length ? { ...hiring, sources: hiringSources } : null;
    }
    brief = { summary: out.summary, what_they_do: out.what_they_do, sources: sources.length ? sources : [pages[0].url], hiring_process: hiring };

    if (!crawl.pages.some((p) => p.kind === "hiring")) {
      warnings.push("No hiring or careers page was found on the company site, so questions are not tailored to a published interview process.");
    } else if (hiring && hiring.sources.every((u) => u.includes("news.ycombinator.com"))) {
      warnings.push("The interview process described comes only from public discussion and may be out of date.");
    }
  }

  const next = { ...state, brief, warnings };
  return { ...next, plan: planCategories(next) };
}

/** Fallback brief made only of the site's own words (meta descriptions and titles), with no model involved. */
function selfDescribedBrief(company: string, pages: CrawledPage[]): CompanyBrief {
  const described = pages.filter((p) => p.description);
  const lines = described.map((p) => `${p.title}: ${p.description}`);
  return {
    summary: `${company}, as described by its own website. (An AI-written summary was not available.)`,
    what_they_do: lines.length ? lines.slice(0, 3).join(" ") : "The pages that were read do not include a short description of the company.",
    sources: (described.length ? described : pages.slice(0, 1)).map((p) => p.url),
    hiring_process: null,
  };
}

/** Home, about and hiring pages first; each trimmed, and the whole set kept within the prompt budget. */
function selectPages(pages: CrawledPage[]): CrawledPage[] {
  const ordered = [...pages].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const chosen: CrawledPage[] = [];
  let total = 0;
  for (const page of ordered) {
    const text = page.text.slice(0, PAGE_CHARS);
    if (total + text.length > TOTAL_CHARS) break;
    chosen.push({ ...page, text });
    total += text.length;
  }
  return chosen;
}
