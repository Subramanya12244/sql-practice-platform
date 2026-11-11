/**
 * Shared shape for the guided data-quality exercises and the data-engineering scenarios. Each one is
 * a short brief plus a validated task (the existing SQL or Python task runner), over a small
 * dataset created by `setup`. Tests run every worked solution through the real runner and
 * require the starter to fail, so no exercise can ship with a broken answer.
 */
import type { PythonTask, SqlTask } from "../tasks";
import { registerDataset, runQuery } from "../browserDb";

export type Dimension = "Completeness" | "Accuracy" | "Consistency" | "Uniqueness" | "Validity";
export const DIMENSIONS: Dimension[] = ["Completeness", "Accuracy", "Consistency", "Uniqueness", "Validity"];

export interface Profile { table: string; columns: string[] }

export interface GuidedExercise {
  id: string;
  title: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  /** Data-quality dimension (quality lab only). */
  dimension?: Dimension;
  /** Business context in a sentence or two. */
  context: string;
  requirements: string[];
  /** Tables the learner can query (SQL tasks), described in words. */
  inputs: string[];
  /** What a correct result looks like, without giving the query. */
  expected: string;
  constraints: string[];
  /** How the work is judged. */
  criteria: string[];
  /** Shown after the task passes. */
  explanation: string;
  hints: string[];
  /** SQL that builds the dataset. Required for SQL tasks; also used for Python tasks that show tables. */
  setup: string;
  task: SqlTask | PythonTask;
  /** Quality score before (the raw table) and after (the table the learner creates). */
  profile?: { before: Profile; after: Profile };
}

/** One SELECT returning rows, null cells, total cells and distinct rows for a table. */
export function profileSql(p: Profile): string {
  const nulls = p.columns.map((c) => `COUNT(*) FILTER (WHERE ${c} IS NULL OR trim(${c}::text) = '')`).join(" + ");
  return `SELECT COUNT(*) AS row_count, ${nulls} AS null_cells, COUNT(*) * ${p.columns.length} AS total_cells, (SELECT COUNT(*) FROM (SELECT DISTINCT ${p.columns.join(", ")} FROM ${p.table}) d) AS distinct_rows FROM ${p.table}`;
}

export interface ProfileResult { rows: number; nullCells: number; cells: number; distinctRows: number }

export const readProfile = (row: unknown[]): ProfileResult => ({ rows: Number(row[0]), nullCells: Number(row[1]), cells: Number(row[2]), distinctRows: Number(row[3]) });

/** 0-100. Half completeness (cells that are filled in), half uniqueness (rows that are not repeats). */
export function qualityScore(p: ProfileResult): { score: number; completeness: number; uniqueness: number } {
  if (!p.rows) return { score: 0, completeness: 0, uniqueness: 0 };
  const completeness = Math.round((1 - p.nullCells / Math.max(1, p.cells)) * 100);
  const uniqueness = Math.round((p.distinctRows / p.rows) * 100);
  return { score: Math.round((completeness + uniqueness) / 2), completeness, uniqueness };
}

/** The dataset id an exercise's tables live in. */
export const exerciseDataset = (e: Pick<GuidedExercise, "id">) => `guided-${e.id}`;

/**
 * Register the exercise's dataset, then run `sql` on it. Registration is idempotent, and doing it here (not only in the page's mount
 * effect) closes a window: a click can arrive after hydration but before that passive effect has run, and a query for an
 * unregistered dataset fails with "Unknown dataset".
 */
export function runExerciseQuery(e: Pick<GuidedExercise, "id" | "setup">, sql: string) {
  const dataset = exerciseDataset(e);
  registerDataset({ id: dataset, sql: e.setup });
  return runQuery(sql, dataset);
}
