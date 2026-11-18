// @vitest-environment node
// The SQL capability policy (workspace/adapters/sql/policy.ts), read only: no database is involved here. What the policy lets
// through and what it stops, for every policy level, plus the derivation of a policy from an exercise's own reference query
// over ALL 150 SQL questions and ALL 387 Daily SQL exercises. The database proofs (blocked SQL is never sent, nothing changes)
// are in siteWorkspaceSqlSafetyDb.test.ts.
import { describe, expect, it } from "vitest";
import { checkSqlPolicy, checkSqlPolicyLexical, derivePolicy, isDeniedFunction, NORTHWIND_TABLES, type PolicyOption } from "../site/workspace/adapters/sql/policy";
import { lex } from "../site/workspace/adapters/sql/lexer";
import { checkReadOnly, isSingleQuery } from "../site/workspace/adapters/sql/safety";
import { dailyExerciseToExercise } from "../site/workspace/sources/daily";
import { sqlQuestionToExercise } from "../site/workspace/sources/sql";
import type { SqlPolicy } from "../site/workspace/types";

const allowed = async (sql: string, p: PolicyOption) => (await checkSqlPolicy(sql, p)).allowed;
const why = async (sql: string, p: PolicyOption) => (await checkSqlPolicy(sql, p)).reasons.join(" | ");

describe("lexer: PostgreSQL's lexical rules", () => {
  const texts = (sql: string) => lex(sql).tokens.map((t) => `${t.kind}:${t.text}`);
  it("skips line comments, nested block comments and keeps real tokens", () => {
    expect(texts("SELECT 1 -- ; DROP\n, 2 /* a /* ; */ b */ , 3")).toEqual(["word:select", "number:1", "punct:,", "number:2", "punct:,", "number:3"]);
  });
  it("reads standard strings, E strings, dollar quotes and quoted identifiers as single tokens", () => {
    expect(lex("SELECT 'it''s; DROP', E'a\\'b;c', $$x;y$$, $t$ ; $$ $t$, \"a\"\";b\"").tokens.map((t) => t.kind)).toEqual(["word", "string", "punct", "string", "punct", "string", "punct", "string", "punct", "qident"]);
  });
  it("a backslash does not escape in a standard string, but does in an E string", () => {
    expect(lex("SELECT 'a\\'; DROP TABLE t; --'").tokens.filter((t) => t.kind === "punct" && t.text === ";").length).toBe(2); // 'a\' is the whole string: the rest is code
    expect(lex("SELECT E'a\\'; DROP TABLE t; --'").tokens.filter((t) => t.kind === "punct" && t.text === ";").length).toBe(0); // one string
  });
  it("unquoted words fold to lower case, quoted ones keep their case", () => {
    const t = lex('DrOp "DROP"').tokens;
    expect([t[0].text, t[1].text, t[1].kind]).toEqual(["drop", "DROP", "qident"]);
  });
  it("refuses what it cannot read with certainty", () => {
    for (const bad of ["SELECT 'open", "SELECT /* open", 'SELECT "open', "SELECT $$ open", "SELECT 1\0", "SELECT 1", "SELECT 1", "SELECT　1", "SELECT​1", "SELECT 1 ﻿", "SELECT \\ 1 # $"]) {
      expect(lex(bad).error, JSON.stringify(bad)).toBeTruthy();
    }
  });
  it("refuses a very long input", () => { expect(lex(`SELECT ${"1,".repeat(60_000)}1`).error).toMatch(/longer than/); });
  it("does not treat a - or / inside an operator run as a comment start incorrectly", () => {
    expect(texts("SELECT 1<-1")).toEqual(["word:select", "number:1", "op:<", "op:-", "number:1"]);
  });
});

