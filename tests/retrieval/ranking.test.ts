import { describe, expect, it } from "vitest";
import { canonicalKey, makeScope, scoreLink } from "@/retrieval/ranking";

const score = (path: string, text = "") => scoreLink(new URL(path, "https://acme.com"), text);

describe("scoreLink", () => {
  it("finds hiring pages at paths nobody would hard-code", () => {
    expect(score("/handbook/hiring/interviewing").kind).toBe("hiring");
    expect(score("/company/join/", "We're hiring!").kind).toBe("hiring");
    expect(score("/team/HowWeHire").kind).toBe("hiring");
  });

  it("ranks an interview-process page above a generic careers page above a blog post", () => {
    const process = score("/handbook/engineering/how-we-interview", "our interview process").score;
    const careers = score("/careers").score;
    const blog = score("/blog/2024/why-we-love-go").score;
    expect(process).toBeGreaterThan(careers);
    expect(careers).toBeGreaterThan(blog);
  });

  it("classifies about pages", () => {
    expect(score("/about-us").kind).toBe("about");
    expect(score("/company", "Who we are").kind).toBe("about");
  });

  it("pushes login, legal and files out of contention", () => {
    expect(score("/login", "Log in").score).toBeLessThan(0);
    expect(score("/privacy", "Privacy").score).toBeLessThan(0);
    expect(score("/careers/benefits.pdf").score).toBe(-100);
  });

  it("ignores 'edit this page' links into a source-code viewer", () => {
    expect(score("/acme/site/-/blob/main/content/jobs/interview-process.yml").score).toBe(-100);
    expect(score("/acme/site/tree/main/careers").score).toBe(-100);
  });

  it("prefers the English page over a translated copy", () => {
    expect(score("/de/careers").score).toBeLessThan(score("/careers").score);
    expect(score("/en/careers").score).toBe(score("/careers").score); // /en/ is not penalised
  });
});

describe("makeScope", () => {
  it("keeps a path-scoped site inside its folder (several companies on one host)", () => {
    const inScope = makeScope(new URL("http://localhost:8099/acme/"));
    expect(inScope(new URL("http://localhost:8099/acme/company/join/"))).toBe(true);
    expect(inScope(new URL("http://localhost:8099/globex/"))).toBe(false);
    expect(inScope(new URL("http://localhost:9000/acme/"))).toBe(false);
  });

  it("allows www and subdomains for a root site, but not other domains", () => {
    const inScope = makeScope(new URL("https://acme.com/"));
    expect(inScope(new URL("https://www.acme.com/about"))).toBe(true);
    expect(inScope(new URL("https://careers.acme.com/"))).toBe(true);
    expect(inScope(new URL("https://notacme.com/"))).toBe(false);
    expect(inScope(new URL("https://acme.com.evil.io/"))).toBe(false);
  });

  it("follows sibling subdomains of the same company (about.gitlab.com → handbook.gitlab.com)", () => {
    const inScope = makeScope(new URL("https://about.gitlab.com/"));
    expect(inScope(new URL("https://handbook.gitlab.com/handbook/hiring/"))).toBe(true);
    expect(inScope(new URL("https://jobs.acme.co.uk/"))).toBe(false);
    expect(makeScope(new URL("https://acme.co.uk/"))(new URL("https://jobs.acme.co.uk/"))).toBe(true);
  });

  it("does not treat a shared hosting platform as one company", () => {
    const inScope = makeScope(new URL("https://acme.github.io/"));
    expect(inScope(new URL("https://acme.github.io/careers"))).toBe(true);
    expect(inScope(new URL("https://someone-else.github.io/"))).toBe(false);
  });
});

describe("canonicalKey", () => {
  it("treats trailing slashes and www as the same page", () => {
    expect(canonicalKey(new URL("https://www.acme.com/about/"))).toBe(canonicalKey(new URL("https://acme.com/about")));
  });
});
