// @vitest-environment node
// Proof, on a real PostgreSQL (PGlite), that SQL the policy blocks NEVER executes: after every attempt the table contents, the
// table list, the sequences, the functions and the session settings are unchanged, and a spy on the database shows that the
// blocked SQL was not even sent. Also: the DB-level READ ONLY layer, the policy option of lib/sqlRunner (execute and submit),
// the Playground's unchanged default, and that grading is the same with a policy as without one.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { HIDDEN_ROWS, execute, runRaw, submit, type SqlDb } from "../site/lib/sqlRunner";
import { createDbBackend } from "../site/workspace/adapters/sql/backend";
import { createSqlAdapter, policyOf, type SqlAdapter } from "../site/workspace/adapters/sql/adapter";
import { derivePolicy, NORTHWIND_TABLES } from "../site/workspace/adapters/sql/policy";
import { dailyExerciseToExercise } from "../site/workspace/sources/daily";
import { sqlQuestionToExercise } from "../site/workspace/sources/sql";
import type { ExerciseDef, RunContext } from "../site/workspace/types";

let pg: PGlite;
let spyDb: SqlDb;
let adapter: SqlAdapter;
const execs: string[] = [];

const exercise = (expectedSql: string | null, over: Partial<ExerciseDef> = {}): ExerciseDef => ({
  id: "sql:t", domain: "sql", source: { kind: "authored", id: "t" }, title: "t", difficulty: "Easy", topic: "t", statement: "", objectives: [], concepts: [], starterCode: "", hints: [],
  validation: expectedSql === null ? { kind: "none" } : { kind: "sql-result", expectedSql, orderMatters: false },
  ...over,
});
const ctx = (ex: ExerciseDef): RunContext => ({ exercise: ex });
const READ_ONLY_EX = () => exercise("SELECT 1");
const OWN_TABLES_EX = () => exercise("CREATE TABLE scratch (a int); INSERT INTO scratch VALUES (1); SELECT * FROM scratch");
const OWN_DATA_EX = () => exercise("CREATE TABLE scratch (a int); INSERT INTO scratch VALUES (1); UPDATE scratch SET a = 2; SELECT * FROM scratch");

/** Everything a blocked statement could have changed. Read straight from the database, not through the spy. */
async function snapshot(): Promise<string> {
  const q = async (sql: string) => (await pg.query(sql)).rows;
  return JSON.stringify([
    await q("SELECT n FROM t ORDER BY n"),
    await q("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2"),
    await q("SELECT schemaname, sequencename, last_value FROM pg_sequences ORDER BY 1, 2"),
    await q("SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1"),
    await q("SELECT (SELECT count(*) FROM customers) c, (SELECT count(*) FROM orders) o, (SELECT count(*) FROM order_details) od, (SELECT count(*) FROM products) p, (SELECT count(*) FROM shippers) s, (SELECT sum(unit_price) FROM products) pp"),
    await q("SELECT current_setting('search_path') sp, current_setting('enable_seqscan') es, current_setting('transaction_read_only') ro"),
    await q("SELECT count(*) FROM pg_roles"),
    await q("SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'"),
  ]);
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(northwind);
  await pg.exec(`CREATE TABLE t (n int); INSERT INTO t VALUES (1), (2), (3);
    CREATE SEQUENCE s START 10;
    CREATE FUNCTION bump() RETURNS int LANGUAGE sql AS $$ UPDATE t SET n = n + 100 RETURNING n $$;`);
  spyDb = { exec: (sql, o) => { execs.push(sql); return pg.exec(sql, o) as never; } };
  adapter = createSqlAdapter({ backend: createDbBackend(spyDb) });
}, 90_000);
beforeEach(() => { execs.length = 0; });
afterAll(async () => { await pg.close(); });

