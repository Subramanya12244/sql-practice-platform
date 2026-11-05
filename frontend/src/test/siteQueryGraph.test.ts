import { describe, expect, it } from "vitest";
import { buildGraphs } from "../site/lib/queryGraph";

const kinds = (r: Awaited<ReturnType<typeof buildGraphs>>) => (r.ok ? r.flow.nodes.map((n) => n.kind) : []);

describe("query diagrams from the AST", () => {
  it("orders the logical clauses and keeps the user's own text", async () => {
    const r = await buildGraphs(`SELECT c.company_name, COUNT(o.order_id) AS n
      FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id
      WHERE c.country = 'Germany' GROUP BY c.company_name HAVING COUNT(o.order_id) > 2 ORDER BY n DESC LIMIT 5`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(kinds(r)).toEqual(["source", "source", "join", "where", "group", "having", "select", "order", "limit", "result"]);
    const join = r.flow.nodes.find((n) => n.kind === "join")!;
    expect(join.title).toBe("LEFT JOIN");
    expect(join.detail[0]).toBe("ON o.customer_id = c.customer_id");
    expect(r.flow.nodes.find((n) => n.kind === "where")!.detail[0]).toBe("c.country = 'Germany'");
    expect(r.flow.nodes.find((n) => n.kind === "group")!.detail).toEqual(["by c.company_name", "aggregates: COUNT(o.order_id)"]);
    expect(r.flow.nodes.find((n) => n.kind === "source")!.detail).toContain("alias c");
    // Every edge connects real nodes, and the flow ends at Result.
    const ids = new Set(r.flow.nodes.map((n) => n.id));
    expect(r.flow.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    expect(r.flow.edges.at(-1)!.to).toBe(r.flow.nodes.at(-1)!.id);
  });

  it("resolves aliases to tables in the relationship view across multiple joins", async () => {
    const r = await buildGraphs(`SELECT * FROM orders o JOIN order_details d ON d.order_id = o.order_id
      JOIN products p ON p.product_id = d.product_id RIGHT JOIN categories cat USING (category_id)`);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rel.tables.map((t) => [t.name, t.aliases])).toEqual([["orders", ["o"]], ["order_details", ["d"]], ["products", ["p"]], ["categories", ["cat"]]]);
    expect(r.rel.joins.map((j) => j.type)).toEqual(["INNER JOIN", "INNER JOIN", "RIGHT JOIN"]);
    expect(r.rel.joins[0].pairs).toEqual([{ left: "order_details.order_id", right: "orders.order_id" }]);
    expect(r.rel.joins[2].on).toBe("USING (category_id)");
    // Edges connect the joined table to the table its condition compares with, never to itself.
    expect(r.rel.joins.map((j) => [j.left, j.right])).toEqual([["orders", "order_details"], ["order_details", "products"], ["products", "categories"]]);
    const l = await buildGraphs("SELECT * FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id");
    if (!l.ok) throw new Error(l.reason);
    expect(l.rel.joins.map((j) => [j.left, j.right])).toEqual([["customers", "orders"]]);
  });

  it("draws CTE dependencies and window functions", async () => {
    const r = await buildGraphs(`WITH rev AS (SELECT customer_id, SUM(freight) f FROM orders GROUP BY customer_id),
      ranked AS (SELECT customer_id, f, RANK() OVER (ORDER BY f DESC) rk FROM rev)
      SELECT * FROM ranked WHERE rk <= 3`);
    if (!r.ok) throw new Error(r.reason);
    expect(r.statement).toBe("WITH 2 CTEs + SELECT");
    const ctes = r.flow.nodes.filter((n) => n.kind === "cte");
    expect(ctes.map((n) => n.title)).toEqual(["CTE rev", "CTE ranked"]);
    expect(r.flow.edges.some((e) => e.from === ctes[0].id && e.to === ctes[1].id && e.label === "feeds")).toBe(true);
    expect(r.rel.tables.find((t) => t.name === "ranked")?.cte).toBe(true);
  });

  it("combines set-operation branches and notes subqueries", async () => {
    const r = await buildGraphs(`SELECT city FROM customers UNION SELECT city FROM suppliers ORDER BY city`);
    if (!r.ok) throw new Error(r.reason);
    const op = r.flow.nodes.find((n) => n.kind === "setop")!;
    expect(op.title).toBe("UNION");
    expect(op.detail).toContain("duplicates removed");
    expect(r.flow.edges.filter((e) => e.to === op.id)).toHaveLength(2);
    const s = await buildGraphs(`SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products)`);
    if (!s.ok) throw new Error(s.reason);
    expect(s.flow.nodes.find((n) => n.kind === "where")!.detail).toContain("1 subquery inside");
    expect(s.flow.nodes.some((n) => n.kind === "group")).toBe(false); // AVG is inside the subquery, not this SELECT
  });

  it("refuses rather than guessing when it can't parse", async () => {
    const bad = await buildGraphs("SELEC * FRM nowhere");
    expect(bad.ok).toBe(false);
    const ddl = await buildGraphs("CREATE TABLE t (id int)");
    expect(ddl).toMatchObject({ ok: false });
    expect(await buildGraphs("select 1; select 2")).toMatchObject({ ok: false, reason: "Diagrams work on one statement at a time." });
  });
});
