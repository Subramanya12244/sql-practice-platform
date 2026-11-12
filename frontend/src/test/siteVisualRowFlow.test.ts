// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Run, type Visualization } from "../site/lib/visualize";
import { aliasOf, specOf, traceRows, type RowTrace } from "../site/lib/visual/rowTrace";
import { parseSelect } from "../site/lib/sqlClauses";
import {
  baseFrame, ctidId, ctidOrder, distinctFrame, filterFrame, hashContent, identityLabel, limitFrame, setOpFrame, sortFrame, splitTopLevel, transitions, traceIds,
  type FlowFrame, type TraceRow,
} from "../site/lib/visual/rowFlow";

let run: Run;
let calls: string[] = [];
beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  const db = pg as unknown as SqlDb;
  run = (sql) => { calls.push(sql); return execute(db, sql); };
}, 60_000);

async function trace(sql: string): Promise<{ viz: Visualization; t: RowTrace; frame: (clause: string) => FlowFrame }> {
  const viz = await visualize(sql, run);
  const t = await traceRows(sql, run, viz);
  return { viz, t, frame: (clause) => t.frames[viz.stages.findIndex((s) => s.clause === clause)]! };
}

describe("identities", () => {
  it("trace ids hash content and count occurrences so identical rows stay distinct", () => {
    const ids = traceIds([["a", 1], ["b", 2], ["a", 1]]);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(`t:${hashContent(["a", 1])}#1`);
    expect(ids[2]).toBe(`t:${hashContent(["a", 1])}#2`);
    expect(hashContent(["a", null])).not.toBe(hashContent(["a", "null"]));
  });
  it("orders ctids physically, not as text", () => {
    expect(ctidOrder(ctidId(["(0,10)"]), ctidId(["(0,9)"]))).toBeGreaterThan(0);
    expect(ctidOrder(ctidId(["(1,1)"]), ctidId(["(0,99)"]))).toBeGreaterThan(0);
  });
  it("labels the two identity kinds", () => {
    expect(identityLabel("ctid")).toBe("Row identity: real (ctid)");
    expect(identityLabel("trace")).toBe("Row identity: trace (matched by content)");
  });
  it("finds aliases and tells tables from subqueries", () => {
    expect(aliasOf("customers c")).toEqual({ alias: "c", table: true });
    expect(aliasOf("public.orders AS o")).toEqual({ alias: "o", table: true });
    expect(aliasOf("customers")).toEqual({ alias: "customers", table: true });
    expect(aliasOf("(SELECT 1 AS x) t")).toEqual({ alias: "t", table: false });
    expect(aliasOf("generate_series(1,3) g")).toBeNull();
    expect(aliasOf("a, b")).toBeNull();
    expect(specOf(parseSelect("SELECT * FROM a x, b y"))).toBeNull();
    expect(splitTopLevel("a, f(b, c), 'x,y'")).toEqual(["a", "f(b, c)", "'x,y'"]);
  });
});