describe("read-only: what is allowed", () => {
  const ok = [
    "SELECT 1", "select * from customers", "WITH a AS (SELECT 1) SELECT * FROM a", "VALUES (1), (2)", "(SELECT 1) UNION (SELECT 2)",
    "SELECT * FROM generate_series(1, 3)", "SELECT 1; SELECT 2", "SELECT 1;", "SELECT 1 -- trailing comment\n", "SHOW search_path", "SET TRANSACTION READ ONLY; SELECT 1",
    "EXPLAIN SELECT 1", "EXPLAIN ANALYZE SELECT * FROM customers", "EXPLAIN (FORMAT JSON, ANALYZE) SELECT 1", "EXPLAIN (COSTS OFF) SELECT customer_id FROM customers WHERE customer_id = 'ALFKI'",
    "SELECT 'DROP TABLE customers' AS note", "SELECT 'a;b; DELETE FROM t'", "SELECT $$; DROP TABLE t; $$", "SELECT $tag$ DELETE FROM t $tag$", "SELECT E'a\\'; DROP TABLE t; --'",
    'SELECT "select", "DROP" FROM (SELECT 1 AS "select", 2 AS "DROP") q', 'SELECT "update" FROM (SELECT 1 AS "update") t', "SELECT 'é; ünïcödé 日本語'",
    "SELECT customer_id -- DELETE FROM customers\nFROM customers", "SELECT /* DROP TABLE t */ 1", "SELECT 1 /* a /* nested ; */ DROP */",
    "SELECT SUM(x) OVER (ORDER BY x ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM (SELECT 1 AS x) q", // the parser cannot read this: the token tier and READ ONLY take it
    "WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r WHERE n < 3) SELECT * FROM r",
    "SELECT a FROM (SELECT 1 AS a) q WHERE a IS DISTINCT FROM 2",
  ];
  for (const sql of ok) it(`allows ${JSON.stringify(sql).slice(0, 80)}`, async () => { expect(await why(sql, "read-only")).toBe(""); expect(await allowed(sql, "read-only")).toBe(true); });
});

