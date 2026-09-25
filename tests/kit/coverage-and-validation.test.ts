import { describe, expect, it } from "vitest";
import { findUncovered, prioritiseGaps } from "@/kit/coverage";
import { validateKit } from "@/kit/schema";
import { requirements, sampleKit } from "./helpers";

describe("findUncovered", () => {
  it("reports every requirement no question references", () => {
    const gaps = findUncovered(requirements, [{ requirement_ids: ["r1"] }, { requirement_ids: ["r1", "r2"] }]);
    expect(gaps.map((r) => r.id)).toEqual(["r3", "r4"]);
  });

  it("reports nothing when every requirement is referenced", () => {
    expect(findUncovered(requirements, [{ requirement_ids: ["r1", "r2", "r3", "r4"] }])).toEqual([]);
  });

  it("treats a question that references no requirement as covering nothing", () => {
    expect(findUncovered(requirements, [{ requirement_ids: [] }])).toHaveLength(4);
  });

  it("puts must-have gaps first", () => {
    const ordered = prioritiseGaps(requirements.filter((r) => r.id !== "r1").reverse());
    expect(ordered.map((r) => r.priority)).toEqual(["must", "must", "nice"]);
  });
});

describe("validateKit", () => {
  it("accepts a well-formed kit, including extension fields", () => {
    const kit = sampleKit();
    (kit as Record<string, unknown>).my_extension = { anything: true };
    expect(validateKit(kit).ok).toBe(true);
  });

  it("rejects missing Appendix A fields", () => {
    const { coverage: _dropped, ...rest } = sampleKit();
    const result = validateKit(rest);
    expect(result.ok).toBe(false);
  });

  it("rejects non-integer minutes and out-of-range difficulty", () => {
    const kit = sampleKit();
    kit.schedule.days[0].minutes = 45.5;
    kit.questions[0].difficulty = 4;
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.path)).toEqual(["questions.0.difficulty", "schedule.days.0.minutes"]);
  });

  it("rejects a schedule whose day count differs from days_available", () => {
    const kit = sampleKit();
    kit.schedule.days_available = 3;
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
  });

  it("rejects references to questions or requirements that do not exist", () => {
    const kit = sampleKit();
    kit.schedule.days[0].question_ids.push("q99");
    kit.questions[0].requirement_ids.push("r99");
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.message)).toEqual(['unknown requirement "r99"', 'unknown question "q99"']);
  });

  it("rejects duplicate ids", () => {
    const kit = sampleKit();
    kit.questions[1].id = "q1";
    expect(validateKit(kit).ok).toBe(false);
  });

  it("rejects an unknown question category", () => {
    const kit = sampleKit();
    (kit.questions[0] as Record<string, unknown>).category = "trivia";
    expect(validateKit(kit).ok).toBe(false);
  });
});
