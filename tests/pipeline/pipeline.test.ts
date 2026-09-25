import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer } from "../../fixtures/server";
import { validateKit } from "@/kit/schema";
import { LlmError, type LlmClient } from "@/llm/gemini";
import { JD, q, ScriptedLlm, script } from "../support/scripted-llm";
import { crawlCompanySite } from "@/retrieval/crawler";
import { Fetcher } from "@/retrieval/fetcher";
import type { DiscussionResult } from "@/retrieval/discussion";
import { runPipeline } from "@/pipeline/run";
import type { PipelineDeps } from "@/pipeline/types";


const noDiscussion = async (): Promise<DiscussionResult> => ({ source: "hacker-news", query: "q", items: [], skipped: [] });

let base: string;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ url: base, close } = await startFixtureServer());
});
afterAll(() => close());

function deps(llm: LlmClient): PipelineDeps {
  const policy = { allowPrivate: true };
  return {
    llm,
    urlPolicy: policy,
    now: () => new Date("2026-09-24T10:00:00Z"),
    crawl: (url) => crawlCompanySite(url, { policy, fetcher: new Fetcher({ policy, minGapMs: 0 }) }),
    searchDiscussion: noDiscussion,
  };
}

describe("runPipeline", () => {
  it("produces a valid, fully covered kit through separate, sequenced steps", async () => {
    const llm = new ScriptedLlm(script);
    const state = await runPipeline({ jd: JD, companyUrl: `${base}/acme/`, days: 4 }, deps(llm));
    const kit = state.kit!;

    expect(validateKit(kit).ok).toBe(true);

    // Extraction: invented requirement dropped, bonus requirement demoted to nice.
    expect(kit.role.requirements.map((r) => r.text)).toEqual(["4+ years with TypeScript", "PostgreSQL", "Mentoring engineers", "Payments background"]);
    expect(kit.role.requirements.find((r) => r.id === "r4")!.priority).toBe("nice");
    expect(kit.research!.dropped_requirements).toHaveLength(1);

    // Sequencing: each category is its own call; the published system-design round added that category.
    expect(llm.calls).toEqual([
      "extract-requirements",
      "company-brief",
      "questions-technical",
      "questions-system-design",
      "questions-behavioural",
      "questions-company-fit",
      "coverage-gap-pass-1",
      "coverage-gap-pass-2",
    ]);

    // Brief sources are only pages we actually fetched.
    expect(kit.company_brief.sources).not.toContain("https://made-up.example/about");

    // Coverage: three checks, a gap-pass question for r2, a template for r4, nothing left uncovered.
    expect(kit.coverage.passes).toBe(3);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.questions.find((x) => x.requirement_ids.includes("r2"))!.origin).toBe("gap-pass");
    expect(kit.questions.find((x) => x.requirement_ids.includes("r4"))!.origin).toBe("template");
    expect(kit.questions.some((x) => x.prompt === "Question citing an unknown id")).toBe(false);

    // Schedule: exactly the days requested.
    expect(kit.schedule.days).toHaveLength(4);
  });

  it("writes an honest brief without a model call when the site is unreachable", async () => {
    const llm = new ScriptedLlm(script);
    const state = await runPipeline({ jd: JD, companyUrl: `${base}/no-such-company/`, days: 1 }, deps(llm));
    const kit = state.kit!;

    expect(llm.calls).not.toContain("company-brief");
    expect(kit.company_brief.summary).toMatch(/No company research is available/);
    expect(kit.company_brief.sources).toEqual([]);
    expect(kit.source.pages_used).toEqual([]);
    expect(kit.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/could not be read/)]));
    expect(kit.schedule.days).toHaveLength(1);
    expect(validateKit(kit).ok).toBe(true);
  });

  it("still ships a valid, fully covered kit when the brief and a whole category fail", async () => {
    const down = () => {
      throw new LlmError("LLM_UNAVAILABLE", "model overloaded");
    };
    const llm = new ScriptedLlm({
      ...script,
      "company-brief": down,
      "questions-technical": down,
      // The gap pass picks up the requirements the failed category left uncovered.
      "coverage-gap-pass-1": () => ({
        questions: [
          { ...q(["r1"], "Walk me through a TypeScript service you built."), category: "technical" },
          { ...q(["r2"], "How would you debug a slow query?"), category: "technical" },
        ],
      }),
    });
    const state = await runPipeline({ jd: JD, companyUrl: `${base}/acme/`, days: 3 }, deps(llm));
    const kit = state.kit!;

    expect(validateKit(kit).ok).toBe(true);
    expect(kit.company_brief.summary).toMatch(/as described by its own website/);
    expect(kit.company_brief.what_they_do).toMatch(/billing and payments APIs/i); // the site's own meta description
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/brief could not be written/), expect.stringMatching(/technical questions could not be generated/)]),
    );
  });

  it("rejects invalid input before doing any work", async () => {
    const llm = new ScriptedLlm(script);
    await expect(runPipeline({ jd: "hi", companyUrl: "x", days: 0 }, deps(llm))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(llm.calls).toEqual([]);
  });
});
