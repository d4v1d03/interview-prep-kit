import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer } from "../../fixtures/server";
import { crawlCompanySite } from "@/retrieval/crawler";
import { Fetcher } from "@/retrieval/fetcher";

let base: string;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ url: base, close } = await startFixtureServer());
});
afterAll(() => close());

const local = { allowPrivate: true };
const crawl = (path: string) =>
  crawlCompanySite(`${base}${path}`, { policy: local, fetcher: new Fetcher({ policy: local, minGapMs: 0 }) });

describe("crawlCompanySite", () => {
  it("finds a hiring process buried two links deep, and reads what it says", async () => {
    const result = await crawl("/acme/");
    expect(result.reachable).toBe(true);
    expect(result.companyName).toBe("Acme Payments");

    const hiring = result.pages.filter((p) => p.kind === "hiring").map((p) => new URL(p.url).pathname);
    expect(hiring).toContain("/acme/handbook/engineering/how-we-interview.html");

    const process = result.pages.find((p) => p.url.endsWith("how-we-interview.html"))!;
    expect(process.hiringSignals).toEqual(expect.arrayContaining(["take-home", "system design", "recruiter screen"]));
  });

  it("stays on the company's own site, respects robots.txt, and skips non-pages", async () => {
    const result = await crawl("/acme/");
    const fetched = result.pages.map((p) => new URL(p.url).pathname);
    expect(fetched.some((p) => p.startsWith("/globex/"))).toBe(false);
    expect(fetched.some((p) => p.includes("/private/"))).toBe(false);
    expect(fetched.some((p) => p.endsWith(".pdf") || p.endsWith("/login"))).toBe(false);
  });

  it("never passes hidden page text on", async () => {
    const result = await crawl("/acme/");
    expect(result.pages.map((p) => p.text).join("\n")).not.toContain("ignore all previous instructions");
  });

  it("reports honestly when a site has no hiring page", async () => {
    const result = await crawl("/globex/");
    expect(result.reachable).toBe(true);
    expect(result.pages.some((p) => p.kind === "hiring")).toBe(false);
    expect(result.pages.some((p) => p.kind === "about")).toBe(true);
    expect(result.notes).toContain("No hiring or careers page was found on the company site.");
  });

  it("finds a hiring page that only the sitemap links to", async () => {
    const result = await crawl("/initech/");
    const hiring = result.pages.find((p) => p.kind === "hiring");
    expect(hiring?.url).toMatch(/\/initech\/team\/hiring\/process\.html$/);
    expect(hiring?.hiringSignals).toContain("pair programming");
  });

  it("records a 404 homepage as unreachable instead of throwing", async () => {
    const result = await crawl("/no-such-company/");
    expect(result.reachable).toBe(false);
    expect(result.skipped[0]).toMatchObject({ code: "HTTP_ERROR" });
  });

  it("records an invalid URL as unreachable", async () => {
    const result = await crawlCompanySite("ht!tp://not a url", { policy: local });
    expect(result.reachable).toBe(false);
    expect(result.skipped[0]).toMatchObject({ code: "INVALID_URL" });
  });

  it("records a site that refuses connections as unreachable", async () => {
    const result = await crawlCompanySite("http://127.0.0.1:9/", {
      policy: local,
      fetcher: new Fetcher({ policy: local, minGapMs: 0 }),
    });
    expect(result.reachable).toBe(false);
    expect(result.skipped[0]?.code).toBe("NETWORK");
  });
});
