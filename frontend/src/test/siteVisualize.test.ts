// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Run } from "../site/lib/visualize";

let run: Run;
beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  const db = pg as unknown as SqlDb;
  run = (sql) => execute(db, sql);
}, 60_000);

const stage = (v: Awaited<ReturnType<typeof visualize>>, c: string) => v.stages.find((s) => s.clause === c)!;

describe("visualize", () => {
  it("walks FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT with exact counts", async () => {
    const v = await visualize(`SELECT c.country, COUNT(*) AS orders
FROM customers c JOIN orders o ON o.customer_id = c.customer_id
WHERE o.freight > 10
GROUP BY c.country HAVING COUNT(*) >= 3
ORDER BY orders DESC, c.country LIMIT 5;`, run);
    expect(v.stages.map((s) => s.clause)).toEqual(["from", "where", "group by", "having", "select", "order by", "limit"]);
    expect(v.stages.every((s) => !s.error)).toBe(true);
    const from = stage(v, "from");
    const j = from.joins![0];
    expect(j.leftRows).toBe(91);
    expect(j.unmatchedLeft).toBe(2); // FISSA and PARIS have no orders
    expect(j.resultRows).toBe(j.matchedPairs);
    const where = stage(v, "where");
    expect(where.rowsIn).toBe(from.rowsOut);
    expect(where.rowsOut).toBeLessThan(where.rowsIn!);
    const having = stage(v, "having");
    expect(having.rowsOut).toBeLessThanOrEqual(having.rowsIn!);
    expect(v.final!.rowCount).toBeLessThanOrEqual(5);
  });

  it("explains LEFT JOIN null padding, window partitions and DISTINCT", async () => {
    const left = await visualize("SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id", run);
    expect(stage(left, "from").joins![0].resultRows).toBe(stage(left, "from").joins![0].matchedPairs! + 2);
    const w = await visualize("SELECT product_name, category_id, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) FROM products", run);
    expect(stage(w, "window").partitions!.rows.length).toBe(8);
    const d = await visualize("SELECT DISTINCT country FROM customers", run);
    expect(stage(d, "distinct").rowsOut).toBeLessThan(stage(d, "distinct").rowsIn!);
  });

  it("reports unsupported input and errors instead of guessing", async () => {
    expect((await visualize("SELECT 1 UNION SELECT 2", run)).unsupported).toBeTruthy();
    const bad = await visualize("SELECT nope FROM customers", run);
    expect(bad.stages.some((s) => s.error)).toBe(true);
  });
});

import { compareSolutions, lint } from "../site/lib/compareSolutions";

describe("compareSolutions", () => {
  it("finds NOT EXISTS and LEFT JOIN … IS NULL equivalent and records the environment", async () => {
    const c = await compareSolutions(
      "SELECT c.customer_id FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)",
      "SELECT c.customer_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL",
      run, { runs: 2 },
    );
    expect(c.equivalent).toBe(true);
    expect(c.a.rowCount).toBe(2);
    expect(c.a.approaches).toContain("NOT EXISTS");
    expect(c.b.approaches).toContain("JOIN");
    expect(c.a.runsMs.length).toBe(2);
    expect(c.a.planCost).toBeGreaterThan(0);
    expect(c.environment.version).toMatch(/PostgreSQL/);
    expect(c.environment.tables.map((t) => t.name).sort()).toEqual(["customers", "orders"]);
  });
  it("shows the row difference when results differ", async () => {
    const c = await compareSolutions("SELECT shipper_id FROM shippers", "SELECT shipper_id FROM shippers WHERE shipper_id < 3", run, { runs: 1 });
    expect(c.equivalent).toBe(false);
    expect(c.diff?.extraCount).toBe(1);
  });
  it("lints well-known traps", () => {
    expect(lint("SELECT * FROM a WHERE id NOT IN (SELECT x FROM b)").map((n) => n.text).join()).toMatch(/NULL/);
    expect(lint("SELECT c.id, COUNT(*) FROM c LEFT JOIN o ON o.c = c.id GROUP BY c.id").some((n) => /padded/.test(n.text))).toBe(true);
    expect(lint("SELECT id FROM t ORDER BY id LIMIT 3")).toEqual([]);
  });
});

