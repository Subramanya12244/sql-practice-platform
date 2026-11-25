// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Run, type Visualization } from "../site/lib/visualize";
import { traceRows, type RowTrace } from "../site/lib/visual/classic/rowTrace";
import { buildTeach, teachSteps } from "../site/lib/visual/classic/teach";
import type { TeachCard, TableSnapshot } from "../site/lib/visual/classic/contract";
import { findAggCalls } from "../site/lib/visual/classic/aggregate";
import { cteUseOrder, findSubqueries, parseCtes } from "../site/lib/visual/classic/relations";
import { sortKeys, tieRuns } from "../site/lib/visual/classic/order";
import { findWindowItems, parseWindowSpec } from "../site/lib/visual/classic/windows";

/**
 * The teaching cards of the SQL Practice visualizer, checked against the real database: every number and value a card shows must be what an
 * independent query returns, and the card must be correct with and without the row-level trace.
 */
let run: Run;
let calls: string[] = [];
beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  const db = pg as unknown as SqlDb;
  run = (sql) => { calls.push(sql); return execute(db, sql); };
}, 60_000);

interface Built { viz: Visualization; trace: RowTrace; cards: TeachCard[]; bare: TeachCard[]; by: (label: string) => TeachCard }
async function build(sql: string): Promise<Built> {
  const viz = await visualize(sql, run);
  const trace = await traceRows(sql, run, viz);
  const cards = teachSteps(viz, trace);
  const bare = teachSteps(viz, undefined);
  const by = (label: string) => { const k = cards.find((c) => c.label === label); if (!k) throw new Error(`no card ${label}: ${cards.map((c) => c.label).join(", ")}`); return k; };
  return { viz, trace, cards, bare, by };
}
const q = async (sql: string) => { const r = await run(sql); if (!r.success) throw new Error(r.message ?? "query failed"); return r.rows; };
const n1 = async (sql: string) => Number((await q(sql))[0][0]);
const table = (c: TeachCard, side: "inputs" | "outputs", pattern: RegExp): TableSnapshot => {
  const t = c[side].find((x) => pattern.test(x.title));
  if (!t) throw new Error(`no ${side} table ${pattern} in: ${c[side].map((x) => x.title).join(" | ")}`);
  return t;
};
const col = (t: TableSnapshot, name: string) => t.columns.indexOf(name);

describe("every operation: shape of a card", () => {
  it("each card names the logical step, never claims to be the physical plan, and has the four teaching answers", async () => {
    const b = await build("SELECT c.country, COUNT(*) AS n FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 GROUP BY c.country HAVING COUNT(*) > 5 ORDER BY n DESC LIMIT 3");
    expect(b.cards).toHaveLength(b.viz.stages.length);
    b.cards.forEach((c, i) => {
      expect(c.stageIndex).toBe(i);
      expect(c.operation).toMatch(new RegExp(`^Logical step ${i + 1} of ${b.cards.length}: `));
      for (const f of [c.what, c.changed, c.why, c.remember]) expect(f.length).toBeGreaterThan(10);
      expect(c.provenance).toBe("executed");
    });
    expect(b.by("FROM + JOIN").remember).toMatch(/Logical order/);
    expect(b.cards.map((c) => c.label)).toEqual(["FROM + JOIN", "WHERE", "GROUP BY", "HAVING", "COUNT", "ORDER BY", "LIMIT"]);
  });

  it("is pure: the same input gives the same card, and a missing trace never throws", async () => {
    for (const sql of [
      "SELECT * FROM customers WHERE country = 'Germany' ORDER BY customer_id LIMIT 3",
      "SELECT country, COUNT(*) FROM customers GROUP BY country HAVING COUNT(*) > 4",
      "SELECT customer_id, RANK() OVER (PARTITION BY country ORDER BY customer_id) FROM customers",
      "WITH g AS (SELECT * FROM customers) SELECT * FROM g WHERE customer_id IN (SELECT customer_id FROM orders)",
      "SELECT country FROM customers UNION SELECT country FROM suppliers",
      "SELECT DISTINCT country FROM customers",
    ]) {
      const b = await build(sql);
      expect(JSON.stringify(teachSteps(b.viz, b.trace))).toBe(JSON.stringify(b.cards));
      b.bare.forEach((c, i) => {
        if (["from", "where", "group by", "having", "select", "distinct"].includes(b.viz.stages[i].clause)) expect(c.rowsOut).toBe(b.viz.stages[i].rowsOut);
        expect(buildTeach(b.viz, undefined, i)).toEqual(c);
      });
    }
  });
});

describe("1 FROM", () => {
  it("shows the source table with its exact count and first rows", async () => {
    const b = await build("SELECT customer_id, company_name FROM customers");
    const c = b.by("FROM");
    const total = await n1("SELECT COUNT(*) FROM customers");
    const t = c.inputs[0];
    expect(t.total).toBe(total);
    expect(t.title).toContain(`${total} rows`);
    expect(t.rows).toEqual(await q("SELECT * FROM customers LIMIT 5"));
    expect(c.rowsOut).toBe(total);
    expect(c.what).toContain("FROM customers");
    expect(c.what).toContain(String(total));
    // without the trace the card still reports the exact count and the stage's rows
    const bare = b.bare[0];
    expect(bare.rowsOut).toBe(total);
    expect(bare.what).toContain(String(total));
    expect(bare.outputs[0].rows.length).toBe(20);
    expect(bare.notes.join()).toMatch(/still loading/);
  });
  it("no FROM: one row", async () => {
    const b = await build("SELECT 1 + 1 AS two");
    expect(b.cards[0].what).toMatch(/exactly once/);
    expect(b.cards[0].outputs[0].rows).toEqual([[2]]);
  });
  it("an implicit comma join is called a cross join with the exact product", async () => {
    const b = await build("SELECT * FROM shippers s, categories c");
    const c = b.cards[0];
    expect(c.what).toMatch(/3 × 8 = 24 rows/);
    expect(c.inputs.map((t) => t.total)).toEqual([3, 8]);
  });
});