/** SQL that must be refused, with the policy level that refuses it. Each is run through every entry point. */
const MUST_REFUSE: string[] = [
  // statements
  "DROP TABLE t", "TRUNCATE t", "DELETE FROM t", "UPDATE t SET n = 0", "ALTER TABLE t ADD COLUMN x int", "CREATE TABLE t2 (a int)", "INSERT INTO t VALUES (9)", "COPY t TO STDOUT", "GRANT ALL ON t TO PUBLIC",
  "CALL bump()", "DO $$ BEGIN DELETE FROM t; END $$", "LOCK TABLE t", "VACUUM t", "SET search_path = evil", "RESET ALL", "SET enable_seqscan = off", "CREATE ROLE evil SUPERUSER", "CREATE EXTENSION dblink",
  // comments, case, separators
  "SELECT 1; DROP TABLE t", "SELECT 1; /* x */ DROP TABLE t", "SELECT 1; -- ;\nDROP TABLE t", "/* a /* nested */ b */ DROP TABLE t", "SELECT 1 /* ; */; DELETE FROM t", "DrOp TaBlE t", "dRoP/**/TABLE t",
  "SELECT 1;\nDROP TABLE t", "SELECT 1\n;DELETE FROM t", "-- a\n/* b */ TRUNCATE t", "SELECT 1; SELECT 2; SELECT 3; DELETE FROM t",
  // strings that turn into code: a standard string ends at the quote, backslash or not
  "SELECT 'a\\'; DROP TABLE t; --'", "SELECT 'x'; DROP TABLE t; SELECT 'y'",
  // transaction control, also behind comments
  "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT a", "/* BEGIN */ BEGIN; DELETE FROM t; COMMIT", "SELECT 1 /* x */; BEGIN; DELETE FROM t", "START TRANSACTION READ WRITE; DELETE FROM t",
  // data-changing and creating through a query
  "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "WITH d AS (INSERT INTO t VALUES (9) RETURNING *) SELECT 1", "WITH d AS (UPDATE t SET n = 0 RETURNING *) SELECT 1",
  "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x", "EXPLAIN ANALYZE DELETE FROM t", "EXPLAIN (ANALYZE) UPDATE t SET n = 0", "EXPLAIN ANALYZE INSERT INTO t VALUES (1)",
  "SELECT * INTO t2 FROM t", "CREATE TABLE t2 AS SELECT * FROM t", "INSERT INTO t SELECT * FROM t", "SELECT * FROM t FOR UPDATE",
  // functions with side effects
  "SELECT nextval('s')", "SELECT setval('s', 1000)", "SELECT pg_catalog.set_config('search_path', 'evil', false)", "SELECT set_config('enable_seqscan', 'off', false)", "SELECT pg_sleep(30)", "SELECT PG_SLEEP(30)",
  "SELECT pg_terminate_backend(1)", "SELECT lo_import('/etc/passwd')", "SELECT lo_unlink(1)", "SELECT pg_advisory_lock(1)", "SELECT query_to_xml('delete from t', true, true, '')", "SELECT pg_notify('c', 'x')",
  "SELECT * FROM dblink('x', 'delete from t') AS r(a int)", "SELECT pg_read_file('/etc/passwd')", "SELECT 1 WHERE (SELECT nextval('s')) > 0", "WITH a AS (SELECT nextval('s')) SELECT * FROM a", 'SELECT "nextval"(\'s\')',
  // look-alike characters and unreadable input
  "SELECT 1; DELETE FROM t", "DROP TABLE t", "SELECT 1;​DROP TABLE t", "SELECT 1; \u0000 DROP TABLE t", "SELECT 'unterminated; DROP TABLE t", "SELECT 1 /* unterminated ; DROP TABLE t",
  // nothing to run
  "", "   \n\t ", "-- just a comment", ";", "/* x */",
  // very long
  `SELECT ${"1,".repeat(60_000)}1; DROP TABLE t`,
];

