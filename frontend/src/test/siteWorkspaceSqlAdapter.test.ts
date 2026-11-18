// @vitest-environment node
// The SQL ExecutionAdapter, against a real PostgreSQL (PGlite) with the Northwind data. No result is mocked: every row,
// count and verdict below comes from the same runner and grader the practice pages use (lib/sqlRunner.ts).
import { Worker } from "node:worker_threads";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { HIDDEN_ROWS, execute, submit, type SqlDb } from "../site/lib/sqlRunner";
import { createDbBackend } from "../site/workspace/adapters/sql/backend";
import { SQL_CAPABILITIES, SQL_LIMITATIONS, createSqlAdapter, submitDetail, type SqlAdapter } from "../site/workspace/adapters/sql/adapter";
import { READ_ONLY_PREFIX, checkReadOnly } from "../site/workspace/adapters/sql/safety";
import { adapterModule } from "../site/workspace/adapters/sql";
import type { ExerciseDef, RunContext, RunOutcome } from "../site/workspace/types";

let pg: PGlite;
let slowPg: SqlDb & { close(): Promise<void> };
let db: SqlDb;
let adapter: SqlAdapter;
const queries: string[] = [];

beforeAll(async () => {
  pg = new PGlite();
  slowPg = workerDb();
  await pg.exec(northwind);
  db = pg as unknown as SqlDb;
  const backend = createDbBackend(db);
  adapter = createSqlAdapter({ backend: { ...backend, run: (sql, ds) => { queries.push(sql); return backend.run(sql, ds); } } });
}, 90_000);

/**
 * A real PGlite in its own thread, like the app's PGliteWorker. A PGlite on the test's own thread blocks it while a query runs,
 * so a timeout or an abort could never fire; in a worker the caller stays free, which is the situation these paths exist for.
 */
function workerDb(): SqlDb & { close(): Promise<void> } {
  const worker = new Worker(`
    const { parentPort } = require("node:worker_threads");
    const ready = import("${process.cwd()}/node_modules/@electric-sql/pglite/dist/index.js").then(async ({ PGlite }) => { const p = new PGlite(); await p.waitReady; return p; });
    parentPort.on("message", async ({ id, sql, options }) => {
      try { const p = await ready; parentPort.postMessage({ id, result: await p.exec(sql, options) }); }
      catch (e) { parentPort.postMessage({ id, error: { message: e.message, position: e.position } }); }
    });`, { eval: true });
  let n = 0;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: unknown) => void }>();
  worker.on("message", (m: { id: number; result?: unknown; error?: { message: string; position?: string } }) => {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p?.reject(Object.assign(new Error(m.error.message), { position: m.error.position }));
    else p?.resolve(m.result as never);
  });
  return {
    exec: (sql, options) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve: resolve as never, reject }); worker.postMessage({ id, sql, options }); }),
    close: async () => { await worker.terminate(); },
  };
}

const exercise = (expectedSql: string | null, over: Partial<ExerciseDef> = {}, orderMatters = false): ExerciseDef => ({
  id: "sql:test", domain: "sql", source: { kind: "authored", id: "test" }, title: "t", difficulty: "Easy", topic: "t", statement: "", objectives: [], concepts: [], starterCode: "", hints: [],
  validation: expectedSql === null ? { kind: "none" } : { kind: "sql-result", expectedSql, orderMatters },
  ...over,
});
const ctx = (ex: ExerciseDef, signal?: AbortSignal): RunContext => ({ exercise: ex, signal });
const count = async (table: string) => Number((await execute(db, `SELECT COUNT(*) FROM ${table}`)).rows[0][0]);

afterAll(async () => { await slowPg.close(); });

