// @vitest-environment node
// Execution equivalence for SQL: visualising a query (lib/visualize.ts, the Query Cinema) must not change what the learner
// gets. For each query we run it normally and then through `visualize()` and compare columns, rows and row count; we confirm the
// database is byte-for-byte unchanged afterwards (rows and sequences); and we check that the practice page's grader
// (`submit` from lib/sqlRunner.ts, the function `submitQuery` in lib/browserDb.ts wraps) returns the same verdict before and
// after visualising. Only public functions are used.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, HIDDEN_ROWS, submit, type SqlDb } from "../site/lib/sqlRunner";
import { SAMPLE, visualize, type Run } from "../site/lib/visualize";

let db: SqlDb;
let run: Run;
beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  db = pg as unknown as SqlDb;
  run = (sql) => execute(db, sql);
}, 60_000);

/** Fingerprint of everything a learner could notice: every table's rows, row counts, and every sequence's position. */
async function snapshot() {
  const [tables] = await db.exec("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1", { rowMode: "array" });
  const out: Record<string, unknown> = {};
  for (const [t] of tables.rows as string[][]) {
    const [r] = await db.exec(`SELECT count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM "${t}" x`, { rowMode: "array" });
    out[t] = r.rows[0];
  }
  const [seq] = await db.exec("SELECT sequencename, last_value FROM pg_sequences ORDER BY 1", { rowMode: "array" });
  out.__sequences = seq.rows;
  return out;
}

interface Case { name: string; sql: string }
const QUERIES: Case[] = [
  { name: "inner join + where + order + limit", sql: "SELECT c.company_name, o.order_id, o.freight FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 50 ORDER BY o.freight DESC, o.order_id LIMIT 7" },
  { name: "left join with unmatched rows (NULL padded)", sql: "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id ORDER BY c.customer_id, o.order_id" },
  { name: "three-way join", sql: "SELECT c.country, p.product_name, od.quantity FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN order_details od ON od.order_id = o.order_id JOIN products p ON p.product_id = od.product_id WHERE od.quantity > 60 ORDER BY od.quantity DESC, p.product_name, c.country" },
  { name: "group by + having + aggregates", sql: "SELECT country, COUNT(*) AS n, MIN(city) AS first_city FROM customers GROUP BY country HAVING COUNT(*) >= 3 ORDER BY n DESC, country" },
  { name: "aggregate without group by", sql: "SELECT COUNT(*) AS n, ROUND(AVG(unit_price), 2) AS avg_price, MAX(units_in_stock) AS most FROM products" },
  { name: "window: rank over partition", sql: "SELECT product_name, category_id, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS r FROM products ORDER BY category_id, r, product_name" },
  { name: "window: running total", sql: "SELECT order_id, freight, SUM(freight) OVER (ORDER BY order_id) AS running FROM orders ORDER BY order_id LIMIT 12" },
  { name: "CTE", sql: "WITH big AS (SELECT order_id, SUM(unit_price * quantity) AS total FROM order_details GROUP BY order_id) SELECT order_id, total FROM big WHERE total > 5000 ORDER BY total DESC" },
  { name: "chained CTEs", sql: "WITH a AS (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id), b AS (SELECT customer_id FROM a WHERE n > 20) SELECT c.company_name FROM customers c JOIN b ON b.customer_id = c.customer_id ORDER BY 1" },
  { name: "subquery in WHERE", sql: "SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products) ORDER BY product_name" },
  { name: "DISTINCT", sql: "SELECT DISTINCT country FROM customers ORDER BY country" },
  { name: "set operation: UNION", sql: "SELECT country FROM customers UNION SELECT ship_country FROM orders ORDER BY 1" },
  { name: "set operation: INTERSECT", sql: "SELECT country FROM customers INTERSECT SELECT ship_country FROM orders ORDER BY 1" },
  { name: "set operation: EXCEPT", sql: "SELECT customer_id FROM customers EXCEPT SELECT customer_id FROM orders ORDER BY 1" },
  { name: "set operation: UNION ALL with two branches and LIMIT", sql: "SELECT company_name AS name FROM customers UNION ALL SELECT company_name FROM suppliers ORDER BY name LIMIT 15" },
  { name: "NULL: IS NULL filter", sql: "SELECT order_id FROM orders WHERE shipped_date IS NULL ORDER BY order_id" },
  { name: "NULL: COALESCE and CASE", sql: "SELECT order_id, COALESCE(ship_region, 'none') AS region, CASE WHEN shipped_date IS NULL THEN 'open' ELSE 'shipped' END AS state FROM orders ORDER BY order_id LIMIT 20" },
  { name: "NULL: NOT IN over a subquery", sql: "SELECT customer_id FROM customers WHERE customer_id NOT IN (SELECT customer_id FROM orders) ORDER BY 1" },
  { name: "empty result", sql: "SELECT * FROM customers WHERE country = 'Atlantis'" },
  { name: "more rows than the sample (50 shown of many)", sql: "SELECT order_id, customer_id FROM orders ORDER BY order_id" },
  { name: "expression and alias only", sql: "SELECT 1 + 1 AS two, 'x' || 'y' AS xy" },
  { name: "a query with an error", sql: "SELECT nope FROM customers" },
];

type Viz = Awaited<ReturnType<typeof visualize>>;
const norm = (rows: unknown[][]) => JSON.parse(JSON.stringify(rows)) as unknown[][];

