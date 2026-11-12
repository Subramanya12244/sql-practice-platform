// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Run } from "../site/lib/visualize";
import { traceRows } from "../site/lib/visual/rowTrace";
import { buildCinema, ifRemoved, keyColumns, pickColumns, type CinemaStep } from "../site/lib/visual/cinema";
import { initialPlayback, playbackReducer } from "../site/lib/visual/playback";
import { predicateDetail, verdictOf, type BoardCard } from "../site/lib/visual/rowFlow";

/**
 * The Query Cinema's data, checked against the real database: what the animation draws must be what PostgreSQL actually
 * produced at each stage, the counts must be exact, and playing, stepping and restarting must never run a query.
 */
let run: Run;
const calls: string[] = [];
beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  run = (sql) => { calls.push(sql); return execute(pg as unknown as SqlDb, sql); };
}, 60_000);

async function build(sql: string) {
  const viz = await visualize(sql, run);
  const trace = await traceRows(sql, run, viz);
  const steps = buildCinema(viz, trace, sql);
  return { viz, trace, steps };
}
const step = (steps: CinemaStep[], id: string) => steps.find((s) => s.id === id || s.label === id)!;
const cell = (c: BoardCard, col: string) => c.cells![c.cols!.indexOf(col)];
const scalar = async (sql: string) => { const r = await run(sql); if (!r.success) throw new Error(r.message ?? "query failed"); return Number(r.rows[0][0]); };

/** The query from the task: JOIN + GROUP BY + HAVING + ORDER BY on the Northwind sample. */
const EXAMPLE = `SELECT c.customer_id, c.company_name, COUNT(o.order_id)
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
WHERE o.freight > 50
GROUP BY c.customer_id, c.company_name
HAVING COUNT(o.order_id) > 2
ORDER BY COUNT(o.order_id) DESC`;
/** A variant whose HAVING keeps some groups, so every lane has rows. */
const KEEPS = `SELECT c.country, COUNT(*) AS orders
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
WHERE o.freight > 10
GROUP BY c.country
HAVING COUNT(*) >= 3
ORDER BY orders DESC, c.country
LIMIT 5`;

describe("the script: one step per thing SQL does, in logical order", () => {
  it("splits FROM and JOIN, then WHERE, GROUP BY, HAVING, SELECT, ORDER BY", async () => {
    const { steps } = await build(EXAMPLE);
    expect(steps.map((s) => s.label)).toEqual(["FROM", "JOIN", "WHERE", "GROUP BY", "HAVING", "SELECT", "ORDER BY"]);
    expect(steps.every((s) => s.identity === "ctid" || s.identity === "trace")).toBe(true);
  });
  it("is built from the parsed query, so the number of steps does not change when row data arrives", async () => {
    const viz = await visualize(KEEPS, run);
    const before = buildCinema(viz, undefined, KEEPS);
    const after = buildCinema(viz, await traceRows(KEEPS, run, viz), KEEPS);
    expect(before.map((s) => s.id)).toEqual(after.map((s) => s.id));
    expect(before.find((s) => s.id === "where:1" || s.label === "WHERE")!.tableOnly || before.find((s) => s.label === "WHERE")!.board).toBeTruthy();
  });
  it("shows an exact funnel: every step receives what the one before passed on", async () => {
    const { steps } = await build(KEEPS);
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].rowsIn !== undefined && steps[i - 1].rowsOut !== undefined) expect(steps[i].rowsIn, `${steps[i].label} rows in`).toBe(steps[i - 1].rowsOut);
    }
    const last = steps[steps.length - 1];
    expect(last.label).toBe("LIMIT");
    expect(last.rowsOut).toBe(5);
  });
  it("counts are the database's counts, not the drawn sample", async () => {
    const { steps } = await build(EXAMPLE);
    expect(step(steps, "FROM").rowsOut).toBe(await scalar("SELECT COUNT(*) FROM customers"));
    expect(step(steps, "JOIN").rowsOut).toBe(await scalar("SELECT COUNT(*) FROM customers c JOIN orders o ON c.customer_id = o.customer_id"));
    expect(step(steps, "WHERE").rowsOut).toBe(await scalar("SELECT COUNT(*) FROM orders WHERE freight > 50"));
    expect(step(steps, "GROUP BY").rowsOut).toBe(await scalar("SELECT COUNT(*) FROM (SELECT 1 FROM orders o WHERE o.freight > 50 GROUP BY o.customer_id) g"));
    expect(step(steps, "HAVING").rowsOut).toBe(await scalar("SELECT COUNT(*) FROM (SELECT 1 FROM orders WHERE freight > 50 GROUP BY customer_id HAVING COUNT(order_id) > 2) g"));
  });
});

