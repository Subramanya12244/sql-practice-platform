// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  BRANCH_DAYS, COMMON_DAYS, dayHref, findDay, neighbours, parseDay, parseExamples, renderResultText, sameOutput, sequenceFor, splitSections, unmetPrerequisites,
  type DayExtras,
} from "../site/lib/daily";
import {
  buildCalendar, checkScore, completionOf, currentDay, dayStatus, dueRevisions, learningStreak, masteryOf, mergeDaily, programmeStats, reviewAfterCheck,
  withCheckResult, type DailyState, type DayRecord,
} from "../site/lib/dailyProgress";

const extras: DayExtras = {
  id: "d001",
  time: { theory: 25, examples: 20, guided: 25, independent: 45, review: 15 },
  guided: [
    { id: "g1", title: "a", kind: "python", prompt: "", starter: "", solution: "", expected: "1" },
    { id: "g2", title: "b", kind: "python", prompt: "", starter: "", solution: "", expected: "2" },
  ],
  independent: [
    { id: "i1", title: "c", kind: "python", prompt: "", starter: "", solution: "", expected: "3" },
    { id: "i2", title: "d", kind: "python", prompt: "", starter: "", solution: "", expected: "4", required: false },
  ],
  checks: [
    { id: "c1", question: "", options: ["a", "b"], answer: 0, explanation: "" },
    { id: "c2", question: "", options: ["a", "b"], answer: 1, explanation: "" },
    { id: "c3", question: "", options: ["a", "b"], answer: 1, explanation: "" },
  ],
};
const T = "2026-11-12";

describe("daily curriculum helpers", () => {
  it("builds the 180-day sequence for each path", () => {
    expect(sequenceFor(undefined)).toHaveLength(90);
    expect(sequenceFor("analyst")).toHaveLength(180);
    expect(sequenceFor("engineer")).toHaveLength(180);
    expect(sequenceFor("analyst")[90]).toBe(BRANCH_DAYS.analyst[0]);
    expect(new Set(sequenceFor("engineer").map((d) => d.id)).size).toBe(180);
  });
  it("links days and finds neighbours", () => {
    expect(dayHref(COMMON_DAYS[41])).toBe("/daily/day/42");
    expect(dayHref(BRANCH_DAYS.analyst[29])).toBe("/daily/analyst/day/120");
    expect(findDay("engineer", 120)?.id).toBe("e120");
    const d90 = COMMON_DAYS[89];
    expect(neighbours(d90, "engineer").next?.id).toBe("e091");
    expect(neighbours(d90, "analyst").next?.id).toBe("a091");
    expect(neighbours(COMMON_DAYS[0], undefined).prev).toBeUndefined();
  });
  it("reports unmet prerequisites", () => {
    const d = COMMON_DAYS[1];
    expect(unmetPrerequisites(d, () => false).map((x) => x.id)).toEqual(["d001"]);
    expect(unmetPrerequisites(d, (id) => id === "d001")).toEqual([]);
  });
});

describe("lesson parsing", () => {
  const md = [
    "## Objectives", "- one", "", "## Learn by example", "Intro text.", "",
    "### Example 1: Hello", "Says hello.", "", "```python run", 'print("hi")', "```", "", "```output", "hi", "```", "",
    "### Example 2: Echo", "```text", "not run", "```", "```python run", "print(input())", "```", "```stdin", "yo", "```", "```output", "yo", "```",
    "After text.", "", "## Daily review", "x",
  ].join("\n");
  it("splits sections and extracts runnable examples", () => {
    expect(Object.keys(splitSections(md))).toEqual(["Objectives", "Learn by example", "Daily review"]);
    const blocks = parseExamples(splitSections(md)["Learn by example"]);
    const ex = blocks.filter((b) => b.kind === "example");
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({ id: "ex1", title: "Hello", lang: "python", code: 'print("hi")', output: "hi" });
    expect(ex[1]).toMatchObject({ id: "ex2", title: "Echo", stdin: "yo", output: "yo" });
    expect(blocks.some((b) => b.kind === "text" && b.md.includes("not run"))).toBe(true);
    expect(parseDay(md, extras).examples).toHaveLength(blocks.length);
  });
  it("rejects an example with no output block", () => {
    expect(() => parseExamples("```python run\nprint(1)\n```\n")).toThrow(/no output/);
  });
  it("renders SQL results and compares outputs leniently", () => {
    expect(renderResultText(["a", "b"], [[1, null], ["x", new Date("2026-01-02T00:00:00Z")]])).toBe("a | b\n1 | NULL\nx | 2026-01-02");
    expect(sameOutput("a \nb\n\n", "a\nb")).toBe(true);
    expect(sameOutput("a", "b")).toBe(false);
  });
});