describe("blocked statements never execute (read-only exercise)", () => {
  for (const sql of MUST_REFUSE) {
    const label = JSON.stringify(sql.length > 60 ? `${sql.slice(0, 57)}...` : sql);
    it(`adapter.run refuses ${label}: nothing sent, nothing changed`, async () => {
      const before = await snapshot();
      const out = await adapter.run(sql, ctx(READ_ONLY_EX()));
      expect(out.status).toBe("error");
      expect(["READ_ONLY", "EMPTY"]).toContain(out.error!.type);
      expect(execs).toEqual([]); // the spy saw no exec at all: not even BEGIN
      expect(await snapshot()).toBe(before);
    });
  }

  it("adapter.validate refuses the same SQL and never grades it (no backend call)", async () => {
    const before = await snapshot();
    for (const sql of MUST_REFUSE.filter((s) => s.trim() && !s.startsWith("--") && !s.startsWith("/*") && s !== ";")) {
      const v = await adapter.validate!(sql, { status: "ok", durationMs: 1 }, ctx(READ_ONLY_EX()));
      expect(v.passed, sql.slice(0, 40)).toBe(false);
    }
    expect(execs).toEqual([]);
    expect(await snapshot()).toBe(before);
  });

  it("lib/sqlRunner.execute with a policy refuses before the first statement (the shared boundary, not only the adapter)", async () => {
    const before = await snapshot();
    for (const sql of MUST_REFUSE) {
      const r = await execute(spyDb, sql, { policy: "read-only" });
      expect(r.success, sql.slice(0, 40)).toBe(false);
      if (sql.trim()) expect(r.error_type, sql.slice(0, 40)).toBe("READ_ONLY");
    }
    expect(execs).toEqual([]);
    expect(await snapshot()).toBe(before);
  });

  it("lib/sqlRunner.submit with a policy refuses before the first statement, for the learner's SQL (the reference is not even run)", async () => {
    const before = await snapshot();
    for (const sql of MUST_REFUSE.filter((s) => s.trim())) {
      const r = await submit(spyDb, sql, "SELECT 1", false, null, HIDDEN_ROWS, { policy: "read-only" });
      expect(r.correct, sql.slice(0, 40)).toBe(false);
      expect(r.message).toMatch(/not allowed|write a query/i);
    }
    expect(execs).toEqual([]);
    expect(await snapshot()).toBe(before);
  });

  it("runRaw with a policy throws a PolicyRefusal and sends nothing", async () => {
    await expect(runRaw(spyDb, "DROP TABLE t", { policy: "read-only" })).rejects.toMatchObject({ name: "PolicyRefusal", readOnly: true });
    expect(execs).toEqual([]);
  });

  it("the refusal explains itself in a plain sentence", async () => {
    const out = await adapter.run("DELETE FROM t", ctx(READ_ONLY_EX()));
    expect(out.error!.message).toMatch(/DELETE statements change data/);
    expect(out.error!.message).toMatch(/graded and read-only/);
    const fn = await adapter.run("SELECT nextval('s')", ctx(READ_ONLY_EX()));
    expect(fn.error!.message).toMatch(/nextval\(\)/);
  });
});

describe("what looks dangerous but is only text still runs, and changes nothing", () => {
  const harmless = [
    "SELECT 'DROP TABLE t' AS note", "SELECT 'a; DELETE FROM t; --' AS note", "SELECT $$; DROP TABLE t; $$ AS note", "SELECT $tag$ DELETE FROM t; $tag$ AS note", "SELECT E'a\\'; DROP TABLE t; --' AS note",
    'SELECT "select", "DROP" FROM (SELECT 1 AS "select", 2 AS "DROP") q', "SELECT 'é; ünïcödé 日本語; DROP TABLE t' AS note", "SELECT n -- DELETE FROM t\nFROM t ORDER BY n", "SELECT /* DROP TABLE t */ n FROM t ORDER BY n",
    "SELECT 1 /* a /* nested ; DROP TABLE t */ still comment */", "SELECT n FROM t WHERE n > 1 ORDER BY n", "EXPLAIN SELECT * FROM t", "EXPLAIN ANALYZE SELECT * FROM t",
    "SHOW search_path", "SELECT * FROM generate_series(1, 3)", "SELECT now() IS NOT NULL AS ok",
  ];
  for (const sql of harmless) {
    it(`runs ${JSON.stringify(sql.slice(0, 60))}`, async () => {
      const before = await snapshot();
      const out = await adapter.run(sql, ctx(READ_ONLY_EX()));
      expect(out.status, out.error?.message).toBe("ok");
      expect(await snapshot()).toBe(before);
    });
  }
  it("a read-only run goes through a READ ONLY transaction that is always rolled back", async () => {
    await adapter.run("SELECT n FROM t", ctx(READ_ONLY_EX()));
    const joined = execs.join(" || ");
    expect(execs.filter((e) => /^BEGIN$/.test(e))).toHaveLength(1);
    expect(joined).toContain("SET TRANSACTION READ ONLY");
    expect(execs.indexOf("ROLLBACK")).toBeGreaterThan(execs.indexOf("BEGIN"));
    expect(execs.findIndex((e) => e === "SET TRANSACTION READ ONLY")).toBeGreaterThan(execs.indexOf("BEGIN")); // the runner's own, inside the transaction
  });
});

