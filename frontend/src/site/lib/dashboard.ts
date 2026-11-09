/**
 * Learning dashboard metrics, all derived from the visitor's real progress record.
 * Nothing here is estimated or seeded: a new visitor gets zeros and empty lists.
 * XP, levels, achievements and missions live in gamification.ts.
 */
import type { Progress } from "./progress";
import { addDaysIso } from "./career";
import type { QuestionSummary } from "../types";
import { getExerciseStage, PY_STAGES, type PyExerciseMeta } from "./pyExercises";
import { pyKey, type PyStat } from "./pyPractice";
import { getProjectProgress, type ProjectMeta } from "./projects";
import { streak } from "./progress";

/** Learning actions for the 7 days ending today (oldest first). */
export function weekActivity(p: Progress, today: string): { day: string; count: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDaysIso(today, i - 6);
    return { day, count: p.dayCounts?.[day] ?? 0 };
  });
}

export interface RecommendedSql {
  question: QuestionSummary;
  reason: "resume" | "next_in_order" | "weak_topic";
  detail: string;
}

/** Finds the most relevant SQL question for the learner to tackle next. */
export function getRecommendedNextSql(index: QuestionSummary[], progress: Progress): RecommendedSql | null {
  if (!index.length) return null;

  // 1. In-progress questions: attempted but not yet solved
  const inProgress = index.find((q) => {
    const stat = progress.questions[q.number];
    return stat && stat.attempts > 0 && !stat.solvedAt;
  });
  if (inProgress) {
    const stat = progress.questions[inProgress.number]!;
    return {
      question: inProgress,
      reason: "resume",
      detail: `You attempted this ${stat.attempts} time${stat.attempts > 1 ? "s" : ""} — finish solving it!`,
    };
  }

  // 2. Next unsolved question in sequential order
  const nextUnsolved = index.find((q) => !progress.questions[q.number]?.solvedAt);
  if (nextUnsolved) {
    return {
      question: nextUnsolved,
      reason: "next_in_order",
      detail: `Next question in the Northwind curriculum (${nextUnsolved.topicLabel})`,
    };
  }

  // 3. All solved: suggest the oldest solved or lowest number for revision
  return {
    question: index[0],
    reason: "next_in_order",
    detail: "All questions solved! Practice for speed or revision.",
  };
}

export interface RecommendedPython {
  exercise: PyExerciseMeta;
  stage: number;
  stageName: string;
  reason: "resume" | "next_in_stage";
  detail: string;
}

/** Finds the most relevant Python problem based on the 14-stage pedagogical progression. */
export function getRecommendedNextPython(
  exercises: PyExerciseMeta[],
  progress: Progress,
  stats: Record<string, PyStat>,
): RecommendedPython | null {
  if (!exercises.length) return null;

  // Sort exercises by stage ascending, then difficulty, then code
  const sorted = [...exercises].sort((a, b) => {
    const sa = getExerciseStage(a);
    const sb = getExerciseStage(b);
    if (sa !== sb) return sa - sb;
    const diffMap: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };
    const da = diffMap[a.difficulty] ?? 1;
    const db = diffMap[b.difficulty] ?? 1;
    if (da !== db) return da - db;
    return a.code.localeCompare(b.code);
  });

  // 1. In-progress problem: attempted but not yet passed
  const inProgress = sorted.find((e) => {
    const st = stats[e.slug];
    const isPassed = Boolean(progress.lessons?.[pyKey(e.slug)]);
    return st && st.attempts > 0 && !isPassed;
  });
  if (inProgress) {
    const st = stats[inProgress.slug]!;
    const stageNum = getExerciseStage(inProgress);
    const stageMeta = PY_STAGES.find((s) => s.stage === stageNum);
    return {
      exercise: inProgress,
      stage: stageNum,
      stageName: stageMeta?.name ?? `Stage ${stageNum}`,
      reason: "resume",
      detail: `Attempted ${st.attempts} time${st.attempts > 1 ? "s" : ""} — test and pass it!`,
    };
  }

  // 2. Next unsolved problem in stage sequence
  const nextUnsolved = sorted.find((e) => !progress.lessons?.[pyKey(e.slug)]);
  if (nextUnsolved) {
    const stageNum = getExerciseStage(nextUnsolved);
    const stageMeta = PY_STAGES.find((s) => s.stage === stageNum);
    return {
      exercise: nextUnsolved,
      stage: stageNum,
      stageName: stageMeta?.name ?? `Stage ${stageNum}`,
      reason: "next_in_stage",
      detail: `Stage ${stageNum}: ${stageMeta?.name ?? "Next problem"}`,
    };
  }

  return null;
}

