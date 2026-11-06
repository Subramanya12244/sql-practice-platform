/**
 * Personal learning analytics, computed only from what is tracked for the learner:
 * - SQL: per-question attempts, failed submits (errorKinds counts every wrong submit), first-solve
 *   time (solveSec), solved date.
 * - Python: per-problem checks and passes (this browser), completions (synced).
 * - Active time: focused, interacting minutes (lib/activity.ts), not session length.
 * Every number says what it is; nothing is estimated or filled in.
 */
import type { Progress } from "./progress";
import type { PyStat } from "./pyPractice";
import type { PyExerciseMeta } from "./pyExercises";
import type { QuestionSummary } from "../types";

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const failedOf = (q: { errorKinds?: Record<string, number> }) => Object.values(q.errorKinds ?? {}).reduce((s, n) => s + n, 0);

export function learningAnalytics(index: QuestionSummary[], exercises: PyExerciseMeta[], p: Progress, stats: Record<string, PyStat>, minutes: string[], now = Date.now()) {
  // SQL
  const practiced = index.map((q) => ({ q, s: p.questions[q.number] })).filter((x) => x.s?.practiced && x.s.attempts > 0);
  const solved = practiced.filter((x) => x.s!.solvedAt);
  const sqlSubmits = practiced.reduce((s, x) => s + x.s!.attempts, 0);
  const sqlFailed = practiced.reduce((s, x) => s + failedOf(x.s!), 0);
  const solveTimes = solved.map((x) => x.s!.solveSec).filter((t): t is number => typeof t === "number" && t > 0);
  // Python
  const pyTried = exercises.filter((e) => stats[e.slug]?.attempts);
  const pyChecks = pyTried.reduce((s, e) => s + stats[e.slug].attempts, 0);
  const pyPasses = pyTried.reduce((s, e) => s + stats[e.slug].passes, 0);
  const pySolved = exercises.filter((e) => p.lessons?.[`py:${e.slug}`]);
  const level = (items: { difficulty: string; done: boolean }[]) => ["Easy", "Medium", "Hard"].map((d) => {
    const xs = items.filter((x) => x.difficulty === d);
    return { level: d, done: xs.filter((x) => x.done).length, total: xs.length };
  });
  const topicMap = new Map<string, { label: string; submits: number; failed: number; solved: number; total: number }>();
  for (const q of index) {
    const t = topicMap.get(q.topic) ?? { label: q.topicLabel, submits: 0, failed: 0, solved: 0, total: 0 };
    const s = p.questions[q.number];
    t.total++;
    if (s?.solvedAt) t.solved++;
    if (s?.practiced) { t.submits += s.attempts; t.failed += failedOf(s); }
    topicMap.set(q.topic, t);
  }
  // Active time: weeks ending today (UTC) and 30-day windows.
  const DAY = 86_400_000;
  const startOfToday = Math.floor(now / DAY) * DAY;
  const inRange = (from: number, to: number) => minutes.filter((m) => { const t = Date.parse(m); return t >= from && t < to; }).length;
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = startOfToday + DAY - i * 7 * DAY;
    return { label: new Date(end - 7 * DAY).toISOString().slice(5, 10), minutes: inRange(end - 7 * DAY, end) };
  }).reverse();
  const month = inRange(startOfToday + DAY - 30 * DAY, startOfToday + DAY), prevMonth = inRange(startOfToday + DAY - 60 * DAY, startOfToday + DAY - 30 * DAY);
  return {
    sql: {
      solved: solved.length, total: index.length,
      firstTry: { n: solved.filter((x) => failedOf(x.s!) === 0).length, of: solved.length },
      accuracy: pct(sqlSubmits - sqlFailed, sqlSubmits), submits: sqlSubmits,
      avgSolveMin: solveTimes.length ? Math.round(solveTimes.reduce((a, b) => a + b, 0) / solveTimes.length / 60) : null,
      medianSolveMin: solveTimes.length ? Math.round([...solveTimes].sort((a, b) => a - b)[Math.floor(solveTimes.length / 2)] / 60) : null,
      byLevel: level(index.map((q) => ({ difficulty: q.difficulty, done: Boolean(p.questions[q.number]?.solvedAt) }))),
      topics: [...topicMap.values()].map((t) => ({ ...t, accuracy: pct(t.submits - t.failed, t.submits) })),
    },
    python: {
      solved: pySolved.length, total: exercises.length,
      firstTry: { n: pyTried.filter((e) => stats[e.slug].passes > 0 && stats[e.slug].attempts === stats[e.slug].passes).length, of: pyTried.filter((e) => stats[e.slug].passes > 0).length },
      accuracy: pct(pyPasses, pyChecks), checks: pyChecks,
      byLevel: level(exercises.map((e) => ({ difficulty: e.difficulty, done: Boolean(p.lessons?.[`py:${e.slug}`]) }))),
    },
    time: { weeks, thisWeek: weeks[7].minutes, lastWeek: weeks[6].minutes, month, prevMonth },
  };
}
export type LearningAnalytics = ReturnType<typeof learningAnalytics>;
export const change = (now: number, before: number) => (before === 0 ? (now ? "new" : "—") : `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}%`);
