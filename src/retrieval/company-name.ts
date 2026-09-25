import { registrableDomain } from "./ranking";

/**
 * Best-effort company name from what the site says about itself, falling back
 * to the address. Used to label the brief and to search public discussion.
 */
export function guessCompanyName(site: URL, siteName: string | null, title: string): string {
  if (siteName) return siteName;

  // "Acme — Payments for platforms" / "Home | Acme": the shortest segment is usually the brand.
  const segments = title
    .split(/\s+[|\-–—:·]\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(home|homepage|welcome)$/i.test(s));
  const shortest = segments.sort((a, b) => a.length - b.length)[0];
  if (shortest && shortest.length <= 40) return shortest;

  // Locally served test sites look like http://localhost:8099/acme/ — the path names the company.
  const isLocal = site.hostname === "localhost" || /^[\d.]+$/.test(site.hostname) || site.hostname.includes(":");
  const label = isLocal ? site.pathname.split("/").filter(Boolean)[0] : registrableDomain(site.hostname)?.split(".")[0];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : site.hostname;
}
