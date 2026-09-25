import { findUncovered } from "@/kit/coverage";
import { buildSchedule } from "@/kit/schedule";
import { validateKit, type Kit } from "@/kit/schema";
import { PipelineError } from "../errors";
import type { PipelineDeps, PipelineState } from "../types";

/**
 * Step 6 — schedule (arithmetic, see kit/schedule.ts), assembly into the
 * Appendix A structure, and validation. A kit that fails validation is never
 * returned or saved.
 */
export async function assembleKit(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const role = state.role!;
  const brief = state.brief!;
  const { crawl, discussion } = state.research!;
  const now = (deps.now ?? (() => new Date()))();

  const kit: Kit = {
    source: {
      company: role.company ?? crawl.companyName,
      company_url: state.input.companyUrl,
      role: role.title,
      location: role.location,
      jd_chars: state.input.jd.length,
      researched_at: now.toISOString(),
      pages_used: crawl.pages.map((p) => p.url),
    },
    company_brief: { summary: brief.summary, what_they_do: brief.what_they_do, sources: brief.sources },
    role: {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
    },
    questions: state.questions,
    flashcards: state.flashcards,
    schedule: buildSchedule(state.questions, role.requirements, state.input.days),
    coverage: {
      uncovered_requirement_ids: findUncovered(role.requirements, state.questions).map((r) => r.id),
      passes: state.coverage.length,
      history: state.coverage,
    },
    // Extensions: the honesty trail — what was found, what was not, and what was discarded.
    research: {
      hiring_page_found: crawl.pages.some((p) => p.kind === "hiring"),
      hiring_pages: crawl.pages.filter((p) => p.kind === "hiring").map((p) => p.url),
      hiring_signals: [...new Set(crawl.pages.flatMap((p) => p.hiringSignals))],
      hiring_process: brief.hiring_process,
      discussion: { source: discussion.source, query: discussion.query, items: discussion.items },
      skipped_sources: [...crawl.skipped, ...discussion.skipped],
      crawl_notes: crawl.notes,
      dropped_requirements: role.dropped,
    },
    warnings: state.warnings,
    generation: {
      question_categories: state.plan ?? [],
      model_calls: state.llmCalls,
    },
  };

  const result = validateKit(kit);
  if (!result.ok) {
    throw new PipelineError("KIT_INVALID", `The generated kit failed validation: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
  return { ...state, kit: result.kit };
}
