import { describe, expect, it } from "vitest";
import { applyOverride, customNumber, customToQuestion, overrideKey } from "../site/lib/contentOverrides";

describe("content overrides (010)", () => {
  const q = { number: 25, title: "Customers and Order Count", difficulty: "Medium" };
  const o = (x: object) => ({ kind: "sql" as const, ref: "25", disabled: false, title: null, difficulty: null, note: null, version: 1, updated_at: "", ...x });
  it("hides disabled questions and applies title/difficulty edits", () => {
    expect(applyOverride(q, undefined)).toBe(q);
    expect(applyOverride(q, o({ disabled: true }))).toBeUndefined();
    expect(applyOverride(q, o({ title: "Customers and orders", difficulty: "Easy" }))).toMatchObject({ number: 25, title: "Customers and orders", difficulty: "Easy" });
    expect(applyOverride(q, o({ note: "checked" }))).toMatchObject({ title: q.title, difficulty: "Medium" });
    expect(overrideKey("python", "safe-cast")).toBe("python:safe-cast");
  });
  it("maps custom questions to stable numbers outside the built-in range", () => {
    expect(customNumber("top-shippers")).toBe(customNumber("top-shippers"));
    expect(customNumber("top-shippers")).toBeGreaterThanOrEqual(100000);
    const qq = customToQuestion({ id: "x", slug: "top-shippers", title: "Top shippers", difficulty: "Easy", topic: "Aggregations", concepts: ["COUNT"], scenario: "S", problem: "P", objective: "O", expected_output: "", hints: ["h1", "h2"], explanation: "E", reference_query: "SELECT 1", sort_required: true, published: true, version: 1, updated_at: "" });
    expect(qq).toMatchObject({ slug: "top-shippers", referenceQuery: "SELECT 1", sortRequired: true, problem: "S\n\nP", approach: "1. h1\n2. h2" });
  });
});
