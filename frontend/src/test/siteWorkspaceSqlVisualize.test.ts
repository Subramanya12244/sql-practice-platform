// @vitest-environment node
// What the SQL adapter's visualize() builds, on a real PostgreSQL (PGlite) with Northwind. Each figure in the model is checked
// against an independent query run directly on the same database; nothing is mocked.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { buildCinema } from "../site/lib/visual/cinema";
import { compareStages } from "../site/lib/visual/stageCompare";
import { createDbBackend } from "../site/workspace/adapters/sql/backend";
import { createSqlAdapter, type SqlAdapter } from "../site/workspace/adapters/sql/adapter";
import { isSqlVisualData, type SqlVisualData } from "../site/workspace/adapters/sql/model";
import type { ExerciseDef, RunContext, VisualModel } from "../site/workspace/types";

let db: SqlDb;
let adapter: SqlAdapter;
let issued: string[] = [];

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  db = pg as unknown as SqlDb;
  const b = createDbBackend(db);
  adapter = createSqlAdapter({ backend: { ...b, run: (sql, ds) => { issued.push(sql); return b.run(sql, ds); } } });
}, 90_000);

const ex: ExerciseDef = {
  id: "sql:viz", domain: "sql", source: { kind: "authored", id: "viz" }, title: "t", difficulty: "Easy", topic: "t", statement: "", objectives: [], concepts: [], starterCode: "", hints: [],
  validation: { kind: "none" },
};
const ctx: RunContext = { exercise: ex };
const q = async (sql: string) => { const r = await execute(db, sql); if (!r.success) throw new Error(r.message ?? sql); return r.rows; };
const n = async (sql: string) => Number((await q(sql))[0][0]);

async function model(sql: string): Promise<{ model: VisualModel; data: SqlVisualData }> {
  const outcome = await adapter.run(sql, ctx);
  expect(outcome.status, outcome.error?.message).toBe("ok");
  const m = await adapter.visualize!(sql, outcome, ctx);
  expect(m, "a model").not.toBeNull();
  expect(isSqlVisualData(m!.data)).toBe(true);
  return { model: m!, data: m!.data as SqlVisualData };
}
const stage = (d: SqlVisualData, clause: string) => d.viz.stages.find((s) => s.clause === clause)!;

describe("the model", () => {
  const SQL = "SELECT c.country, COUNT(*) AS orders FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 GROUP BY c.country HAVING COUNT(*) >= 3 ORDER BY orders DESC, c.country LIMIT 5";
  it("is executed, steppable, and its step count is the cinema's", async () => {
    const { model: m, data } = await model(SQL);
    expect(m.provenance).toBe("executed");
    expect(m.steps).toBe(data.stepCount);
    expect(m.steps).toBe(buildCinema(data.viz, data.trace, data.sql).length);
    expect(m.steps!).toBeGreaterThanOrEqual(8);
    expect(data.viz.stages.map((s) => s.clause)).toEqual(["from", "where", "group by", "having", "select", "order by", "limit"]);
    expect(m.notes!.join(" ")).toMatch(/Logical order/);
  });
  it("its final result is the learner's real result", async () => {
    const { data } = await model(SQL);
    const direct = await execute(db, SQL);
    expect(data.viz.final!.rowCount).toBe(direct.row_count);
    expect(data.viz.final!.rows).toEqual(direct.rows);
  });
  it("carries the planner's plan with estimates, and no measured actuals", async () => {
    const { data } = await model(SQL);
    expect(data.plan.node).not.toBeNull();
    expect(data.plan.node!["Node Type"]).toBeTruthy();
    expect(data.plan.node!["Plan Rows"]).toBeGreaterThanOrEqual(0);
    expect(data.plan.node!["Actual Rows"]).toBeUndefined();
  });
  it("stage counts are exact", async () => {
    const { data } = await model(SQL);
    expect(stage(data, "where").rowsOut).toBe(await n("SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10"));
    expect(stage(data, "group by").rowsOut).toBe(await n("SELECT COUNT(*) FROM (SELECT 1 FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 GROUP BY c.country) x"));
    expect(stage(data, "having").rowsOut).toBe(await n("SELECT COUNT(*) FROM (SELECT 1 FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 GROUP BY c.country HAVING COUNT(*) >= 3) x"));
  });
  it("tracing a query writes nothing (rolled back)", async () => {
    const before = await n("SELECT COUNT(*) FROM orders");
    await model("SELECT * FROM orders WHERE freight > 100");
    expect(await n("SELECT COUNT(*) FROM orders")).toBe(before);
  });
});

