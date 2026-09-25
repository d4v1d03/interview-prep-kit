import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/dal";
import { ApiError, handle } from "@/server/http";
import { toJobView } from "@/server/jobs/runner";
import { getJob, resumeFailedJob } from "@/server/kits/repository";

/** Resumes a failed job from the step that failed; completed steps are not repeated. */
export const POST = handle(async (_request: Request, { params }: RouteContext<"/api/jobs/[id]/retry">) => {
  const user = await requireApiUser();
  const { id } = await params;
  if (!(await resumeFailedJob(user.id, id))) {
    throw new ApiError(409, "NOT_RETRYABLE", "Only a failed job can be retried.");
  }
  return NextResponse.json({ job: toJobView((await getJob(user.id, id))!) });
});
