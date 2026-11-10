/**
 * Solve sessions: how long a learner actually spends on one challenge, and how it ended.
 *
 * Two kinds of record:
 *  - An ACTIVE session (this file's localStorage key) holds a running timer. It is written at
 *    lifecycle points (open, pause, resume, run, submit, hidden tab) and by a slow heartbeat,
 *    never every second. The screen recomputes the display from it each second.
 *  - A FINISHED session is appended to `Progress.sessions` (lib/progress.ts), so it rides the
 *    existing offline-first sync (profiles.state) and is merged by id.
 *
 * Time is "active time", not wall time. A running segment only counts up to the last heartbeat
 * plus a short grace, so a sleeping laptop, a closed tab, or a system-clock jump never inflates
 * the total. The pure functions below take `now` as an argument so they are easy to test.
 */

export type SessionKind = "sql" | "python";
/** "solved" only ever comes from the existing validation result; Finish alone gives "abandoned". */
export type SessionStatus = "solved" | "abandoned";

export interface SolveSession {
  id: string;
  kind: SessionKind;
  /** "sql:25" or "py:<slug>", the same keys the revision queue uses. */
  ref: string;
  startedAt: string;
  endedAt: string;
  activeSec: number;
  /** Submissions / test checks (validated attempts). */
  attempts: number;
  /** Every run of the editor, including submissions. */
  executions: number;
  /** Highest assistance level (SQL) or number of hints revealed (Python) in this session. */
  hints: number;
  status: SessionStatus;
  difficulty: string;
  /** SQL topic slug or Python category slug, as the curriculum already names them. */
  topic: string;
}

export interface ActiveSession {
  id: string;
  kind: SessionKind;
  ref: string;
  startedAt: string;
  /** Active milliseconds already settled. */
  accMs: number;
  /** Epoch ms when the current running segment began; null while paused. */
  segStart: number | null;
  /** Last time this tab proved it was alive (epoch ms). */
  beat: number;
  /** Paused because no tab was visible (resumes by itself), as opposed to a Pause click. */
  auto?: boolean;
  /** Tabs showing this challenge right now: tab id → last time it proved it was visible (epoch ms). */
  tabs?: Record<string, number>;
  attempts: number;
  executions: number;
  hints: number;
  difficulty: string;
  topic: string;
  /** Goal in seconds, shown next to the elapsed time. 0 or missing means no target. */
  targetSec?: number;
}

/** A running segment counts at most this long past the last heartbeat. */
export const GRACE_MS = 30_000;
export const HEARTBEAT_MS = 10_000;
/** An unfinished session untouched this long is closed as abandoned the next time storage is swept. */
export const STALE_MS = 7 * 86_400_000;

/** Active milliseconds at `now`. Never negative, never counts time after sleep or a clock jump. */
export function activeMs(s: ActiveSession, now: number): number {
  if (s.segStart == null) return s.accMs;
  const end = Math.min(now, s.beat + GRACE_MS);
  return s.accMs + Math.max(0, end - s.segStart);
}

/** Fold the running segment into accMs and restart it at `now`. Used by every heartbeat. */
export function settle(s: ActiveSession, now: number): ActiveSession {
  if (s.segStart == null) return s;
  return { ...s, accMs: activeMs(s, now), segStart: now, beat: now };
}

export function pauseSession(s: ActiveSession, now: number, auto = false): ActiveSession {
  if (s.segStart == null) return s;
  return { ...s, accMs: activeMs(s, now), segStart: null, beat: now, auto: auto || undefined };
}

export function resumeSession(s: ActiveSession, now: number): ActiveSession {
  if (s.segStart != null) return s;
  return { ...s, segStart: now, beat: now, auto: undefined };
}

export const isRunning = (s: ActiveSession) => s.segStart != null;

/**
 * Several tabs may show the same challenge. They share ONE session and one clock: time counts
 * while at least one of them is visible, never twice. Each visible tab reports in through these
 * two functions; a Pause click (not `auto`) pauses every tab.
 */