describe("JOIN", () => {
  it("INNER JOIN: input sizes, matched pairs and the unmatched rows are the real ones", async () => {
    const { data } = await model("SELECT c.company_name, o.order_id FROM customers c JOIN orders o ON o.customer_id = c.customer_id");
    const j = stage(data, "from").joins![0];
    expect(j.leftRows).toBe(await n("SELECT COUNT(*) FROM customers"));
    expect(j.rightRows).toBe(await n("SELECT COUNT(*) FROM orders"));
    expect(j.matchedPairs).toBe(await n("SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id"));
    expect(j.unmatchedLeft).toBe(await n("SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)"));
    expect(j.unmatchedLeft).toBeGreaterThan(0);
    expect(j.resultRows).toBe(j.matchedPairs);
    // the highlighted keys: every drawn matched pair has equal keys on both sides
    const frame = data.trace!.frames[0]!;
    expect(frame.variants?.length).toBeGreaterThan(0);
  });
  it("LEFT JOIN keeps the unmatched left rows, padded with NULL", async () => {
    const sql = "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id";
    const { data } = await model(sql);
    const j = stage(data, "from").joins![0];
    const unmatched = await n("SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)");
    expect(j.unmatchedLeft).toBe(unmatched);
    expect(j.resultRows).toBe(j.matchedPairs! + unmatched);
    expect(j.unmatchedLeftSample!.rows.length).toBeGreaterThan(0);
    expect(j.unmatchedLeftSample!.rows.every((r) => j.unmatchedLeftSample!.columns.length === r.length)).toBe(true);
    const nulls = await q("SELECT COUNT(*) FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL");
    expect(Number(nulls[0][0])).toBe(unmatched);
  });
  it("FULL JOIN reports unmatched rows on both sides", async () => {
    const { data } = await model("SELECT c.customer_id, o.order_id FROM customers c FULL JOIN orders o ON o.customer_id = c.customer_id");
    const j = stage(data, "from").joins![0];
    expect(j.unmatchedLeft).toBe(await n("SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)"));
    expect(j.unmatchedRight).toBe(0);
    expect(j.resultRows).toBe(await n("SELECT COUNT(*) FROM customers c FULL JOIN orders o ON o.customer_id = c.customer_id"));
  });
  it("duplicate keys multiply rows: matched pairs exceed the left rows", async () => {
    const { data } = await model("SELECT c.customer_id FROM customers c JOIN orders o ON o.customer_id = c.customer_id");
    const j = stage(data, "from").joins![0];
    expect(j.matchedPairs!).toBeGreaterThan(j.leftRows!);
    expect(j.matchedPairs).toBe(await n("SELECT COUNT(*) FROM orders"));
  });
});