describe("capabilities and shape", () => {
  it("declares exactly the capabilities the engine has", () => {
    expect([...adapter.capabilities].sort()).toEqual(["compare", "plan", "reset", "run", "stages", "stepBack", "submit"]);
    expect([...SQL_CAPABILITIES].sort()).toEqual([...adapter.capabilities].sort());
  });
  it("does not claim capabilities it does not have", () => {
    for (const c of ["trace", "variables", "callStack", "beforeAfter", "shapes"] as const) expect(adapter.capabilities.has(c)).toBe(false);
  });
  it("is the sql domain, with run, validate, visualize, explainFailure and a limitations list", () => {
    expect(adapter.domain).toBe("sql");
    for (const f of ["run", "validate", "visualize", "explainFailure", "reset"] as const) expect(typeof adapter[f]).toBe("function");
    expect(adapter.limitations!.length).toBeGreaterThan(5);
    expect(adapter.limitations!.join(" ")).toMatch(/correlated/i);
    expect(adapter.limitations!.join(" ")).toMatch(/read-only/i);
    expect(SQL_LIMITATIONS.length).toBe(adapter.limitations!.length);
  });
  it("is found through the adapter module convention", () => {
    expect(adapterModule.getAdapter("sql").domain).toBe("sql");
    expect(adapterModule.Visualizer).toBeTruthy();
  });
  it("reset asks the backend to drop the exercise's dataset", async () => {
    const seen: string[] = [];
    const a = createSqlAdapter({ backend: createDbBackend(db, { onReset: (d) => seen.push(d) }) });
    await a.reset(ctx(exercise("SELECT 1")));
    await a.reset(ctx(exercise("SELECT 1", { dataset: { id: "shop", label: "Shop" } })));
    expect(seen).toEqual(["northwind", "shop"]);
  });
});

describe("run: execution on the real runner", () => {
  it("returns real rows, the column names and a duration", async () => {
    const out = await adapter.run("SELECT customer_id, country FROM customers ORDER BY customer_id LIMIT 3", ctx(exercise(null)));
    const direct = await execute(db, "SELECT customer_id, country FROM customers ORDER BY customer_id LIMIT 3");
    expect(out.status).toBe("ok");
    expect(out.table!.columns).toEqual(["customer_id", "country"]);
    expect(out.table!.rows).toEqual(direct.rows);
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });
  it("reports a syntax error as an error with its line", async () => {
    const out = await adapter.run("SELECT customer_id\nFROM customers\nWHERE country = = 'France'", ctx(exercise("SELECT 1")));
    expect(out.status).toBe("error");
    expect(out.error!.message).toMatch(/syntax error/i);
    expect(out.error!.line).toBe(3);
    expect(out.table).toBeUndefined();
  });
  it("an empty query is an error, not a run", async () => {
    const out = await adapter.run("   ", ctx(exercise(null)));
    expect(out.status).toBe("error");
    expect(out.error!.type).toBe("EMPTY");
  });
  it("rolls everything back: a DELETE in an ungraded exercise leaves the data as it was", async () => {
    const before = await count("order_details");
    const out = await adapter.run("DELETE FROM order_details", ctx(exercise(null)));
    expect(out.status).toBe("ok");
    expect(await count("order_details")).toBe(before);
  });
  it("rolls back sequence changes too", async () => {
    const [{ rows: [[seq]] }] = [await execute(db, "SELECT last_value FROM pg_sequences WHERE sequencename = (SELECT sequencename FROM pg_sequences LIMIT 1)")];
    await adapter.run("SELECT 1", ctx(exercise(null)));
    const after = await execute(db, "SELECT last_value FROM pg_sequences WHERE sequencename = (SELECT sequencename FROM pg_sequences LIMIT 1)");
    expect(after.rows[0][0]).toEqual(seq);
  });
  it("maps a long query to a timeout (real pg_sleep, not a fake)", async () => {
    const a = createSqlAdapter({ backend: createDbBackend(slowPg, { timeoutMs: 150 }) });
    const out = await a.run("SELECT pg_sleep(0.8)", ctx(exercise(null)));
    expect(out.status).toBe("timeout");
    expect(out.error!.message).toMatch(/longer than/);
  });
  it("an abort signal gives status stopped, before and during a run", async () => {
    const before = new AbortController(); before.abort();
    expect((await adapter.run("SELECT 1", ctx(exercise(null), before.signal))).status).toBe("stopped");
    const a = createSqlAdapter({ backend: createDbBackend(slowPg) });
    const during = new AbortController();
    const pending = a.run("SELECT pg_sleep(0.5)", ctx(exercise(null), during.signal));
    setTimeout(() => during.abort(), 50);
    expect((await pending).status).toBe("stopped");
  });
  it("opens graded runs as a READ ONLY transaction (PostgreSQL itself refuses writes)", async () => {
    const r = await execute(db, `${READ_ONLY_PREFIX}DELETE FROM order_details`);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/read-only transaction/i);
    expect(await count("order_details")).toBeGreaterThan(0);
  });
  it("a graded run still returns the right rows and error positions after the READ ONLY prefix", async () => {
    const ok = await adapter.run("SELECT COUNT(*) AS n FROM customers", ctx(exercise("SELECT COUNT(*) AS n FROM customers")));
    expect(ok.status).toBe("ok");
    expect(Number(ok.table!.rows[0][0])).toBe(await count("customers"));
    const bad = await adapter.run("SELECT 1 FROM nowhere", ctx(exercise("SELECT 1")));
    expect(bad.error!.message).toMatch(/relation "nowhere" does not exist/);
    expect(bad.error!.line).toBe(1);
  });
});

