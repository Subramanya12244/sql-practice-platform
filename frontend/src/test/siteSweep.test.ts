// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { submit, type SqlDb } from "../site/lib/sqlRunner";
import type { Question } from "../site/types";

const questions = Object.values(import.meta.glob<Question>("../../public/data/q/*.json", { eager: true, import: "default" }));

it("every reference solution grades itself correct in the browser DB, even when run twice", async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  const db = pg as unknown as SqlDb;
  const bad: string[] = [];
  for (const q of questions) {
    const r = await submit(db, q.referenceQuery, q.referenceQuery, q.sortRequired, q.orderBy ?? null);
    if (!r.correct) bad.push(`Q${q.number}: ${r.message} ${r.feedback.join(" | ")}`);
  }
  expect(questions.length).toBe(133);
  expect(bad).toEqual([]);
}, 300_000);