describe("completion and mastery", () => {
  it("does not complete a day that was only opened", () => {
    const c = completionOf({ startedAt: T, lastVisit: T }, extras);
    expect(c.complete).toBe(false);
    expect(c.missing).toHaveLength(4);
  });
  it("requires theory, required guided passes, required independent attempts and a 60% check", () => {
    let rec: DayRecord = { theory: T, passed: ["g1", "g2"], attempted: ["i1"] };
    expect(completionOf(rec, extras).complete).toBe(false); // no check yet
    rec = withCheckResult(rec, checkScore({ c1: 0, c2: 1, c3: 0 }, extras.checks), T); // 2/3
    expect(completionOf(rec, extras)).toMatchObject({ complete: true, check: { ok: true } });
    expect(completionOf({ ...rec, passed: ["g1"] }, extras).complete).toBe(false);
    expect(completionOf({ ...rec, attempted: [] }, extras).complete).toBe(false);
    expect(completionOf({ ...rec, check: { best: 0.33, last: 0.33, at: T } }, extras).complete).toBe(false);
  });
  it("ignores optional exercises for completion but not for mastery", () => {
    const rec: DayRecord = { theory: T, passed: ["g1", "g2", "i1"], check: { best: 1, last: 1, at: T } };
    expect(completionOf(rec, extras).complete).toBe(true);
    expect(masteryOf(rec, extras).mastered).toBe(false);
    expect(masteryOf({ ...rec, passed: [...rec.passed!, "i2"], revised: T }, extras).mastered).toBe(true);
    expect(masteryOf({ ...rec, passed: [...rec.passed!, "i2"], revised: T, check: { best: 0.67, last: 0.67, at: T } }, extras).mastered).toBe(false);
  });
  it("keeps the best check score and the latest one separately", () => {
    let rec = withCheckResult(undefined, 1, "2026-11-10T10:00:00Z");
    rec = withCheckResult(rec, 0.33, "2026-11-11T10:00:00Z");
    expect(rec.check).toEqual({ best: 1, last: 0.33, at: "2026-11-11T10:00:00Z" });
  });
});

