import { describe, expect, it } from "vitest";
import { assessmentStats, describeCheck, LIMITS, problemStats, type AssessmentLike, type CheckLog } from "../site/lib/pyAssessment";

describe("describeCheck: plain-language outcome, resource limits, no test source", () => {
  it("passed", () => expect(describeCheck("", true)).toEqual({ kind: "passed", text: "All visible and hidden tests passed." }));
  it("time limit", () => {
    for (const m of ["Stopped after 10s", "Timed out waiting for the worker", "timeout"]) {
      const r = describeCheck(m, false);
      expect(r.kind).toBe("limit");
      expect(r.text).toContain(`${LIMITS.seconds} second limit`);
      expect(r.text).toMatch(/loop that never ends/);
    }
  });
  it("memory and recursion are limits too", () => {
    expect(describeCheck("MemoryError", false).kind).toBe("limit");
    expect(describeCheck("RecursionError: maximum recursion depth exceeded", false).text).toMatch(/recursion went too deep/);
  });
  it("runtime that did not start does not count against the learner", () => {
    const r = describeCheck("Python could not start: failed to initialize", false);
    expect(r.kind).toBe("error");
    expect(r.text).toMatch(/did not count/);
  });
  it("failures keep only the first line, capped; hidden test source never appears", () => {
    const r = describeCheck("A test failed: expected 3\nassert secret_hidden_case(7) == 9\n  File x", false);
    expect(r).toEqual({ kind: "failed", text: "A test failed: expected 3" });
    expect(describeCheck("x".repeat(900), false).text.length).toBeLessThanOrEqual(200);
    expect(describeCheck("NameError: name 'y' is not defined\nsecret", false).text).not.toContain("secret");
  });
});

describe("problem and assessment statistics", () => {
  const log: CheckLog[] = [
    { at: 60, ok: false, kind: "failed", visible: [1, 2], hidden: [0, 3] },
    { at: 200, ok: false, kind: "limit" },
    { at: 340, ok: true, kind: "passed", visible: [2, 2], hidden: [3, 3] },
  ];
  it("checks and time to first pass, limit hits, last hidden result", () => {
    expect(problemStats(log)).toEqual({ checks: 3, checksToPass: 3, secondsToPass: 340, limitHits: 1, hidden: [3, 3] });
    expect(problemStats(log.slice(0, 2))).toMatchObject({ checksToPass: null, secondsToPass: null, hidden: [0, 3] });
    expect(problemStats(undefined)).toEqual({ checks: 0, checksToPass: null, secondsToPass: null, limitHits: 0, hidden: null });
  });
  it("aggregates past assessments, tolerating old records without logs", () => {
    const h: AssessmentLike[] = [
      { at: "2026-11-01T00:00:00Z", usedSec: 1800, solved: 3, total: 3, durationMin: 45, problems: [{ slug: "a", passed: true, checks: 1 }, { slug: "b", passed: true, checks: 3 }, { slug: "c", passed: true, checks: 2 }] },
      { at: "2026-11-02T00:00:00Z", usedSec: 2700, solved: 1, total: 3, durationMin: 45, problems: [{ slug: "a", passed: true, checks: 2 }, { slug: "b", passed: false, checks: 5 }, { slug: "c", passed: false, checks: 0 }] },
    ];
    expect(assessmentStats(h)).toEqual({ taken: 2, averageScore: 67, bestScore: 100, averageMinutes: 38, checksPerSolve: 2, timeUsedShare: 83 });
    expect(assessmentStats([])).toEqual({ taken: 0, averageScore: null, bestScore: null, averageMinutes: null, checksPerSolve: null, timeUsedShare: null });
  });
});
