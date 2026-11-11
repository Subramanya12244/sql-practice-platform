// @vitest-environment node
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { DE_SCENARIOS } from "../site/lib/lab/deContent";
import { DQ_EXERCISES } from "../site/lib/lab/dqContent";
import { DIMENSIONS, profileSql, qualityScore, readProfile, type GuidedExercise } from "../site/lib/lab/guided";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { runSqlTask, type PythonTask, type SqlTask } from "../site/lib/tasks";

const python = spawnSync("python3", ["--version"]).status === 0;
const fresh = async (setup: string) => { const pg = new PGlite(); if (setup) await pg.exec(setup); return pg as unknown as SqlDb; };
const run = (db: SqlDb) => (sql: string) => execute(db, sql);
const runPy = (code: string) => spawnSync("python3", ["-I", "-c", code], { encoding: "utf8", timeout: 20_000 });

const all: [string, GuidedExercise][] = [...DQ_EXERCISES, ...DE_SCENARIOS].map((e) => [e.id, e]);

describe("content shape", () => {
  it("ids are unique and every exercise is fully written", () => {
    expect(new Set(all.map(([id]) => id)).size).toBe(all.length);
    for (const [id, e] of all) {
      expect(e.requirements.length, id).toBeGreaterThan(0);
      expect(e.criteria.length, id).toBeGreaterThan(0);
      expect(e.explanation.length, id).toBeGreaterThan(80);
      expect(e.context.length, id).toBeGreaterThan(30);
      expect(e.expected.length, id).toBeGreaterThan(10);
      expect(e.task.id, id).toBe(e.id);
    }
  });
  it("the quality lab covers all five dimensions with SQL and Python, and there are ten engineering scenarios", () => {
    expect([...new Set(DQ_EXERCISES.map((e) => e.dimension))].sort()).toEqual([...DIMENSIONS].sort());
    expect(DQ_EXERCISES.filter((e) => e.task.type === "sql").length).toBeGreaterThanOrEqual(10);
    expect(DQ_EXERCISES.filter((e) => e.task.type === "python").length).toBeGreaterThanOrEqual(2);
    expect(DE_SCENARIOS).toHaveLength(10);
  });
});

describe("every SQL exercise: the worked solution passes the real runner, the starter fails", () => {
  for (const [id, e] of all.filter(([, x]) => x.task.type === "sql")) {
    it(id, async () => {
      const t = e.task as SqlTask;
      const good = await runSqlTask(t, t.solution, run(await fresh(e.setup)));
      expect(good, `${id}: solution should pass`).toMatchObject({ ok: true });
      const starter = await runSqlTask(t, t.starter, run(await fresh(e.setup)));
      expect(starter.ok, `${id}: starter must not pass (${starter.message})`).toBe(false);
    }, 60_000);
  }
});

describe.skipIf(!python)("every Python exercise runs in CPython: the solution passes visible and hidden tests, the starter fails", () => {
  for (const [id, e] of all.filter(([, x]) => x.task.type === "python")) {
    it(id, () => {
      const t = e.task as PythonTask;
      const ok = runPy(`${t.solution}\n${t.tests}\n${t.hidden ?? ""}`);
      expect(ok.status, ok.stderr).toBe(0);
      const starter = runPy(`${t.starter}\n${t.tests}`);
      expect(starter.status).not.toBe(0);
      expect(starter.stderr).toMatch(/NotImplementedError|AssertionError/);
    });
  }
});