describe("2 JOIN", () => {
  it("INNER JOIN: matching keys, pair count, dropped rows and fan-out, all equal to independent counts", async () => {
    const b = await build("SELECT * FROM customers c JOIN orders o ON o.customer_id = c.customer_id");
    const c = b.by("FROM + JOIN");
    const pairs = await n1("SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id");
    const noPartner = await n1("SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)");
    expect(noPartner).toBeGreaterThan(0);
    expect(c.what).toContain("o.customer_id = c.customer_id");
    expect(c.what).toContain(`${pairs} pairs match`);
    expect(c.what).toContain(`${noPartner} left rows found no partner and are dropped`);
    expect(c.what).toMatch(/fan-out/);
    expect(c.notes.join()).toMatch(/Fan-out/);
    expect(c.inputs.map((t) => t.total)).toEqual([await n1("SELECT COUNT(*) FROM customers"), await n1("SELECT COUNT(*) FROM orders")]);
    expect(c.rowsOut).toBe(pairs);
    const out = table(c, "outputs", /^result of the join/);
    expect(out.total).toBe(pairs);
    // every drawn pair really satisfies the ON condition
    const li = out.columns.indexOf("c.customer_id"), ri = out.columns.indexOf("o.customer_id");
    expect(li).toBeGreaterThanOrEqual(0);
    for (const r of out.rows) expect(r[li]).toBe(r[ri]);
    const dropped = table(c, "outputs", /^left rows with no partner/);
    expect(dropped.rows.length).toBeGreaterThan(0);
    expect(dropped.total).toBe(noPartner);
  });

  it("LEFT JOIN keeps unmatched rows with real NULLs (null cells, not text) and says what NULL means", async () => {
    const b = await build("SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id");
    const c = b.by("FROM + JOIN");
    const noPartner = await n1("SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)");
    const out = table(c, "outputs", /^result of the join/);
    const oi = out.columns.indexOf("o.order_id");
    const padded = out.rows.filter((r) => r[oi] === null);
    expect(padded.length).toBeGreaterThan(0);
    expect(padded.every((r) => r.slice(oi).every((v) => v === null))).toBe(true);
    expect(c.what).toContain(`${noPartner} left rows found no partner and stay with NULLs`);
    expect(c.notes.join()).toMatch(/NULL here means "no matching row"/);
    expect(c.outputs.some((t) => t.role === "removed")).toBe(false);
    expect(c.rowsOut).toBe(await n1("SELECT COUNT(*) FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id"));
  });

  it("RIGHT and FULL JOIN pad the left side", async () => {
    const r = await build("SELECT * FROM orders o RIGHT JOIN customers c ON o.customer_id = c.customer_id");
    expect(r.by("FROM + JOIN").what).toMatch(/right rows? found no partner and stay with NULLs for the left columns/);
    const f = await build("SELECT * FROM customers c FULL JOIN orders o ON o.customer_id = c.customer_id AND c.country = 'Germany'");
    expect(f.by("FROM + JOIN").what).toMatch(/left rows? found no partner and stay with NULLs/);
    expect(f.by("FROM + JOIN").what).toMatch(/right rows? found no partner and stay with NULLs/);
  });

  it("several joins: each join is a labelled sub-step with its own result table", async () => {
    const sql = "SELECT * FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN order_details od ON od.order_id = o.order_id";
    const b = await build(sql);
    const c = b.by("FROM + JOIN");
    expect(c.what).toContain("Join 1 of 2: JOIN orders o ON o.customer_id = c.customer_id");
    expect(c.what).toContain("Join 2 of 2: JOIN order_details od ON od.order_id = o.order_id");
    expect(c.outputs.filter((t) => /^result of join [12]/.test(t.title))).toHaveLength(2);
    const final = await n1("SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN order_details od ON od.order_id = o.order_id");
    expect(c.rowsOut).toBe(final);
    expect(table(c, "outputs", /^result of join 2/).total).toBe(final);
    expect(c.inputs.map((t) => t.total)).toEqual([91, 100, await n1("SELECT COUNT(*) FROM order_details")]);
  });

  it("CROSS JOIN reports the exact product", async () => {
    const b = await build("SELECT * FROM shippers s CROSS JOIN categories c");
    expect(b.by("FROM + JOIN").what).toMatch(/3 × 8 = 24 rows/);
  });
});

describe("3 WHERE", () => {
  it("true / false / NULL counts equal an independent query, with the verdict per drawn row", async () => {
    const sql = "SELECT order_id FROM orders WHERE shipped_date > DATE '1997-01-01'";
    const b = await build(sql);
    const c = b.by("WHERE");
    const t = await n1("SELECT COUNT(*) FROM orders WHERE shipped_date > DATE '1997-01-01'");
    const nulls = await n1("SELECT COUNT(*) FROM orders WHERE shipped_date IS NULL");
    const f = await n1("SELECT COUNT(*) FROM orders WHERE NOT (shipped_date > DATE '1997-01-01')");
    expect(nulls).toBeGreaterThan(0);
    expect(c.what).toContain(`${t} rows give true, ${f} give false, ${nulls} give NULL (unknown)`);
    expect(c.rowsIn).toBe(100);
    expect(c.rowsOut).toBe(t);
    expect(c.changed).toContain(`100 → ${t} rows: ${100 - t} rows removed (${f} false, ${nulls} NULL)`);
    const tested = table(c, "inputs", /^rows tested/);
    const vi = col(tested, "WHERE result");
    expect(tested.rows.every((r) => ["true", "false", "NULL"].includes(r[vi] as string))).toBe(true);
    const si = col(tested, "shipped_date");
    for (const r of tested.rows) expect(r[vi]).toBe(r[si] === null ? "NULL" : new Date(r[si] as string) > new Date("1997-01-01") ? "true" : "false");
    const removed = table(c, "outputs", /^removed/);
    expect(removed.total).toBe(100 - t);
    expect(removed.rows.some((r) => r[vi] === "NULL")).toBe(true);
    expect(c.notes.join()).toMatch(/evaluate to NULL \(unknown\), not true/);
    // NULL cells stay real nulls in the removed rows
    expect(removed.rows.some((r) => r[si] === null)).toBe(true);
  });

  it("without a NULL anywhere, no NULL note is invented", async () => {
    const b = await build("SELECT customer_id FROM customers WHERE country = 'Germany'");
    const c = b.by("WHERE");
    expect(c.notes.join()).not.toMatch(/NULL/);
    expect(c.what).toContain("11 rows give true, 80 give false");
    expect(c.rowsOut).toBe(11);
  });

  it("without the trace: kept and removed rows come from the stage", async () => {
    const b = await build("SELECT customer_id FROM customers WHERE country = 'Germany'");
    const bare = b.bare[1];
    expect(bare.rowsOut).toBe(11);
    expect(bare.outputs[0].rows).toHaveLength(11);
    expect(bare.outputs[0].rows.every((r) => r[col(bare.outputs[0], "country")] === "Germany")).toBe(true);
    expect(bare.outputs.some((t) => t.role === "removed" && t.rows.length > 0)).toBe(true);
  });

  it("flags = NULL as never true", async () => {
    const b = await build("SELECT * FROM orders WHERE shipped_date = NULL");
    const c = b.by("WHERE");
    expect(c.rowsOut).toBe(0);
    expect(c.notes.join()).toMatch(/never true/);
  });

  it("an empty result is stated, not hidden", async () => {
    const b = await build("SELECT * FROM customers WHERE country = 'Atlantis'");
    const c = b.by("WHERE");
    expect(c.rowsOut).toBe(0);
    expect(c.changed).toContain("91 → 0 rows");
    expect(c.outputs[0].rows).toEqual([]);
    expect(c.what).toContain("0 rows give true, 91 give false");
  });
});

