// Supabase sync through the REAL AuthProvider (lib/auth.tsx) against an in-memory fake of the Supabase client (always runs, no
// network, no credentials). This verifies what auth.tsx reads on sign-in, merges, pushes, and mirrors afterwards, for two devices.
// It does NOT verify Supabase itself (auth, row-level security, the real database): that needs a staging project, see
// siteSupabaseSyncLive.test.ts and docs/VISUAL_BROWSER_MATRIX.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

interface Server {
  progress: Map<number, Record<string, unknown>>;
  state: Record<string, unknown>;
  mocks: Record<string, unknown>[];
  profileUpdates: number;
  writes: { table: string; op: string }[];
  offline: boolean;
  /** Reads fail, writes still work (a timeout or a policy error on SELECT only). */
  failReads: boolean;
}
const server = vi.hoisted((): Server => ({ progress: new Map(), state: {}, mocks: [], profileUpdates: 0, writes: [], offline: false, failReads: false }));

vi.mock("../site/lib/supabase", () => {
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));
  const builder = (table: string) => {
    let op = "select", payload: unknown, single = false;
    const q: Record<string, unknown> = {};
    const result = () => {
      if (server.offline) return { data: null, error: { message: "Failed to fetch" } };
      if (op === "select") {
        if (server.failReads) return { data: null, error: { message: "canceling statement due to statement timeout" } };
        if (table === "progress") return { data: [...server.progress.values()].map(clone), error: null };
        if (table === "profiles") return { data: single ? { id: "u1", username: "tester", role: "user", must_change_password: false, state: clone(server.state) } : [], error: null };
        if (table === "mock_sessions") return { data: server.mocks.map(clone), error: null };
        return { data: single ? null : [], error: null };
      }
      server.writes.push({ table, op });
      if (table === "progress" && op === "upsert") for (const r of ([] as Record<string, unknown>[]).concat(payload as never)) server.progress.set(r.question_number as number, clone(r));
      if (table === "profiles" && op === "update") { server.state = clone((payload as { state?: Record<string, unknown> }).state ?? server.state); server.profileUpdates++; }
      if (table === "mock_sessions" && op === "insert") server.mocks.push(...([] as Record<string, unknown>[]).concat(payload as never).map(clone));
      return { data: null, error: null };
    };
    for (const name of ["select", "eq", "order", "limit", "in", "neq", "is", "gte"]) q[name] = () => q;
    q.single = () => { single = true; return q; };
    for (const name of ["upsert", "update", "insert", "delete"]) q[name] = (p: unknown) => { op = name; payload = p; return q; };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return q;
  };
  const session = { user: { id: "u1", app_metadata: { provider: "email" } } };
  const client = {
    from: builder,
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
  };
  return { accountsEnabled: true, getSupabase: async () => client, send: (qq: PromiseLike<unknown>) => { Promise.resolve(qq).catch(() => undefined); } };
});

import { AuthProvider } from "../site/lib/auth";
import { getProgress, recordStudy, replaceProgress, resetProgress, recordMistake, updateDay, recordSession, type Progress } from "../site/lib/progress";
import { setProgressSink } from "../site/lib/progress";
import { studySec, type StudySession } from "../site/lib/dailyStudy";

