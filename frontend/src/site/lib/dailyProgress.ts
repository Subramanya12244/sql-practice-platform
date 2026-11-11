/**
 * Daily Learning progress: pure functions over `Progress.daily`. The writers live in progress.ts, so Daily Learning shares
 * the same storage, sync, streak and revision machinery as the rest of DataForge. Nothing here reads storage or the clock.
 *
 * Completion and mastery are separate:
 * - Complete: theory viewed, every required guided exercise passed, every required independent exercise attempted,
 *   knowledge check at least 60%.
 * - Mastered: check at least 80%, every independent exercise passed, revision task done.
 * Opening a day never completes it, and revisiting a completed day never removes history.
 */
import { addDays, nextRevision, type RevItem } from "./revision";
import type { BranchId, Check, DayExtras, DayMeta, PhaseMeta } from "./daily";
import { PHASE_BY_ID } from "./daily";
import { mergeStudy, type StudySession } from "./dailyStudy";

export interface DayRecord {
  /** ISO time the theory was read to the end. */
  theory?: string;
  /** Example ids run with the expected output. */
  examples?: string[];
  /** Exercise ids run or submitted at least once. */
  attempted?: string[];
  /** Exercise ids passed with the learner's own code. */
  passed?: string[];
  /** Knowledge check: best and latest score (0–1), when it was last taken. */
  check?: { best: number; last: number; at: string };
  /** The revision task was marked done. */
  revised?: string;
  startedAt?: string;
  lastVisit?: string;
  completedAt?: string;
  /** Saved code per exercise id, so a learner can stop and continue later. */
  drafts?: Record<string, string>;
  /** Finished study-time sessions for this lesson (active seconds only; see lib/dailyStudy.ts). Absent on older data. */
  study?: StudySession[];
}

export interface DailyState {
  /** Chosen specialisation path; the common core needs none. */
  path?: BranchId;
  /** First day (YYYY-MM-DD) the learner opened Daily Learning. */
  startedOn?: string;
  days: Record<string, DayRecord>;
}

export const EMPTY_DAILY: DailyState = { days: {} };

export const PASS_SCORE = 0.6;
export const MASTERY_SCORE = 0.8;
export const MAX_DRAFT_CHARS = 6000;

const uniq = (a: string[]) => [...new Set(a)];
export const withId = (list: string[] | undefined, id: string) => uniq([...(list ?? []), id]);

// ── Knowledge check ──────────────────────────────────────────────────────
export function checkScore(answers: Record<string, number>, checks: Check[]): number {
  if (!checks.length) return 0;
  return checks.filter((c) => answers[c.id] === c.answer).length / checks.length;
}

export function withCheckResult(rec: DayRecord | undefined, score: number, at: string): DayRecord {
  const prev = rec?.check;
  return { ...rec, check: { best: Math.max(prev?.best ?? 0, score), last: score, at } };
}

// ── Completion and mastery ───────────────────────────────────────────────
export interface Completion {
  theory: boolean;
  guided: { done: number; total: number };
  independent: { attempted: number; total: number };
  check: { score: number | null; needed: number; ok: boolean };
  /** Labels of what is still missing, in the order a learner should do them. */
  missing: string[];
  complete: boolean;
}

const required = (list: DayExtras["guided"]) => list.filter((e) => e.required !== false);

export function completionOf(rec: DayRecord | undefined, extras: DayExtras): Completion {
  const g = required(extras.guided);
  const i = required(extras.independent);
  const passed = new Set(rec?.passed ?? []);
  const attempted = new Set([...(rec?.attempted ?? []), ...(rec?.passed ?? [])]);
  const guided = { done: g.filter((e) => passed.has(e.id)).length, total: g.length };
  const independent = { attempted: i.filter((e) => attempted.has(e.id)).length, total: i.length };
  const score = rec?.check?.best ?? null;
  const check = { score, needed: PASS_SCORE, ok: score !== null && score >= PASS_SCORE };
  const theory = !!rec?.theory;
  const missing: string[] = [];
  if (!theory) missing.push("Read the theory to the end");
  if (guided.done < guided.total) missing.push(`Pass ${guided.total - guided.done} more guided exercise${guided.total - guided.done === 1 ? "" : "s"}`);
  if (independent.attempted < independent.total) missing.push(`Attempt ${independent.total - independent.attempted} more independent exercise${independent.total - independent.attempted === 1 ? "" : "s"}`);
  if (!check.ok) missing.push(score === null ? "Take the knowledge check" : `Reach ${Math.round(PASS_SCORE * 100)}% on the knowledge check (best so far ${Math.round(score * 100)}%)`);
  return { theory, guided, independent, check, missing, complete: missing.length === 0 };
}

