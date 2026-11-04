// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { TEMPLATES, generate } from "../site/lib/generator";
import { describeWith } from "../site/lib/datasets";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { compareRuns, qualityScore, runRule, suggestRules, validateRule, type QualityRun, type Rule } from "../site/lib/dataQuality";
import type { SchemaTable } from "../site/types";

let db: SqlDb;
let schema: SchemaTable[];
const run = (sql: string) => execute(db, sql);

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(generate(TEMPLATES[0].spec("messy")).sql); // customers + orders with NULLs, dupes, orphans, invalid values
  db = pg as unknown as SqlDb;
  schema = await describeWith(db);
}, 60_000);

const R = (r: Partial<Rule>): Rule => ({ id: "r", name: "r", type: "not_null", table: "customers", ...r });

describe("data quality rules", () => {
  it("NULL, duplicate, PK and FK checks find the generated quirks", async () => {
    const nulls = await runRule(R({ type: "not_null", columns: ["email"] }), schema, run);
    expect(nulls.status).toBe("fail");
    expect(nulls.failed).toBeGreaterThan(0);
    expect(nulls.sample!.rows.length).toBeGreaterThan(0);
    const dup = await runRule(R({ type: "unique", columns: ["first_name", "last_name", "signup_date"] }), schema, run);
    expect(dup.failed).toBeGreaterThan(0);
    const pk = await runRule(R({ type: "primary_key", columns: ["customer_id"] }), schema, run);
    expect(pk).toMatchObject({ status: "pass", failed: 0, checked: 200 + Math.round(200 * 0.06) });
    const fk = await runRule(R({ type: "foreign_key", table: "orders", columns: ["customer_id"], refTable: "customers", refColumn: "customer_id" }), schema, run);
    expect(fk.failed).toBeGreaterThan(0);
  });
  it("type, date, outlier, business-rule, row-count, schema and reconciliation checks", async () => {
    expect((await runRule(R({ type: "data_type", columns: ["email"], expected: "email" }), schema, run)).failed).toBeGreaterThan(0);
    expect((await runRule(R({ type: "date_range", table: "orders", columns: ["order_date"], max: "2025-12-31" }), schema, run)).failed).toBeGreaterThan(0);
    expect((await runRule(R({ type: "outlier", table: "orders", columns: ["amount"], threshold: 2 }), schema, run)).status).not.toBe("error");
    expect((await runRule(R({ type: "business_rule", table: "orders", condition: "amount >= 0" }), schema, run)).failed).toBeGreaterThan(0);
    const rc = await runRule(R({ type: "row_count", refTable: "orders" }), schema, run);
    expect(rc).toMatchObject({ status: "fail", checked: 1 });
    const sc = await runRule(R({ type: "schema", expectedColumns: ["customer_id", "first_name"] }), schema, run);
    expect(sc.message).toMatch(/unexpected: last_name/);
    const rec = await runRule(R({ type: "reconciliation", columns: ["customer_id"], refTable: "customers", refColumn: "customer_id", compare: ["city"] }), schema, run);
    expect(rec).toMatchObject({ status: "pass", failed: 0 }); // a table reconciles with itself
    const missing = await runRule(R({ type: "missing_records", table: "orders", columns: ["customer_id"], refTable: "customers", refColumn: "customer_id" }), schema, run);
    expect(missing.failed).toBeGreaterThan(0);
  });
  it("rejects unknown identifiers and multi-statement conditions before running anything", () => {
    expect(validateRule(R({ table: "nope" }), schema)).toEqual(['Unknown table "nope".']);
    expect(validateRule(R({ columns: ["x"] }), schema)).toEqual(['Unknown column "customers.x".']);
    expect(validateRule(R({ type: "business_rule", condition: "1=1; DROP TABLE customers" }), schema)[0]).toMatch(/single expression/);
  });
  it("suggests rules from the schema, incl. undeclared foreign keys by naming", () => {
    const s = suggestRules(schema);
    expect(s.some((r) => r.type === "foreign_key" && r.table === "orders" && r.refTable === "customers")).toBe(true);
    expect(s.some((r) => r.type === "primary_key" && r.table === "customers")).toBe(true);
  });
  it("scores and compares runs", () => {
    const a = { ruleId: "a", name: "a", type: "not_null" as const, table: "t", sql: "", message: "" };
    const results = [{ ...a, checked: 100, failed: 10, status: "fail" as const }, { ...a, ruleId: "b", checked: 1, failed: 0, status: "pass" as const }, { ...a, ruleId: "c", checked: 0, failed: 0, status: "error" as const }];
    expect(qualityScore(results)).toBe(95);
    const older: QualityRun = { id: "1", at: "", dataset: "d", results, score: 95 };
    const newer: QualityRun = { ...older, id: "2", results: [{ ...results[0], failed: 4 }, results[1]] };
    expect(compareRuns(older, newer)[0]).toMatchObject({ before: 10, after: 4, delta: -6 });
  });
});
