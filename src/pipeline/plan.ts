import type { QuestionCategory, Requirement } from "@/kit/schema";
import type { PipelineState } from "./types";

/**
 * Deterministic routing: which categories the kit needs, and which category
 * "owns" each requirement (so the right instructions are used for it, and the
 * gap pass knows where a missing question belongs). What was found changes the
 * plan: a published system-design round adds a system-design category even for
 * a role whose posting never says "architecture".
 */

const DESIGN = /\b(design|architect\w*|scal\w*|distributed|system|microservices?|high[- ]availability|throughput|latency)\b/i;
const SENIOR = /\b(senior|staff|principal|lead|architect|head)\b/i;
const ORDER: QuestionCategory[] = ["technical", "system-design", "behavioural", "company-fit"];

export function ownerCategory(req: Pick<Requirement, "kind" | "text">, plan: QuestionCategory[]): QuestionCategory {
  if (req.kind === "behavioural") return "behavioural";
  if (req.kind === "domain") return "company-fit";
  if (plan.includes("system-design") && DESIGN.test(req.text)) return "system-design";
  return "technical";
}

export function planCategories(state: PipelineState): QuestionCategory[] {
  const requirements = state.role?.requirements ?? [];
  const signals = new Set(state.research?.crawl.pages.flatMap((p) => p.hiringSignals) ?? []);
  const hiringStages = (state.brief?.hiring_process?.stages ?? []).join(" ");
  const technical = requirements.filter((r) => r.kind === "technical");
  const seniority = `${state.role?.seniority ?? ""} ${state.role?.title ?? ""}`;

  const plan = new Set<QuestionCategory>();
  if (technical.length) {
    plan.add("technical");
    if (signals.has("system design") || /system design/i.test(hiringStages) || SENIOR.test(seniority) || technical.some((r) => DESIGN.test(r.text))) {
      plan.add("system-design");
    }
  }
  if (requirements.some((r) => r.kind === "behavioural") || signals.has("behavioural interview") || /behaviou?ral|values/i.test(hiringStages)) {
    plan.add("behavioural");
  }
  const siteResearched = Boolean(state.research?.crawl.reachable && state.research.crawl.pages.length);
  if (requirements.some((r) => r.kind === "domain") || siteResearched) plan.add("company-fit");

  return ORDER.filter((c) => plan.has(c));
}
