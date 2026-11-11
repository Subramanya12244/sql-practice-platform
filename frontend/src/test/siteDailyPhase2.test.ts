// Phase 2: Daily Learning study time (timer integration, sync merge, analytics) and Mistake Notebook integration.
import { beforeEach, describe, expect, it } from "vitest";
import { COMMON_DAYS, DAY_BY_ID, sequenceFor } from "../site/lib/daily";
import { mergeDaily, mergeRecord, type DailyState } from "../site/lib/dailyProgress";
import {
  DAILY_STALE_MS, MAX_SESSIONS_PER_DAY, MIN_STUDY_SEC, mergeStudy, studyAnalytics, studySec, toStudySession, type StudySession,
} from "../site/lib/dailyStudy";
import { commitDayStudy, sweepDailyStudy } from "../site/lib/dailyStudyStore";
import { GRACE_MS, getActive, noteExecution, openSession, saveActive, settle, sweepStale, STALE_MS, type ActiveSession } from "../site/lib/solveSessions";
import { getProgress, markMistakeSolved, recordMistake, recordSession, recordStudy, replaceProgress, updateDay } from "../site/lib/progress";
import { mergeProgress } from "../site/lib/account";
import { buildNotebook, classifyPyMistake, dailyMistake, dailyMistakeRef, mergeMistakes } from "../site/lib/mistakes";

