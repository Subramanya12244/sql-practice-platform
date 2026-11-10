import { describe, expect, it } from "vitest";
import { generateInsights, MIN, PREREQUISITES, recommendations, type InsightInputs, type ProjectState } from "../site/lib/learningInsights";
import type { SolveSession } from "../site/lib/solveSessions";
import type { Progress } from "../site/lib/progress";
import type { QuestionSummary } from "../site/types";
import type { ProjectMeta } from "../site/lib/projects";

let n = 0;
const sess = (o: Partial<SolveSession>): SolveSession => ({ id: `s${++n}`, kind: "sql", ref: "sql:1", startedAt: "2026-11-10T10:00:00Z", endedAt: "2026-11-10T10:05:00Z", activeSec: 300, attempts: 1, executions: 2, hints: 0, status: "solved", difficulty: "Easy", topic: "left-join", ...o });
const q = (number: number, topic: string, topicLabel: string, difficulty = "Easy"): QuestionSummary => ({ number, slug: `q${number}`, title: `Question ${number}`, topic, topicLabel, difficulty, concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "" }) as QuestionSummary;
const prog = (o: Partial<Progress> = {}): Progress => ({ version: 1, questions: {}, activeDays: [], cards: {}, ...o });
const index = [q(1, "left-join", "LEFT JOIN"), q(2, "left-join", "LEFT JOIN"), q(3, "left-join", "LEFT JOIN"), q(4, "aggregations", "Aggregations"), q(5, "window-functions", "Window Functions"), q(6, "cte", "CTEs")];
const inputs = (o: Partial<InsightInputs> = {}): InsightInputs => ({ index, exercises: [], progress: prog(), pyStats: {}, sessions: [], today: "2026-11-11", ...o });
const many = (k: number, o: Partial<SolveSession>) => Array.from({ length: k }, () => sess(o));

describe("insights: no data, no advice", () => {
  it("a new learner gets nothing", () => {
    expect(generateInsights(inputs())).toEqual([]);
  });
  it("too few sessions never trigger the weak, slow or hint rules", () => {
    const few = many(MIN.weakTried - 1, { status: "abandoned", activeSec: 4000, hints: 3 });
    expect(generateInsights(inputs({ sessions: few }))).toEqual([]);
  });
});

describe("insights: each rule", () => {
  it("low success rate in a topic, with its evidence", () => {
    const ins = generateInsights(inputs({ sessions: many(4, { status: "abandoned", topic: "aggregations" }), progress: prog({ questions: { 4: { attempts: 6, practiced: true } } }) }));
    const w = ins.find((x) => x.kind === "weak-topic")!;
    expect(w.text).toBe("You have a low success rate in Aggregations.");
    expect(w.evidence).toMatch(/solved|ended solved/);
    expect(w.action!.path).toBe("/topics/aggregations");
  });
  it("slower than your own average, only with enough timed solves and a real gap", () => {
    const fast = many(6, { topic: "aggregations", activeSec: 120 });
    const slow = many(3, { topic: "left-join", activeSec: 600 });
    const ins = generateInsights(inputs({ sessions: [...fast, ...slow] }));
    const s = ins.find((x) => x.kind === "slow-topic")!;
    expect(s.text).toBe("You take longer than your average on LEFT JOIN problems.");
    expect(s.evidence).toMatch(/10 min per solve here against \d+ min overall, from 3 timed solves/);
    expect(generateInsights(inputs({ sessions: [...fast, ...many(3, { topic: "left-join", activeSec: 140 })] })).some((x) => x.kind === "slow-topic")).toBe(false);
  });
  it("hint habit in a Python category", () => {
    const py = { kind: "python" as const, topic: "dsa", ref: "py:a" };
    const exercises = [{ slug: "a", code: "PY-1", title: "A", category: "dsa", difficulty: "Easy", concepts: [] }] as never;
    const ins = generateInsights(inputs({ exercises, sessions: [...many(3, { ...py, hints: 2 }), sess({ ...py, hints: 0 })] }));
    expect(ins.find((x) => x.kind === "hint-habit")!.text).toMatch(/You often use hints for/);
    expect(generateInsights(inputs({ exercises, sessions: many(4, { ...py, hints: 0 }) })).some((x) => x.kind === "hint-habit")).toBe(false);
  });
  it("revise the foundation before the advanced topic", () => {
    const sessions = [...many(4, { status: "abandoned", topic: "aggregations" }), ...many(2, { topic: "window-functions", status: "abandoned" })];
    const p = prog({ questions: { 4: { attempts: 6, practiced: true }, 5: { attempts: 2, practiced: true } } });
    const pre = generateInsights(inputs({ sessions, progress: p })).find((x) => x.kind === "prerequisite")!;
    expect(pre.text).toBe("Revise Aggregations before moving further into Window Functions.");
    expect(PREREQUISITES["window-functions"]).toContain("aggregations");
  });
  it("overdue reviews need at least three", () => {
    const revision = Object.fromEntries([1, 2, 3].map((k) => [`sql:${k}`, { due: "2026-11-01", interval: 1, streak: 0, last: "2026-10-31T00:00:00Z", history: [] }]));
    expect(generateInsights(inputs({ progress: prog({ revision }) })).find((x) => x.kind === "overdue")!.text).toBe("3 reviews are overdue.");
    expect(generateInsights(inputs({ progress: prog({ revision: { "sql:1": revision["sql:1"] } }) })).some((x) => x.kind === "overdue")).toBe(false);
  });
  it("the most frequent mistake from the notebook", () => {
    const m = (ref: string) => ({ ref, kind: "sql" as const, topic: "left-join", categories: { join: 2 }, count: 2, runErrors: 0, firstAt: "2026-11-01T00:00:00Z", lastAt: "2026-11-02T00:00:00Z" });
    const ins = generateInsights(inputs({ progress: prog({ mistakes: { "sql:1": m("sql:1"), "sql:2": m("sql:2") } }) }));
    expect(ins.find((x) => x.kind === "recurring-mistake")!.text).toBe("Your most frequent mistake is JOIN (SQL).");
  });
  it("names a strength, never more than the limit, warnings first", () => {
    const solved = Object.fromEntries([1, 2, 3].map((k) => [k, { attempts: 1, solvedAt: "2026-11-01T00:00:00Z", practiced: true }]));
    const ins = generateInsights(inputs({ progress: prog({ questions: solved }), sessions: many(3, { topic: "left-join" }) }));
    expect(ins.find((x) => x.kind === "strength")!.text).toMatch(/LEFT JOIN is a strength/);
    const all = generateInsights(inputs({ sessions: many(4, { status: "abandoned", topic: "aggregations" }), progress: prog({ questions: { 4: { attempts: 6, practiced: true } } }) }), 1);
    expect(all).toHaveLength(1);
    expect(all[0].severity).toBe("warn");
  });
});

