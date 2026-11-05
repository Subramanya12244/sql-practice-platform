// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { HIDDEN_ROWS, submit, type SqlDb } from "../site/lib/sqlRunner";
import type { Question } from "../site/types";

const questions = Object.values(import.meta.glob<Question>("../../public/data/q/*.json", { eager: true, import: "default" }));

it("every reference solution grades itself correct, including on the hidden test data", async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  const db = pg as unknown as SqlDb;
  const bad: string[] = [];
  for (const q of questions) {
    const r = await submit(db, q.referenceQuery, q.referenceQuery, q.sortRequired, q.orderBy ?? null, HIDDEN_ROWS);
    if (!r.correct) bad.push(`Q${q.number}: ${r.message} ${r.feedback.join(" | ")}`);
  }
  expect(questions.length).toBe(150);
  expect(bad).toEqual([]);
}, 300_000);

it("the hidden test data catches an answer hard-coded to the visible rows", async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  const db = pg as unknown as SqlDb;
  const ref = "SELECT order_id, order_date FROM orders ORDER BY order_date DESC, order_id DESC LIMIT 1";
  const [[id, date]] = (await pg.query<[number, string]>(ref, [], { rowMode: "array" })).rows;
  const hardcoded = `SELECT order_id, order_date FROM orders WHERE order_id = ${id}`;
  expect((await submit(db, hardcoded, ref, false, null)).correct).toBe(true); // visible data alone can't tell
  const r = await submit(db, hardcoded, ref, false, null, HIDDEN_ROWS);
  expect(r).toMatchObject({ correct: false, hidden_failed: true });
  expect(String(date)).toBeTruthy();
  // A general solution still passes both.
  expect((await submit(db, ref, ref, false, null, HIDDEN_ROWS)).correct).toBe(true);
});