describe("read-only: what is refused", () => {
  const bad: [string, string][] = [
    ["DROP TABLE t", "DROP"], ["drop table t", "DROP"], ["DrOp TaBlE t", "DROP"], ["TRUNCATE t", "TRUNCATE"], ["DELETE FROM t", "DELETE"], ["UPDATE t SET a = 1", "UPDATE"],
    ["ALTER TABLE t ADD COLUMN x int", "ALTER"], ["CREATE TABLE t (a int)", "CREATE"], ["CREATE TEMP TABLE t (a int)", "CREATE"], ["CREATE VIEW v AS SELECT 1", "CREATE"], ["CREATE INDEX i ON t (a)", "CREATE"],
    ["INSERT INTO t VALUES (1)", "INSERT"], ["MERGE INTO t USING s ON t.a = s.a WHEN MATCHED THEN DELETE", "MERGE"],
    ["COPY t TO STDOUT", "COPY"], ["COPY t FROM STDIN", "COPY"], ["GRANT ALL ON t TO PUBLIC", "GRANT"], ["REVOKE ALL ON t FROM PUBLIC", "REVOKE"],
    ["SET search_path = x", "SET"], ["SET LOCAL enable_seqscan = off", "SET"], ["RESET ALL", "RESET"], ["SET ROLE postgres", "SET ROLE"], ["SET TRANSACTION READ WRITE", "SET"],
    ["BEGIN", "BEGIN"], ["COMMIT", "COMMIT"], ["ROLLBACK", "ROLLBACK"], ["SAVEPOINT a", "SAVEPOINT"], ["START TRANSACTION", "START"], ["END", "END"], ["SELECT 1; BEGIN", "BEGIN"],
    ["DO $$ BEGIN DROP TABLE t; END $$", "DO"], ["CALL p()", "CALL"], ["LOCK TABLE t", "LOCK"], ["VACUUM", "VACUUM"], ["ANALYZE t", "ANALYZE"], ["REINDEX TABLE t", "REINDEX"], ["CLUSTER t", "CLUSTER"],
    ["CREATE EXTENSION dblink", "CREATE"], ["CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql", "CREATE"], ["PREPARE p AS SELECT 1", "PREPARE"], ["LISTEN x", "LISTEN"], ["NOTIFY x", "NOTIFY"], ["CHECKPOINT", "CHECKPOINT"], ["DISCARD ALL", "DISCARD"],
    ["WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "data-changing"], ["WITH d AS (INSERT INTO t VALUES (1) RETURNING *) SELECT 1", "data-changing"], ["WITH d AS (UPDATE t SET a = 1 RETURNING *) SELECT 1", "data-changing"],
    ["WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x", "INSERT"], ["WITH x AS (SELECT 1) DELETE FROM t", "DELETE"],
    ["EXPLAIN ANALYZE DELETE FROM t", "DELETE"], ["EXPLAIN DELETE FROM t", "DELETE"], ["EXPLAIN (ANALYZE) UPDATE t SET a = 0", "UPDATE"], ["EXPLAIN ANALYZE INSERT INTO t VALUES (1)", "INSERT"], ["EXPLAIN ANALYZE SELECT * INTO t2 FROM t", "INTO"],
    ["SELECT * INTO t2 FROM t", "INTO"], ["SELECT 1 INTO t2", "INTO"], ["CREATE TABLE t2 AS SELECT 1", "CREATE"], ["INSERT INTO t SELECT * FROM s", "INSERT"],
    ["SELECT 1 FROM t FOR UPDATE", "lock"], ["SELECT 1 FROM t FOR SHARE", "lock"],
    ["SELECT nextval('s')", "nextval"], ["SELECT setval('s', 1)", "setval"], ["SELECT pg_sleep(10)", "pg_sleep"], ["SELECT PG_SLEEP(1)", "pg_sleep"], ["SELECT pg_catalog.set_config('search_path', 'x', false)", "set_config"],
    ["SELECT pg_terminate_backend(1)", "pg_terminate_backend"], ["SELECT lo_unlink(1)", "lo_unlink"], ["SELECT lo_import('/etc/passwd')", "lo_import"], ["SELECT * FROM dblink('x', 'select 1') AS t(a int)", "dblink"],
    ["SELECT pg_advisory_lock(1)", "pg_advisory_lock"], ["SELECT pg_read_file('/etc/passwd')", "pg_read_file"], ["SELECT query_to_xml('delete from t', true, true, '')", "query_to_xml"], ["SELECT pg_notify('c', 'x')", "pg_notify"],
    ['SELECT "nextval"(\'s\')', "nextval"], ["SELECT 1 WHERE (SELECT nextval('s')) > 0", "nextval"], ["WITH a AS (SELECT nextval('s')) SELECT * FROM a", "nextval"],
    ["SELECT 1; DROP TABLE t", "DROP"], ["SELECT 1; /* x */ DROP TABLE t", "DROP"], ["SELECT 1; -- ;\nDROP TABLE t", "DROP"], ["/* a /* b */ c */ DROP TABLE t", "DROP"], ["SELECT 1 /* ; */; DELETE FROM t", "DELETE"],
    ["SELECT 1;\nDROP TABLE t", "DROP"], ["SELECT 1\n;DROP TABLE t", "DROP"], ["-- a\n/* b */ DELETE FROM t", "DELETE"], ["SELECT 'a\\'; DROP TABLE t; --'", "DROP"],
    ["DROP/**/TABLE t", "DROP"], ["/* BEGIN */ BEGIN; DROP TABLE t; COMMIT", "BEGIN"], ["SELECT 1 /* x */; BEGIN; DELETE FROM t", "BEGIN"],
    ["SELECT 1; DROP TABLE t", "look-alike"], ["DROP TABLE t", "look-alike"], ["SELECT 1;​DROP TABLE t", "look-alike"], ["SELECT 1; \u0000 DROP TABLE t", "NUL"],
    ["ＤＲＯＰ TABLE t", "graded"],
    ["", "no SQL statement"], ["   \n\t ", "no SQL statement"], ["-- only a comment", "no SQL statement"], [";", "no SQL statement"], ["/* x */", "no SQL statement"],
    ["SELECT 'unterminated", "never closed"], ["SELECT /* unterminated", "never closed"],
  ];
  for (const [sql, needle] of bad) {
    it(`refuses ${JSON.stringify(sql).slice(0, 70)}`, async () => {
      const v = await checkSqlPolicy(sql, "read-only");
      expect(v.allowed, v.reasons.join(" | ")).toBe(false);
      expect(v.reasons.join(" | ").toLowerCase()).toContain(needle.toLowerCase());
    });
  }
  it("every refusal of a read-only exercise says it is graded and read-only", async () => {
    for (const [sql] of bad.filter(([s]) => s.trim() && !/^--|^\/\*|^;$/.test(s.trim()))) {
      const r = (await checkSqlPolicy(sql, "read-only")).reasons.join(" ");
      expect(r.toLowerCase(), sql).toMatch(/read-only|graded|look-alike|never closed|NUL/i);
    }
  });
  it("trailing garbage after a valid statement is refused by the parser, and read by the token tier only for read-only (PostgreSQL then rejects it)", async () => {
    expect(await allowed("SELECT 1 garbage garbage", "read-only")).toBe(true); // reaches PostgreSQL's READ ONLY transaction, which answers with a syntax error
    expect(await allowed("SELECT 1 garbage garbage", "own-tables")).toBe(false);
    expect(await why("SELECT 1 garbage garbage", "own-tables")).toMatch(/could not be checked/);
    expect(await allowed("SELECT 1 DROP TABLE t", "read-only")).toBe(false); // a bare DROP in a query is refused by the token gate
  });
  it("a very long input is refused", async () => {
    expect(await allowed(`SELECT ${"1,".repeat(60_000)}1`, "read-only")).toBe(false);
  });
  it("many statements are checked one by one: the one bad statement among a hundred is found", async () => {
    const script = `${Array.from({ length: 100 }, (_, i) => `SELECT ${i}`).join(";\n")};\nDELETE FROM t`;
    const v = await checkSqlPolicy(script, "read-only");
    expect(v.allowed).toBe(false);
    expect(v.statements).toBe(101);
  });
});

describe("own-tables and own-data", () => {
  const level = (l: SqlPolicy): PolicyOption => ({ level: l });
  it("own-tables: queries, CREATE TABLE / VIEW / INDEX, INSERT into tables the same script created", async () => {
    const script = `CREATE TEMP TABLE scratch (a int, b text);
      CREATE INDEX ix ON scratch (a);
      INSERT INTO scratch VALUES (1, 'x'), (2, 'y');
      CREATE VIEW v AS SELECT * FROM scratch;
      CREATE TABLE copy_of AS SELECT * FROM scratch;
      INSERT INTO copy_of SELECT * FROM scratch;
      CREATE MATERIALIZED VIEW mv AS SELECT a FROM scratch;
      REFRESH MATERIALIZED VIEW mv;
      SELECT * FROM v`;
    const v = await checkSqlPolicy(script, level("own-tables"));
    expect(v.reasons).toEqual([]);
    expect(v.created).toEqual(["scratch", "v", "copy_of", "mv"]);
    expect(v.tier).toBe("parsed");
  });
  it("tracks created names in order: INSERT before CREATE is refused", async () => {
    expect(await allowed("INSERT INTO s VALUES (1); CREATE TABLE s (a int)", level("own-tables"))).toBe(false);
    expect(await allowed("CREATE TABLE s (a int); INSERT INTO s VALUES (1)", level("own-tables"))).toBe(true);
  });
  it("folds names like PostgreSQL: unquoted to lower case, quoted keeps its case, schema public is the same table", async () => {
    expect(await allowed('CREATE TABLE Foo (a int); INSERT INTO foo VALUES (1); INSERT INTO FOO VALUES (2); INSERT INTO public.foo VALUES (3)', level("own-tables"))).toBe(true);
    expect(await allowed('CREATE TABLE "Foo" (a int); INSERT INTO "Foo" VALUES (1)', level("own-tables"))).toBe(true);
    expect(await allowed('CREATE TABLE "Foo" (a int); INSERT INTO foo VALUES (1)', level("own-tables"))).toBe(false); // foo is a different table
    expect(await allowed("CREATE TABLE foo (a int); INSERT INTO \"Foo\" VALUES (1)", level("own-tables"))).toBe(false);
    expect(await allowed('CREATE TABLE s (a int); INSERT INTO "s" VALUES (1)', level("own-tables"))).toBe(true);
    expect(await allowed("CREATE TABLE s (a int); INSERT INTO other.s VALUES (1)", level("own-tables"))).toBe(false);
  });
  it("never writes to the practice database's tables, and never to another schema", async () => {
    for (const t of NORTHWIND_TABLES) expect(await allowed(`INSERT INTO ${t} DEFAULT VALUES`, level("own-tables")), t).toBe(false);
    expect(await allowed("INSERT INTO public.customers VALUES ('x')", level("own-tables"))).toBe(false);
    expect(await allowed("CREATE TABLE pg_catalog.x (a int)", level("own-tables"))).toBe(false);
    expect(await allowed("INSERT INTO pg_catalog.pg_class VALUES (1)", level("own-data"))).toBe(false);
    expect(await allowed("CREATE TABLE IF NOT EXISTS customers (a int); INSERT INTO customers VALUES (1)", level("own-tables"))).toBe(false); // would silently target the base table
    expect(await allowed("CREATE INDEX i ON customers (city)", level("own-tables"))).toBe(false);
  });
  it("own-tables refuses UPDATE, DELETE, DROP, TRUNCATE and ALTER of anything", async () => {
    for (const sql of ["UPDATE s SET a = 1", "DELETE FROM s", "DROP TABLE s", "TRUNCATE s", "ALTER TABLE s ADD COLUMN c int", "DROP TABLE IF EXISTS s", "DROP INDEX ix"]) {
      expect(await allowed(`CREATE TABLE s (a int); ${sql}`, level("own-tables")), sql).toBe(false);
    }
  });
  it("own-data adds UPDATE and DELETE on tables the same script created, never on base tables", async () => {
    expect(await allowed("CREATE TABLE s (a int); INSERT INTO s VALUES (1); UPDATE s SET a = 2; DELETE FROM s WHERE a = 2", level("own-data"))).toBe(true);
    expect(await allowed("UPDATE products SET unit_price = 0", level("own-data"))).toBe(false);
    expect(await allowed("DELETE FROM order_details", level("own-data"))).toBe(false);
    expect(await allowed("DELETE FROM s; CREATE TABLE s (a int)", level("own-data"))).toBe(false);
    expect(await allowed("CREATE TABLE s (a int); UPDATE customers SET city = 'x'", level("own-data"))).toBe(false);
  });
  it("own-data still refuses DROP, TRUNCATE and ALTER (even of its own tables) and everything that is never allowed", async () => {
    for (const sql of ["DROP TABLE s", "TRUNCATE s", "ALTER TABLE s ADD COLUMN c int", "DROP TABLE customers", "TRUNCATE order_details", "ALTER TABLE customers ADD COLUMN c int"]) {
      expect(await allowed(`CREATE TABLE s (a int); ${sql}`, level("own-data")), sql).toBe(false);
    }
    for (const l of ["own-tables", "own-data"] as SqlPolicy[]) {
      for (const sql of ["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT a", "COPY s TO STDOUT", "GRANT ALL ON s TO PUBLIC", "CREATE EXTENSION dblink", "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql",
        "SET search_path = x", "DO $$ BEGIN END $$", "CALL p()", "SELECT pg_sleep(1)", "SELECT nextval('s')", "CREATE TABLE s (a int); INSERT INTO s SELECT nextval('q')", "CREATE ROLE r", "ALTER ROLE r SUPERUSER", "VACUUM", "CREATE SCHEMA x", "CREATE SEQUENCE q", "CREATE TYPE e AS ENUM ('a')"]) {
        expect(await allowed(sql, level(l)), `${l}: ${sql}`).toBe(false);
      }
    }
  });
  it("a data-changing CTE on a created table is judged like a statement of its own", async () => {
    const own = "CREATE TABLE s (a int); WITH d AS (INSERT INTO s VALUES (1) RETURNING a) SELECT * FROM d";
    expect(await allowed(own, level("own-tables"))).toBe(true);
    expect(await allowed("CREATE TABLE s (a int); WITH d AS (DELETE FROM s RETURNING a) SELECT * FROM d", level("own-tables"))).toBe(false);
    expect(await allowed("CREATE TABLE s (a int); WITH d AS (DELETE FROM s RETURNING a) SELECT * FROM d", level("own-data"))).toBe(true);
    expect(await allowed("WITH d AS (DELETE FROM customers RETURNING 1) SELECT * FROM d", level("own-data"))).toBe(false);
  });
  it("EXPLAIN ANALYZE of a statement is judged as that statement", async () => {
    expect(await allowed("CREATE TABLE s (a int); EXPLAIN ANALYZE INSERT INTO s VALUES (1)", level("own-tables"))).toBe(true);
    expect(await allowed("EXPLAIN ANALYZE INSERT INTO customers (customer_id) VALUES ('x')", level("own-tables"))).toBe(false);
  });
  it("the parse fallback is for exercises whose own reference cannot be parsed", async () => {
    const sql = "CREATE TABLE s (a int); INSERT INTO s VALUES (1); SELECT sum(a) OVER (ORDER BY a ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM s";
    expect(await allowed(sql, level("own-tables"))).toBe(false);
    expect(await why(sql, level("own-tables"))).toMatch(/could not be checked/);
    const v = await checkSqlPolicy(sql, { level: "own-tables", lexical: true });
    expect(v.allowed).toBe(true);
    expect(v.tier).toBe("lexical");
    expect(await allowed(`${sql}; DROP TABLE s`, { level: "own-tables", lexical: true })).toBe(false); // the same rules apply in the token tier
    expect(await allowed(`${sql}; DELETE FROM customers`, { level: "own-data", lexical: true })).toBe(false);
    expect(await allowed("INSERT INTO s VALUES (1); CREATE TABLE s (a int)", { level: "own-tables", lexical: true })).toBe(false);
  });
});

describe("grants taken from the reference (the lessons that really do this)", () => {
  it("allow exactly the (verb, table) pairs the reference uses", async () => {
    const d = await derivePolicy("DELETE FROM order_details WHERE quantity = 1; SELECT COUNT(*) FROM order_details");
    expect(d.spec.level).toBe("own-tables");
    expect(d.spec.allow).toEqual(["write:delete:order_details"]);
    expect(await allowed("DELETE FROM order_details WHERE quantity = 2", d.spec)).toBe(true);
    expect(await allowed("DELETE FROM customers", d.spec)).toBe(false);
    expect(await allowed("UPDATE order_details SET quantity = 0", d.spec)).toBe(false);
    expect(await allowed("DROP TABLE order_details", d.spec)).toBe(false);
  });
  it("DROP TABLE IF EXISTS of its own scratch table, SET LOCAL enable_seqscan, CREATE INDEX on a base table, a SQL function", async () => {
    const d = await derivePolicy("DROP TABLE IF EXISTS ra; CREATE TABLE ra (a int); CREATE INDEX ix ON orders (order_date); SET LOCAL enable_seqscan = off; EXPLAIN (COSTS OFF) SELECT 1");
    expect(d.spec.allow).toEqual(["ddl:drop:ra", "index:orders", "set:enable_seqscan"]);
    expect(await allowed("DROP TABLE IF EXISTS ra; CREATE TABLE ra (a int)", d.spec)).toBe(true);
    expect(await allowed("DROP TABLE IF EXISTS other_table", d.spec)).toBe(false);
    expect(await allowed("DROP TABLE customers", d.spec)).toBe(false);
    expect(await allowed("SET LOCAL enable_seqscan = on", d.spec)).toBe(true);
    expect(await allowed("SET search_path = evil", d.spec)).toBe(false);
    expect(await allowed("CREATE INDEX ix2 ON products (unit_price)", d.spec)).toBe(false);
    const f = await derivePolicy("CREATE OR REPLACE FUNCTION tot(p int) RETURNS TABLE (a int) LANGUAGE sql AS $$ SELECT p $$; SELECT * FROM tot(1)");
    expect(f.spec.allow).toEqual(["function:tot"]);
    expect(await allowed("CREATE OR REPLACE FUNCTION tot(p int) RETURNS TABLE (a int) LANGUAGE sql AS $$ SELECT p + 1 $$; SELECT * FROM tot(1)", f.spec)).toBe(true);
    expect(await allowed("CREATE OR REPLACE FUNCTION tot(p int) RETURNS TABLE (a int) LANGUAGE sql AS $$ DELETE FROM customers RETURNING 1 $$", f.spec)).toBe(false); // the body is a query or nothing
    expect(await allowed("CREATE FUNCTION other() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$", f.spec)).toBe(false);
    expect(await allowed("CREATE OR REPLACE FUNCTION tot(p int) RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$", f.spec)).toBe(false);
  });
  it("an explicit read-only level carries no grants", async () => {
    expect(await allowed("DELETE FROM order_details", { level: "read-only", allow: ["write:delete:order_details"] })).toBe(false);
  });
});

describe("derivation from the reference query", () => {
  it("read-only when the reference only queries; own-tables when it creates and inserts; own-data only when it changes rows of its own tables", async () => {
    expect((await derivePolicy("SELECT 1")).spec.level).toBe("read-only");
    expect((await derivePolicy("WITH a AS (SELECT 1) SELECT * FROM a")).spec.level).toBe("read-only");
    expect((await derivePolicy("CREATE TABLE s (a int); INSERT INTO s VALUES (1); SELECT * FROM s")).spec.level).toBe("own-tables");
    expect((await derivePolicy("CREATE TABLE s (a int); INSERT INTO s VALUES (1); UPDATE s SET a = 2; SELECT * FROM s")).spec.level).toBe("own-data");
    expect((await derivePolicy("CREATE TABLE s (a int); DELETE FROM s")).spec.level).toBe("own-data");
  });
  it("an unreadable reference gets the strictest policy", async () => {
    const d = await derivePolicy("SELECT 'never closed");
    expect(d.tier).toBe("unreadable");
    expect(d.spec.level).toBe("read-only");
  });

  // Every question and every Daily SQL exercise, through the converters the workspace uses.
  const q = import.meta.glob("../../public/data/q/*.json", { eager: true, import: "default" }) as Record<string, never>;
  const days = import.meta.glob("../site/content/daily/days/*.json", { eager: true, import: "default" }) as Record<string, { id: string; guided?: unknown[]; independent?: unknown[] }>;
  const questions = Object.values(q).map((x) => sqlQuestionToExercise(x));
  const daily = Object.values(days).flatMap((d) =>
    (["guided", "independent"] as const).flatMap((sec) => (d[sec] ?? []).map((e) => dailyExerciseToExercise(d.id, e as never, {}, sec))).filter((e) => e && e.domain === "sql"),
  ) as NonNullable<ReturnType<typeof dailyExerciseToExercise>>[];
  const expectedSql = (e: { validation: { kind: string; expectedSql?: string } }) => (e.validation as { expectedSql: string }).expectedSql;

  it("the corpus is all 150 questions and all 387 Daily SQL exercises", () => {
    expect(questions).toHaveLength(150);
    expect(daily).toHaveLength(387);
  });

  const count = async (list: { validation: { kind: string; expectedSql?: string } }[]) => {
    const by: Record<string, number> = {}, tiers: Record<string, number> = {};
    const refused: string[] = [], problems: string[] = [];
    for (const e of list) {
      const d = await derivePolicy(expectedSql(e), NORTHWIND_TABLES);
      by[d.spec.level] = (by[d.spec.level] ?? 0) + 1;
      tiers[d.tier] = (tiers[d.tier] ?? 0) + 1;
      if (d.problems.length) problems.push(`${(e as { id?: string }).id}: ${d.problems[0]}`);
      const v = await checkSqlPolicy(expectedSql(e), d.spec);
      if (!v.allowed) refused.push(`${(e as { id?: string }).id}: ${v.reasons[0]}`);
    }
    return { by, tiers, refused, problems };
  };

  it("150 SQL questions: every reference passes its own derived policy, none is refused", async () => {
    const r = await count(questions);
    expect(r.refused).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.by).toEqual({ "read-only": 142, "own-tables": 8 }); // the 8 are the DML & DDL questions Q184 to Q191
    expect(r.tiers.parsed + (r.tiers.lexical ?? 0)).toBe(150);
    expect(r.tiers.unreadable).toBeUndefined();
  }, 60_000);

  it("387 Daily SQL exercises: every reference passes its own derived policy, none is refused", async () => {
    const r = await count(daily);
    expect(r.refused).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.by).toEqual({ "read-only": 264, "own-tables": 112, "own-data": 11 });
    expect(r.tiers.unreadable).toBeUndefined();
  }, 60_000);

  it("the DML & DDL questions Q184 to Q191 are own-tables with exact grants for the base tables their references change", async () => {
    const dml = questions.filter((e) => e.source.kind === "sql-question" && e.source.number >= 184 && e.source.number <= 191);
    expect(dml).toHaveLength(8);
    for (const e of dml) {
      const d = await derivePolicy(expectedSql(e), NORTHWIND_TABLES);
      expect(d.spec.level, e.id).toBe("own-tables");
      expect(d.spec.allow!.length, e.id).toBeGreaterThan(0);
    }
    const q184 = await derivePolicy(expectedSql(dml.find((e) => e.source.kind === "sql-question" && e.source.number === 184)!), NORTHWIND_TABLES);
    expect(q184.spec.allow).toEqual(["write:insert:shippers"]);
  });

  it("the policy that a reference gets also accepts what its learners write for it: the solution and mySolution of every question", async () => {
    const refused: string[] = [];
    for (const [, raw] of Object.entries(q) as [string, { number: number; referenceQuery: string; mySolution: string }][]) {
      const d = await derivePolicy(raw.referenceQuery, NORTHWIND_TABLES);
      for (const sql of [raw.mySolution]) {
        const v = await checkSqlPolicy(sql, d.spec);
        if (!v.allowed) refused.push(`Q${raw.number}: ${v.reasons[0]}`);
      }
    }
    // mySolution is the learner's own recorded answer; a handful use syntax the parser cannot read in an exercise whose reference it can.
    expect(refused).toEqual([]);
  }, 60_000);

  it("reports how many references each tier read, so a parser upgrade shows up here", async () => {
    const rq = await count(questions), rd = await count(daily);
    expect(rq.tiers).toEqual({ parsed: 143, lexical: 7 });
    expect(rd.tiers).toEqual({ parsed: 297, lexical: 90 });
  }, 60_000);
});

