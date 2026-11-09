import { describe, expect, it } from "vitest";
import {
  weekActivity,
  getRecommendedNextSql,
  getRecommendedNextPython,
  getFrequentMistakes,
  getRecentCompletions,
  getOverallProgressSummary,
} from "../site/lib/dashboard";
import type { Progress } from "../site/lib/progress";
import type { QuestionSummary } from "../site/types";
import type { PyExerciseMeta } from "../site/lib/pyExercises";

const EMPTY: Progress = { version: 1, questions: {}, activeDays: [], cards: {} };

const SAMPLE_QUESTIONS: QuestionSummary[] = [
  { number: 1, title: "Order List", slug: "order-list", difficulty: "Easy", topic: "select", topicLabel: "SELECT Queries", concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "" },
  { number: 2, title: "High Value", slug: "high-value", difficulty: "Medium", topic: "where", topicLabel: "Filtering", concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "" },
  { number: 3, title: "Customer Agg", slug: "customer-agg", difficulty: "Hard", topic: "aggregate", topicLabel: "Aggregates", concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "" },
];

const SAMPLE_EXERCISES: PyExerciseMeta[] = [
  { slug: "convert-temp", title: "Convert Temp", difficulty: "Easy", description: "", topic: "basics", minutes: 5, code: "PY-023", concepts: [], category: "fundamentals", skill: "basics", time: "O(1)", space: "O(1)" },
  { slug: "filter-orders", title: "Filter Orders", difficulty: "Medium", description: "", topic: "conditions", minutes: 10, code: "PY-021", concepts: [], category: "fundamentals", skill: "conditions", time: "O(n)", space: "O(1)" },
];

describe("dashboard metrics", () => {
  it("returns the last 7 days with zeros for gaps", () => {
    const w = weekActivity({ ...EMPTY, dayCounts: { "2026-11-05": 3, "2026-11-01": 1 } }, "2026-11-05");
    expect(w.map((d) => d.day)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(w.map((d) => d.count)).toEqual([0, 0, 1, 0, 0, 0, 3]);
  });

  it("gives a new visitor an empty week", () => {
    expect(weekActivity(EMPTY, "2026-11-05").every((d) => d.count === 0)).toBe(true);
  });

  describe("getRecommendedNextSql", () => {
    it("recommends question 1 for brand new learners", () => {
      const rec = getRecommendedNextSql(SAMPLE_QUESTIONS, EMPTY);
      expect(rec).not.toBeNull();
      expect(rec?.question.number).toBe(1);
      expect(rec?.reason).toBe("next_in_order");
    });

    it("prioritizes resuming an in-progress attempted question", () => {
      const progress: Progress = {
        ...EMPTY,
        questions: {
          1: { attempts: 1, solvedAt: "2026-11-08T10:00:00Z" },
          2: { attempts: 3 }, // attempted 3 times, not yet solved
        },
      };
      const rec = getRecommendedNextSql(SAMPLE_QUESTIONS, progress);
      expect(rec?.question.number).toBe(2);
      expect(rec?.reason).toBe("resume");
      expect(rec?.detail).toContain("3 times");
    });

    it("recommends next unsolved when no question is in-progress", () => {
      const progress: Progress = {
        ...EMPTY,
        questions: {
          1: { attempts: 1, solvedAt: "2026-11-08T10:00:00Z" },
        },
      };
      const rec = getRecommendedNextSql(SAMPLE_QUESTIONS, progress);
      expect(rec?.question.number).toBe(2);
      expect(rec?.reason).toBe("next_in_order");
    });
  });

  describe("getRecommendedNextPython", () => {
    it("recommends stage 1 exercise for new learner", () => {
      const rec = getRecommendedNextPython(SAMPLE_EXERCISES, EMPTY, {});
      expect(rec).not.toBeNull();
      expect(rec?.exercise.code).toBe("PY-023"); // stage 1
      expect(rec?.stage).toBe(1);
    });

    it("prioritizes resuming an in-progress exercise", () => {
      const stats = {
        "filter-orders": { attempts: 2, passes: 0, lastAt: "2026-11-08", lastOk: false },
      };
      const rec = getRecommendedNextPython(SAMPLE_EXERCISES, EMPTY, stats);
      expect(rec?.exercise.slug).toBe("filter-orders");
      expect(rec?.reason).toBe("resume");
    });
  });

  describe("getFrequentMistakes", () => {
    it("aggregates error kinds across questions sorted by frequency", () => {
      const progress: Progress = {
        ...EMPTY,
        questions: {
          1: { attempts: 2, errorKinds: { "Wrong row count": 2, "Column not grouped": 1 } },
          2: { attempts: 3, errorKinds: { "Column not grouped": 3, "Syntax error": 1 } },
        },
      };
      const mistakes = getFrequentMistakes(progress);
      expect(mistakes.length).toBe(3);
      expect(mistakes[0]).toEqual({ errorKind: "Column not grouped", count: 4 });
      expect(mistakes[1]).toEqual({ errorKind: "Wrong row count", count: 2 });
    });
  });

  describe("getRecentCompletions", () => {
    it("collects and sorts recently completed SQL and Python exercises", () => {
      const progress: Progress = {
        ...EMPTY,
        questions: {
          1: { attempts: 1, solvedAt: "2026-11-07T10:00:00Z" },
        },
        lessons: {
          "py:convert-temp": "2026-11-08T12:00:00Z",
        },
      };
      const recent = getRecentCompletions(progress, SAMPLE_QUESTIONS, SAMPLE_EXERCISES);
      expect(recent.length).toBe(2);
      expect(recent[0].kind).toBe("python");
      expect(recent[0].slug).toBe("convert-temp");
      expect(recent[1].kind).toBe("sql");
      expect(recent[1].id).toBe("Q1");
    });
  });

  describe("getOverallProgressSummary", () => {
    it("computes accurate percentages and activity flag", () => {
      const progress: Progress = {
        ...EMPTY,
        questions: {
          1: { attempts: 1, solvedAt: "2026-11-07T10:00:00Z" },
          2: { attempts: 1, solvedAt: "2026-11-08T10:00:00Z" },
        },
        lessons: {
          "py:convert-temp": "2026-11-08T12:00:00Z",
        },
        activeDays: ["2026-11-07", "2026-11-08"],
      };
      const s = getOverallProgressSummary(progress, 150, 150, 12, 1);
      expect(s.sqlSolved).toBe(2);
      expect(s.pyPassed).toBe(1);
      expect(s.projectsDone).toBe(1);
      expect(s.hasActivity).toBe(true);
    });
  });
});