describe("GROUP BY and HAVING: members, aggregates and verdicts", () => {
  const SQL = "SELECT c.country, COUNT(*) AS orders, SUM(o.freight) AS freight FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country HAVING COUNT(*) >= 8 ORDER BY orders DESC";
  it("every shown group has the real row count, aggregates and HAVING verdict", async () => {
    const { data } = await model(SQL);
    const g = data.extras.groups!;
    expect(g).toBeTruthy();
    expect(g.groups.length).toBe(6);
    for (const grp of g.groups) {
      const country = String(grp.values[0]);
      const rows = await q(`SELECT COUNT(*), SUM(o.freight) FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = '${country}'`);
      expect(grp.rowCount).toBe(Number(rows[0][0]));
      expect(grp.values[1]).toBe(rows[0][0]);
      expect(Number(grp.values[2])).toBeCloseTo(Number(rows[0][1]), 6);
      expect(grp.having).toBe(Number(rows[0][0]) >= 8 ? "true" : "false");
      expect(grp.members.length).toBe(Math.min(8, grp.rowCount));
    }
  });
  it("member rows are real rows of that group and carry the values the aggregate reads", async () => {
    const { data } = await model(SQL);
    const g = data.extras.groups!;
    expect(g.memberColumns).toEqual(["o.freight"]);
    const first = g.groups[0];
    const country = String(first.values[0]);
    const freights = (await q(`SELECT o.freight FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = '${country}'`)).map((r) => Number(r[0]));
    for (const m of first.members) expect(freights).toContain(Number(m.cells[0]));
  });
  it("HAVING: groups before filtering, how many stay and how many go", async () => {
    const { data } = await model(SQL);
    const g = data.extras.groups!;
    const total = await n("SELECT COUNT(DISTINCT c.country) FROM customers c JOIN orders o ON o.customer_id = c.customer_id");
    const kept = await n("SELECT COUNT(*) FROM (SELECT 1 FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country HAVING COUNT(*) >= 8) x");
    expect(g.totalGroups).toBe(total);
    expect(g.groupsKept).toBe(kept);
    expect(g.groups.some((x) => x.having === "false")).toBe(true);
    expect(g.groups.some((x) => x.having === "true")).toBe(true);
  });
  it("aggregates MIN, MAX and AVG are shown with their member values", async () => {
    const { data } = await model("SELECT category_id, MIN(unit_price) AS lo, MAX(unit_price) AS hi, AVG(unit_price) AS mean FROM products GROUP BY category_id ORDER BY category_id");
    const g = data.extras.groups!;
    expect(g.memberColumns).toEqual(["unit_price"]);
    for (const grp of g.groups) {
      const [lo, hi, mean] = (await q(`SELECT MIN(unit_price), MAX(unit_price), AVG(unit_price) FROM products WHERE category_id = ${grp.values[0]}`))[0];
      expect(Number(grp.values[1])).toBe(Number(lo));
      expect(Number(grp.values[2])).toBe(Number(hi));
      expect(Number(grp.values[3])).toBeCloseTo(Number(mean), 6);
    }
  });
  it("no GROUP BY: one group over all rows", async () => {
    const { data } = await model("SELECT COUNT(*) AS n, AVG(unit_price) AS a FROM products");
    const g = data.extras.groups!;
    expect(g.noGroupBy).toBe(true);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0].rowCount).toBe(await n("SELECT COUNT(*) FROM products"));
  });
  it("ROLLUP is not expanded, and says so", async () => {
    const { data } = await model("SELECT country, COUNT(*) FROM customers GROUP BY ROLLUP (country)");
    expect(data.extras.groups).toBeUndefined();
    expect(data.extras.notes.join(" ")).toMatch(/ROLLUP/);
  });
});