describe("the synchronous helpers kept for the visualizer", () => {
  it("checkReadOnly keeps the old contract (readOnly, reasons, statements)", () => {
    expect(checkReadOnly("SELECT 'DROP TABLE customers' AS note").readOnly).toBe(true);
    expect(checkReadOnly("SELECT 1; SELECT 2")).toMatchObject({ readOnly: true, statements: 2 });
    expect(checkReadOnly("DELETE FROM t").readOnly).toBe(false);
    expect(checkReadOnly("DELETE FROM t").reasons[0]).toMatch(/read-only/);
  });
  it("isSingleQuery: one query only", () => {
    expect(isSingleQuery("SELECT 1")).toBe(true);
    expect(isSingleQuery("SELECT 1; SELECT 2")).toBe(false);
    expect(isSingleQuery("DELETE FROM t")).toBe(false);
    expect(isSingleQuery("WITH a AS (SELECT 1) SELECT * FROM a")).toBe(true);
  });
  it("the token tier alone gives the same verdict for the plain cases", () => {
    expect(checkSqlPolicyLexical("DROP TABLE t", "read-only").allowed).toBe(false);
    expect(checkSqlPolicyLexical("SELECT 1", "read-only").allowed).toBe(true);
    expect(checkSqlPolicyLexical("CREATE TABLE s (a int); INSERT INTO s VALUES (1)", "own-tables").allowed).toBe(true);
  });
});

describe("denied functions", () => {
  it("names and families", () => {
    for (const n of ["nextval", "setval", "set_config", "pg_sleep", "pg_sleep_for", "lo_import", "lo_unlink", "dblink_exec", "dblink", "pg_advisory_lock", "pg_advisory_xact_lock", "pg_read_file", "pg_ls_dir", "pg_stat_reset", "query_to_xml", "pg_terminate_backend", "PG_SLEEP"]) {
      expect(isDeniedFunction(n), n).toBe(true);
    }
    for (const n of ["now", "random", "count", "sum", "generate_series", "current_setting", "currval", "lastval", "date_trunc", "pg_typeof", "pg_table_size", "pg_get_viewdef", "coalesce"]) {
      expect(isDeniedFunction(n), n).toBe(false);
    }
  });
});
