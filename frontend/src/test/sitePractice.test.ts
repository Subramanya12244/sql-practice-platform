// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { explainError } from "../site/lib/errorHelp";
import { rowDiff } from "../site/lib/resultCompare";
import { dueQuestions, practiceNext, topicScores } from "../site/lib/insights";
import { solutionSkeleton } from "../site/components/HintLadder";
import { parsePlan } from "../site/components/PlanTree";
import { execute, submit, type SqlDb } from "../site/lib/sqlRunner";
import type { Progress } from "../site/lib/progress";
import type { QuestionSummary, Topic } from "../site/types";

const q = (n: number, topic: string, difficulty = "Easy"): QuestionSummary => ({
  number: n, slug: `q${n}`, title: `Q${n}`, topic, topicLabel: topic, difficulty, concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "",
});
const index = [q(1, "a"), q(2, "a", "Medium"), q(3, "a"), q(4, "b"), q(5, "b"), q(6, "c")];
const topics: Topic[] = ["a", "b", "c"].map((s) => ({ slug: s, label: s.toUpperCase(), folder: s, questions: [] }));
const P = (questions: Progress["questions"]): Progress => ({ version: 1, questions, activeDays: [], cards: {} });

describe("insights", () => {
  it("ranks a struggled-with topic weakest and recommends its unsolved questions first", () => {
    const p = P({ 1: { attempts: 5, solvedAt: "2026-01-01T00:00:00Z" }, 4: { attempts: 1, solvedAt: "2026-01-01T00:00:00Z" }, 5: { attempts: 1, solvedAt: "2026-01-01T00:00:00Z" } });
    const scores = topicScores(index, topics, p);
    const a = scores.find((s) => s.topic === "a")!;
    const b = scores.find((s) => s.topic === "b")!;
    expect(a.weakness).toBeGreaterThan(b.weakness);
    expect(practiceNext(index, topics, p, 2).map((x) => x.number)).toEqual([3, 6]);
  });
  it("puts solved questions in the review queue after 3 days", () => {
    const p = P({ 1: { attempts: 1, solvedAt: "2026-01-01T09:00:00Z" }, 4: { attempts: 1, solvedAt: "2026-01-01T09:00:00Z", reviewDue: "2026-02-01" } });
    expect(dueQuestions(index, p, "2026-01-03").length).toBe(0);
    expect(dueQuestions(index, p, "2026-01-04").map((x) => x.number)).toEqual([1]);
  });
});

describe("coach", () => {
  it("explains common PostgreSQL errors", () => {
    expect(explainError('column "c.company_name" must appear in the GROUP BY clause or be used in an aggregate function')?.title).toBe("Column not grouped");
    expect(explainError('column reference "customer_id" is ambiguous')?.fix).toContain("o.customer_id");
    expect(explainError("aggregate functions are not allowed in WHERE")?.guide?.slug).toBe("group-by-having");
    expect(explainError("something unusual")).toBeNull();
  });
  it("diffs rows as multisets", () => {
    const d = rowDiff([[1], [2], [2]], [[1], [2], [3]]);
    expect(d).toMatchObject({ missing: [[3]], extra: [[2]], missingCount: 1, extraCount: 1 });
  });
  it("blanks literals and select list in the skeleton", () => {
    const s = solutionSkeleton("SELECT a, b FROM t WHERE x = 'y' AND n > 10;");
    expect(s).toContain("SELECT ___, ___");
    expect(s).toContain("'___'");
    expect(s).not.toContain("10");
  });
});

describe("browser DB features", () => {
  it("returns a row diff on a wrong submit and parses EXPLAIN JSON", async () => {
    const pg = new PGlite();
    await pg.exec(northwind);
    const db = pg as unknown as SqlDb;
    const r = await submit(db, "SELECT shipper_id FROM shippers WHERE shipper_id < 3", "SELECT shipper_id FROM shippers", false);
    expect(r.correct).toBe(false);
    expect(r.diff?.missingCount).toBe(1);
    const plan = await execute(db, "EXPLAIN (FORMAT JSON) SELECT * FROM orders o JOIN customers c ON c.customer_id = o.customer_id");
    expect(parsePlan(plan.rows[0][0])?.["Node Type"]).toMatch(/Join|Loop/);
  }, 60_000);
});

import { fallbackChallenge, weekStart } from "../site/lib/community";
import indexJson from "../../public/data/index.json";

describe("community helpers", () => {
  it("finds the Monday of the week", () => {
    expect(weekStart(new Date("2026-11-04T12:00:00Z"))).toBe("2026-11-02");
    expect(weekStart(new Date("2026-11-08T23:00:00Z"))).toBe("2026-11-02");
    expect(weekStart(new Date("2026-11-09T00:00:00Z"))).toBe("2026-11-09");
  });
  it("picks a stable set of 3 distinct questions per week", () => {
    const nums = Array.from({ length: 133 }, (_, i) => i + 1);
    const a = fallbackChallenge(nums, "2026-11-02");
    expect(a).toEqual(fallbackChallenge(nums, "2026-11-02"));
    expect(new Set(a).size).toBe(3);
    expect(fallbackChallenge(nums, "2026-11-09")).not.toEqual(a);
  });
});

const setFiles = import.meta.glob<string>("../site/content/sets/*.md", { eager: true, query: "?raw", import: "default" });
describe("interview sets", () => {
  it("only reference real question slugs", () => {
    const slugs = new Set((indexJson as { slug: string }[]).map((q) => q.slug));
    const bad = Object.entries(setFiles).flatMap(([p, raw]) =>
      (raw.match(/^questions:\s*\[([^\]]*)\]/m)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s && !slugs.has(s)).map((s) => `${p}: ${s}`),
    );
    expect(Object.keys(setFiles).length).toBe(4);
    expect(bad).toEqual([]);
  });
});

import { diagnose } from "../site/lib/resultCompare";
describe("result diagnosis", () => {
  const E = [[1, 10.5], [2, 0], [3, 7]];
  it("names concrete causes", () => {
    expect(diagnose(["id", "v"], [[1, 10.5], [1, 10.5], [2, 0], [3, 7]], ["id", "v"], E)[0]).toMatch(/duplicate row/);
    expect(diagnose(["id", "v"], [[1, 10.5]], ["id", "v"], E)[0]).toMatch(/2 expected row\(s\) are missing/);
    expect(diagnose(["id", "v"], [...E, [4, 1]], ["id", "v"], E)[0]).toMatch(/plus 1 extra/);
    expect(diagnose(["id", "v"], [[1, 10.504], [2, null], [3, 7]], ["id", "v"], E)).toEqual([
      "1 row(s) differ only by rounding — check ROUND(…::numeric, 2) and where you round (before or after aggregating).",
      "1 row(s) differ only by NULL vs 0 — COALESCE(…, 0) turns a missing aggregate into 0 (or the other way round).",
    ]);
    expect(diagnose(["v", "id"], [], ["id", "v"], E)[0]).toMatch(/different order/);
    expect(diagnose(["id", "value"], [], ["id", "v"], E)[0]).toBe("Rename column(s): value → v (use AS).");
  });
});
