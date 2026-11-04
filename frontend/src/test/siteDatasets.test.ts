// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import index from "../../public/data/datasets/index.json";
import { describeWith } from "../site/lib/datasets";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { erDiagramSource } from "../site/lib/data";

const files = import.meta.glob<string>("../../public/data/datasets/*.sql", { eager: true, query: "?raw", import: "default" });

describe("shipped practice datasets", () => {
  it("are listed in index.json", () => {
    expect((index as { id: string }[]).map((d) => d.id).sort()).toEqual(["banking", "ecommerce", "hr", "inventory", "sales"]);
  });
  for (const d of index as { id: string; tables: string[]; rows: number }[]) {
    it(`${d.id} loads in PGlite with its tables, keys and row count`, async () => {
      const sql = Object.entries(files).find(([p]) => p.endsWith(`/${d.id}.sql`))![1];
      const pg = new PGlite();
      await pg.exec(sql);
      const db = pg as unknown as SqlDb;
      const schema = await describeWith(db);
      expect(schema.map((t) => t.name).sort()).toEqual([...d.tables].sort());
      expect(schema.every((t) => t.columns.some((c) => c.pk))).toBe(true);
      expect(schema.some((t) => t.columns.some((c) => c.fk))).toBe(true);
      expect(erDiagramSource(schema)).toContain("||--o{");
      let total = 0;
      for (const t of schema) total += Number((await execute(db, `SELECT COUNT(*) FROM ${t.name}`)).rows[0][0]);
      expect(total).toBe(d.rows);
      await pg.close();
    }, 60_000);
  }
});
