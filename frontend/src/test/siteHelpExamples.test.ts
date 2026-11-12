// @vitest-environment node
// Verifies the "expected result" of every Try Example against the real engine, so help never shows a made-up output.
// SQL: real PostgreSQL (PGlite) on the named dataset. Python (standard library only): CPython. Python that imports
// numpy/pandas is verified in real Pyodide by `npx vite-node scripts/help-examples-verify.ts` (see docs/HELP_GUIDE_PLAN.md).
import { PGlite } from "@electric-sql/pglite";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS } from "../site/help/registry";

const data = (f: string) => readFileSync(join(__dirname, "..", "..", "public", "data", f), "utf8");
const norm = (s: string) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
const cell = (v: unknown) => (v === null || v === undefined ? null : typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString().slice(0, 10) : v);
const same = (a: unknown, b: unknown) => a === b || (a !== null && b !== null && String(a) === String(b)) || (typeof a === "number" && Number(b) === a);

const examples = SECTIONS.flatMap((s) => (s.example ? [{ section: s.id, ex: s.example }] : []));

describe("help examples", () => {
  for (const { section, ex } of examples.filter((e) => e.ex.language === "sql")) {
    it(`${section}: SQL example "${ex.id}" returns exactly what the help says`, async () => {
      const pg = new PGlite();
      await pg.exec(data(ex.dataset === undefined || ex.dataset === "northwind" ? "northwind.sql" : `datasets/${ex.dataset}.sql`));
      const res = await pg.query(ex.code.trim().replace(/;\s*$/, ""), [], { rowMode: "array" });
      expect(res.fields.map((f) => f.name)).toEqual(ex.expectedRows!.columns);
      const want = ex.expectedRows!.rows;
      expect(res.rows.length).toBeGreaterThanOrEqual(want.length);
      want.forEach((row, i) => row.forEach((v, j) => expect(same(cell((res.rows[i] as unknown[])[j]), v), `row ${i} col ${j}: got ${String((res.rows[i] as unknown[])[j])}, help says ${String(v)}`).toBe(true)));
    }, 60_000);
  }

  const py3 = spawnSync("python3", ["--version"]).status === 0;
  for (const { section, ex } of examples.filter((e) => e.ex.language === "python")) {
    const heavy = /\b(import|from)\s+(numpy|pandas)\b/.test(ex.code);
    (py3 && !heavy ? it : it.skip)(`${section}: Python example "${ex.id}" prints exactly what the help says`, () => {
      const r = spawnSync("python3", ["-I", "-c", ex.code], { encoding: "utf8", timeout: 20_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(norm(r.stdout)).toBe(norm(ex.expectedStdout!));
    });
  }

  it("each example's target is a real editor kind", () => {
    for (const { ex } of examples) expect(["sql", "python", "etl", "none"]).toContain(ex.target);
  });
});
