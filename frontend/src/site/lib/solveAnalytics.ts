/**
 * Performance analytics from solve sessions plus the progress records DataForge already keeps.
 * Pure functions: nothing here reads storage or the clock except through its arguments.
 *
 * Honesty rules:
 *  - Time and attempt numbers come only from sessions (the timer shipped with this feature), so
 *    older solves have completion data but no duration; the UI says so.
 *  - Topics are the curriculum's own: the 16 SQL topics and the 6 Python categories. Nothing is
 *    invented or merged.
 *  - Mastery never uses speed. It weighs completion (by difficulty), recent success, attempts
 *    per solve and how often hints were needed.
 */
import { PY_STAGES, getExerciseStage, type PyExerciseMeta } from "./pyExercises";
import { PY_CATEGORIES, type PyStat } from "./pyPractice";
import type { Progress } from "./progress";
import type { SolveSession } from "./solveSessions";
import type { QuestionSummary } from "../types";

const DAY = 86_400_000;
const WEIGHT: Record<string, number> = { Easy: 1, Medium: 1.5, Hard: 2 };
const w = (d: string) => WEIGHT[d] ?? 1;
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A session in which the learner actually tried something (not an open-and-leave). */
export const wasTried = (s: SolveSession) => s.executions > 0 || s.attempts > 0;

// ── Overall ───────────────────────────────────────────────────────────────
export interface Overall {
  totalActiveSec: number;
  sessions: number;
  attempted: number;
  completed: number;
  avgSolveSec: number | null;
  fastest: { ref: string; sec: number } | null;
  /** Distinct challenges solved over distinct challenges tried. */
  successRate: number | null;
  avgAttemptsPerSolve: number | null;
}

export function overall(sessions: SolveSession[]): Overall {
  const tried = sessions.filter(wasTried);
  const solved = sessions.filter((s) => s.status === "solved");
  const attempted = new Set(tried.map((s) => s.ref));
  const completed = new Set(solved.map((s) => s.ref));
  const secs = solved.map((s) => s.activeSec).filter((n) => n > 0);
  const fastest = solved.filter((s) => s.activeSec > 0).sort((a, b) => a.activeSec - b.activeSec)[0];
  return {
    totalActiveSec: sessions.reduce((t, s) => t + s.activeSec, 0),
    sessions: sessions.length,
    attempted: attempted.size,
    completed: completed.size,
    avgSolveSec: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : null,
    fastest: fastest ? { ref: fastest.ref, sec: fastest.activeSec } : null,
    successRate: attempted.size ? Math.round((completed.size / attempted.size) * 100) : null,
    avgAttemptsPerSolve: solved.length ? round1(solved.reduce((t, s) => t + s.attempts, 0) / solved.length) : null,
  };
}

// ── Topics and mastery ────────────────────────────────────────────────────
export type MasteryLevel = "strong" | "developing" | "needs-practice" | "not-started";

export interface TopicRow {
  kind: "sql" | "python";
  topic: string;
  label: string;
  total: number;
  solved: number;
  /** Sessions spent here (tried only). */
  sessions: number;
  activeSec: number;
  avgSolveSec: number | null;
  score: number | null;
  level: MasteryLevel;
  /** Why it is classified this way, in plain words. */
  reasons: string[];
}

interface Inputs {
  index: QuestionSummary[];
  exercises: PyExerciseMeta[];
  progress: Progress;
  pyStats: Record<string, PyStat>;
  sessions: SolveSession[];
}

const sqlRef = (n: number) => `sql:${n}`;
const pyRef = (slug: string) => `py:${slug}`;

interface Item { ref: string; difficulty: string; solved: boolean; attempts: number; helped: boolean; touched: boolean }

function sqlItems(index: QuestionSummary[], p: Progress, sessions: SolveSession[]): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  for (const q of index) {
    const s = p.questions[q.number];
    const used = sessions.some((x) => x.ref === sqlRef(q.number) && x.hints >= 2);
    const item: Item = {
      ref: sqlRef(q.number), difficulty: q.difficulty, solved: Boolean(s?.solvedAt),
      attempts: s?.practiced ? s.attempts : 0, helped: Boolean(s?.assisted || s?.revealed || used),
      touched: Boolean(s?.practiced && s.attempts > 0),
    };
    out.set(q.topic, [...(out.get(q.topic) ?? []), item]);
  }
  return out;
}

function pyItems(exercises: PyExerciseMeta[], p: Progress, stats: Record<string, PyStat>, sessions: SolveSession[]): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  for (const e of exercises) {
    const st = stats[e.slug];
    const hinted = sessions.some((x) => x.ref === pyRef(e.slug) && x.hints > 0 && x.status === "solved");
    const item: Item = {
      ref: pyRef(e.slug), difficulty: e.difficulty, solved: Boolean(p.lessons?.[pyRef(e.slug)]),
      attempts: st?.attempts ?? 0, helped: hinted, touched: Boolean(st?.attempts),
    };
    const key = e.category || "other";
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return out;
}