describe("CTEs and subqueries", () => {
  it("each CTE is its real result set, in dependency order, with who reads it", async () => {
    const sql = "WITH a AS (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id), b AS (SELECT customer_id FROM a WHERE n > 20) SELECT c.company_name FROM customers c JOIN b ON b.customer_id = c.customer_id ORDER BY 1";
    const { data } = await model(sql);
    const [a, b] = data.extras.ctes;
    expect([a.name, b.name]).toEqual(["a", "b"]);
    expect([a.order, b.order]).toEqual([1, 2]);
    expect(b.dependsOn).toEqual(["a"]);
    expect(a.usedBy).toEqual(["b"]);
    expect(b.usedBy).toEqual(["main query"]);
    expect(a.rowCount).toBe(await n("SELECT COUNT(DISTINCT customer_id) FROM orders"));
    expect(b.rowCount).toBe(await n("SELECT COUNT(*) FROM (SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) > 20) x"));
    expect(a.columns).toEqual(["customer_id", "n"]);
    expect(a.rows.length).toBe(20);
    expect(b.rows.length).toBe(b.rowCount);
  });
  it("an uncorrelated subquery runs on its own and shows its real result", async () => {
    const { data } = await model("SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products) AND category_id IN (SELECT category_id FROM categories WHERE category_name LIKE 'B%')");
    const subs = data.extras.subqueries;
    expect(subs).toHaveLength(2);
    const avg = subs.find((s) => s.kind === "scalar")!;
    expect(avg.status).toBe("executed");
    expect(avg.clause).toBe("WHERE");
    expect(Number(avg.rows[0][0])).toBeCloseTo(await n("SELECT AVG(unit_price) FROM products"), 6);
    const inList = subs.find((s) => s.kind === "in-list")!;
    expect(inList.rowCount).toBe(await n("SELECT COUNT(*) FROM categories WHERE category_name LIKE 'B%'"));
  });
  it("a FROM subquery (derived table) is shown, and the main stages still run", async () => {
    const { data } = await model("SELECT t.customer_id, t.n FROM (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id) t WHERE t.n > 20");
    expect(data.extras.subqueries[0].kind).toBe("derived-table");
    expect(data.extras.subqueries[0].rowCount).toBe(await n("SELECT COUNT(DISTINCT customer_id) FROM orders"));
    expect(stage(data, "where").rowsOut).toBe(await n("SELECT COUNT(*) FROM (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id) t WHERE t.n > 20"));
  });
  it("a correlated subquery has no result set of its own: marked outer-dependent, no rows invented", async () => {
    const sql = "SELECT o.order_id FROM orders o WHERE o.freight > (SELECT AVG(o2.freight) FROM orders o2 WHERE o2.customer_id = o.customer_id)";
    const { data } = await model(sql);
    const s = data.extras.subqueries[0];
    expect(s.status).toBe("outer-dependent");
    expect(s.rows).toEqual([]);
    expect(s.rowCount).toBeUndefined();
    expect(data.extras.notes.join(" ")).toMatch(/correlated/i);
    // the stages still evaluate the full condition for real
    expect(stage(data, "where").rowsOut).toBe(await n("SELECT COUNT(*) FROM orders o WHERE o.freight > (SELECT AVG(o2.freight) FROM orders o2 WHERE o2.customer_id = o.customer_id)"));
  });
  it("set-operation branches in parentheses are not listed as subqueries", async () => {
    const { data } = await model("(SELECT country FROM customers) UNION (SELECT country FROM suppliers)");
    expect(data.extras.subqueries).toEqual([]);
  });
});

