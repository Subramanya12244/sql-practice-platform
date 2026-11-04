import { describe, expect, it } from "vitest";
import { MOCK_SIZE, formatClock, mockScore, pickMockQuestions, remainingSec, type MockSession } from "../site/lib/mock";
import { erDiagramSource } from "../site/lib/data";
import type { QuestionSummary, SchemaTable } from "../site/types";

const q = (n: number, difficulty: string, topic: string): QuestionSummary => ({
  number: n, slug: `q${n}`, title: `Q${n}`, topic, topicLabel: topic, difficulty, concepts: [],
  hadMistakes: false, watchOutFor: "", takeaway: "",
});

const index = [
  ...[1, 2, 3, 4].map((n) => q(n, "Easy", n % 2 ? "a" : "b")),
  ...[5, 6, 7, 8].map((n) => q(n, "Medium", n % 2 ? "c" : "d")),
  ...[9, 10, 11].map((n) => q(n, "Hard", n % 2 ? "e" : "f")),
];

// Deterministic PRNG so the test is stable.
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe("pickMockQuestions", () => {
  it("picks 5 distinct questions with the balanced mix, easiest first", () => {
    const slugs = pickMockQuestions(index, "balanced", seeded(7));
    expect(slugs).toHaveLength(MOCK_SIZE);
    expect(new Set(slugs).size).toBe(MOCK_SIZE);
    const diffs = slugs.map((s) => index.find((x) => x.slug === s)!.difficulty);
    expect(diffs).toEqual(["Easy", "Easy", "Medium", "Medium", "Hard"]);
  });

  it("tops up from other difficulties when a bucket is short", () => {
    const few = [q(1, "Easy", "a"), q(2, "Easy", "b"), q(3, "Easy", "c"), q(4, "Medium", "d"), q(5, "Medium", "e"), q(6, "Medium", "f")];
    expect(pickMockQuestions(few, "harder", seeded(3))).toHaveLength(5);
  });
});

describe("mock session helpers", () => {
  const s: MockSession = { slugs: ["a", "b"], durationMin: 30, level: "balanced", startedAt: 0, current: 0, results: { a: { attempts: 2, correct: true } } };
  it("counts remaining time and score", () => {
    expect(remainingSec(s, 60_000)).toBe(29 * 60);
    expect(remainingSec(s, 99 * 60_000)).toBe(0);
    expect(mockScore({ ...s, finishedAt: 600_000 })).toEqual({ solved: 1, total: 2, usedSec: 600 });
    expect(formatClock(125)).toBe("02:05");
  });
});

describe("erDiagramSource", () => {
  it("emits relationships and typed columns", () => {
    const schema: SchemaTable[] = [
      { name: "customers", columns: [{ name: "customer_id", type: "varchar(10)", pk: true, notNull: true, fk: null }] },
      { name: "orders", columns: [{ name: "customer_id", type: "varchar(10)", pk: false, notNull: false, fk: { table: "customers", column: "customer_id" } }] },
    ];
    const src = erDiagramSource(schema);
    expect(src).toContain('customers ||--o{ orders : "customer_id"');
    expect(src).toContain("varchar customer_id PK");
    expect(src).toContain("varchar customer_id FK");
  });
});
