import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/dal";
import { handle } from "@/server/http";
import { tick } from "@/server/jobs/runner";

// One pipeline step per request; the slowest (a crawl, or a model call waiting out a rate limit) fits well inside this.
export const maxDuration = 300;

export const POST = handle(async (_request: Request, { params }: RouteContext<"/api/jobs/[id]/tick">) => {
  const user = await requireApiUser();
  const { id } = await params;
  return NextResponse.json({ job: await tick(user.id, id) });
});