describe("4 GROUP BY and 12 NULL grouping", () => {
  it("group sizes equal an independent GROUP BY, and members are listed with their key", async () => {
    const b = await build("SELECT country, COUNT(*) FROM customers GROUP BY country");
    const c = b.by("GROUP BY");
    const truth = await q("SELECT country, COUNT(*) FROM customers GROUP BY country");
    expect(c.rowsOut).toBe(truth.length);
    expect(c.rowsIn).toBe(91);
    const out = c.outputs[0];
    for (const r of out.rows) expect(Number(r[1])).toBe(Number(truth.find((t) => t[0] === r[0])![1]));
    expect(c.what).toContain(`${truth.length} groups`);
    const largest = [...truth].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    expect(Number(out.rows[0][1])).toBe(Number(largest[1]));
    expect(c.inputs[0].rows.length).toBeGreaterThan(0);
    expect(c.inputs[0].columns[0]).toBe("key: country");
    expect(c.notes.join()).toMatch(/Only the 20 largest of 21 groups/);
  });

  it("NULL keys form one group and the card says so", async () => {
    const b = await build("SELECT region, COUNT(*) FROM customers GROUP BY region");
    const c = b.by("GROUP BY");
    const nulls = await n1("SELECT COUNT(*) FROM customers WHERE region IS NULL");
    expect(nulls).toBeGreaterThan(1);
    const row = c.outputs[0].rows.find((r) => r[0] === null);
    expect(row).toBeTruthy();
    expect(Number(row![1])).toBe(nulls);
    expect(c.notes.join()).toContain(`${nulls} rows whose region is NULL form one group`);
  });

  it("no GROUP BY: one group, and over zero rows COUNT is 0 and SUM is NULL", async () => {
    const b = await build("SELECT COUNT(*) AS n, SUM(freight) AS f FROM orders WHERE 1 = 0");
    const g = b.by("ONE GROUP");
    expect(g.rowsOut).toBe(1);
    expect(g.notes.join()).toMatch(/SUM, AVG, MIN and MAX are NULL, COUNT is 0/);
    const sel = b.cards[b.cards.length - 1];
    expect(sel.outputs[0].rows).toEqual([[0, null]]);
  });
});

describe("5 aggregation", () => {
  it("SUM per group: totals, group sizes and contributing values equal independent queries", async () => {
    const sql = "SELECT ship_country, SUM(freight) AS total FROM orders GROUP BY ship_country";
    const b = await build(sql);
    const c = b.by("SUM");
    expect(c.kind).toBe("aggregate");
    const truth = await q("SELECT ship_country, SUM(freight)::text, COUNT(*) FROM orders GROUP BY ship_country ORDER BY ship_country LIMIT 3");
    expect(c.inputs).toHaveLength(3);
    c.inputs.forEach((t, i) => {
      expect(t.total).toBe(Number(truth[i][2]));
      expect(t.title).toContain(`SUM = ${truth[i][1]}`);
      const vi = col(t, "value of freight");
      const values = t.rows.map((r) => Number(r[vi]));
      expect(values.length).toBe(Math.min(5, Number(truth[i][2])));
    });
    // the contributing values of the first group are real rows of that group
    const first = c.inputs[0];
    const real = (await q(`SELECT freight::text FROM orders WHERE ship_country = '${truth[0][0]}'`)).map((r) => r[0]);
    for (const r of first.rows) expect(real).toContain(r[col(first, "value of freight")]);
    expect(c.what).toContain("SUM(freight) adds the");
    expect(c.outputs[0].total).toBe(await n1("SELECT COUNT(DISTINCT ship_country) FROM orders"));
    // running total is the SUM of the drawn values so far, from the database
    const run1 = first.rows.map((r) => Number(r[col(first, "running SUM")]));
    const vals = first.rows.map((r) => Number(r[col(first, "value of freight")]));
    run1.forEach((v, i) => expect(v).toBeCloseTo(vals.slice(0, i + 1).reduce((s, x) => s + x, 0), 2));
  });

  it("line-level values for SUM(unit_price*quantity*(1-discount)) and the ROUND step", async () => {
    const sql = "SELECT od.order_id, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue FROM order_details od GROUP BY od.order_id";
    const b = await build(sql);
    const c = b.by("SUM");
    const truth = await q("SELECT order_id, SUM(unit_price * quantity * (1 - discount))::text, ROUND(SUM(unit_price * quantity * (1 - discount))::numeric, 2)::text, COUNT(*) FROM order_details GROUP BY order_id ORDER BY order_id LIMIT 3");
    expect(c.what).toMatch(/Each row first contributes od\.unit_price \* od\.quantity \* \(1 - od\.discount\), e\.g\. \S+ \* \S+ \* \(1 - \S+\) = \S+/);
    c.inputs.forEach((t, i) => {
      expect(t.title).toContain(`SUM = ${truth[i][1]}`);
      const vi = t.columns.findIndex((x) => x.startsWith("value of od.unit_price"));
      expect(vi).toBeGreaterThan(0);
      const [ui, qi, di] = ["unit_price", "quantity", "discount"].map((n) => t.columns.indexOf(n));
      for (const r of t.rows) {
        expect(Number(r[vi])).toBeCloseTo(Number(r[ui]) * Number(r[qi]) * (1 - Number(r[di])), 3);
      }
    });
    expect(c.changed).toContain(`${truth[0][1]} → ${truth[0][2]}`);
    expect(c.changed).toMatch(/rounds it to 2 decimal places/);
    const frame = b.trace.frames[b.viz.stages.findIndex((s) => s.clause === "select")]!;
    expect(frame.variants?.map((v) => v.label)).toEqual([expect.stringMatching(/^CALC: /), "SUM per group", "ROUND of the result", "Output rows"]);
  });

  it("COUNT(col) vs COUNT(*), and SUM/AVG/MIN/MAX ignore NULL: said only where the data has NULLs", async () => {
    const b = await build("SELECT ship_country, COUNT(*) AS n, COUNT(shipped_date) AS shipped, MIN(shipped_date) AS first_ship FROM orders GROUP BY ship_country");
    const c = b.by("COUNT + MIN");
    const truth = await q("SELECT ship_country, COUNT(*), COUNT(shipped_date) FROM orders GROUP BY ship_country ORDER BY ship_country LIMIT 3");
    const differ = truth.filter((t) => Number(t[1]) !== Number(t[2]));
    expect(differ.length).toBeGreaterThan(0);
    const d = differ[0];
    expect(c.notes.join()).toContain(`In group ${d[0]}`);
    expect(c.notes.join()).toContain(`it used ${d[2]} of ${d[1]} rows`);
    expect(c.notes.join()).toContain(`COUNT(shipped_date) is ${d[2]} while COUNT(*) would be ${d[1]}`);
    expect(c.notes.join()).toMatch(/shown as NULL and marked ignored/);
    const t = c.inputs.find((x) => x.title.startsWith(`group ${d[0]} `))!;
    expect(t.rows.some((r) => r[col(t, "value of shipped_date")] === null)).toBe(true);

    const clean = await build("SELECT country, COUNT(*) AS n FROM customers GROUP BY country");
    expect(clean.by("COUNT").notes.join()).not.toMatch(/ignores|ignored/);
  });

  it("AVG, MIN and MAX results are the database's own", async () => {
    const b = await build("SELECT ship_country, AVG(freight) AS a, MAX(freight) AS m FROM orders GROUP BY ship_country");
    const c = b.by("AVG + MAX");
    const t = await q("SELECT ship_country, AVG(freight)::text, MAX(freight)::text FROM orders GROUP BY ship_country ORDER BY ship_country LIMIT 1");
    expect(c.what).toContain(`AVG(freight) adds the non-NULL values and divides by how many there are`);
    expect(c.what).toContain(`: ${t[0][1]}.`);
    expect(c.what).toContain(`MAX(freight) is the largest of the`);
    expect(c.what).toContain(`: ${t[0][2]}.`);
  });

  it("aggregate without GROUP BY works on the whole table", async () => {
    const b = await build("SELECT COUNT(*) AS n, AVG(freight) AS a FROM orders");
    const g = b.by("ONE GROUP");
    expect(g.rowsIn).toBe(100);
    const c = b.cards[b.cards.length - 1];
    expect(c.kind).toBe("aggregate");
    expect(c.inputs[0].total).toBe(100);
    expect(c.outputs[0].rows[0][0]).toBe(100);
  });
});

