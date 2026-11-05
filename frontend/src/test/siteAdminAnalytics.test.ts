import { describe, expect, it } from "vitest";
import { difficultTopics, failedProblems, filterLearners, inactiveLearners, presetRange, toLearner, validRange, type ProblemLookup } from "../site/lib/adminAnalytics";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const L = (username: string, extra: Record<string, unknown> = {}) => toLearner({
  id: username, username, role: "user", created_at: "2026-01-01T00:00:00Z", last_seen_at: null, last_activity_at: null,
  sql_solved: "0", sql_attempts: "0", sql_submits: "0", sql_passed: "0", py_solved: "0", py_submits: "0", py_passed: "0",
  active_min_7d: "0", active_min_30d: "0", active_min_total: "0", sessions: "0", mocks: "0", ...extra,
});
const lookup: ProblemLookup = {
  sql: new Map([[7, { title: "Joins", topic: "Joins", path: "/questions/q07-x" }], [8, { title: "More joins", topic: "Joins", path: "/questions/q08-x" }]]),
  python: new Map([["safe-cast", { title: "PY-019 Safe Cast", topic: "Fundamentals" }]]),
};

describe("admin analytics helpers", () => {
  it("normalises bigint strings and filters/sorts learners", () => {
    const all = [L("ann", { sql_solved: "5", last_activity_at: "2026-11-04T00:00:00Z", sql_submits: "4", sql_passed: "1" }), L("bob", { sql_solved: "9", last_activity_at: "2026-10-01T00:00:00Z" }), L("cy", { role: "admin" })];
    expect(all[0].sql_solved).toBe(5);
    const base = { q: "", role: "" as const, activity: "" as const, sort: "sql_solved" as const, desc: true };
    expect(filterLearners(all, base, NOW).map((l) => l.username)).toEqual(["bob", "ann", "cy"]);
    expect(filterLearners(all, { ...base, activity: "active7" }, NOW).map((l) => l.username)).toEqual(["ann"]);
    expect(filterLearners(all, { ...base, activity: "inactive14" }, NOW).map((l) => l.username)).toEqual(["bob", "cy"]);
    expect(filterLearners(all, { ...base, role: "admin" }, NOW).map((l) => l.username)).toEqual(["cy"]);
    expect(filterLearners(all, { ...base, q: "AN" }, NOW).map((l) => l.username)).toEqual(["ann"]);
    expect(filterLearners(all, { ...base, sort: "accuracy" }, NOW)[0].username).toBe("ann");
    expect(inactiveLearners(all, 14, NOW).map((x) => [x.l.username, x.idleDays])).toEqual([["bob", 35]]);
  });
  it("ranks failed problems and difficult topics, skipping lesson refs", () => {
    const stats = [
      { kind: "sql" as const, ref: "q7", submits: 10, passed: 2, hidden_failed: 1, learners: 3 },
      { kind: "sql" as const, ref: "q8", submits: 4, passed: 4, hidden_failed: 0, learners: 2 },
      { kind: "sql" as const, ref: "lesson:joins", submits: 9, passed: 0, hidden_failed: 0, learners: 1 },
      { kind: "python" as const, ref: "py:safe-cast", submits: 3, passed: 0, hidden_failed: 2, learners: 1 },
    ];
    const f = failedProblems(stats, lookup);
    expect(f.map((p) => [p.ref, p.fails, p.failRate])).toEqual([["q7", 8, 80], ["py:safe-cast", 3, 100], ["q8", 0, 0]]);
    expect(f[0].path).toBe("/questions/q07-x");
    expect(difficultTopics(stats, lookup).map((t) => [t.topic, t.failRate])).toEqual([["Fundamentals", 100], ["Joins", 57]]);
  });
  it("validates ranges", () => {
    expect(presetRange(7, NOW)).toEqual({ from: "2026-10-30", to: "2026-11-05" });
    expect(validRange("2026-01-02", "2026-01-01")).toBe(false);
    expect(validRange("2025-01-01", "2026-11-05")).toBe(false);
    expect(validRange("2026-01-01", "2026-01-31")).toBe(true);
  });
});