/** Score one topic and say why. `tried` are the topic's tried sessions, oldest first. */
export function masteryFor(items: Item[], tried: SolveSession[]): { score: number | null; level: MasteryLevel; reasons: string[] } {
  const touched = items.filter((i) => i.touched || i.solved);
  if (!touched.length && !tried.length) return { score: null, level: "not-started", reasons: ["You have not tried a challenge in this topic yet."] };

  const total = items.reduce((t, i) => t + w(i.difficulty), 0);
  const done = items.filter((i) => i.solved).reduce((t, i) => t + w(i.difficulty), 0);
  const completion = total ? done / total : 0;
  const solved = items.filter((i) => i.solved);

  // Recent success: the last 10 tried sessions. Before sessions exist, fall back to attempts per solve.
  const recent = tried.slice(-10);
  const recentRate = recent.length >= 3 ? recent.filter((s) => s.status === "solved").length / recent.length : null;

  // Attempts per solve: 1 is ideal; 5 or more counts as 0.
  const withAttempts = solved.filter((i) => i.attempts > 0);
  const avgAttempts = withAttempts.length ? withAttempts.reduce((t, i) => t + i.attempts, 0) / withAttempts.length : null;
  const efficiency = avgAttempts == null ? null : clamp(1 - (avgAttempts - 1) / 4);

  const independent = solved.length ? solved.filter((i) => !i.helped).length / solved.length : null;

  // Missing signals drop out and the others are re-weighted, so a new learner is not scored down for lack of data.
  const parts: [number, number | null][] = [[0.45, completion], [0.25, recentRate], [0.15, efficiency], [0.15, independent]];
  const used = parts.filter((p): p is [number, number] => p[1] != null);
  const wsum = used.reduce((t, p) => t + p[0], 0);
  const score = Math.round((used.reduce((t, p) => t + p[0] * p[1], 0) / wsum) * 100);

  const reasons = [`${solved.length} of ${items.length} solved (harder questions count more).`];
  if (recentRate != null) reasons.push(`Recent sessions: ${recent.filter((s) => s.status === "solved").length} of ${recent.length} ended solved.`);
  if (avgAttempts != null) reasons.push(`About ${round1(avgAttempts)} ${avgAttempts === 1 ? "attempt" : "attempts"} per solve.`);
  if (independent != null && solved.length) reasons.push(`${solved.filter((i) => !i.helped).length} of ${solved.length} solves needed no hints.`);

  const struggling = (recentRate != null && recentRate < 0.4) || (avgAttempts != null && avgAttempts >= 4);
  let level: MasteryLevel;
  if (score < 40 || struggling) level = "needs-practice";
  else if (score >= 70 && solved.length >= 3 && (recentRate == null || recentRate >= 0.6)) level = "strong";
  else level = "developing";
  if (level === "strong" && solved.length < 3) level = "developing";
  if (level === "developing" && solved.length < 3 && score >= 70) reasons.push("Solve a few more to count this as strong.");
  return { score, level, reasons };
}

export function topicRows({ index, exercises, progress, pyStats, sessions }: Inputs): TopicRow[] {
  const sq = sqlItems(index, progress, sessions);
  const py = pyItems(exercises, progress, pyStats, sessions);
  const slice = (kind: "sql" | "python", topic: string) => sessions.filter((s) => s.kind === kind && s.topic === topic);
  const rows: TopicRow[] = [];
  const add = (kind: "sql" | "python", topic: string, label: string, items: Item[]) => {
    const all = slice(kind, topic);
    const tried = all.filter(wasTried);
    const solvedSessions = tried.filter((s) => s.status === "solved");
    const m = masteryFor(items, tried);
    rows.push({
      kind, topic, label, total: items.length, solved: items.filter((i) => i.solved).length,
      sessions: tried.length, activeSec: all.reduce((t, s) => t + s.activeSec, 0),
      avgSolveSec: solvedSessions.length ? Math.round(solvedSessions.reduce((t, s) => t + s.activeSec, 0) / solvedSessions.length) : null,
      ...m,
    });
  };
  const seen = new Set<string>();
  for (const q of index) if (!seen.has(q.topic)) { seen.add(q.topic); add("sql", q.topic, q.topicLabel, sq.get(q.topic) ?? []); }
  for (const c of PY_CATEGORIES) if (py.has(c.slug)) add("python", c.slug, c.short, py.get(c.slug)!);
  return rows;
}

export function groupMastery(rows: TopicRow[]) {
  const by = (l: MasteryLevel) => rows.filter((r) => r.level === l).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { strong: by("strong"), developing: by("developing"), needsPractice: by("needs-practice").reverse(), notStarted: by("not-started") };
}

