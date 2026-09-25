import type { Priority } from "@/kit/schema";

/**
 * Deterministic checks that keep the model honest about the job description.
 * The model must quote the posting for every requirement; this code decides
 * whether the quote is real and what the posting's own wording says about
 * priority. Inventing requirements is worse than reporting few.
 */

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have in is it its of on or our the their this to we will with you your years year experience strong good great ability".split(" "),
);

/** Lower-case, unify quotes/dashes/bullets, collapse whitespace: formatting noise must not reject a real quote. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[•·▪●◦*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(text: string): string[] {
  return normalise(text)
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

export type GroundingResult = { ok: true } | { ok: false; reason: string };

/**
 * A requirement is grounded when its quoted evidence appears in the posting
 * (verbatim after normalising, or with nearly all of its words present when the
 * model trimmed punctuation) and the requirement shares vocabulary with that quote.
 */
export function checkGrounding(requirementText: string, evidence: string, jd: string): GroundingResult {
  const quote = normalise(evidence).replace(/^["'\s-]+|["'\s.;,-]+$/g, "");
  if (quote.length < 2) return { ok: false, reason: "no quote from the posting" };

  const posting = normalise(jd);
  if (!posting.includes(quote)) {
    const quoteWords = contentWords(quote);
    const postingWords = new Set(contentWords(posting));
    const present = quoteWords.filter((w) => postingWords.has(w)).length;
    if (quoteWords.length < 3 || present / quoteWords.length < 0.9) {
      return { ok: false, reason: "quoted text does not appear in the posting" };
    }
  }

  const quoteWords = new Set(contentWords(quote));
  if (!contentWords(requirementText).some((w) => quoteWords.has(w))) {
    return { ok: false, reason: "requirement does not match its quote" };
  }
  return { ok: true };
}

// Strong markers make the whole line optional wherever they appear ("Kubernetes is a plus").
const NICE_INLINE = /\b(nice[- ]to[- ]have|bonus|a plus|not required|optional|extra credit|would be (great|nice))\b/i;
// Weak markers only when they open the line ("Ideally, you have…"): in "databases, ideally
// PostgreSQL" the word qualifies the detail, not the requirement.
const NICE_LEADING = /^\W*(ideally|preferably|preferred|desirable)\b/i;
const MUST_INLINE = /\b(required|must|mandatory|minimum|essential|at least)\b/i;
const NICE_HEADING = /\b(nice[- ]to[- ]haves?|bonus( points)?|preferred|pluses|desirable|ideally|good to have|extra credit|would be (great|nice))\b/i;
const MUST_HEADING = /\b(requirements?|required|must[- ]haves?|what you('ll)? (need|bring)|you (have|bring|are)|qualifications|minimum|who you are|about you)\b/i;

/**
 * What the posting's own wording says about a requirement's priority, or null
 * when it says nothing clear (then the model's reading stands). Inline wording
 * on the quoted line beats the section heading it sits under.
 */
export function priorityFromPosting(evidence: string, jd: string): Priority | null {
  const lines = jd.split(/\r?\n/);
  const quote = normalise(evidence).slice(0, 60);
  const at = lines.findIndex((line) => normalise(line).includes(quote));
  if (at === -1) return null;

  const line = lines[at];
  if (NICE_INLINE.test(line) || NICE_LEADING.test(line)) return "nice";
  if (MUST_INLINE.test(line)) return "must";

  for (let i = at - 1; i >= 0; i--) {
    const candidate = lines[i].trim();
    if (!isHeading(candidate)) continue;
    if (NICE_HEADING.test(candidate)) return "nice";
    if (MUST_HEADING.test(candidate)) return "must";
    return null; // nearest heading says nothing about priority
  }
  return null;
}

/** A short line that looks like a section title: "Requirements:", "## Nice to have", "BONUS POINTS". */
function isHeading(line: string): boolean {
  if (!line || line.length > 70) return false;
  if (/^#{1,6}\s/.test(line) || /:\s*$/.test(line)) return true;
  if (/^[•\-*·▪●◦]|^\d+[.)]\s/.test(line)) return false;
  const letters = line.replace(/[^a-z]/gi, "");
  return letters.length >= 4 && (letters === letters.toUpperCase() || line.split(/\s+/).length <= 5);
}
