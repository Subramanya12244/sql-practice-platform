/**
 * Learning activity and active-time tracking.
 *
 * Active time is the number of distinct minutes in which the learner actually interacted
 * (key, pointer, scroll) with a focused, visible tab. An open but idle tab counts nothing.
 * Minutes are keyed by their UTC start, so two tabs or two devices active in the same minute
 * still count it once (a set, not a sum). Session duration (first to last activity) is reported
 * separately from active time.
 *
 * Events get a UUID when created and wait in a localStorage queue until delivered, so a closed
 * browser or a failed request loses nothing and a retried batch can't duplicate (the server
 * ignores ids it already has).
 */

export const IDLE_MS = 60_000;          // no interaction for this long → not active
export const SESSION_GAP_MS = 30 * 60_000; // idle this long → the next activity starts a new session
export const HEARTBEAT_MS = 15_000;

export type ActivityType =
  | "login" | "session_start" | "session_end"
  | "lesson_opened" | "lesson_completed"
  | "sql_opened" | "sql_executed" | "sql_submitted"
  | "python_opened" | "python_executed" | "python_submitted"
  | "project_started" | "project_completed" | "assessment_completed";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  /** What it was about, e.g. "q25", "py:two-sum-indices", "lesson:joins". */
  ref?: string;
  /** e.g. { passed: true } for submissions. */
  meta?: Record<string, unknown>;
  at: string;
  session: string;
}

/** UTC minute bucket an instant falls in, as an ISO string ending in ":00.000Z". */
export const minuteOf = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString();

/** Is the learner active right now? Focus and visibility are required; so is recent interaction. */
export function isActive(now: number, lastInteraction: number, focused: boolean, visible: boolean): boolean {
  return focused && visible && lastInteraction > 0 && now - lastInteraction < IDLE_MS;
}

/** Whether activity at `now` belongs to the current session or starts a new one. */
export const startsNewSession = (lastActivity: number, now: number) => lastActivity === 0 || now - lastActivity > SESSION_GAP_MS;

/** Merge queued events with new ones, dropping duplicates by id, oldest first, capped. */
export function mergeQueue(queue: ActivityEvent[], add: ActivityEvent[], cap = 2000): ActivityEvent[] {
  const byId = new Map(queue.map((e) => [e.id, e]));
  for (const e of add) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-cap);
}

/** Add minutes to a set kept as a sorted array, dropping ones older than `keepDays`. */
export function addMinutes(minutes: string[], add: string[], now: number, keepDays = 120): string[] {
  const cutoff = new Date(now - keepDays * 86_400_000).toISOString();
  return [...new Set([...minutes, ...add])].filter((m) => m >= cutoff).sort();
}

export interface TimeSummary { todayMin: number; weekMin: number; totalMin: number; days: { day: string; minutes: number }[] }

/** Active minutes per day for the last `days` days ending `today` (UTC), plus totals. */
export function summarizeMinutes(minutes: string[], today: string, days = 7): TimeSummary {
  const perDay = new Map<string, number>();
  for (const m of minutes) perDay.set(m.slice(0, 10), (perDay.get(m.slice(0, 10)) ?? 0) + 1);
  const list = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day: d, minutes: perDay.get(d) ?? 0 };
  });
  return { todayMin: perDay.get(today) ?? 0, weekMin: list.reduce((s, d) => s + d.minutes, 0), totalMin: minutes.length, days: list };
}

export const formatMinutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

// ── Browser tracker ───────────────────────────────────────────────────────
const KEY = { queue: "sqlp.activity.queue", minutes: "sqlp.activity.minutes", sent: "sqlp.activity.sentMinutes", session: "sqlp.activity.session" };
const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

interface SessionState { id: string; started: number; last: number }

export interface ActivitySink {
  /** Deliver events and active minutes; resolve true when the server accepted them. */
  send(events: ActivityEvent[], minutes: string[], session: { id: string; started: string; last: string }): Promise<boolean>;
}
let sink: ActivitySink | null = null;
let lastInteraction = 0;
let started = false;
let listeners: (() => void)[] = [];

