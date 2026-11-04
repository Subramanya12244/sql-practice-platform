import { describe, expect, it } from "vitest";
import { buildQuery, complexity, detectApproaches, parseSelect } from "../site/lib/sqlClauses";

describe("parseSelect", () => {
  it("splits top-level clauses and ignores keywords in subqueries and strings", () => {
    const p = parseSelect(`SELECT c.country, COUNT(*) AS n
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
WHERE c.city <> 'where from' AND o.order_id IN (SELECT order_id FROM order_details WHERE quantity > 5)
GROUP BY c.country
HAVING COUNT(*) > 1
ORDER BY n DESC
LIMIT 5;`);
    expect(p.unsupported).toBeUndefined();
    expect(p.clauses.select).toBe("c.country, COUNT(*) AS n");
    expect(p.clauses.where).toContain("IN (SELECT order_id FROM order_details WHERE quantity > 5)");
    expect(p.clauses["group by"]).toBe("c.country");
    expect(p.clauses.having).toBe("COUNT(*) > 1");
    expect(p.clauses["order by"]).toBe("n DESC");
    expect(p.clauses.limit).toBe("5");
    expect(p.joins).toEqual([
      { kind: "FROM", source: "customers c" },
      { kind: "JOIN", source: "orders o", on: "o.customer_id = c.customer_id" },
    ]);
  });

  it("keeps CTEs, detects DISTINCT and window functions", () => {
    const p = parseSelect("WITH r AS (SELECT 1 AS x) SELECT DISTINCT x, ROW_NUMBER() OVER (PARTITION BY x ORDER BY x) FROM r");
    expect(p.with).toBe("WITH r AS (SELECT 1 AS x)");
    expect(p.distinct).toBe(true);
    expect(p.windows).toEqual(["ROW_NUMBER() OVER (PARTITION BY x ORDER BY x)"]);
    expect(buildQuery(p, { select: "COUNT(*)", from: p.clauses.from })).toBe("WITH r AS (SELECT 1 AS x)\nSELECT COUNT(*)\nFROM r");
  });

  it("refuses what it can't visualize instead of guessing", () => {
    expect(parseSelect("SELECT 1 UNION SELECT 2").unsupported).toMatch(/UNION/);
    expect(parseSelect("DELETE FROM orders").unsupported).toMatch(/Only SELECT/);
    expect(parseSelect("SELECT 1; SELECT 2").unsupported).toMatch(/one statement/);
    expect(parseSelect("SELECT ';' AS semi").unsupported).toBeUndefined();
  });

  it("parses LEFT JOIN chains", () => {
    const p = parseSelect("SELECT * FROM a LEFT JOIN b ON b.id = a.id LEFT OUTER JOIN c ON c.id = b.id");
    expect(p.joins.map((j) => j.kind)).toEqual(["FROM", "LEFT JOIN", "LEFT OUTER JOIN"]);
  });
});

describe("approach detection", () => {
  it("labels structure", () => {
    expect(detectApproaches("SELECT * FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)")).toEqual(["NOT EXISTS", "Correlated subquery"]);
    expect(detectApproaches("SELECT * FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products)")).toEqual(["Subquery"]);
    expect(detectApproaches("WITH t AS (SELECT 1) SELECT RANK() OVER (ORDER BY 1) FROM t")).toEqual(["CTE", "Window function"]);
    expect(complexity("SELECT * FROM a JOIN b ON (a.x = b.x)").joins).toBe(1);
  });
});