describe("destructive statements in graded exercises", () => {
  const graded = exercise("SELECT 1");
  const attacks: [string, string][] = [
    ["DELETE", "DELETE FROM customers"],
    ["DROP", "DROP TABLE customers"],
    ["TRUNCATE", "TRUNCATE order_details"],
    ["UPDATE", "UPDATE products SET unit_price = 0"],
    ["INSERT", "INSERT INTO customers (customer_id, company_name) VALUES ('ZZZZZ','x')"],
    ["ALTER", "ALTER TABLE customers ADD COLUMN x int"],
    ["CREATE", "CREATE TABLE t (id int)"],
    ["SELECT INTO", "SELECT * INTO copy_of_customers FROM customers"],
    ["data-changing CTE", "WITH d AS (DELETE FROM order_details RETURNING *) SELECT COUNT(*) FROM d"],
    ["second statement", "SELECT 1; DROP TABLE customers"],
    ["EXPLAIN ANALYZE of a DELETE", "EXPLAIN ANALYZE DELETE FROM customers"],
    ["sequence side effect", "SELECT nextval('orders_order_id_seq')"],
    ["GRANT", "GRANT ALL ON customers TO PUBLIC"],
  ];
  for (const [name, sql] of attacks) {
    it(`run refuses ${name} before it reaches the database`, async () => {
      queries.length = 0;
      const before = await count("customers");
      const out = await adapter.run(sql, ctx(graded));
      expect(out.status).toBe("error");
      expect(out.error!.type).toBe("READ_ONLY");
      expect(out.error!.message).toMatch(/graded and read-only|graded, read-only|read-only/i);
      expect(queries).toEqual([]);
      expect(await count("customers")).toBe(before);
    });
  }
  it("validate refuses it too, with a read-only category, and never grades", async () => {
    const before = await count("customers");
    const v = await adapter.validate!("DELETE FROM customers", { status: "ok", durationMs: 1 } as RunOutcome, ctx(graded));
    expect(v.passed).toBe(false);
    expect(v.feedback![0].category).toBe("read-only");
    expect(v.tests.some((t) => t.name.startsWith("Read-only") && !t.passed)).toBe(true);
    expect(await count("customers")).toBe(before);
  });
  it("allows what looks dangerous but is only text", () => {
    expect(checkReadOnly("SELECT 'DROP TABLE customers' AS note").readOnly).toBe(true);
    expect(checkReadOnly("SELECT customer_id -- DELETE FROM customers\nFROM customers").readOnly).toBe(true);
    expect(checkReadOnly('SELECT "update" FROM (SELECT 1 AS "update") t').readOnly).toBe(true);
    expect(checkReadOnly("WITH a AS (SELECT 1) SELECT * FROM a").readOnly).toBe(true);
    expect(checkReadOnly("EXPLAIN (FORMAT JSON) SELECT 1").readOnly).toBe(true);
    expect(checkReadOnly("SELECT 1 UNION SELECT 2").readOnly).toBe(true);
    expect(checkReadOnly("SELECT 1; SELECT 2").readOnly).toBe(true);
  });
  it("a graded 'setup then query' exercise (its reference creates tables) accepts setup statements, rolled back, and is graded by the existing grader", async () => {
    const ref = "CREATE TABLE scratch_t (id int, v int); INSERT INTO scratch_t VALUES (1, 10), (2, 20); SELECT SUM(v) AS total FROM scratch_t";
    const ex = exercise(ref);
    const out = await adapter.run(ref, ctx(ex));
    expect(out.status).toBe("ok");
    expect(Number(out.table!.rows[0][0])).toBe(30);
    const v = await adapter.validate!(ref, out, ctx(ex));
    const direct = await submit(db, ref, ref, false, null, HIDDEN_ROWS);
    expect(v.passed).toBe(direct.correct);
    expect(v.passed).toBe(true);
    const gone = await execute(db, "SELECT * FROM scratch_t");
    expect(gone.success).toBe(false); // rolled back: the table was never kept
    expect(await adapter.visualize!(ref, out, ctx(ex))).toBeNull();
  });
  it("an ungraded exercise may write (it is rolled back), unless it asks to be read-only", async () => {
    expect((await adapter.run("UPDATE products SET unit_price = 1", ctx(exercise(null)))).status).toBe("ok");
    const refused = await adapter.run("UPDATE products SET unit_price = 1", ctx({ ...exercise(null), readOnly: true } as ExerciseDef));
    expect(refused.error!.type).toBe("READ_ONLY");
  });
});

