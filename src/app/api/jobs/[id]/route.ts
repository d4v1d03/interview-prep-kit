import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/dal";
import { ApiError, handle } from "@/server/http";
import { toJobView } from "@/server/jobs/runner";
import { getJob } from "@/server/kits/repository";

export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/jobs/[id]">) => {
  const user = await requireApiUser();
  const { id } = await params;
  const job = await getJob(user.id, id);
  if (!job) throw new ApiError(404, "NOT_FOUND", "That job does not exist.");
  return NextResponse.json({ job: toJobView(job) });
});
