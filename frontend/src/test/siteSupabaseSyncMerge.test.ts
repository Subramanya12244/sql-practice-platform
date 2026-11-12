// @vitest-environment node
// Supabase sync, unit level (always runs, no network): the merge functions that decide what a learner has after signing in on a
// second device. Covers study-time sessions, per-lesson records, Daily Learning state, solve sessions, the Mistake Notebook and the
// whole-account merge (`mergeProgress`). The live checks (real sign-up, real two clients) are in siteSupabaseSyncLive.test.ts and
// only run against a staging project; see docs/VISUAL_BROWSER_MATRIX.md, section "Supabase sync".
//
// What Visual Learning V2 stores: nothing that syncs. It persists two UI preferences in this browser's localStorage only (the
// reduced-motion choice in lib/visual/motion.ts and the last interview question and category in InterviewLab), never sent.
// Traces live in component memory only. The last test checks that.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeDaily, mergeRecord, type DailyState, type DayRecord } from "../site/lib/dailyProgress";
import { MAX_SESSIONS_PER_DAY, mergeStudy, studySec, type StudySession } from "../site/lib/dailyStudy";
import { mergeSessions, type SolveSession } from "../site/lib/solveSessions";
import { mergeMistakes, type Mistake } from "../site/lib/mistakes";
import { mergeProgress, progressToRows, type RemoteState } from "../site/lib/account";
import type { Progress } from "../site/lib/progress";