describe("validate: parity with the existing grading", () => {
  const REF = "SELECT customer_id, company_name FROM customers WHERE country = 'France' ORDER BY customer_id";
  const cases: [string, string, boolean][] = [
    ["the reference itself", REF, true],
    ["a different but equivalent query", "SELECT customer_id, company_name FROM customers WHERE country IN ('France') ORDER BY 1", true],
    ["rows missing (too strict)", "SELECT customer_id, company_name FROM customers WHERE country = 'France' AND city = 'Paris'", false],
    ["extra rows (no WHERE)", "SELECT customer_id, company_name FROM customers", false],
    ["wrong columns", "SELECT customer_id FROM customers WHERE country = 'France'", false],
    ["a runtime error", "SELECT customer_id, nope FROM customers", false],
  ];
  for (const [name, sql, expected] of cases) {
    it(`${name}: same verdict and numbers as sqlRunner.submit`, async () => {
      const ex = exercise(REF);
      const outcome = await adapter.run(sql, ctx(ex));
      const v = await adapter.validate!(sql, outcome, ctx(ex));
      const direct = await submit(db, sql, REF, false, null, HIDDEN_ROWS);
      expect(v.passed).toBe(direct.correct);
      expect(v.passed).toBe(expected);
      const detail = submitDetail(v);
      if (outcome.status === "ok") {
        expect(detail!.message).toBe(direct.message);
        expect(detail!.your_row_count).toBe(direct.your_row_count);
        expect(detail!.expected_row_count).toBe(direct.expected_row_count);
        expect(detail!.diff ?? null).toEqual(direct.diff ?? null);
      }
    });
  }
  it("a correct answer has three passing tests, the last of them hidden", async () => {
    const ex = exercise(REF);
    const v = await adapter.validate!(REF, await adapter.run(REF, ctx(ex)), ctx(ex));
    expect(v.tests.map((t) => [t.name, t.passed, Boolean(t.hidden)])).toEqual([["The query runs", true, false], ["Matches the expected result", true, false], ["Hidden test data", true, true]]);
    expect(v.feedback).toEqual([]);
  });
  it("hidden test data: a hard-coded value passes the sample and fails the hidden rows, exactly as the grader says", async () => {
    const ref = "SELECT order_id FROM orders WHERE order_date = (SELECT MAX(order_date) FROM orders) ORDER BY 1";
    const latest = String((await execute(db, "SELECT MAX(order_date)::text FROM orders")).rows[0][0]).slice(0, 10);
    const hardCoded = `SELECT order_id FROM orders WHERE order_date = '${latest}' ORDER BY 1`;
    const ex = exercise(ref);
    const v = await adapter.validate!(hardCoded, await adapter.run(hardCoded, ctx(ex)), ctx(ex));
    const direct = await submit(db, hardCoded, ref, false, null, HIDDEN_ROWS);
    expect(direct.hidden_failed).toBe(true);
    expect(v.passed).toBe(false);
    expect(v.tests.find((t) => t.name === "Matches the expected result")!.passed).toBe(true);
    expect(v.tests.find((t) => t.hidden)!.passed).toBe(false);
    expect(v.feedback!.map((f) => f.category)).toContain("hidden test");
    expect(v.feedback!.map((f) => f.category)).toContain("filtering");
  });
  it("orderMatters and orderBy go through to the grader", async () => {
    const ref = "SELECT customer_id FROM customers ORDER BY customer_id DESC";
    const wrongOrder = "SELECT customer_id FROM customers ORDER BY customer_id";
    const ex = exercise(ref, { validation: { kind: "sql-result", expectedSql: ref, orderMatters: true, orderBy: [{ column: "customer_id", desc: true }] } });
    const v = await adapter.validate!(wrongOrder, await adapter.run(wrongOrder, ctx(ex)), ctx(ex));
    const direct = await submit(db, wrongOrder, ref, true, [{ column: "customer_id", desc: true }], HIDDEN_ROWS);
    expect(direct.correct).toBe(false);
    expect(v.passed).toBe(false);
    expect(v.feedback![0].category).toBe("ordering");
    expect(v.feedback![0].suggestion).toMatch(/Expected order: ORDER BY customer_id DESC/);
  });
  it("an exercise with no grading: validate only says whether the query ran", async () => {
    const ex = exercise(null);
    const ok = await adapter.validate!("SELECT 1", await adapter.run("SELECT 1", ctx(ex)), ctx(ex));
    expect(ok.passed).toBe(true);
    expect(ok.tests).toHaveLength(1);
    const bad = await adapter.validate!("SELEC 1", await adapter.run("SELEC 1", ctx(ex)), ctx(ex));
    expect(bad.passed).toBe(false);
    expect(bad.feedback![0].category).toBe("syntax");
  });
  it("a custom dataset is graded without hidden rows (Northwind only), as in browserDb.submitQuery", async () => {
    const ex = exercise(REF, { dataset: { id: "shop", label: "Shop" } });
    const v = await adapter.validate!(REF, await adapter.run(REF, ctx(ex)), ctx(ex));
    expect(v.passed).toBe(true);
    expect(v.tests.some((t) => t.hidden)).toBe(false);
  });
});

