import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/dal";
import { ApiError, handle, readJson } from "@/server/http";
import { addReview, getKit } from "@/server/kits/repository";

const reviewSchema = z.object({ cardId: z.string().min(1), confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]) });

/** Records how confident the user felt on one flashcard. */
export const POST = handle(async (request: Request, { params }: RouteContext<"/api/kits/[id]/practice">) => {
  const user = await requireApiUser();
  const { id } = await params;
  const { cardId, confidence } = reviewSchema.parse(await readJson(request));

  const row = await getKit(user.id, id);
  if (!row?.kit) throw new ApiError(404, "NOT_FOUND", "That kit does not exist.");
  if (!row.kit.flashcards.some((c) => c.id === cardId)) throw new ApiError(404, "NOT_FOUND", "That flashcard is no longer in the kit.");

  await addReview(user.id, id, cardId, confidence);
  return new NextResponse(null, { status: 204 });
});
