/**
 * Gamification rules: XP, levels, achievements, missions and streaks.
 *
 * One rule set, two engines:
 * - Signed-in accounts: the database awards XP (supabase/migrations/006_gamification.sql). Rows in
 *   xp_events are written only by triggers, keyed by a unique source_key, so nothing is awarded twice
 *   and the client can't grant itself XP.
 * - Anonymous visitors: `computeLocal` derives the same events from the browser's progress record.
 * Both are pure derivations of things the learner actually did; there are no seeded or sample values.
 * Keep the numbers here in step with 006_gamification.sql (a test checks they match).
 */
import type { Progress } from "./progress";

export type EventKind = "sql" | "python" | "lesson" | "scenario" | "note" | "card" | "task" | "project" | "mock" | "track" | "day" | "achievement" | "mission";

export const XP = {
  sql: 20,
  sqlRevealed: 10,
  python: 15,
  lesson: 10,
  scenario: 15,
  note: 5,
  card: 2,
  /** At most this many flashcard reviews earn XP per day. */
  cardDailyCap: 20,
  task: 10,
  project: 100,
  mockPassed: 30,
  mockFinished: 10,
  /** A mock passes at this share of questions solved. */
  mockPassShare: 0.6,
  track: 50,
  day: 5,
} as const;

export const LEVELS = [
  { name: "Beginner", min: 0 },
  { name: "Explorer", min: 100 },
  { name: "Practitioner", min: 400 },
  { name: "Problem Solver", min: 1000 },
  { name: "Advanced Engineer", min: 2500 },
  { name: "DataForge Master", min: 5000 },
] as const;

export function levelOf(xp: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].min) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1];
  return { index: i, name: cur.name, min: cur.min, next: next ?? null, toNext: next ? next.min - xp : 0, share: next ? (xp - cur.min) / (next.min - cur.min) : 1 };
}

export interface Counters {
  sql: number; python: number; lesson: number; scenario: number; note: number; card: number; task: number;
  project: number; mock: number; mockPassed: number; track: number; deNotes: number; longestStreak: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** lucide-react icon name, resolved by the page. */
  icon: string;
  xp: number;
  /** Which counter and the value that unlocks it. */
  counter: keyof Counters;
  target: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first-query", name: "First SQL Query", description: "Solve your first SQL question.", icon: "Terminal", xp: 10, counter: "sql", target: 1 },
  { id: "sql-beginner", name: "SQL Beginner", description: "Solve 5 SQL questions.", icon: "Database", xp: 25, counter: "sql", target: 5 },
  { id: "sql-10", name: "10 Questions Solved", description: "Solve 10 SQL questions.", icon: "ListChecks", xp: 50, counter: "sql", target: 10 },
  { id: "sql-50", name: "50 Questions Solved", description: "Solve 50 SQL questions.", icon: "Trophy", xp: 150, counter: "sql", target: 50 },
  { id: "python-explorer", name: "Python Explorer", description: "Pass your first Python exercise.", icon: "FileCode2", xp: 25, counter: "python", target: 1 },
  { id: "python-solver", name: "Python Problem Solver", description: "Pass 10 Python exercises.", icon: "Code2", xp: 100, counter: "python", target: 10 },
  { id: "first-project", name: "First Project Completed", description: "Complete a project in the Projects lab.", icon: "FolderCheck", xp: 100, counter: "project", target: 1 },
  { id: "streak-7", name: "7-Day Streak", description: "Learn on 7 days in a row.", icon: "Flame", xp: 50, counter: "longestStreak", target: 7 },
  { id: "streak-30", name: "30-Day Streak", description: "Learn on 30 days in a row.", icon: "Flame", xp: 200, counter: "longestStreak", target: 30 },
  { id: "de-explorer", name: "Data Engineering Explorer", description: "Read 10 data engineering topics.", icon: "Workflow", xp: 50, counter: "deNotes", target: 10 },
  { id: "mock-pass", name: "Interview Ready", description: "Pass a timed mock interview (60% or more solved).", icon: "Timer", xp: 50, counter: "mockPassed", target: 1 },
  { id: "track-done", name: "Track Finisher", description: "Read every topic in a data engineering track.", icon: "Medal", xp: 75, counter: "track", target: 1 },
];

export interface MissionDef { id: string; period: "day" | "week"; label: string; kind: EventKind | "activeDay"; target: number; xp: number }