export function tabVisible(s: ActiveSession, tabId: string, now: number): ActiveSession {
  const base = s.auto ? resumeSession(s, now) : settle(s, now);
  return { ...base, tabs: { ...liveTabs(s.tabs, now), [tabId]: now } };
}

/** This tab was hidden or closed. If it was the last visible one, the session pauses itself. */
export function tabHidden(s: ActiveSession, tabId: string, now: number): ActiveSession {
  const { [tabId]: _me, ...others } = s.tabs ?? {};
  const live = liveTabs(others, now);
  const next = { ...s, tabs: live };
  return Object.keys(live).length ? settle(next, now) : pauseSession(next, now, true);
}

const liveTabs = (tabs: Record<string, number> | undefined, now: number) =>
  Object.fromEntries(Object.entries(tabs ?? {}).filter(([, t]) => now - t <= GRACE_MS));

/** Seconds shown on the timer. */
export const elapsedSec = (s: ActiveSession, now: number) => Math.floor(activeMs(s, now) / 1000);

/** "04:09" under an hour, "1:02:09" from an hour. */
export function formatClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Plain words for analytics: "4 min", "1 h 05 min", "40 s". */
export function formatDuration(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  if (t < 60) return `${t} s`;
  const m = Math.round(t / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Targets the picker offers, in minutes. 0 is "no target". */
export const TARGET_MINUTES = [5, 10, 15, 20, 30] as const;
const PREF_KEY = "sqlp.solve.targetPref";

/** The learner's last chosen target in seconds (0 = none), or undefined to use the difficulty default. */
export function targetPreference(): number | undefined {
  try { const v = localStorage.getItem(PREF_KEY); return v === null ? undefined : Math.max(0, Number(v) || 0); } catch { return undefined; }
}

/** Default solving targets by difficulty, in seconds. Shown as a guide, never enforced. */
export const DEFAULT_TARGET_SEC: Record<string, number> = { Easy: 5 * 60, Medium: 12 * 60, Hard: 25 * 60 };

export function toSession(s: ActiveSession, status: SessionStatus, now: number): SolveSession {
  return {
    id: s.id, kind: s.kind, ref: s.ref, startedAt: s.startedAt, endedAt: new Date(now).toISOString(),
    activeSec: Math.round(activeMs(s, now) / 1000), attempts: s.attempts, executions: s.executions, hints: s.hints,
    status, difficulty: s.difficulty, topic: s.topic,
  };
}

/** Union by id (an id never changes meaning), oldest first, capped. Safe to run repeatedly. */
export function mergeSessions(a: SolveSession[] = [], b: SolveSession[] = [], cap = 300): SolveSession[] {
  const byId = new Map<string, SolveSession>();
  for (const s of [...b, ...a]) {
    const prev = byId.get(s.id);
    // Same id on two devices: keep the one that ended later; "solved" beats "abandoned" on a tie.
    if (!prev || s.endedAt > prev.endedAt || (s.endedAt === prev.endedAt && s.status === "solved")) byId.set(s.id, s);
  }
  return [...byId.values()].sort((x, y) => x.endedAt.localeCompare(y.endedAt)).slice(-cap);
}

// ── Browser store ─────────────────────────────────────────────────────────
const KEY = "sqlp.solve.active";
type Store = Record<string, ActiveSession>;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readStore(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store; } catch { return {}; }
}
function writeStore(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the in-memory hook state still works */ }
  notify();
}

export function subscribeSessions(f: () => void) {
  listeners.add(f);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) f(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(f); window.removeEventListener("storage", onStorage); };
}

export const getActive = (ref: string): ActiveSession | undefined => readStore()[ref];

export interface OpenMeta { kind: SessionKind; ref: string; difficulty: string; topic: string; targetSec?: number }

/**
 * Start a session for `ref`, or return the one already running. Calling this again (a remount,
 * a refresh, React strict mode) never creates a second session. A finished challenge has no
 * active session, so opening it again starts a fresh one and leaves the history alone.
 */