describe("6 HAVING", () => {
  it("verdict per group and exact outcome counts equal an independent query", async () => {
    const b = await build("SELECT country, COUNT(*) AS n FROM customers GROUP BY country HAVING COUNT(*) > 5");
    const c = b.by("HAVING");
    const groups = await q("SELECT country, COUNT(*) FROM customers GROUP BY country");
    const keep = groups.filter((g) => Number(g[1]) > 5);
    expect(c.rowsIn).toBe(groups.length);
    expect(c.rowsOut).toBe(keep.length);
    expect(c.what).toContain(`${keep.length} groups give true, ${groups.length - keep.length} give false`);
    const tested = table(c, "inputs", /^groups tested/);
    const vi = col(tested, "HAVING result"), ci = col(tested, "COUNT(*)");
    for (const r of tested.rows) expect(r[vi]).toBe(Number(r[ci]) > 5 ? "true" : "false");
    for (const r of table(c, "outputs", /^groups kept/).rows) expect(Number(r[ci])).toBeGreaterThan(5);
    for (const r of table(c, "outputs", /^groups removed/).rows) expect(Number(r[ci])).toBeLessThanOrEqual(5);
    expect(c.what).toMatch(/Group \w+: COUNT\(\*\) = \d+ gives (true|false)/);
  });
});

describe("7 ORDER BY", () => {
  it("before/after positions are a permutation and the after order is sorted", async () => {
    const b = await build("SELECT product_name, unit_price FROM products ORDER BY unit_price DESC");
    const c = b.by("ORDER BY");
    const out = c.outputs[0];
    const wi = col(out, "was"), pi = col(out, "unit_price");
    expect(out.rows.map((r) => r[0])).toEqual(out.rows.map((_, i) => i + 1));
    const was = out.rows.map((r) => Number(r[wi]));
    expect(new Set(was).size).toBe(was.length);
    expect(was.every((v) => v >= 1 && v <= 77)).toBe(true);
    expect(was.some((v, i) => v !== i + 1)).toBe(true);
    const prices = out.rows.map((r) => Number(r[pi]));
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    const top = await q("SELECT unit_price FROM products ORDER BY unit_price DESC LIMIT 20");
    expect(prices).toEqual(top.map((r) => Number(r[0])));
    expect(c.what).toContain("by unit_price descending");
    expect(c.rowsIn).toBe(77);
    expect(c.inputs[0].rows.map((r) => Number(r[0]))).toEqual([...c.inputs[0].rows.map((r) => Number(r[0]))].sort((a, b) => a - b));
  });

  it("ties are named with their key value", async () => {
    const b = await build("SELECT order_id, ship_country FROM orders ORDER BY ship_country");
    const c = b.by("ORDER BY");
    expect(c.notes.join()).toMatch(/Ties: rows 1–\d+ have the same ship_country \(\w+\)/);
    expect(c.notes.join()).toMatch(/tie-breaker/);
  });

  it("NULL placement: default (last for ASC), explicit NULLS FIRST, and the exact NULL count", async () => {
    const nulls = await n1("SELECT COUNT(*) FROM orders WHERE shipped_date IS NULL");
    const asc = await build("SELECT order_id, shipped_date FROM orders ORDER BY shipped_date");
    expect(asc.by("ORDER BY").notes.join()).toContain(`${nulls} rows have NULL in shipped_date: NULLs sort last (PostgreSQL's default for ASC)`);
    const first = await build("SELECT order_id, shipped_date FROM orders ORDER BY shipped_date NULLS FIRST");
    const c = first.by("ORDER BY");
    expect(c.notes.join()).toContain(`NULLs sort first (you wrote NULLS FIRST)`);
    expect(c.outputs[0].rows[0][col(c.outputs[0], "shipped_date")]).toBeNull();
    const desc = await build("SELECT order_id, shipped_date FROM orders ORDER BY shipped_date DESC");
    expect(desc.by("ORDER BY").notes.join()).toContain("NULLs sort first (PostgreSQL's default for DESC)");
    const none = await build("SELECT customer_id FROM customers ORDER BY customer_id");
    expect(none.by("ORDER BY").notes.join()).not.toMatch(/NULL/);
  });

  it("an ORDER BY on an output alias and on a column position reads the same keys", async () => {
    const a = await build("SELECT country, COUNT(*) AS n FROM customers GROUP BY country ORDER BY n DESC, country");
    const c = a.by("ORDER BY");
    expect(c.what).toContain("by n descending, then by country ascending");
    const rows = c.outputs[0].rows.map((r) => Number(r[c.outputs[0].columns.indexOf("n")]));
    expect(rows).toEqual([...rows].sort((x, y) => y - x));
    const pos = await build("SELECT customer_id, country FROM customers ORDER BY 2, 1");
    expect(sortKeys("2, 1", "customer_id, country").map((k) => k.expr)).toEqual(["country", "customer_id"]);
    expect(pos.by("ORDER BY").outputs[0].rows[0][col(pos.by("ORDER BY").outputs[0], "country")]).toBe("Argentina");
  });
});

