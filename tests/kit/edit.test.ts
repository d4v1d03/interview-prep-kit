import { describe, expect, it } from "vitest";
import { editQuestion, moveWithinCategory, nextId, reconcile, replaceCategory, unscheduledQuestions } from "@/kit/edit";
import type { Question } from "@/kit/schema";
import { sampleKit } from "./helpers";

const q = (id: string, category: Question["category"], extra: Partial<Question> = {}): Question => ({
  id,
  requirement_ids: ["r1"],
  category,
  prompt: `prompt ${id}`,
  answer_outline: "",
  difficulty: 2,
  origin: "generated",
  ...extra,
});

describe("replaceCategory (regenerating one category)", () => {
  const kit = sampleKit({
    questions: [
      q("q1", "technical"),
      q("q2", "technical", { edited: true, prompt: "my rewrite" }),
      q("q3", "technical", { pinned: true }),
      q("q4", "technical", { origin: "user", prompt: "my own question" }),
      q("q5", "behavioural", { requirement_ids: ["r2"] }),
      q("q6", "technical", { origin: "template" }),
    ],
  });
  const fresh = [q("q7", "technical"), q("q8", "technical")];
  const result = replaceCategory(kit, "technical", fresh);
  const ids = result.questions.map((x) => x.id);

  it("keeps edited, pinned and user-written questions in that category", () => {
    expect(ids).toEqual(expect.arrayContaining(["q2", "q3", "q4"]));
    expect(result.questions.find((x) => x.id === "q2")!.prompt).toBe("my rewrite");
  });

  it("replaces only the untouched system-written questions", () => {
    expect(ids).not.toContain("q1");
    expect(ids).not.toContain("q6");
    expect(ids).toEqual(expect.arrayContaining(["q7", "q8"]));
  });

  it("leaves other categories and other sections alone", () => {
    expect(ids).toContain("q5");
    expect(result.company_brief).toEqual(kit.company_brief);
    expect(result.flashcards).toEqual(kit.flashcards);
  });

  it("drops schedule entries for removed questions and recomputes coverage", () => {
    expect(result.schedule.days.flatMap((d) => d.question_ids)).not.toContain("q1");
    expect(result.coverage.uncovered_requirement_ids).toEqual(["r3", "r4"]);
  });
});

describe("editing", () => {
  it("marks a generated question as edited when its content changes", () => {
    expect(editQuestion(q("q1", "technical"), { prompt: "new" }).edited).toBe(true);
  });
  it("does not mark a pin toggle as an edit", () => {
    expect(editQuestion(q("q1", "technical"), { pinned: true }).edited).toBe(false);
  });
  it("moving to another category counts as an edit, so regeneration keeps it", () => {
    expect(editQuestion(q("q1", "technical"), { category: "behavioural" }).edited).toBe(true);
  });
});

describe("moveWithinCategory", () => {
  const list = [q("q1", "technical"), q("q2", "behavioural"), q("q3", "technical")];
  it("swaps with the neighbour of the same category, skipping other categories", () => {
    expect(moveWithinCategory(list, "q3", -1).map((x) => x.id)).toEqual(["q3", "q2", "q1"]);
  });
  it("does nothing at the edge", () => {
    expect(moveWithinCategory(list, "q1", -1)).toBe(list);
  });
});

describe("ids and schedule freshness", () => {
  it("never reuses an id", () => {
    expect(nextId([{ id: "q1" }, { id: "q9" }, { id: "x" }], "q")).toBe("q10");
  });
  it("lists questions added since the schedule was built", () => {
    const kit = reconcile(sampleKit({ questions: [...sampleKit().questions, q("q9", "technical")] }));
    expect(unscheduledQuestions(kit).map((x) => x.id)).toEqual(["q9"]); // q1 and q2 are on the sample schedule
  });
});
