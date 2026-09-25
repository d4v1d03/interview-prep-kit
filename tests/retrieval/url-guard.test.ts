import { describe, expect, it } from "vitest";
import { assertUrlAllowed, isNonPublicAddress, parseCompanyUrl } from "@/retrieval/url-guard";

const production = { allowPrivate: false };

describe("parseCompanyUrl", () => {
  it("adds https to a bare domain", () => {
    expect(parseCompanyUrl("acme.com").toString()).toBe("https://acme.com/");
  });
  it.each(["ftp://acme.com", "javascript:alert(1)", "https://user:pw@acme.com", "http://"])("rejects %s", (url) => {
    expect(() => parseCompanyUrl(url)).toThrow();
  });
});

describe("isNonPublicAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"])(
    "flags %s",
    (ip) => expect(isNonPublicAddress(ip)).toBe(true),
  );
  it.each(["93.184.215.14", "2606:4700::6810:84e5"])("allows public %s", (ip) => {
    expect(isNonPublicAddress(ip)).toBe(false);
  });
});

describe("assertUrlAllowed", () => {
  it.each(["http://localhost:8099/acme/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data"])(
    "blocks %s in production",
    async (url) => {
      await expect(assertUrlAllowed(new URL(url), production)).rejects.toMatchObject({ code: "BLOCKED_URL" });
    },
  );
  it("allows local addresses when policy permits (dev / batch CLI)", async () => {
    await expect(assertUrlAllowed(new URL("http://localhost:8099/acme/"), { allowPrivate: true })).resolves.toBeUndefined();
  });
  it("allows a public IP literal without a DNS lookup", async () => {
    await expect(assertUrlAllowed(new URL("http://93.184.215.14/"), production)).resolves.toBeUndefined();
  });
});