describe("the database itself is the second layer for read-only exercises", () => {
  it("a user function the policy cannot judge is stopped by PostgreSQL's READ ONLY transaction", async () => {
    const before = await snapshot();
    const out = await adapter.run("SELECT bump()", ctx(READ_ONLY_EX())); // the policy passes it: bump() is not on any list
    expect(out.status).toBe("error");
    expect(out.error!.message).toMatch(/read-only transaction/i);
    expect(execs.some((e) => /bump\(\)/.test(e))).toBe(true); // it was sent, and refused by PostgreSQL
    expect(await snapshot()).toBe(before);
  });
  it("trailing garbage reaches PostgreSQL only as a syntax error (token tier + READ ONLY), and changes nothing", async () => {
    const before = await snapshot();
    const out = await adapter.run("SELECT 1 garbage garbage", ctx(READ_ONLY_EX()));
    expect(out.status).toBe("error");
    expect(out.error!.message).toMatch(/syntax error/i);
    expect(await snapshot()).toBe(before);
  });
  it("a syntax error keeps PostgreSQL's own message and line in a graded exercise", async () => {
    const out = await adapter.run("SELECT n\nFROM t\nWHERE n = = 1", ctx(READ_ONLY_EX()));
    expect(out.error!.message).toMatch(/syntax error/i);
    expect(out.error!.line).toBe(3);
  });
});

