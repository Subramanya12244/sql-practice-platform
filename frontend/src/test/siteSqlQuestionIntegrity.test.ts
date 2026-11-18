// @vitest-environment node
// Integrity of the SQL question bank (public/data/q/*.json), run on a real PostgreSQL (PGlite) with the Northwind data.
// Each reference query is the query learners are graded against, so a wrong one makes a correct answer fail. This test pins:
//  - every reference runs, and its columns are the ones the problem's output table lists (graded by name and order);
//  - Q19 is graded against its own query (it once held Q197's recursive employee chain: see docs/WORKSPACE_SQL_SAFETY.md);
//  - the 23 questions whose `solution` differs from `mySolution` were each judged (the verdict table below);
//  - no two questions share a reference query.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { HIDDEN_ROWS, execute, submit, type SqlDb } from "../site/lib/sqlRunner";

interface Q { number: number; slug: string; title: string; problem: string; expectedOutput: string; solution: string; mySolution: string; referenceQuery: string; sortRequired: boolean; orderBy: { column: string; desc: boolean }[] | null }
const files = import.meta.glob("../../public/data/q/*.json", { eager: true, import: "default" }) as Record<string, Q>;
const questions = Object.values(files).sort((a, b) => a.number - b.number);
const byNumber = (n: number) => questions.find((q) => q.number === n)!;
const norm = (s: string) => s.replace(/\s+/g, " ").trim().replace(/;$/, "");

let pg: PGlite;
let db: SqlDb;
beforeAll(async () => { pg = new PGlite(); await pg.exec(northwind); db = pg as unknown as SqlDb; }, 90_000);
afterAll(async () => { await pg.close(); });

/** Column names the problem's output table lists, lower-cased ("Column Name | Description" or "Column | Description"). */
function specColumns(expectedOutput: string): string[] | null {
  const lines = expectedOutput.split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => /^\|\s*Column( Name)?\s*\|\s*Description/i.test(l));
  if (at < 0) return null;
  const cols: string[] = [];
  for (let k = at + 2; k < lines.length && lines[k].startsWith("|"); k++) cols.push(lines[k].split("|")[1].trim().replace(/`/g, "").toLowerCase());
  return cols;
}

describe("the bank", () => {
  it("has 150 questions with distinct numbers, and `solution` equals `referenceQuery` everywhere (the generator writes both from one file)", () => {
    expect(questions).toHaveLength(150);
    expect(new Set(questions.map((q) => q.number)).size).toBe(150);
    expect(byNumber(197).title).toMatch(/Recursive CTE/);
    expect(questions.filter((q) => q.solution !== q.referenceQuery).map((q) => q.number)).toEqual([]);
  });

  it("every reference query runs on PGlite", async () => {
    const failures: string[] = [];
    for (const q of questions) {
      const r = await execute(db, q.referenceQuery);
      if (!r.success) failures.push(`Q${q.number}: ${r.message}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  // Documented exceptions: the one output table whose header cannot be an SQL name.
  const COLUMN_EXCEPTIONS: Record<number, string> = { 70: "the table lists `contact_name (c1)` and `contact_name (c2)`: both columns are contact_name" };
  it("every reference returns exactly the columns the problem lists, in that order (the grader compares names and order)", async () => {
    const wrong: string[] = [];
    for (const q of questions) {
      if (COLUMN_EXCEPTIONS[q.number]) continue;
      const spec = specColumns(q.expectedOutput);
      if (!spec) { wrong.push(`Q${q.number}: no column table found`); continue; }
      const r = await execute(db, q.referenceQuery);
      if (JSON.stringify(r.columns.map((c) => c.toLowerCase())) !== JSON.stringify(spec)) wrong.push(`Q${q.number}: ${r.columns.join(",")} != ${spec.join(",")}`);
    }
    expect(wrong).toEqual([]);
    const q70 = await execute(db, byNumber(70).referenceQuery);
    expect(q70.columns).toEqual(["contact_name", "contact_name", "postal_code"]);
  }, 120_000);

  it("no two questions share a reference query", () => {
    const seen = new Map<string, number[]>();
    for (const q of questions) seen.set(norm(q.referenceQuery), [...(seen.get(norm(q.referenceQuery)) ?? []), q.number]);
    const dup = [...seen.values()].filter((v) => v.length > 1);
    expect(dup).toEqual([]); // no exceptions: Q19 and Q197 used to be the only pair
  });

  // The grader only lets rows that tie on the orderBy keys move when every key is an output column; otherwise it compares row order strictly.
  // Q199 sorts by `rev`, an inner column that is not an output column: strict order applies (stricter, not wrong).
  const ORDERBY_NOT_OUTPUT = [199];
  it("a declared orderBy refers to a column the reference returns (or the question is a listed exception)", async () => {
    const unmapped: number[] = [];
    for (const q of questions.filter((x) => x.sortRequired && x.orderBy?.length)) {
      const cols = (await execute(db, q.referenceQuery)).columns.map((c) => c.toLowerCase());
      if (!q.orderBy!.every((k) => /^\d+$/.test(k.column) || cols.includes(k.column.toLowerCase()))) unmapped.push(q.number);
    }
    expect(unmapped).toEqual(ORDERBY_NOT_OUTPUT);
  }, 60_000);
});

