import { describe, expect, it } from "vitest";
import { checkGrounding, priorityFromPosting } from "@/pipeline/grounding";

const jd = `Senior Backend Engineer

About the role
You will build our payments ledger.

Requirements:
• 5+ years of experience with Node.js or Go
• Strong knowledge of PostgreSQL — indexing, query plans
• Experience mentoring junior engineers
• Kubernetes experience is a plus

Nice to have
- Experience in fintech or payments
- Familiarity with Terraform
`;

describe("checkGrounding", () => {
  it("accepts a requirement whose quote is in the posting, despite bullets, dashes and case", () => {
    expect(checkGrounding("PostgreSQL indexing and query plans", "strong knowledge of PostgreSQL - indexing, query plans", jd)).toEqual({ ok: true });
  });

  it("accepts a quote with trimmed punctuation", () => {
    expect(checkGrounding("5+ years with Node.js or Go", "5+ years of experience with Node.js or Go.", jd).ok).toBe(true);
  });

  it("rejects an invented requirement whose quote is not in the posting", () => {
    const result = checkGrounding("AWS certification", "AWS Solutions Architect certification required", jd);
    expect(result).toEqual({ ok: false, reason: "quoted text does not appear in the posting" });
  });

  it("rejects a real quote attached to an unrelated requirement", () => {
    const result = checkGrounding("Machine learning expertise", "Experience mentoring junior engineers", jd);
    expect(result).toEqual({ ok: false, reason: "requirement does not match its quote" });
  });

  it("rejects an empty quote", () => {
    expect(checkGrounding("Go", "", jd).ok).toBe(false);
  });
});

describe("priorityFromPosting", () => {
  it("reads a requirements heading as must", () => {
    expect(priorityFromPosting("Experience mentoring junior engineers", jd)).toBe("must");
  });

  it("lets inline wording beat the heading ('is a plus' under Requirements)", () => {
    expect(priorityFromPosting("Kubernetes experience is a plus", jd)).toBe("nice");
  });

  it("reads a nice-to-have heading as nice", () => {
    expect(priorityFromPosting("Familiarity with Terraform", jd)).toBe("nice");
    expect(priorityFromPosting("Experience in fintech or payments", jd)).toBe("nice");
  });

  it("does not demote a requirement because 'ideally' qualifies a detail inside it", () => {
    const posting = "Requirements\n- Solid understanding of relational databases, ideally PostgreSQL\n- Ideally, experience with Kafka";
    expect(priorityFromPosting("Solid understanding of relational databases, ideally PostgreSQL", posting)).toBe("must");
    expect(priorityFromPosting("Ideally, experience with Kafka", posting)).toBe("nice");
  });

  it("returns null when the posting gives no signal", () => {
    expect(priorityFromPosting("You will build our payments ledger", jd)).toBeNull();
    expect(priorityFromPosting("Backend engineer, Python.", "Backend engineer, Python.")).toBeNull();
  });
});
