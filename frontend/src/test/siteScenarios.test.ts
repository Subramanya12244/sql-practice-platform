// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { parseScenario } from "../site/lib/scenarios";
import { submit, execute, type SqlDb } from "../site/lib/sqlRunner";

const raw = Object.entries(import.meta.glob<string>("../site/content/scenarios/*.md", { eager: true, query: "?raw", import: "default" }));
const dataFiles = import.meta.glob<string>("../../public/data/datasets/*.sql", { eager: true, query: "?raw", import: "default" });
const noteSlugs = new Set(Object.keys(import.meta.glob("../site/content/notes/*/*.md")).map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
const patternSlugs = new Set(Object.keys(import.meta.glob("../site/content/patterns/*.md")).map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
const scenarios = raw.map(([p, r]) => parseScenario(r, p.split("/").pop()!.replace(/\.md$/, "")));
const REQUIRED = ["Business context", "Problem", "Available data", "Expected outcome", "Success criteria", "Explanation", "Follow-up questions"];

describe("scenarios", () => {
  it("exist, follow the format and link to real notes/patterns", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(12);
    const bad: string[] = [];
    for (const s of scenarios) {
      const heads = s.sections.map((x) => x.heading);
      for (const h of REQUIRED) if (!heads.includes(h)) bad.push(`${s.slug}: missing "${h}"`);
      if (!s.solution) bad.push(`${s.slug}: no solution block`);
      if (!s.alternatives.length) bad.push(`${s.slug}: no alternative`);
      for (const n of s.notes) if (!noteSlugs.has(n)) bad.push(`${s.slug}: note ${n}`);
      for (const p of s.patterns) if (!patternSlugs.has(p)) bad.push(`${s.slug}: pattern ${p}`);
      if (s.dataset !== "northwind" && !Object.keys(dataFiles).some((p) => p.endsWith(`/${s.dataset}.sql`))) bad.push(`${s.slug}: dataset ${s.dataset}`);
    }
    expect(bad).toEqual([]);
  });

  it("solutions return rows on their dataset and every alternative grades correct", async () => {
    const dbs = new Map<string, SqlDb>();
    const db = async (id: string) => {
      if (!dbs.has(id)) {
        const pg = new PGlite();
        await pg.exec(id === "northwind" ? northwind : Object.entries(dataFiles).find(([p]) => p.endsWith(`/${id}.sql`))![1]);
        dbs.set(id, pg as unknown as SqlDb);
      }
      return dbs.get(id)!;
    };
    const bad: string[] = [];
    for (const s of scenarios) {
      const d = await db(s.dataset);
      const run = await execute(d, s.solution);
      if (!run.success || !run.row_count) {
        bad.push(`${s.slug}: solution ${run.message ?? "0 rows"}`);
        continue;
      }
      const self = await submit(d, s.solution, s.solution, Boolean(s.orderBy), s.orderBy);
      if (!self.correct) bad.push(`${s.slug}: solution not stable (${self.message})`);
      for (const [i, alt] of s.alternatives.entries()) {
        const r = await submit(d, alt, s.solution, Boolean(s.orderBy), s.orderBy);
        if (!r.correct) bad.push(`${s.slug}: alternative ${i + 1} — ${r.message} ${r.feedback.join(" | ")}`);
      }
    }
    expect(bad).toEqual([]);
  }, 300_000);
});