describe("status, streak and calendar", () => {
  it("derives status", () => {
    expect(dayStatus(undefined, undefined, T)).toBe("available");
    expect(dayStatus({ lastVisit: T }, undefined, T)).toBe("available");
    expect(dayStatus({ theory: T }, undefined, T)).toBe("in-progress");
    expect(dayStatus({ completedAt: "2026-11-01", check: { best: 1, last: 1, at: T } }, undefined, T)).toBe("completed");
    const due = reviewAfterCheck(undefined, 0.5, new Date("2026-11-10T00:00:00Z"));
    expect(dayStatus({ completedAt: "2026-11-01" }, due, "2026-11-12")).toBe("revision");
    expect(dayStatus({ completedAt: "2026-11-01", check: { best: 1, last: 0.3, at: T } }, undefined, T)).toBe("revision");
  });
  it("tolerates one missed day in the streak, not two", () => {
    expect(learningStreak([], T)).toBe(0);
    expect(learningStreak(["2026-11-12", "2026-11-11", "2026-11-10"], T)).toBe(3);
    expect(learningStreak(["2026-11-11", "2026-11-10"], T)).toBe(2); // not yet today
    expect(learningStreak(["2026-11-12", "2026-11-10", "2026-11-09"], T)).toBe(3); // one day off
    expect(learningStreak(["2026-11-12", "2026-11-09"], T)).toBe(1); // two days off
    expect(learningStreak(["2026-11-05"], T)).toBe(0);
  });
  const seq = sequenceFor(undefined);
  const state: DailyState = {
    startedOn: "2026-11-08",
    days: {
      d001: { theory: "2026-11-08T09:00:00Z", completedAt: "2026-11-08T10:00:00Z", lastVisit: "2026-11-08T10:00:00Z" },
      d002: { theory: "2026-11-10T09:00:00Z", completedAt: "2026-11-10T10:00:00Z", lastVisit: "2026-11-10T10:00:00Z" },
      d003: { theory: "2026-11-12T09:00:00Z", lastVisit: "2026-11-12T09:00:00Z" },
    },
  };
  it("finds the current day and programme numbers", () => {
    expect(currentDay(seq, state)?.id).toBe("d003");
    const s = programmeStats(seq, state);
    expect(s).toMatchObject({ total: 90, completed: 2, remaining: 88, percent: 2 });
    expect(s.remainingMinutes).toBe(seq.slice(2).reduce((a, d) => a + d.minutes, 0));
    expect(s.phase?.id).toBe("python-fundamentals");
  });
  it("builds a calendar where a missed day is neutral and nothing shifts", () => {
    const cal = buildCalendar(seq, state, { "day:d001": { due: "2026-11-12", interval: 1, streak: 0, last: "2026-11-08", history: [] } }, T, { ahead: 3 });
    const by = Object.fromEntries(cal.map((c) => [c.date, c]));
    expect(by["2026-11-08"].kind).toBe("completed");
    expect(by["2026-11-09"].kind).toBe("missed");
    expect(by["2026-11-10"].kind).toBe("completed");
    expect(by["2026-11-11"].kind).toBe("missed");
    expect(by[T].kind).toBe("today");
    expect(by[T].planned?.id).toBe("d003");
    expect(by["2026-11-13"]).toMatchObject({ kind: "upcoming" });
    expect(by["2026-11-13"].planned?.id).toBe("d004");
    expect(dueRevisions(state, { "day:d001": { due: "2026-11-12", interval: 1, streak: 0, last: "x", history: [] }, "day:d003": { due: "2026-11-01", interval: 1, streak: 0, last: "x", history: [] } }, T)).toEqual(["d001"]);
  });
});

describe("account merge", () => {
  it("unions work and never loses a completion", () => {
    const a: DailyState = { path: "analyst", startedOn: "2026-11-09", days: { d001: { theory: "2026-11-09T00:00:00Z", passed: ["g1"], completedAt: "2026-11-10T00:00:00Z", check: { best: 0.67, last: 0.67, at: "2026-11-10T00:00:00Z" } } } };
    const b: DailyState = { startedOn: "2026-11-08", days: { d001: { passed: ["g2"], check: { best: 1, last: 0.33, at: "2026-11-11T00:00:00Z" } }, d002: { theory: "2026-11-11T00:00:00Z" } } };
    const m = mergeDaily(a, b)!;
    expect(m.path).toBe("analyst");
    expect(m.startedOn).toBe("2026-11-08");
    expect(m.days.d001.passed?.sort()).toEqual(["g1", "g2"]);
    expect(m.days.d001.completedAt).toBe("2026-11-10T00:00:00Z");
    expect(m.days.d001.check).toEqual({ best: 1, last: 0.33, at: "2026-11-11T00:00:00Z" });
    expect(m.days.d002.theory).toBeDefined();
    expect(mergeDaily(undefined, undefined)).toBeUndefined();
  });
});
