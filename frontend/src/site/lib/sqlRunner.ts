import type { ExecuteResult, SubmitResult } from "../../types";
import { compareResults, type OrderKey } from "./resultCompare";

/** The subset of PGlite / PGliteWorker this module uses. */
export interface SqlDb {
  exec(
    sql: string,
    options?: { rowMode?: "array" | "object" },
  ): Promise<{ rows: unknown[]; fields: { name: string }[] }[]>;
}

export const MAX_DISPLAY_ROWS = 1000;

interface RawResult {
  columns: string[];
  rows: unknown[][];
}

/**
 * Run SQL inside a transaction that is always rolled back, so a stray
 * DELETE or DROP never damages the visitor's in-browser copy of Northwind.
 */
export async function runRaw(db: SqlDb, sql: string): Promise<RawResult> {
  if (/\b(commit|rollback|begin|start\s+transaction)\b/i.test(stripComments(sql))) {
    throw new Error("Transaction control statements are not allowed here.");
  }
  await db.exec("BEGIN");
  try {
    const results = await db.exec(sql, { rowMode: "array" });
    const last = [...results].reverse().find((r) => r.fields.length > 0) ?? results[results.length - 1];
    return {
      columns: last ? last.fields.map((f) => f.name) : [],
      rows: last ? (last.rows as unknown[][]) : [],
    };
  } finally {
    await db.exec("ROLLBACK");
  }
}

function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''");
}

export async function execute(db: SqlDb, sql: string): Promise<ExecuteResult> {
  if (!sql.trim()) {
    return { success: false, columns: [], rows: [], error_type: "EMPTY", message: "Write a query first." };
  }
  const started = performance.now();
  try {
    const { columns, rows } = await runRaw(db, sql);
    return {
      success: true,
      columns,
      rows: rows.slice(0, MAX_DISPLAY_ROWS),
      row_count: rows.length,
      truncated: rows.length > MAX_DISPLAY_ROWS,
      execution_time_ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      success: false,
      columns: [],
      rows: [],
      error_type: "SQL_ERROR",
      message: err instanceof Error ? err.message : String(err),
      execution_time_ms: Math.round(performance.now() - started),
    };
  }
}

export async function submit(
  db: SqlDb,
  userSql: string,
  referenceSql: string,
  sortRequired: boolean,
  orderBy: OrderKey[] | null = null,
): Promise<SubmitResult> {
  const fail = (message: string, feedback: string[] = []): SubmitResult => ({
    correct: false,
    message,
    feedback,
    level_changed: false,
  });
  if (!userSql.trim()) return fail("Write a query first.");

  let user: RawResult;
  try {
    user = await runRaw(db, userSql);
  } catch (err) {
    return fail("Your query has an error.", [err instanceof Error ? err.message : String(err)]);
  }
  const expected = await runRaw(db, referenceSql);
  const cmp = compareResults(user.columns, user.rows, expected.columns, expected.rows, sortRequired, orderBy);
  return {
    correct: cmp.match,
    message: cmp.message,
    feedback: cmp.feedback,
    your_row_count: cmp.yourRowCount,
    expected_row_count: cmp.expectedRowCount,
    level_changed: false,
  };
}
