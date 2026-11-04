import type { ExecuteResult, SubmitResult } from "../../types";
import { compareResults, diagnose, rowDiff, type OrderKey } from "./resultCompare";

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
  // Savepoints are fine inside the wrapper; a statement that would end it is not.
  // Only statement starts count, so ON COMMIT DROP or a column named "end" is fine.
  if (/(^|;)\s*(commit|begin|start\s+transaction|abort|end|rollback(?!\s+(transaction\s+|work\s+)?to\b))\b/i.test(stripComments(sql))) {
    throw new Error("Transaction control statements are not allowed here.");
  }
  // Sequences ignore ROLLBACK; snapshot them so an INSERT doesn't shift ids for the next run.
  const [seqs] = await db.exec("SELECT schemaname, sequencename, last_value FROM pg_sequences", { rowMode: "array" });
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
    const restore = (seqs?.rows as [string, string, string | null][] | undefined ?? [])
      .map(([schema, name, last]) => {
        const seq = `'${schema.replace(/'/g, "''")}.${name.replace(/'/g, "''")}'`;
        return last === null ? `SELECT setval(${seq}, 1, false)` : `SELECT setval(${seq}, ${Number(last)}, true)`;
      })
      .join(";");
    if (restore) await db.exec(restore);
  }
}

function stripComments(sql: string): string {
  // Function bodies ($$ … $$ or $tag$ … $tag$) contain BEGIN/END of their own; they aren't transaction control.
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
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
    // Specific, result-derived reasons first; the generic checklist after.
    feedback: cmp.match ? cmp.feedback : [...diagnose(user.columns, user.rows, expected.columns, expected.rows), ...cmp.feedback],
    your_row_count: cmp.yourRowCount,
    expected_row_count: cmp.expectedRowCount,
    level_changed: false,
    diff:
      !cmp.match && user.columns.length === expected.columns.length
        ? { columns: expected.columns, ...rowDiff(user.rows, expected.rows) }
        : null,
  };
}
