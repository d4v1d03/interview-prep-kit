import type { Requirement } from "@/kit/schema";
import { untrusted } from "@/llm/gemini";
import { checkGrounding, normalise, priorityFromPosting } from "../grounding";
import { EXTRACTION_SYSTEM, extractionSchema } from "../prompts";
import type { PipelineDeps, PipelineState } from "../types";

/** Below these, the posting is treated as thin and the kit says so. */
const THIN_JD_CHARS = 400;
const THIN_JD_REQUIREMENTS = 3;

/**
 * Step 1 — requirements from the job description. The pasted text needs no
 * retrieval, so this runs first. The model proposes; code keeps only what the
 * posting supports, and lets the posting's own wording settle must vs nice.
 */
export async function extractRequirements(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const jd = state.input.jd.trim();
  const out = await deps.llm.generateJson({
    name: "extract-requirements",
    system: EXTRACTION_SYSTEM,
    prompt: `Extract the requirements from this job posting.\n\n${untrusted("job_posting", jd)}`,
    schema: extractionSchema,
    temperature: 0.1,
  });

  const requirements: Requirement[] = [];
  const dropped: { text: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const proposed of out.requirements) {
    const grounding = checkGrounding(proposed.text, proposed.evidence, jd);
    if (!grounding.ok) {
      dropped.push({ text: proposed.text, reason: grounding.reason });
      continue;
    }
    const key = normalise(proposed.text);
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      id: `r${requirements.length + 1}`,
      text: proposed.text.trim(),
      kind: proposed.kind,
      priority: priorityFromPosting(proposed.evidence, jd) ?? proposed.priority,
      evidence: proposed.evidence.trim(),
    });
  }

  const warnings = [...state.warnings];
  if (jd.length < THIN_JD_CHARS || requirements.length < THIN_JD_REQUIREMENTS) {
    warnings.push(
      `The job description is thin (${jd.length} characters, ${requirements.length} stated requirement${requirements.length === 1 ? "" : "s"}). ` +
        "This kit covers only what it states rather than guessing at typical requirements for the role.",
    );
  }
  if (dropped.length) {
    warnings.push(`${dropped.length} proposed requirement(s) were discarded because the posting does not support them.`);
  }

  return {
    ...state,
    warnings,
    role: {
      company: out.company?.trim() || null,
      title: out.title.trim() || "Unspecified role",
      seniority: out.seniority.trim() || "unspecified",
      location: out.location.trim() || "unspecified",
      responsibilities: out.responsibilities.map((r) => r.trim()).filter(Boolean),
      requirements,
      dropped,
    },
  };
}
