import { crawlCompanySite } from "@/retrieval/crawler";
import { searchInterviewDiscussion } from "@/retrieval/discussion";
import type { PipelineDeps, PipelineState } from "../types";

/**
 * Step 2 — retrieval, no model involved. Crawl the company site, then search
 * public discussion using the company name the posting gave (falling back to
 * what the site calls itself). Nothing here can fail the run: unreachable
 * sources are recorded in the result and reported in the kit.
 */
export async function research(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const crawl = await (deps.crawl ?? ((url, policy) => crawlCompanySite(url, { policy })))(state.input.companyUrl, deps.urlPolicy);
  const company = state.role?.company ?? crawl.companyName;
  const discussion = await (deps.searchDiscussion ?? searchInterviewDiscussion)(company);

  const warnings = [...state.warnings];
  if (!crawl.reachable) {
    warnings.push(`The company website could not be read (${crawl.skipped[0]?.reason ?? "unknown error"}). The brief says so rather than guessing.`);
  }
  if (discussion.items.length === 0) {
    warnings.push(`No public discussion of ${company}'s interviews was found${discussion.skipped.length ? " (the search could not be completed)" : ""}.`);
  }
  return { ...state, warnings, research: { crawl, discussion } };
}
