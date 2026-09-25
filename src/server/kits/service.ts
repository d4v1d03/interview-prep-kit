import "server-only";
import { z } from "zod";
import { fingerprint } from "@/batch/run-batch";
import { MAX_DAYS, MIN_DAYS } from "@/kit/schedule";
import { initialState } from "@/pipeline/types";
import { RetrievalError } from "@/retrieval/errors";
import { parseCompanyUrl } from "@/retrieval/url-guard";
import { ApiError } from "@/server/http";
import { createKitWithJob, findKitByFingerprint } from "./repository";

/** What the create form and the upload send. Messages are written for the person filling in the form. */
export const kitRequestSchema = z.object({
  jd: z
    .string()
    .trim()
    .min(20, "Paste the job description (at least a couple of lines).")
    .max(50_000, "That job description is very long; paste the posting itself (under 50,000 characters)."),
  companyUrl: z.string().trim().min(1, "Enter the company's website."),
  days: z.coerce
    .number()
    .int("Use a whole number of days.")
    .min(MIN_DAYS, `At least ${MIN_DAYS} day.`)
    .max(MAX_DAYS, `At most ${MAX_DAYS} days.`),
});
export type KitRequest = z.infer<typeof kitRequestSchema>;

export type CreatedKit = { kitId: string; jobId: string };

/**
 * Creates a kit and its generation job. The same posting (description, company
 * and days) submitted again is caught by fingerprint: the caller learns about
 * the existing kit and must ask explicitly (`force`) to generate a second one.
 */
export async function createKit(userId: string, raw: unknown, options: { force?: boolean } = {}): Promise<CreatedKit> {
  const input = kitRequestSchema.parse(raw);
  let url: URL;
  try {
    url = parseCompanyUrl(input.companyUrl);
  } catch (err) {
    const message = err instanceof RetrievalError ? err.message : "That is not a valid web address.";
    throw new ApiError(400, "INVALID_REQUEST", message, { fieldErrors: { companyUrl: [message] } });
  }
  const companyUrl = url.toString();

  const print = fingerprint({ jd: input.jd, company_url: companyUrl, days: input.days });
  if (!options.force) {
    const existing = await findKitByFingerprint(userId, print);
    if (existing) {
      throw new ApiError(409, "DUPLICATE_KIT", "You already have a kit for this posting.", {
        kitId: existing.id,
        status: existing.status,
        createdAt: existing.createdAt,
      });
    }
  }

  return createKitWithJob(
    userId,
    { title: provisionalTitle(input.jd, url), companyUrl, jd: input.jd, days: input.days, fingerprint: print },
    initialState({ jd: input.jd, companyUrl, days: input.days }),
  );
}

/** Shown while generating: the posting's first line and the site, replaced by "Role · Company" once known. */
function provisionalTitle(jd: string, url: URL): string {
  const firstLine = jd.split("\n").map((l) => l.trim()).find(Boolean) ?? "New kit";
  const clipped = firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine;
  return `${clipped} · ${url.hostname.replace(/^www\./, "")}`;
}
