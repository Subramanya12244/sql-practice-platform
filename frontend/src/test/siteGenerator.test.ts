// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { TEMPLATES, generate, validateSpec } from "../site/lib/generator";
import { toCsv } from "../site/lib/datasets";

describe("data generator", () => {
  it("is deterministic for a given seed", () => {
    const spec = TEMPLATES[0].spec("messy");
    expect(generate(spec).sql).toBe(generate(spec).sql);
    expect(generate({ ...spec, seed: 1 }).sql).not.toBe(generate(spec).sql);
  });

  it("every template loads into PostgreSQL at every difficulty, with the requested quirks", async () => {
    for (const t of TEMPLATES) {
      for (const d of ["clean", "realistic", "messy"] as const) {
        const spec = t.spec(d);
        expect(validateSpec(spec)).toEqual([]);
        const g = generate(spec);
        const pg = new PGlite();
        await pg.exec(g.sql);
        for (const tab of g.tables) {
          const r = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${tab.name}`);
          expect(r.rows[0].n).toBe(tab.rows.length);
        }
        await pg.close();
      }
    }
  }, 120_000);

  it("messy data really contains NULLs, duplicates and orphans; clean has none", async () => {
    const messy = generate(TEMPLATES[0].spec("messy"));
    const pg = new PGlite();
    await pg.exec(messy.sql);
    const one = async (sql: string) => Number((await pg.query<{ n: number }>(sql)).rows[0].n);
    expect(await one("SELECT COUNT(*) AS n FROM customers WHERE email IS NULL")).toBeGreaterThan(0);
    expect(await one("SELECT COUNT(*) AS n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = o.customer_id)")).toBeGreaterThan(0);
    expect(await one("SELECT COUNT(*) AS n FROM (SELECT first_name, last_name, email, city, signup_date FROM customers GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1) d")).toBeGreaterThan(0);
    expect(await one("SELECT COUNT(*) AS n FROM orders WHERE amount < 0")).toBeGreaterThan(0);
    const clean = generate(TEMPLATES[0].spec("clean"));
    expect(clean.sql).toContain("REFERENCES customers(customer_id)");
    expect(clean.notes).toEqual([]);
    await pg.close();
  }, 60_000);

  it("rejects bad specs with clear messages", () => {
    expect(validateSpec({ title: "x", seed: 1, tables: [{ name: "a", rows: 10, columns: [{ name: "x", kind: "fk", ref: "b" }] }] })).toEqual([
      "a: needs exactly one id (primary key) column.",
      'a.x: references unknown table "b".',
    ]);
  });

  it("writes RFC 4180 CSV", () => {
    expect(toCsv(["a", "b"], [[1, 'say "hi", ok'], [null, "x"]])).toBe('a,b\r\n1,"say ""hi"", ok"\r\n,x');
  });
});