describe("explainFailure: categories from evidence", () => {
  const cat = async (userSql: string, refSql = "SELECT 1", ex = exercise(refSql)) => {
    const outcome = await adapter.run(userSql, ctx(ex));
    const v = await adapter.validate!(userSql, outcome, ctx(ex));
    return { outcome, v, items: adapter.explainFailure!(userSql, outcome, v, ctx(ex)) };
  };
  const cats = (items: { category: string }[]) => items.map((i) => i.category);

  it("syntax: PostgreSQL's own message, with the line", async () => {
    const { items, outcome } = await cat("SELECT customer_id\nFROM customers\nWHERE country = = 'x'");
    expect(items[0].category).toBe("syntax");
    expect(items[0].message).toMatch(/syntax error/);
    expect(items[0].line).toBe(outcome.error!.line);
  });
  it("grouping: a column that is neither grouped nor aggregated", async () => {
    const { items } = await cat("SELECT country, city, COUNT(*) FROM customers GROUP BY country");
    expect(items[0].category).toBe("grouping");
    expect(items[0].suggestion).toMatch(/GROUP BY/);
  });
  it("aggregation: an aggregate in WHERE", async () => {
    const { items } = await cat("SELECT country FROM customers WHERE COUNT(*) > 2 GROUP BY country");
    expect(items[0].category).toBe("aggregation");
    expect(items[0].suggestion).toMatch(/HAVING/);
  });
  it("window logic: a window function in WHERE", async () => {
    const { items } = await cat("SELECT product_name FROM products WHERE RANK() OVER (ORDER BY unit_price) = 1");
    expect(items[0].category).toBe("window logic");
  });
  it("join logic: an ambiguous column after a join", async () => {
    const { items } = await cat("SELECT customer_id FROM customers c JOIN orders o ON o.customer_id = c.customer_id");
    expect(items[0].category).toBe("join logic");
  });
  it("join logic is NOT claimed for an ambiguity message when the SQL has no join", () => {
    const f = adapter.explainFailure!("SELECT customer_id FROM customers", { status: "error", durationMs: 0, error: { message: 'column reference "customer_id" is ambiguous' } }, null, ctx(exercise("SELECT 1")));
    expect(f[0].category).toBe("other");
  });
  it("NULL handling: division by zero points at NULLIF", async () => {
    const { items } = await cat("SELECT 1 / 0 AS x");
    expect(items[0].category).toBe("NULL handling");
    expect(items[0].suggestion).toMatch(/NULLIF/);
  });
  it("names that do not exist are reported as name errors, not guessed further", async () => {
    const { items } = await cat("SELECT nope FROM customers");
    expect(items[0].category).toBe("syntax");
    expect(items[0].message).toMatch(/could not resolve a name/);
  });
  it("performance: a timeout, with a cross join named only when it is in the SQL", async () => {
    const a = createSqlAdapter({ backend: createDbBackend(slowPg, { timeoutMs: 100 }) });
    // Ungraded on purpose: pg_sleep is refused in graded exercises since the SQL policy (docs/WORKSPACE_SQL_SAFETY.md).
    const ex = exercise(null);
    const sql = "SELECT pg_sleep(0.6) FROM generate_series(1,1) a CROSS JOIN generate_series(1,1) b";
    const outcome = await a.run(sql, ctx(ex));
    expect(outcome.status).toBe("timeout");
    const items = a.explainFailure!(sql, outcome, null, ctx(ex));
    expect(items[0].category).toBe("performance");
    expect(items[0].suggestion).toMatch(/cross join/i);
    const plain = a.explainFailure!("SELECT pg_sleep(5)", outcome, null, ctx(ex));
    expect(plain[0].suggestion).not.toMatch(/cross join/i);
  });
  it("an error with no known rule is 'other', never a guessed category", () => {
    const f = adapter.explainFailure!("SELECT (SELECT customer_id FROM customers) AS x", { status: "error", durationMs: 0, error: { message: "more than one row returned by a subquery used as an expression" } }, null, ctx(exercise("SELECT 1")));
    expect(f[0].category).toBe("other");
  });

  const REF_FR = "SELECT customer_id FROM customers WHERE country = 'France'";
  it("filtering: extra rows only, and the SQL has no WHERE", async () => {
    const { items } = await cat("SELECT customer_id FROM customers", REF_FR);
    expect(cats(items)).toEqual(["filtering"]);
    expect(items[0].message).toMatch(/every expected row plus \d+ extra/);
    expect(items[0].message).toMatch(/there is no WHERE/);
  });
  it("filtering: missing rows only; an INNER JOIN adds a hedged join-logic hint", async () => {
    const { items } = await cat("SELECT c.customer_id FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE c.country = 'France' GROUP BY c.customer_id", REF_FR);
    expect(cats(items)).toEqual(["filtering", "join logic"]);
    expect(items[1].message).toMatch(/^Possible/);
  });
  it("join logic: duplicate rows from a join (fan-out), with otherwise the right rows", async () => {
    const ref = "SELECT c.customer_id FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)";
    const { items } = await cat("SELECT c.customer_id FROM customers c JOIN orders o ON o.customer_id = c.customer_id", ref);
    expect(items[0].category).toBe("join logic");
    expect(items[0].message).toMatch(/duplicate rows/);
  });
  it("grouping: duplicate rows without any join point at DISTINCT or GROUP BY", async () => {
    const ref = "SELECT DISTINCT country FROM customers";
    const { items } = await cat("SELECT country FROM customers", ref);
    expect(items[0].category).toBe("grouping");
  });
  it("NULL handling: a total that is NULL where the reference has 0", async () => {
    const ref = "SELECT c.customer_id, COALESCE(SUM(o.freight), 0) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.customer_id";
    const user = "SELECT c.customer_id, SUM(o.freight) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.customer_id";
    const { items } = await cat(user, ref);
    expect(cats(items)).toContain("NULL handling");
    expect(items.find((i) => i.category === "NULL handling")!.message).toMatch(/NULL vs 0/);
  });
  it("aggregation: rows that differ only by rounding", async () => {
    const ref = "SELECT category_id, ROUND(AVG(unit_price)::numeric, 2) AS a FROM products GROUP BY category_id";
    const user = "SELECT category_id, AVG(unit_price)::numeric AS a FROM products GROUP BY category_id";
    const { items } = await cat(user, ref);
    expect(items[0].category).toBe("aggregation");
    expect(items[0].message).toMatch(/rounding/);
  });
  it("output columns: names, order or count differ", async () => {
    const { items } = await cat("SELECT company_name, customer_id FROM customers WHERE country = 'France'", "SELECT customer_id, company_name FROM customers WHERE country = 'France'");
    expect(items[0].category).toBe("output columns");
  });
  it("a correct answer gets no failure items", async () => {
    const { items, v } = await cat(REF_FR, REF_FR);
    expect(v.passed).toBe(true);
    expect(items).toEqual([]);
  });
  it("NULL handling from the SQL text, only because the answer is wrong", async () => {
    const wrong = await cat("SELECT customer_id FROM customers WHERE region = NULL", "SELECT customer_id FROM customers WHERE region IS NULL");
    expect(cats(wrong.items)).toContain("NULL handling");
    expect(wrong.items.find((i) => i.category === "NULL handling")!.message).toMatch(/^Found in your SQL/);
    const right = await cat("SELECT customer_id FROM customers WHERE region IS NULL", "SELECT customer_id FROM customers WHERE region IS NULL");
    expect(right.items).toEqual([]);
  });
  it("window logic is only suggested when the SQL has a window and the rows differ", async () => {
    const ref = "SELECT product_id, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS r FROM products";
    const user = "SELECT product_id, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS r FROM products";
    const { items } = await cat(user, ref);
    expect(cats(items)).toContain("window logic");
    expect(items.find((i) => i.category === "window logic")!.message).toMatch(/^Possible/);
  });
});
