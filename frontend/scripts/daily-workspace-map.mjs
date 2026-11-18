// Regenerates the WORKSPACE_EXERCISES / WORKSPACE_EXTRA_PACKAGES table in src/site/lib/visual/dailyVisual.ts from the real lesson JSON.
//   node scripts/daily-workspace-map.mjs          rewrite the table between the WORKSPACE_MAP markers
//   node scripts/daily-workspace-map.mjs --check  exit 1 when the table is stale (no write)
// Uses the same classifier the app uses (workspaceDomainOfExercise), so the table cannot drift from the rule.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { curriculum, loadDays } from "./daily-lib.mjs";
import { extraPackagesOf, workspaceDomainOfExercise } from "../src/site/lib/visual/dailyVisual.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "../src/site/lib/visual/dailyVisual.ts");
const LETTER = { sql: "s", python: "p", pandas: "d", numpy: "n", null: "w" };
const byId = new Map(loadDays().map((d) => [d.id, d]));
const rows = [];
const extras = [];
for (const m of curriculum.days) {
  const d = byId.get(m.id);
  if (!d) continue;
  const enc = (list) => list.map((e) => LETTER[String(workspaceDomainOfExercise(e.kind, e.solution))]).join("");
  rows.push(`  ${m.id}: "${enc(d.extras.guided)}|${enc(d.extras.independent)}",`);
  for (const [group, list] of [["g", d.extras.guided], ["i", d.extras.independent]]) {
    list.forEach((e, i) => { const p = e.kind === "python" ? extraPackagesOf(e.solution) : []; if (p.length) extras.push(`  "${m.id}/${group}${i + 1}": ${JSON.stringify(p)},`); });
  }
}
const block = [
  "// WORKSPACE_MAP_START",
  "/** Per lesson: one letter per exercise, guided then independent, separated by \"|\". s sql, p python, d pandas, n numpy, w written. */",
  "export const WORKSPACE_EXERCISES: Record<string, string> = {", ...rows, "};",
  "/** Exercises (`<day>/<exercise id>`) whose solution imports scipy or statsmodels. */",
  "export const WORKSPACE_EXTRA_PACKAGES: Record<string, string[]> = {", ...extras, "};",
  "// WORKSPACE_MAP_END",
].join("\n");
const src = fs.readFileSync(target, "utf8");
const next = src.replace(/\/\/ WORKSPACE_MAP_START[\s\S]*?\/\/ WORKSPACE_MAP_END/, () => block);
if (process.argv.includes("--check")) {
  if (next !== src) { console.error("dailyVisual.ts workspace table is stale: run node scripts/daily-workspace-map.mjs"); process.exit(1); }
  console.log(`workspace table is current: ${rows.length} lessons, ${extras.length} exercises with extra packages`);
} else {
  fs.writeFileSync(target, next);
  console.log(`wrote ${rows.length} lessons, ${extras.length} exercises with extra packages`);
}
