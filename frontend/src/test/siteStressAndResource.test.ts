// @vitest-environment node
import { describe, expect, it, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, runRaw, MAX_DISPLAY_ROWS, type SqlDb } from "../site/lib/sqlRunner";
import { runPythonTask, type PythonTask } from "../site/lib/tasks";

describe("WebAssembly Resource & Stress Testing (PGlite)", () => {
  let db: SqlDb;

  beforeAll(async () => {
    const pg = new PGlite();
    await pg.exec(northwind);
    db = pg as unknown as SqlDb;
  }, 60_000);

  it("enforces MAX_DISPLAY_ROWS limit on large result sets", async () => {
    // Generate 5,000 rows in PostgreSQL Wasm
    const res = await execute(db, "SELECT g AS id, 'row-' || g AS label FROM generate_series(1, 5000) g");
    expect(res.success).toBe(true);
    expect(res.row_count).toBe(5000);
    // UI result rows must be truncated to MAX_DISPLAY_ROWS to prevent browser memory exhaustion
    expect(res.rows.length).toBe(MAX_DISPLAY_ROWS);
    expect(res.truncated).toBe(true);
  });

  it("handles complex multi-table joins and aggregations without memory degradation", async () => {
    const sql = `
      SELECT 
        c.category_name,
        p.product_name,
        COUNT(od.order_id) AS order_count,
        SUM(od.quantity) AS total_quantity,
        ROUND(AVG(od.unit_price * od.quantity)::numeric, 2) AS avg_revenue
      FROM categories c
      JOIN products p ON c.category_id = p.category_id
      JOIN order_details od ON p.product_id = od.product_id
      JOIN orders o ON od.order_id = o.order_id
      GROUP BY c.category_name, p.product_name
      ORDER BY total_quantity DESC
      LIMIT 20
    `;
    const res = await execute(db, sql);
    expect(res.success).toBe(true);
    expect(res.rows.length).toBe(20);
    expect(Number(res.rows[0][3])).toBeGreaterThan(0);
  });

  it("isolates mutations inside rollback transactions and preserves sequences", async () => {
    // Verify count before
    const before = await runRaw(db, "SELECT COUNT(*) FROM products");
    const countBefore = Number(before.rows[0][0]);

    // Insert a product inside transaction-wrapped execute
    const insertRes = await execute(db, "INSERT INTO products (product_id, product_name, discontinued) VALUES (9999, 'Test Product', false)");
    expect(insertRes.success).toBe(true);

    // Verify product was rolled back
    const after = await runRaw(db, "SELECT COUNT(*) FROM products WHERE product_id = 9999");
    expect(Number(after.rows[0][0])).toBe(0);

    const countAfter = await runRaw(db, "SELECT COUNT(*) FROM products");
    expect(Number(countAfter.rows[0][0])).toBe(countBefore);
  });
});

describe("Python Watchdog Architecture & Error Boundary Simulation", () => {
  it("successfully grades clean fast execution", async () => {
    const task: PythonTask = {
      id: "test-fast",
      title: "Fast Task",
      type: "python",
      instructions: "Double x",
      starter: "def double(x): return x * 2",
      solution: "def double(x): return x * 2",
      tests: "assert double(5) == 10\nassert double(0) == 0",
    };

    const mockRun = async (_code: string, _tests?: string) => {
      // Simulate fast successful worker execution
      return { ok: true, stdout: "", ms: 45 };
    };

    const res = await runPythonTask(task, task.starter, mockRun);
    expect(res.ok).toBe(true);
    expect(res.message).toContain("passed");
  });

  it("handles watchdog timeout and reports timeout error gracefully", async () => {
    const task: PythonTask = {
      id: "test-timeout",
      title: "Timeout Task",
      type: "python",
      instructions: "Loop",
      starter: "while True: pass",
      solution: "pass",
      tests: "assert True",
    };

    const mockTimeoutRun = async (_code: string, _tests?: string) => {
      // Simulate watchdog triggering after timeout limit
      return {
        ok: false,
        phase: "timeout" as const,
        stdout: "",
        error: "Stopped after 10s — check for an infinite loop.",
        ms: 10000,
      };
    };

    const res = await runPythonTask(task, task.starter, mockTimeoutRun);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Stopped after 10s|Timed out/);
  });

  it("distinguishes runtime syntax/type errors from test assertion failures", async () => {
    const task: PythonTask = {
      id: "test-distinguish",
      title: "Distinguish Task",
      type: "python",
      instructions: "Compute",
      starter: "def compute(): raise ValueError('invalid parameter')",
      solution: "def compute(): return 42",
      tests: "assert compute() == 42",
    };

    // Case 1: Runtime exception during user code
    const runtimeFailRun = async () => ({
      ok: false,
      phase: "code" as const,
      stdout: "",
      error: "ValueError: invalid parameter",
      errorLine: 1,
      ms: 10,
    });
    const r1 = await runPythonTask(task, task.starter, runtimeFailRun);
    expect(r1.ok).toBe(false);
    expect(r1.message).toContain("ValueError: invalid parameter");

    // Case 2: Assertion failure during test grading
    const testFailRun = async () => ({
      ok: false,
      phase: "tests" as const,
      stdout: "",
      error: "AssertionError: expected 42 but got 0",
      ms: 12,
    });
    const r2 = await runPythonTask(task, task.starter, testFailRun);
    expect(r2.ok).toBe(false);
    expect(r2.message).toContain("A test failed: expected 42 but got 0");
  });
});
