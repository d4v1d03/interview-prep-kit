import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/dal";
import { getKit, listReviews } from "@/server/kits/repository";
import { PracticeSession } from "./practice-session";

export default async function PracticePage({ params }: PageProps<"/kits/[id]/practice">) {
  const user = await requireUser();
  const { id } = await params;
  const row = await getKit(user.id, id);
  if (!row || !row.kit) notFound();
  const reviews = await listReviews(user.id, id);

  return (
    <section className="mx-auto max-w-2xl">
      <Link href={`/kits/${id}`} className="text-sm text-muted hover:text-foreground">
        ← Back to the kit
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Practise</h1>
      <p className="mt-1 text-sm text-muted">{row.title}</p>
      <div className="mt-6">
        <PracticeSession
          kitId={id}
          cards={row.kit.flashcards}
          requirements={row.kit.role.requirements}
          reviews={reviews.map((r) => ({ ...r, reviewedAt: r.reviewedAt.toISOString() }))}
        />
      </div>
    </section>
  );
}