import { analyze, cteFlow, volatileFunctions } from "../site/lib/sqlAst";
import { addExec, addSession, getExecs, getSessions } from "../site/lib/vizHistory";

describe("AST structure", () => {
  it("parses CTE dependencies, joins and set-operation branches", async () => {
    const s = await analyze("WITH a AS (SELECT customer_id FROM orders), b AS (SELECT customer_id FROM a) SELECT c.country FROM customers c JOIN b ON b.customer_id = c.customer_id");
    expect(s.source).toBe("ast");
    expect(s.ctes).toEqual([{ name: "a", dependsOn: [], recursive: false }, { name: "b", dependsOn: ["a"], recursive: false }]);
    expect(s.joins[0]).toMatchObject({ type: "INNER JOIN", table: "b" });
    expect(cteFlow(s)).toContain("c_a --> c_b");
    const u = await analyze("SELECT country FROM customers UNION ALL SELECT country FROM suppliers EXCEPT SELECT 'UK'");
    expect(u.branches.map((b) => b.op)).toEqual(["", "UNION ALL", "EXCEPT"]);
  });
  it("counts subqueries and window functions, and flags volatile functions", async () => {
    const s = await analyze("SELECT product_name, RANK() OVER (ORDER BY unit_price) FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products)");
    expect(s.subqueries).toBe(1);
    expect(s.windows).toBe(1);
    expect(volatileFunctions("SELECT random(), now(), 'random()' FROM t")).toEqual(["random()", "now()"]);
  });
  it("falls back gracefully on syntax it can't parse", async () => {
    const s = await analyze("SELECT $$x$$ AS a FROM customers");
    expect(s.source).toBe("clauses");
    expect(s.parseError).toBeTruthy();
  });
});

describe("visualize safety", () => {
  it("never shows derived rows for queries with volatile functions", async () => {
    const v = await visualize("SELECT customer_id, random() AS r FROM customers WHERE country = 'Germany'", run);
    expect(v.volatile).toEqual(["random()"]);
    expect(v.stages.every((s) => s.source === "parsed" && !s.sample && s.rowsOut === undefined)).toBe(true);
    expect(v.final!.rowCount).toBeGreaterThan(0); // the user's own query still runs once
  });
  it("labels stages computed from the user's clauses as executed", async () => {
    const v = await visualize("SELECT country, COUNT(*) FROM customers GROUP BY country HAVING COUNT(*) > 3", run);
    expect(v.stages.filter((s) => s.clause !== "order by").every((s) => s.source === "executed")).toBe(true);
  });
  it("handles subqueries and CTE queries without failing", async () => {
    const a = await visualize("WITH r AS (SELECT customer_id, COUNT(*) n FROM orders GROUP BY 1) SELECT c.company_name, r.n FROM customers c JOIN r ON r.customer_id = c.customer_id WHERE r.n > (SELECT AVG(n) FROM r)", run);
    expect(a.unsupported).toBeUndefined();
    expect(a.final!.rowCount).toBeGreaterThan(0);
    const bad = await visualize("SELEC nope", run);
    expect(bad.unsupported).toBeTruthy();
  });
});

describe("visualization history", () => {
  it("appends sessions per question without overwriting earlier attempts", () => {
    const store = new Map<string, string>();
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as Storage;
    addExec("q25", { at: "1", kind: "run", sql: "select 1", ok: true, attempt: 0 });
    addExec("q25", { at: "2", kind: "submit", sql: "select 2", ok: true, correct: false, attempt: 1 });
    addSession("q25", { sql: "select 1", attempt: 0, dataset: "northwind", structure: "SELECT", stages: ["from"] });
    addSession("q25", { sql: "select 2", attempt: 1, dataset: "northwind", structure: "SELECT", stages: ["from"] });
    expect(getExecs("q25").map((e) => e.attempt)).toEqual([1, 0]);
    expect(getSessions("q25").map((s) => s.sql)).toEqual(["select 2", "select 1"]);
    expect(getSessions("q26")).toEqual([]);
  });
});
