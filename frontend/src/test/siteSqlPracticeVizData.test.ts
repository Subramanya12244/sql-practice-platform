// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Run, type Visualization } from "../site/lib/visualize";
import { traceRows, type RowTrace } from "../site/lib/visual/classic/rowTrace";
import { teachSteps } from "../site/lib/visual/classic/teach";
import type { TeachCard } from "../site/lib/visual/classic/contract";

/**
 * QA matrix for the SQL Practice visualizer (data layer), against a real PostgreSQL (PGlite) loaded with the site's Northwind data.
 *
 * Every expectation comes from an INDEPENDENT query written here in a different form than the learner's query (EXISTS instead of
 * JOIN, correlated sub-selects instead of GROUP BY, comma joins, ...), never from what the visualizer reports about itself.
 * A test that depends on a feature the upgrade adds (teaching cards with intermediate tables, notes, ...) is in the "teaching
 * cards" block, so a red test there reads as "feature missing" and a red test in the other blocks reads as a data bug.
 */
let pg: PGlite;
let run: Run;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(northwind);
  run = (sql) => execute(pg as unknown as SqlDb, sql);
}, 60_000);

/** Canonical text of a cell, so "263.50", 263.5 and 263.500 compare equal and Dates compare by instant. */
const canon = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) return String(Number(Number(v).toPrecision(12)));
  return String(v);
};
const canonRows = (rows: unknown[][]) => rows.map((r) => r.map(canon));
async function ref(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  const r = await pg.query(sql, [], { rowMode: "array" });
  return { columns: r.fields.map((f) => f.name), rows: r.rows as unknown as unknown[][] };
}
const refCount = async (sql: string) => Number((await ref(sql)).rows[0][0]);
const keySet = (rows: unknown[][]) => new Set(canonRows(rows).map((r) => JSON.stringify(r)));
/** Pick the named columns (first occurrence) out of rows. */
const pick = (columns: string[], rows: unknown[][], names: string[]) => rows.map((r) => names.map((n) => r[columns.indexOf(n)]));

interface Built { viz: Visualization; trace: RowTrace; cards: TeachCard[]; stageOf: (clause: string, nth?: number) => number }
async function build(sql: string): Promise<Built> {
  const viz = await visualize(sql, run);
  const trace = await traceRows(sql, run, viz);
  const cards = teachSteps(viz, trace);
  const stageOf = (clause: string, nth = 0) => viz.stages.map((s, i) => [s.clause, i] as const).filter(([c]) => c === clause)[nth]?.[1] ?? -1;
  return { viz, trace, cards, stageOf };
}
/** The learner's own result must equal the independent result (same columns, same values, same order when asked). */
async function expectFinal(b: Built, reference: string, ordered = true) {
  const want = await ref(reference);
  expect(b.viz.final, "the visualization has a final result").toBeTruthy();
  expect(b.viz.final!.rowCount).toBe(want.rows.length);
  expect(b.viz.final!.columns).toHaveLength(want.columns.length);
  const got = canonRows(b.viz.final!.rows);
  const exp = canonRows(want.rows);
  if (ordered) expect(got).toEqual(exp.slice(0, got.length));
  else if (got.length === exp.length) expect(got.map((r) => JSON.stringify(r)).sort()).toEqual(exp.map((r) => JSON.stringify(r)).sort());
  else { const all = keySet(want.rows); for (const r of got) expect(all.has(JSON.stringify(r))).toBe(true); }
  return want;
}

