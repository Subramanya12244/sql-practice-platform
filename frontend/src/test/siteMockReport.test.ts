import { describe, expect, it } from "vitest";
import { buildMockReport, topicSummary } from "../site/lib/mockReport";
import type { MockSession } from "../site/lib/mock";
import type { QuestionSummary } from "../site/types";

const q = (number: number, topic: string, topicLabel: string, difficulty = "Easy"): QuestionSummary => ({ number, slug: `q${number}`, title: `Question ${number}`, topic, topicLabel, difficulty, concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "" }) as QuestionSummary;
const index = [q(1, "joins", "Joins"), q(2, "joins", "Joins"), q(3, "cte", "CTEs"), q(4, "window", "Window functions"), q(5, "agg", "Aggregations")];
const session = (results: MockSession["results"]): MockSession => ({ slugs: ["q1", "q2", "q3", "q4", "q5"], durationMin: 30, level: "balanced", startedAt: 0, current: 4, finishedAt: 1_800_000, results });

describe("mock interview report", () => {
  const results = {
    q1: { attempts: 1, correct: true, solvedAfterSec: 120 },
    q2: { attempts: 3, correct: false },
    q3: { attempts: 2, correct: true, solvedAfterSec: 600 },
    q4: { attempts: 0, correct: false }, // never tried
    q5: { attempts: 1, correct: true, solvedAfterSec: 60 },
  };
  const questions = { 1: { attempts: 1, lastSql: "SELECT * FROM customers" }, 2: { attempts: 3, lastSql: "SELECT a FROM t WHERE b = NULL" }, 4: { attempts: 0, lastSql: "SELECT * FROM never_ran" } };

  it("scores by topic, weakest first, with attempts and average time to solve", () => {
    const r = buildMockReport(session(results), index, { questions });
    expect(r.topics.map((t) => [t.label, t.solved, t.total])).toEqual([["Window functions", 0, 1], ["Joins", 1, 2], ["Aggregations", 1, 1], ["CTEs", 1, 1]]);
    const joins = r.topics.find((t) => t.topic === "joins")!;
    expect(joins).toMatchObject({ attempts: 4, avgSolveSec: 120 });
    expect(r.avgSolveSec).toBe(260); // (120 + 600 + 60) / 3
    expect(r.firstTry).toBe(2);
  });
  it("lists what to revise: only topics with a miss, with the missed questions", () => {
    const r = buildMockReport(session(results), index, { questions });
    expect(r.revision.map((a) => [a.label, a.missed.map((m) => m.slug)])).toEqual([["Joins", ["q2"]], ["Window functions", ["q4"]]]);
  });
  it("quality notes are heuristics from the last saved query, only for questions that were attempted", () => {
    const r = buildMockReport(session(results), index, { questions });
    const texts = r.quality.map((n) => n.text);
    expect(texts.some((t) => /= NULL/.test(t))).toBe(true);
    expect(texts.some((t) => /SELECT \*/.test(t))).toBe(true);
    expect(r.quality.every((n) => n.question !== "Q4 Question 4")).toBe(true); // q4 had 0 attempts: its stale draft is ignored
    expect(r.quality[0].level).toBe("warn"); // warnings first
  });
  it("never changes the score: the report has no solved/total of its own", () => {
    const r = buildMockReport(session(results), index, { questions });
    expect(Object.keys(r).sort()).toEqual(["avgSolveSec", "firstTry", "quality", "revision", "topics"]);
  });
  it("handles an empty or unknown session and keeps a compact history summary", () => {
    const r = buildMockReport({ ...session({}), slugs: ["nope"] }, index, { questions: {} });
    expect(r).toMatchObject({ topics: [], quality: [], revision: [], firstTry: 0, avgSolveSec: null });
    expect(topicSummary(buildMockReport(session(results), index, { questions }))[0]).toEqual({ topic: "window", label: "Window functions", solved: 0, total: 1 });
  });
});