export function openSession(meta: OpenMeta, now = Date.now(), visible = true): ActiveSession {
  const store = readStore();
  const existing = store[meta.ref];
  if (existing) {
    // Another tab is showing this challenge right now: share its running clock untouched.
    if (existing.segStart != null && Object.values(existing.tabs ?? {}).some((t) => now - t <= GRACE_MS)) return existing;
    // Came back (refresh/navigation): continue, but only count from now.
    const next = existing.segStart != null || existing.auto
      ? (visible ? resumeSession(pauseSession(existing, existing.beat), now) : pauseSession(existing, existing.beat, true))
      : existing;
    if (next !== existing) writeStore({ ...store, [meta.ref]: next });
    return next;
  }
  const s: ActiveSession = {
    id: crypto.randomUUID(), kind: meta.kind, ref: meta.ref, startedAt: new Date(now).toISOString(),
    accMs: 0, segStart: visible ? now : null, beat: now, auto: visible ? undefined : true,
    attempts: 0, executions: 0, hints: 0, difficulty: meta.difficulty, topic: meta.topic,
    targetSec: meta.targetSec ?? targetPreference() ?? DEFAULT_TARGET_SEC[meta.difficulty],
  };
  writeStore({ ...store, [meta.ref]: s });
  return s;
}

/** Replace the stored copy (heartbeat, pause, resume). Ignored if the session was finished meanwhile. */
export function saveActive(s: ActiveSession) {
  const store = readStore();
  if (store[s.ref]?.id !== s.id) return;
  writeStore({ ...store, [s.ref]: s });
}

function update(ref: string, f: (s: ActiveSession) => ActiveSession) {
  const store = readStore();
  const s = store[ref];
  if (!s) return;
  writeStore({ ...store, [ref]: f(s) });
}

/** Change the goal of the open session and remember it for the next challenges. 0 = no target. */
export function setTarget(ref: string, sec: number) {
  const v = Math.max(0, Math.round(sec));
  try { localStorage.setItem(PREF_KEY, String(v)); } catch { /* preference just won't persist */ }
  update(ref, (s) => ({ ...s, targetSec: v }));
}

/** Count a run of the editor. Nothing happens if no session is open for this challenge. */
export const noteExecution = (ref: string) => update(ref, (s) => ({ ...s, executions: s.executions + 1 }));

/** Highest hint level reached (SQL ladder) or hints revealed so far (Python). */
export const noteHint = (ref: string, level: number) => update(ref, (s) => ({ ...s, hints: Math.max(s.hints, level) }));

/**
 * Record a validated attempt. `correct` must come from the existing grader. A correct attempt
 * ends the session as solved; a wrong one only counts. Returns the finished session when solved.
 */
export function noteAttempt(ref: string, correct: boolean, now = Date.now(), commit: (s: SolveSession) => void = () => {}): SolveSession | null {
  const store = readStore();
  const s = store[ref];
  if (!s) return null;
  const counted = { ...s, attempts: s.attempts + 1, executions: s.executions + 1 };
  if (!correct) { writeStore({ ...store, [ref]: counted }); return null; }
  return endSession(ref, "solved", now, commit, counted);
}

/** Finish without a validated solve: recorded as abandoned, never as success. */
export const finishSession = (ref: string, commit: (s: SolveSession) => void, now = Date.now()) =>
  endSession(ref, "abandoned", now, commit);

function endSession(ref: string, status: SessionStatus, now: number, commit: (s: SolveSession) => void, override?: ActiveSession): SolveSession | null {
  const store = readStore();
  const s = override ?? store[ref];
  if (!s) return null;
  const done = toSession(s, status, now);
  const { [ref]: _gone, ...rest } = store;
  writeStore(rest);
  commit(done);
  return done;
}

/** Close unfinished sessions nobody has touched for a week, so the store cannot grow forever. */
export function sweepStale(commit: (s: SolveSession) => void, now = Date.now()) {
  const store = readStore();
  for (const [ref, s] of Object.entries(store)) {
    if (now - s.beat <= STALE_MS) continue;
    if (s.executions > 0 || s.attempts > 0) endSession(ref, "abandoned", s.beat, commit);
    else { const { [ref]: _g, ...rest } = readStore(); writeStore(rest); }
  }
}