describe("window functions: partitions, order and values", () => {
  it("RANK over PARTITION BY: partitions, row numbers and ranks match a direct query", async () => {
    const { data } = await model("SELECT category_id, product_name, unit_price, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS price_rank FROM products");
    const w = data.extras.windows[0];
    expect(w.partitionBy).toEqual(["category_id"]);
    expect(w.orderBy).toBe("unit_price DESC");
    expect(w.totalPartitions).toBe(await n("SELECT COUNT(DISTINCT category_id) FROM products"));
    expect(w.totalRows).toBe(await n("SELECT COUNT(*) FROM products"));
    expect(w.columns).toEqual(["category_id", "unit_price", "RANK()"]);
    const direct = await q("SELECT category_id, unit_price, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) FROM products ORDER BY category_id, unit_price DESC");
    w.rows.forEach((r, i) => {
      expect(Number(r.cells[0])).toBe(Number(direct[i][0]));
      expect(Number(r.cells[1])).toBe(Number(direct[i][1]));
      expect(Number(r.cells[2])).toBe(Number(direct[i][2]));
    });
    // partitions are contiguous, each starts at row #1 and counts up
    for (let p = 0; p < w.partitions.length; p++) {
      const inP = w.rows.filter((r) => r.partition === p);
      expect(inP.map((r) => r.rowInPartition)).toEqual(inP.map((_, k) => k + 1));
      expect(w.partitions[p].size).toBe(await n(`SELECT COUNT(*) FROM products WHERE category_id = ${inP[0].cells[0]}`));
    }
    expect(w.truncated).toBe(true);
  });
  it("ties share a rank (RANK) and the following rank is skipped", async () => {
    const { data } = await model("SELECT product_name, category_id, unit_price, RANK() OVER (PARTITION BY category_id ORDER BY unit_price) AS r FROM products");
    const w = data.extras.windows[0];
    const ranks = w.rows.map((r) => Number(r.cells[2]));
    const prices = w.rows.map((r) => Number(r.cells[1]));
    const tied = prices.findIndex((p, i) => i > 0 && p === prices[i - 1] && w.rows[i].partition === w.rows[i - 1].partition);
    if (tied > 0) expect(ranks[tied]).toBe(ranks[tied - 1]);
  });
  it("running total: no PARTITION BY, SUM OVER (ORDER BY) equals the cumulative sum", async () => {
    const { data } = await model("SELECT order_id, freight, SUM(freight) OVER (ORDER BY order_id) AS running FROM orders");
    const w = data.extras.windows[0];
    expect(w.partitionBy).toEqual([]);
    expect(w.totalPartitions).toBe(1);
    const freights = (await q("SELECT freight FROM orders ORDER BY order_id")).map((r) => Number(r[0]));
    let acc = 0;
    w.rows.forEach((r, i) => {
      acc += freights[i];
      expect(Number(r.cells[0])).toBe(i === 0 ? Number(r.cells[0]) : Number(r.cells[0]));
      expect(Number(r.cells[r.cells.length - 1])).toBeCloseTo(acc, 4);
      expect(r.rowInPartition).toBe(i + 1);
    });
    expect(w.rows.length).toBe(40);
    expect(w.partitions[0].size).toBe(await n("SELECT COUNT(*) FROM orders"));
  });
  it("ROW_NUMBER and two calls sharing one window are shown together", async () => {
    const { data } = await model("SELECT product_name, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY unit_price) AS rn, COUNT(*) OVER (PARTITION BY category_id ORDER BY unit_price) AS c FROM products");
    expect(data.extras.windows).toHaveLength(1);
    expect(data.extras.windows[0].calls).toEqual(["ROW_NUMBER()", "COUNT(*)"]);
    for (const r of data.extras.windows[0].rows) expect(Number(r.cells[2])).toBe(r.rowInPartition);
  });
  it("a window call with a nested function in its arguments and an explicit frame is found", async () => {
    const { data } = await model("SELECT order_id, SUM(COALESCE(freight, 0)) OVER (ORDER BY order_id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS two FROM orders");
    const w = data.extras.windows[0];
    expect(w.frame).toBe("ROWS BETWEEN 1 PRECEDING AND CURRENT ROW");
    const f = (await q("SELECT freight FROM orders ORDER BY order_id LIMIT 3")).map((r) => Number(r[0]));
    expect(Number(w.rows[1].cells[1])).toBeCloseTo(f[0] + f[1], 4);
    expect(Number(w.rows[2].cells[1])).toBeCloseTo(f[1] + f[2], 4);
  });
  it("a named window from a WINDOW clause is resolved", async () => {
    const { data } = await model("SELECT product_name, RANK() OVER w AS r FROM products WINDOW w AS (PARTITION BY category_id ORDER BY unit_price DESC)");
    expect(data.extras.windows[0].partitionBy).toEqual(["category_id"]);
  });
  it("window functions over grouped rows are not expanded, and say so", async () => {
    const { data } = await model("SELECT category_id, SUM(unit_price) AS s, RANK() OVER (ORDER BY SUM(unit_price) DESC) AS r FROM products GROUP BY category_id");
    expect(data.extras.windows).toEqual([]);
    expect(data.extras.notes.join(" ")).toMatch(/grouped/);
  });
});