export const MISSIONS: MissionDef[] = [
  { id: "sql3", period: "day", label: "Solve 3 SQL questions", kind: "sql", target: 3, xp: 30 },
  { id: "py2", period: "day", label: "Pass 2 Python exercises", kind: "python", target: 2, xp: 20 },
  { id: "note1", period: "day", label: "Finish 1 learning note", kind: "note", target: 1, xp: 10 },
  { id: "cards5", period: "day", label: "Review 5 flashcards", kind: "card", target: 5, xp: 10 },
  { id: "task1", period: "day", label: "Pass 1 project task", kind: "task", target: 1, xp: 15 },
  { id: "w-sql10", period: "week", label: "Solve 10 SQL questions", kind: "sql", target: 10, xp: 60 },
  { id: "w-days4", period: "week", label: "Learn on 4 different days", kind: "activeDay", target: 4, xp: 40 },
  { id: "w-mock1", period: "week", label: "Finish a mock interview", kind: "mock", target: 1, xp: 40 },
];

export interface XpEvent { key: string; kind: EventKind; xp: number; at: string }

/** Monday (UTC) of the week containing `day`. */
export function weekStartOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Longest run of consecutive days in a list of YYYY-MM-DD dates (duplicates ignored). */
export function longestStreak(days: string[]): number {
  const s = [...new Set(days)].sort();
  let best = 0, run = 0, prev = "";
  for (const d of s) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Days ending on `today` (or yesterday, so a streak survives until tonight). */
export function currentStreak(days: string[], today: string): number {
  const s = new Set(days);
  let d = s.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (s.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export interface ProjectFacts { slug: string; completed: boolean; completedAt?: string; passedTasks: { id: string; at: string }[] }

/**
 * Every XP event the browser record supports, deduplicated by key. Achievement and mission
 * rewards are added last, from counters that are themselves derived from these events.
 */
export function computeLocal(p: Progress, opts: { projects?: ProjectFacts[]; deTopics?: Record<string, string[]> } = {}) {
  const events = new Map<string, XpEvent>();
  const add = (e: XpEvent) => { if (!events.has(e.key)) events.set(e.key, e); };

  for (const [num, q] of Object.entries(p.questions)) {
    // Only solves submitted in the editor here count (imported history has no `practiced` flag).
    if (q.solvedAt && q.practiced && !q.imported) add({ key: `sql:${num}`, kind: "sql", xp: q.revealed ? XP.sqlRevealed : XP.sql, at: q.solvedAt });
  }
  for (const [k, at] of Object.entries(p.lessons ?? {})) {
    if (k.startsWith("py:")) add({ key: k, kind: "python", xp: XP.python, at });
    else if (k.startsWith("scenario:")) add({ key: k, kind: "scenario", xp: XP.scenario, at });
    else if (k.includes("#")) add({ key: `lesson:${k}`, kind: "lesson", xp: XP.lesson, at });
  }
  for (const [slug, at] of Object.entries(p.read ?? {})) add({ key: `note:${slug}`, kind: "note", xp: XP.note, at });
  for (const [day, keys] of Object.entries(p.reviews ?? {})) {
    [...new Set(keys)].slice(0, XP.cardDailyCap).forEach((k) => add({ key: `card:${k}:${day}`, kind: "card", xp: XP.card, at: `${day}T12:00:00.000Z` }));
  }
  (p.mocks ?? []).forEach((m) => {
    const passed = m.total > 0 && m.solved / m.total >= XP.mockPassShare;
    add({ key: `mock:${m.date}`, kind: "mock", xp: passed ? XP.mockPassed : XP.mockFinished, at: m.date });
  });
  for (const pr of opts.projects ?? []) {
    pr.passedTasks.forEach((t) => add({ key: `task:${pr.slug}:${t.id}`, kind: "task", xp: XP.task, at: t.at }));
    if (pr.completed) add({ key: `project:${pr.slug}`, kind: "project", xp: XP.project, at: pr.completedAt ?? pr.passedTasks.map((t) => t.at).sort().at(-1) ?? "" });
  }
  let tracksDone = 0;
  let deNotes = 0;
  for (const [track, slugs] of Object.entries(opts.deTopics ?? {})) {
    const reads = slugs.map((s) => p.read?.[s]).filter((x): x is string => Boolean(x));
    deNotes += reads.length;
    if (slugs.length && reads.length === slugs.length) {
      tracksDone++;
      add({ key: `track:${track}`, kind: "track", xp: XP.track, at: reads.sort().at(-1)! });
    }
  }

  const base = [...events.values()];
  // One daily-activity bonus per day with at least one earning action.
  const days = [...new Set(base.map((e) => e.at.slice(0, 10)).filter(Boolean))];
  days.forEach((d) => add({ key: `day:${d}`, kind: "day", xp: XP.day, at: `${d}T00:00:00.000Z` }));

  const count = (k: EventKind) => base.filter((e) => e.kind === k).length;
  const counters: Counters = {
    sql: count("sql"), python: count("python"), lesson: count("lesson"), scenario: count("scenario"), note: count("note"),
    card: count("card"), task: count("task"), project: count("project"), mock: count("mock"),
    mockPassed: (p.mocks ?? []).filter((m) => m.total > 0 && m.solved / m.total >= XP.mockPassShare).length,
    track: tracksDone, deNotes, longestStreak: longestStreak(days),
  };

  // Achievements: unlocked when the counter reaches the target; dated by the event that got it there.
  const datesFor = (c: keyof Counters): string[] => {
    const kind: Partial<Record<keyof Counters, EventKind>> = { sql: "sql", python: "python", project: "project", track: "track", note: "note" };
    if (c === "deNotes") return Object.values(opts.deTopics ?? {}).flat().map((s) => p.read?.[s]).filter((x): x is string => Boolean(x)).sort();
    if (c === "mockPassed") return (p.mocks ?? []).filter((m) => m.total > 0 && m.solved / m.total >= XP.mockPassShare).map((m) => m.date).sort();
    if (c === "longestStreak") return [];
    return base.filter((e) => e.kind === kind[c]).map((e) => e.at).sort();
  };
  const achievements = ACHIEVEMENTS.map((a) => {
    const value = counters[a.counter];
    const unlocked = value >= a.target;
    let unlockedAt: string | null = null;
    if (unlocked) {
      if (a.counter === "longestStreak") {
        const s = [...days].sort();
        let run = 0, prev = "";
        for (const d of s) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; prev = d; if (run >= a.target) { unlockedAt = `${d}T23:59:59.000Z`; break; } }
      } else unlockedAt = datesFor(a.counter)[a.target - 1] ?? null;
    }
    return { ...a, value, unlocked, unlockedAt };
  });
  achievements.filter((a) => a.unlocked).forEach((a) => add({ key: `achievement:${a.id}`, kind: "achievement", xp: a.xp, at: a.unlockedAt ?? "" }));

  // Missions: rewarded once per period when the period's count reaches the target.
  for (const key of completedMissionKeys(base)) {
    const start = key.split(":")[2];
    add({ key, kind: "mission", xp: MISSIONS.find((m) => m.id === key.split(":")[1])!.xp, at: `${start}T23:59:59.000Z` });
  }

  const all = [...events.values()];
  const xp = all.reduce((s, e) => s + e.xp, 0);
  const missionsFor = (today: string) => missionProgress(base, today);
  return { events: all, xp, counters, achievements, activeDays: days.sort(), missionsFor };
}

/** XP gained since `since` (inclusive), for weekly/monthly views. */
export const xpSince = (events: XpEvent[], since: string) => events.filter((e) => e.at.slice(0, 10) >= since).reduce((s, e) => s + e.xp, 0);

const BASE_KINDS = (e: Pick<XpEvent, "kind">) => !["achievement", "mission", "day"].includes(e.kind);

function dayCounts(events: Pick<XpEvent, "kind" | "at">[]) {
  const byDay = new Map<string, Record<string, number>>();
  for (const e of events.filter(BASE_KINDS)) {
    const d = e.at.slice(0, 10);
    const m = byDay.get(d) ?? {};
    m[e.kind] = (m[e.kind] ?? 0) + 1;
    byDay.set(d, m);
  }
  return byDay;
}

function periodCount(byDay: Map<string, Record<string, number>>, def: MissionDef, start: string) {
  const span = def.period === "day" ? 1 : 7;
  let n = 0;
  for (let i = 0; i < span; i++) {
    const d = addDays(start, i);
    n += def.kind === "activeDay" ? (byDay.has(d) ? 1 : 0) : byDay.get(d)?.[def.kind] ?? 0;
  }
  return n;
}

/** Mission keys ("mission:<id>:<period start>") that a list of earning events completes. */
export function completedMissionKeys(events: Pick<XpEvent, "kind" | "at">[]): string[] {
  const byDay = dayCounts(events);
  const periods = new Set<string>();
  for (const d of byDay.keys()) { periods.add(`day|${d}`); periods.add(`week|${weekStartOf(d)}`); }
  const out: string[] = [];
  for (const per of periods) {
    const [period, start] = per.split("|");
    for (const m of MISSIONS.filter((x) => x.period === period)) if (periodCount(byDay, m, start) >= m.target) out.push(`mission:${m.id}:${start}`);
  }
  return out.sort();
}

/** Today's and this week's missions with progress. Daily missions reset at 00:00 UTC, weekly on Monday. */
export function missionProgress(events: Pick<XpEvent, "kind" | "at">[], today: string) {
  const byDay = dayCounts(events);
  return MISSIONS.map((m) => {
    const start = m.period === "day" ? today : weekStartOf(today);
    const value = periodCount(byDay, m, start);
    return { ...m, value: Math.min(value, m.target), done: value >= m.target, start };
  });
}

/** Distinct UTC days with at least one earning action. */
export const earningDays = (events: Pick<XpEvent, "kind" | "at">[]) => [...new Set(events.filter(BASE_KINDS).map((e) => e.at.slice(0, 10)))].sort();