describe("own-tables and own-data exercises", () => {
  it("run their setup (CREATE, INSERT) and everything is rolled back: no table, no sequence change", async () => {
    const before = await snapshot();
    const script = "CREATE TABLE scratch (id serial PRIMARY KEY, a int); INSERT INTO scratch (a) VALUES (1), (2); CREATE TEMP TABLE tmp AS SELECT * FROM scratch; SELECT count(*) AS n FROM scratch";
    const out = await adapter.run(script, ctx(exercise(script)));
    expect(out.status, out.error?.message).toBe("ok");
    expect(Number(out.table!.rows[0][0])).toBe(2);
    expect(await snapshot()).toBe(before);
    expect((await pg.query("SELECT to_regclass('scratch') r")).rows[0]).toEqual({ r: null });
  });
  it("an error half-way still rolls back what the script already created", async () => {
    const before = await snapshot();
    const out = await adapter.run("CREATE TABLE scratch (a int); INSERT INTO scratch VALUES (1); SELECT nope FROM scratch", ctx(OWN_TABLES_EX()));
    expect(out.status).toBe("error");
    expect(await snapshot()).toBe(before);
  });
  const REFUSED_IN_OWN_TABLES = [
    "INSERT INTO customers (customer_id, company_name) VALUES ('ZZZZZ', 'x')", "INSERT INTO t VALUES (9)", "UPDATE t SET n = 0", "DELETE FROM t", "DELETE FROM customers", "DROP TABLE t", "TRUNCATE t",
    "ALTER TABLE t ADD COLUMN x int", "CREATE INDEX ix ON customers (city)", "CREATE TABLE scratch (a int); UPDATE scratch SET a = 2", "CREATE TABLE scratch (a int); DROP TABLE scratch",
    "CREATE TABLE IF NOT EXISTS customers (a int); INSERT INTO customers VALUES (1)", "CREATE TABLE pg_catalog.evil (a int)", "INSERT INTO pg_catalog.pg_class (relname) VALUES ('x')",
    "COPY t TO STDOUT", "COPY t FROM STDIN", "GRANT ALL ON t TO PUBLIC", "CREATE ROLE evil", "CREATE EXTENSION dblink", "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
    "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT a", "SET search_path = evil", "SELECT nextval('s')", "SELECT setval('s', 99)", "SELECT pg_sleep(30)", "SELECT query_to_xml('drop table t', true, true, '')",
    "CREATE TABLE scratch (a int); INSERT INTO scratch SELECT nextval('s')", "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "EXPLAIN ANALYZE DELETE FROM t", "DO $$ BEGIN DELETE FROM t; END $$", "CALL bump()",
    "SELECT 1; /* x */ DROP TABLE t", "CREATE TABLE scratch (a int); -- ;\nDROP TABLE t", "SELECT 'a\\'; DROP TABLE t; --'", "SELECT 1 garbage garbage",
  ];
  for (const sql of REFUSED_IN_OWN_TABLES) {
    it(`own-tables refuses ${JSON.stringify(sql.slice(0, 60))} before it reaches the database`, async () => {
      const before = await snapshot();
      const out = await adapter.run(sql, ctx(OWN_TABLES_EX()));
      expect(out.status).toBe("error");
      expect(out.error!.type).toBe("SQL_POLICY");
      expect(execs).toEqual([]);
      expect(await snapshot()).toBe(before);
    });
  }
  it("own-data allows UPDATE and DELETE on its own table, never on a base table, and DROP only where the reference does it", async () => {
    const before = await snapshot();
    const ok = await adapter.run("CREATE TABLE scratch (a int); INSERT INTO scratch VALUES (1); UPDATE scratch SET a = 2; DELETE FROM scratch WHERE a = 2; SELECT count(*) FROM scratch", ctx(OWN_DATA_EX()));
    expect(ok.status, ok.error?.message).toBe("ok");
    for (const bad of ["UPDATE products SET unit_price = 0", "DELETE FROM order_details", "CREATE TABLE scratch (a int); DROP TABLE scratch", "TRUNCATE customers"]) {
      execs.length = 0;
      const r = await adapter.run(bad, ctx(OWN_DATA_EX()));
      expect(r.error!.type, bad).toBe("SQL_POLICY");
      expect(execs, bad).toEqual([]);
    }
    expect(await snapshot()).toBe(before);
  });
  it("the grants a reference needs let its learner do exactly that, rolled back (a DML lesson on a base table)", async () => {
    const ex = exercise("DELETE FROM order_details WHERE quantity = 1; SELECT COUNT(*) AS lines_left FROM order_details");
    const before = await snapshot();
    const ok = await adapter.run("DELETE FROM order_details WHERE quantity <= 2; SELECT COUNT(*) AS lines_left FROM order_details", ctx(ex));
    expect(ok.status, ok.error?.message).toBe("ok");
    const bad = await adapter.run("DELETE FROM orders", ctx(ex));
    expect(bad.error!.type).toBe("SQL_POLICY");
    expect(await snapshot()).toBe(before);
  });
  it("validate grades an own-tables answer like the grader does, and refuses a forbidden one without grading", async () => {
    const ex = OWN_TABLES_EX();
    const good = "CREATE TABLE scratch (a int); INSERT INTO scratch VALUES (1); SELECT * FROM scratch";
    const v = await adapter.validate!(good, await adapter.run(good, ctx(ex)), ctx(ex));
    expect(v.passed).toBe(true);
    execs.length = 0;
    const bad = await adapter.validate!("DROP TABLE t", { status: "ok", durationMs: 1 }, ctx(ex));
    expect(bad.passed).toBe(false);
    expect(bad.tests.some((t) => t.name === "Only the statements this exercise allows" && !t.passed)).toBe(true);
    expect(execs).toEqual([]);
  });
});

describe("the Playground and every existing caller are unchanged", () => {
  it("execute without a policy still runs anything and rolls it back; no READ ONLY, no policy check", async () => {
    const before = await snapshot();
    const r = await execute(spyDb, "DELETE FROM t; SELECT count(*) FROM t");
    expect(r.success).toBe(true);
    expect(Number(r.rows[0][0])).toBe(0);
    expect(execs.some((e) => /READ ONLY/.test(e))).toBe(false);
    expect(await snapshot()).toBe(before);
  });
  it("the runner still refuses transaction control with or without a policy", async () => {
    expect((await execute(spyDb, "COMMIT")).message).toMatch(/Transaction control/);
    expect((await execute(spyDb, "BEGIN; DELETE FROM t", { policy: "own-data" })).success).toBe(false);
  });
  it("an ungraded exercise without a declared policy may still write (rolled back); one that asks to be read-only may not", async () => {
    const before = await snapshot();
    expect((await adapter.run("DELETE FROM t", ctx(exercise(null)))).status).toBe("ok");
    expect((await adapter.run("DELETE FROM t", ctx(exercise(null, { sqlPolicy: "read-only" })))).error!.type).toBe("READ_ONLY");
    expect((await adapter.run("DELETE FROM t", ctx(exercise(null, { readOnly: true })))).error!.type).toBe("READ_ONLY");
    const ownTables = await adapter.run("CREATE TEMP TABLE x (a int); INSERT INTO x VALUES (1); DELETE FROM t", ctx(exercise(null, { sqlPolicy: "own-tables" })));
    expect(ownTables.error!.type).toBe("SQL_POLICY");
    expect(await snapshot()).toBe(before);
  });
  it("an explicit sqlPolicy wins over the derived one", async () => {
    expect((await policyOf(exercise("SELECT 1", { sqlPolicy: "own-tables" })))!.level).toBe("own-tables");
    expect((await policyOf(exercise("CREATE TABLE s (a int); INSERT INTO s VALUES (1); SELECT * FROM s", { sqlPolicy: "read-only" })))!.level).toBe("read-only");
    expect((await policyOf(exercise("SELECT 1")))!.level).toBe("read-only");
    expect(await policyOf(exercise(null))).toBeNull();
  });
});

