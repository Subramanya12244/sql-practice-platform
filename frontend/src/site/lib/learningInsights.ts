/**
 * Insights and recommendations from the learner's own records. Deterministic rules, no model.
 * Every insight states what it is based on, and appears only when there is enough data: a new
 * learner gets nothing here rather than a guess. Used by the Analytics page; the recommendation
 * list extends `solveAnalytics.recommend` with projects and interview practice.
 */
import { addDays, revisionQueue, splitQueue } from "./revision";
import { buildNotebook, recurring } from "./mistakes";
import { recommend, topicRows, wasTried, type Recommendation, type TopicRow } from "./solveAnalytics";
import type { Progress } from "./progress";
import type { PyExerciseMeta } from "./pyExercises";
import type { ProjectMeta } from "./projects";
import type { PyStat } from "./pyPractice";
import type { SolveSession } from "./solveSessions";
import type { QuestionSummary } from "../types";

export type InsightKind = "weak-topic" | "slow-topic" | "hint-habit" | "prerequisite" | "overdue" | "recurring-mistake" | "strength";
export interface Insight {
  id: string;
  kind: InsightKind;
  severity: "warn" | "suggest" | "good";
  text: string;
  /** What this is based on, in plain words. */
  evidence: string;
  action?: { label: string; path: string };
}

/** Minimum data before a rule speaks. */
export const MIN = { weakTried: 3, slowSolves: 3, slowOverallSolves: 5, slowFactor: 1.5, hintSolves: 3, hintShare: 0.6, overdue: 3, recurring: 3 } as const;

/** Topic you should be comfortable with before the topic on the left (SQL topic slugs). */
export const PREREQUISITES: Record<string, string[]> = {
  "window-functions": ["group-by-having", "aggregations"],
  cte: ["aggregations"],
  "correlated-subqueries": ["aggregations", "group-by-having"],
  "full-outer-join": ["left-join"],
  "self-join": ["left-join"],
  "right-join": ["left-join"],
};

export interface InsightInputs {
  index: QuestionSummary[];
  exercises: PyExerciseMeta[];
  progress: Progress;
  pyStats: Record<string, PyStat>;
  sessions: SolveSession[];
  today: string;
}

const min = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;
const topicPath = (r: TopicRow) => (r.kind === "sql" ? `/topics/${r.topic}` : "/practice/python");
const SEV = { warn: 0, suggest: 1, good: 2 } as const;

export function generateInsights(i: InsightInputs, limit = 5): Insight[] {
  const rows = topicRows(i);
  const out: Insight[] = [];
  const triedBy = (r: TopicRow) => i.sessions.filter((s) => s.kind === r.kind && s.topic === r.topic && wasTried(s));

  // 1. Low success.
  for (const r of rows.filter((x) => x.level === "needs-practice")) {
    const t = triedBy(r);
    const attempts = r.kind === "sql" ? Object.values(i.progress.questions).length : 0;
    if (t.length < MIN.weakTried && !(r.kind === "sql" && attempts >= 5 && r.solved > 0)) continue;
    if (!r.reasons.length) continue;
    out.push({ id: `weak:${r.kind}:${r.topic}`, kind: "weak-topic", severity: "warn", text: `You have a low success rate in ${r.label}.`, evidence: r.reasons.slice(0, 2).join(" "), action: { label: `Practise ${r.label}`, path: topicPath(r) } });
  }

  // 2. Slower than your own average.
  const solved = i.sessions.filter((s) => s.status === "solved" && s.activeSec > 0);
  const overallAvg = solved.length >= MIN.slowOverallSolves ? solved.reduce((a, s) => a + s.activeSec, 0) / solved.length : null;
  if (overallAvg) for (const r of rows) {
    const s = solved.filter((x) => x.kind === r.kind && x.topic === r.topic);
    if (s.length < MIN.slowSolves) continue;
    const avg = s.reduce((a, x) => a + x.activeSec, 0) / s.length;
    if (avg >= overallAvg * MIN.slowFactor) out.push({ id: `slow:${r.kind}:${r.topic}`, kind: "slow-topic", severity: "suggest", text: `You take longer than your average on ${r.label} problems.`, evidence: `${min(avg)} per solve here against ${min(overallAvg)} overall, from ${s.length} timed solves.`, action: { label: `Open ${r.label}`, path: topicPath(r) } });
  }

  // 3. Hint habit.
  for (const r of rows) {
    const s = solved.filter((x) => x.kind === r.kind && x.topic === r.topic);
    if (s.length < MIN.hintSolves) continue;
    const helped = s.filter((x) => x.hints >= (r.kind === "sql" ? 2 : 1)).length;
    if (helped / s.length >= MIN.hintShare) out.push({ id: `hints:${r.kind}:${r.topic}`, kind: "hint-habit", severity: "suggest", text: `You often use hints for ${r.label}.`, evidence: `Hints were used on ${helped} of ${s.length} timed solves. Try the problem for a few more minutes before opening the first hint.`, action: { label: `Review ${r.label} notes`, path: r.kind === "sql" ? "/notes" : "/practice/python" } });
  }

  // 4. Revise the foundation first.
  const level = new Map(rows.filter((r) => r.kind === "sql").map((r) => [r.topic, r]));
  for (const [adv, pre] of Object.entries(PREREQUISITES)) {
    const a = level.get(adv);
    if (!a || a.level === "not-started" || a.level === "strong") continue;
    const weak = pre.map((p) => level.get(p)).find((p) => p && p.level === "needs-practice");
    if (weak) out.push({ id: `pre:${weak.topic}:${adv}`, kind: "prerequisite", severity: "suggest", text: `Revise ${weak.label} before moving further into ${a.label}.`, evidence: `${weak.label}: ${weak.reasons[0]} ${a.label} builds on it.`, action: { label: `Practise ${weak.label}`, path: `/topics/${weak.topic}` } });
  }

  // 5. Revision backlog.
  const queue = splitQueue(revisionQueue(i.index, i.exercises, i.progress, i.today), i.today);
  if (queue.overdue.length >= MIN.overdue) out.push({ id: "overdue", kind: "overdue", severity: "warn", text: `${queue.overdue.length} reviews are overdue.`, evidence: "Reviews come back on a schedule; the longer they wait, the more you forget.", action: { label: "Open the review queue", path: "/review" } });

  // 6. Recurring mistake.
  const rec = recurring(buildNotebook(i), MIN.recurring)[0];
  if (rec) out.push({ id: `mistake:${rec.kind}:${rec.category}`, kind: "recurring-mistake", severity: "suggest", text: `Your most frequent mistake is ${rec.label} (${rec.kind === "sql" ? "SQL" : "Python"}).`, evidence: `${rec.count} times across ${rec.questions} challenges.`, action: { label: "Open the mistake notebook", path: "/mistakes" } });

  // 7. Something to be pleased about.
  const strong = rows.filter((r) => r.level === "strong");
  if (strong.length) out.push({ id: "strength", kind: "strength", severity: "good", text: `${strong.length === 1 ? `${strong[0].label} is` : `${strong.slice(0, 2).map((r) => r.label).join(" and ")}${strong.length > 2 ? ` and ${strong.length - 2} more are` : " are"}`} a strength.`, evidence: strong[0].reasons.slice(0, 2).join(" ") });

  return out.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.id.localeCompare(b.id)).slice(0, limit);
}

