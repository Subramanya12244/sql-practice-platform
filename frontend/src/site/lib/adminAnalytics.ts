/**
 * Pure helpers for the admin analytics screens (migration 008 RPCs). Kept free of React and
 * Supabase so they are unit-tested directly.
 */

export interface Learner {
  id: string; username: string; role: "user" | "admin"; created_at: string; last_seen_at: string | null; last_activity_at: string | null;
  sql_solved: number; sql_attempts: number; sql_submits: number; sql_passed: number;
  py_solved: number; py_submits: number; py_passed: number;
  active_min_7d: number; active_min_30d: number; active_min_total: number; sessions: number; mocks: number;
}

export interface TrendDay { day: string; activeUsers: number; activeMinutes: number; signups: number; sqlSubmits: number; pySubmits: number }
export interface Overview {
  users: number; dau: number; wau: number; mau: number; activeUsers: number; registrations: number;
  sessions: number; avgSessionMin: number | null; activeMinutes: number; avgActiveMinPerUser: number | null;
  sqlSubmits: number; sqlPassed: number; sqlSolves: number; pySubmits: number; pyPassed: number; pySolves: number;
  lessonsCompleted: number; projectsCompleted: number; assessments: number; trend: TrendDay[];
}
export interface ProblemStat { kind: "sql" | "python"; ref: string; submits: number; passed: number; hidden_failed: number; learners: number }

/** Postgres bigint arrives as a string; normalise every numeric column. */
export function toLearner(r: Record<string, unknown>): Learner {
  const out: Record<string, unknown> = { ...r };
  for (const k of Object.keys(out)) if (/^(sql_|py_|active_min|sessions$|mocks$)/.test(k)) out[k] = Number(out[k] ?? 0);
  return out as unknown as Learner;
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

const DAY = 86_400_000;
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function presetRange(days: number, now = Date.now()) {
  return { from: isoDay(now - (days - 1) * DAY), to: isoDay(now) };
}
/** Validates an inclusive range the RPCs accept (max 367 days, from ≤ to). */
export function validRange(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && a <= b && (b - a) / DAY <= 366;
}

export type LearnerSort = "username" | "created_at" | "last_activity_at" | "sql_solved" | "py_solved" | "active_min_30d" | "accuracy";
export interface LearnerFilter { q: string; role: "" | "user" | "admin"; activity: "" | "active7" | "inactive14" | "never"; sort: LearnerSort; desc: boolean }

export const learnerAccuracy = (l: Learner) => pct(l.sql_passed + l.py_passed, l.sql_submits + l.py_submits);
const lastActive = (l: Learner) => l.last_activity_at ?? l.last_seen_at;

export function filterLearners(all: Learner[], f: LearnerFilter, now = Date.now()): Learner[] {
  const q = f.q.trim().toLowerCase();
  const rows = all.filter((l) => {
    if (q && !l.username.toLowerCase().includes(q)) return false;
    if (f.role && l.role !== f.role) return false;
    const t = lastActive(l) ? Date.parse(lastActive(l)!) : null;
    if (f.activity === "active7" && !(t && now - t <= 7 * DAY)) return false;
    if (f.activity === "inactive14" && !(t === null || now - t > 14 * DAY)) return false;
    if (f.activity === "never" && t !== null) return false;
    return true;
  });
  const val = (l: Learner): string | number => {
    if (f.sort === "accuracy") return learnerAccuracy(l) ?? -1;
    if (f.sort === "last_activity_at") return lastActive(l) ?? "";
    return l[f.sort] ?? "";
  };
  return rows.sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (f.desc ? -c : c) || a.username.localeCompare(b.username);
  });
}

/** Learners with no activity for `days` (never-active learners included), longest-idle first. */
export function inactiveLearners(all: Learner[], days = 14, now = Date.now()) {
  return all.filter((l) => l.role === "user").map((l) => ({ l, idleDays: lastActive(l) ? Math.floor((now - Date.parse(lastActive(l)!)) / DAY) : null }))
    .filter((x) => x.idleDays === null || x.idleDays >= days)
    .sort((a, b) => (b.idleDays ?? Infinity) - (a.idleDays ?? Infinity));
}

export interface ProblemLookup { sql: Map<number, { title: string; topic: string; path: string }>; python: Map<string, { title: string; topic: string }> }

export function describeProblem(s: ProblemStat, lookup: ProblemLookup) {
  if (s.kind === "sql") {
    const n = Number(s.ref.replace(/^q/, ""));
    const q = lookup.sql.get(n);
    return { title: q ? `Q${n} ${q.title}` : s.ref, topic: q?.topic ?? "Other SQL", path: q?.path ?? null };
  }
  const slug = s.ref.replace(/^py:/, "");
  const p = lookup.python.get(slug);
  return { title: p?.title ?? slug, topic: p?.topic ?? "Other Python", path: `/practice/python/${slug}` };
}

/** Problems with the most failed checks (min. `minSubmits`), with fail rate. Lesson refs are skipped. */
export function failedProblems(stats: ProblemStat[], lookup: ProblemLookup, minSubmits = 2, limit = 15) {
  return stats.filter((s) => (s.kind === "python" || /^q\d+$/.test(s.ref)) && s.submits >= minSubmits)
    .map((s) => ({ ...s, ...describeProblem(s, lookup), fails: s.submits - s.passed, failRate: pct(s.submits - s.passed, s.submits)! }))
    .sort((a, b) => b.fails - a.fails || b.failRate - a.failRate || a.ref.localeCompare(b.ref))
    .slice(0, limit);
}

/** Topics ranked by fail rate across their problems (min. `minSubmits` checks per topic). */
export function difficultTopics(stats: ProblemStat[], lookup: ProblemLookup, minSubmits = 3) {
  const by = new Map<string, { topic: string; kind: string; submits: number; passed: number; problems: number }>();
  for (const s of stats) {
    if (s.kind === "sql" && !/^q\d+$/.test(s.ref)) continue;
    const { topic } = describeProblem(s, lookup);
    const k = `${s.kind}:${topic}`;
    const t = by.get(k) ?? { topic, kind: s.kind, submits: 0, passed: 0, problems: 0 };
    t.submits += s.submits; t.passed += s.passed; t.problems++;
    by.set(k, t);
  }
  return [...by.values()].filter((t) => t.submits >= minSubmits)
    .map((t) => ({ ...t, failRate: pct(t.submits - t.passed, t.submits)! }))
    .sort((a, b) => b.failRate - a.failRate || b.submits - a.submits);
}
