import { describe, expect, it } from "vitest";
import { groupMastery, heatmap, historyFor, masteryFor, overall, recommend, streaks, topicRows, weeklySeconds, wasTried } from "../site/lib/solveAnalytics";
import type { SolveSession } from "../site/lib/solveSessions";
import type { Progress } from "../site/lib/progress";
import type { QuestionSummary } from "../site/types";
import type { PyExerciseMeta } from "../site/lib/pyExercises";

let n = 0;
const sess = (o: Partial<SolveSession> & { day?: string }): SolveSession => ({
  id: `s${++n}`, kind: "sql", ref: "sql:1", startedAt: `${o.day ?? "2026-11-10"}T10:00:00Z`, endedAt: `${o.day ?? "2026-11-10"}T10:05:00Z`,
  activeSec: 300, attempts: 1, executions: 2, hints: 0, status: "solved", difficulty: "Easy", topic: "joins", ...o,
});
const q = (number: number, topic: string, difficulty = "Easy"): QuestionSummary => ({
  number, slug: `q${number}`, title: `Question ${number}`, topic, topicLabel: topic.toUpperCase(), difficulty, concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "",
}) as QuestionSummary;
const prog = (o: Partial<Progress> = {}): Progress => ({ version: 1, questions: {}, activeDays: [], cards: {}, ...o });

describe("overall", () => {
  it("is empty-safe", () => {
    expect(overall([])).toMatchObject({ totalActiveSec: 0, attempted: 0, completed: 0, avgSolveSec: null, fastest: null, successRate: null, avgAttemptsPerSolve: null });
  });
  it("uses the underlying records", () => {
    const s = [
      sess({ ref: "sql:1", activeSec: 120, attempts: 1 }),
      sess({ ref: "sql:2", activeSec: 600, attempts: 3 }),
      sess({ ref: "sql:3", status: "abandoned", activeSec: 90, attempts: 2 }),
      sess({ ref: "sql:4", status: "abandoned", activeSec: 5, attempts: 0, executions: 0 }), // opened and left: not "attempted"
    ];
    const o = overall(s);
    expect(o.totalActiveSec).toBe(815);
    expect(o.attempted).toBe(3);
    expect(o.completed).toBe(2);
    expect(o.successRate).toBe(67);
    expect(o.avgSolveSec).toBe(360);
    expect(o.fastest).toEqual({ ref: "sql:1", sec: 120 });
    expect(o.avgAttemptsPerSolve).toBe(2);
    expect(wasTried(s[3])).toBe(false);
  });
  it("a re-solve of the same challenge counts it once as completed", () => {
    const o = overall([sess({ ref: "sql:1" }), sess({ ref: "sql:1", activeSec: 100 })]);
    expect(o.completed).toBe(1);
    expect(o.attempted).toBe(1);
  });
});

describe("mastery", () => {
  const item = (o: Partial<Parameters<typeof masteryFor>[0][number]> = {}) => ({ ref: "x", difficulty: "Easy", solved: true, attempts: 1, helped: false, touched: true, ...o });
  it("not started when nothing was tried", () => {
    expect(masteryFor([item({ solved: false, touched: false, attempts: 0 })], []).level).toBe("not-started");
  });
  it("strong needs several independent solves, explained in words", () => {
    const m = masteryFor([item(), item(), item(), item()], []);
    expect(m.level).toBe("strong");
    expect(m.reasons.join(" ")).toMatch(/4 of 4 solved/);
    expect(m.reasons.join(" ")).toMatch(/needed no hints/);
  });
  it("one easy solve is developing, not strong", () => {
    expect(masteryFor([item(), item({ solved: false, touched: false, attempts: 0 }), item({ solved: false, touched: false, attempts: 0 })], []).level).not.toBe("strong");
  });
  it("many attempts and hints lower it even when everything is solved", () => {
    const easy = masteryFor([item(), item(), item()], []).score!;
    const rough = masteryFor([item({ attempts: 6, helped: true }), item({ attempts: 5, helped: true }), item({ attempts: 7, helped: true })], []).score!;
    expect(rough).toBeLessThan(easy);
    expect(masteryFor([item({ attempts: 6, helped: true }), item({ attempts: 5, helped: true }), item({ attempts: 7, helped: true })], []).level).toBe("needs-practice");
  });
  it("speed alone never changes mastery", () => {
    const items = [item(), item(), item()];
    const fast = masteryFor(items, [sess({ activeSec: 5 }), sess({ activeSec: 5 }), sess({ activeSec: 5 })]);
    const slow = masteryFor(items, [sess({ activeSec: 5000 }), sess({ activeSec: 5000 }), sess({ activeSec: 5000 })]);
    expect(fast.score).toBe(slow.score);
  });
  it("recent failures flag a topic that was once solved", () => {
    const tried = Array.from({ length: 6 }, () => sess({ status: "abandoned" }));
    expect(masteryFor([item(), item(), item({ solved: false })], tried).level).toBe("needs-practice");
  });
  it("harder questions weigh more in completion", () => {
    const hardDone = masteryFor([item({ difficulty: "Hard" }), item({ difficulty: "Easy", solved: false, touched: false, attempts: 0 })], []).score!;
    const easyDone = masteryFor([item({ difficulty: "Easy" }), item({ difficulty: "Hard", solved: false, touched: false, attempts: 0 })], []).score!;
    expect(hardDone).toBeGreaterThan(easyDone);
  });
  it("topicRows uses only the curriculum's own topics and groups them", () => {
    const index = [q(1, "joins"), q(2, "joins"), q(3, "cte")];
    const p = prog({ questions: { 1: { attempts: 1, solvedAt: "2026-11-01T00:00:00Z", practiced: true } } });
    const rows = topicRows({ index, exercises: [], progress: p, pyStats: {}, sessions: [] });
    expect(rows.map((r) => r.topic)).toEqual(["joins", "cte"]);
    const g = groupMastery(rows);
    expect(g.notStarted.map((r) => r.topic)).toEqual(["cte"]);
    expect(rows[0].solved).toBe(1);
  });
});

