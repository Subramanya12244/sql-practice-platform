import type { ExecuteResult, SubmitResult } from "../../types";
import { compareResults, diagnose, rowDiff, type OrderKey } from "./resultCompare";
import { classifyError } from "./diagnostics";

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

/**
 * Errors from the worker lose PostgreSQL's `position`. Recover it only when the message names a
 * quoted identifier that appears exactly once in the SQL as a whole word; otherwise return null
 * (no marker beats a wrong marker).
 */
export function errorPositionFromMessage(sql: string, message: string): number | null {
  const name = message.match(/"([^"]{1,63})"/)?.[1];
  if (!name) return null;
  const re = new RegExp(`(?<![\\w."])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w"])`, "gi");
  const hits = [...sql.matchAll(re)];
  return hits.length === 1 ? hits[0].index! + 1 : null;
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
    classifyError(err, "SQL_ENGINE_ERROR", "sql_practice");
    return {
      success: false,
      columns: [],
      rows: [],
      error_type: "SQL_ERROR",
      message: err instanceof Error ? err.message : String(err),
      error_position: Number((err as { position?: string | number }).position) || errorPositionFromMessage(sql, err instanceof Error ? err.message : String(err)),
      execution_time_ms: Math.round(performance.now() - started),
    };
  }
}

/**
 * Hidden test data, added inside the same rolled-back transaction as the graded query. It follows the
 * dataset's own patterns (region is always NULL; some orders aren't shipped) and adds:
 * - a customer with two orders on a new latest date (ties; anything hard-coded to "latest" breaks)
 * - a customer with no orders (inner vs outer join)
 * - a product with zero stock
 * Northwind only: other datasets skip the hidden check.
 */
export const HIDDEN_ROWS = `
INSERT INTO customers (customer_id, company_name, contact_name, contact_title, address, city, region, postal_code, country, phone) VALUES
  ('ZZEDG', 'Edge Analytics Co', 'Rae Moss', 'Owner', '1 Rue Test', 'Lyon', NULL, '69001', 'France', '04-7212-0001'),
  ('ZZQUI', 'Quiet Trading Ltd', 'Ola Berg', 'Sales Manager', '9 Fjord Gate', 'Oslo', NULL, '0150', 'Norway', '22-11-0002');
INSERT INTO products (product_id, product_name, supplier_id, category_id, quantity_per_unit, unit_price, units_in_stock, units_on_order, reorder_level, discontinued) VALUES
  (78, 'Edge Tea Blend', 1, 1, '10 boxes x 20 bags', 18.00, 0, 10, 5, false);
INSERT INTO orders (order_id, customer_id, employee_id, order_date, required_date, shipped_date, ship_via, freight, ship_name, ship_address, ship_city, ship_region, ship_postal_code, ship_country) VALUES
  (90001, 'ZZEDG', 3, '1998-12-30', '1999-01-27', NULL, 2, 48.50, 'Edge Analytics Co', '1 Rue Test', 'Lyon', NULL, '69001', 'France'),
  (90002, 'ZZEDG', 3, '1998-12-30', '1999-01-27', '1999-01-04', 1, 12.00, 'Edge Analytics Co', '1 Rue Test', 'Lyon', NULL, '69001', 'France');
INSERT INTO order_details (order_id, product_id, unit_price, quantity, discount) VALUES
  (90001, 11, 21.00, 30, 0), (90001, 42, 14.00, 15, 0.1), (90002, 72, 34.80, 5, 0), (90002, 78, 18.00, 2, 0);
`;

export async function submit(
  db: SqlDb,
  userSql: string,
  referenceSql: string,
  sortRequired: boolean,
  orderBy: OrderKey[] | null = null,
  hiddenRows: string | null = null,
): Promise<SubmitResult> {
  const fail = (message: string, feedback: string[] = []): SubmitResult => ({
    correct: false,
    message,
    feedback,
    level_changed: false,
  });
  if (!userSql.trim()) return fail("Write a query first.");

  let user: RawResult;
  let userMs: number | undefined;
  try {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    user = await runRaw(db, userSql);
    userMs = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 10) / 10;
  } catch (err) {
    return fail("Your query has an error.", [err instanceof Error ? err.message : String(err)]);
  }
  const expected = await runRaw(db, referenceSql);
  const cmp = compareResults(user.columns, user.rows, expected.columns, expected.rows, sortRequired, orderBy);
  // Hidden test: the same comparison on data the learner hasn't seen. Only after the visible check passes.
  if (cmp.match && hiddenRows) {
    try {
      const [hu, he] = [await runRaw(db, `${hiddenRows};\n${userSql}`), await runRaw(db, `${hiddenRows};\n${referenceSql}`)];
      const h = compareResults(hu.columns, hu.rows, he.columns, he.rows, sortRequired, orderBy);
      if (!h.match) {
        return {
          correct: false,
          message: "Matches the sample data, but fails a hidden test case.",
          execution_time_ms: userMs,
          feedback: [
            "Your query gives a different result on hidden test data (new rows the reference handles).",
            "Check for hard-coded values (ids, dates, names), assumptions about ties, and rows that have no match in a join.",
          ],
          hidden_failed: true,
          level_changed: false,
        };
      }
    } catch (err) {
      return fail("Your query errors on the hidden test data.", [err instanceof Error ? err.message : String(err)]);
    }
  }
  return {
    correct: cmp.match,
    message: cmp.message,
    execution_time_ms: userMs,
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