describe("JOIN: the tables, the matching rows, the unmatched rows", () => {
  it("every matched pair has equal join keys on both sides, and pairs share a colour with their left row", async () => {
    const { steps } = await build(EXAMPLE);
    const join = step(steps, "JOIN");
    const cards = new Map(join.board!.cards.map((c) => [c.id, c]));
    const pairs = join.frame!.facts.matched;
    expect(pairs.length).toBeGreaterThan(5);
    for (const [l, r] of pairs) {
      const a = cards.get(`L:${l}`)!, b = cards.get(`R:${r}`)!;
      expect(cell(a, "c.customer_id")).toBe(cell(b, "o.customer_id"));
      expect(a.group).toBeDefined();
      expect(b.group).toBe(a.group);
    }
    expect(join.on).toBe("c.customer_id = o.customer_id");
    expect([...keyColumns(join.on, join.board!.cards[0].cols!)].sort()).toEqual(["c.customer_id"]);
  });
  it("the JOIN step explains the join, not the FROM", async () => {
    const { steps } = await build(EXAMPLE);
    const join = step(steps, "JOIN");
    expect(join.text.ifRemoved).toMatch(/Without the ON condition every left row would pair with every right row: 91 × 100 = 9,100 rows instead of 100/);
    expect(join.text.changed).toMatch(/100 matched pairs make 100 rows; 2 left rows had no partner/);
    expect(step(steps, "FROM").text.ifRemoved).toMatch(/nothing to work on/);
  });
  it("left rows with no partner are exactly the customers with no orders, and an INNER JOIN drops them", async () => {
    const { steps } = await build(EXAMPLE);
    const dropped = step(steps, "JOIN").board!.cards.filter((c) => c.id.startsWith("L:") && c.tone === "removed");
    const real = (await run("SELECT customer_id FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)")).rows.map((r) => r[0]);
    expect(dropped.length).toBeGreaterThan(0);
    for (const c of dropped) expect(real).toContain(cell(c, "c.customer_id"));
  });
  it("a LEFT JOIN keeps those rows, padded with NULLs", async () => {
    const sql = "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL";
    const { steps } = await build(sql);
    const join = step(steps, "JOIN");
    const padded = join.board!.cards.filter((c) => c.badge === "NULL-padded");
    expect(padded.length).toBeGreaterThan(0);
    expect(padded.every((c) => c.tone === "unmatched")).toBe(true);
    expect(join.joinKind).toMatch(/LEFT/);
  });
});

describe("WHERE: every row is evaluated and the verdict decides where it goes", () => {
  it("true rows are kept, false rows are removed, and each verdict agrees with the data", async () => {
    const { steps } = await build(EXAMPLE);
    const where = step(steps, "WHERE");
    const real = new Set((await run("SELECT order_id FROM orders WHERE freight > 50")).rows.map((r) => String(r[0])));
    const cards = where.board!.cards;
    expect(cards.length).toBeGreaterThan(10);
    for (const c of cards) {
      expect(c.verdict, "every drawn row carries a verdict").toBeDefined();
      const inReal = real.has(cell(c, "o.order_id"));
      expect(c.tone, `order ${cell(c, "o.order_id")}`).toBe(inReal ? "kept" : "removed");
      expect(c.verdict!.value).toBe(inReal ? "true" : "false");
      expect(c.to.lane).toBe(inReal ? 1 : 2);
      expect(c.from.lane).toBe(0);
      expect(c.verdict!.detail).toMatch(/^o\.freight = /);
    }
    expect(where.expr).toBe("o.freight > 50");
  });
  it("NULL is not true: a row whose predicate is unknown shows NULL and is removed", async () => {
    const { steps } = await build("SELECT customer_id, region FROM customers WHERE region <> 'SP'");
    const cards = step(steps, "WHERE").board!.cards;
    const nulls = cards.filter((c) => c.verdict?.value === "NULL");
    expect(nulls.length).toBeGreaterThan(0);
    for (const c of nulls) { expect(c.tone).toBe("removed"); expect(cell(c, "region")).toBe("NULL"); }
  });
  it("the drawn kept and removed rows are a sample; the counts beside them are exact", async () => {
    const { steps } = await build(EXAMPLE);
    const where = step(steps, "WHERE");
    expect(where.board!.lanes.map((l) => l.label)).toEqual(["Input rows", "Kept", "Removed"]);
    expect(where.limited).toMatch(/showing \d+ of 100/);
    expect(where.rowsIn).toBe(100);
    expect(where.rowsOut).toBe(await scalar("SELECT COUNT(*) FROM orders WHERE freight > 50"));
  });
});