describe("equivalence (SQL): visualize() vs running the query", () => {
  for (const q of QUERIES) {
    it(q.name, async () => {
      const before = await snapshot();
      const plain = await execute(db, q.sql);
      const v: Viz = await visualize(q.sql, run);
      const after = await snapshot();
      expect(after, "database unchanged by visualising").toEqual(before);
      if (!plain.success) {
        // A failing query must fail in the visualisation too, never invent a result.
        expect(v.final, "no final result for a failing query").toBeUndefined();
        return;
      }
      if (v.unsupported) {
        // Honest "not supported" is allowed; a made-up result is not.
        expect(v.final).toBeUndefined();
        return;
      }
      expect(v.final, "visualize returns the final result").toBeDefined();
      expect(v.final!.columns, "columns").toEqual(plain.columns);
      expect(v.final!.rowCount, "row count").toBe(plain.row_count ?? plain.rows.length);
      expect(norm(v.final!.rows), `first ${SAMPLE} rows`).toEqual(norm(plain.rows.slice(0, SAMPLE)));
    });
  }

  it("at least most queries are actually visualised (the comparison is not vacuous)", async () => {
    let shown = 0;
    for (const q of QUERIES) {
      const plain = await execute(db, q.sql);
      if (!plain.success) continue;
      if ((await visualize(q.sql, run)).final) shown++;
    }
    expect(shown).toBeGreaterThanOrEqual(15);
  });

  it("a data-modifying CTE is rolled back, however many times the visualiser re-runs pieces of it", async () => {
    const before = await snapshot();
    const sql = "WITH gone AS (DELETE FROM order_details WHERE order_id = 10248 RETURNING *) SELECT COUNT(*) AS deleted FROM gone";
    const plain = await execute(db, sql);
    await visualize(sql, run);
    await visualize(sql, run);
    expect(await snapshot()).toEqual(before);
    expect(plain.success && plain.rows[0][0]).toBeTruthy();
  });

  it("an INSERT ... RETURNING does not advance the sequence or add a row", async () => {
    const before = await snapshot();
    const sql = "WITH n AS (INSERT INTO categories (category_name, description) VALUES ('Zed', 'z') RETURNING category_id) SELECT category_id FROM n";
    await execute(db, sql);
    await visualize(sql, run);
    expect(await snapshot()).toEqual(before);
  });

  it("volatile functions (random, now) are not re-run with different values: the final result is the one real run", async () => {
    const sql = "SELECT product_id, random() AS r FROM products ORDER BY product_id LIMIT 3";
    const v = await visualize(sql, run);
    expect(v.volatile?.length ?? 0).toBeGreaterThan(0);
    expect(v.final?.rows).toHaveLength(3);
    expect(v.stages.filter((s) => s.sample).every((s) => !s.error || s.error === "not executed")).toBe(true);
  });
});

describe("equivalence (SQL): the practice page's grader gives the same verdict before and after visualising", () => {
  const REFERENCE = "SELECT country, COUNT(*) AS n FROM customers GROUP BY country ORDER BY n DESC, country";
  const attempts: Case[] = [
    { name: "correct answer", sql: REFERENCE },
    { name: "correct answer written differently", sql: "SELECT country, COUNT(customer_id) AS n FROM customers GROUP BY 1 ORDER BY 2 DESC, 1" },
    { name: "wrong result", sql: "SELECT country, COUNT(*) AS n FROM customers WHERE country <> 'USA' GROUP BY country ORDER BY n DESC, country" },
    { name: "wrong order when order matters", sql: "SELECT country, COUNT(*) AS n FROM customers GROUP BY country ORDER BY country" },
    { name: "hard-coded value that only passes the visible data", sql: "SELECT country, COUNT(*) AS n FROM customers GROUP BY country HAVING country <> 'ZZ' ORDER BY n DESC, country" },
    { name: "syntax error", sql: "SELEC country FROM customers" },
    { name: "empty", sql: "" },
  ];
  for (const a of attempts) {
    it(a.name, async () => {
      const grade = () => submit(db, a.sql, REFERENCE, true, null, HIDDEN_ROWS);
      const before = await grade();
      const snap = await snapshot();
      const v = await visualize(a.sql, run);
      const after = await grade();
      // Everything except timing must be identical: verdict, message, feedback, hidden-test flag.
      const strip = ({ execution_time_ms: _t, ...rest }: Record<string, unknown>) => rest;
      expect(strip(after as never)).toEqual(strip(before as never));
      expect(await snapshot()).toEqual(snap);
      // And visualising the learner's query agrees with the grader about its result.
      if (before.correct && v.final) {
        const ref = await execute(db, REFERENCE);
        expect(v.final.rowCount).toBe(ref.row_count);
      }
    });
  }
  it("grading is unaffected by visualising the REFERENCE query too (hidden rows are rolled back)", async () => {
    const before = await submit(db, REFERENCE, REFERENCE, true, null, HIDDEN_ROWS);
    await visualize(REFERENCE, run);
    const after = await submit(db, REFERENCE, REFERENCE, true, null, HIDDEN_ROWS);
    expect(after.correct).toBe(true);
    expect({ ...after, execution_time_ms: 0 }).toEqual({ ...before, execution_time_ms: 0 });
  });
});
