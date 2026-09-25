import type { LlmCall, LlmClient } from "@/llm/gemini";

export const JD = `Senior Backend Engineer — Acme Payments (Remote, EU)

You will own services in our billing ledger.

Requirements:
- 4+ years building production services in TypeScript
- Deep knowledge of PostgreSQL
- Experience mentoring other engineers

Bonus points:
- Background in payments or fintech
`;

/** A scripted model: answers by call name, and records every call it receives. */
export class ScriptedLlm implements LlmClient {
  calls: string[] = [];
  constructor(private readonly script: Record<string, (call: LlmCall<unknown>) => unknown>) {}
  async generateJson<T>(call: LlmCall<T>): Promise<T> {
    this.calls.push(call.name);
    const answer = Object.entries(this.script).find(([prefix]) => call.name.startsWith(prefix))?.[1];
    if (!answer) throw new Error(`unexpected call ${call.name}`);
    return call.schema.parse(answer(call as LlmCall<unknown>));
  }
}

export const q = (ids: string[], prompt: string, difficulty = 2) => ({ requirement_ids: ids, prompt, answer_outline: "points", difficulty });

export const script: Record<string, (call: LlmCall<unknown>) => unknown> = {
  "extract-requirements": () => ({
    company: "Acme Payments",
    title: "Senior Backend Engineer",
    seniority: "senior",
    location: "Remote, EU",
    responsibilities: ["Own services in the billing ledger"],
    requirements: [
      { text: "4+ years with TypeScript", evidence: "4+ years building production services in TypeScript", kind: "technical", priority: "must" },
      { text: "PostgreSQL", evidence: "Deep knowledge of PostgreSQL", kind: "technical", priority: "must" },
      { text: "Mentoring engineers", evidence: "Experience mentoring other engineers", kind: "behavioural", priority: "must" },
      // The model marks this must; the posting puts it under "Bonus points", so code corrects it.
      { text: "Payments background", evidence: "Background in payments or fintech", kind: "domain", priority: "must" },
      // Invented: not in the posting, so code must drop it.
      { text: "Kubernetes", evidence: "Hands-on Kubernetes experience", kind: "technical", priority: "must" },
    ],
  }),
  "company-brief": (call: LlmCall<unknown>) => ({
    summary: "Acme Payments provides billing APIs.",
    what_they_do: "Billing and payments APIs for software platforms.",
    sources: [call.prompt.match(/URL: (\S+)/)![1], "https://made-up.example/about"],
    hiring_process: {
      summary: "Recruiter call, take-home, technical interview with system design, values interview.",
      stages: ["Recruiter call", "Take-home", "Technical + system design", "Values"],
      sources: [call.prompt.match(/URL: (\S+how-we-interview\.html)/)![1]],
    },
  }),
  "questions-technical": () => ({
    questions: [q(["r1"], "How do you type a discriminated union?", 3), q(["r99"], "Question citing an unknown id")],
    flashcards: [{ requirement_ids: ["r1"], front: "Discriminated union?", back: "A tagged union." }],
  }),
  "questions-system-design": () => ({ questions: [q(["r1"], "Design an idempotent payments API.", 3)], flashcards: [] }),
  "questions-behavioural": () => ({ questions: [q(["r3"], "Tell me about mentoring someone.")], flashcards: [] }),
  "questions-company-fit": () => ({ questions: [q([], "Why Acme?", 1)], flashcards: [] }),
  // First gap pass covers PostgreSQL only; the second covers nothing, forcing the template fallback.
  "coverage-gap-pass-1": () => ({ questions: [{ ...q(["r2"], "How would you debug a slow query?"), category: "technical" }] }),
  "coverage-gap-pass-2": () => ({ questions: [] }),
};

