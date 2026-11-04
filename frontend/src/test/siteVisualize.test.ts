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