// ── Builders ─────────────────────────────────────────────────────────────
const iso = (s: string) => new Date(s).toISOString();
const study = (id: string, start: string, activeSec: number, awaySec = 0): StudySession => ({ id, startedAt: iso(start), endedAt: new Date(Date.parse(start) + (activeSec + awaySec) * 1000).toISOString(), activeSec, awaySec });
const solve = (id: string, ref: string, end: string, status: SolveSession["status"] = "solved"): SolveSession => ({ id, kind: "sql", ref, startedAt: iso(end), endedAt: iso(end), activeSec: 60, attempts: 1, executions: 2, hints: 0, status } as SolveSession);
const mistake = (ref: string, count: number, firstAt: string, lastAt: string, extra: Partial<Mistake> = {}): Mistake => ({ ref, kind: "python", topic: "daily", categories: { "wrong-output": count }, count, runErrors: 0, firstAt, lastAt, ...extra });
const progress = (p: Partial<Progress> = {}): Progress => ({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"], ...p });
const day = (d: DayRecord = {}): DailyState => ({ days: { d001: d } });

/** What auth.tsx's `remoteState()` puts in `profiles.state`, for the keys these tests use (the live file checks the key list against auth.tsx). */
const stateOf = (p: Progress): RemoteState => ({
  activeDays: p.activeDays, cards: p.cards, lessons: p.lessons, bookmarks: p.bookmarks, read: p.read, dailyGoal: p.dailyGoal, dayCounts: p.dayCounts, plan: p.plan, answers: p.answers,
  portfolio: p.portfolio, reviews: p.reviews, revision: p.revision, revisionMarks: p.revisionMarks, sessions: p.sessions, mistakes: p.mistakes, daily: p.daily,
  qmeta: Object.fromEntries(Object.entries(p.questions).filter(([, q]) => q.practiced || q.imported || q.hintLevel || q.errorKinds || q.lastSql).map(([k, q]) => [k, { practiced: q.practiced, imported: q.imported, hintLevel: q.hintLevel, assisted: q.assisted, startedAt: q.startedAt, solveSec: q.solveSec, errorKinds: q.errorKinds, lastSql: q.lastSql }])),
});
/** One sign-in on one device: pull the account, merge, return what the device now holds and what it pushes back (the server then holds exactly that). */
interface Server { rows: ReturnType<typeof progressToRows>; state: RemoteState }
const syncDevice = (local: Progress, server: Server): { device: Progress; server: Server } => {
  const device = mergeProgress(local, server.rows, server.state, []);
  return { device, server: { rows: progressToRows(device), state: JSON.parse(JSON.stringify(stateOf(device))) } };
};
const ids = (l: { id: string }[] | undefined) => (l ?? []).map((s) => s.id).sort();

// ── Study-time sessions ──────────────────────────────────────────────────
describe("mergeStudy: study-time sessions across devices", () => {
  const a1 = study("a1", "2026-11-10T09:00:00Z", 600), a2 = study("a2", "2026-11-10T14:00:00Z", 300), b1 = study("b1", "2026-11-11T08:00:00Z", 900);

  it("two devices that studied different times add up: nothing is lost, order is by end time", () => {
    const m = mergeStudy([a1, a2], [b1]);
    expect(m.map((s) => s.id)).toEqual(["a1", "a2", "b1"]);
    expect(m.reduce((n, s) => n + s.activeSec, 0)).toBe(1800);
  });
  it("the same session id on both devices is counted once (a re-sync cannot double the time)", () => {
    const m = mergeStudy([a1, a2], [a1, a2, b1]);
    expect(ids(m)).toEqual(["a1", "a2", "b1"]);
    expect(studySec({ study: m })).toBe(1800);
  });
  it("same id, different end times: the later copy wins (a session only grows), whichever side it is on", () => {
    const early = { ...a1, endedAt: iso("2026-11-10T09:05:00Z"), activeSec: 300 }, late = a1;
    expect(mergeStudy([early], [late])[0]).toEqual(late);
    expect(mergeStudy([late], [early])[0]).toEqual(late);
  });
  it("same id, same end time: the larger active time wins, in both orders", () => {
    const x = { ...a1, activeSec: 100 }, y = { ...a1, activeSec: 200 };
    expect(mergeStudy([x], [y])[0].activeSec).toBe(200);
    expect(mergeStudy([y], [x])[0].activeSec).toBe(200);
  });
  it("is idempotent and commutative", () => {
    const once = mergeStudy([a1, a2], [b1, { ...a1, endedAt: iso("2026-11-10T09:30:00Z"), activeSec: 900 }]);
    expect(mergeStudy(once, once)).toEqual(once);
    expect(mergeStudy(once, [])).toEqual(once);
    expect(mergeStudy([b1], [a1, a2])).toEqual(mergeStudy([a1, a2], [b1]));
  });
  it("the per-lesson cap drops the OLDEST sessions and never an id twice", () => {
    const many = Array.from({ length: MAX_SESSIONS_PER_DAY + 10 }, (_, i) => study(`s${i}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), 60));
    const m = mergeStudy(many, many);
    expect(m).toHaveLength(MAX_SESSIONS_PER_DAY);
    expect(m[m.length - 1].id).toBe(`s${MAX_SESSIONS_PER_DAY + 9}`);
    expect(new Set(ids(m)).size).toBe(MAX_SESSIONS_PER_DAY);
  });
});

// ── Per-lesson records and Daily Learning state ──────────────────────────
describe("mergeRecord / mergeDaily: one lesson on two devices", () => {
  it("study sessions from both devices are kept inside the lesson record", () => {
    const a: DayRecord = { study: [study("a1", "2026-11-10T09:00:00Z", 600)], theory: iso("2026-11-10T09:10:00Z") };
    const b: DayRecord = { study: [study("b1", "2026-11-11T08:00:00Z", 900)], passed: ["g1"] };
    const m = mergeRecord(a, b);
    expect(ids(m.study)).toEqual(["a1", "b1"]);
    expect(studySec(m)).toBe(1500);
    expect(m.passed).toEqual(["g1"]);
    expect(m.theory).toBe(a.theory);
  });
  it("no study on either side leaves no `study` key (older data stays valid)", () => {
    expect("study" in mergeRecord({ passed: ["g1"] }, { attempted: ["g2"] })).toBe(false);
  });
  it("an exercise passed on one device and only attempted (failed) on the other stays passed, and stays attempted", () => {
    const phone = day({ attempted: ["g1"] }), laptop = day({ attempted: ["g1"], passed: ["g1"], completedAt: iso("2026-11-11T10:00:00Z") });
    for (const m of [mergeDaily(phone, laptop)!, mergeDaily(laptop, phone)!]) {
      expect(m.days.d001.passed).toEqual(["g1"]);
      expect(m.days.d001.attempted).toEqual(["g1"]);
      expect(m.days.d001.completedAt).toBe(iso("2026-11-11T10:00:00Z"));
    }
  });
  it("a completion is never lost, and the earliest completion time is kept", () => {
    const m = mergeDaily(day({ completedAt: iso("2026-11-12T00:00:00Z") }), day({ completedAt: iso("2026-11-11T00:00:00Z") }))!;
    expect(m.days.d001.completedAt).toBe(iso("2026-11-11T00:00:00Z"));
    expect(mergeDaily(day({}), day({ completedAt: iso("2026-11-11T00:00:00Z") }))!.days.d001.completedAt).toBeDefined();
  });
  it("knowledge check keeps the best score, and the latest attempt's `last`", () => {
    const a = day({ check: { best: 0.9, last: 0.9, at: iso("2026-11-10T10:00:00Z") } }), b = day({ check: { best: 0.6, last: 0.5, at: iso("2026-11-11T10:00:00Z") } });
    expect(mergeDaily(a, b)!.days.d001.check).toEqual({ best: 0.9, last: 0.5, at: iso("2026-11-11T10:00:00Z") });
    expect(mergeDaily(b, a)!.days.d001.check).toEqual({ best: 0.9, last: 0.5, at: iso("2026-11-11T10:00:00Z") });
  });
  it("unions of lessons, chosen path and the earliest start date", () => {
    const a: DailyState = { path: "analyst", startedOn: "2026-11-05", days: { d001: { passed: ["g1"] } } };
    const b: DailyState = { startedOn: "2026-11-01", days: { d002: { theory: iso("2026-11-02T00:00:00Z") } } };
    const m = mergeDaily(a, b)!;
    expect(Object.keys(m.days).sort()).toEqual(["d001", "d002"]);
    expect(m.path).toBe("analyst");
    expect(m.startedOn).toBe("2026-11-01");
    expect(mergeDaily(undefined, undefined)).toBeUndefined();
  });
  it("a saved code draft: this device's draft wins over the account's for the same exercise; other exercises keep theirs", () => {
    const local = day({ drafts: { g1: "mine" } }), remote = day({ drafts: { g1: "theirs", g2: "other" } });
    expect(mergeDaily(local, remote)!.days.d001.drafts).toEqual({ g1: "mine", g2: "other" });
  });
});

// ── Solve sessions and the Mistake Notebook ──────────────────────────────
describe("mergeSessions: SQL/Python solve sessions", () => {
  it("duplicates by id collapse; the later end wins; 'solved' beats 'abandoned' on a tie", () => {
    const a = solve("s1", "sql:1", "2026-11-10T10:00:00Z", "abandoned"), b = solve("s1", "sql:1", "2026-11-10T10:00:00Z", "solved");
    expect(mergeSessions([a], [b])[0].status).toBe("solved");
    expect(mergeSessions([b], [a])[0].status).toBe("solved");
    const late = solve("s2", "sql:2", "2026-11-11T10:00:00Z"), early = { ...late, endedAt: iso("2026-11-11T09:00:00Z"), activeSec: 10 };
    expect(mergeSessions([early], [late])[0].activeSec).toBe(60);
  });
  it("offline sessions from two devices all survive", () => {
    expect(ids(mergeSessions([solve("a", "sql:1", "2026-11-10T10:00:00Z")], [solve("b", "sql:2", "2026-11-10T11:00:00Z"), solve("c", "sql:3", "2026-11-10T12:00:00Z")]))).toEqual(["a", "b", "c"]);
  });
});

describe("mergeMistakes: notebook entries merge by ref", () => {
  it("entries on different challenges are unioned", () => {
    const m = mergeMistakes({ "daily:d001#g1": mistake("daily:d001#g1", 1, "2026-11-10T10:00:00Z", "2026-11-10T10:00:00Z") }, { "py:x": mistake("py:x", 2, "2026-11-09T10:00:00Z", "2026-11-09T11:00:00Z") });
    expect(Object.keys(m).sort()).toEqual(["daily:d001#g1", "py:x"]);
  });
  it("the same ref: larger count and categories, earliest first, latest last, earliest solve; nothing resets", () => {
    const a = mistake("r", 2, "2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z", { solved: iso("2026-11-10T13:00:00Z") });
    const b = mistake("r", 3, "2026-11-09T10:00:00Z", "2026-11-11T12:00:00Z", { categories: { "wrong-output": 2, types: 1 } });
    for (const m of [mergeMistakes({ r: a }, { r: b }).r, mergeMistakes({ r: b }, { r: a }).r]) {
      expect(m.count).toBe(3);
      expect(m.categories).toEqual({ "wrong-output": 2, types: 1 });
      expect(m.firstAt).toBe("2026-11-09T10:00:00Z");
      expect(m.lastAt).toBe("2026-11-11T12:00:00Z");
      expect(m.solved).toBe(iso("2026-11-10T13:00:00Z"));
    }
  });
  it("'understood' survives only if it is not older than the latest failure", () => {
    const understoodThenFailed = mistake("r", 2, "2026-11-10T10:00:00Z", "2026-11-12T10:00:00Z");
    const understoodEarlier = mistake("r", 1, "2026-11-10T10:00:00Z", "2026-11-10T10:00:00Z", { understood: iso("2026-11-11T00:00:00Z") });
    expect(mergeMistakes({ r: understoodEarlier }, { r: understoodThenFailed }).r.understood).toBeUndefined();
    expect(mergeMistakes({ r: understoodEarlier }, {}).r.understood).toBeDefined();
  });
  it("KNOWN LIMIT: failures counted separately on two devices merge to the larger count, not the sum", () => {
    // Offline phone: 2 failed checks. Offline laptop: 3 failed checks on the same exercise. After the merge the notebook says 3, not 5.
    // This is what makes the merge idempotent (a re-sync must not add the same failures again); the cost is an undercount.
    const m = mergeMistakes({ r: mistake("r", 2, "2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z") }, { r: mistake("r", 3, "2026-11-10T10:30:00Z", "2026-11-10T12:00:00Z") });
    expect(m.r.count).toBe(3);
  });
});

// ── Whole-account merge, and the offline/reconnect sequence ──────────────
describe("mergeProgress: signing in on a device that already has local progress", () => {
  const phone = progress({
    activeDays: ["2026-11-10"],
    sessions: [solve("p1", "sql:1", "2026-11-10T10:00:00Z")],
    mistakes: { "daily:d001#g1": mistake("daily:d001#g1", 2, "2026-11-10T10:00:00Z", "2026-11-10T10:05:00Z") },
    daily: { startedOn: "2026-11-10", days: { d001: { attempted: ["g1"], study: [study("ph1", "2026-11-10T09:00:00Z", 600)] } } },
    questions: { 1: { attempts: 2, solvedAt: "2026-11-10T10:00:00Z" } },
  });
  const laptop = progress({
    activeDays: ["2026-11-11"],
    sessions: [solve("l1", "sql:2", "2026-11-11T10:00:00Z")],
    mistakes: { "daily:d001#g1": mistake("daily:d001#g1", 1, "2026-11-11T09:00:00Z", "2026-11-11T09:00:00Z", { solved: iso("2026-11-11T09:30:00Z") }) },
    daily: { startedOn: "2026-11-09", days: { d001: { attempted: ["g1"], passed: ["g1"], study: [study("lp1", "2026-11-11T09:00:00Z", 1200)] }, d002: { theory: iso("2026-11-11T11:00:00Z") } } },
    questions: { 1: { attempts: 1, solvedAt: "2026-11-11T09:00:00Z" }, 2: { attempts: 1, practiced: true } },
  });

  it("the account holds everything either device knew", () => {
    const m = mergeProgress(phone, progressToRows(laptop), stateOf(laptop), []);
    expect(ids(m.sessions)).toEqual(["l1", "p1"]);
    expect(m.activeDays).toEqual(["2026-11-10", "2026-11-11"]);
    expect(studySec(m.daily!.days.d001)).toBe(1800);
    expect(m.daily!.days.d001.passed).toEqual(["g1"]);
    expect(Object.keys(m.daily!.days).sort()).toEqual(["d001", "d002"]);
    expect(m.daily!.startedOn).toBe("2026-11-09");
    expect(m.mistakes!["daily:d001#g1"].count).toBe(2);
    expect(m.mistakes!["daily:d001#g1"].solved).toBe(iso("2026-11-11T09:30:00Z"));
    expect(m.questions[1].attempts).toBe(2); // max of the two
    expect(m.questions[1].solvedAt).toBe("2026-11-10T10:00:00Z"); // earliest solve wins
    expect(m.questions[2].attempts).toBe(1);
  });
  it("merging the same account data twice equals merging once (idempotent)", () => {
    const once = mergeProgress(phone, progressToRows(laptop), stateOf(laptop), []);
    const twice = mergeProgress(once, progressToRows(laptop), stateOf(laptop), []);
    expect(twice).toEqual(once);
    const echoed = mergeProgress(once, progressToRows(once), stateOf(once), []);
    expect(echoed).toEqual(once);
  });
  it("order does not matter for what is kept (which device syncs first)", () => {
    const x = mergeProgress(phone, progressToRows(laptop), stateOf(laptop), []);
    const y = mergeProgress(laptop, progressToRows(phone), stateOf(phone), []);
    expect(ids(x.sessions)).toEqual(ids(y.sessions));
    expect(x.daily!.days.d001.passed).toEqual(y.daily!.days.d001.passed);
    expect(studySec(x.daily!.days.d001)).toBe(studySec(y.daily!.days.d001));
    expect(x.mistakes).toEqual(y.mistakes);
    expect(x.activeDays).toEqual(y.activeDays);
    expect(x.questions).toEqual(y.questions);
  });
});

describe("offline edits on two devices followed by reconnect (simulated server)", () => {
  it("A and B edit offline, both push, both pull: both end identical to the server, with no loss and no duplicates", () => {
    let server: Server = { rows: [], state: {} };
    // Day 0: both devices start from a shared lesson record and both are online once.
    const base = progress({ daily: { startedOn: "2026-11-01", days: { d001: { theory: iso("2026-11-01T10:00:00Z"), study: [study("base", "2026-11-01T09:30:00Z", 400)] } } } });
    let A = base, B = base;
    ({ device: A, server } = syncDevice(A, server));
    ({ device: B, server } = syncDevice(B, server));
    expect(A).toEqual(B);

    // Offline edits. A: studies d001 and fails g1 twice. B: studies d001 (different time), passes g1, finishes a SQL session, studies d002.
    A = { ...A, activeDays: [...A.activeDays, "2026-11-02"], sessions: [solve("sa", "sql:5", "2026-11-02T10:00:00Z")],
      mistakes: { "daily:d001#g1": mistake("daily:d001#g1", 2, "2026-11-02T10:00:00Z", "2026-11-02T10:10:00Z") },
      daily: { ...A.daily!, days: { ...A.daily!.days, d001: { ...A.daily!.days.d001, attempted: ["g1"], study: mergeStudy(A.daily!.days.d001.study, [study("a-off", "2026-11-02T09:00:00Z", 500)]) } } } };
    B = { ...B, activeDays: [...B.activeDays, "2026-11-03"], sessions: [solve("sb", "sql:6", "2026-11-03T10:00:00Z")],
      daily: { ...B.daily!, days: { ...B.daily!.days, d001: { ...B.daily!.days.d001, attempted: ["g1"], passed: ["g1"], study: mergeStudy(B.daily!.days.d001.study, [study("b-off", "2026-11-03T09:00:00Z", 700)]) },
        d002: { study: [study("b-d2", "2026-11-03T11:00:00Z", 300)] } } } };

    // Reconnect: A pushes, B pulls and pushes, A pulls again.
    ({ device: A, server } = syncDevice(A, server));
    ({ device: B, server } = syncDevice(B, server));
    ({ device: A, server } = syncDevice(A, server));
    const final = server.state;

    for (const dev of [A, B]) {
      expect(ids(dev.sessions), "solve sessions").toEqual(["sa", "sb"]);
      expect(ids(dev.daily!.days.d001.study), "study sessions of d001").toEqual(["a-off", "b-off", "base"]);
      expect(studySec(dev.daily!.days.d001)).toBe(400 + 500 + 700);
      expect(ids(dev.daily!.days.d002.study)).toEqual(["b-d2"]);
      expect(dev.daily!.days.d001.passed).toEqual(["g1"]);
      expect(dev.mistakes!["daily:d001#g1"].count).toBe(2);
      expect(dev.activeDays).toEqual(["2026-11-02", "2026-11-03"]);
    }
    expect(A).toEqual(B);
    expect(ids(final.sessions)).toEqual(["sa", "sb"]);
    expect(studySec(final.daily!.days.d001)).toBe(1600);
    // Syncing again changes nothing, on either device or on the server.
    const again = syncDevice(B, server);
    expect(again.device).toEqual(B);
    expect(again.server).toEqual(server);
  });

  it("the same study session pushed by one device after the other already uploaded it is stored once", () => {
    const s = study("same", "2026-11-04T09:00:00Z", 600);
    let server: Server = { rows: [], state: {} };
    let A = progress({ daily: day({ study: [s] }) }), B = progress({ daily: day({ study: [s] }) });
    ({ device: A, server } = syncDevice(A, server));
    ({ device: B, server } = syncDevice(B, server));
    expect(ids(B.daily!.days.d001.study)).toEqual(["same"]);
    expect(ids(server.state.daily!.days.d001.study)).toEqual(["same"]);
  });

  it("conflict: the same study session was extended on one device while the other still has the short copy", () => {
    const short = study("x", "2026-11-04T09:00:00Z", 300), long = { ...short, endedAt: iso("2026-11-04T09:20:00Z"), activeSec: 900 };
    let server: Server = { rows: [], state: {} };
    let A = progress({ daily: day({ study: [short] }) }), B = progress({ daily: day({ study: [long] }) });
    ({ device: B, server } = syncDevice(B, server));
    ({ device: A, server } = syncDevice(A, server));
    expect(A.daily!.days.d001.study).toEqual([long]);
    expect(server.state.daily!.days.d001.study).toEqual([long]);
  });

  it("conflict: an exercise passed on A and failed on B: the pass and the failure history both survive", () => {
    let server: Server = { rows: [], state: {} };
    let A = progress({ daily: day({ attempted: ["g1"], passed: ["g1"] }), mistakes: { "daily:d001#g1": mistake("daily:d001#g1", 1, "2026-11-05T09:00:00Z", "2026-11-05T09:00:00Z", { solved: iso("2026-11-05T09:10:00Z") }) } });
    let B = progress({ daily: day({ attempted: ["g1"] }), mistakes: { "daily:d001#g1": mistake("daily:d001#g1", 3, "2026-11-05T08:00:00Z", "2026-11-05T09:30:00Z") } });
    ({ device: A, server } = syncDevice(A, server));
    ({ device: B, server } = syncDevice(B, server));
    ({ device: A, server } = syncDevice(A, server));
    expect(A).toEqual(B);
    expect(B.daily!.days.d001.passed).toEqual(["g1"]);
    expect(B.mistakes!["daily:d001#g1"].count).toBe(3);
    expect(B.mistakes!["daily:d001#g1"].solved).toBe(iso("2026-11-05T09:10:00Z"));
  });
});

// ── Property check: random data, the merge laws ──────────────────────────
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
describe("merge laws on random data (seeded)", () => {
  const rand = rng(20261112);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const sessionsOf = () => Array.from({ length: Math.floor(rand() * 6) }, () => { const n = Math.floor(rand() * 8); return study(`s${n}`, new Date(Date.UTC(2026, 10, 1 + Math.floor(rand() * 5), Math.floor(rand() * 20))).toISOString(), 5 + Math.floor(rand() * 900), Math.floor(rand() * 60)); });
  const recordOf = (): DayRecord => ({
    attempted: Array.from({ length: Math.floor(rand() * 3) }, () => pick(["g1", "g2", "i1"])), passed: Array.from({ length: Math.floor(rand() * 2) }, () => pick(["g1", "g2"])),
    theory: rand() < 0.5 ? undefined : iso(`2026-11-0${1 + Math.floor(rand() * 8)}T10:00:00Z`), completedAt: rand() < 0.3 ? iso(`2026-11-1${Math.floor(rand() * 3)}T10:00:00Z`) : undefined,
    study: sessionsOf(),
  });
  /** Canonical form: sorted unions, so list order alone cannot fail a law. */
  const canon = (r: DayRecord | undefined) => JSON.parse(JSON.stringify({ ...r, attempted: [...(r?.attempted ?? [])].sort(), passed: [...(r?.passed ?? [])].sort(), examples: [...(r?.examples ?? [])].sort() }));
  const N = 150;

  it("mergeStudy: commutative, associative, idempotent, never loses an id", () => {
    for (let i = 0; i < N; i++) {
      const [a, b, c] = [sessionsOf(), sessionsOf(), sessionsOf()];
      expect(mergeStudy(a, b)).toEqual(mergeStudy(b, a));
      expect(mergeStudy(mergeStudy(a, b), c)).toEqual(mergeStudy(a, mergeStudy(b, c)));
      expect(mergeStudy(mergeStudy(a, b), mergeStudy(a, b))).toEqual(mergeStudy(a, b));
      expect(ids(mergeStudy(a, b))).toEqual([...new Set([...a, ...b].map((s) => s.id))].sort());
    }
  });
  it("mergeRecord (without drafts): commutative, associative, idempotent", () => {
    for (let i = 0; i < N; i++) {
      const [a, b, c] = [recordOf(), recordOf(), recordOf()];
      expect(canon(mergeRecord(a, b))).toEqual(canon(mergeRecord(b, a)));
      expect(canon(mergeRecord(mergeRecord(a, b), c))).toEqual(canon(mergeRecord(a, mergeRecord(b, c))));
      expect(canon(mergeRecord(mergeRecord(a, b), mergeRecord(a, b)))).toEqual(canon(mergeRecord(a, b)));
      const m = mergeRecord(a, b);
      expect(m.passed).toEqual(expect.arrayContaining([...(a.passed ?? []), ...(b.passed ?? [])]));
      // Same-id sessions are replaced by the later copy, so total time may legitimately drop in random data; the ids may not.
      expect(ids(m.study)).toEqual([...new Set([...(a.study ?? []), ...(b.study ?? [])].map((x) => x.id))].sort());
    }
  });
  it("mergeSessions: commutative and idempotent", () => {
    const sess = () => Array.from({ length: Math.floor(rand() * 5) }, () => solve(`s${Math.floor(rand() * 6)}`, "sql:1", `2026-11-0${1 + Math.floor(rand() * 5)}T10:00:00Z`, pick(["solved", "abandoned"] as const)));
    // Sessions with the same end time keep the order they arrived in, so the two merge orders can list them differently: compare by id.
    const byId = (l: SolveSession[]) => [...l].sort((x, y) => x.id.localeCompare(y.id));
    for (let i = 0; i < N; i++) {
      const [a, b] = [sess(), sess()];
      expect(byId(mergeSessions(a, b))).toEqual(byId(mergeSessions(b, a)));
      expect(mergeSessions(mergeSessions(a, b), mergeSessions(a, b))).toEqual(mergeSessions(a, b));
    }
  });
  it("mergeMistakes: idempotent, counts never decrease", () => {
    const mk = () => Object.fromEntries(Array.from({ length: Math.floor(rand() * 3) }, () => { const r = pick(["r1", "r2", "r3"]); const n = 1 + Math.floor(rand() * 4); return [r, mistake(r, n, `2026-11-0${1 + Math.floor(rand() * 4)}T10:00:00.000Z`, `2026-11-0${5 + Math.floor(rand() * 4)}T10:00:00.000Z`)]; }));
    for (let i = 0; i < N; i++) {
      const [a, b] = [mk(), mk()];
      const m = mergeMistakes(a, b);
      expect(mergeMistakes(m, m)).toEqual(m);
      for (const [ref, x] of Object.entries({ ...a, ...b })) expect(m[ref].count).toBeGreaterThanOrEqual(x.count);
    }
  });
});

// ── What is pushed, and what Visual Learning V2 adds ─────────────────────
describe("what an account stores", () => {
  it("Visual Learning V2 syncs nothing: its only persisted values are two UI preferences in this browser's localStorage", () => {
    const root = path.resolve(__dirname, "../site");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && files.push(p); } };
    walk(path.join(root, "lib/visual")); walk(path.join(root, "components/visual"));
    const text = (p: string) => readFileSync(p, "utf8");
    // Nothing in the visual modules may reach the account, the progress store or the network.
    const leaks = files.filter((f) => /supabase|getSupabase|fetch\(|replaceProgress|setProgressSink|updateDay\(|recordStudy\(|XMLHttpRequest|sendBeacon/.test(text(f))).map((f) => path.relative(root, f));
    expect(leaks, "visual modules that sync, write progress or use the network").toEqual([]);
    // What they do persist is small and local: only IDs or a motion choice, under a `sqlp.visual.` key, never anything the learner typed.
    const storing = files.filter((f) => /localStorage|sessionStorage|indexedDB/.test(text(f))).map((f) => path.relative(root, f)).sort();
    expect(storing.every((f) => /lib\/visual\/motion\.ts$|components\/visual\/InterviewLab\.tsx$/.test(f)), `unexpected storage in: ${storing.join(", ")}`).toBe(true);
    for (const f of storing) expect(text(path.join(root, f)), f).toMatch(/"sqlp\.visual\.[A-Za-z.]+"/);
    for (const f of files) if (/indexedDB|sessionStorage/.test(text(f))) throw new Error(`${f} uses IndexedDB or sessionStorage`);
    const account = text(path.join(root, "lib/account.ts")), auth = text(path.join(root, "lib/auth.tsx"));
    expect(`${account}${auth}`).not.toMatch(/visual|trace/i);
  });
  it("progressToRows uploads only questions with evidence, with the columns the table has", () => {
    const rows = progressToRows(progress({ questions: { 1: { attempts: 0 }, 2: { attempts: 3, solvedAt: "2026-11-01T00:00:00Z", reviewBox: 2, reviewDue: "2026-11-05" }, 3: { attempts: 0, revealed: true } } }));
    expect(rows.map((r) => r.question_number)).toEqual([2, 3]);
    expect(Object.keys(rows[0]).sort()).toEqual(["attempts", "question_number", "revealed", "review_box", "review_due", "solved_at"]);
  });
});
