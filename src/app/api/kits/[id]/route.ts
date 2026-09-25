import { NextResponse } from "next/server";
import { z } from "zod";
import { reconcile } from "@/kit/edit";
import { kitSchema, validateKit } from "@/kit/schema";
import { requireApiUser } from "@/server/auth/dal";
import { ApiError, handle, readJson } from "@/server/http";
import { toJobView } from "@/server/jobs/runner";
import { deleteKit, getKit, latestJobs, updateKitIfVersion } from "@/server/kits/repository";

export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/kits/[id]">) => {
  const user = await requireApiUser();
  const { id } = await params;
  const row = await getKit(user.id, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That kit does not exist.");
  const job = (await latestJobs(user.id, [id])).get(id);
  return NextResponse.json({
    kit: { id: row.id, title: row.title, status: row.status, version: row.version, companyUrl: row.companyUrl, days: row.days, kit: row.kit },
    job: job ? toJobView(job) : null,
  });
});

export const DELETE = handle(async (_request: Request, { params }: RouteContext<"/api/kits/[id]">) => {
  const user = await requireApiUser();
  const { id } = await params;
  if (!(await deleteKit(user.id, id))) throw new ApiError(404, "NOT_FOUND", "That kit does not exist.");
  return new NextResponse(null, { status: 204 });
});

/**
 * Saves the builder's edits. The client sends the version it last loaded; if
 * the kit has changed since (another tab, a regeneration), the save is refused
 * with 409 rather than overwriting newer work. Derived parts are recomputed and
 * the whole kit is validated before it is stored.
 */
const patchSchema = z.object({ version: z.number().int(), kit: z.unknown() });

export const PATCH = handle(async (request: Request, { params }: RouteContext<"/api/kits/[id]">) => {
  const user = await requireApiUser();
  const { id } = await params;
  const body = patchSchema.parse(await readJson(request));

  const job = (await latestJobs(user.id, [id])).get(id);
  if (job?.status === "running") throw new ApiError(409, "REGENERATING", "A section is being regenerated; try again when it finishes.");

  // Shape first (so malformed input is a 400, not a crash), then recompute derived parts, then full validation.
  const shape = kitSchema.safeParse(body.kit);
  if (!shape.success) throw new ApiError(400, "INVALID_KIT", "The kit is not valid.", { issues: shape.error.issues });
  const result = validateKit(reconcile(shape.data));
  if (!result.ok) throw new ApiError(400, "INVALID_KIT", "The kit is not valid.", { issues: result.issues });

  const version = await updateKitIfVersion(user.id, id, body.version, result.kit);
  if (version === null) {
    const exists = await getKit(user.id, id);
    if (!exists) throw new ApiError(404, "NOT_FOUND", "That kit does not exist.");
    throw new ApiError(409, "VERSION_CONFLICT", "This kit was changed somewhere else. Reload to see the latest version.");
  }
  return NextResponse.json({ version, kit: result.kit });
});
