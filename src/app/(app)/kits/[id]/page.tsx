import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/dal";
import { toJobView } from "@/server/jobs/runner";
import { getKit, latestJobs } from "@/server/kits/repository";
import { KitGenerating } from "./kit-generating";
import { KitBuilder } from "./builder/kit-builder";

export default async function KitPage({ params }: PageProps<"/kits/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const row = await getKit(user.id, id);
  if (!row) notFound();
  const job = (await latestJobs(user.id, [id])).get(id);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{row.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {row.companyUrl} · {row.kit?.schedule.days_available ?? row.days}-day plan
      </p>
      <div className="mt-6">
        {row.status === "ready" && row.kit ? (
          <KitBuilder
            kitId={row.id}
            kit={row.kit}
            version={row.version}
            runningJob={job && job.kind !== "generate" && job.status === "running" ? toJobView(job) : null}
          />
        ) : job ? (
          <KitGenerating job={toJobView(job)} />
        ) : (
          <p className="text-danger">This kit has no generation job. Delete it and create it again.</p>
        )}
      </div>
    </section>
  );
}
