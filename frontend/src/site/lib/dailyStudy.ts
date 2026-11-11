/**
 * Daily Learning study time: pure functions. A study session is the active time spent on ONE lesson, measured by the same
 * clock the SQL/Python solve timer uses (lib/solveSessions.ts: heartbeat grace, auto-pause when hidden, one shared clock per
 * lesson across tabs). Finished sessions live inside `Progress.daily` (`DayRecord.study`), so they sync and merge with the rest
 * of the programme and never touch `Progress.sessions` (the SQL/Python analytics).
 *
 * Nothing here reads storage or the clock.
 */
import { addDays } from "./revision";
import { activeMs, type ActiveSession } from "./solveSessions";
import { PHASE_BY_ID, type BranchId, type DayMeta } from "./daily";
import type { DailyState, DayRecord } from "./dailyProgress";

export interface StudySession {
  id: string;
  startedAt: string;
  endedAt: string;
  /** Seconds the learner was actually present (visible tab, recent heartbeat). */
  activeSec: number;
  /** Wall-clock seconds between start and end that were not active (tab hidden, paused, laptop asleep). */
  awaySec: number;
}

/** Sessions shorter than this are noise (a page opened by mistake) and are dropped instead of stored. */
export const MIN_STUDY_SEC = 5;
/** One lesson keeps at most this many sessions; the oldest are folded away (the cap only bounds storage). */
export const MAX_SESSIONS_PER_DAY = 60;
/** An unfinished daily session untouched this long is committed (ended at its last heartbeat) on the next sweep. */
export const DAILY_STALE_MS = 30 * 60_000;

export const dayRef = (dayId: string) => `day:${dayId}`;

/** Convert a running/paused timer to a stored session ending at `endMs`. Undefined when too short to keep. */
export function toStudySession(s: ActiveSession, endMs: number): StudySession | undefined {
  const activeSec = Math.round(activeMs(s, endMs) / 1000);
  if (activeSec < MIN_STUDY_SEC) return undefined;
  const wallSec = Math.max(0, Math.round((endMs - Date.parse(s.startedAt)) / 1000));
  return { id: s.id, startedAt: s.startedAt, endedAt: new Date(endMs).toISOString(), activeSec, awaySec: Math.max(0, wallSec - activeSec) };
}

/** Union by id; the copy that ended later wins (a session only ever grows). Oldest first, capped. Safe to repeat. */
export function mergeStudy(a: StudySession[] = [], b: StudySession[] = [], cap = MAX_SESSIONS_PER_DAY): StudySession[] {
  const byId = new Map<string, StudySession>();
  for (const s of [...b, ...a]) {
    const prev = byId.get(s.id);
    if (!prev || s.endedAt > prev.endedAt || (s.endedAt === prev.endedAt && s.activeSec > prev.activeSec)) byId.set(s.id, s);
  }
  return [...byId.values()].sort((x, y) => x.endedAt.localeCompare(y.endedAt)).slice(-cap);
}

export const withStudy = (rec: DayRecord, s: StudySession): DayRecord => ({ ...rec, study: mergeStudy(rec.study, [s]) });

// ── Analytics ────────────────────────────────────────────────────────────
export const studySec = (rec: DayRecord | undefined) => (rec?.study ?? []).reduce((n, s) => n + s.activeSec, 0);
export const awaySec = (rec: DayRecord | undefined) => (rec?.study ?? []).reduce((n, s) => n + s.awaySec, 0);

const dateOf = (s: StudySession) => s.endedAt.slice(0, 10);

export interface StudyAnalytics {
  totalSec: number;
  awaySec: number;
  sessions: number;
  /** Lessons with any recorded time. */
  daysStudied: number;
  /** Mean active seconds per completed lesson that has recorded time. */
  avgPerCompletedSec: number;
  /** Mean active seconds per calendar date with study. */
  avgPerStudyDateSec: number;
  /** Active seconds per date (the date the session ended), ascending. */
  byDate: { date: string; sec: number }[];
  /** Seven-day windows ending today, oldest first. */
  weeks: { start: string; end: string; sec: number }[];
  thisWeekSec: number;
  todaySec: number;
  /** By phase id, for the days in `seq`. */
  byPhase: { phase: string; title: string; sec: number; days: number }[];
  /** Planned minutes versus actual, for lessons that were completed. */
  vsBudget: { plannedMin: number; actualMin: number; lessons: number };
  /** Longest-studied lessons, descending. */
  top: { id: string; sec: number }[];
}

/**
 * `seq` is the sequence the learner follows (common core plus the chosen path) so Analyst and Engineer time are never mixed.
 * Time on lessons outside `seq` (a path switched later) still counts in `all` but not in the path breakdown.
 */
export function studyAnalytics(state: DailyState, seq: DayMeta[], today: string, weeks = 8): StudyAnalytics {
  const inSeq = new Map(seq.map((d) => [d.id, d]));
  const dates = new Map<string, number>();
  let total = 0, away = 0, sessions = 0, daysStudied = 0;
  const phase = new Map<string, { sec: number; days: number }>();
  const top: { id: string; sec: number }[] = [];
  let plannedMin = 0, actualSec = 0, lessons = 0, doneSec = 0, doneN = 0;
  for (const [id, rec] of Object.entries(state.days)) {
    const list = rec.study ?? [];
    if (!list.length) continue;
    const meta = inSeq.get(id);
    if (!meta) continue;
    const sec = studySec(rec);
    daysStudied++; total += sec; away += awaySec(rec); sessions += list.length;
    for (const s of list) dates.set(dateOf(s), (dates.get(dateOf(s)) ?? 0) + s.activeSec);
    const p = phase.get(meta.phase) ?? { sec: 0, days: 0 };
    phase.set(meta.phase, { sec: p.sec + sec, days: p.days + 1 });
    top.push({ id, sec });
    if (rec.completedAt) { doneSec += sec; doneN++; plannedMin += meta.minutes; actualSec += sec; lessons++; }
  }
  const byDate = [...dates].map(([date, sec]) => ({ date, sec })).sort((a, b) => a.date.localeCompare(b.date));
  const wk: StudyAnalytics["weeks"] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = addDays(today, -7 * i), start = addDays(end, -6);
    wk.push({ start, end, sec: byDate.filter((d) => d.date >= start && d.date <= end).reduce((n, d) => n + d.sec, 0) });
  }
  return {
    totalSec: total, awaySec: away, sessions, daysStudied,
    avgPerCompletedSec: doneN ? Math.round(doneSec / doneN) : 0,
    avgPerStudyDateSec: byDate.length ? Math.round(total / byDate.length) : 0,
    byDate, weeks: wk, thisWeekSec: wk[wk.length - 1]?.sec ?? 0, todaySec: dates.get(today) ?? 0,
    byPhase: [...phase].map(([id, v]) => ({ phase: id, title: PHASE_BY_ID.get(id)?.title ?? id, ...v })).sort((a, b) => a.phase.localeCompare(b.phase, undefined, { numeric: true })),
    vsBudget: { plannedMin, actualMin: Math.round(actualSec / 60), lessons },
    top: top.sort((a, b) => b.sec - a.sec).slice(0, 5),
  };
}

/** Branch label for a breakdown heading. */
export const branchLabel = (b: BranchId | undefined) => (b === "analyst" ? "Data Analyst path" : b === "engineer" ? "Data Engineer path" : "Common core");