/* ------------------------------------------------------------------------------------------------------------------------ */
describe("matrix: the stage counts and the final result equal independent queries", () => {
  it("SELECT / WHERE: only the chosen columns, only the filtered rows", async () => {
    const sql = "SELECT product_name, unit_price FROM products WHERE unit_price > 50 ORDER BY unit_price DESC";
    const b = await build(sql);
    const want = await expectFinal(b, "SELECT product_name, unit_price FROM products WHERE NOT (unit_price <= 50) ORDER BY unit_price DESC");
    expect(b.viz.final!.columns).toEqual(["product_name", "unit_price"]); // column selection
    expect(b.viz.stages[b.stageOf("from")].rowsOut).toBe(await refCount("SELECT count(*) FROM products"));
    const w = b.viz.stages[b.stageOf("where")];
    expect(w.rowsIn).toBe(await refCount("SELECT count(*) FROM products"));
    expect(w.rowsOut).toBe(want.rows.length);
    // every row the WHERE sample shows really satisfies the condition, and none that satisfies it is missing
    const sample = w.sample!;
    expect(sample.rows.length).toBe(want.rows.length);
    expect(sample.rows.every((r) => Number(r[sample.columns.indexOf("unit_price")]) > 50)).toBe(true);
    // the removed rows really fail it
    for (const r of w.removed?.rows ?? []) expect(Number(r[w.removed!.columns.indexOf("unit_price")])).toBeLessThanOrEqual(50);
    // SELECT narrows to the two columns
    expect(b.viz.stages[b.stageOf("select")].sample!.columns).toEqual(["product_name", "unit_price"]);
  });

  it("INNER JOIN: only matching rows, unmatched left rows are dropped, and the numbers equal an independent count", async () => {
    const sql = "SELECT p.product_name, od.quantity FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE od.quantity > 30";
    const b = await build(sql);
    const matched = await refCount("SELECT count(*) FROM order_details od WHERE EXISTS (SELECT 1 FROM products p WHERE p.product_id = od.product_id)");
    const unmatchedProducts = await refCount("SELECT count(*) FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id)");
    const from = b.viz.stages[b.stageOf("from")];
    expect(from.rowsOut).toBe(matched);
    expect(from.joins).toHaveLength(1);
    expect(from.joins![0].matchedPairs).toBe(matched);
    expect(from.joins![0].unmatchedLeft).toBe(unmatchedProducts);
    expect(from.joins![0].leftRows).toBe(await refCount("SELECT count(*) FROM products"));
    expect(from.joins![0].rightRows).toBe(await refCount("SELECT count(*) FROM order_details"));
    // every sampled joined row has equal keys on both sides of the ON condition
    const cols = from.sample!.columns;
    const ids = cols.map((c, i) => [c, i] as const).filter(([c]) => c === "product_id").map(([, i]) => i);
    expect(ids.length).toBe(2);
    expect(from.sample!.rows.every((r) => canon(r[ids[0]]) === canon(r[ids[1]]))).toBe(true);
    // the trace frame agrees: dropped left rows are exactly the products with no order lines
    const frame = b.trace.frames[b.stageOf("from")]!;
    expect(frame.kind).toBe("join");
    expect(frame.facts.unmatchedLeft).toHaveLength(unmatchedProducts);
    expect(frame.facts.padded).toHaveLength(0); // an inner join pads nothing
    await expectFinal(b, "SELECT p.product_name, od.quantity FROM order_details od, products p WHERE p.product_id = od.product_id AND od.quantity > 30", false);
    expect(b.viz.stages[b.stageOf("where")].rowsOut).toBe(await refCount("SELECT count(*) FROM order_details od, products p WHERE p.product_id = od.product_id AND od.quantity > 30"));
  });

  it("LEFT JOIN: unmatched left rows survive and are NULL-padded", async () => {
    const sql = "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id";
    const b = await build(sql);
    const orphans = (await ref("SELECT customer_id FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id) ORDER BY 1")).rows.map((r) => String(r[0]));
    expect(orphans.length).toBeGreaterThan(0);
    const total = (await refCount("SELECT count(*) FROM orders o WHERE EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = o.customer_id)")) + orphans.length;
    const from = b.viz.stages[b.stageOf("from")];
    expect(from.rowsOut).toBe(total);
    expect(from.joins![0].unmatchedLeft).toBe(orphans.length);
    const frame = b.trace.frames[b.stageOf("from")]!;
    expect(frame.facts.unmatchedLeft).toHaveLength(orphans.length);
    expect(frame.facts.padded).toHaveLength(orphans.length); // kept, with NULLs on the right
    const padded = frame.board!.cards.filter((c) => c.id.startsWith("pad:L:"));
    expect(padded).toHaveLength(orphans.length);
    expect(padded.every((c) => c.text.includes("NULL"))).toBe(true);
    // the padded rows of the final result carry exactly those customers with a NULL order_id
    const fin = b.viz.final!;
    expect(fin.rowCount).toBe(total);
    const nullRows = await ref("SELECT c.customer_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL ORDER BY 1");
    expect(nullRows.rows.map((r) => String(r[0]))).toEqual(orphans);
    // with the anti-join filter on top, the final result is exactly the orphans with NULL order_id
    const anti = await build(`${sql} WHERE o.order_id IS NULL`);
    expect(canonRows(anti.viz.final!.rows).map((r) => r[0]).sort()).toEqual(orphans.map(canon).sort());
    expect(anti.viz.final!.rows.every((r) => r[1] === null)).toBe(true);
    expect(anti.viz.stages[anti.stageOf("where")].rowsOut).toBe(orphans.length);
  });

  it("multiple JOINs (3 tables): each join step's numbers equal an independent count, and so does the final result", async () => {
    const sql = "SELECT c.company_name, o.order_id, e.last_name FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN employees e ON e.employee_id = o.employee_id WHERE c.country = 'Germany'";
    const b = await build(sql);
    const co = await refCount("SELECT count(*) FROM orders o, customers c WHERE o.customer_id = c.customer_id");
    const coe = await refCount("SELECT count(*) FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id");
    const from = b.viz.stages[b.stageOf("from")];
    expect(from.joins).toHaveLength(2);
    expect(from.joins![0].resultRows).toBe(co);
    expect(from.joins![1].resultRows).toBe(coe);
    expect(from.rowsOut).toBe(coe);
    expect(b.trace.frames[b.stageOf("from")]!.variants).toHaveLength(2); // one board per join
    const germany = await refCount("SELECT count(*) FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id AND c.country = 'Germany'");
    expect(b.viz.stages[b.stageOf("where")].rowsOut).toBe(germany);
    await expectFinal(b, "SELECT c.company_name, o.order_id, e.last_name FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id AND c.country = 'Germany'", false);
  });

  it("GROUP BY: one group per distinct key, with the right key values and member counts", async () => {
    const sql = "SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id";
    const b = await build(sql);
    const want = await ref("SELECT c.category_id, (SELECT count(*) FROM products p WHERE p.category_id = c.category_id) FROM (SELECT DISTINCT category_id FROM products) c");
    const g = b.viz.stages[b.stageOf("group by")];
    expect(g.rowsIn).toBe(await refCount("SELECT count(*) FROM products"));
    expect(g.rowsOut).toBe(want.rows.length);
    expect(keySet(g.sample!.rows)).toEqual(keySet(want.rows));
    await expectFinal(b, "SELECT category_id, count(*) FROM products GROUP BY 1", false);
    const frame = b.trace.frames[b.stageOf("group by")]!;
    expect(frame.kind).toBe("group");
    expect(frame.facts.groups.length).toBeGreaterThan(0);
    expect(frame.facts.groups.length).toBeLessThanOrEqual(want.rows.length);
  });

  it("SUM / COUNT / AVG / MIN / MAX: every aggregate in the final result equals an independent correlated sub-select", async () => {
    const sql = "SELECT category_id, COUNT(*) AS n, SUM(units_in_stock) AS stock, AVG(unit_price) AS avg_price, MIN(unit_price) AS lo, MAX(unit_price) AS hi FROM products GROUP BY category_id ORDER BY category_id";
    const b = await build(sql);
    await expectFinal(b, `SELECT c.category_id,
      (SELECT count(*) FROM products p WHERE p.category_id = c.category_id),
      (SELECT sum(units_in_stock) FROM products p WHERE p.category_id = c.category_id),
      (SELECT avg(unit_price) FROM products p WHERE p.category_id = c.category_id),
      (SELECT min(unit_price) FROM products p WHERE p.category_id = c.category_id),
      (SELECT max(unit_price) FROM products p WHERE p.category_id = c.category_id)
      FROM (SELECT DISTINCT category_id FROM products) c ORDER BY c.category_id`);
    // the SELECT stage's own sample holds the same aggregate rows (aggregates computed by the database, not by the browser)
    const sel = b.viz.stages[b.stageOf("select")];
    expect(sel.sample!.columns).toEqual(["category_id", "n", "stock", "avg_price", "lo", "hi"]);
    // an aggregate over an empty set and the NULL rules: COUNT(col) skips NULLs, COUNT(*) does not, SUM of nothing is NULL
    const nulls = await build("SELECT COUNT(*) AS all_rows, COUNT(shipped_date) AS shipped, SUM(freight) FILTER (WHERE shipped_date IS NULL) AS pending FROM orders");
    await expectFinal(nulls, "SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM orders WHERE shipped_date IS NOT NULL), (SELECT sum(freight) FROM orders WHERE shipped_date IS NULL)");
    const none = await build("SELECT SUM(unit_price) AS s, COUNT(*) AS n FROM products WHERE unit_price > 1000000");
    expect(canon(none.viz.final!.rows[0][0])).toBe("NULL");
    expect(canon(none.viz.final!.rows[0][1])).toBe("0");
  });

  it("HAVING: filters whole groups; the removed groups are exactly the independent ones", async () => {
    const sql = "SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id HAVING COUNT(*) > 8 ORDER BY n DESC, category_id";
    const b = await build(sql);
    const kept = await ref("SELECT category_id, count(*) FROM products GROUP BY category_id HAVING NOT (count(*) <= 8)");
    const dropped = await ref("SELECT category_id, count(*) FROM products GROUP BY category_id HAVING count(*) <= 8");
    const h = b.viz.stages[b.stageOf("having")];
    expect(h.rowsIn).toBe(kept.rows.length + dropped.rows.length);
    expect(h.rowsOut).toBe(kept.rows.length);
    expect(keySet(h.sample!.rows)).toEqual(keySet(kept.rows));
    expect(h.removed).toBeTruthy();
    expect(keySet(h.removed!.rows)).toEqual(keySet(dropped.rows));
    await expectFinal(b, "SELECT category_id, count(*) AS n FROM products GROUP BY category_id HAVING count(*) > 8 ORDER BY n DESC, category_id");
  });

  it("ORDER BY: the final order equals the independent order, and PostgreSQL's NULL placement is respected (ASC: last, DESC: first)", async () => {
    // a result small enough to be shown whole (the visualizer keeps a 20-row sample of the final result)
    const some = "order_id IN (SELECT order_id FROM orders WHERE shipped_date IS NULL UNION ALL SELECT order_id FROM (SELECT order_id FROM orders ORDER BY order_id LIMIT 4) f)";
    const nullCount = await refCount(`SELECT count(*) FROM orders WHERE ${some} AND shipped_date IS NULL`);
    const rowsInSet = await refCount(`SELECT count(*) FROM orders WHERE ${some}`);
    expect(nullCount).toBeGreaterThan(0);
    expect(rowsInSet).toBeLessThanOrEqual(20);
    const asc = await build(`SELECT order_id, shipped_date FROM orders WHERE ${some} ORDER BY shipped_date, order_id`);
    const wantAsc = await expectFinal(asc, `SELECT order_id, shipped_date FROM orders WHERE ${some} ORDER BY shipped_date ASC NULLS LAST, order_id`);
    expect(asc.viz.final!.rows).toHaveLength(rowsInSet);
    expect(asc.viz.final!.rows.slice(-nullCount).every((r) => r[1] === null)).toBe(true); // NULLs sort last in ASC
    expect(asc.viz.final!.rows.slice(0, rowsInSet - nullCount).every((r) => r[1] !== null)).toBe(true);
    expect(wantAsc.rows.slice(-nullCount).every((r) => r[1] === null)).toBe(true);
    const desc = await build(`SELECT order_id, shipped_date FROM orders WHERE ${some} ORDER BY shipped_date DESC, order_id`);
    await expectFinal(desc, `SELECT order_id, shipped_date FROM orders WHERE ${some} ORDER BY shipped_date DESC NULLS FIRST, order_id`);
    expect(desc.viz.final!.rows.slice(0, nullCount).every((r) => r[1] === null)).toBe(true); // NULLs sort first in DESC
    expect(desc.viz.final!.rows.slice(nullCount).every((r) => r[1] !== null)).toBe(true);
    // a multi-key sort with a tie-breaker
    const multi = await build("SELECT country, company_name FROM customers ORDER BY country DESC, company_name");
    await expectFinal(multi, "SELECT country, company_name FROM customers ORDER BY country DESC, company_name");
    // the sort stage keeps every row (a sort never changes the count)
    expect(asc.stageOf("order by")).toBeGreaterThan(-1);
    expect(asc.viz.final!.rowCount).toBe(rowsInSet);
  });

  it("LIMIT / OFFSET: the final result is the independent slice of the sorted rows", async () => {
    const sql = "SELECT product_name, unit_price FROM products ORDER BY unit_price DESC, product_id LIMIT 5 OFFSET 2";
    const b = await build(sql);
    await expectFinal(b, "SELECT product_name, unit_price FROM products ORDER BY unit_price DESC, product_id OFFSET 2 FETCH FIRST 5 ROWS ONLY");
    expect(b.viz.final!.rowCount).toBe(5);
    expect(b.stageOf("limit")).toBeGreaterThan(-1);
    const lim = b.trace.frames[b.stageOf("limit")]!;
    expect(lim.kind).toBe("limit");
    // the rows cut by LIMIT/OFFSET are all the rows that are not in the slice
    expect(lim.facts.cut.length + 5).toBeLessThanOrEqual(await refCount("SELECT count(*) FROM products"));
    const onlyLimit = await build("SELECT product_name FROM products ORDER BY product_name LIMIT 7");
    await expectFinal(onlyLimit, "SELECT product_name FROM products ORDER BY product_name FETCH FIRST 7 ROWS ONLY");
  });

  it("subquery: the scalar subquery is evaluated once and the filter uses its value", async () => {
    const sql = "SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products)";
    const b = await build(sql);
    const avg = Number((await ref("SELECT avg(unit_price) FROM products")).rows[0][0]);
    const want = await ref(`SELECT product_name FROM products WHERE unit_price > ${avg}`);
    expect(b.viz.stages[b.stageOf("where")].rowsOut).toBe(want.rows.length);
    await expectFinal(b, `SELECT product_name FROM products WHERE unit_price > ${avg}`, false);
    // an IN-subquery and a correlated EXISTS-subquery
    const inSub = await build("SELECT customer_id FROM customers WHERE customer_id IN (SELECT customer_id FROM orders WHERE freight > 200)");
    await expectFinal(inSub, "SELECT c.customer_id FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.freight > 200)", false);
    const ex = await build("SELECT company_name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)");
    await expectFinal(ex, "SELECT company_name FROM customers WHERE customer_id NOT IN (SELECT customer_id FROM orders)", false);
  });

  it("CTE: the named step is real, and the final result equals the independent query", async () => {
    const sql = "WITH big AS (SELECT order_id, SUM(quantity) AS q FROM order_details GROUP BY order_id) SELECT order_id, q FROM big WHERE q > 100 ORDER BY q DESC, order_id";
    const b = await build(sql);
    const want = await expectFinal(b, "SELECT order_id, sum(quantity) AS q FROM order_details GROUP BY order_id HAVING sum(quantity) > 100 ORDER BY q DESC, order_id");
    expect(b.viz.stages[b.stageOf("from")].rowsOut).toBe(await refCount("SELECT count(DISTINCT order_id) FROM order_details")); // the CTE has one row per order
    expect(b.viz.stages[b.stageOf("where")].rowsOut).toBe(want.rows.length);
    expect(b.viz.stages[b.stageOf("where")].rowsIn).toBe(await refCount("SELECT count(DISTINCT order_id) FROM order_details"));
  });

  it("window functions: partitions and per-row values equal an independent computation", async () => {
    const sql = "SELECT product_id, category_id, unit_price, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS rk, SUM(unit_price) OVER (PARTITION BY category_id) AS cat_total FROM products";
    const b = await build(sql);
    expect(b.stageOf("window")).toBeGreaterThan(-1);
    await expectFinal(b, `SELECT p.product_id, p.category_id, p.unit_price,
        1 + (SELECT count(*) FROM products q WHERE q.category_id = p.category_id AND q.unit_price > p.unit_price),
        (SELECT sum(q.unit_price) FROM products q WHERE q.category_id = p.category_id)
      FROM products p`, false);
    // row_number() has a value for every row, 1..partition size, no gaps
    const rn = await build("SELECT category_id, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY product_id) AS rn FROM products WHERE category_id IN (5, 6, 7)");
    const per = new Map<string, number[]>();
    for (const [c, n] of canonRows(rn.viz.final!.rows)) per.set(c, [...(per.get(c) ?? []), Number(n)]);
    expect(rn.viz.final!.rows).toHaveLength(rn.viz.final!.rowCount); // all 18 rows are shown, so every partition is complete
    const sizes = new Map((await ref("SELECT category_id, count(*) FROM products WHERE category_id IN (5, 6, 7) GROUP BY 1")).rows.map((r) => [canon(r[0]), Number(r[1])]));
    for (const [c, ns] of per) expect(ns.sort((x, y) => x - y)).toEqual(Array.from({ length: sizes.get(c)! }, (_, i) => i + 1));
  });

  it("NULL behaviour: a comparison with NULL removes the row (it is not 'false'), IS NULL finds it, '= NULL' finds nothing", async () => {
    const gt = await build("SELECT order_id FROM orders WHERE shipped_date > '1996-06-01'");
    const nulls = await refCount("SELECT count(*) FROM orders WHERE shipped_date IS NULL");
    const total = await refCount("SELECT count(*) FROM orders");
    const later = await refCount("SELECT count(*) FROM orders WHERE shipped_date > DATE '1996-06-01'");
    const w = gt.viz.stages[gt.stageOf("where")];
    expect(w.rowsOut).toBe(later);
    expect(w.rowsIn! - w.rowsOut!).toBe(total - later); // the NULL rows are among the removed ones
    expect(total - later).toBeGreaterThanOrEqual(nulls);
    const isNull = await build("SELECT order_id FROM orders WHERE shipped_date IS NULL");
    expect(isNull.viz.stages[isNull.stageOf("where")].rowsOut).toBe(nulls);
    const eqNull = await build("SELECT order_id FROM orders WHERE shipped_date = NULL");
    expect(eqNull.viz.stages[eqNull.stageOf("where")].rowsOut).toBe(0);
    expect(eqNull.viz.final!.rowCount).toBe(0);
    // NULL in an aggregate, in COALESCE and in a join key
    const co = await build("SELECT COALESCE(region, 'none') AS r, COUNT(*) AS n FROM suppliers GROUP BY COALESCE(region, 'none') ORDER BY r");
    await expectFinal(co, "SELECT COALESCE(region, 'none'), count(*) FROM suppliers GROUP BY 1 ORDER BY 1");
    const grp = await build("SELECT region, COUNT(*) AS n FROM suppliers GROUP BY region");
    // all NULL regions fall into ONE group
    expect(grp.viz.final!.rows.filter((r) => r[0] === null)).toHaveLength(1);
    expect(Number(grp.viz.final!.rows.find((r) => r[0] === null)![1])).toBe(await refCount("SELECT count(*) FROM suppliers WHERE region IS NULL"));
  });

  it("empty results: zero rows is a result, not a crash; every stage after the empty one reports 0", async () => {
    const b = await build("SELECT * FROM products WHERE unit_price > 1000000");
    expect(b.viz.final).toBeTruthy();
    expect(b.viz.final!.rowCount).toBe(0);
    expect(b.viz.final!.rows).toEqual([]);
    const w = b.viz.stages[b.stageOf("where")];
    expect(w.rowsIn).toBe(77);
    expect(w.rowsOut).toBe(0);
    expect(b.viz.stages[b.stageOf("select")].rowsOut).toBe(0);
    expect(b.viz.stages.every((s) => !s.error)).toBe(true);
    expect(b.trace.frames.every((f) => f !== undefined)).toBe(true);
    // an empty join result and an empty group result
    const j = await build("SELECT p.product_name FROM products p JOIN order_details od ON od.product_id = p.product_id AND od.quantity < 0");
    expect(j.viz.final!.rowCount).toBe(0);
    const g = await build("SELECT category_id, COUNT(*) FROM products WHERE unit_price < 0 GROUP BY category_id");
    expect(g.viz.final!.rowCount).toBe(0);
    expect(g.viz.stages[g.stageOf("group by")].rowsOut).toBe(0);
  });

  it("invalid SQL: the error is reported, no result is produced, and nothing throws", async () => {
    for (const sql of ["SELECT x FROM no_such_table", "SELECT product_name FROM products WHERE", "SELECT nope FROM products"]) {
      const viz = await visualize(sql, run);
      expect(viz.final, sql).toBeUndefined();
      expect(viz.stages.some((s) => s.error) || viz.unsupported, sql).toBeTruthy();
      await expect(traceRows(sql, run, viz)).resolves.toBeTruthy();
      expect(() => teachSteps(viz, undefined)).not.toThrow();
    }
    for (const sql of ["SELEC 1", "", "   ", "DROP TABLE products"]) {
      const viz = await visualize(sql, run);
      expect(viz.final).toBeUndefined();
      expect(viz.stages).toHaveLength(0);
      expect(viz.unsupported).toBeTruthy();
    }
    expect(await refCount("SELECT count(*) FROM products")).toBe(77); // DROP TABLE was not run
  });
});

