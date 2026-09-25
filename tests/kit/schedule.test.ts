import { describe, expect, it } from "vitest";
import { buildSchedule, chunkFrontLoaded } from "@/kit/schedule";
import type { Question } from "@/kit/schema";
import { question, requirements } from "./helpers";

// 12 questions: a mix of must/nice requirements, difficulties and categories, in a deliberately unhelpful order.
const questions: Question[] = [
  question({ requirement_ids: ["r3"], difficulty: 1, category: "company-fit" }),
  question({ requirement_ids: ["r3"], difficulty: 2, category: "company-fit" }),
  question({ requirement_ids: ["r1"], difficulty: 1 }),
  question({ requirement_ids: ["r2"], difficulty: 2, category: "behavioural" }),
  question({ requirement_ids: ["r4"], difficulty: 3, category: "system-design" }),
  question({ requirement_ids: ["r1"], difficulty: 3 }),
  question({ requirement_ids: ["r2"], difficulty: 1, category: "behavioural" }),
  question({ requirement_ids: ["r1", "r4"], difficulty: 2 }),
  question({ requirement_ids: ["r3"], difficulty: 3, category: "company-fit" }),
  question({ requirement_ids: ["r4"], difficulty: 2, category: "system-design" }),
  question({ requirement_ids: ["r2"], difficulty: 3, category: "behavioural" }),
  question({ requirement_ids: [], difficulty: 1, category: "company-fit" }),
];
const byId = new Map(questions.map((q) => [q.id, q]));
const mustIds = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));
const isMust = (id: string) => byId.get(id)!.requirement_ids.some((r) => mustIds.has(r));

describe.each([1, 2, 3, 5, 11, 12, 30, 60, 90])("buildSchedule with %i day(s)", (days) => {
  const schedule = buildSchedule(questions, requirements, days);

  it("has exactly the days requested, numbered 1..N", () => {
    expect(schedule.days_available).toBe(days);
    expect(schedule.days.map((d) => d.day)).toEqual(Array.from({ length: days }, (_, i) => i + 1));
  });

  it("allocates every question, and only questions that exist", () => {
    const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
    expect([...scheduled].every((id) => byId.has(id))).toBe(true);
    expect(scheduled.size).toBe(questions.length);
  });

  it("puts every must-have requirement somewhere in the schedule", () => {
    const covered = new Set(schedule.days.flatMap((d) => d.question_ids).flatMap((id) => byId.get(id)!.requirement_ids));
    for (const id of mustIds) expect(covered).toContain(id);
  });

  it("uses positive integer minutes and a focus on every day", () => {
    for (const d of schedule.days) {
      expect(Number.isInteger(d.minutes)).toBe(true);
      expect(d.minutes).toBeGreaterThan(0);
      expect(d.focus.length).toBeGreaterThan(0);
      expect(d.question_ids.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSchedule ordering", () => {
  it("lands must-have and harder material earlier, not the night before", () => {
    const { days } = buildSchedule(questions, requirements, 5);
    const learning = days.slice(0, -1);
    // No learning day contains a nice-only question while a later one still has must-have work.
    const firstNiceDay = learning.findIndex((d) => d.question_ids.some((id) => !isMust(id)));
    const lastMustDay = learning.findLastIndex((d) => d.question_ids.some(isMust));
    expect(firstNiceDay).toBeGreaterThanOrEqual(lastMustDay);
    // Day 1 is the hardest day of must-have material.
    const avgDifficulty = (ids: string[]) => ids.reduce((s, id) => s + byId.get(id)!.difficulty, 0) / ids.length;
    expect(avgDifficulty(learning[0].question_ids)).toBe(3);
  });

  it("makes the last day a mock interview over must-have questions, not new material", () => {
    const { days } = buildSchedule(questions, requirements, 5);
    const last = days.at(-1)!;
    expect(last.focus).toMatch(/mock interview/i);
    expect(last.question_ids.every(isMust)).toBe(true);
  });

  it("is deterministic", () => {
    expect(buildSchedule(questions, requirements, 7)).toEqual(buildSchedule(questions, requirements, 7));
  });

  it("fills a long schedule with review days rather than empty ones", () => {
    const { days } = buildSchedule(questions, requirements, 60);
    expect(days.filter((d) => d.focus.startsWith("Review")).length).toBe(60 - 1 - questions.length);
  });

  it("handles a kit with no questions without inventing any", () => {
    const { days } = buildSchedule([], requirements, 3);
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.question_ids.length === 0)).toBe(true);
  });

  it.each([0, -1, 366, 2.5, Number.NaN])("rejects %s days", (days) => {
    expect(() => buildSchedule(questions, requirements, days)).toThrow(RangeError);
  });
});

describe("chunkFrontLoaded", () => {
  it("gives the remainder to the earliest chunks", () => {
    expect(chunkFrontLoaded([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5], [6, 7]]);
  });
});
