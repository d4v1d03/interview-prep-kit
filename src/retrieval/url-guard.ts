import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { RetrievalError } from "./errors";

export type UrlPolicy = {
  /**
   * Allow loopback / private / link-local targets. Off for the deployed web app
   * (SSRF protection); on for local development and the batch CLI, whose test
   * company sites are served from localhost.
   */
  allowPrivate: boolean;
};

/** Parses and normalises a user-supplied company URL; a bare "acme.com" gets https://. */
export function parseCompanyUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) throw new RetrievalError("INVALID_URL", `"${input}" is not a valid web address.`);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new RetrievalError("INVALID_URL", `"${input}" is not a valid web address.`);
  }
  assertFetchableShape(url);
  return url;
}

function assertFetchableShape(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RetrievalError("INVALID_URL", `Only http and https addresses can be fetched (got ${url.protocol}).`);
  }
  if (url.username || url.password) {
    throw new RetrievalError("INVALID_URL", "Addresses with embedded credentials are not fetched.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // The URL parser tolerates odd hosts ("ht!tp"); a real one is an IP, localhost, or dotted DNS labels.
  const dnsName = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
  if (!(ipaddr.isValid(host) || host === "localhost" || dnsName.test(host))) {
    throw new RetrievalError("INVALID_URL", `"${url.hostname}" is not a valid host name.`);
  }
}

/** True for anything that is not ordinary public unicast (loopback, RFC1918, link-local, CGNAT, ULA...). */
export function isNonPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return true;
  // process() unwraps IPv4-mapped IPv6 such as ::ffff:127.0.0.1 before classifying.
  return ipaddr.process(address).range() !== "unicast";
}

/**
 * Checked before every request, including each redirect hop. Resolves the host
 * and rejects it if any of its addresses is non-public (unless policy allows).
 * Known limitation: a DNS answer could change between this check and the
 * connection (rebinding); pinning the resolved IP would close that gap.
 */
export async function assertUrlAllowed(url: URL, policy: UrlPolicy): Promise<void> {
  assertFetchableShape(url);
  if (policy.allowPrivate) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new RetrievalError("BLOCKED_URL", "Local addresses cannot be fetched.");
  }
  let addresses: string[];
  if (ipaddr.isValid(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new RetrievalError("DNS_FAILED", `Could not resolve ${host}.`);
    }
  }
  if (addresses.some(isNonPublicAddress)) {
    throw new RetrievalError("BLOCKED_URL", `${host} resolves to a private or reserved address.`);
  }
}