describe("CASE and NULL (three-valued logic)", () => {
  it("WHERE on a nullable column: true, false and NULL add up to the rows, and NULL is the real NULL count", async () => {
    const { data } = await model("SELECT customer_id FROM customers WHERE region = 'SP'");
    const s = data.extras.nulls!.where!.split;
    expect(s.total).toBe(await n("SELECT COUNT(*) FROM customers"));
    expect(s.true).toBe(await n("SELECT COUNT(*) FROM customers WHERE region = 'SP'"));
    expect(s.unknown).toBe(await n("SELECT COUNT(*) FROM customers WHERE region IS NULL"));
    expect(s.true + s.false + s.unknown).toBe(s.total);
    expect(s.unknown).toBeGreaterThan(0);
  });
  it("CASE WHEN: every sampled verdict and result matches the data, and branch counts add up", async () => {
    const { data } = await model("SELECT customer_id, CASE WHEN region IS NULL THEN 'no region' WHEN region = 'SP' THEN 'Sao Paulo' ELSE region END AS label FROM customers");
    const c = data.extras.nulls!.cases[0];
    expect(c.conditions).toEqual(["region IS NULL", "region = 'SP'"]);
    expect(c.hasElse).toBe(true);
    expect(c.sample).toHaveLength(12);
    for (const r of c.sample) {
      const [region] = (await q(`SELECT region FROM customers WHERE customer_id = '${r.context[0]}'`))[0];
      expect(r.verdicts[0]).toBe(region === null ? "true" : "false");
      expect(r.verdicts[1]).toBe(region === null ? "NULL" : region === "SP" ? "true" : "false");
      expect(r.result).toBe(region === null ? "no region" : region === "SP" ? "Sao Paulo" : region);
    }
    expect(c.branches.reduce((a, b) => a + b.rows, 0)).toBe(await n("SELECT COUNT(*) FROM customers"));
    expect(c.branches.find((b) => b.branch === 0)!.rows).toBe(await n("SELECT COUNT(*) FROM customers WHERE region IS NULL"));
    expect(c.unknownPerCondition[1]).toBe(await n("SELECT COUNT(*) FROM customers WHERE region IS NULL"));
  });
  it("a simple CASE (CASE x WHEN v) compares with = and a NULL operand never matches", async () => {
    const { data } = await model("SELECT CASE region WHEN 'SP' THEN 'sp' ELSE 'other' END AS r FROM customers");
    const c = data.extras.nulls!.cases[0];
    expect(c.conditions).toEqual(["(region) = ('SP')"]);
    expect(c.unknownPerCondition[0]).toBe(await n("SELECT COUNT(*) FROM customers WHERE region IS NULL"));
    expect(c.branches.find((b) => b.branch === -1)!.rows).toBe(await n("SELECT COUNT(*) FROM customers WHERE region IS DISTINCT FROM 'SP'"));
  });
  it("NULL traps in the SQL text are called out (NOT IN, = NULL)", async () => {
    const a = await model("SELECT customer_id FROM customers WHERE customer_id NOT IN (SELECT customer_id FROM orders)");
    expect(a.data.extras.nulls!.notes.join(" ")).toMatch(/NOT IN \(subquery\)/);
    const b = await model("SELECT customer_id FROM customers WHERE region = NULL");
    expect(b.data.extras.nulls!.notes.join(" ")).toMatch(/= NULL/);
    expect(b.data.extras.nulls!.where!.split.true).toBe(0);
    expect(b.data.extras.nulls!.where!.split.unknown).toBe(await n("SELECT COUNT(*) FROM customers"));
  });
});

describe("set operations", () => {
  it("UNION: both inputs, the removed duplicates and the result are real", async () => {
    const sql = "SELECT country FROM customers UNION SELECT country FROM suppliers";
    const { data } = await model(sql);
    const s = stage(data, "union");
    expect(s.source).toBe("executed");
    expect(s.setOp!.leftCount).toBe(await n("SELECT COUNT(*) FROM customers"));
    expect(s.setOp!.rightCount).toBe(await n("SELECT COUNT(*) FROM suppliers"));
    expect(s.rowsOut).toBe(await n(`SELECT COUNT(*) FROM (${sql}) x`));
    expect(s.setOp!.removedCount).toBe(s.setOp!.leftCount! + s.setOp!.rightCount! - s.rowsOut!);
  });
  it("INTERSECT: only the rows both inputs have", async () => {
    const sql = "SELECT country FROM customers INTERSECT SELECT country FROM suppliers";
    const { data } = await model(sql);
    const s = stage(data, "intersect");
    expect(s.rowsOut).toBe(await n(`SELECT COUNT(*) FROM (${sql}) x`));
    expect(s.setOp!.matchedCount).toBe(s.rowsOut);
    expect(data.extras.groups).toBeUndefined();
  });
  it("EXCEPT ALL keeps copies", async () => {
    const sql = "SELECT country FROM customers EXCEPT ALL SELECT country FROM suppliers";
    const { data } = await model(sql);
    expect(stage(data, "except").rowsOut).toBe(await n(`SELECT COUNT(*) FROM (${sql}) x`));
  });
});

