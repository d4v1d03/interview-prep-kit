import { describe, expect, it } from "vitest";
import { orderSession, progress, summarise } from "@/kit/practice";
import type { Flashcard } from "@/kit/schema";
import { requirements } from "./helpers";

const card = (id: string, requirement_ids: string[] = ["r1"]): Flashcard => ({ id, front: id, back: "", requirement_ids });
const cards = [card("f1"), card("f2"), card("f3"), card("f4"), card("f5", ["r3"]), card("f6")];

describe("summarise", () => {
  it("keeps the latest rating per card and counts every review", () => {
    const stats = summarise([
      { cardId: "f1", confidence: 1, reviewedAt: "2026-09-24T10:00:00Z" },
      { cardId: "f1", confidence: 3, reviewedAt: "2026-09-24T12:00:00Z" },
      { cardId: "f1", confidence: 2, reviewedAt: "2026-09-24T11:00:00Z" }, // arrives out of order
    ]);
    expect(stats.get("f1")).toMatchObject({ lastConfidence: 3, reviews: 3 });
  });
});

describe("orderSession", () => {
  const stats = summarise([
    { cardId: "f1", confidence: 3, reviewedAt: "2026-09-24T09:00:00Z" },
    { cardId: "f2", confidence: 2, reviewedAt: "2026-09-24T09:00:00Z" },
    { cardId: "f3", confidence: 1, reviewedAt: "2026-09-24T09:00:00Z" },
    { cardId: "f6", confidence: 2, reviewedAt: "2026-09-24T08:00:00Z" },
  ]);

  it("puts the least confident first, then unseen, then unsure, then known", () => {
    const order = orderSession(cards, stats, requirements).map((c) => c.id);
    expect(order[0]).toBe("f3"); // again
    expect(order.slice(1, 3)).toEqual(["f4", "f5"]); // never practised; must-have-linked f4 before nice-linked f5
    expect(order.slice(3, 5)).toEqual(["f6", "f2"]); // unsure, practised longest ago first
    expect(order.at(-1)).toBe("f1"); // knew it
  });

  it("with no history, keeps must-have cards ahead and otherwise kit order", () => {
    expect(orderSession(cards, new Map(), requirements).map((c) => c.id)).toEqual(["f1", "f2", "f3", "f4", "f6", "f5"]);
  });
});

describe("progress", () => {
  it("counts covered and uncovered cards, ignoring ratings for deleted cards", () => {
    const stats = summarise([
      { cardId: "f1", confidence: 3, reviewedAt: "2026-09-24T09:00:00Z" },
      { cardId: "f2", confidence: 1, reviewedAt: "2026-09-24T09:00:00Z" },
      { cardId: "deleted", confidence: 3, reviewedAt: "2026-09-24T09:00:00Z" },
    ]);
    expect(progress(cards, stats)).toEqual({ total: 6, covered: 2, again: 1, unsure: 0, knew: 1, notYet: 4 });
  });
});