describe("GROUP BY and HAVING", () => {
  it("rows gather into groups, each group shows its aggregate, and members share the group's colour", async () => {
    const { steps } = await build(EXAMPLE);
    const g = step(steps, "GROUP BY");
    const buckets = g.board!.cards.filter((c) => c.id.startsWith("bucket:"));
    expect(buckets.length).toBeGreaterThan(3);
    for (const b of buckets) {
      const key = JSON.parse(b.id.slice(7)) as string[];
      expect(b.calc, "a bucket shows its aggregate").toMatch(/^COUNT\(o\.order_id\) = \d+$/);
      const real = await scalar(`SELECT COUNT(o.order_id) FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE o.freight > 50 AND c.customer_id = '${key[0]}'`);
      expect(b.calc).toBe(`COUNT(o.order_id) = ${real}`);
      const members = g.board!.cards.filter((c) => !c.id.startsWith("bucket:") && c.group === b.group);
      expect(members.length).toBeGreaterThan(0);
      expect(members.every((m) => cell(m, "c.customer_id") === key[0])).toBe(true);
    }
  });
  it("HAVING compares each group's aggregate: the verdict is true exactly when the condition holds", async () => {
    const { steps } = await build(KEEPS);
    const h = step(steps, "HAVING");
    const cards = h.board!.cards;
    expect(cards.length).toBeGreaterThan(5);
    for (const c of cards) {
      const n = Number(cell(c, "COUNT(*)"));
      expect(c.verdict!.value).toBe(n >= 3 ? "true" : "false");
      expect(c.tone).toBe(n >= 3 ? "kept" : "removed");
      const real = await scalar(`SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 AND c.country = '${cell(c, "c.country")}'`);
      expect(n).toBe(real);
    }
    expect(h.expr).toBe("COUNT(*) >= 3");
  });
  it("when HAVING removes every group the Kept lane is empty and the step says so", async () => {
    const { steps, viz } = await build(EXAMPLE);
    const h = step(steps, "HAVING");
    expect(h.rowsOut).toBe(0);
    expect(h.board!.cards.every((c) => c.tone === "removed")).toBe(true);
    expect(h.board!.lanes[1].count).toMatch(/^0 of 0$/);
    expect(viz.final!.rowCount).toBe(0);
    expect(h.text.ifRemoved).toMatch(/All 67 groups would be returned/);
  });
});

describe("SELECT, DISTINCT, ORDER BY and LIMIT", () => {
  it("aggregation turns each group into one output row", async () => {
    const { steps } = await build(KEEPS);
    const s = step(steps, "SELECT");
    expect(s.kind).toBe("aggregate");
    expect(s.board!.cards.filter((c) => c.appear).length).toBeGreaterThan(0);
  });
  it("DISTINCT shows the merged duplicates and the survivors", async () => {
    const { steps } = await build("SELECT DISTINCT country FROM customers ORDER BY country");
    const d = step(steps, "DISTINCT");
    expect(d.rowsIn).toBe(91);
    expect(d.rowsOut).toBe(await scalar("SELECT COUNT(DISTINCT country) FROM customers"));
    expect(d.board!.cards.some((c) => c.tone === "dup" && c.vanish)).toBe(true);
    expect(d.board!.cards.some((c) => c.tone === "survivor")).toBe(true);
    expect(d.text.changed).toMatch(/70 duplicate rows merged: 91 → 21/);
  });
  it("ORDER BY moves rows and keeps the count; LIMIT keeps the top rows and cuts the rest", async () => {
    const { steps } = await build(KEEPS);
    const o = step(steps, "ORDER BY");
    expect(o.rowsIn).toBe(o.rowsOut);
    expect(o.board!.cards.some((c) => c.from.row !== c.to.row)).toBe(true);
    const l = step(steps, "LIMIT");
    expect(l.board!.cards.filter((c) => c.tone === "kept")).toHaveLength(5);
    expect(l.board!.cards.some((c) => c.tone === "cut")).toBe(true);
    expect(l.rowsOut).toBe(5);
  });
  it("what is drawn at the end equals what the query really returns", async () => {
    const { viz, steps } = await build(KEEPS);
    const real = await run(KEEPS);
    expect(viz.final!.rows).toEqual(real.rows.slice(0, viz.final!.rows.length));
    expect(viz.final!.rowCount).toBe(real.row_count);
    const kept = step(steps, "LIMIT").board!.cards.filter((c) => c.tone === "kept").map((c) => c.cells!.join("|"));
    expect(kept).toEqual(real.rows.map((r) => r.map((v) => (v === null ? "NULL" : String(v))).join("|")));
  });
});