describe("8 LIMIT and OFFSET", () => {
  it("skipped, kept and cut counts are exact, and the kept rows are the real result", async () => {
    const b = await build("SELECT order_id FROM orders ORDER BY order_id LIMIT 5 OFFSET 10");
    const c = b.by("LIMIT");
    const total = await n1("SELECT COUNT(*) FROM orders");
    expect(c.rowsIn).toBe(total);
    expect(c.rowsOut).toBe(5);
    expect(c.what).toContain(`of ${total} rows, 10 rows are skipped by OFFSET, 5 rows are kept and ${total - 15} rows are cut off`);
    expect(c.changed).toContain(`${total} → 5 rows (10 skipped + ${total - 15} cut)`);
    const kept = table(c, "outputs", /^kept/);
    expect(kept.rows).toEqual(await q("SELECT order_id FROM orders ORDER BY order_id LIMIT 5 OFFSET 10"));
    const skipped = table(c, "outputs", /^skipped by OFFSET 10/);
    expect(skipped.rows).toEqual(await q("SELECT order_id FROM orders ORDER BY order_id LIMIT 10"));
    expect(skipped.total).toBe(10);
    const cut = table(c, "outputs", /^cut by LIMIT/);
    expect(cut.total).toBe(total - 15);
    expect(cut.rows[0]).toEqual((await q("SELECT order_id FROM orders ORDER BY order_id LIMIT 1 OFFSET 15"))[0]);
    expect(c.notes.join()).not.toMatch(/no ORDER BY/);
  });

  it("without the trace the kept rows are already the real result", async () => {
    const b = await build("SELECT order_id FROM orders ORDER BY order_id LIMIT 3");
    const bare = b.bare[b.bare.length - 1];
    expect(bare.provenance).toBe("executed");
    expect(bare.outputs[0].rows).toEqual(await q("SELECT order_id FROM orders ORDER BY order_id LIMIT 3"));
    expect(bare.rowsOut).toBe(3);
  });

  it("LIMIT without ORDER BY warns that the rows are not defined; a LIMIT larger than the table says so", async () => {
    const b = await build("SELECT * FROM shippers LIMIT 10");
    const c = b.by("LIMIT");
    expect(c.notes.join()).toMatch(/no ORDER BY/);
    expect(c.notes.join()).toMatch(/Fewer rows exist than the LIMIT asks for: only 3 rows remain/);
    expect(c.what).toContain("3 rows are kept and 0 rows are cut off");
  });
});

describe("9 subqueries", () => {
  it("scalar subquery: its real value is an input of the WHERE step", async () => {
    const b = await build("SELECT order_id FROM orders WHERE freight > (SELECT AVG(freight) FROM orders)");
    const c = b.by("WHERE");
    const avg = (await q("SELECT AVG(freight)::text FROM orders"))[0][0];
    const t = table(c, "inputs", /^scalar subquery result/);
    expect(String(t.rows[0][0])).toBe(avg);
    expect(c.what).toContain(`returned one value: ${avg}`);
    expect(c.rowsOut).toBe(await n1("SELECT COUNT(*) FROM orders WHERE freight > (SELECT AVG(freight) FROM orders)"));
  });
  it("IN subquery: the list of values and its exact size", async () => {
    const b = await build("SELECT customer_id FROM customers WHERE customer_id IN (SELECT customer_id FROM orders WHERE freight > 100)");
    const c = b.by("WHERE");
    const t = table(c, "inputs", /^IN subquery result/);
    expect(t.total).toBe(await n1("SELECT COUNT(*) FROM orders WHERE freight > 100"));
    expect(t.rows.map((r) => r[0])).toEqual((await q("SELECT customer_id FROM orders WHERE freight > 100 LIMIT 20")).map((r) => r[0]));
    expect(c.what).toMatch(/returned \d+ values/);
  });
  it("NOT IN with a NULL in the list never passes: the trap is named", async () => {
    const b = await build("SELECT customer_id FROM customers WHERE customer_id NOT IN (SELECT NULLIF(customer_id, 'ALFKI') FROM orders)");
    const c = b.by("WHERE");
    expect(c.rowsOut).toBe(0);
    expect(c.notes.join()).toMatch(/NOT IN can never be true/);
  });
  it("correlated EXISTS: says it has no result of its own instead of inventing one", async () => {
    const b = await build("SELECT c.customer_id FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)");
    const c = b.by("WHERE");
    expect(c.notes.join()).toMatch(/correlated subquery/);
    expect(c.rowsOut).toBe(await n1("SELECT COUNT(*) FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)"));
  });
  it("uncorrelated EXISTS and a derived table", async () => {
    const b = await build("SELECT t.country FROM (SELECT country, COUNT(*) AS n FROM customers GROUP BY country) t WHERE EXISTS (SELECT 1 FROM shippers)");
    const f = b.by("FROM");
    expect(f.inputs[0].total).toBe(await n1("SELECT COUNT(DISTINCT country) FROM customers"));
    expect(f.inputs[0].title).toContain("(SELECT country, COUNT(*)");
    expect(b.by("WHERE").what).toMatch(/EXISTS is true/);
  });
});

describe("10 CTEs", () => {
  it("each CTE's real relation, in the order it is used, with exact counts", async () => {
    const sql = `WITH big AS (SELECT * FROM orders WHERE freight > 50),
      by_cust AS (SELECT customer_id, COUNT(*) AS n FROM big GROUP BY customer_id),
      unused AS (SELECT 1 AS x)
      SELECT * FROM by_cust ORDER BY n DESC`;
    const b = await build(sql);
    const c = b.by("FROM");
    const titles = c.inputs.map((t) => t.title);
    expect(titles[0]).toMatch(/^CTE big · /);
    expect(titles[1]).toMatch(/^CTE by_cust · /);
    expect(c.inputs[0].total).toBe(await n1("SELECT COUNT(*) FROM orders WHERE freight > 50"));
    expect(c.inputs[1].total).toBe(await n1("SELECT COUNT(DISTINCT customer_id) FROM orders WHERE freight > 50"));
    expect(c.what).toContain("CTE by_cust is read here");
    expect(c.notes.join()).toMatch(/CTE unused is defined but nothing reads it/);
    expect(c.rowsOut).toBe(c.inputs[1].total);
  });
  it("parsing: names, column lists, order of use", () => {
    const defs = parseCtes("WITH RECURSIVE a(x, y) AS (SELECT 1, 2), \"B b\" AS NOT MATERIALIZED (SELECT * FROM a)");
    expect(defs.map((d) => d.name)).toEqual(["a", '"B b"']);
    expect(defs[0].columnList).toEqual(["x", "y"]);
    const { used, unused } = cteUseOrder(parseCtes("WITH a AS (SELECT 1), b AS (SELECT * FROM a), c AS (SELECT 2) SELECT * FROM b"), { from: "b" });
    expect(used.map((u) => u.def.name)).toEqual(["a", "b"]);
    expect(unused.map((u) => u.name)).toEqual(["c"]);
  });
});