// ── Heatmap and streaks ───────────────────────────────────────────────────
export interface HeatDay { day: string; sec: number; level: 0 | 1 | 2 | 3 | 4 }

/** Active seconds per UTC day, from the day each session ended (the same day basis as the existing streak). */
export function secondsPerDay(sessions: SolveSession[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) if (s.activeSec > 0) m.set(s.endedAt.slice(0, 10), (m.get(s.endedAt.slice(0, 10)) ?? 0) + s.activeSec);
  return m;
}
const heatLevel = (sec: number): HeatDay["level"] => (sec <= 0 ? 0 : sec < 10 * 60 ? 1 : sec < 30 * 60 ? 2 : sec < 60 * 60 ? 3 : 4);

/** `weeks` columns of 7 days, Monday first, ending with the week that holds `today`. Future days are omitted. */
export function heatmap(sessions: SolveSession[], today: string, weeks = 26): { columns: (HeatDay | null)[][]; total: number } {
  const per = secondsPerDay(sessions);
  const end = Date.parse(`${today}T00:00:00Z`);
  const dow = (new Date(end).getUTCDay() + 6) % 7; // Monday = 0
  const start = end - dow * DAY - (weeks - 1) * 7 * DAY;
  const columns: (HeatDay | null)[][] = [];
  let total = 0;
  for (let c = 0; c < weeks; c++) {
    const col: (HeatDay | null)[] = [];
    for (let r = 0; r < 7; r++) {
      const t = start + (c * 7 + r) * DAY;
      if (t > end) { col.push(null); continue; }
      const day = new Date(t).toISOString().slice(0, 10);
      const sec = per.get(day) ?? 0;
      total += sec;
      col.push({ day, sec, level: heatLevel(sec) });
    }
    columns.push(col);
  }
  return { columns, total };
}

/**
 * Current and longest run of consecutive practice days. A day with no practice only ends a run;
 * the current streak stays alive through today so a learner is never "behind" before they start.
 */