describe("recommendations: projects and interview practice", () => {
  const project = (slug: string, level: string, technologies: string[]): ProjectMeta => ({ slug, title: slug, level, technologies, description: "", dataset: "northwind", prerequisites: [], minutes: 60, taskCount: 5, automated: 4, manual: 1 }) as unknown as ProjectMeta;
  const projects = [project("py-clean", "Beginner", ["Python"]), project("sql-wh", "Beginner", ["SQL"]), project("adv", "Advanced", ["SQL"])];
  const state: Record<string, ProjectState> = {};
  const solved = (k: number) => Object.fromEntries(Array.from({ length: k }, (_, i) => [i + 1, { attempts: 1, solvedAt: "2026-11-01T00:00:00Z", practiced: true }]));
  const rec = (o: Partial<InsightInputs>, st = state) => recommendations({ ...inputs(o), dueSql: [], projects, projectState: st });

  it("no project until the basics are in place", () => {
    expect(rec({}).some((r) => r.path.startsWith("/projects-lab"))).toBe(false);
  });
  it("suggests a beginner SQL project after 5 solved questions, never an advanced one", () => {
    const many5 = [q(1, "a", "A"), q(2, "a", "A"), q(3, "a", "A"), q(4, "a", "A"), q(5, "a", "A")];
    const r = rec({ index: many5, progress: prog({ questions: solved(5) }) }).find((x) => x.path.startsWith("/projects-lab"))!;
    expect(r.path).toBe("/projects-lab/sql-wh");
    expect(r.reason).toMatch(/5 SQL questions/);
  });
  it("prefers a project already in progress and skips completed ones", () => {
    const many5 = [q(1, "a", "A"), q(2, "a", "A"), q(3, "a", "A"), q(4, "a", "A"), q(5, "a", "A")];
    const base = { index: many5, progress: prog({ questions: solved(5) }) };
    expect(rec(base, { "py-clean": "In progress" }).find((x) => x.path.startsWith("/projects-lab"))!.path).toBe("/projects-lab/py-clean");
    expect(rec(base, { "sql-wh": "Completed", "py-clean": "Completed" }).some((x) => x.path.startsWith("/projects-lab"))).toBe(false);
  });
  it("suggests a mock interview once three topics are strong and none was done in two weeks", () => {
    const idx = ["a", "b", "c"].flatMap((t, k) => [q(k * 3 + 1, t, t.toUpperCase()), q(k * 3 + 2, t, t.toUpperCase()), q(k * 3 + 3, t, t.toUpperCase())]);
    const questions = Object.fromEntries(idx.map((x) => [x.number, { attempts: 1, solvedAt: "2026-11-01T00:00:00Z", practiced: true }]));
    expect(rec({ index: idx, progress: prog({ questions }) }).some((x) => x.path === "/mock-interview")).toBe(true);
    const recent = prog({ questions, mocks: [{ date: "2026-11-05T10:00:00Z", solved: 3, total: 5, usedSec: 1000, durationMin: 30 }] });
    expect(rec({ index: idx, progress: recent }).some((x) => x.path === "/mock-interview")).toBe(false);
  });
});