describe("other query shapes still play", () => {
  it.each([
    ["CTE", "WITH big AS (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id) SELECT c.company_name, big.n FROM customers c JOIN big ON big.customer_id = c.customer_id WHERE big.n > 1 ORDER BY big.n DESC"],
    ["subquery", "SELECT product_name, unit_price FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products) ORDER BY unit_price DESC"],
    ["window", "SELECT category_id, product_name, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS r FROM products"],
    ["UNION", "SELECT country FROM customers UNION SELECT country FROM suppliers ORDER BY country"],
    ["NULL and CASE", "SELECT customer_id, CASE WHEN region IS NULL THEN 'none' ELSE region END AS r FROM customers"],
  ])("%s: every step has either rows to draw or a table and a reason", async (_n, sql) => {
    const { steps, viz } = await build(sql);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(Boolean(s.board) || s.tableOnly, `${s.label}`).toBe(true);
    expect(viz.final!.rowCount).toBe((await run(sql)).row_count);
  });
});

describe("large results are sampled without falsifying counts", () => {
  it("draws at most the sample but reports the exact total", async () => {
    const total = await scalar("SELECT COUNT(*) FROM order_details");
    const { steps } = await build("SELECT * FROM order_details WHERE quantity > 1");
    const f = step(steps, "FROM");
    expect(f.rowsOut).toBe(total);
    expect(f.board!.cards.length).toBeLessThanOrEqual(20);
    expect(f.limited).toMatch(new RegExp(`of ${total.toLocaleString()}`));
    expect(step(steps, "WHERE").rowsOut).toBe(await scalar("SELECT COUNT(*) FROM order_details WHERE quantity > 1"));
  });
});

describe("playing never runs a query", () => {
  it("building the script, stepping, playing, seeking and restarting issue no SQL", async () => {
    const { viz, trace, steps } = await build(KEEPS);
    const before = calls.length;
    for (let i = 0; i < 3; i++) buildCinema(viz, trace, KEEPS);
    let s = initialPlayback(steps.length);
    for (const a of ["next", "next", "prev", "play", "tick", "tick", "pause", "seek", "restart", "next"] as const) s = playbackReducer(s, a === "seek" ? { type: "seek", index: 4 } : { type: a });
    expect(calls.length).toBe(before);
  });
  it("only SELECT, WITH and EXPLAIN statements are ever used to draw the cinema", async () => {
    calls.length = 0;
    await build(EXAMPLE);
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((q) => /^\s*(SELECT|WITH|EXPLAIN)\b/i.test(q))).toBe(true);
  });
  it("the learner's own query is executed once by the visualizer and never by the row trace", async () => {
    calls.length = 0;
    await build(KEEPS);
    expect(calls.filter((q) => q.trim() === KEEPS.trim())).toHaveLength(1);
  });
});

describe("pure helpers", () => {
  it("verdictOf treats NULL as its own value", () => {
    expect([verdictOf("true"), verdictOf("false"), verdictOf(null), verdictOf(true)]).toEqual(["true", "false", "NULL", "true"]);
  });
  it("predicateDetail names the columns a predicate reads, with this row's values", () => {
    expect(predicateDetail("o.freight > 50 AND c.country = 'UK'", ["c.country", "o.freight"], ["UK", 61.5])).toBe("o.freight = 61.5, c.country = UK");
    expect(predicateDetail("freight > 10", ["freight"], [4])).toBe("freight = 4");
    expect(predicateDetail("1 = 1", ["a"], [1])).toBeUndefined();
  });
  it("pickColumns draws the columns the query names first, skips all-NULL filler, and keeps column order", () => {
    const cols = ["id", "name", "title", "address", "country", "phone"];
    expect(pickColumns(cols, "SELECT country FROM t WHERE name = 'x'", 3)).toEqual([1, 4, 0].sort((a, b) => a - b));
    expect(pickColumns(cols, "SELECT 1", 3, [], new Set([0, 1]))).toEqual([2, 3, 4]);
    expect(pickColumns(cols, "x", 9)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("ifRemoved uses the exact counts", () => {
    expect(ifRemoved("where", { rowsIn: 100, rowsOut: 73 })).toBe("All 100 rows would continue instead of 73 (27 more rows to group and sort).");
    expect(ifRemoved("limit", { rowsIn: 12, rowsOut: 5 })).toBe("All 12 rows would be returned instead of 5.");
    expect(ifRemoved("join", { leftRows: 91, rightRows: 100, matchedPairs: 100 }, "JOIN")).toMatch(/91 × 100 = 9,100 rows instead of 100/);
    expect(ifRemoved("join", { unmatchedLeft: 2 }, "LEFT JOIN")).toMatch(/2 such rows/);
  });
});