export function streaks(sessions: SolveSession[], today: string): { current: number; longest: number; activeDays: number } {
  const days = [...secondsPerDay(sessions).keys()].sort();
  const set = new Set(days);
  let longest = 0, run = 0, prev = "";
  for (const d of days) {
    run = prev && Date.parse(`${d}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) === DAY ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let cur = 0;
  let t = Date.parse(`${today}T00:00:00Z`);
  if (!set.has(today)) t -= DAY;
  while (set.has(new Date(t).toISOString().slice(0, 10))) { cur++; t -= DAY; }
  return { current: cur, longest, activeDays: days.length };
}

/** Practice seconds in each of the last `n` weeks (Monday start), oldest first. */
export function weeklySeconds(sessions: SolveSession[], today: string, n = 8): { week: string; sec: number }[] {
  const per = secondsPerDay(sessions);
  const end = Date.parse(`${today}T00:00:00Z`);
  const monday = end - ((new Date(end).getUTCDay() + 6) % 7) * DAY;
  return Array.from({ length: n }, (_, i) => {
    const start = monday - (n - 1 - i) * 7 * DAY;
    let sec = 0;
    for (let d = 0; d < 7; d++) sec += per.get(new Date(start + d * DAY).toISOString().slice(0, 10)) ?? 0;
    return { week: new Date(start).toISOString().slice(5, 10), sec };
  });
}

// ── Recommendations ───────────────────────────────────────────────────────
export interface Recommendation { kind: "sql" | "python"; title: string; path: string; difficulty: string; reason: string }

const RANK: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };
const triedNote = (n = 0) => (n >= 2 ? `You have tried it ${n} times. ` : "");

/**
 * Up to `n` next challenges, each with a reason. Order of preference: topics that need practice,
 * unsolved questions you already tried and missed, then the next step in a partly finished track.
 * Solved questions come back only when the revision queue says they are due, never repeatedly.
 */
export function recommend(inputs: Inputs & { dueSql: QuestionSummary[]; today: string }, n = 4): Recommendation[] {
  const { index, exercises, progress, pyStats, dueSql } = inputs;
  const rows = topicRows(inputs);
  const out: Recommendation[] = [];
  const taken = new Set<string>();
  const push = (r: Recommendation, key: string) => { if (out.length < n && !taken.has(key)) { taken.add(key); out.push(r); } };

  const unsolvedSql = (topic: string) => index
    .filter((q) => q.topic === topic && !progress.questions[q.number]?.solvedAt)
    .sort((a, b) => (RANK[a.difficulty] ?? 1) - (RANK[b.difficulty] ?? 1) || a.number - b.number);
  /** Never jump more than one level above the hardest thing already solved in the topic. */
  const stepUp = (topic: string) => {
    const solvedMax = Math.max(-1, ...index.filter((q) => q.topic === topic && progress.questions[q.number]?.solvedAt).map((q) => RANK[q.difficulty] ?? 1));
    return unsolvedSql(topic).find((q) => (RANK[q.difficulty] ?? 1) <= solvedMax + 1) ?? unsolvedSql(topic)[0];
  };

  // 1. Weak topics, weakest first.
  for (const r of rows.filter((x) => x.level === "needs-practice").sort((a, b) => (a.score ?? 0) - (b.score ?? 0))) {
    if (r.kind === "sql") {
      const q = stepUp(r.topic);
      if (q) push({ kind: "sql", title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}`, difficulty: q.difficulty, reason: `${r.label} needs practice: ${r.reasons[0]} ${triedNote(progress.questions[q.number]?.attempts)}This is the next ${q.difficulty.toLowerCase()} step.` }, `sql:${q.number}`);
    } else {
      const e = exercises.filter((x) => (x.category || "other") === r.topic && !progress.lessons?.[pyRef(x.slug)])
        .sort((a, b) => (RANK[a.difficulty] ?? 1) - (RANK[b.difficulty] ?? 1))[0];
      if (e) push({ kind: "python", title: `${e.code} ${e.title}`, path: `/practice/python/${e.slug}`, difficulty: e.difficulty, reason: `${r.label} needs practice: ${r.reasons[0]}` }, pyRef(e.slug));
    }
  }
  // 2. Recent mistakes: tried, failed, never solved.
  const missed = index
    .filter((q) => { const s = progress.questions[q.number]; return s?.practiced && !s.solvedAt && s.attempts >= 2; })
    .sort((a, b) => (progress.questions[b.number]!.attempts - progress.questions[a.number]!.attempts));
  for (const q of missed) push({ kind: "sql", title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}`, difficulty: q.difficulty, reason: `You tried this ${progress.questions[q.number]!.attempts} times without a pass. Try again with fresh eyes, or open the hints.` }, `sql:${q.number}`);
  const missedPy = exercises.filter((e) => pyStats[e.slug]?.attempts >= 2 && !progress.lessons?.[pyRef(e.slug)]);
  for (const e of missedPy) push({ kind: "python", title: `${e.code} ${e.title}`, path: `/practice/python/${e.slug}`, difficulty: e.difficulty, reason: `${pyStats[e.slug].attempts} checks so far and not passing yet.` }, pyRef(e.slug));
  // 3. Due for revision (the existing spaced-review queue).
  for (const q of dueSql) push({ kind: "sql", title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}`, difficulty: q.difficulty, reason: "Due for revision: a quick re-solve keeps it fresh." }, `sql:${q.number}`);
  // 4. Next step in the Python stage you are partway through.
  const stageDone = new Map<number, { done: number; total: number }>();
  for (const e of exercises) {
    const s = getExerciseStage(e), c = stageDone.get(s) ?? { done: 0, total: 0 };
    c.total++; if (progress.lessons?.[pyRef(e.slug)]) c.done++;
    stageDone.set(s, c);
  }
  const open = [...stageDone.entries()].filter(([, c]) => c.done > 0 && c.done < c.total).sort((a, b) => a[0] - b[0])[0]
    ?? [...stageDone.entries()].filter(([, c]) => c.done < c.total).sort((a, b) => a[0] - b[0])[0];
  if (open) {
    const e = exercises.filter((x) => getExerciseStage(x) === open[0] && !progress.lessons?.[pyRef(x.slug)])
      .sort((a, b) => (RANK[a.difficulty] ?? 1) - (RANK[b.difficulty] ?? 1))[0];
    const name = PY_STAGES.find((s) => s.stage === open[0])?.name ?? `Stage ${open[0]}`;
    if (e) push({ kind: "python", title: `${e.code} ${e.title}`, path: `/practice/python/${e.slug}`, difficulty: e.difficulty, reason: `Next in Stage ${open[0]}: ${name} (${open[1].done} of ${open[1].total} done).` }, pyRef(e.slug));
  }
  // 5. Nothing tried yet: start at the easiest SQL question.
  if (!out.length) {
    const q = [...index].sort((a, b) => (RANK[a.difficulty] ?? 1) - (RANK[b.difficulty] ?? 1) || a.number - b.number).find((x) => !progress.questions[x.number]?.solvedAt);
    if (q) push({ kind: "sql", title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}`, difficulty: q.difficulty, reason: "A good first question: short and well explained." }, `sql:${q.number}`);
  }
  return out;
}

/** History for one challenge, newest first. */
export const historyFor = (sessions: SolveSession[], ref: string) => sessions.filter((s) => s.ref === ref).sort((a, b) => b.endedAt.localeCompare(a.endedAt));
