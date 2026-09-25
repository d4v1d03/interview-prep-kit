"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MAX_DAYS } from "@/kit/schedule";
import { apiFetch, ApiClientError } from "@/lib/api-client";

type Duplicate = { kitId: string; status: string; createdAt: string };
type Created = { kitId: string; jobId: string };

export function NewKitForm() {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState("7");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);

  async function submit(force = false) {
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const created = await apiFetch<Created>(`/api/kits${force ? "?force=1" : ""}`, {
        method: "POST",
        body: JSON.stringify({ jd, companyUrl, days: Number(days) }),
      });
      router.push(`/kits/${created.kitId}`);
    } catch (err) {
      setPending(false);
      if (!(err instanceof ApiClientError)) throw err;
      if (err.code === "DUPLICATE_KIT") setDuplicate(err.details as Duplicate);
      else if (Object.keys(err.fieldErrors).length) setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v?.[0]])));
      else setFormError(err.message);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <div>
        <label htmlFor="jd" className="block text-sm font-medium">
          Job description
        </label>
        <p id="jd-hint" className="text-xs text-muted">
          Paste the whole posting. A short one is fine — the kit will only cover what it actually says.
        </p>
        <textarea
          id="jd"
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          rows={12}
          required
          aria-invalid={errors.jd ? true : undefined}
          aria-describedby={errors.jd ? "jd-error" : "jd-hint"}
          className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm aria-invalid:border-danger"
        />
        <div className="mt-1 flex justify-between text-xs">
          <span id="jd-error" className="text-danger">
            {errors.jd}
          </span>
          <span className="tabular-nums text-muted">{jd.length.toLocaleString()} characters</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <div>
          <label htmlFor="companyUrl" className="block text-sm font-medium">
            Company website
          </label>
          <input
            id="companyUrl"
            value={companyUrl}
            onChange={(e) => setCompanyUrl(e.target.value)}
            placeholder="acme.com"
            inputMode="url"
            autoComplete="url"
            aria-invalid={errors.companyUrl ? true : undefined}
            aria-describedby="companyUrl-error"
            className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm aria-invalid:border-danger"
          />
          <p id="companyUrl-error" className="mt-1 text-xs text-danger">
            {errors.companyUrl}
          </p>
        </div>
        <div>
          <label htmlFor="days" className="block text-sm font-medium">
            Days until interview
          </label>
          <input
            id="days"
            type="number"
            min={1}
            max={MAX_DAYS}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            aria-invalid={errors.days ? true : undefined}
            aria-describedby="days-error"
            className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm aria-invalid:border-danger"
          />
          <p id="days-error" className="mt-1 text-xs text-danger">
            {errors.days}
          </p>
        </div>
      </div>

      {duplicate && (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-medium">You already have a kit for this posting</p>
          <p className="mt-1 text-muted">
            Created {new Date(duplicate.createdAt).toLocaleString()} ({duplicate.status}). Opening it keeps your edits and practice history.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/kits/${duplicate.kitId}`} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-foreground">
              Open the existing kit
            </Link>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void submit(true)}>
              Generate a fresh one anyway
            </Button>
          </div>
        </div>
      )}

      <div aria-live="polite" className="text-sm text-danger">
        {formError}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Starting…" : "Generate kit"}
      </Button>
    </form>
  );
}

type UploadRow = { jd: string; companyUrl: string; days: number };
type RowResult = { index: number; ok: boolean; kitId?: string; code?: string; message?: string; details?: Duplicate };

/**
 * Several postings from one JSON file — the same shape the batch CLI reads:
 * [{ "jd": "...", "company_url": "...", "days": 5 }, ...]. Rows are checked in
 * the browser first so obvious mistakes show before anything is sent.
 */
export function UploadKitsForm() {
  const router = useRouter();
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [pending, setPending] = useState(false);

  async function onFile(file: File | undefined) {
    setRows(null);
    setResults(null);
    setParseError(null);
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error("The file must contain a JSON array.");
      if (data.length === 0 || data.length > 10) throw new Error("Include between 1 and 10 postings.");
      setRows(
        data.map((row, i) => {
          const jd = typeof row?.jd === "string" ? row.jd : "";
          const companyUrl = typeof row?.company_url === "string" ? row.company_url : typeof row?.companyUrl === "string" ? row.companyUrl : "";
          if (!jd.trim() || !companyUrl.trim()) throw new Error(`Row ${i + 1} needs "jd" and "company_url".`);
          return { jd, companyUrl, days: Number(row?.days ?? 7) };
        }),
      );
    } catch (err) {
      setParseError((err as Error).message);
    }
  }

  async function submit() {
    if (!rows) return;
    setPending(true);
    try {
      const { results } = await apiFetch<{ results: RowResult[] }>("/api/kits/batch", { method: "POST", body: JSON.stringify({ cases: rows }) });
      setResults(results);
      if (results.every((r) => r.ok)) router.push("/kits");
    } catch (err) {
      setParseError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="upload" className="block text-sm font-medium">
          Postings file (.json)
        </label>
        <p id="upload-hint" className="text-xs text-muted">
          An array of up to 10 objects: <code className="font-mono">{`{ "jd": "…", "company_url": "https://…", "days": 5 }`}</code>
        </p>
        <input
          id="upload"
          type="file"
          accept="application/json,.json"
          aria-describedby="upload-hint"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="mt-2 block text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5"
        />
      </div>

      {parseError && (
        <p role="alert" className="text-sm text-danger">
          {parseError}
        </p>
      )}

      {rows && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Postings to generate</caption>
            <thead className="bg-background text-xs text-muted">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Posting</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Days</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const result = results?.find((r) => r.index === i);
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{i + 1}</td>
                    <td className="max-w-xs truncate px-3 py-2">{row.jd.split("\n")[0]}</td>
                    <td className="px-3 py-2">{row.companyUrl}</td>
                    <td className="px-3 py-2 tabular-nums">{row.days}</td>
                    <td className="px-3 py-2">
                      {!result ? (
                        <span className="text-muted">—</span>
                      ) : result.ok ? (
                        <span className="text-success">Queued</span>
                      ) : result.code === "DUPLICATE_KIT" ? (
                        <Link href={`/kits/${result.details?.kitId}`} className="text-warning underline">
                          Already have it
                        </Link>
                      ) : (
                        <span className="text-danger">{result.message}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows && !results && (
        <Button onClick={() => void submit()} disabled={pending}>
          {pending ? "Starting…" : `Generate ${rows.length} kit${rows.length === 1 ? "" : "s"}`}
        </Button>
      )}
      {results && !results.every((r) => r.ok) && (
        <Link href="/kits" className="inline-block text-sm font-medium text-accent underline-offset-4 hover:underline">
          Go to your kits →
        </Link>
      )}
    </div>
  );
}