describe("grading is the same with a policy as without one", () => {
  const q = import.meta.glob("../../public/data/q/*.json", { eager: true, import: "default" }) as Record<string, never>;
  const days = import.meta.glob("../site/content/daily/days/*.json", { eager: true, import: "default" }) as Record<string, { id: string; guided?: unknown[]; independent?: unknown[] }>;
  const questions = Object.values(q).map((x) => sqlQuestionToExercise(x));
  const daily = Object.values(days).flatMap((d) => (["guided", "independent"] as const).flatMap((sec) => (d[sec] ?? []).map((e) => dailyExerciseToExercise(d.id, e as never, {}, sec))).filter((e) => e && e.domain === "sql")) as ExerciseDef[];
  const v = (e: ExerciseDef) => e.validation as Extract<ExerciseDef["validation"], { kind: "sql-result" }>;

  /** The reference as the answer, graded by the shared grader with its derived policy, against the same call without a policy. */
  async function parity(list: ExerciseDef[]) {
    const diffs: string[] = [];
    let correct = 0;
    for (const e of list) {
      const spec = await policyOf(e);
      const without = await submit(pg as unknown as SqlDb, v(e).expectedSql, v(e).expectedSql, v(e).orderMatters ?? false, (v(e).orderBy as never) ?? null, HIDDEN_ROWS);
      const withPolicy = await submit(pg as unknown as SqlDb, v(e).expectedSql, v(e).expectedSql, v(e).orderMatters ?? false, (v(e).orderBy as never) ?? null, HIDDEN_ROWS, { policy: spec! });
      if (without.correct !== withPolicy.correct || without.message !== withPolicy.message) diffs.push(`${e.id}: ${without.correct}/${without.message} vs ${withPolicy.correct}/${withPolicy.message}`);
      if (withPolicy.correct) correct++;
    }
    return { diffs, correct };
  }

  it("all 150 questions: the reference is graded exactly as before (correct, same message)", async () => {
    const before = await snapshot();
    const r = await parity(questions);
    expect(r.diffs).toEqual([]);
    expect(r.correct).toBe(150); // every reference passes as the answer, with and without the policy
    expect(await snapshot()).toBe(before);
  }, 240_000);

  it("all 387 Daily SQL exercises: the reference is graded exactly as before", async () => {
    const before = await snapshot();
    const r = await parity(daily);
    expect(r.diffs).toEqual([]);
    expect(r.correct).toBeGreaterThan(300);
    expect(await snapshot()).toBe(before);
  }, 480_000);

  it("through the adapter: a representative set of questions and setup exercises run and validate with their derived policy", async () => {
    const pick = [...questions.filter((e) => e.source.kind === "sql-question" && [1, 6, 19, 62, 150, 184, 188, 190, 191, 197].includes(e.source.number)), ...daily.filter((e) => ["d044#g4", "d057#g4", "e124#g3", "e135#i1", "e150#g3", "a165#i2", "e171#g3", "d052#g3", "e112#g3"].includes(e.id.replace("daily:", "")))];
    expect(pick.length).toBeGreaterThanOrEqual(15);
    const before = await snapshot();
    for (const e of pick) {
      const out = await adapter.run(v(e).expectedSql, ctx(e));
      expect(out.status, `${e.id}: ${out.error?.message}`).toBe("ok");
      const val = await adapter.validate!(v(e).expectedSql, out, ctx(e));
      expect(val.passed, `${e.id}: ${val.feedback?.[0]?.message}`).toBe(true);
    }
    expect(await snapshot()).toBe(before);
  }, 120_000);

  it("a wrong learner answer is still marked wrong, and a correct different answer still passes (Q62)", async () => {
    const e = questions.find((x) => x.source.kind === "sql-question" && x.source.number === 62)!;
    const wrong = "SELECT CONCAT(m.first_name,' ',m.last_name) AS employee_name FROM employees e LEFT JOIN employees m ON e.reports_to = m.employee_id GROUP BY m.first_name, m.last_name";
    const right = "SELECT CONCAT(m.first_name,' ',m.last_name) AS employee_name FROM employees m WHERE EXISTS (SELECT 1 FROM employees e WHERE e.reports_to = m.employee_id)";
    expect((await adapter.validate!(wrong, await adapter.run(wrong, ctx(e)), ctx(e))).passed).toBe(false);
    expect((await adapter.validate!(right, await adapter.run(right, ctx(e)), ctx(e))).passed).toBe(true);
  });

  it("a read-only graded answer with hidden test rows: the hidden INSERTs are trusted setup, the learner's SQL runs READ ONLY after them", async () => {
    const e = exercise("SELECT customer_id FROM customers WHERE country = 'France' ORDER BY 1", { validation: { kind: "sql-result", expectedSql: "SELECT customer_id FROM customers WHERE country = 'France' ORDER BY 1", orderMatters: true, orderBy: [{ column: "customer_id", desc: false }] } });
    const spec = (await policyOf(e))!;
    execs.length = 0;
    const r = await submit(spyDb, "SELECT customer_id FROM customers WHERE country = 'France' ORDER BY 1", v(e).expectedSql, true, [{ column: "customer_id", desc: false }], HIDDEN_ROWS, { policy: spec });
    expect(r.correct).toBe(true);
    const iSetup = execs.findIndex((x) => x.includes("INSERT INTO customers"));
    const iRo = execs.findIndex((x, i) => i > iSetup && x === "SET TRANSACTION READ ONLY");
    expect(iSetup).toBeGreaterThan(-1);
    expect(iRo).toBeGreaterThan(iSetup);
    expect(execs.filter((x) => x === "ROLLBACK").length).toBeGreaterThanOrEqual(2);
  });
});