describe("Q19: customers above average revenue using CTE", () => {
  const q19 = () => byNumber(19);
  /** Q197's recursive employee chain (a different question in the bank): what Q19 was wrongly graded against. */
  const Q197_QUERY = () => byNumber(197).referenceQuery;
  const grade = (sql: string) => submit(db, sql, q19().referenceQuery, q19().sortRequired, q19().orderBy, HIDDEN_ROWS);

  it("is graded against a query that answers the title and the problem: two CTEs, customers above the average revenue", () => {
    const ref = q19().referenceQuery;
    expect(ref).toMatch(/WITH customer_revenue AS/i);
    expect(ref).toMatch(/overall_avg AS/i);
    expect(ref).not.toMatch(/RECURSIVE|employees/i);
    expect(q19().solution).toBe(ref);
    expect(q19().solution).toBe(q19().mySolution);
  });

  it("returns customer_id, company_name, total_revenue, only above the average, highest revenue first", async () => {
    const r = await execute(db, q19().referenceQuery);
    expect(r.columns).toEqual(["customer_id", "company_name", "total_revenue"]);
    const avg = Number((await execute(db, "SELECT AVG(t) FROM (SELECT SUM(od.unit_price*od.quantity*(1-od.discount)) t FROM customers c JOIN orders o ON o.customer_id=c.customer_id JOIN order_details od ON od.order_id=o.order_id GROUP BY c.customer_id) x")).rows[0][0]);
    const revenues = r.rows.map((row) => Number(row[2]));
    expect(revenues.length).toBeGreaterThan(0);
    expect(revenues.every((v) => v > avg)).toBe(true);
    expect([...revenues].sort((a, b) => b - a)).toEqual(revenues);
  });

  it("returns the same customers as Q6, which states the same business need", async () => {
    const a = (await execute(db, q19().referenceQuery)).rows.map((r) => r[0]).sort();
    const b = (await execute(db, byNumber(6).referenceQuery)).rows.map((r) => r[0]).sort();
    expect(a).toEqual(b);
    expect(a.length).toBe(30);
  });

  it("sortRequired and orderBy belong to this query (they were Q197's: path ascending)", () => {
    expect(q19().sortRequired).toBe(true);
    expect(q19().orderBy).toEqual([{ column: "total_revenue", desc: true }]);
  });

  it("passes with a correct answer, written differently (a scalar subquery, as Q6 does)", async () => {
    const alt = `SELECT c.customer_id, c.company_name, SUM(od.unit_price*od.quantity*(1-od.discount)) AS total_revenue
      FROM customers c JOIN orders o ON o.customer_id=c.customer_id JOIN order_details od ON od.order_id=o.order_id
      GROUP BY c.customer_id, c.company_name
      HAVING SUM(od.unit_price*od.quantity*(1-od.discount)) > (SELECT AVG(t) FROM (SELECT SUM(od2.unit_price*od2.quantity*(1-od2.discount)) t FROM orders o2 JOIN order_details od2 ON od2.order_id=o2.order_id GROUP BY o2.customer_id) z)
      ORDER BY total_revenue DESC`;
    expect((await grade(alt)).correct).toBe(true);
  });

  it("passes with the reference itself and with mySolution", async () => {
    expect((await grade(q19().referenceQuery)).correct).toBe(true);
    expect((await grade(q19().mySolution)).correct).toBe(true);
  });

  it("fails with Q197's query (what a wrong reference used to accept)", async () => {
    const r = await grade(Q197_QUERY());
    expect(r.correct).toBe(false);
  });

  it("fails with a wrong aggregate (revenue without the discount)", async () => {
    const wrong = `WITH customer_revenue AS (SELECT cu.customer_id, cu.company_name, SUM(od.unit_price*od.quantity) AS total_revenue
      FROM customers cu JOIN orders o ON o.customer_id=cu.customer_id JOIN order_details od ON od.order_id=o.order_id GROUP BY cu.customer_id, cu.company_name),
      overall_avg AS (SELECT AVG(total_revenue) AS avg_revenue FROM customer_revenue)
      SELECT cr.* FROM customer_revenue cr, overall_avg oa WHERE cr.total_revenue > oa.avg_revenue ORDER BY cr.total_revenue DESC`;
    expect((await grade(wrong)).correct).toBe(false);
  });

  it("fails with the right rows in the wrong order, and with SELECT 1", async () => {
    const asc = q19().referenceQuery.replace(/ORDER BY cr\.total_revenue DESC/i, "ORDER BY cr.total_revenue ASC");
    expect(asc).not.toBe(q19().referenceQuery);
    expect((await grade(asc)).correct).toBe(false);
    expect((await grade("SELECT 1")).correct).toBe(false);
  });
});

