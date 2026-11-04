// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { compareResults } from "../site/lib/resultCompare";
import { execute, runRaw, submit, type SqlDb } from "../site/lib/sqlRunner";
import type { Question } from "../site/types";
import { parseLesson } from "../site/lib/frontmatter";

const questionFiles = import.meta.glob<Question>("../../public/data/q/*.json", { eager: true, import: "default" });
const loadQ = (slug: string): Question => {
  const hit = Object.entries(questionFiles).find(([p]) => p.endsWith(`/${slug}.json`));
  if (!hit) throw new Error(`missing ${slug}`);
  return hit[1];
};

let db: SqlDb;

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  db = pg as unknown as SqlDb;
}, 60_000);

describe("compareResults", () => {
  it("ignores row order when sort is not required", () => {
    const r = compareResults(["a"], [[2], [1]], ["a"], [[1], [2]], false);
    expect(r.match).toBe(true);
  });

  it("enforces row order when sort is required", () => {
    const r = compareResults(["a"], [[2], [1]], ["a"], [[1], [2]], true);
    expect(r.match).toBe(false);
  });

  it("treats numeric strings and numbers as equal", () => {
    expect(compareResults(["x"], [["10.50"]], ["x"], [[10.5]]).match).toBe(true);
  });

  it("accepts any order among rows tied on the ORDER BY key", () => {
    const keys = [{ column: "n", desc: true }];
    const expected = [["a", 3], ["b", 1], ["c", 1]];
    expect(compareResults(["id", "n"], [["a", 3], ["c", 1], ["b", 1]], ["id", "n"], expected, true, keys).match).toBe(true);
    expect(compareResults(["id", "n"], [["b", 1], ["a", 3], ["c", 1]], ["id", "n"], expected, true, keys).match).toBe(false);
  });

  it("flags column name differences", () => {
    const r = compareResults(["name"], [[1]], ["company_name"], [[1]]);
    expect(r.match).toBe(false);
    expect(r.feedback[0]).toMatch(/column names/);
  });
});

describe("sqlRunner on Northwind", () => {
  it("runs a query and returns columns + rows", async () => {
    const r = await execute(db, "SELECT category_name FROM categories ORDER BY category_id LIMIT 2");
    expect(r.success).toBe(true);
    expect(r.columns).toEqual(["category_name"]);
    expect(r.rows).toHaveLength(2);
  });

  it("returns SQL errors without throwing", async () => {
    const r = await execute(db, "SELECT nope FROM categories");
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/nope/);
  });

  it("rolls back writes so the data stays intact", async () => {
    await execute(db, "DELETE FROM orders");
    const r = await execute(db, "SELECT COUNT(*) AS n FROM orders");
    expect(Number(r.rows[0][0])).toBeGreaterThan(0);
  });

  it("accepts the reference solution for Q01", async () => {
    const q = loadQ("q01-product-revenue");
    const r = await submit(db, q.referenceQuery, q.referenceQuery, q.sortRequired);
    expect(r.correct).toBe(true);
  });

  it("accepts a Q25 answer with an extra tie-breaker in ORDER BY", async () => {
    const q = loadQ("q25-customers-and-order-count");
    const sql = `SELECT cu.customer_id, cu.company_name, COUNT(o.order_id) AS order_count
      FROM customers cu LEFT JOIN orders o ON o.customer_id = cu.customer_id
      GROUP BY cu.customer_id, cu.company_name ORDER BY order_count DESC, cu.customer_id DESC`;
    const r = await submit(db, sql, q.referenceQuery, q.sortRequired, q.orderBy ?? null);
    expect(r.correct).toBe(true);
  });

  it("rejects the recorded buggy attempt for Q83 ('employee' label)", async () => {
    const q = loadQ("q83-master-contact-directory");
    const buggy = q.mySolution.replace(/;\s*$/, "");
    const r = await submit(db, buggy, q.referenceQuery, q.sortRequired);
    expect(r.correct).toBe(false);
  });
});

describe("transaction guard", () => {
  const db = {
    exec: async (sql: string) => (/pg_sequences/.test(sql) ? [{ fields: [], rows: [] }] : [{ fields: [{ name: "x" }], rows: [[1]] }]),
  } as unknown as SqlDb;
  it("allows savepoints and CASE … END", async () => {
    await expect(runRaw(db, "SAVEPOINT a; DELETE FROM t; ROLLBACK TO SAVEPOINT a; SELECT 1;")).resolves.toBeTruthy();
    await expect(runRaw(db, "SELECT CASE WHEN 1=1 THEN 1 END;")).resolves.toBeTruthy();
    await expect(runRaw(db, "CREATE TEMP TABLE t (x int) ON COMMIT DROP; SELECT 1;")).resolves.toBeTruthy();
  });
  it("blocks statements that end the wrapper transaction", async () => {
    for (const sql of ["COMMIT;", "ROLLBACK;", "SELECT 1; END;", "BEGIN; SELECT 1;"]) {
      await expect(runRaw(db, sql)).rejects.toThrow(/not allowed/);
    }
  });
});

const lessonFiles = import.meta.glob<string>("../site/content/lessons/*.md", { eager: true, query: "?raw", import: "default" });

describe("lesson exercises", () => {
  const exercises = Object.entries(lessonFiles).flatMap(([path, raw]) =>
    parseLesson(raw, path).segments.flatMap((s) => (s.kind === "exercise" ? [{ path, ex: s.exercise }] : [])),
  );
  it("has exercises", () => expect(exercises.length).toBeGreaterThan(40));
  it("every solution runs in the browser DB, returns rows, and grades itself correct", async () => {
    const bad: string[] = [];
    for (const { path, ex } of exercises) {
      const run = await execute(db, ex.solution);
      if (!run.success || !run.row_count) {
        bad.push(`${path}#${ex.index}: ${run.message ?? "0 rows"}`);
        continue;
      }
      const r = await submit(db, ex.solution, ex.solution, Boolean(ex.orderBy), ex.orderBy);
      if (!r.correct) bad.push(`${path}#${ex.index}: self-grade ${r.message}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