describe("heatmap and streaks", () => {
  const today = "2026-11-11"; // Wednesday
  const s = [sess({ day: "2026-11-11", activeSec: 700 }), sess({ day: "2026-11-10", activeSec: 3700 }), sess({ day: "2026-11-09", activeSec: 60 }), sess({ day: "2026-11-05", activeSec: 600 }), sess({ day: "2026-11-04", activeSec: 600 })];
  it("counts consecutive practice days and keeps the best", () => {
    expect(streaks(s, today)).toEqual({ current: 3, longest: 3, activeDays: 5 });
  });
  it("a missed day ends a run but today does not break yesterday's streak", () => {
    expect(streaks([sess({ day: "2026-11-10" }), sess({ day: "2026-11-09" })], today).current).toBe(2);
    expect(streaks([sess({ day: "2026-11-08" })], today).current).toBe(0);
    expect(streaks([], today)).toEqual({ current: 0, longest: 0, activeDays: 0 });
  });
  it("heatmap is built from sessions, Monday first, no future days, levels by minutes", () => {
    const h = heatmap(s, today, 4);
    expect(h.columns).toHaveLength(4);
    const last = h.columns[3];
    expect(last[0]!.day).toBe("2026-11-09");
    expect(last[3]).toBeNull(); // Thursday is in the future
    expect(last[2]!.level).toBe(2); // 700 s ≈ 11 min
    expect(last[1]!.level).toBe(4); // 3700 s > 1 h
    expect(last[0]!.level).toBe(1);
    expect(h.total).toBe(700 + 3700 + 60 + 600 + 600);
  });
  it("weekly seconds sums Monday–Sunday buckets", () => {
    const w = weeklySeconds(s, today, 2);
    expect(w[1].sec).toBe(700 + 3700 + 60);
    expect(w[0].sec).toBe(1200);
  });
  it("page visits are not sessions: zero-second sessions add nothing", () => {
    expect(streaks([sess({ activeSec: 0, day: "2026-11-11" })], today).activeDays).toBe(0);
  });
});

describe("recommendations", () => {
  const index = [q(1, "joins"), q(2, "joins", "Medium"), q(3, "joins", "Hard"), q(4, "cte"), q(5, "cte", "Medium")];
  it("starts a new learner at the easiest question, with a reason", () => {
    const r = recommend({ index, exercises: [], progress: prog(), pyStats: {}, sessions: [], dueSql: [], today: "2026-11-11" });
    expect(r[0].path).toBe("/questions/q1");
    expect(r[0].reason).toBeTruthy();
  });
  it("points at the weak topic and steps up one level at a time", () => {
    const p = prog({ questions: {
      1: { attempts: 6, solvedAt: "2026-11-01T00:00:00Z", practiced: true, assisted: true, hintLevel: 3 },
      2: { attempts: 0 },
    } });
    const tried = [sess({ ref: "sql:1", status: "abandoned" }), sess({ ref: "sql:1", status: "abandoned" }), sess({ ref: "sql:1", status: "abandoned" })];
    const r = recommend({ index, exercises: [], progress: p, pyStats: {}, sessions: tried, dueSql: [], today: "2026-11-11" });
    expect(r[0].path).toBe("/questions/q2"); // Medium next to a solved Easy, not the Hard
    expect(r[0].reason).toMatch(/needs practice/i);
  });
  it("suggests missed questions and due revisions, never a solved one outside the queue", () => {
    const p = prog({ questions: { 4: { attempts: 5, practiced: true }, 1: { attempts: 1, solvedAt: "2026-11-01T00:00:00Z", practiced: true } } });
    const r = recommend({ index, exercises: [], progress: p, pyStats: {}, sessions: [], dueSql: [index[0]], today: "2026-11-11" });
    expect(r.map((x) => x.path)).toContain("/questions/q4");
    expect(r.find((x) => x.path === "/questions/q4")!.reason).toMatch(/5 times/);
    expect(r.find((x) => x.path === "/questions/q1")!.reason).toMatch(/Due for revision/);
    const none = recommend({ index, exercises: [], progress: p, pyStats: {}, sessions: [], dueSql: [], today: "2026-11-11" });
    expect(none.map((x) => x.path)).not.toContain("/questions/q1");
  });
});

describe("history", () => {
  it("lists a challenge's sessions newest first and keeps earlier successes", () => {
    const a = sess({ id: "a", ref: "sql:7", endedAt: "2026-11-01T10:00:00Z" });
    const b = sess({ id: "b", ref: "sql:7", status: "abandoned", endedAt: "2026-11-05T10:00:00Z" });
    const c = sess({ id: "c", ref: "sql:8" });
    expect(historyFor([a, b, c], "sql:7").map((x) => x.id)).toEqual(["b", "a"]);
  });
});

const _py: PyExerciseMeta[] = [];
it("types compile with python meta", () => { expect(_py).toEqual([]); });