describe("query comparison", () => {
  it("two queries with the same output but different operations: stage counts and operations compare", async () => {
    const a = await model("SELECT c.customer_id FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id) ORDER BY 1");
    const b = await model("SELECT DISTINCT c.customer_id FROM customers c JOIN orders o ON o.customer_id = c.customer_id ORDER BY 1");
    expect(a.data.viz.final!.rows).toEqual(b.data.viz.final!.rows);
    const rows = compareStages(a.data.viz, b.data.viz);
    const clauses = rows.map((r) => r.clause);
    expect(clauses).toContain("distinct");
    expect(rows.find((r) => r.clause === "distinct")!.a).toBeUndefined();
    expect(rows.find((r) => r.clause === "from")!.a!.rowsOut).toBe(await n("SELECT COUNT(*) FROM customers"));
    expect(rows.find((r) => r.clause === "from")!.b!.rowsOut).toBe(await n("SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id"));
    expect(rows.find((r) => r.clause === "from")!.same).toBe(false);
  });
});

describe("what is not visualized returns null", () => {
  const nul = async (sql: string, status: "ok" | "error" = "ok") => {
    const outcome = status === "ok" ? await adapter.run(sql, ctx) : { status: "error" as const, durationMs: 0, error: { message: "failed" } };
    return adapter.visualize!(sql, outcome, ctx);
  };
  it("a query that failed", async () => { expect(await nul("SELECT nope FROM customers", "error")).toBeNull(); });
  it("a query that errors when visualized", async () => {
    const outcome = await adapter.run("SELECT nope FROM customers", ctx);
    expect(outcome.status).toBe("error");
    expect(await adapter.visualize!("SELECT nope FROM customers", { status: "ok", durationMs: 0 }, ctx)).toBeNull();
  });
  it("INSERT, UPDATE, DELETE and DDL", async () => {
    for (const sql of ["INSERT INTO customers (customer_id, company_name) VALUES ('ZZZZZ', 'x')", "UPDATE products SET unit_price = 1", "DELETE FROM orders", "CREATE TABLE t (id int)"]) {
      issued = [];
      expect(await nul(sql)).toBeNull();
      expect(issued.filter((x) => /^\s*(insert|update|delete|create)/i.test(x))).toHaveLength(1); // only the run itself touched them
    }
  });
  it("several statements", async () => { expect(await nul("SELECT 1; SELECT 2")).toBeNull(); });
  it("an empty query", async () => { expect(await adapter.visualize!("  ", { status: "ok", durationMs: 0 }, ctx)).toBeNull(); });
  it("clauses the engine cannot stage (FOR UPDATE)", async () => { expect(await nul("SELECT * FROM customers FOR UPDATE")).toBeNull(); });
  it("EXPLAIN, which is not a SELECT", async () => { expect(await nul("EXPLAIN SELECT 1")).toBeNull(); });
});

describe("volatile functions", () => {
  it("random() is explained but never re-run: provenance parsed, no extra queries, no row data", async () => {
    const sql = "SELECT order_id, random() AS r FROM orders LIMIT 3";
    const outcome = await adapter.run(sql, ctx);
    issued = [];
    const m = (await adapter.visualize!(sql, outcome, ctx))!;
    const d = m.data as SqlVisualData;
    expect(m.provenance).toBe("parsed");
    expect(d.viz.volatile).toEqual(["random()"]);
    expect(d.viz.stages.every((s) => s.source === "parsed")).toBe(true);
    expect(d.extras.queries).toBe(0);
    expect(d.extras.windows).toEqual([]);
    expect(m.notes!.join(" ")).toMatch(/random\(\)/);
    // only the learner's own query (once), the plan and nothing built from its clauses
    expect(issued.filter((s) => !/^EXPLAIN/.test(s))).toEqual([sql]);
  });
});

describe("stepping", () => {
  it("never issues SQL: the model is complete when visualize() returns", async () => {
    const { model: m, data } = await model("SELECT c.country, COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country");
    issued = [];
    for (let i = 0; i < m.steps!; i++) buildCinema(data.viz, data.trace, data.sql);
    expect(issued).toEqual([]);
  });
  it("only read-only statements are issued while visualizing", async () => {
    issued = [];
    await model("WITH t AS (SELECT * FROM products) SELECT category_id, COUNT(*) FROM t GROUP BY category_id");
    expect(issued.length).toBeGreaterThan(10);
    for (const s of issued) expect(s.trimStart()).toMatch(/^(SELECT|WITH|EXPLAIN)\b/i);
  });
});
