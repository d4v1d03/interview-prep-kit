import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/dal";
import { ApiError, handle, readJson } from "@/server/http";
import { createKit } from "@/server/kits/service";

const MAX_CASES = 10;

/**
 * Several postings at once, from an uploaded file of description-and-company
 * pairs. Each row is validated and created independently: one bad row is
 * reported back without blocking the others. A posting that already has a kit
 * is reported as a duplicate rather than generated twice.
 */
const batchSchema = z.object({ cases: z.array(z.unknown()).min(1).max(MAX_CASES, `Upload at most ${MAX_CASES} postings at a time.`) });

export const POST = handle(async (request: Request) => {
  const user = await requireApiUser();
  const { cases } = batchSchema.parse(await readJson(request));

  const results = [];
  for (const [index, raw] of cases.entries()) {
    try {
      results.push({ index, ok: true as const, ...(await createKit(user.id, fromCaseShape(raw))) });
    } catch (err) {
      if (err instanceof ApiError) {
        results.push({ index, ok: false as const, code: err.code, message: err.message, details: err.details });
      } else if (err instanceof z.ZodError) {
        results.push({ index, ok: false as const, code: "INVALID_REQUEST", message: err.issues.map((i) => i.message).join(" ") });
      } else {
        throw err;
      }
    }
  }
  // 200, not 201: the body reports per-row outcomes, and some rows may not have created anything.
  return NextResponse.json({ results });
});

/** Accepts the batch CLI's shape (`company_url`) as well as the form's (`companyUrl`), so one file works for both. */
function fromCaseShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const row = raw as Record<string, unknown>;
  return { ...row, companyUrl: row.companyUrl ?? row.company_url };
}