/**
 * Verdicts for every question whose `solution` differs from `mySolution` (the learner's own submitted attempt, kept in the file).
 * "ok": the reference answers the title and the problem; the difference is formatting or the author's earlier, wrong or different
 * attempt. "fixed": the reference was wrong and was patched (see docs/WORKSPACE_SQL_SAFETY.md, "Question integrity audit").
 */
const AUDIT: Record<number, [verdict: "ok" | "fixed" | "format", why: string]> = {
  19: ["fixed", "solution and referenceQuery were Q197's recursive employee chain (generator glob bug); now the two-CTE query"],
  40: ["ok", "averages the per-order totals (average order value); mySolution averages order lines and has an unnamed column"],
  42: ["format", "same query, different line breaks"],
  49: ["ok", "keeps all 91 customers with 0 for no orders; mySolution drops the two customers without orders"],
  57: ["ok", "|| gives a NULL name for the unassigned-order row, as the problem says; mySolution's CONCAT gives a blank"],
  58: ["format", "same query; the reference only adds trailing comments"],
  61: ["ok", "anti-join on the manager row returns the same single employee as reports_to IS NULL"],
  62: ["fixed", "counted the NULL-manager group, so a blank name came back as a third manager; now COUNT(e.reports_to) > 0"],
  63: ["ok", "joins the manager row; mySolution's first attempt printed the employee as the manager"],
  64: ["ok", "same pairs; mySolution adds a redundant join"],
  67: ["ok", "returns the shared city; mySolution's first attempt returned the country"],
  68: ["ok", "pairs share a supplier; mySolution's first attempt was a Cartesian product"],
  69: ["ok", "pairs share a category; mySolution's first attempt was a Cartesian product"],
  71: ["ok", "CROSS JOIN of employees and categories (72 rows); mySolution does not compile"],
  73: ["ok", "supplier name is company_name; mySolution returns contact_name"],
  78: ["ok", "supplier name is company_name; mySolution returns contact_name"],
  82: ["ok", "labels 'Employee' as the problem says and is ordered by type, name; mySolution uses 'employee' and no ORDER BY"],
  83: ["ok", "labels 'Employee' as the problem says and is ordered; mySolution uses 'employee'"],
  84: ["ok", "column is Company_Name as the problem says; mySolution calls it Name"],
  86: ["ok", "Total_Records as the problem says; mySolution has an unnamed count and a lower-case label"],
  92: ["ok", "output aliases total_employees, total_suppliers, total_customers and the required ORDER BY; mySolution is an early attempt"],
  96: ["format", "same query as mySolution before the column fix below (different spacing only)"],
  97: ["format", "same query as mySolution before the column fix below (different spacing only)"],
};
/** Questions patched so their reference returns the columns (and meaning) the problem states. Their mySolution keeps the author's original text. */
const COLUMN_FIXES = [32, 33, 36, 96, 97];
/** Questions whose `solution` was replaced by the file's own `mySolution` (so they no longer differ). */
const NOW_EQUAL = [19, 62];

