import { describe, expect, it } from "vitest";
import { change, learningAnalytics } from "../site/lib/learningAnalytics";
import type { QuestionSummary } from "../site/types";

describe("personal learning analytics", () => {
  it("computes accuracy, first-try success, solve time and weekly time from tracked data only", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    const index = [{ number: 1, topic: "j", topicLabel: "Joins", difficulty: "Easy" }, { number: 2, topic: "j", topicLabel: "Joins", difficulty: "Hard" }, { number: 3, topic: "a", topicLabel: "Agg", difficulty: "Easy" }] as QuestionSummary[];
    const p = { version: 1 as const, activeDays: [], cards: {}, lessons: { "py:x": "2026-11-01" }, questions: {
      1: { attempts: 1, practiced: true, solvedAt: "2026-11-01", solveSec: 300 },
      2: { attempts: 3, practiced: true, solvedAt: "2026-11-02", solveSec: 900, errorKinds: { "Wrong result": 2 } },
      3: { attempts: 2, practiced: true, errorKinds: { "SQL error": 2 } },
    } };
    const ex = [{ slug: "x", difficulty: "Easy" }, { slug: "y", difficulty: "Hard" }] as never;
    const stats = { x: { attempts: 1, passes: 1, lastAt: "", lastOk: true }, y: { attempts: 3, passes: 1, lastAt: "", lastOk: true } };
    const mins = ["2026-11-06T10:00:00.000Z", "2026-11-05T10:00:00.000Z", "2026-10-28T10:00:00.000Z"];
    const a = learningAnalytics(index, ex, p, stats, mins, now);
    expect(a.sql).toMatchObject({ solved: 2, submits: 6, accuracy: 33, firstTry: { n: 1, of: 2 }, avgSolveMin: 10 });
    expect(a.sql.byLevel).toEqual([{ level: "Easy", done: 1, total: 2 }, { level: "Medium", done: 0, total: 0 }, { level: "Hard", done: 1, total: 1 }]);
    expect(a.sql.topics.find((t) => t.label === "Agg")).toMatchObject({ submits: 2, accuracy: 0 });
    expect(a.python).toMatchObject({ solved: 1, accuracy: 50, firstTry: { n: 1, of: 2 } });
    expect([a.time.thisWeek, a.time.lastWeek]).toEqual([2, 1]);
    expect(change(2, 1)).toBe("+100%");
    expect(change(0, 0)).toBe("—");
  });
});
