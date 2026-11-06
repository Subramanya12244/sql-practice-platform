/**
 * Builds supabase/migrations/011_assessments.sql from scripts/assessment/*.json.
 * - SQL: runs each reference query on Northwind (PGlite) and stores the result fingerprint.
 * - Python: runs each reference solution in CPython on its hidden cases and stores one
 *   fingerprint per case; checks every public example against the reference.
 * Usage (from frontend/): npx tsx scripts/build-assessments.mts <python-binary>
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { pyCasesProgram, readCases, sha256, sqlFingerprint } from "../src/site/lib/assessment";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DIR = path.join(ROOT, "scripts/assessment");
const PY = process.argv[2] ?? "python3";
type Sql = { id: string; difficulty: string; topic: string; title: string; problem: string; objective: string; ordered: boolean; reference: string; explanation: string };
type Py = { id: string; difficulty: string; topic: string; title: string; problem: string; starter: string; example: string; reference: string; cases: string[]; explanation: string };
const sqlItems: Sql[] = JSON.parse(fs.readFileSync(path.join(DIR, "sql_items.json"), "utf8"));
const pyItems: Py[] = JSON.parse(fs.readFileSync(path.join(DIR, "python_items.json"), "utf8"));
const lit = (s: string) => `$df$${s}$df$`;
if ([...sqlItems, ...pyItems].some((i) => JSON.stringify(i).includes("$df$"))) throw new Error("content contains the dollar-quote tag");

const runPy = (code: string) => execFileSync(PY, ["-I", "-c", code], { encoding: "utf8", timeout: 60_000 });

const pg = new PGlite();
await pg.exec(fs.readFileSync(path.join(ROOT, "frontend/public/data/northwind.sql"), "utf8"));
const rows: string[] = [];
const ids = new Set<string>();
for (const it of sqlItems) {
  if (ids.has(it.id)) throw new Error(`duplicate id ${it.id}`);
  ids.add(it.id);
  const r = await pg.query<Record<string, unknown>>(it.reference, [], { rowMode: "array" });
  const cols = r.fields.map((f) => f.name);
  const data = r.rows as unknown as unknown[][];
  if (!data.length) throw new Error(`${it.id}: reference returns no rows`);
  const fp = await sqlFingerprint(cols, data, it.ordered);
  console.log(`${it.id} ${String(data.length).padStart(3)} rows  ${cols.join(", ")}`);
  rows.push(`(${lit(it.id)}, 'sql', ${lit(it.title)}, ${lit(it.difficulty)}, ${lit(it.topic)}, ${lit(JSON.stringify({ problem: it.problem, objective: it.objective, ordered: it.ordered }))}::jsonb, ${lit(JSON.stringify({ sql: fp }))}::jsonb, ${lit(it.reference)}, ${lit(it.explanation)})`);
}
for (const it of pyItems) {
  if (ids.has(it.id)) throw new Error(`duplicate id ${it.id}`);
  ids.add(it.id);
  const outs = readCases(runPy(`${it.reference}\n${pyCasesProgram(it.cases)}`));
  if (outs.length !== it.cases.length) throw new Error(`${it.id}: expected ${it.cases.length} case outputs, got ${outs.length}`);
  if (outs.some((o) => o.startsWith('{"e"') && !it.cases[outs.indexOf(o)].includes("x'"))) {
    // Raising is a valid expected outcome (e.g. a cycle); just report it.
    console.log(`  ${it.id}: some cases expect an exception: ${outs.filter((o) => o.startsWith('{"e"')).join(" ")}`);
  }
  // The public example must agree with the reference.
  const [lhs, rhs] = it.example.split(/\s+->\s+/);
  const ex = readCases(runPy(`${it.reference}\n${pyCasesProgram([lhs, rhs])}`));
  if (ex[0] !== ex[1]) throw new Error(`${it.id}: example says ${rhs} but the reference gives ${ex[0]}`);
  // The starter must not already pass.
  const st = readCases(runPy(`${it.starter}\n${pyCasesProgram(it.cases)}`));
  if (st.every((o, i) => o === outs[i])) throw new Error(`${it.id}: the starter passes every case`);
  const hashes = await Promise.all(outs.map(sha256));
  console.log(`${it.id} ${it.cases.length} cases`);
  rows.push(`(${lit(it.id)}, 'python', ${lit(it.title)}, ${lit(it.difficulty)}, ${lit(it.topic)}, ${lit(JSON.stringify({ problem: it.problem, starter: it.starter, example: it.example, cases: it.cases }))}::jsonb, ${lit(JSON.stringify({ cases: hashes }))}::jsonb, ${lit(it.reference)}, ${lit(it.explanation)})`);
}
const schema = fs.readFileSync(path.join(DIR, "schema.sql"), "utf8");
const data = `\n-- Items (generated).\ninsert into public.assessment_items (id, kind, title, difficulty, topic, prompt, answer, reference, explanation) values\n${rows.join(",\n")}\non conflict (id) do update set kind = excluded.kind, title = excluded.title, difficulty = excluded.difficulty, topic = excluded.topic,\n  prompt = excluded.prompt, answer = excluded.answer, reference = excluded.reference, explanation = excluded.explanation, active = true;\n`;
fs.writeFileSync(path.join(ROOT, "supabase/migrations/011_assessments.sql"), schema + data);
console.log(`wrote 011_assessments.sql: ${sqlItems.length} SQL + ${pyItems.length} Python items`);
