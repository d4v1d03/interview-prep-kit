import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer } from "../../fixtures/server";
import { runBatch } from "@/batch/run-batch";
import { validateKit } from "@/kit/schema";
import { LlmError } from "@/llm/gemini";
import { crawlCompanySite } from "@/retrieval/crawler";
import { Fetcher } from "@/retrieval/fetcher";
import type { PipelineDeps } from "@/pipeline/types";
import { JD, ScriptedLlm, script } from "../support/scripted-llm";

let base: string;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ url: base, close } = await startFixtureServer());
});
afterAll(() => close());

function deps(llm: ScriptedLlm): PipelineDeps {
  const policy = { allowPrivate: true };
  return {
    llm,
    urlPolicy: policy,
    crawl: (url) => crawlCompanySite(url, { policy, fetcher: new Fetcher({ policy, minGapMs: 0 }) }),
    searchDiscussion: async () => ({ source: "hacker-news", query: "q", items: [], skipped: [] }),
  };
}

describe("runBatch", () => {
  it("writes one entry per case in the Appendix B shape, and keeps going after a failure", async () => {
    let extractions = 0;
    const llm = new ScriptedLlm({
      ...script,
      // The second case's model call fails outright: that case fails, the others must not.
      "extract-requirements": (call) => {
        if (++extractions === 2) throw new LlmError("LLM_UNAVAILABLE", "model down");
        return script["extract-requirements"](call);
      },
    });
    const cases = [
      { id: "case-01", jd: JD, company_url: `${base}/acme/`, days: 5 },
      { id: "case-02", jd: `${JD}\nAlso: Rust.`, company_url: `${base}/globex/`, days: 3 },
      { id: "case-03", jd: JD, company_url: `${base}/no-such-company/`, days: 1 },
      { id: "case-04", jd: 42, company_url: `${base}/acme/`, days: 2 },
    ];

    const output = await runBatch(cases, deps(llm));

    expect(output.version).toBe("1.0");
    expect(Number.isNaN(Date.parse(output.generated_at))).toBe(false);
    expect(output.kits.map((k) => [k.id, k.status])).toEqual([
      ["case-01", "ok"],
      ["case-02", "failed"],
      ["case-03", "ok"], // unreachable site: still a kit, with the gap recorded honestly
      ["case-04", "failed"],
    ]);
    expect(output.kits[1]).toMatchObject({ kit: null, error: { code: "LLM_UNAVAILABLE" } });
    expect(output.kits[3]).toMatchObject({ kit: null, error: { code: "INVALID_INPUT" } });

    const [first, , third] = output.kits;
    if (first.status !== "ok" || third.status !== "ok") throw new Error("expected ok kits");
    expect(validateKit(first.kit).ok).toBe(true);
    expect(first.kit.schedule.days).toHaveLength(5);
    expect(third.kit.schedule.days).toHaveLength(1);
    expect(third.kit.warnings!.join(" ")).toMatch(/could not be read/);
  });

  it("reuses the kit for an identical case instead of generating it twice", async () => {
    const llm = new ScriptedLlm(script);
    const same = { jd: JD, company_url: `${base}/acme/`, days: 2 };
    const output = await runBatch([{ id: "a", ...same }, { id: "b", ...same }], deps(llm));
    expect(output.kits.map((k) => [k.id, k.status])).toEqual([["a", "ok"], ["b", "ok"]]);
    expect(llm.calls.filter((c) => c === "extract-requirements")).toHaveLength(1);
  });
});
