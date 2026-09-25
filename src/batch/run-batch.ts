import { createHash } from "node:crypto";
import { z } from "zod";
import type { Kit } from "@/kit/schema";
import { toPipelineError } from "@/pipeline/errors";
import { runPipeline, type Step } from "@/pipeline/run";
import type { PipelineDeps } from "@/pipeline/types";

/**
 * The batch entry point's core (Appendix B). It calls exactly the same
 * pipeline as the web app, one case at a time, and never lets one case stop
 * the run: a case that cannot produce a kit at all is recorded as failed with a
 * code and a message. A case that could only be partly researched is still ok,
 * with the gaps recorded in the kit's `warnings` and `research` fields.
 */

export const batchCaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string(),
  days: z.number(),
});
export type BatchCase = z.infer<typeof batchCaseSchema>;

export type BatchEntry =
  | { id: string; status: "ok"; kit: Kit; error: null }
  | { id: string; status: "failed"; kit: null; error: { code: string; message: string } };

export type BatchOutput = { version: "1.0"; generated_at: string; kits: BatchEntry[] };

export type BatchProgress =
  | { type: "case-start"; id: string; index: number; total: number }
  | { type: "step"; id: string; step: Step }
  | { type: "case-end"; id: string; entry: BatchEntry; ms: number; reused: boolean };

export async function runBatch(
  rawCases: unknown[],
  deps: PipelineDeps,
  onProgress?: (event: BatchProgress) => void,
  onEntry?: (output: BatchOutput) => void,
): Promise<BatchOutput> {
  const output: BatchOutput = { version: "1.0", generated_at: new Date().toISOString(), kits: [] };
  // The same description, company and days submitted twice produce the same kit; don't pay for it twice.
  const done = new Map<string, BatchEntry>();

  for (const [index, raw] of rawCases.entries()) {
    const id = caseId(raw, index);
    const started = Date.now();
    onProgress?.({ type: "case-start", id, index, total: rawCases.length });

    let entry: BatchEntry;
    let reused = false;
    const parsed = batchCaseSchema.safeParse(raw);
    if (!parsed.success) {
      entry = failed(id, "INVALID_INPUT", `Case is malformed: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    } else {
      const c = parsed.data;
      const key = fingerprint(c);
      const previous = done.get(key);
      if (previous) {
        reused = true;
        entry = { ...previous, id: c.id } as BatchEntry;
      } else {
        try {
          const state = await runPipeline({ jd: c.jd, companyUrl: c.company_url, days: c.days }, deps, (step) =>
            onProgress?.({ type: "step", id: c.id, step }),
          );
          entry = { id: c.id, status: "ok", kit: state.kit!, error: null };
        } catch (err) {
          const e = toPipelineError(err);
          entry = failed(c.id, e.code, e.message);
        }
        done.set(key, entry);
      }
    }

    output.kits.push(entry);
    onProgress?.({ type: "case-end", id, entry, ms: Date.now() - started, reused });
    onEntry?.(output);
  }
  return output;
}

function failed(id: string, code: string, message: string): BatchEntry {
  return { id, status: "failed", kit: null, error: { code, message } };
}

function caseId(raw: unknown, index: number): string {
  const id = (raw as { id?: unknown } | null)?.id;
  return typeof id === "string" && id ? id : `case-${index + 1}`;
}

export function fingerprint(c: Pick<BatchCase, "jd" | "company_url" | "days">): string {
  return createHash("sha256").update(JSON.stringify([c.jd.trim(), c.company_url.trim().toLowerCase(), c.days])).digest("hex");
}
