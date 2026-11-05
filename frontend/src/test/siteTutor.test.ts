import { describe, expect, it } from "vitest";
import schemaJson from "../../public/data/schema.json";
import { explainQuery, schemaCheck } from "../site/lib/tutor";
import tutorSource from "../site/lib/tutor.ts?raw";
import type { SchemaTable } from "../site/types";

const schema = schemaJson as SchemaTable[];

describe("tutor", () => {
  it("has no AI provider or network call", () => {
    expect(tutorSource).not.toMatch(/fetch\(|TUTOR_ENDPOINT|provider/i);
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
});
