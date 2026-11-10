import { beforeEach, describe, expect, it } from "vitest";
import {
  GRACE_MS, activeMs, elapsedSec, finishSession, formatClock, formatDuration, getActive, mergeSessions, noteAttempt, noteExecution,
  noteHint, openSession, pauseSession, resumeSession, saveActive, settle, sweepStale, STALE_MS, type ActiveSession, type SolveSession,
} from "../site/lib/solveSessions";
import { getProgress, recordSession, replaceProgress } from "../site/lib/progress";
import { mergeProgress } from "../site/lib/account";

const META = { kind: "sql" as const, ref: "sql:25", difficulty: "Easy", topic: "joins" };
const T0 = Date.parse("2026-11-11T10:00:00Z");
const sec = (n: number) => n * 1000;
const sink: SolveSession[] = [];
const commit = (s: SolveSession) => { sink.push(s); recordSession(s); };

beforeEach(() => {
  localStorage.clear();
  sink.length = 0;
  replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
});

describe("timer math", () => {
  it("counts running time, excludes paused time", () => {
    let s = openSession(META, T0);
    expect(elapsedSec(s, T0 + sec(20))).toBe(0 + 20);
    s = settle(s, T0 + sec(20));
    s = pauseSession(s, T0 + sec(20));
    expect(elapsedSec(s, T0 + sec(500))).toBe(20); // paused for 480 s: not counted
    s = resumeSession(s, T0 + sec(500));
    s = settle(s, T0 + sec(510));
    expect(elapsedSec(s, T0 + sec(510))).toBe(30);
  });

  it("does not count a sleep: time past the last heartbeat + grace is dropped", () => {
    const s = openSession(META, T0); // beat = T0
    // Laptop sleeps for 3 hours without a single heartbeat.
    const ms = activeMs(s, T0 + 3 * 3600_000);
    expect(ms).toBe(GRACE_MS);
  });

  it("a backwards clock change never produces negative or growing time", () => {
    let s = openSession(META, T0);
    s = settle(s, T0 + sec(10));
    expect(activeMs(s, T0 - sec(3600))).toBe(sec(10)); // clock set back an hour
    expect(activeMs(s, T0 + sec(10))).toBe(sec(10));
  });

  it("a forward clock jump between heartbeats is excluded", () => {
    let s = openSession(META, T0);
    s = settle(s, T0 + sec(5));
    s = settle(s, T0 + sec(5) + 2 * 3600_000); // jumped two hours, no heartbeat in between
    expect(activeMs(s, T0 + sec(5) + 2 * 3600_000)).toBe(sec(5) + GRACE_MS);
  });

  it("formats clocks and durations", () => {
    expect(formatClock(9)).toBe("00:09");
    expect(formatClock(249)).toBe("04:09");
    expect(formatClock(3729)).toBe("1:02:09");
    expect(formatDuration(40)).toBe("40 s");
    expect(formatDuration(65 * 60)).toBe("1 h 05 min");
  });
});

