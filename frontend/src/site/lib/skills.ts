/**
 * Skill mastery, from evidence only. A skill is a group of Daily Learning phases (its lessons), optionally with practice
 * evidence from graded questions. Lesson completion and mastery stay separate (see masteryOf in dailyProgress.ts):
 *   Not assessed: no lesson activity and no practice evidence.
 *   Started: some activity (a lesson opened and worked on, or a first graded solve).
 *   Practicing: at least one lesson completed, or five or more graded solves.
 *   Completed: every lesson of the skill completed.
 *   Mastered: every lesson completed AND mastered (knowledge check 80%+, independent exercises passed, revision done).
 * Nothing is estimated: a skill with no evidence says so.
 */
import { CURRICULUM, isAuthored, type BranchId, type DayMeta } from "./daily";
import { hasActivity, isDone, type DailyState } from "./dailyProgress";

export type SkillStatus = "not-assessed" | "started" | "practicing" | "completed" | "mastered";

export const SKILL_STATUS_LABEL: Record<SkillStatus, string> = {
  "not-assessed": "Not assessed",
  started: "Started",
  practicing: "Practicing",
  completed: "Completed",
  mastered: "Mastered",
};

export interface SkillDef {
  id: string;
  label: string;
  /** Daily Learning phase ids whose lessons teach this skill. */
  phases: string[];
  to: string;
}

export const SKILLS: SkillDef[] = [
  { id: "sql", label: "SQL", phases: ["sql-fundamentals", "sql-advanced"], to: "/questions" },
  { id: "python", label: "Python", phases: ["python-fundamentals", "python-intermediate", "python-testing"], to: "/practice/python" },
  { id: "pandas", label: "Pandas", phases: ["numpy", "pandas"], to: "/visual/data" },
  { id: "statistics", label: "Statistics", phases: ["statistics-foundations", "analyst-statistics"], to: "/visual/stats" },
  { id: "analysis", label: "Data analysis", phases: ["excel", "eda", "visualisation", "power-bi", "storytelling", "business-analytics", "analyst-data-prep"], to: "/daily" },
  { id: "engineering", label: "Data engineering", phases: ["ingestion-csv-excel", "rest-api", "sql-python-eng", "data-quality", "linux-tools", "engineer-capstone"], to: "/data-engineering" },
  { id: "etl", label: "ETL", phases: ["etl"], to: "/etl-builder" },
  { id: "warehousing", label: "Data warehousing", phases: ["warehousing"], to: "/data-engineering" },
  { id: "airflow", label: "Airflow", phases: ["airflow"], to: "/dag-simulator" },
  { id: "spark", label: "Spark", phases: ["spark"], to: "/data-engineering" },
];

/** Graded practice outside the lessons that counts as evidence for a skill. */
export interface PracticeEvidence { label: string; value: number; max: number }

export interface SkillRow extends SkillDef {
  status: SkillStatus;
  done: number;
  total: number;
  mastered: number;
  /** Lessons with any work on them. */
  active: number;
  practice?: PracticeEvidence;
  /** Set when every lesson of this skill is on a specialisation path the learner has not chosen. */
  onlyOnPath?: BranchId;
}

export function skillStatus(e: { done: number; total: number; mastered: number; active: number; practice?: PracticeEvidence }): SkillStatus {
  if (e.total > 0 && e.done === e.total) return e.mastered === e.total ? "mastered" : "completed";
  if (e.done > 0 || (e.practice?.value ?? 0) >= 5) return "practicing";
  if (e.active > 0 || (e.practice?.value ?? 0) > 0) return "started";
  return "not-assessed";
}

export function lessonsOf(def: SkillDef): DayMeta[] {
  return CURRICULUM.days.filter((d) => def.phases.includes(d.phase) && isAuthored(d.id));
}

export function skillRows(state: DailyState, masteredIds: ReadonlySet<string>, practice: Record<string, PracticeEvidence> = {}): SkillRow[] {
  return SKILLS.map((def) => {
    const days = lessonsOf(def);
    const done = days.filter((d) => isDone(state, d.id)).length;
    const mastered = days.filter((d) => isDone(state, d.id) && masteredIds.has(d.id)).length;
    const active = days.filter((d) => hasActivity(state.days[d.id])).length;
    const paths = new Set(days.map((d) => d.path));
    const onlyOnPath = paths.size === 1 && !paths.has("common") ? ([...paths][0] as BranchId) : undefined;
    const ev = practice[def.id];
    const row = { done, total: days.length, mastered, active, practice: ev };
    return { ...def, ...row, status: skillStatus(row), onlyOnPath: onlyOnPath && state.path !== onlyOnPath ? onlyOnPath : undefined };
  });
}