describe("a plausible wrong answer is rejected with a useful message", () => {
  it("an extra id, a missing id and an unrelated table are all caught", async () => {
    const e = DQ_EXERCISES.find((x) => x.id === "dq-find-dups")!, t = e.task as SqlTask;
    const wrong = await runSqlTask(t, "CREATE TABLE dup_customers AS SELECT customer_id FROM raw_customers WHERE customer_id = 6;", run(await fresh(e.setup)));
    expect(wrong).toMatchObject({ ok: false, message: "Expected ids 6 and 7." });
    const empty = await runSqlTask(t, "CREATE TABLE dup_customers (customer_id integer);", run(await fresh(e.setup)));
    expect(empty.ok).toBe(false);
    const nothing = await runSqlTask(t, "SELECT 1", run(await fresh(e.setup)));
    expect(nothing.ok).toBe(false);
  }, 60_000);
  it("the naive idempotency answer (plain INSERT) doubles the data and fails", async () => {
    const e = DE_SCENARIOS.find((x) => x.id === "de-idempotent")!, t = e.task as SqlTask;
    expect((await runSqlTask(t, "INSERT INTO tgt_items SELECT * FROM stg_items;", run(await fresh(e.setup)))).ok).toBe(false);
    expect((await runSqlTask(t, "TRUNCATE tgt_items; INSERT INTO tgt_items SELECT * FROM stg_items;", run(await fresh(e.setup)))).ok).toBe(true);
  }, 60_000);
  it("the upsert scenario also accepts an equivalent approach (UPDATE then INSERT)", async () => {
    const e = DE_SCENARIOS.find((x) => x.id === "de-batch-upsert")!, t = e.task as SqlTask;
    const alt = "UPDATE dw_sales d SET amount = s.amount FROM stg_sales s WHERE s.sale_id = d.sale_id; INSERT INTO dw_sales SELECT s.* FROM stg_sales s WHERE NOT EXISTS (SELECT 1 FROM dw_sales d WHERE d.sale_id = s.sale_id);";
    expect((await runSqlTask(t, alt, run(await fresh(e.setup)))).ok).toBe(true);
  }, 60_000);
});

describe("before and after quality scores", () => {
  it("scoring: completeness and uniqueness, half each", () => {
    expect(qualityScore({ rows: 0, nullCells: 0, cells: 0, distinctRows: 0 }).score).toBe(0);
    expect(qualityScore({ rows: 10, nullCells: 0, cells: 50, distinctRows: 10 })).toEqual({ score: 100, completeness: 100, uniqueness: 100 });
    expect(qualityScore({ rows: 10, nullCells: 10, cells: 50, distinctRows: 5 })).toEqual({ score: 65, completeness: 80, uniqueness: 50 });
  });
  it("deduplicating customers lifts the score from 90 to 95, measured on the real tables", async () => {
    const e = DQ_EXERCISES.find((x) => x.id === "dq-dedupe")!, t = e.task as SqlTask;
    const db = await fresh(e.setup);
    const before = await execute(db, profileSql(e.profile!.before));
    expect(before.success).toBe(true);
    expect(qualityScore(readProfile(before.rows[0])).score).toBe(90);
    const after = await execute(await fresh(e.setup), `${t.solution}\n${profileSql(e.profile!.after)}`);
    expect(after.success).toBe(true);
    expect(qualityScore(readProfile(after.rows[0])).score).toBe(95);
  }, 60_000);
  it("filling missing countries removes the NULL and the profile sees it", async () => {
    const e = DQ_EXERCISES.find((x) => x.id === "dq-fill-country")!, t = e.task as SqlTask;
    const b = readProfile((await execute(await fresh(e.setup), profileSql(e.profile!.before))).rows[0]);
    const a = readProfile((await execute(await fresh(e.setup), `${t.solution}\n${profileSql(e.profile!.after)}`)).rows[0]);
    expect(b.nullCells).toBe(1);
    expect(a.nullCells).toBe(0);
    expect(qualityScore(a).score).toBeGreaterThan(qualityScore(b).score);
  }, 60_000);
  it("every exercise with a profile has a before table that exists and after columns the solution creates", async () => {
    for (const e of DQ_EXERCISES.filter((x) => x.profile && x.task.type === "sql")) {
      const t = e.task as SqlTask;
      const r = await execute(await fresh(e.setup), `${t.solution}\n${profileSql(e.profile!.before)}`);
      const r2 = await execute(await fresh(e.setup), `${t.solution}\n${profileSql(e.profile!.after)}`);
      expect(r.success && r2.success, e.id).toBe(true);
    }
  }, 120_000);
});