export type ProjectState = "Not started" | "In progress" | "Completed";
const LEVEL_RANK: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };

/**
 * Recommendations: the existing question and revision picks, plus one project and one interview
 * practice suggestion when the learner has enough solved work for them to make sense.
 */
export function recommendations(i: InsightInputs & { dueSql: QuestionSummary[]; projects: ProjectMeta[]; projectState: Record<string, ProjectState> }, n = 5): Recommendation[] {
  const base = recommend(i, 4);
  const rows = topicRows(i);
  const solvedSql = rows.filter((r) => r.kind === "sql").reduce((a, r) => a + r.solved, 0);
  const solvedPy = rows.filter((r) => r.kind === "python").reduce((a, r) => a + r.solved, 0);
  const out = [...base];

  // A project once the basics are in place: Python if that is where the learner has worked, else SQL.
  const wantsPython = solvedPy >= 10 && solvedPy >= solvedSql;
  if (solvedSql >= 5 || solvedPy >= 10) {
    const maxLevel = rows.filter((r) => r.level === "strong").length >= 3 ? 1 : 0;
    const pick = [...i.projects]
      .filter((p) => i.projectState[p.slug] !== "Completed" && (LEVEL_RANK[p.level] ?? 0) <= maxLevel)
      .sort((a, b) => Number(i.projectState[b.slug] === "In progress") - Number(i.projectState[a.slug] === "In progress")
        || Number(b.technologies.includes(wantsPython ? "Python" : "SQL")) - Number(a.technologies.includes(wantsPython ? "Python" : "SQL"))
        || (LEVEL_RANK[a.level] ?? 0) - (LEVEL_RANK[b.level] ?? 0))[0];
    if (pick) out.push({ kind: wantsPython ? "python" : "sql", title: `Project: ${pick.title}`, path: `/projects-lab/${pick.slug}`, difficulty: pick.level,
      reason: i.projectState[pick.slug] === "In progress" ? "You already started this one; finishing it turns practice into a portfolio piece." : `You have solved ${wantsPython ? solvedPy : solvedSql} ${wantsPython ? "Python problems" : "SQL questions"}. A guided project applies them together.` });
  }

  // Interview practice once several topics are solid.
  const strongCount = rows.filter((r) => r.level === "strong").length;
  if (strongCount >= 3 && !i.progress.mocks?.some((m) => m.date.slice(0, 10) >= addDays(i.today, -14))) out.push({ kind: "sql", title: "Timed SQL mock interview", path: "/mock-interview", difficulty: "Mixed", reason: `${strongCount} topics are strong, and you have not done a mock interview in the last two weeks.` });
  return out.slice(0, n);
}

