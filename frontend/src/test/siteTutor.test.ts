import { describe, expect, it } from "vitest";
import schemaJson from "../../public/data/schema.json";
import { buildContext, disabledProvider, explainQuery, getTutorProvider, schemaCheck } from "../site/lib/tutor";
import type { Question, SchemaTable } from "../site/types";

const schema = schemaJson as SchemaTable[];

describe("tutor", () => {
  it("is disabled, not broken, without a configured endpoint", async () => {
    expect(getTutorProvider().available).toBe(false);
    await expect(disabledProvider.ask({} as never, [])).rejects.toThrow(/No AI provider/);
  });
  it("flags tables and columns that don't exist instead of assuming them", () => {
    expect(schemaCheck("SELECT c.company_name FROM customers c", schema)).toEqual([]);
    expect(schemaCheck("SELECT e.salary FROM employees e JOIN departments d ON d.id = e.dept_id", schema)).toEqual([
      'Table "departments" doesn\'t exist in this database.',
      'Column "salary" doesn\'t exist on employees (referenced as e.salary).',
      'Column "dept_id" doesn\'t exist on employees (referenced as e.dept_id).',
    ]);
    expect(schemaCheck("WITH r AS (SELECT 1) SELECT * FROM r", schema)).toEqual([]);
  });
  it("explains a query clause by clause in logical order", () => {
    const e = explainQuery("SELECT country, COUNT(*) FROM customers WHERE city IS NOT NULL GROUP BY country HAVING COUNT(*) > 2 ORDER BY 2 DESC LIMIT 3");
    expect(e.steps.map((s) => s.clause)).toEqual(["FROM", "WHERE", "GROUP BY", "HAVING", "SELECT", "ORDER BY", "LIMIT"]);
  });
  it("puts only the question's real tables into the context", () => {
    const q = { number: 1, title: "t", problem: "", objective: "", tables: ["orders"], concepts: [], difficulty: "Easy", myMistakes: ["m"] } as unknown as Question;
    const ctx = buildContext(q, schema, "SELECT 1", { attempts: 2, hintLevel: 3, errorKinds: { "Wrong result": 1 } }, []);
    expect(ctx.schema.map((t) => t.table)).toEqual(["orders"]);
    expect(ctx.schema[0].foreignKeys.some((f) => f.startsWith("customer_id →"))).toBe(true);
    expect(ctx.previousMistakes).toEqual(["m", "Wrong result"]);
  });
});