function session(now: number): SessionState {
  let s = read<SessionState | null>(KEY.session, null);
  if (!s || startsNewSession(s.last, now)) {
    if (s) enqueue({ type: "session_end", at: new Date(s.last).toISOString(), session: s.id });
    s = { id: crypto.randomUUID(), started: now, last: now };
    write(KEY.session, s);
    enqueue({ type: "session_start", at: new Date(now).toISOString(), session: s.id });
  }
  return s;
}

function enqueue(e: Omit<ActivityEvent, "id">) {
  write(KEY.queue, mergeQueue(read<ActivityEvent[]>(KEY.queue, []), [{ id: crypto.randomUUID(), ...e }]));
}

/** Record a learning event (deduplicated by id; delivered later if offline). */
export function track(type: ActivityType, ref?: string, meta?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  lastInteraction = now;
  const s = session(now);
  write(KEY.session, { ...s, last: now });
  enqueue({ type, ref, meta, at: new Date(now).toISOString(), session: s.id });
  markMinute(now);
}

function markMinute(now: number) {
  write(KEY.minutes, addMinutes(read<string[]>(KEY.minutes, []), [minuteOf(now)], now));
  listeners.forEach((l) => l());
}

let flushing = false;
export async function flush() {
  if (!sink || flushing || typeof navigator !== "undefined" && navigator.onLine === false) return;
  const queue = read<ActivityEvent[]>(KEY.queue, []);
  const all = read<string[]>(KEY.minutes, []);
  const sent = new Set(read<string[]>(KEY.sent, []));
  const minutes = all.filter((m) => !sent.has(m) && m < minuteOf(Date.now())); // only finished minutes
  const s = read<SessionState | null>(KEY.session, null);
  if (!queue.length && !minutes.length) return;
  flushing = true;
  try {
    const ok = await sink.send(queue.slice(0, 500), minutes.slice(0, 1000), s ? { id: s.id, started: new Date(s.started).toISOString(), last: new Date(s.last).toISOString() } : { id: "", started: "", last: "" });
    if (ok) {
      const delivered = new Set(queue.slice(0, 500).map((e) => e.id));
      write(KEY.queue, read<ActivityEvent[]>(KEY.queue, []).filter((e) => !delivered.has(e.id)));
      write(KEY.sent, addMinutes([...sent], minutes.slice(0, 1000), Date.now()));
    }
  } catch {
    /* keep everything queued; retried on the next flush */
  } finally {
    flushing = false;
  }
}

export function setActivitySink(next: ActivitySink | null) {
  sink = next;
  if (next) void flush();
}

/** Start listening for interaction; call once in the browser. */
export function startActivityTracking() {
  if (started || typeof window === "undefined") return;
  started = true;
  const onInput = () => {
    const now = Date.now();
    const firstInWhile = !isActive(now, lastInteraction, true, true);
    lastInteraction = now;
    if (firstInWhile) {
      const s = session(now);
      write(KEY.session, { ...s, last: now });
      markMinute(now);
    }
  };
  for (const ev of ["keydown", "pointerdown", "wheel", "touchstart"]) window.addEventListener(ev, onInput, { passive: true });
  setInterval(() => {
    const now = Date.now();
    if (isActive(now, lastInteraction, document.hasFocus(), document.visibilityState === "visible")) {
      const s = session(now);
      write(KEY.session, { ...s, last: now });
      markMinute(now);
    }
  }, HEARTBEAT_MS);
  setInterval(() => void flush(), 60_000);
  window.addEventListener("online", () => void flush());
  // pagehide fires on tab close and mobile backgrounding; the queue is already persisted, so a
  // best-effort flush is enough — anything not delivered goes out on the next visit.
  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });
}

export function activeMinutes(): string[] {
  return read<string[]>(KEY.minutes, []);
}
export function subscribeActivity(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}
/** Sign-out on a shared browser: drop this browser's local log (the account keeps its copy). */
export function clearActivity() {
  for (const k of Object.values(KEY)) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
}
