import { describe, expect, it } from "vitest";
import { relevantSnippet, searchInterviewDiscussion } from "@/retrieval/discussion";
import { Fetcher } from "@/retrieval/fetcher";

describe("relevantSnippet", () => {
  it("keeps a passage where the company and an interview term appear together", () => {
    const text = "I went through the Stripe interview loop last year; the take-home was a small API.";
    expect(relevantSnippet(text, "Stripe")).toContain("Stripe interview loop");
  });

  it("rejects a hit that mentions the company but not interviews", () => {
    expect(relevantSnippet("Stripe raised prices again, annoying for small shops.", "Stripe")).toBeNull();
  });

  it("rejects a partial-word match (Acme inside Acmeville)", () => {
    expect(relevantSnippet("Acmeville council interview with the mayor", "Acme")).toBeNull();
  });

  it("rejects mentions too far apart to be about the same thing", () => {
    const text = `Acme is a company. ${"filler ".repeat(80)} My interview elsewhere went well.`;
    expect(relevantSnippet(text, "Acme")).toBeNull();
  });
});

describe("searchInterviewDiscussion", () => {
  it("parses results and filters out irrelevant hits", async () => {
    const hits = [
      { objectID: "1", comment_text: "The Acme interview had a system design round.", created_at: "2025-03-01T00:00:00Z" },
      { objectID: "2", comment_text: "Acme anvils are funny.", created_at: "2025-03-02T00:00:00Z" },
    ];
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ hits }), { headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await searchInterviewDiscussion("Acme", {
      fetcher: new Fetcher({ policy: { allowPrivate: true }, fetchImpl, minGapMs: 0 }),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ url: "https://news.ycombinator.com/item?id=1", date: "2025-03-01" });
  });

  it("reports a failed search as a skipped source, not an exception", async () => {
    const fetchImpl = (async () => new Response("down", { status: 404 })) as typeof fetch;
    const result = await searchInterviewDiscussion("Acme", {
      fetcher: new Fetcher({ policy: { allowPrivate: true }, fetchImpl, minGapMs: 0 }),
    });
    expect(result.items).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ code: "HTTP_ERROR" });
  });
});