const T0 = Date.parse("2026-11-11T10:00:00Z");
const sec = (n: number) => n * 1000;
const empty = () => ({ version: 1 as const, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
const DAY = COMMON_DAYS[31]; // a SQL-phase day
const S = (id: string, endedAt: string, activeSec: number, awaySec = 0): StudySession => ({ id, startedAt: endedAt, endedAt, activeSec, awaySec });

beforeEach(() => { localStorage.clear(); replaceProgress(empty()); });

describe("study timer: reuses the solve-timer clock", () => {
  const open = (now = T0) => openSession({ kind: "daily", ref: `day:${DAY.id}`, difficulty: "", topic: "daily" }, now, true);

  it("converts active time and away time (wall minus active)", () => {
    let s = open();
    s = settle(s, T0 + sec(20));
    const out = toStudySession(s, T0 + sec(20) + sec(10))!; // 10 s past the last beat is inside the grace window
    expect(out.activeSec).toBe(30);
    expect(out.awaySec).toBe(0);
    expect(out.id).toBe(s.id);
  });

  it("never counts time after the heartbeat grace (sleep, closed tab)", () => {
    const s = open();
    const out = toStudySession(s, T0 + sec(3600))!; // an hour later, no heartbeat since the start
    expect(out.activeSec).toBe(GRACE_MS / 1000);
    expect(out.awaySec).toBe(3600 - GRACE_MS / 1000);
  });

  it("drops sessions shorter than the minimum", () => {
    const s = open();
    expect(toStudySession(s, T0 + sec(MIN_STUDY_SEC - 1))).toBeUndefined();
    expect(commitDayStudy(DAY.id, T0 + sec(2))).toBe(false);
    expect(getActive(`day:${DAY.id}`)).toBeUndefined(); // still removed, never stored
    expect(getProgress().daily?.days[DAY.id]?.study).toBeUndefined();
  });

  it("commit moves the session into Progress.daily and out of the active store; sessions never reach Progress.sessions", () => {
    let s = open();
    s = settle(s, T0 + sec(20)); saveActive(s);
    s = settle(s, T0 + sec(40)); saveActive(s);
    expect(commitDayStudy(DAY.id, T0 + sec(40))).toBe(true);
    expect(getActive(`day:${DAY.id}`)).toBeUndefined();
    expect(getProgress().daily!.days[DAY.id].study).toHaveLength(1);
    expect(studySec(getProgress().daily!.days[DAY.id])).toBe(40);
    expect(getProgress().sessions ?? []).toEqual([]);
    expect(getProgress().activeDays).toEqual([]);
  });

  it("opening twice (remount, strict mode) shares one session", () => {
    expect(open().id).toBe(open(T0 + sec(1)).id);
  });

  it("the SQL/Python stale sweep leaves daily timers alone", () => {
    open();
    const done: unknown[] = [];
    noteExecution(`day:${DAY.id}`);
    sweepStale((x) => { done.push(x); recordSession(x); }, T0 + STALE_MS * 2);
    expect(done).toEqual([]);
    expect(getActive(`day:${DAY.id}`)).toBeDefined();
  });

  it("the daily sweep commits an abandoned timer at its last heartbeat, but not the lesson on screen", () => {
    let s = open();
    s = settle(s, T0 + sec(30)); saveActive(s); // heartbeats every 10-30 s keep the clock alive
    s = settle(s, T0 + sec(60)); saveActive(s);
    const other = openSession({ kind: "daily", ref: "day:d002", difficulty: "", topic: "daily" }, T0, true);
    saveActive(settle(other, T0 + sec(30)));
    const later = T0 + sec(60) + DAILY_STALE_MS + sec(1);
    sweepDailyStudy("d002", later);
    expect(getProgress().daily!.days[DAY.id].study![0].activeSec).toBe(60); // idle gap not counted
    expect(getProgress().daily!.days[DAY.id].study![0].endedAt).toBe(new Date(T0 + sec(60)).toISOString());
    expect(getActive("day:d002")).toBeDefined(); // the open lesson keeps its timer
  });

  it("recordStudy is idempotent by session id and does not touch visit, goal or streak", () => {
    const ss = S("a", "2026-11-11T10:00:00.000Z", 30);
    recordStudy(DAY.id, ss);
    recordStudy(DAY.id, ss);
    const rec = getProgress().daily!.days[DAY.id];
    expect(rec.study).toHaveLength(1);
    expect(rec.lastVisit).toBeUndefined();
    expect(rec.startedAt).toBeUndefined();
    expect(getProgress().activeDays).toEqual([]);
  });

  it("keeps other lesson fields when recording time", () => {
    updateDay(DAY.id, (r) => ({ ...r, theory: "2026-11-11T09:00:00Z" }));
    recordStudy(DAY.id, S("a", "2026-11-11T10:00:00.000Z", 30));
    expect(getProgress().daily!.days[DAY.id].theory).toBe("2026-11-11T09:00:00Z");
  });
});

describe("study sync and merge (no migration)", () => {
  it("older data without `study` still merges and keeps its shape", () => {
    const old: DailyState = { days: { d001: { theory: "2026-11-01T00:00:00Z", passed: ["g1"] } } };
    const merged = mergeDaily(old, { days: { d001: { passed: ["g2"] } } })!;
    expect(merged.days.d001.passed).toEqual(["g1", "g2"]);
    expect("study" in merged.days.d001).toBe(false);
  });

  it("merges two devices by session id: union, no double count, later copy wins", () => {
    const a = [S("x", "2026-11-11T10:00:00.000Z", 60), S("y", "2026-11-11T11:00:00.000Z", 30)];
    const b = [S("x", "2026-11-11T10:05:00.000Z", 90), S("z", "2026-11-12T08:00:00.000Z", 20)];
    const m = mergeStudy(a, b);
    expect(m.map((s) => s.id)).toEqual(["x", "y", "z"]);
    expect(m.find((s) => s.id === "x")!.activeSec).toBe(90);
    expect(mergeStudy(m, a)).toEqual(m); // idempotent
    expect(mergeStudy(a, b)).toEqual(mergeStudy(b, a)); // order-independent
  });

  it("is bounded per lesson", () => {
    const many = Array.from({ length: MAX_SESSIONS_PER_DAY + 20 }, (_, i) => S(`s${i}`, new Date(T0 + i * 60_000).toISOString(), 10));
    expect(mergeStudy(many, [])).toHaveLength(MAX_SESSIONS_PER_DAY);
  });

  it("flows through the account merge", () => {
    const local = { ...empty(), daily: { days: { [DAY.id]: { study: [S("a", "2026-11-11T10:00:00.000Z", 30)] } } } };
    const remote = { ...empty(), daily: { days: { [DAY.id]: { study: [S("b", "2026-11-11T12:00:00.000Z", 45)] } } } };
    const merged = mergeProgress(local, [], { daily: remote.daily } as never, []);
    expect(studySec(merged.daily!.days[DAY.id])).toBe(75);
    expect(mergeRecord({ study: [S("a", "2026-11-11T10:00:00.000Z", 30)] }, {}).study).toHaveLength(1);
  });
});

describe("study analytics", () => {
  const seq = sequenceFor(undefined);
  const d1 = seq[0], d2 = seq[1];
  const state: DailyState = {
    days: {
      [d1.id]: { completedAt: "2026-11-11T12:00:00Z", study: [S("a", "2026-11-11T10:00:00.000Z", 3600), S("b", "2026-11-05T10:00:00.000Z", 600, 120)] },
      [d2.id]: { study: [S("c", "2026-11-10T10:00:00.000Z", 1200)] },
      d999: { study: [S("ghost", "2026-11-10T10:00:00.000Z", 9999)] }, // not in this sequence: ignored
    },
  };
  it("totals, today, week, average per completed lesson and away time", () => {
    const a = studyAnalytics(state, seq, "2026-11-11");
    expect(a.totalSec).toBe(5400);
    expect(a.todaySec).toBe(3600);
    expect(a.thisWeekSec).toBe(3600 + 1200 + 600); // 2026-11-05 .. 2026-11-11
    expect(a.avgPerCompletedSec).toBe(4200); // only d1 is complete: 3600 + 600
    expect(a.awaySec).toBe(120);
    expect(a.daysStudied).toBe(2);
    expect(a.sessions).toBe(3);
    expect(a.vsBudget).toEqual({ plannedMin: d1.minutes, actualMin: 70, lessons: 1 });
  });
  it("groups by phase and weeks", () => {
    const a = studyAnalytics(state, seq, "2026-11-11");
    expect(a.byPhase.reduce((n, p) => n + p.sec, 0)).toBe(5400);
    expect(a.weeks).toHaveLength(8);
    expect(a.weeks[7].end).toBe("2026-11-11");
  });
  it("is empty and safe with no data, and with a path the other branch's time is separate", () => {
    const a = studyAnalytics({ days: {} }, seq, "2026-11-11");
    expect(a.totalSec).toBe(0);
    expect(a.avgPerCompletedSec).toBe(0);
    const analyst = sequenceFor("analyst").find((d) => d.path === "analyst")!;
    const eng = sequenceFor("engineer").find((d) => d.path === "engineer")!;
    const st: DailyState = { days: { [analyst.id]: { study: [S("p", "2026-11-11T10:00:00.000Z", 100)] }, [eng.id]: { study: [S("q", "2026-11-11T10:00:00.000Z", 200)] } } };
    expect(studyAnalytics(st, sequenceFor("analyst"), "2026-11-11").totalSec).toBe(100);
    expect(studyAnalytics(st, sequenceFor("engineer"), "2026-11-11").totalSec).toBe(200);
  });
});

describe("Mistake Notebook integration", () => {
  const ex = "g1";
  const m = dailyMistake(DAY.id, ex, "sql");
  it("uses a per-exercise ref and the lesson's phase as topic", () => {
    expect(m.ref).toBe(dailyMistakeRef(DAY.id, ex));
    expect(m.ref).toBe(`daily:${DAY.id}#g1`);
    expect(m.topic).toBe(DAY.phase);
    expect(dailyMistake("nope", ex, "python").topic).toBe("daily");
  });
  it("repeated failures of one exercise are one entry with a count; a pass marks it solved", () => {
    recordMistake({ ...m, category: "join", graded: true });
    recordMistake({ ...m, category: "join", graded: true });
    expect(Object.keys(getProgress().mistakes!)).toEqual([m.ref]);
    expect(getProgress().mistakes![m.ref].count).toBe(2);
    markMistakeSolved(m.ref);
    expect(getProgress().mistakes![m.ref].solved).toBeTruthy();
    recordMistake({ ...m, category: "join", graded: true });
    expect(getProgress().mistakes![m.ref].count).toBe(3);
  });
  it("stores no code or output (only counts and categories)", () => {
    recordMistake({ ...m, category: "wrong-result", graded: true });
    expect(JSON.stringify(getProgress().mistakes![m.ref])).not.toMatch(/select|print/i);
    expect(Object.keys(JSON.parse(JSON.stringify(getProgress().mistakes![m.ref]))).sort()).toEqual(["categories", "count", "firstAt", "kind", "lastAt", "ref", "runErrors", "topic"]);
  });
  it("appears in the notebook with a link back to the lesson, next to SQL and Python rows", () => {
    recordMistake({ ...m, category: "wrong-result", graded: true });
    recordMistake({ ref: "sql:1", kind: "sql", topic: "joins", category: "join", graded: true });
    const rows = buildNotebook({
      index: [{ number: 1, title: "t", slug: "t", topic: "joins", topicLabel: "Joins", difficulty: "Easy" } as never],
      exercises: [], progress: getProgress(), pyStats: {},
    });
    const d = rows.find((r) => r.ref === m.ref)!;
    expect(d).toBeDefined();
    expect(d.path).toBe(`/daily/day/${DAY.day}`);
    expect(d.title).toContain(`Day ${DAY.day}`);
    expect(d.status).toBe("open");
    expect(rows.some((r) => r.ref === "sql:1")).toBe(true);
  });
  it("a Daily entry for an unknown day is skipped, not a crash", () => {
    recordMistake({ ref: "daily:zzz#g1", kind: "python", topic: "daily", category: "other", graded: true });
    const rows = buildNotebook({ index: [], exercises: [], progress: getProgress(), pyStats: {} });
    expect(rows).toEqual([]);
  });
  it("merges across devices like any other ref", () => {
    const a = { [m.ref]: { ref: m.ref, kind: "sql" as const, topic: m.topic, categories: { join: 2 }, count: 2, runErrors: 0, firstAt: "2026-11-01", lastAt: "2026-11-02" } };
    const b = { [m.ref]: { ref: m.ref, kind: "sql" as const, topic: m.topic, categories: { join: 1 }, count: 1, runErrors: 0, firstAt: "2026-10-30", lastAt: "2026-11-03", solved: "2026-11-03" } };
    const out = mergeMistakes(a, b)[m.ref];
    expect([out.count, out.firstAt, out.lastAt, out.solved]).toEqual([2, "2026-10-30", "2026-11-03", "2026-11-03"]);
  });
  it("classifies a Python failure from the grader text", () => {
    expect(classifyPyMistake("The program stopped with an error\nKeyError: 'x'")).toBe("dicts");
  });
  it("known day ids exist in the curriculum", () => {
    expect(DAY_BY_ID.get(DAY.id)).toBeDefined();
    const a: ActiveSession | undefined = undefined;
    expect(a).toBeUndefined();
  });
});