describe("the app's backend carries the policy to the shared runner", () => {
  it("browserBackend: with a policy it checks through lib/sqlRunner on the app's worker handle; without one it uses runQuery as before", async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock("../site/lib/browserDb", () => ({
      QUERY_TIMEOUT_MS: 8000,
      getDb: async () => ({ db: { exec: (sql: string) => { calls.push(`exec:${sql}`); return Promise.resolve([{ rows: [], fields: [] }]); } }, terminate: () => undefined }),
      resetDb: () => undefined,
      runQuery: async (sql: string) => { calls.push(`runQuery:${sql}`); return { success: true, columns: [], rows: [] }; },
      submitQuery: async () => ({ correct: true, message: "", feedback: [], level_changed: false }),
    }));
    const { browserBackend } = await import("../site/workspace/adapters/sql/backend");
    const refused = await browserBackend.run("DROP TABLE t", "northwind", { policy: "read-only" });
    expect(refused).toMatchObject({ success: false, error_type: "READ_ONLY" });
    expect(calls).toEqual([]); // not even the worker was asked
    await browserBackend.run("SELECT 1", "northwind");
    expect(calls).toEqual(["runQuery:SELECT 1"]);
    calls.length = 0;
    await browserBackend.run("SELECT 1", "northwind", { policy: "read-only" });
    expect(calls.some((c) => c.includes("SET TRANSACTION READ ONLY"))).toBe(true);
    expect(calls.some((c) => c.startsWith("runQuery"))).toBe(false);
    vi.doUnmock("../site/lib/browserDb");
  });
});

describe("derived policy sanity on the base table list", () => {
  it("the protected table names include Northwind's", async () => {
    const d = await derivePolicy("SELECT 1", NORTHWIND_TABLES);
    expect(d.spec.protectedTables).toEqual([...NORTHWIND_TABLES]);
  });
});
