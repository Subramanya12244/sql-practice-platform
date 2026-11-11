// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { runReview } from "../site/lib/sqlReview";
import { execute, type SqlDb } from "../site/lib/sqlRunner";

const REFERENCE = `SELECT p.product_id, p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS total_revenue
FROM products p
JOIN order_details od ON od.product_id = p.product_id
GROUP BY p.product_id, p.product_name
ORDER BY total_revenue DESC;`;
// Same rows, written as a correlated subquery.
const CORRELATED = `SELECT p.product_id, p.product_name,
  (SELECT ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) FROM order_details od WHERE od.product_id = p.product_id) AS total_revenue
FROM products p
WHERE EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id)
ORDER BY total_revenue DESC;`;

describe("review: real PostgreSQL (PGlite, Northwind)", () => {
  it("a correlated-subquery solution against a join reference: same rows verified, alternative offered, no speed claim", async () => {
    const pg = new PGlite();
    await pg.exec(northwind);
    const db = pg as unknown as SqlDb;
    const r = await runReview({ sql: CORRELATED, referenceSql: REFERENCE, sortRequired: true, graderCorrect: true }, (sql) => execute(db, sql));
    expect(r.concepts).toContain("Correlated subquery");
    expect(r.alternative).toBeDefined();
    expect(r.alternative!.sameRows).toBe(true);
    expect(r.alternative!.approaches).toContain("JOIN");
    expect(r.findings.some((f) => f.id === "timing" && f.basis === "verified")).toBe(true);
    expect(r.findings.some((f) => f.id === "plan")).toBe(true);
    expect(r.findings.some((f) => f.id === "small-data")).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/\b(is|are) (much )?(faster|slower)\b/i);
  }, 120_000);

  it("a query that cannot run produces an honest 'comparison unavailable', never a throw", async () => {
    const pg = new PGlite();
    await pg.exec(northwind);
    const db = pg as unknown as SqlDb;
    const r = await runReview({ sql: "SELECT nope FROM nowhere", referenceSql: REFERENCE, sortRequired: false, graderCorrect: true }, (sql) => execute(db, sql));
    expect(r.findings.some((f) => f.id === "compare-failed")).toBe(true);
    const thrown = await runReview({ sql: "SELECT 1", referenceSql: REFERENCE, sortRequired: false, graderCorrect: true }, async () => { throw new Error("db down"); });
    expect(thrown.findings.some((f) => f.id === "no-measure")).toBe(true);
  }, 120_000);
});