export interface Mastery {
  mastered: boolean;
  checkOk: boolean;
  independentPassed: { done: number; total: number };
  revised: boolean;
}

export function masteryOf(rec: DayRecord | undefined, extras: DayExtras): Mastery {
  const passed = new Set(rec?.passed ?? []);
  const ind = extras.independent;
  const done = ind.filter((e) => passed.has(e.id)).length;
  const checkOk = (rec?.check?.best ?? 0) >= MASTERY_SCORE;
  const revised = !!rec?.revised;
  return { mastered: checkOk && done === ind.length && revised, checkOk, independentPassed: { done, total: ind.length }, revised };
}

// ── Status ───────────────────────────────────────────────────────────────
export type DayStatus = "completed" | "revision" | "in-progress" | "available";

export const STATUS_LABEL: Record<DayStatus, string> = {
  available: "Available",
  "in-progress": "In progress",
  completed: "Completed",
  revision: "Revision required",
};

/** Has the learner done anything on this day yet? (Opening it does not count.) */
export const hasActivity = (r?: DayRecord) =>
  !!r && (!!r.theory || !!r.examples?.length || !!r.attempted?.length || !!r.passed?.length || !!r.check || !!r.revised || !!r.drafts && Object.keys(r.drafts).length > 0);

export const revisionKey = (id: string) => `day:${id}`;

/**
 * `revision` is the day's spaced-review item. A completed day needs revision when its review date has come, or when the
 * latest knowledge check dropped below the pass mark. Completion itself is kept.
 */
export function dayStatus(rec: DayRecord | undefined, revision: RevItem | undefined, today: string): DayStatus {
  if (rec?.completedAt) {
    const weak = rec.check && rec.check.last < PASS_SCORE;
    return revision && revision.due <= today || weak ? "revision" : "completed";
  }
  return hasActivity(rec) ? "in-progress" : "available";
}

/** Schedule the next review of a day from its latest check score. 80% or more is a clean review. */
export function reviewAfterCheck(prev: RevItem | undefined, score: number, now: Date): RevItem {
  return nextRevision(prev, { correct: score >= MASTERY_SCORE }, now);
}

// ── Programme view ───────────────────────────────────────────────────────
export const isDone = (state: DailyState, id: string) => !!state.days[id]?.completedAt;

/** First day in the sequence not completed. Undefined once the whole programme is finished. */
export function currentDay(seq: DayMeta[], state: DailyState): DayMeta | undefined {
  return seq.find((d) => !isDone(state, d.id));
}

export interface ProgrammeStats {
  total: number;
  completed: number;
  remaining: number;
  percent: number;
  remainingMinutes: number;
  mastered: number;
  phase?: PhaseMeta;
  current?: DayMeta;
}

export function programmeStats(seq: DayMeta[], state: DailyState, masteredIds: ReadonlySet<string> = new Set()): ProgrammeStats {
  const completed = seq.filter((d) => isDone(state, d.id)).length;
  const current = currentDay(seq, state);
  return {
    total: seq.length,
    completed,
    remaining: seq.length - completed,
    percent: seq.length ? Math.round((completed / seq.length) * 100) : 0,
    remainingMinutes: seq.filter((d) => !isDone(state, d.id)).reduce((s, d) => s + d.minutes, 0),
    mastered: seq.filter((d) => masteredIds.has(d.id)).length,
    phase: current ? PHASE_BY_ID.get(current.phase) : undefined,
    current,
  };
}

/** Days (YYYY-MM-DD) with any Daily Learning activity: a visit with work done, or a completion. */
export function activityDates(state: DailyState): string[] {
  const out = new Set<string>();
  for (const r of Object.values(state.days)) {
    if (r.completedAt) out.add(r.completedAt.slice(0, 10));
    if (r.lastVisit && hasActivity(r)) out.add(r.lastVisit.slice(0, 10));
    if (r.check) out.add(r.check.at.slice(0, 10));
    if (r.startedAt && hasActivity(r)) out.add(r.startedAt.slice(0, 10));
  }
  return [...out].sort();
}

/**
 * Consecutive learning days ending today or yesterday. One missed day does not break it (a gap of two calendar days is
 * allowed), so a single day off never costs the learner their streak.
 */
export function learningStreak(dates: string[], today: string): number {
  const set = new Set(dates);
  let cursor = set.has(today) ? today : addDays(today, -1);
  if (!set.has(cursor) && !set.has(addDays(cursor, -1))) return 0;
  let n = 0;
  let gap = 0;
  for (let i = 0; i < 400; i++) {
    if (set.has(cursor)) { n++; gap = 0; } else if (++gap > 1) break;
    cursor = addDays(cursor, -1);
  }
  return n;
}