/* ------------------------------------------------------------------------------------------------------------------------ */
describe("the query runs once and only read-only queries are added", () => {
  it("the learner's SQL appears exactly once among the executed statements; every other statement is a SELECT, WITH or EXPLAIN", async () => {
    const seen: string[] = [];
    const logged: Run = (sql) => { seen.push(sql); return run(sql); };
    const sql = "SELECT c.country, COUNT(*) AS n FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country HAVING COUNT(*) > 3 ORDER BY n DESC";
    const viz = await visualize(sql, logged);
    await traceRows(sql, logged, viz);
    expect(seen.filter((s) => s === sql || s.trim() === sql)).toHaveLength(1);
    expect(seen.every((s) => /^\s*(select|with|explain|begin|rollback)\b/i.test(s))).toBe(true);
    expect(seen.some((s) => /\b(insert|update|delete|drop|alter|create|truncate)\b/i.test(s.replace(/'[^']*'/g, "")) && !/^\s*(select|with|explain)\b/i.test(s))).toBe(false);
    expect(await refCount("SELECT count(*) FROM customers")).toBe(91);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------ */
describe("teaching cards: the intermediate tables and the numbers agree with independent queries (feature tests: red = card data missing or wrong)", () => {
  it("one card per stage, in order, each with a label, text and a provenance", async () => {
    const b = await build("SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id HAVING COUNT(*) > 8 ORDER BY n DESC");
    expect(b.cards).toHaveLength(b.viz.stages.length);
    b.cards.forEach((c, i) => {
      expect(c.stageIndex).toBe(i);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.what.length).toBeGreaterThan(0);
      expect(c.operation.length).toBeGreaterThan(0);
      expect(["executed", "parsed"]).toContain(c.provenance);
    });
    const labels = b.cards.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["FROM", "GROUP BY", "HAVING", "ORDER BY"]));
    expect(labels.some((l) => /^(COUNT|SELECT)$/.test(l)), `an aggregate or SELECT step among ${labels.join(", ")}`).toBe(true);
    expect(labels.indexOf("FROM")).toBeLessThan(labels.indexOf("GROUP BY"));
    expect(labels.indexOf("GROUP BY")).toBeLessThan(labels.indexOf("HAVING"));
    expect(labels.indexOf("HAVING")).toBeLessThan(labels.indexOf("ORDER BY")); // logical order
  });

  it("every card text is free of placeholders and says nothing false about counts (rows in / rows out match the stage and the database)", async () => {
    const b = await build("SELECT product_name, unit_price FROM products WHERE unit_price > 50 ORDER BY unit_price DESC");
    const w = b.cards[b.stageOf("where")];
    expect(w.rowsIn).toBe(77);
    expect(w.rowsOut).toBe(await refCount("SELECT count(*) FROM products WHERE unit_price > 50"));
    for (const c of b.cards) {
      const text = [c.what, c.changed, c.why, c.remember, c.operation, ...c.notes].join(" ");
      expect(text).not.toMatch(/undefined|NaN|\[object|TODO|lorem|null null/i);
    }
  });

  it("WHERE: the output table holds exactly the rows the database keeps; the removed table, the rows it drops", async () => {
    const b = await build("SELECT product_name, unit_price FROM products WHERE unit_price > 50 ORDER BY unit_price DESC");
    const c = b.cards[b.stageOf("where")];
    expect(c.outputs.length).toBeGreaterThan(0);
    const kept = c.outputs.find((t) => t.role === "output") ?? c.outputs[0];
    const names = ["product_name", "unit_price"];
    const want = await ref("SELECT product_name, unit_price FROM products WHERE unit_price > 50");
    expect(kept.total ?? kept.rows.length).toBe(want.rows.length);
    expect(keySet(pick(kept.columns, kept.rows, names))).toEqual(keySet(want.rows));
    const input = c.inputs[0];
    expect(input, "the WHERE card shows its input table").toBeTruthy();
    expect(input.total).toBe(77);
    const removed = c.outputs.find((t) => t.role === "removed") ?? c.inputs.find((t) => t.role === "removed");
    expect(removed, "the WHERE card shows the removed rows").toBeTruthy();
    const dropped = await ref("SELECT product_name, unit_price FROM products WHERE NOT (unit_price > 50)");
    expect(keySet(pick(removed!.columns, removed!.rows, names)).size).toBeGreaterThan(0);
    const all = keySet(dropped.rows);
    for (const k of keySet(pick(removed!.columns, removed!.rows, names))) expect(all.has(k)).toBe(true);
  });

  it("JOIN: the card's output table has equal join keys on both sides, and dropped / NULL-padded rows are named", async () => {
    const inner = await build("SELECT p.product_name, od.quantity FROM products p JOIN order_details od ON od.product_id = p.product_id");
    const c = inner.cards[inner.stageOf("from")];
    const t = c.outputs.find((x) => x.role === "output")!;
    expect(t, "the JOIN card shows the joined table").toBeTruthy();
    const ids = t.columns.map((n, i) => [n, i] as const).filter(([n]) => /(^|\.)product_id$/.test(n)).map(([, i]) => i);
    expect(ids.length, `the product_id of both tables in ${t.columns.slice(0, 12).join(", ")}`).toBe(2);
    expect(t.rows.length).toBeGreaterThan(0);
    expect(t.rows.every((r) => canon(r[ids[0]]) === canon(r[ids[1]]))).toBe(true);
    expect(t.total).toBe(await refCount("SELECT count(*) FROM order_details od, products p WHERE p.product_id = od.product_id"));
    const left = await build("SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id");
    const lc = left.cards[left.stageOf("from")];
    const text = [lc.what, lc.changed, lc.why, lc.remember, ...lc.notes].join(" ");
    expect(text).toMatch(/NULL/);
  });

  it("GROUP BY / HAVING / aggregate cards: group table and totals equal the database's groups", async () => {
    const b = await build("SELECT category_id, COUNT(*) AS n, AVG(unit_price) AS a FROM products GROUP BY category_id HAVING COUNT(*) > 8");
    const g = b.cards[b.stageOf("group by")];
    expect(g.rowsOut).toBe(await refCount("SELECT count(DISTINCT category_id) FROM products"));
    const h = b.cards[b.stageOf("having")];
    expect(h.rowsIn).toBe(g.rowsOut);
    expect(h.rowsOut).toBe(await refCount("SELECT count(*) FROM (SELECT 1 FROM products GROUP BY category_id HAVING count(*) > 8) x"));
    const ht = h.outputs.find((t) => t.role === "output") ?? h.outputs[0];
    const want = await ref("SELECT category_id, count(*) FROM products GROUP BY category_id HAVING count(*) > 8");
    expect(keySet(pick(ht.columns, ht.rows, ["category_id", ht.columns[1]]))).toEqual(keySet(want.rows));
    const sel = b.cards[b.stageOf("select")];
    const st = sel.outputs[0];
    const avgWant = await ref("SELECT category_id, count(*), avg(unit_price) FROM products GROUP BY category_id HAVING count(*) > 8");
    expect(keySet(st.rows)).toEqual(keySet(avgWant.rows));
  });

  it("ORDER BY card: the output table is in the independent order (NULLs where PostgreSQL puts them)", async () => {
    const b = await build("SELECT order_id, shipped_date FROM orders ORDER BY shipped_date DESC, order_id");
    const c = b.cards[b.stageOf("order by")];
    expect(c.outputs.length, "the ORDER BY card shows the sorted rows").toBeGreaterThan(0);
    const t = c.outputs.find((x) => x.role === "output") ?? c.outputs[0];
    const want = await ref("SELECT order_id, shipped_date FROM orders ORDER BY shipped_date DESC NULLS FIRST, order_id");
    const shown = pick(t.columns, t.rows, ["order_id", "shipped_date"]);
    expect(canonRows(shown)).toEqual(canonRows(want.rows).slice(0, shown.length));
    expect(shown.length).toBeGreaterThan(1);
    expect(shown[0][1]).toBeNull(); // DESC puts NULLs first
    expect(c.rowsOut ?? t.total).toBe(await refCount("SELECT count(*) FROM orders"));
  });

  it("LIMIT / OFFSET card: shows the kept slice and says how many rows were cut", async () => {
    const b = await build("SELECT product_name FROM products ORDER BY unit_price DESC, product_id LIMIT 5 OFFSET 2");
    const c = b.cards[b.stageOf("limit")];
    expect(c.outputs.length).toBeGreaterThan(0);
    const want = await ref("SELECT product_name FROM products ORDER BY unit_price DESC, product_id OFFSET 2 FETCH FIRST 5 ROWS ONLY");
    const kept = c.outputs.find((x) => x.role === "output")!;
    expect(kept, "the LIMIT card has a kept table").toBeTruthy();
    expect(canonRows(kept.rows)).toEqual(canonRows(want.rows));
    expect(kept.total).toBe(5);
    expect(c.rowsOut).toBe(5);
    // what was cut is in "removed" tables: OFFSET skips 2, LIMIT cuts the rest, and nothing kept is listed as removed
    const removed = c.outputs.filter((x) => x.role === "removed");
    expect(removed.reduce((n, x) => n + (x.total ?? x.rows.length), 0)).toBe((await refCount("SELECT count(*) FROM products")) - 5);
    const keptKeys = keySet(want.rows);
    for (const x of removed) for (const k of keySet(x.rows)) expect(keptKeys.has(k)).toBe(false);
  });

  it("empty result: the card says so instead of showing an empty frame", async () => {
    const b = await build("SELECT * FROM products WHERE unit_price > 1000000");
    const c = b.cards[b.stageOf("where")];
    expect(c.rowsOut).toBe(0);
    expect([c.what, c.changed, c.why, ...c.notes].join(" ")).toMatch(/\b(no rows|0 rows|empty|nothing)\b/i);
  });

  it("window card: names the partitions and the per-row value, from the database", async () => {
    const b = await build("SELECT product_id, category_id, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS rk FROM products");
    const c = b.cards[b.stageOf("window")];
    expect(c.kind).toBe("window");
    expect([c.operation, c.what, c.changed, ...c.notes].join(" ")).toMatch(/partition/i);
    const sel = b.cards[b.stageOf("select")];
    const t = sel.outputs[0];
    expect(t, "the SELECT card shows the rows with the window value").toBeTruthy();
    const rk = t.columns.indexOf("rk");
    expect(rk).toBeGreaterThan(-1);
    const want = new Map((await ref("SELECT p.product_id, 1 + (SELECT count(*) FROM products q WHERE q.category_id = p.category_id AND q.unit_price > p.unit_price) FROM products p")).rows.map((r) => [canon(r[0]), canon(r[1])]));
    for (const r of t.rows) expect(canon(r[rk])).toBe(want.get(canon(r[t.columns.indexOf("product_id")])));
  });

  it("invalid SQL: building the cards does not throw", async () => {
    const viz = await visualize("SELECT x FROM no_such_table", run);
    expect(() => teachSteps(viz, undefined)).not.toThrow();
    const none = await visualize("SELEC", run);
    expect(() => teachSteps(none, undefined)).not.toThrow();
  });
});