describe("11 window functions", () => {
  it("partition membership, rank values and sizes equal an independent window query", async () => {
    const sql = "SELECT customer_id, country, RANK() OVER (PARTITION BY country ORDER BY customer_id DESC) AS r FROM customers";
    const b = await build(sql);
    const c = b.by("WINDOW");
    const out = c.outputs[0];
    const truth = new Map((await q("SELECT customer_id, RANK() OVER (PARTITION BY country ORDER BY customer_id DESC)::text, COUNT(*) OVER (PARTITION BY country)::text FROM customers")).map((r) => [r[0], [r[1], r[2]]]));
    expect(out.rows.length).toBeGreaterThan(0);
    const ci = col(out, "country"), idi = col(out, "customer_id"), ri = col(out, "r"), si = col(out, "rows in partition");
    for (const r of out.rows) {
      const t = truth.get(r[idi])!;
      expect(String(r[ri])).toBe(t[0]);
      expect(String(r[si])).toBe(t[1]);
      expect(r[ci]).toBeTruthy();
    }
    expect(c.rowsIn).toBe(91);
    expect(c.what).toContain("21 partitions by country");
    expect(c.changed).toContain("91 rows stay 91 rows");
    const frame = b.trace.frames[b.viz.stages.findIndex((s) => s.clause === "window")]!;
    expect(frame.kind).toBe("window");
    expect(frame.board!.cards.filter((x) => x.id.startsWith("win:")).every((x) => x.after && x.group !== undefined)).toBe(true);
  });
  it("ties in a rank are named; ROW_NUMBER breaks them arbitrarily", async () => {
    const b = await build("SELECT order_id, ship_country, RANK() OVER (PARTITION BY ship_country ORDER BY ship_via) AS r FROM orders");
    const c = b.by("WINDOW");
    expect(c.notes.join()).toMatch(/Ties: \d+ rows have the same ship_via/);
    expect(c.notes.join()).toMatch(/RANK gives them the same value and then skips numbers/);
    const rn = await build("SELECT order_id, ship_country, ROW_NUMBER() OVER (PARTITION BY ship_country ORDER BY ship_via) AS r FROM orders");
    expect(rn.by("WINDOW").notes.join()).toMatch(/ROW_NUMBER still gives them different numbers/);
  });
  it("a running SUM over the window order", async () => {
    const b = await build("SELECT order_id, freight, SUM(freight) OVER (ORDER BY order_id) AS running FROM orders");
    const out = b.by("WINDOW").outputs[0];
    const truth = await q("SELECT order_id, SUM(freight) OVER (ORDER BY order_id) FROM orders ORDER BY order_id LIMIT 6");
    expect(out.rows.map((r) => Number(r[col(out, "running")]))).toEqual(truth.map((r) => Number(r[1])));
  });
  it("parsing the OVER clause", () => {
    const [w] = findWindowItems("customer_id, RANK() OVER (PARTITION BY country, city ORDER BY n DESC ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS r");
    expect(w.fn).toBe("rank");
    expect(w.partition).toEqual(["country", "city"]);
    expect(w.order).toEqual(["n DESC"]);
    expect(w.frame).toMatch(/^ROWS BETWEEN/);
    expect(w.alias).toBe("r");
    expect(parseWindowSpec("ORDER BY a, b")).toEqual({ partition: [], order: ["a", "b"], frame: undefined });
    expect(findWindowItems("SUM(x) OVER w", "w AS (PARTITION BY k)")[0].partition).toEqual(["k"]);
  });
});

describe("12 NULL handling reaches the tables as real nulls", () => {
  it("snapshots keep null (not the text NULL) so the UI can show it as NULL", async () => {
    const b = await build("SELECT customer_id, contact_title, region FROM customers WHERE region IS NULL");
    const f = b.by("FROM");
    expect(f.inputs[0].rows.some((r) => r.includes(null))).toBe(true);
    expect(JSON.stringify(f.inputs[0].rows)).not.toContain('"NULL"');
    const s = b.by("SELECT");
    expect(s.notes.join()).toMatch(/NULL in .* means the value is missing/);
  });
});

describe("rows in and rows out: every card takes what the previous step passed on", () => {
  /** Each card's rowsIn equals the previous card's rowsOut (exact), with and without the trace. */
  const chain = (cards: TeachCard[], viz: Visualization) => cards.forEach((c, i) => {
    if (i === 0 || viz.stages[i].setOp) return;
    const prev = cards[i - 1].rowsOut;
    if (prev !== undefined) expect(c.rowsIn, `${c.label} (step ${i + 1})`).toBe(prev);
  });
  const both = async (sql: string) => { const b = await build(sql); chain(b.cards, b.viz); chain(b.bare, b.viz); return b; };

  it("WHERE then GROUP BY", async () => {
    const b = await both("SELECT country, COUNT(*) AS n FROM customers WHERE country <> 'Germany' GROUP BY country");
    const kept = await n1("SELECT COUNT(*) FROM customers WHERE country <> 'Germany'");
    const groups = await n1("SELECT COUNT(DISTINCT country) FROM customers WHERE country <> 'Germany'");
    expect([b.by("WHERE").rowsIn, b.by("WHERE").rowsOut]).toEqual([91, kept]);
    expect([b.by("GROUP BY").rowsIn, b.by("GROUP BY").rowsOut]).toEqual([kept, groups]);
    expect(b.by("COUNT").rowsIn).toBe(groups);
    expect(b.by("COUNT").changed).toContain(`${groups} groups → ${groups} output rows`);
  });

  it("GROUP BY + HAVING: the aggregate step takes the groups HAVING kept, not the rows that entered GROUP BY", async () => {
    const sql = "SELECT country, COUNT(*) AS n FROM customers GROUP BY country HAVING COUNT(*) > 5";
    const b = await both(sql);
    const all = await n1("SELECT COUNT(*) FROM (SELECT country FROM customers GROUP BY country) t");
    const kept = await n1("SELECT COUNT(*) FROM (SELECT country FROM customers GROUP BY country HAVING COUNT(*) > 5) t");
    expect(kept).toBeLessThan(all);
    const h = b.by("HAVING"), a = b.by("COUNT");
    expect([h.rowsIn, h.rowsOut]).toEqual([all, kept]);
    expect(h.changed).toContain(`${all} → ${kept} groups`);
    expect(a.rowsIn).toBe(kept);
    expect(a.rowsIn).not.toBe(91);
    expect(a.rowsOut).toBe(kept);
    expect(a.changed).toContain(`${kept} groups → ${kept} output rows`);
    expect(a.what).toContain(`Each of the ${kept} groups`);
    expect(b.by("GROUP BY").rowsIn).toBe(91);
  });

  it("GROUP BY + HAVING + ORDER BY + LIMIT", async () => {
    const b = await both("SELECT country, COUNT(*) AS n FROM customers GROUP BY country HAVING COUNT(*) > 2 ORDER BY n DESC, country LIMIT 4 OFFSET 1");
    const kept = await n1("SELECT COUNT(*) FROM (SELECT country FROM customers GROUP BY country HAVING COUNT(*) > 2) t");
    expect(b.by("ORDER BY").rowsIn).toBe(kept);
    expect(b.by("ORDER BY").rowsOut).toBe(kept);
    const l = b.by("LIMIT");
    expect([l.rowsIn, l.rowsOut]).toEqual([kept, Math.min(4, kept - 1)]);
    expect(l.changed).toContain(`${kept} → ${Math.min(4, kept - 1)} rows`);
  });

  it("DISTINCT + ORDER BY", async () => {
    const b = await both("SELECT DISTINCT country FROM customers ORDER BY country");
    const d = await n1("SELECT COUNT(DISTINCT country) FROM customers");
    expect([b.by("DISTINCT").rowsIn, b.by("DISTINCT").rowsOut]).toEqual([91, d]);
    expect([b.by("ORDER BY").rowsIn, b.by("ORDER BY").rowsOut]).toEqual([d, d]);
  });

  it("JOIN + WHERE + aggregate", async () => {
    const sql = "SELECT c.country, SUM(o.freight) AS f FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 30 GROUP BY c.country";
    const b = await both(sql);
    const joined = await n1("SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id");
    const kept = await n1("SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 30");
    const groups = await n1("SELECT COUNT(DISTINCT c.country) FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 30");
    expect(b.by("FROM + JOIN").rowsOut).toBe(joined);
    expect([b.by("WHERE").rowsIn, b.by("WHERE").rowsOut]).toEqual([joined, kept]);
    expect([b.by("GROUP BY").rowsIn, b.by("GROUP BY").rowsOut]).toEqual([kept, groups]);
    expect(b.by("SUM").rowsIn).toBe(groups);
    expect(b.by("SUM").rowsOut).toBe(groups);
  });

  it("window", async () => {
    const b = await both("SELECT customer_id, RANK() OVER (PARTITION BY country ORDER BY customer_id) AS r FROM customers WHERE country <> 'Germany' ORDER BY customer_id LIMIT 7");
    const kept = await n1("SELECT COUNT(*) FROM customers WHERE country <> 'Germany'");
    expect([b.by("WINDOW").rowsIn, b.by("WINDOW").rowsOut]).toEqual([kept, kept]);
    expect(b.by("SELECT").rowsIn).toBe(kept);
    expect(b.by("ORDER BY").rowsIn).toBe(kept);
    expect(b.by("LIMIT").rowsIn).toBe(kept);
    expect(b.by("LIMIT").rowsOut).toBe(7);
  });

  it("CTE", async () => {
    const b = await both("WITH big AS (SELECT * FROM orders WHERE freight > 50) SELECT order_id FROM big WHERE order_id > 10300 ORDER BY order_id");
    const cte = await n1("SELECT COUNT(*) FROM orders WHERE freight > 50");
    const kept = await n1("SELECT COUNT(*) FROM orders WHERE freight > 50 AND order_id > 10300");
    expect(b.by("FROM").rowsOut).toBe(cte);
    expect([b.by("WHERE").rowsIn, b.by("WHERE").rowsOut]).toEqual([cte, kept]);
    expect(b.by("SELECT").rowsIn).toBe(kept);
    expect(b.by("ORDER BY").rowsIn).toBe(kept);
  });

  it("subquery", async () => {
    const b = await both("SELECT customer_id FROM customers WHERE customer_id IN (SELECT customer_id FROM orders WHERE freight > 100) ORDER BY customer_id");
    const kept = await n1("SELECT COUNT(*) FROM customers WHERE customer_id IN (SELECT customer_id FROM orders WHERE freight > 100)");
    expect([b.by("WHERE").rowsIn, b.by("WHERE").rowsOut]).toEqual([91, kept]);
    expect(b.by("SELECT").rowsIn).toBe(kept);
    expect(b.by("ORDER BY").rowsIn).toBe(kept);
  });

  it("an aggregate without GROUP BY: one group in, one row out", async () => {
    const b = await both("SELECT COUNT(*) AS n FROM orders WHERE freight > 30");
    expect(b.by("ONE GROUP").rowsOut).toBe(1);
    expect(b.cards[b.cards.length - 1].rowsIn).toBe(1);
    expect(b.cards[b.cards.length - 1].changed).toContain("1 group → 1 output row");
  });
});

