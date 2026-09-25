import Link from "next/link";
import { NewKitForm, UploadKitsForm } from "./new-kit-form";

export default async function NewKitPage({ searchParams }: PageProps<"/kits/new">) {
  const { mode } = await searchParams;
  const upload = mode === "upload";
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`;

  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">New kit</h1>
      <p className="mt-1 text-sm text-muted">
        We read the posting, research the company&apos;s site and public interview discussion, then build a kit you can edit and practise.
      </p>

      <nav aria-label="How to add postings" className="mt-6 inline-flex gap-1 rounded-lg bg-border/60 p-1">
        <Link href="/kits/new" aria-current={!upload ? "page" : undefined} className={tab(!upload)}>
          One posting
        </Link>
        <Link href="/kits/new?mode=upload" aria-current={upload ? "page" : undefined} className={tab(upload)}>
          Upload several
        </Link>
      </nav>

      <div className="mt-6">{upload ? <UploadKitsForm /> : <NewKitForm />}</div>
    </section>
  );
}
