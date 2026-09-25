import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Every API error leaves the server in one shape, `{ error: { code, message, details? } }`,
 * so the interface can branch on `code` instead of parsing prose.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "The request was not valid.", details: z.flattenError(err) } },
      { status: 400 },
    );
  }
  console.error(err);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong on our side." } },
    { status: 500 },
  );
}

/** Wraps a route handler so thrown ApiErrors / ZodErrors become structured responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

const MAX_BODY_BYTES = 1_000_000;

/** Reads a JSON body, refusing anything over 1 MB before parsing it. */
export async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "TOO_LARGE", "That request is too large.");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "TOO_LARGE", "That request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
