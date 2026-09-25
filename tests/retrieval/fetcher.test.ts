import { describe, expect, it, vi } from "vitest";
import { Fetcher } from "@/retrieval/fetcher";

const PUBLIC = "http://93.184.215.14/"; // an IP literal, so the URL guard needs no DNS

function html(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
}

function fetcherWith(responses: Array<Response | Error | (() => Promise<Response>)>, allowPrivate = false) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return next!;
  });
  return { fetcher: new Fetcher({ policy: { allowPrivate }, minGapMs: 0, fetchImpl: fetchImpl as typeof fetch }), fetchImpl };
}

describe("Fetcher", () => {
  it("retries a 503 and then succeeds", async () => {
    const { fetcher, fetchImpl } = fetcherWith([
      new Response("busy", { status: 503, headers: { "retry-after": "0" } }),
      html("<p>ok</p>"),
    ]);
    const res = await fetcher.fetchText(PUBLIC, { accept: ["html"] });
    expect(res.text).toBe("<p>ok</p>");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const { fetcher, fetchImpl } = fetcherWith([new Response("nope", { status: 404 })]);
    await expect(fetcher.fetchText(PUBLIC, { accept: ["html"] })).rejects.toMatchObject({ code: "HTTP_ERROR", status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured attempts on repeated network failure", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const { fetcher, fetchImpl } = fetcherWith([refused, refused, refused]);
    await expect(fetcher.fetchText(PUBLIC, { accept: ["html"], attempts: 3 })).rejects.toMatchObject({ code: "NETWORK" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("re-checks every redirect hop, refusing a redirect into a private address", async () => {
    const { fetcher } = fetcherWith([new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })]);
    await expect(fetcher.fetchText(PUBLIC, { accept: ["html"] })).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("follows relative redirects and reports the final URL", async () => {
    const { fetcher } = fetcherWith([new Response(null, { status: 301, headers: { location: "/careers/" } }), html("jobs")], true);
    const res = await fetcher.fetchText("http://localhost:1/careers", { accept: ["html"] });
    expect(res.url).toBe("http://localhost:1/careers/");
  });

  it("refuses unexpected content types", async () => {
    const { fetcher } = fetcherWith([new Response("%PDF", { headers: { "content-type": "application/pdf" } })]);
    await expect(fetcher.fetchText(PUBLIC, { accept: ["html"] })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
  });

  it("caps the body size even when Content-Length is missing", async () => {
    const big = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(new Uint8Array(1000));
        controller.close();
      },
    });
    const { fetcher } = fetcherWith([new Response(big, { headers: { "content-type": "text/html" } })]);
    await expect(fetcher.fetchText(PUBLIC, { accept: ["html"], maxBytes: 5000 })).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("times out a server that never answers", async () => {
    const hang = () => new Promise<Response>((_, reject) => setTimeout(() => reject(new DOMException("t", "TimeoutError")), 50));
    const { fetcher } = fetcherWith([hang]);
    await expect(fetcher.fetchText(PUBLIC, { accept: ["html"], attempts: 1, timeoutMs: 20 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
