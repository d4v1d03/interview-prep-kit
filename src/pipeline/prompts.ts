import { z } from "zod";
import { PRIORITIES, REQUIREMENT_KINDS, type QuestionCategory } from "@/kit/schema";
import { UNTRUSTED_CONTENT_RULE } from "@/llm/gemini";

/**
 * Every prompt the pipeline sends, in one place. Each has a narrow job and a
 * schema; everything the model returns is checked again in code afterwards.
 */

// ---------------------------------------------------------------- extraction

export const extractionSchema = z.object({
  company: z.string().nullable(),
  title: z.string(),
  seniority: z.string(),
  location: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(
    z.object({
      text: z.string(),
      evidence: z.string(),
      kind: z.enum(REQUIREMENT_KINDS),
      priority: z.enum(PRIORITIES),
    }),
  ),
});

export const EXTRACTION_SYSTEM = `You extract hiring requirements from a job posting, precisely and conservatively.

Rules:
- Only list requirements the posting actually states. Never add skills that are merely typical for the role. If the posting is short, return few requirements; an empty list is acceptable.
- "evidence" must be copied verbatim from the posting: the exact words the requirement comes from (at most ~25 words).
- "text" is a short, faithful restatement of that one requirement.
- One requirement per bullet or sentence; split only when one line joins clearly unrelated qualifications.
- Do not turn responsibilities, benefits, company descriptions, equal-opportunity statements or application instructions into requirements. Responsibilities go in "responsibilities".
- kind: "technical" (languages, tools, engineering skills, years of technical experience), "behavioural" (communication, leadership, mentoring, collaboration, ownership), "domain" (industry or subject knowledge, e.g. payments, healthcare, regulation).
- priority: "nice" when the posting marks it optional (nice to have, bonus, a plus, preferred, ideally); otherwise "must" when it is presented as something the candidate needs.
- company: the hiring company's name if the posting states it, else null. title: the job title as written. seniority: one of intern, junior, mid, senior, staff, principal, lead, manager, or "unspecified". location: as written, or "unspecified".

${UNTRUSTED_CONTENT_RULE}`;

// ---------------------------------------------------------------- company brief

export const briefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
  hiring_process: z
    .object({
      summary: z.string(),
      stages: z.array(z.string()),
      sources: z.array(z.string()),
    })
    .nullable(),
});

export const BRIEF_SYSTEM = `You write a short, factual company brief for someone preparing for an interview, using only the pages provided.

Rules:
- Use only facts stated in the provided pages. Do not use outside knowledge about the company, even if you recognise it.
- summary: 2–4 sentences on who the company is. what_they_do: their products or services and who uses them, concretely.
- If the pages do not say what the company does, say exactly that instead of guessing.
- hiring_process: only if a provided company page or discussion describes how they interview. List the stages in order. Label anything taken only from public discussion as anecdotal ("reportedly", "according to a Hacker News comment"). Otherwise null.
- sources / hiring_process.sources: the URLs (exactly as given) of the pages you actually used.

${UNTRUSTED_CONTENT_RULE}`;

// ---------------------------------------------------------------- questions

export const questionBatchSchema = z.object({
  questions: z.array(
    z.object({
      requirement_ids: z.array(z.string()),
      prompt: z.string(),
      answer_outline: z.string(),
      difficulty: z.number().int().min(1).max(3),
    }),
  ),
  flashcards: z.array(
    z.object({
      requirement_ids: z.array(z.string()),
      front: z.string(),
      back: z.string(),
    }),
  ),
});

const COMMON_QUESTION_RULES = `- Every question must list in requirement_ids the ids (from the list given) that it tests. Use only ids from that list.
- answer_outline: 3–6 short points a strong answer covers, written as notes for the candidate — not a script.
- difficulty: 1 = warm-up, 2 = typical, 3 = hard/probing. Match the role's seniority.
- Flashcards: one per requirement, front = a short recall prompt (a concept, a term, a trade-off), back = a concise answer of 1–3 sentences.
- Do not invent facts about the company. Use the company context only where it is given.`;

/** Different instructions per category: a React skill and mentoring juniors are not asked about the same way. */
export const CATEGORY_INSTRUCTIONS: Record<QuestionCategory, string> = {
  technical: `You write technical interview questions that test hands-on depth in specific skills.
- Ask about concrete situations, debugging, trade-offs and "how would you" problems — not trivia or definitions.
- Pitch the depth to the stated years of experience and seniority.`,
  behavioural: `You write behavioural interview questions about past experience.
- Phrase them as "Tell me about a time…" / "Describe a situation…" prompts tied to the requirement.
- The answer_outline should follow STAR (situation, task, action, result) and say what the interviewer listens for.`,
  "system-design": `You write system design interview questions.
- Pose a design problem the candidate could plausibly face at this company, grounded in the company context if it is given; otherwise a problem suited to the requirements.
- The answer_outline should cover clarifying requirements, core components, data model, scaling, failure modes and trade-offs.`,
  "company-fit": `You write company-fit and motivation questions.
- Ask why this company and role, how the candidate would work within the company's stated way of working, and domain questions for any domain requirements.
- Use only facts from the company context. If the context says little, keep questions about motivation and the role rather than inventing company details.`,
};

export function questionSystem(category: QuestionCategory): string {
  return `${CATEGORY_INSTRUCTIONS[category]}

${COMMON_QUESTION_RULES}

${UNTRUSTED_CONTENT_RULE}`;
}

export const GAP_SYSTEM = `You write interview questions for requirements that the current question bank does not cover yet.

- Write exactly the number of questions asked for each listed requirement, and put that requirement's id in requirement_ids.
- Match the category given for each requirement: technical depth for technical ones, "Tell me about a time…" for behavioural ones, company/domain understanding for domain ones.
${COMMON_QUESTION_RULES}

${UNTRUSTED_CONTENT_RULE}`;

export const gapBatchSchema = z.object({
  questions: z.array(
    z.object({
      requirement_ids: z.array(z.string()),
      category: z.enum(["technical", "behavioural", "system-design", "company-fit"]),
      prompt: z.string(),
      answer_outline: z.string(),
      difficulty: z.number().int().min(1).max(3),
    }),
  ),
});