describe("solution against mySolution: the 23 questions that differ", () => {
  it("the set of differing questions is exactly the audited set (a new difference must be judged and added here)", () => {
    const differing = questions.filter((q) => q.solution !== q.mySolution).map((q) => q.number);
    const expected = [...new Set([...Object.keys(AUDIT).map(Number).filter((n) => !NOW_EQUAL.includes(n)), ...COLUMN_FIXES])].sort((a, b) => a - b);
    expect(differing).toEqual(expected);
    for (const n of NOW_EQUAL) expect(byNumber(n).solution).toBe(byNumber(n).mySolution);
  });

  it("'format' entries differ only in whitespace or trailing comments (96 and 97 only after the column fix)", () => {
    for (const [n, [verdict]] of Object.entries(AUDIT)) {
      if (verdict !== "format" || COLUMN_FIXES.includes(Number(n))) continue;
      const q = byNumber(Number(n));
      const strip = (s: string) => norm(s.replace(/\/\*[\s\S]*?\*\//g, "")).replace(/\s*;\s*$/, "");
      expect(strip(q.solution), `Q${n}`).toBe(strip(q.mySolution));
    }
  });

  it("'ok' and 'fixed' references return rows (not an empty or failed result) on Northwind", async () => {
    for (const n of Object.keys(AUDIT).map(Number)) {
      const r = await execute(db, byNumber(n).referenceQuery);
      expect(r.success, `Q${n}`).toBe(true);
      expect(r.row_count, `Q${n}`).toBeGreaterThan(0);
    }
  }, 60_000);

  it("Q62 lists exactly the two real managers and no blank name", async () => {
    const r = await execute(db, byNumber(62).referenceQuery);
    expect(r.rows.map((x) => x[0]).sort()).toEqual(["Andrew Fuller", "Steven Buchanan"]);
    // and equals the objective: employees that appear in another employee's reports_to
    const check = await execute(db, "SELECT e.first_name || ' ' || e.last_name FROM employees e WHERE EXISTS (SELECT 1 FROM employees x WHERE x.reports_to = e.employee_id) ORDER BY 1");
    expect(r.rows.map((x) => x[0]).sort()).toEqual(check.rows.map((x) => x[0]));
  });

  it("Q40 and Q49 agree on every customer's average order value (to the cent: one rounds order totals first, one does not)", async () => {
    const a = (await execute(db, byNumber(40).referenceQuery)).rows.map((r) => [String(r[0]), Number(r[1])] as const).sort();
    const b = (await execute(db, byNumber(49).referenceQuery)).rows.map((r) => [String(r[0]), Number(r[1])] as const).sort();
    expect(a.map((x) => x[0])).toEqual(b.map((x) => x[0]));
    a.forEach((x, i) => expect(Math.abs(x[1] - b[i][1]), x[0]).toBeLessThanOrEqual(0.011));
  });

  it("Q57 returns the catch-all row for orders without an employee, with a NULL name", async () => {
    const r = await execute(db, byNumber(57).referenceQuery);
    expect(r.rows.some((row) => row[0] === null)).toBe(true);
  });
});

describe("other reference fixes (output columns the problem lists)", () => {
  it("Q32, Q33, Q36, Q96 and Q97 now name their columns as their problems do", async () => {
    const cols = async (n: number) => (await execute(db, byNumber(n).referenceQuery)).columns;
    expect(await cols(32)).toEqual(["contact_name", "distinct_products"]);
    expect(await cols(33)).toEqual(["contact_name", "shipped_orders"]);
    expect(await cols(36)).toEqual(["supplier_name", "total_products"]);
    expect(await cols(96)).toEqual(["country", "total_customers", "average_customers"]);
    expect(await cols(97)).toEqual(["country", "total_employees", "total_suppliers", "total_customers", "entity_average"]);
  });

  it("Q33 counts shipped orders (shipped_date is set), not every order", async () => {
    const r = await execute(db, byNumber(33).referenceQuery);
    const total = r.rows.reduce((s, row) => s + Number(row[1]), 0);
    const shipped = Number((await execute(db, "SELECT COUNT(shipped_date) FROM orders")).rows[0][0]);
    expect(total).toBe(shipped);
    expect(r.rows.length).toBe(Number((await execute(db, "SELECT COUNT(*) FROM customers")).rows[0][0])); // customers without orders still appear
  });

  it("a learner who follows the problem's column names is graded correct on Q32 and Q36", async () => {
    const q32 = "SELECT c.contact_name, COUNT(DISTINCT od.product_id) AS distinct_products FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id LEFT JOIN order_details od ON od.order_id = o.order_id GROUP BY c.contact_name, c.customer_id";
    expect((await submit(db, q32, byNumber(32).referenceQuery, false, null, HIDDEN_ROWS)).correct).toBe(true);
    const q36 = "SELECT s.company_name AS supplier_name, COUNT(p.product_id) AS total_products FROM suppliers s LEFT JOIN products p ON p.supplier_id = s.supplier_id GROUP BY s.company_name, s.supplier_id";
    expect((await submit(db, q36, byNumber(36).referenceQuery, false, null, HIDDEN_ROWS)).correct).toBe(true);
  });
});
