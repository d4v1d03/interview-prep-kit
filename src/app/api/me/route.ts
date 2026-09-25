import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/dal";
import { handle } from "@/server/http";

export const GET = handle(async () => {
  const user = await requireApiUser();
  return NextResponse.json({ user });
});