// ── Calendar ─────────────────────────────────────────────────────────────
export type CalendarKind = "completed" | "active" | "missed" | "revision" | "today" | "upcoming" | "future";

export interface CalendarDay {
  date: string;
  kind: CalendarKind;
  /** Day ids completed on this date. */
  completed: string[];
  /** Day ids whose review is due on this date. */
  revisions: string[];
  /** For upcoming dates: the lesson planned for it. */
  planned?: DayMeta;
}

/**
 * A timeline from the first activity to `ahead` days past today. Past dates without activity are "missed": shown quietly,
 * never counted against the learner. Future dates carry the next lessons one per day (a suggestion, not a deadline).
 */
export function buildCalendar(
  seq: DayMeta[], state: DailyState, revisions: Record<string, RevItem>, today: string, opts: { behind?: number; ahead?: number } = {},
): CalendarDay[] {
  const { behind = 27, ahead = 14 } = opts;
  const acts = new Set(activityDates(state));
  const first = state.startedOn ?? [...acts][0];
  const start = first && first < today ? (first > addDays(today, -behind) ? first : addDays(today, -behind)) : today;
  const completedOn: Record<string, string[]> = {};
  for (const [id, r] of Object.entries(state.days)) if (r.completedAt) (completedOn[r.completedAt.slice(0, 10)] ??= []).push(id);
  const dueOn: Record<string, string[]> = {};
  for (const [key, r] of Object.entries(revisions)) if (key.startsWith("day:") && state.days[key.slice(4)]?.completedAt) (dueOn[r.due < today ? today : r.due] ??= []).push(key.slice(4));
  const upcoming = seq.filter((d) => !isDone(state, d.id));
  const out: CalendarDay[] = [];
  const span = Math.round((Date.parse(`${addDays(today, ahead)}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  for (let i = 0; i <= span; i++) {
    const date = addDays(start, i);
    const completed = completedOn[date] ?? [];
    const revs = dueOn[date] ?? [];
    let kind: CalendarKind;
    if (date > today) kind = revs.length ? "revision" : "upcoming";
    else if (date === today) kind = completed.length ? "completed" : "today";
    else kind = completed.length ? "completed" : acts.has(date) ? "active" : revs.length ? "revision" : "missed";
    const planned = date >= today ? upcoming[date === today ? 0 : Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)] : undefined;
    out.push({ date, kind, completed, revisions: revs, planned });
  }
  return out;
}

/** Day ids with a review due on or before `today`. */
export function dueRevisions(state: DailyState, revisions: Record<string, RevItem>, today: string): string[] {
  return Object.entries(revisions)
    .filter(([key, r]) => key.startsWith("day:") && state.days[key.slice(4)]?.completedAt && r.due <= today)
    .sort((a, b) => a[1].due.localeCompare(b[1].due))
    .map(([key]) => key.slice(4));
}

// ── Account merge ────────────────────────────────────────────────────────
const earliest = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : a ?? b);
const latest = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : a ?? b);

export function mergeRecord(a: DayRecord = {}, b: DayRecord = {}): DayRecord {
  const checks = [a.check, b.check].filter((c): c is NonNullable<DayRecord["check"]> => !!c);
  const lastCheck = checks.sort((x, y) => y.at.localeCompare(x.at))[0];
  return {
    theory: earliest(a.theory, b.theory),
    examples: uniq([...(a.examples ?? []), ...(b.examples ?? [])]),
    attempted: uniq([...(a.attempted ?? []), ...(b.attempted ?? [])]),
    passed: uniq([...(a.passed ?? []), ...(b.passed ?? [])]),
    check: checks.length ? { best: Math.max(...checks.map((c) => c.best)), last: lastCheck.last, at: lastCheck.at } : undefined,
    revised: latest(a.revised, b.revised),
    startedAt: earliest(a.startedAt, b.startedAt),
    lastVisit: latest(a.lastVisit, b.lastVisit),
    completedAt: earliest(a.completedAt, b.completedAt),
    drafts: { ...(b.drafts ?? {}), ...(a.drafts ?? {}) },
    ...((a.study?.length || b.study?.length) ? { study: mergeStudy(a.study, b.study) } : {}),
  };
}

/** Account merge: per day, union the work done; never lose a completion. */
export function mergeDaily(a: DailyState | undefined, b: DailyState | undefined): DailyState | undefined {
  if (!a && !b) return undefined;
  const days: Record<string, DayRecord> = {};
  for (const id of new Set([...Object.keys(a?.days ?? {}), ...Object.keys(b?.days ?? {})])) days[id] = mergeRecord(a?.days[id], b?.days[id]);
  return { path: a?.path ?? b?.path, startedOn: earliest(a?.startedOn, b?.startedOn), days };
}
