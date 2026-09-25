import { NextResponse } from "next/server";
import { z } from "zod";
import { QUESTION_CATEGORIES } from "@/kit/schema";
import { requireApiUser } from "@/server/auth/dal";
import { ApiError, handle, readJson } from "@/server/http";
import { toJobView } from "@/server/jobs/runner";
import { regenerationJob } from "@/server/kits/regenerate";
import { createJob, getJob, getKit, latestJobs } from "@/server/kits/repository";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("brief") }),
  z.object({ kind: z.literal("gaps") }),
  z.object({ kind: z.literal("questions"), category: z.enum(QUESTION_CATEGORIES) }),
]);

/** Starts a one-section regeneration job; the browser drives it like any other job. */
export const POST = handle(async (request: Request, { params }: RouteContext<"/api/kits/[id]/regenerate">) => {
  const user = await requireApiUser();
  const { id } = await params;
  const section = bodySchema.parse(await readJson(request));

  const row = await getKit(user.id, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That kit does not exist.");
  if (row.status !== "ready" || !row.kit || !row.context) throw new ApiError(409, "NOT_READY", "The kit has not finished generating.");
  if ((await latestJobs(user.id, [id])).get(id)?.status === "running") {
    throw new ApiError(409, "REGENERATING", "Another section is already being regenerated.");
  }

  const { kind, state } = regenerationJob(section, row.kit, row.context);
  const jobId = await createJob(user.id, id, kind, state);
  return NextResponse.json({ job: toJobView((await getJob(user.id, jobId))!) }, { status: 201 });
});