const empty = (): Progress => ({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
const study = (id: string, endedAt: string, activeSec: number): StudySession => ({ id, startedAt: new Date(Date.parse(endedAt) - activeSec * 1000).toISOString(), endedAt, activeSec, awaySec: 0 });
const settleAsync = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const ids = (l: { id: string }[] | undefined) => (l ?? []).map((s) => s.id).sort();

/** One sign-in on one device. Resolves once auth.tsx has pushed its merged state; returns what the device holds. */
async function signIn(device: Progress): Promise<{ progress: Progress; unmount: () => void }> {
  replaceProgress(device);
  const before = server.profileUpdates;
  const r = render(<AuthProvider><span>app</span></AuthProvider>);
  const t0 = Date.now();
  while (server.profileUpdates === before && Date.now() - t0 < 5000) await settleAsync();
  await settleAsync();
  return { progress: getProgress(), unmount: () => { r.unmount(); setProgressSink(null); } };
}

beforeEach(() => {
  localStorage.clear();
  server.progress.clear(); server.state = {}; server.mocks = []; server.profileUpdates = 0; server.writes = []; server.offline = false; server.failReads = false;
  resetProgress();
});
afterEach(() => { cleanup(); setProgressSink(null); });

describe("sync through auth.tsx (fake Supabase)", () => {
  it("pushes the keys the account stores in profiles.state: study time lives inside `daily`, nothing from Visual Learning", async () => {
    const dev = { ...empty(), daily: { days: { d001: { passed: ["g1"], study: [study("s1", "2026-11-11T10:00:00.000Z", 120)] } } }, sessions: [], mistakes: {} } as Progress;
    const a = await signIn(dev);
    expect(Object.keys(server.state).sort()).toEqual(expect.arrayContaining(["activeDays", "cards", "daily", "mistakes", "qmeta", "sessions"]));
    expect((server.state.daily as Progress["daily"])!.days.d001.study).toHaveLength(1);
    const pushed = JSON.stringify(server.state);
    for (const word of ["frames", "DFTRACE", "steps", "visual", "reducedMotion", "motion"]) expect(pushed, `state must not contain "${word}"`).not.toContain(word);
    expect(server.writes.some((w) => w.table === "profiles" && w.op === "update")).toBe(true);
    a.unmount();
  });

  it("a study session finished while signed in is mirrored to the account as it happens, once", async () => {
    const a = await signIn(empty());
    const before = server.profileUpdates;
    recordStudy("d001", study("live", "2026-11-11T11:00:00.000Z", 90));
    await settleAsync();
    expect(server.profileUpdates).toBeGreaterThan(before);
    expect(ids((server.state.daily as Progress["daily"])!.days.d001.study)).toEqual(["live"]);
    recordStudy("d001", study("live", "2026-11-11T11:00:00.000Z", 90)); // the same session recorded again
    await settleAsync();
    expect(ids((server.state.daily as Progress["daily"])!.days.d001.study)).toEqual(["live"]);
    a.unmount();
  });

  it("two devices: A and B work offline, both sign in, both pull again: identical, nothing lost, no duplicate sessions", async () => {
    // Shared start.
    let A = (await signIn({ ...empty(), daily: { startedOn: "2026-11-01", days: { d001: { theory: "2026-11-01T10:00:00.000Z", study: [study("base", "2026-11-01T10:30:00.000Z", 400)] } } } })).progress;
    cleanup(); setProgressSink(null);
    let B = (await signIn(empty())).progress;
    cleanup(); setProgressSink(null);
    expect(ids(B.daily!.days.d001.study)).toEqual(["base"]);

    // Offline edits through the real writers (no sink is attached while signed out).
    replaceProgress(A);
    recordStudy("d001", study("a-off", "2026-11-02T10:00:00.000Z", 500));
    recordMistake({ ref: "daily:d001#g1", kind: "python", topic: "daily", category: "wrong-output", graded: true });
    recordMistake({ ref: "daily:d001#g1", kind: "python", topic: "daily", category: "wrong-output", graded: true });
    updateDay("d001", (r) => ({ ...r, attempted: [...(r.attempted ?? []), "g1"] }));
    recordSession({ id: "sess-a", kind: "sql", ref: "sql:5", startedAt: "2026-11-02T09:00:00.000Z", endedAt: "2026-11-02T09:10:00.000Z", activeSec: 600, attempts: 1, executions: 3, hints: 0, status: "solved" } as never);
    A = getProgress();
    replaceProgress(B);
    recordStudy("d001", study("b-off", "2026-11-03T10:00:00.000Z", 700));
    updateDay("d001", (r) => ({ ...r, attempted: [...(r.attempted ?? []), "g1"], passed: [...(r.passed ?? []), "g1"] }));
    recordStudy("d002", study("b-d2", "2026-11-03T12:00:00.000Z", 300));
    B = getProgress();

    // Reconnect: A, then B, then A again (each sign-in is a full pull, merge and push).
    ({ progress: A } = await signIn(A)); cleanup(); setProgressSink(null);
    ({ progress: B } = await signIn(B)); cleanup(); setProgressSink(null);
    ({ progress: A } = await signIn(A)); cleanup(); setProgressSink(null);

    const strip = (p: Progress) => ({ daily: p.daily, mistakes: p.mistakes, sessions: p.sessions, activeDays: p.activeDays });
    expect(strip(A)).toEqual(strip(B));
    expect(ids(A.daily!.days.d001.study)).toEqual(["a-off", "b-off", "base"]);
    expect(studySec(A.daily!.days.d001)).toBe(1600);
    expect(ids(A.daily!.days.d002.study)).toEqual(["b-d2"]);
    expect(A.daily!.days.d001.passed).toEqual(["g1"]);
    expect(A.mistakes!["daily:d001#g1"].count).toBe(2);
    expect(ids(A.sessions)).toEqual(["sess-a"]);
    // The account holds the same union.
    expect(studySec((server.state.daily as Progress["daily"])!.days.d001)).toBe(1600);

    // One more round on both devices changes nothing (idempotent), and no session id is repeated.
    const snap = JSON.stringify(strip(A));
    ({ progress: B } = await signIn(B)); cleanup(); setProgressSink(null);
    expect(JSON.stringify(strip(B))).toBe(snap);
    for (const day of Object.values(B.daily!.days)) expect(new Set(ids(day.study)).size).toBe((day.study ?? []).length);
  }, 60_000);

  it("an unreachable server on sign-in keeps the local progress untouched and does not throw", async () => {
    server.offline = true;
    const dev = { ...empty(), daily: { days: { d001: { passed: ["g1"], study: [study("keep", "2026-11-11T10:00:00.000Z", 60)] } } } } as Progress;
    replaceProgress(dev);
    const r = render(<AuthProvider><span>app</span></AuthProvider>);
    await settleAsync(); await settleAsync();
    expect(getProgress().daily!.days.d001.study).toHaveLength(1);
    expect(getProgress().daily!.days.d001.passed).toEqual(["g1"]);
    r.unmount();
  });

  // FIXED in auth.tsx (startSync stops when any of the three account reads fails): the account keeps what only it holds.
  it("if the account cannot be READ on sign-in, auth.tsx does not push this device's state over the account's", async () => {
    // The account already holds a lesson this device has never seen.
    server.state = { daily: { days: { d009: { passed: ["g1"], study: [study("remote-only", "2026-11-09T10:00:00.000Z", 900)] } } } };
    server.failReads = true;
    // signIn() waits for a push, and there must be none, so wait a fixed time instead.
    replaceProgress({ ...empty(), daily: { days: { d001: { passed: ["g1"] } } } } as Progress);
    const r = render(<AuthProvider><span>app</span></AuthProvider>);
    for (let i = 0; i < 6; i++) await settleAsync();
    r.unmount(); setProgressSink(null);
    expect(server.profileUpdates).toBe(0);
    const days = (server.state.daily as Progress["daily"])!.days;
    expect(Object.keys(days)).toEqual(["d009"]);
    expect(days.d001).toBeUndefined();
  });
});
