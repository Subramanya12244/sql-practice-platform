import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, LEVELS, MISSIONS, XP, computeLocal, currentStreak, levelOf, longestStreak, weekStartOf, xpSince } from "../site/lib/gamification";
import type { Progress } from "../site/lib/progress";

const EMPTY: Progress = { version: 1, questions: {}, activeDays: [], cards: {} };
const at = (d: string, h = 10) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("levels", () => {
  it("uses the named thresholds in order", () => {
    expect(LEVELS.map((l) => l.name)).toEqual(["Beginner", "Explorer", "Practitioner", "Problem Solver", "Advanced Engineer", "DataForge Master"]);
    expect(levelOf(0)).toMatchObject({ name: "Beginner", toNext: 100 });
    expect(levelOf(99).name).toBe("Beginner");
    expect(levelOf(100)).toMatchObject({ name: "Explorer", toNext: 300 });
    expect(levelOf(250).share).toBeCloseTo(0.5);
    expect(levelOf(9999)).toMatchObject({ name: "DataForge Master", next: null, toNext: 0, share: 1 });
  });
});

describe("streaks", () => {
  it("counts the current and longest runs, ignoring duplicates", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-02", "2026-11-03", "2026-11-05"];
    expect(longestStreak(days)).toBe(3);
    expect(currentStreak(days, "2026-11-05")).toBe(1);
    expect(currentStreak(days, "2026-11-06")).toBe(1); // yesterday still counts until tonight
    expect(currentStreak(days, "2026-11-07")).toBe(0); // a missed day resets; no recovery
    expect(longestStreak([])).toBe(0);
  });
  it("finds Monday of the week", () => {
    expect(weekStartOf("2026-11-05")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
  });
});

describe("XP from the browser record", () => {
  it("gives an anonymous new visitor nothing", () => {
    const r = computeLocal(EMPTY);
    expect(r.xp).toBe(0);
    expect(r.events).toEqual([]);
    expect(r.achievements.every((a) => !a.unlocked)).toBe(true);
  });

  it("awards each action once, only for practised solves (not imported or unflagged), less for revealed solutions", () => {
    const p: Progress = {
      ...EMPTY,
      questions: { 1: { attempts: 3, solvedAt: at("2026-11-02"), practiced: true }, 2: { attempts: 1, solvedAt: at("2026-11-02"), revealed: true, practiced: true }, 3: { attempts: 0, solvedAt: at("2026-11-02"), imported: true }, 4: { attempts: 5 }, 5: { attempts: 1, solvedAt: at("2026-11-02") } },
      lessons: { "py:a": at("2026-11-02"), "scenario:b": at("2026-11-02"), "select#0": at("2026-11-02") },
      read: { "left-join": at("2026-11-02") },
    };
    const r = computeLocal(p);
    const byKind = (k: string) => r.events.filter((e) => e.kind === k).map((e) => e.key);
    expect(byKind("sql")).toEqual(["sql:1", "sql:2"]);
    expect(r.events.find((e) => e.key === "sql:2")?.xp).toBe(XP.sqlRevealed);
    expect(byKind("day")).toEqual(["day:2026-11-02"]);
    // 20 + 10 + 15 + 15 + 10 + 5 + day 5 + first-query 10 + python-explorer 25 + "1 note today" mission 10
    expect(r.xp).toBe(20 + 10 + 15 + 15 + 10 + 5 + 5 + 10 + 25 + 10);
    expect(r.events.filter((e) => e.kind === "mission").map((e) => e.key)).toEqual(["mission:note1:2026-11-02"]);
    // Computing twice gives the same result: derived, not accumulated.
    expect(computeLocal(p).xp).toBe(r.xp);
  });

  it("caps flashcard review XP per day and dedupes repeat reviews", () => {
    const keys = Array.from({ length: 30 }, (_, i) => String(i));
    const r = computeLocal({ ...EMPTY, reviews: { "2026-11-03": [...keys, "1", "2"] } });
    expect(r.events.filter((e) => e.kind === "card")).toHaveLength(XP.cardDailyCap);
  });

  it("scores mocks as passed or finished", () => {
    const r = computeLocal({ ...EMPTY, mocks: [
      { date: at("2026-11-03"), solved: 3, total: 5, usedSec: 1, durationMin: 30 },
      { date: at("2026-11-04"), solved: 1, total: 5, usedSec: 1, durationMin: 30 },
    ] });
    expect(r.events.filter((e) => e.kind === "mock").map((e) => e.xp)).toEqual([XP.mockPassed, XP.mockFinished]);
    expect(r.achievements.find((a) => a.id === "mock-pass")).toMatchObject({ unlocked: true, unlockedAt: at("2026-11-03") });
  });

  it("dates achievements by the event that reached the target", () => {
    const qs = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [i + 1, { attempts: 1, solvedAt: at(`2026-11-0${i + 1}`), practiced: true }]));
    const r = computeLocal({ ...EMPTY, questions: qs });
    expect(r.achievements.find((a) => a.id === "first-query")).toMatchObject({ unlocked: true, unlockedAt: at("2026-11-01") });
    expect(r.achievements.find((a) => a.id === "sql-beginner")).toMatchObject({ unlocked: true, unlockedAt: at("2026-11-05") });
    expect(r.achievements.find((a) => a.id === "sql-10")).toMatchObject({ unlocked: false, value: 6, unlockedAt: null });
    expect(r.counters.longestStreak).toBe(6);
  });

  it("completes daily and weekly missions once per period", () => {
    const qs = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i + 1, { attempts: 1, solvedAt: at("2026-11-05", 9 + i), practiced: true }]));
    const r = computeLocal({ ...EMPTY, questions: qs });
    expect(r.events.filter((e) => e.kind === "mission").map((e) => e.key)).toEqual(["mission:sql3:2026-11-05"]);
    const today = r.missionsFor("2026-11-05");
    expect(today.find((m) => m.id === "sql3")).toMatchObject({ value: 3, done: true });
    expect(today.find((m) => m.id === "w-sql10")).toMatchObject({ value: 4, done: false, start: "2026-11-02" });
    expect(r.missionsFor("2026-11-06").find((m) => m.id === "sql3")).toMatchObject({ value: 0, done: false }); // daily reset
  });

  it("awards project tasks, completed projects and finished tracks", () => {
    const r = computeLocal(
      { ...EMPTY, read: { a: at("2026-11-01"), b: at("2026-11-02") } },
      { projects: [{ slug: "p", completed: true, passedTasks: [{ id: "t1", at: at("2026-11-03") }, { id: "t2", at: at("2026-11-04") }] }], deTopics: { dbt: ["a", "b"], spark: ["c"] } },
    );
    expect(r.events.filter((e) => ["task", "project", "track"].includes(e.kind)).map((e) => e.key).sort()).toEqual(["project:p", "task:p:t1", "task:p:t2", "track:dbt"]);
    expect(r.achievements.find((a) => a.id === "first-project")?.unlockedAt).toBe(at("2026-11-04"));
  });

  it("sums XP since a date", () => {
    const r = computeLocal({ ...EMPTY, questions: { 1: { attempts: 1, solvedAt: at("2026-10-01"), practiced: true }, 2: { attempts: 1, solvedAt: at("2026-11-05"), practiced: true } } });
    expect(xpSince(r.events, "2026-11-01")).toBe(XP.sql + XP.day);
  });

  it("defines every achievement and mission with the fields the UI needs", () => {
    for (const a of ACHIEVEMENTS) expect(a.name && a.description && a.icon && a.xp > 0 && a.target > 0).toBeTruthy();
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length);
  });
});
