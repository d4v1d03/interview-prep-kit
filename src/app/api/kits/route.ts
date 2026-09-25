import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/dal";
import { handle, readJson } from "@/server/http";
import { listKits } from "@/server/kits/repository";
import { createKit } from "@/server/kits/service";

export const GET = handle(async () => {
  const user = await requireApiUser();
  return NextResponse.json({ kits: await listKits(user.id) });
});

/** Create one kit. `?force=1` generates again even if the same posting already has a kit. */
export const POST = handle(async (request: Request) => {
  const user = await requireApiUser();
  const force = new URL(request.url).searchParams.get("force") === "1";
  const created = await createKit(user.id, await readJson(request), { force });
  return NextResponse.json(created, { status: 201 });
});
