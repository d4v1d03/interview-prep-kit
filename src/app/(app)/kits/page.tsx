import Link from "next/link";
import { requireUser } from "@/server/auth/dal";
import { toJobView } from "@/server/jobs/runner";
import { latestJobs, listKits } from "@/server/kits/repository";
import { KitList } from "./kit-list";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function KitsPage() {
  const user = await requireUser();
  const kits = await listKits(user.id);
  const jobs = await latestJobs(
    user.id,
    kits.filter((k) => k.status !== "ready").map((k) => k.id),
  );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Your kits</h1>
        <Link href="/kits/new" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          New kit
        </Link>
      </div>

      {kits.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-10 text-center">
          <p className="font-medium">No kits yet</p>
          <p className="mt-1 text-sm text-muted">Paste a job description and a company website to generate your first preparation kit.</p>
          <Link href="/kits/new" className="mt-4 inline-block text-sm font-medium text-accent underline-offset-4 hover:underline">
            Create a kit →
          </Link>
        </div>
      ) : (
        <KitList
          kits={kits.map((k) => ({
            id: k.id,
            title: k.title,
            status: k.status,
            days: k.days,
            createdAt: k.createdAt.toISOString(),
            // Formatted once on the server: formatting in the browser would differ by locale and break hydration.
            createdLabel: DATE.format(k.createdAt),
            job: jobs.has(k.id) ? toJobView(jobs.get(k.id)!) : null,
          }))}
        />
      )}
    </section>
  );
}