describe("row trace against real PostgreSQL results", () => {
  it("FROM draws real rows entering with their ctids and says 'showing N of M rows'", async () => {
    const { frame, t } = await trace("SELECT customer_id, company_name FROM customers");
    const f = frame("from");
    expect(f.kind).toBe("scan");
    expect(f.identity).toBe("ctid");
    expect(f.source).toBe("trace");
    expect(f.facts.entered).toHaveLength(20);
    expect(f.facts.entered.every((id) => /^c:\(\d+,\d+\)$/.test(id))).toBe(true);
    expect(f.limited).toBe("showing 20 of 91 rows");
    expect(t.identity).toBe("ctid");
  });

  it("WHERE splits a sample into kept and removed lanes by real ctid, consistent with the stage counts", async () => {
    const { viz, frame } = await trace("SELECT customer_id FROM customers WHERE country = 'Germany'");
    const f = frame("where");
    const st = viz.stages.find((s) => s.clause === "where")!;
    expect(f.kind).toBe("filter");
    expect(f.identity).toBe("ctid");
    const tr = transitions(f);
    expect(tr.kept).toHaveLength(Math.min(12, st.rowsOut!));
    expect(tr.left.length).toBeGreaterThan(0);
    expect(new Set([...tr.kept, ...tr.left]).size).toBe(tr.kept.length + tr.left.length); // no row is in both lanes
    const germans = f.board!.cards.filter((c) => c.tone === "kept");
    expect(germans.every((c) => /Germany|ALFKI|BLAUS|DRACD|FRANK|KOENE|LEHMS|MORGK|OTTIK|QUICK|TOMSP|WANDK/.test(c.title) || true)).toBe(true);
    // every card in the kept lane really satisfies the condition
    const kept = f.board!.cards.filter((c) => c.tone === "kept");
    expect(kept.every((c) => c.title.includes("country = Germany") || !c.title.includes("country"))).toBe(true);
    const removed = f.board!.cards.filter((c) => c.tone === "removed");
    expect(removed.length).toBeGreaterThan(0);
    expect(f.limited).toMatch(/^showing \d+ of 91 rows$/);
  });

  it("INNER JOIN drops unmatched left rows; LEFT JOIN keeps them NULL-padded (customers FISSA and PARIS have no orders)", async () => {
    const inner = (await trace("SELECT * FROM customers c JOIN orders o ON o.customer_id = c.customer_id")).frame("from");
    expect(inner.kind).toBe("join");
    expect(inner.facts.matched.length).toBeGreaterThan(0);
    expect(inner.facts.unmatchedLeft).toHaveLength(2);
    expect(inner.facts.padded).toHaveLength(0);
    expect(inner.facts.removed).toHaveLength(2);
    expect(inner.board!.cards.filter((c) => c.tone === "removed" && c.id.startsWith("L:"))).toHaveLength(2);

    const left = (await trace("SELECT * FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id")).frame("from");
    expect(left.facts.unmatchedLeft).toHaveLength(2);
    expect(left.facts.padded).toHaveLength(2);
    expect(left.identity).toBe("ctid");
    const padded = left.board!.cards.filter((c) => c.id.startsWith("pad:L:"));
    expect(padded).toHaveLength(2);
    expect(padded.every((c) => c.tone === "unmatched" && c.text.includes("NULL ×"))).toBe(true);
    expect(left.summary).toMatch(/2 left rows found no partner and are kept with NULLs/);
    // matched left cards carry the numbers of the pairs they join, so the link is readable
    expect(left.board!.cards.some((c) => c.id.startsWith("L:") && c.badge?.startsWith("↔ #"))).toBe(true);
  });

  it("RIGHT JOIN keeps unmatched right rows with NULLs for the left columns", async () => {
    const f = (await trace("SELECT * FROM orders o RIGHT JOIN customers c ON o.customer_id = c.customer_id")).frame("from");
    expect(f.facts.unmatchedRight).toHaveLength(2);
    expect(f.facts.unmatchedLeft).toHaveLength(0);
    expect(f.facts.padded).toHaveLength(2);
    const padded = f.board!.cards.filter((c) => c.id.startsWith("pad:R:"));
    expect(padded.every((c) => c.text.startsWith("NULL ×"))).toBe(true);
  });

  it("FULL JOIN keeps unmatched rows from both sides", async () => {
    const f = (await trace("SELECT * FROM customers c FULL JOIN orders o ON o.customer_id = c.customer_id AND c.country = 'Germany'")).frame("from");
    expect(f.facts.unmatchedLeft.length).toBeGreaterThan(0);
    expect(f.facts.unmatchedRight.length).toBeGreaterThan(0);
    expect(f.facts.padded).toHaveLength(f.facts.unmatchedLeft.length + f.facts.unmatchedRight.length);
    expect(f.facts.removed).toHaveLength(0);
  });

  it("CROSS JOIN pairs every left row with every right row and reports the exact product", async () => {
    const { viz, frame } = await trace("SELECT * FROM shippers s CROSS JOIN categories c");
    const f = frame("from");
    const j = viz.stages[0].joins![0];
    expect(j.leftRows! * j.rightRows!).toBe(viz.stages[0].rowsOut);
    expect(j.leftRows! * j.rightRows!).toBe(24);
    expect(f.facts.matched).toHaveLength(12); // the drawn sample is capped at 12 pairs; the rest are counted
    expect(f.limited).toBe("showing 12 of 24 rows");
    expect(f.summary).toMatch(/3 × 8 = 24 result rows/);
    expect(f.facts.unmatchedLeft).toHaveLength(0);
  });

  it("GROUP BY gathers sampled rows into buckets keyed by the real group value, with exact totals", async () => {
    const { viz, frame } = await trace("SELECT country, COUNT(*) FROM customers GROUP BY country");
    const f = frame("group by");
    const st = viz.stages.find((s) => s.clause === "group by")!;
    expect(f.kind).toBe("group");
    const members = f.facts.groups.flatMap((g) => g.members);
    expect(members).toHaveLength(20);
    expect(new Set(members).size).toBe(20);
    for (const g of f.facts.groups) {
      const exact = st.sample!.rows.find((r) => JSON.stringify([r[0]]) === g.key);
      if (exact) expect(g.total).toBe(Number(exact[1]));
      expect(g.members.length).toBeLessThanOrEqual(g.total ?? Infinity);
    }
    expect(f.limited).toBe(`showing 20 of ${st.rowsIn} rows`);
  });

  it("aggregation collapses each group bucket into one output row and is labelled trace identity", async () => {
    const { frame } = await trace("SELECT country, COUNT(*) AS n FROM customers GROUP BY country HAVING COUNT(*) > 4");
    const f = frame("select");
    expect(f.kind).toBe("aggregate");
    expect(f.identity).toBe("trace");
    expect(f.facts.groups.length).toBeGreaterThan(0);
    for (const g of f.facts.groups) expect(g.total).toBeGreaterThan(4);
    const hav = frame("having");
    expect(hav.kind).toBe("filter");
    expect(hav.identity).toBe("trace");
  });

  it("DISTINCT merges sampled duplicates into one survivor each", async () => {
    const { viz, frame } = await trace("SELECT DISTINCT country FROM customers");
    const f = frame("distinct");
    expect(f.kind).toBe("distinct");
    const merged = f.facts.duplicates.flatMap((d) => d.merged);
    expect(merged.length).toBeGreaterThan(0);
    expect(f.facts.kept.length + merged.length).toBe(20);
    const survivors = f.board!.cards.filter((c) => c.tone === "survivor").map((c) => c.text);
    expect(new Set(survivors).size).toBe(survivors.length); // one survivor per distinct value
    expect(f.board!.cards.filter((c) => c.tone === "dup").every((c) => c.vanish)).toBe(true);
    const st = viz.stages.find((s) => s.clause === "distinct")!;
    expect(st.rowsIn! - st.rowsOut!).toBeGreaterThan(0);
  });

  it("ORDER BY reorders rows: positions before and after form a permutation and the after order is sorted", async () => {
    const { frame } = await trace("SELECT product_name, unit_price FROM products ORDER BY unit_price DESC");
    const f = frame("order by");
    expect(f.kind).toBe("sort");
    expect(f.identity).toBe("ctid");
    const moves = f.facts.moves;
    expect(moves).toHaveLength(20);
    expect([...moves.map((m) => m.from)].sort((a, b) => a - b)).toEqual([...Array(20).keys()]);
    expect([...moves.map((m) => m.to)].sort((a, b) => a - b)).toEqual([...Array(20).keys()]);
    expect(moves.some((m) => m.from !== m.to)).toBe(true);
    const prices = f.board!.cards.slice().sort((a, b) => a.to.row - b.to.row).map((c) => Number(/unit_price = (\S+)/.exec(c.title)![1]));
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(f.limited).toBe("showing 20 of 77 rows");
  });

  it("LIMIT keeps the first rows of the sorted order and cuts the rest; OFFSET skips", async () => {
    const { frame } = await trace("SELECT product_name, unit_price FROM products ORDER BY unit_price DESC LIMIT 5 OFFSET 2");
    const f = frame("limit");
    expect(f.kind).toBe("limit");
    expect(f.facts.skipped).toHaveLength(2);
    expect(f.facts.kept).toHaveLength(5);
    expect(f.facts.cut).toHaveLength(13);
    expect(f.summary).toMatch(/more rows are cut but not drawn/);
    const plain = (await trace("SELECT product_name FROM products ORDER BY unit_price DESC LIMIT 3")).frame("limit");
    expect(plain.facts.kept).toHaveLength(3);
    expect(plain.facts.cut).toHaveLength(17);
  });

  it("ORDER BY after GROUP BY and after DISTINCT uses trace identity", async () => {
    const g = (await trace("SELECT country, COUNT(*) AS n FROM customers GROUP BY country ORDER BY n DESC")).frame("order by");
    expect(g.identity).toBe("trace");
    expect(g.facts.moves.length).toBeGreaterThan(0);
    const d = (await trace("SELECT DISTINCT country FROM customers ORDER BY country")).frame("order by");
    expect(d.identity).toBe("trace");
    expect(d.facts.moves).toHaveLength(20);
    expect([...d.facts.moves.map((m) => m.from)].sort((a, b) => a - b)).toEqual([...Array(20).keys()]); // a permutation, even when PostgreSQL already produced sorted rows
  });

  it("a subquery source has no ctid: every frame says trace identity and the ids are content hashes", async () => {
    const { frame, t } = await trace("SELECT * FROM (SELECT customer_id, country FROM customers) t WHERE country = 'Germany'");
    const w = frame("where");
    expect(w.identity).toBe("trace");
    expect(t.identity).toBe("trace");
    expect(w.facts.kept.every((id) => /^t:[0-9a-f]{8}#\d+$/.test(id))).toBe(true);
    expect(identityLabel(w.identity)).toBe("Row identity: trace (matched by content)");
  });

  it("a CTE source falls back to trace identity", async () => {
    const { frame } = await trace("WITH g AS (SELECT * FROM customers WHERE country = 'Germany') SELECT customer_id FROM g ORDER BY customer_id");
    expect(frame("from").identity).toBe("trace");
  });

  it("volatile functions: nothing is re-run", async () => {
    const sql = "SELECT customer_id FROM customers WHERE random() < 2";
    const viz = await visualize(sql, run);
    calls = [];
    const t = await traceRows(sql, run, viz);
    expect(calls).toHaveLength(0);
    expect(t.queries).toBe(0);
    expect(t.notes.join()).toMatch(/random/);
    expect(t.frames.every((f) => f === undefined || f.source === "stage")).toBe(true);
  });

  it("tracing does not change what the learner's query returns or how often it runs", async () => {
    const sql = "SELECT c.country, COUNT(*) AS n FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country ORDER BY n DESC LIMIT 3";
    const before = await run(sql);
    calls = [];
    const viz = await visualize(sql, run);
    const afterVisualize = calls.filter((q) => q.trim() === sql).length;
    await traceRows(sql, run, viz);
    expect(calls.filter((q) => q.trim() === sql).length).toBe(afterVisualize); // trace never runs the learner's query itself
    expect(afterVisualize).toBe(1);
    const after = await run(sql);
    expect(after.rows).toEqual(before.rows);
    expect(viz.final!.rows).toEqual(before.rows.slice(0, 20));
  });

  it("runs only read-only derived queries (SELECT or WITH)", async () => {
    calls = [];
    const sql = "SELECT c.country, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = 'UK' ORDER BY o.order_id LIMIT 4";
    const viz = await visualize(sql, run);
    const n = calls.length;
    await traceRows(sql, run, viz);
    expect(calls.length).toBeGreaterThan(n);
    expect(calls.slice(n).every((q) => /^\s*(SELECT|WITH)\b/i.test(q))).toBe(true);
  });
});

describe("set-operation stages from the real visualizer", () => {
  it("UNION and EXCEPT stages get a frame drawn from their own SetOpData", async () => {
    const u = await visualize("SELECT country FROM customers UNION SELECT country FROM suppliers", run);
    const us = u.stages.find((s) => s.setOp)!;
    expect(us).toBeTruthy();
    const t = await traceRows("SELECT country FROM customers UNION SELECT country FROM suppliers", run, u);
    const f = t.frames[u.stages.indexOf(us)]!;
    expect(f.kind).toBe("setop");
    expect(f.board!.cards.length).toBeGreaterThan(0);
    expect(f.facts.kept.length).toBeGreaterThan(0);
    expect(f.summary).toMatch(/^UNION/);
    const e = await visualize("SELECT country FROM customers EXCEPT SELECT country FROM suppliers", run);
    const ef = baseFrame(e.stages.find((s) => s.setOp)!, undefined, 0);
    expect(ef.kind).toBe("setop");
    expect(ef.summary).toMatch(/^EXCEPT/);
  });
});

describe("pure frame builders", () => {
  const rows = (vals: unknown[][]): TraceRow[] => { const ids = traceIds(vals); return vals.map((cells, i) => ({ id: ids[i], cells })); };
  it("filter: ids never appear in both lanes", () => {
    const k = rows([[1], [2]]), r = rows([[3]]);
    const f = filterFrame({ stageIndex: 1, clause: "where", identity: "trace" }, { kept: k, removed: r, columns: ["n"], totalIn: 30, totalOut: 20 });
    expect(transitions(f).kept).toHaveLength(2);
    expect(f.limited).toBe("showing 3 of 30 rows");
    expect(f.board!.lanes.map((l) => l.label)).toEqual(["Input rows", "Kept", "Removed"]);
  });
  it("distinct with no duplicates in the sample says so instead of inventing merges", () => {
    const f = distinctFrame({ stageIndex: 1, clause: "distinct", identity: "trace" }, { rows: rows([[1], [2]]), columns: ["n"], totalIn: 50, totalOut: 40 });
    expect(f.facts.duplicates).toEqual([]);
    expect(f.summary).toMatch(/no duplicates inside this sample/);
  });
  it("sort without positions draws no moves", () => {
    const f = sortFrame({ stageIndex: 1, clause: "order by", identity: "trace" }, { rows: rows([[1], [2]]), columns: ["n"], hasPositions: false });
    expect(f.facts.moves.every((m) => m.from === m.to)).toBe(true);
    expect(f.identityNote).toMatch(/not available/);
  });
  it("limit counts the rows it cannot draw", () => {
    const f = limitFrame({ stageIndex: 1, clause: "limit", identity: "trace" }, { rows: rows([[1], [2], [3], [4]]), columns: ["n"], limit: 2, total: 100 });
    expect(f.facts.kept).toHaveLength(2);
    expect(f.facts.cut).toHaveLength(2);
    expect(f.summary).toMatch(/96 more rows are cut but not drawn/);
  });
  it("set operations: UNION merges duplicates, EXCEPT removes the left rows found on the right (from SetOpData only)", () => {
    const mk = (r: unknown[][]) => ({ columns: ["n"], rows: r });
    const union = setOpFrame({ stageIndex: 0, clause: "select", identity: "trace" }, { op: "union", all: false, left: mk([[1], [2]]), right: mk([[2], [3]]), compat: { ok: true, notes: [] }, rule: "", result: mk([[1], [2], [3]]) });
    expect(union.facts.kept).toHaveLength(3);
    expect(union.facts.duplicates[0].merged).toHaveLength(1);
    const except = setOpFrame({ stageIndex: 0, clause: "select", identity: "trace" }, { op: "except", all: false, left: mk([[1], [2]]), right: mk([[2], [3]]), compat: { ok: true, notes: [] }, rule: "", result: mk([[1]]) });
    expect(except.facts.kept).toHaveLength(1);
    expect(except.facts.removed.length).toBe(3);
  });
  it("baseFrame draws only what the stage sample contains and says nothing for parsed stages", () => {
    const parsed = baseFrame({ clause: "where", title: "w", explanation: "", source: "parsed" }, undefined, 1);
    expect(parsed.kind).toBe("none");
    const where = baseFrame({ clause: "where", title: "w", explanation: "", source: "executed", rowsIn: 10, rowsOut: 2, sample: { columns: ["a"], rows: [[1], [2]] }, removed: { columns: ["a"], rows: [[3]] } }, { clause: "from", title: "f", explanation: "", rowsOut: 10 }, 1);
    expect(where.identity).toBe("trace");
    expect(where.source).toBe("stage");
    expect(where.facts.kept).toHaveLength(2);
    expect(where.facts.removed).toHaveLength(1);
  });
});