describe("session lifecycle", () => {
  it("opening twice (remount, refresh, strict mode) never makes a second session", () => {
    const a = openSession(META, T0);
    const b = openSession(META, T0 + sec(1));
    const c = openSession(META, T0 + sec(2));
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(Object.keys(JSON.parse(localStorage.getItem("sqlp.solve.active")!))).toHaveLength(1);
  });

  it("a refresh keeps accumulated time and counts only from the reload", () => {
    let s = openSession(META, T0);
    for (const t of [10, 20, 30, 40]) s = settle(s, T0 + sec(t)); // heartbeats
    saveActive(s); // last one persisted
    const back = openSession(META, T0 + sec(100)); // reloaded 60 s later
    expect(back.id).toBe(s.id);
    expect(elapsedSec(back, T0 + sec(100))).toBe(40);
    expect(elapsedSec(back, T0 + sec(110))).toBe(50);
  });

  it("a paused session stays paused across a refresh", () => {
    let s = openSession(META, T0);
    for (const t of [10, 20, 30]) s = settle(s, T0 + sec(t));
    s = pauseSession(s, T0 + sec(30));
    saveActive(s);
    const back = openSession(META, T0 + sec(9999));
    expect(back.segStart).toBeNull();
    expect(elapsedSec(back, T0 + sec(99999))).toBe(30);
  });

  it("a hidden tab pauses by itself and resumes on return", () => {
    const hidden = openSession(META, T0, false);
    expect(hidden.segStart).toBeNull();
    const shown = openSession(META, T0 + sec(60), true);
    expect(shown.segStart).not.toBeNull();
    expect(elapsedSec(shown, T0 + sec(60))).toBe(0);
  });

  it("different challenges (SQL and Python) keep separate timers", () => {
    const sql = openSession(META, T0);
    const py = openSession({ kind: "python", ref: "py:cart-line-total", difficulty: "Easy", topic: "fundamentals" }, T0);
    expect(sql.id).not.toBe(py.id);
    noteExecution("sql:25"); noteExecution("sql:25");
    expect(getActive("sql:25")!.executions).toBe(2);
    expect(getActive("py:cart-line-total")!.executions).toBe(0);
  });

  it("a correct validated attempt solves it; wrong ones only count", () => {
    openSession(META, T0);
    expect(noteAttempt("sql:25", false, T0 + sec(30), commit)).toBeNull();
    noteHint("sql:25", 2);
    const done = noteAttempt("sql:25", true, T0 + sec(60), commit)!;
    expect(done.status).toBe("solved");
    expect(done.attempts).toBe(2);
    expect(done.executions).toBe(2);
    expect(done.hints).toBe(2);
    expect(getActive("sql:25")).toBeUndefined();
    expect(getProgress().sessions).toHaveLength(1);
  });

  it("Finish without a validated solve is abandoned, never successful", () => {
    openSession(META, T0);
    noteExecution("sql:25");
    const done = finishSession("sql:25", commit, T0 + sec(45))!;
    expect(done.status).toBe("abandoned");
    expect(getProgress().sessions![0].status).toBe("abandoned");
  });

  it("reopening a solved challenge starts a NEW session and keeps the old one", () => {
    openSession(META, T0);
    noteAttempt("sql:25", true, T0 + sec(30), commit);
    const again = openSession(META, T0 + sec(5000));
    expect(again.accMs).toBe(0);
    noteAttempt("sql:25", false, T0 + sec(5030), commit);
    finishSession("sql:25", commit, T0 + sec(5060));
    const all = getProgress().sessions!;
    expect(all.map((s) => s.status)).toEqual(["solved", "abandoned"]);
    expect(new Set(all.map((s) => s.id)).size).toBe(2);
  });

  it("events for a challenge with no open session are ignored", () => {
    noteExecution("sql:99");
    expect(noteAttempt("sql:99", true, T0, commit)).toBeNull();
    expect(getActive("sql:99")).toBeUndefined();
  });

  it("recordSession is idempotent by id", () => {
    openSession(META, T0);
    const done = noteAttempt("sql:25", true, T0 + sec(10), commit)!;
    recordSession(done); recordSession(done);
    expect(getProgress().sessions).toHaveLength(1);
  });

  it("sweeps week-old unfinished sessions: with activity abandoned, untouched dropped", () => {
    openSession(META, T0);
    noteExecution("sql:25");
    openSession({ ...META, ref: "sql:26" }, T0);
    sweepStale(commit, T0 + STALE_MS + 1);
    expect(getActive("sql:25")).toBeUndefined();
    expect(getActive("sql:26")).toBeUndefined();
    expect(getProgress().sessions).toHaveLength(1);
    expect(getProgress().sessions![0].status).toBe("abandoned");
  });
});

describe("sync merge", () => {
  const s = (id: string, endedAt: string, status: SolveSession["status"] = "abandoned"): SolveSession => ({
    id, kind: "sql", ref: "sql:1", startedAt: endedAt, endedAt, activeSec: 10, attempts: 1, executions: 1, hints: 0, status, difficulty: "Easy", topic: "joins",
  });
  it("unions by id and is idempotent (no duplicates after repeated sign-in sync)", () => {
    const a = [s("a", "2026-11-01T00:00:00Z"), s("b", "2026-11-02T00:00:00Z")];
    const b = [s("b", "2026-11-02T00:00:00Z"), s("c", "2026-11-03T00:00:00Z")];
    const once = mergeSessions(a, b);
    expect(once.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(mergeSessions(once, b)).toEqual(once);
    expect(mergeSessions(once, once)).toEqual(once);
  });
  it("mergeProgress keeps local sessions and adds the account's, once", () => {
    const local = { ...getProgress(), sessions: [s("a", "2026-11-01T00:00:00Z")] };
    const merged = mergeProgress(local, [], { sessions: [s("a", "2026-11-01T00:00:00Z"), s("z", "2026-11-05T00:00:00Z")] }, []);
    expect(merged.sessions!.map((x) => x.id)).toEqual(["a", "z"]);
    const again = mergeProgress(merged, [], { sessions: merged.sessions }, []);
    expect(again.sessions).toHaveLength(2);
  });
  it("caps the list, keeping the newest", () => {
    const many = Array.from({ length: 350 }, (_, i) => s(`id${i}`, new Date(T0 + i * 1000).toISOString()));
    const out = mergeSessions(many, []);
    expect(out).toHaveLength(300);
    expect(out[299].id).toBe("id349");
  });
});

it("ActiveSession type is exercised", () => {
  const a: ActiveSession = openSession(META, T0);
  expect(a.targetSec).toBe(300);
});