describe("errors, invalid SQL and volatile queries", () => {
  it("an error stage carries the learner's real message, parsed provenance and a note that later steps could not run", async () => {
    const sql = "SELECT nonexistent_column FROM customers WHERE country = 'Germany'";
    const viz = await visualize(sql, run);
    const real = (await run(sql)).message!;
    const trace = await traceRows(sql, run, viz);
    const cards = teachSteps(viz, trace);
    const err = cards[cards.length - 1];
    expect(err.what).toContain(real);
    expect(err.notes[0]).toContain(real);
    expect(err.provenance).toBe("parsed");
    expect(err.operation).toMatch(/Your query failed/);
    expect(err.notes.join()).toMatch(/no result exists/);
    expect(err.label).toBe("SELECT");
    expect(buildTeach(viz, undefined, cards.length - 1)).toEqual(err);
  });
  it("garbage and unsupported SQL never throw", async () => {
    for (const sql of ["SELEC * FROM", "SELECT * FROM nope", "DELETE FROM orders", "", "SELECT 1; SELECT 2"]) {
      const viz = await visualize(sql, run);
      const trace = await traceRows(sql, run, viz);
      expect(() => teachSteps(viz, trace)).not.toThrow();
      expect(() => teachSteps(viz, undefined)).not.toThrow();
    }
    const viz = await visualize("SELECT * FROM nope", run);
    const cards = teachSteps(viz, undefined);
    expect(cards.some((c) => /does not exist|nope/.test(c.what + c.notes.join()))).toBe(true);
  });
  it("a failing step in the middle is named and its error is real", async () => {
    const viz = await visualize("SELECT * FROM customers WHERE bogus = 1", run);
    const w = teachSteps(viz, undefined).find((c) => c.label === "WHERE")!;
    expect(w.provenance).toBe("parsed");
    expect(w.notes.join()).toMatch(/bogus/);
    expect(w.notes.join()).toMatch(/steps that depend on it/);
  });
  it("volatile functions: nothing is re-run and the card says it is explained from the text", async () => {
    const sql = "SELECT customer_id FROM customers WHERE random() < 2";
    const viz = await visualize(sql, run);
    calls = [];
    const trace = await traceRows(sql, run, viz);
    expect(calls).toHaveLength(0);
    const cards = teachSteps(viz, trace);
    expect(cards[0].notes.join()).toMatch(/random/);
    expect(cards.every((c) => c.provenance === "parsed")).toBe(true);
  });
  it("set operations: inputs, result and removed rows come from the stage", async () => {
    const b = await build("SELECT country FROM customers UNION SELECT country FROM suppliers");
    const c = b.cards[0];
    expect(c.kind).toBe("setop");
    expect(c.inputs.map((t) => t.total)).toEqual([91, await n1("SELECT COUNT(*) FROM suppliers")]);
    expect(c.outputs[0].total).toBe(await n1("SELECT COUNT(*) FROM (SELECT country FROM customers UNION SELECT country FROM suppliers) x"));
    expect(c.remember).toMatch(/UNION removes duplicate/);
  });
  it("DISTINCT: counts of merged duplicates", async () => {
    const b = await build("SELECT DISTINCT country FROM customers");
    const c = b.by("DISTINCT");
    const d = await n1("SELECT COUNT(DISTINCT country) FROM customers");
    expect(c.rowsOut).toBe(d);
    expect(c.what).toContain(`91 → ${d} rows, so ${91 - d} duplicates merge`);
  });
});

