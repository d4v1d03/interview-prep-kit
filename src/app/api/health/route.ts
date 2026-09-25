import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/** Public liveness check: proves the backend is deployed and can reach Postgres. */
export async function GET() {
  try {
    await (await getDb()).execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: "up" });
  } catch (err) {
    console.error("health check failed:", err);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
