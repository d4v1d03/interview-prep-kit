import type { Kit, Question, Requirement } from "@/kit/schema";

export const requirements: Requirement[] = [
  { id: "r1", text: "5+ years with React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentoring junior engineers", kind: "behavioural", priority: "must" },
  { id: "r3", text: "Experience with payments", kind: "domain", priority: "nice" },
  { id: "r4", text: "Designing scalable APIs", kind: "technical", priority: "must" },
];

let n = 0;
export function question(partial: Partial<Question> & Pick<Question, "requirement_ids">): Question {
  n++;
  return {
    id: `q${n}`,
    category: "technical",
    prompt: `Question ${n}`,
    answer_outline: "Outline",
    difficulty: 2,
    ...partial,
  };
}

export function sampleKit(overrides: Partial<Kit> = {}): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.com",
      role: "Senior Frontend Engineer",
      location: "Remote",
      jd_chars: 1200,
      researched_at: "2026-09-24T10:00:00Z",
      pages_used: ["https://acme.com/"],
    },
    company_brief: { summary: "Acme makes billing software.", what_they_do: "Billing APIs.", sources: ["https://acme.com/"] },
    role: { title: "Senior Frontend Engineer", seniority: "senior", responsibilities: ["Build UI"], requirements },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "P", answer_outline: "A", difficulty: 3 },
      { id: "q2", requirement_ids: ["r2"], category: "behavioural", prompt: "P", answer_outline: "A", difficulty: 2 },
    ],
    flashcards: [{ id: "f1", front: "F", back: "B", requirement_ids: ["r1"] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "Technical", question_ids: ["q1"], minutes: 45 },
        { day: 2, focus: "Mock", question_ids: ["q1", "q2"], minutes: 40 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    ...overrides,
  };
}