export interface ActiveProjectSummary {
  project: ProjectMeta;
  pendingTask: { id: string; title: string; type: string } | null;
  passedAutomated: number;
  totalAutomated: number;
  totalTasks: number;
  percent: number;
}

/** Identifies an actively in-progress guided project. */
export function getActiveProject(
  projects: ProjectMeta[],
  projectTasks: { slug: string; tasks: { id: string; type: string; title: string }[] }[],
): ActiveProjectSummary | null {
  if (!projects.length) return null;

  for (const p of projects) {
    const prog = getProjectProgress(p.slug);
    const taskDef = projectTasks.find((pt) => pt.slug === p.slug);
    if (!taskDef) continue;

    const automated = taskDef.tasks.filter((t) => t.type !== "checklist");
    const passed = automated.filter((t) => prog.tasks[t.id]?.passed).length;
    const isCompleted = passed === automated.length && automated.length > 0;

    // Has started (passed at least 1 task or attempted any task) but not completed
    const hasAttempted = passed > 0 || Object.keys(prog.tasks).length > 0;
    if (hasAttempted && !isCompleted) {
      // Find the first unpassed automated task
      const firstPending = automated.find((t) => !prog.tasks[t.id]?.passed) ?? null;
      return {
        project: p,
        pendingTask: firstPending,
        passedAutomated: passed,
        totalAutomated: automated.length,
        totalTasks: taskDef.tasks.length,
        percent: automated.length ? Math.round((100 * passed) / automated.length) : 0,
      };
    }
  }

  return null;
}

export interface MistakeSummary {
  errorKind: string;
  count: number;
}

/** Summarizes recurring mistake categories across practice attempts. */
export function getFrequentMistakes(progress: Progress): MistakeSummary[] {
  const counts: Record<string, number> = {};
  for (const q of Object.values(progress.questions)) {
    if (q.errorKinds) {
      for (const [kind, count] of Object.entries(q.errorKinds)) {
        counts[kind] = (counts[kind] ?? 0) + count;
      }
    }
  }
  return Object.entries(counts)
    .map(([errorKind, count]) => ({ errorKind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

export interface RecentCompletion {
  kind: "sql" | "python" | "project";
  id: string;
  title: string;
  slug: string;
  at: string;
}

/** Gathers recently solved SQL questions and passed Python problems. */
export function getRecentCompletions(
  progress: Progress,
  index: QuestionSummary[],
  exercises: PyExerciseMeta[],
): RecentCompletion[] {
  const items: RecentCompletion[] = [];

  // SQL solved
  for (const [numStr, qp] of Object.entries(progress.questions)) {
    if (qp.solvedAt) {
      const num = Number(numStr);
      const q = index.find((x) => x.number === num);
      if (q) {
        items.push({
          kind: "sql",
          id: `Q${q.number}`,
          title: q.title,
          slug: q.slug,
          at: qp.solvedAt,
        });
      }
    }
  }

  // Python solved
  if (progress.lessons) {
    for (const [key, at] of Object.entries(progress.lessons)) {
      if (key.startsWith("py:")) {
        const slug = key.slice(3);
        const ex = exercises.find((x) => x.slug === slug);
        if (ex) {
          items.push({
            kind: "python",
            id: ex.code,
            title: ex.title,
            slug: ex.slug,
            at,
          });
        }
      }
    }
  }

  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);
}

export interface OverallSummary {
  sqlSolved: number;
  sqlTotal: number;
  sqlPercent: number;
  pyPassed: number;
  pyTotal: number;
  pyPercent: number;
  projectsDone: number;
  projectsTotal: number;
  streakDays: number;
  hasActivity: boolean;
}

/** Aggregates high-level progress metrics across all platform modules. */
export function getOverallProgressSummary(
  progress: Progress,
  sqlTotal: number,
  pyTotal: number,
  projectsTotal: number,
  projectsCompleted = 0,
): OverallSummary {
  const sqlSolved = Object.values(progress.questions).filter((q) => q.solvedAt).length;
  const pyPassed = Object.keys(progress.lessons ?? {}).filter((k) => k.startsWith("py:")).length;
  const streakDays = streak(progress.activeDays);
  const hasActivity = sqlSolved > 0 || pyPassed > 0 || projectsCompleted > 0 || Object.keys(progress.questions).length > 0;

  return {
    sqlSolved,
    sqlTotal,
    sqlPercent: sqlTotal ? Math.round((100 * sqlSolved) / sqlTotal) : 0,
    pyPassed,
    pyTotal,
    pyPercent: pyTotal ? Math.round((100 * pyPassed) / pyTotal) : 0,
    projectsDone: projectsCompleted,
    projectsTotal,
    streakDays,
    hasActivity,
  };
}