describe("guarantees on the queries that are run", () => {
  it("the learner's query runs once (in visualize), and every derived query is a SELECT, WITH or EXPLAIN", async () => {
    const sql = "WITH g AS (SELECT * FROM orders WHERE freight > 20) SELECT c.country, COUNT(*) AS n, SUM(g.freight) AS f FROM customers c LEFT JOIN g ON g.customer_id = c.customer_id WHERE c.country <> 'X' AND g.order_id IN (SELECT order_id FROM orders) GROUP BY c.country HAVING COUNT(*) > 1 ORDER BY n DESC, c.country LIMIT 4 OFFSET 1";
    calls = [];
    const viz = await visualize(sql, run);
    const afterViz = calls.length;
    expect(calls.filter((x) => x.trim() === sql).length).toBe(1);
    const trace = await traceRows(sql, run, viz);
    expect(trace.queries).toBeGreaterThan(5);
    expect(calls.filter((x) => x.trim() === sql).length).toBe(1);
    expect(calls.slice(afterViz).every((x) => /^\s*(SELECT|WITH|EXPLAIN)\b/i.test(x))).toBe(true);
    const bad = calls.filter((x) => !/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(x));
    expect(bad).toEqual([]);
    expect(teachSteps(viz, trace)).toHaveLength(viz.stages.length);
  });
  it("a grouped query never asks PostgreSQL for a ctid (no failing derived query), and an empty grouped result still gets every frame", async () => {
    for (const where of ["od.quantity > 20", "od.quantity > 50"]) {
      const sql = `SELECT p.product_name, SUM(od.quantity) AS q FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE ${where} GROUP BY p.product_name ORDER BY q DESC LIMIT 5`;
      const results: boolean[] = [];
      const counting: Run = async (s) => { const r = await run(s); results.push(r.success); return r; };
      const viz = await visualize(sql, counting);
      const trace = await traceRows(sql, counting, viz);
      expect(results.every(Boolean)).toBe(true);
      expect(trace.frames.every((f) => f !== undefined)).toBe(true);
      const cards = teachSteps(viz, trace);
      const kept = await n1(`SELECT COUNT(*) FROM order_details od WHERE ${where}`);
      const w = cards.find((c) => c.label === "WHERE")!;
      expect(w.rowsOut).toBe(kept);
      // with no surviving rows the frames are empty and the cards say 0, instead of inventing rows
      const drawn = trace.frames[viz.stages.findIndex((s) => s.clause === "group by")]!.board!.cards.length;
      expect(drawn > 0).toBe(kept > 0);
      if (kept === 0) expect(cards.find((c) => c.label === "SUM")!.changed).toMatch(/→ 0 output rows/);
    }
  });
  it("the whole trace runs with zero failing derived queries (no ctid probe that cannot succeed)", async () => {
    const Q01 = `SELECT
    p.product_id,
    p.product_name,
    ROUND(
        SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric,
        2
    ) AS total_revenue
FROM products p
JOIN order_details od
    ON od.product_id = p.product_id
GROUP BY
    p.product_id,
    p.product_name
ORDER BY
    total_revenue DESC`;
    const queries = [
      Q01,
      "WITH big AS (SELECT * FROM orders WHERE freight > 50) SELECT customer_id, COUNT(*) AS n FROM big GROUP BY customer_id ORDER BY n DESC LIMIT 3",
      "WITH big AS (SELECT * FROM orders WHERE freight > 50) SELECT order_id FROM big WHERE order_id > 10300 ORDER BY order_id LIMIT 3",
      "SELECT customer_id FROM customers WHERE customer_id IN (SELECT customer_id FROM orders WHERE freight > 100) ORDER BY customer_id",
      "SELECT country, SUM(x) FROM (SELECT country, 1 AS x FROM customers) t GROUP BY country",
      "SELECT customer_id, country, RANK() OVER (PARTITION BY country ORDER BY customer_id) AS r FROM customers",
      "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id ORDER BY o.order_id LIMIT 4",
      "SELECT g, COUNT(*) FROM generate_series(1, 5) g GROUP BY g",
      "SELECT COUNT(*) FROM orders",
      "SELECT DISTINCT country FROM customers ORDER BY country",
    ];
    for (const sql of queries) {
      const failures: string[] = [];
      const watched: Run = async (s2) => { const r = await run(s2); if (!r.success) failures.push(`${r.message} <= ${s2.replace(/\s+/g, " ").slice(0, 100)}`); return r; };
      const viz = await visualize(sql, watched);
      const trace = await traceRows(sql, watched, viz);
      expect(failures, sql).toEqual([]);
      expect(trace.frames.every((f) => f !== undefined)).toBe(true);
    }
    // identity stays real for a plain table and falls back to trace for a CTE
    const plain = await build("SELECT customer_id FROM customers WHERE country = 'Germany'");
    expect(plain.trace.identity).toBe("ctid");
    const cte = await build("WITH big AS (SELECT * FROM orders WHERE freight > 50) SELECT order_id FROM big ORDER BY order_id");
    expect(cte.trace.identity).toBe("trace");
  });
  it("tracing does not change the learner's result", async () => {
    const sql = "SELECT country, COUNT(*) AS n FROM customers GROUP BY country ORDER BY n DESC, country LIMIT 5";
    const before = await q(sql);
    const viz = await visualize(sql, run);
    await traceRows(sql, run, viz);
    expect(await q(sql)).toEqual(before);
    expect(viz.final!.rows).toEqual(before);
  });
});

describe("pure readers", () => {
  it("findAggCalls reads every aggregate with its argument and shape", () => {
    const calls2 = findAggCalls("country, COUNT(*) AS n, COUNT(DISTINCT city), ROUND(SUM(a * b)::numeric, 2) AS s, AVG(x) FILTER (WHERE x > 0)");
    expect(calls2.map((c) => [c.fn, c.arg, c.star, c.distinct])).toEqual([["count", "*", true, false], ["count", "city", false, true], ["sum", "a * b", false, false]]);
    expect(calls2[2].round).toBe(2);
    expect(calls2[2].wrapped).toBe(true);
    expect(findAggCalls("SUM(x) OVER (PARTITION BY y)")).toEqual([]);
  });
  it("findSubqueries classifies by what precedes the parenthesis", () => {
    const subs = findSubqueries({
      where: "a IN (SELECT 1) AND b > (SELECT 2) AND NOT EXISTS (SELECT 3) AND (c = 1 OR d NOT IN (SELECT 4)) AND e = ANY (SELECT 5)",
      from: "x JOIN (SELECT 6) AS t ON true",
    });
    expect(subs.map((s) => [s.kind, s.negated])).toEqual([["in", false], ["scalar", false], ["exists", true], ["in", true], ["any", false], ["derived", false]]);
    expect(subs[5].alias).toBe("t");
    expect(findSubqueries({ where: "f(a, (1 + 2)) = 3 AND g = 'x (SELECT 9)'" })).toEqual([]);
  });
  it("sort keys and ties", () => {
    const k = sortKeys("n DESC NULLS LAST, name, 1", "id AS n, name");
    expect(k.map((x) => [x.name, x.expr, x.desc, x.nulls, x.explicitNulls])).toEqual([["n", "id", true, "last", true], ["name", "name", false, "last", false], ["1", "id", false, "last", false]]);
    expect(sortKeys("x USING <", "x")).toEqual([]);
    expect(tieRuns([[1], [1], [2], [3], [3], [3]]).map((t) => [t.start, t.length])).toEqual([[0, 2], [3, 3]]);
  });
});
