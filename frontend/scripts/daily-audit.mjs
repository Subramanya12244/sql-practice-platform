// Per-lesson audit of the 270-day curriculum, read from the real files (not from earlier reports).
//   node scripts/daily-audit.mjs                       print the summary
//   node scripts/daily-audit.mjs --json out.json       also write every lesson's metrics
//   node scripts/daily-audit.mjs --results vitest.json use a vitest JSON report (`npx vitest run src/test/siteDaily.test.ts --reporter=json --outputFile=vitest.json`) for pass/fail
//   node scripts/daily-audit.mjs --write-doc           replace the table between the LESSON TABLE markers in docs/WORKSPACE_CONTENT_AUDIT.md
// Status: missing (no file), incomplete (a file or required piece is absent), failing (a test for the day failed), validated (all of the day's tests passed),
// unverified (present and complete, but no test results were given).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { curriculum, dailyDir, loadDays } from "./daily-lib.mjs";
import { lessonWorkspace } from "../src/site/lib/visual/dailyVisual.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const words = (s) => (s ?? "").split(/\s+/).filter(Boolean).length;
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, "");
const files = new Set(fs.readdirSync(path.join(dailyDir, "days")));
const days = new Map(loadDays().map((d) => [d.id, d]));
const byId = new Map(curriculum.days.map((d) => [d.id, d]));
const REQ = ["Objectives", "Understand", "Syntax and key functions", "Learn by example", "Real-world applications", "Daily review", "Revision task", "Next-day preparation"];
const DEBUG_TITLE = /\b(fix|debug|bug|buggy|broken|repair|faulty)\b/i;
/** A lesson is shallow when its Understand prose (code fences excluded) is under 60% of the median of the same phase and kind (lesson vs project/checkpoint/capstone). */
const SHALLOW = 0.6;

// vitest results per day
const status = new Map();
if (arg("--results")) {
  const rep = JSON.parse(fs.readFileSync(arg("--results"), "utf8"));
  for (const f of rep.testResults) for (const t of f.assertionResults) {
    const m = /^([dae]\d{3})\b/.exec(t.ancestorTitles[0] ?? "");
    if (!m) continue;
    const s = status.get(m[1]) ?? { pass: 0, fail: 0, skip: 0, failed: [] };
    if (t.status === "passed") s.pass++; else if (t.status === "failed") { s.fail++; s.failed.push(t.title); } else s.skip++;
    status.set(m[1], s);
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const rows = [];
for (const m of curriculum.days) {
  const d = days.get(m.id);
  const r = { id: m.id, day: m.day, path: m.path, phase: m.phase, kind: m.kind, title: m.title, md: files.has(`${m.id}.md`), json: files.has(`${m.id}.json`), problems: [] };
  const seq = curriculum.days.filter((x) => x.path === m.path);
  const prev = seq[seq.findIndex((x) => x.id === m.id) - 1];
  for (const p of m.prerequisites) {
    const pm = byId.get(p);
    if (!pm) r.problems.push(`prerequisite ${p} does not exist`);
    else if (pm.day >= m.day) r.problems.push(`prerequisite ${p} is not earlier`);
    else if (!(pm.path === "common" || pm.path === m.path)) r.problems.push(`prerequisite ${p} is on another route`);
  }
  r.prereqOk = !r.problems.length;
  r.prevInPrereqs = prev ? m.prerequisites.includes(prev.id) : true;
  if (!d) { r.exists = false; rows.push(r); continue; }
  r.exists = true;
  const sec = d.sections, ex = d.extras, all = [...ex.guided, ...ex.independent];
  const absent = REQ.filter((k) => !(k in sec));
  if (absent.length) r.problems.push(`sections missing: ${absent.join(", ")}`);
  Object.assign(r, {
    understand: words(stripCode(sec["Understand"] ?? "")),
    run: d.examples.filter((e) => e.browser).length, local: d.examples.filter((e) => e.lang === "python" && !e.browser).length, bash: d.examples.filter((e) => e.lang === "bash").length,
    guided: ex.guided.length, independent: ex.independent.length, graded: all.filter((e) => e.kind !== "written").length, written: all.filter((e) => e.kind === "written").length,
    debug: all.filter((e) => DEBUG_TITLE.test(e.title)).length, checks: ex.checks.length, realWorld: (sec["Real-world applications"] ?? "").length > 0, revision: (sec["Revision task"] ?? "").length > 0,
    nextDay: (sec["Next-day preparation"] ?? "").length > 0, links: Object.values(ex.links ?? {}).flat().length, env: !!ex.environment,
    hints: ex.guided.map((e) => e.hints?.length ?? 0), ws: lessonWorkspace(m.id, m.title, m.topics)?.primary ?? null,
  });
  rows.push(r);
}
const groups = new Map();
for (const r of rows) if (r.exists) { const k = `${r.phase}|${r.kind === "lesson" ? "lesson" : "other"}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(r.understand); }
for (const r of rows) if (r.exists) { r.median = med(groups.get(`${r.phase}|${r.kind === "lesson" ? "lesson" : "other"}`)); r.shallow = r.understand < SHALLOW * r.median; }
for (const r of rows) {
  const t = status.get(r.id);
  r.test = t ? (t.fail ? `${t.fail} failed` : `${t.pass} passed`) : "";
  if (!r.exists) r.status = "missing";
  else if (r.problems.length || !r.md || !r.json) r.status = "incomplete";
  else if (t?.fail) r.status = "failing";
  else if (t && t.pass > 0) r.status = "validated";
  else r.status = "unverified";
}

const count = (s) => rows.filter((r) => r.status === s).length;
const present = rows.filter((r) => r.exists);
const sum = (k) => present.reduce((a, r) => a + r[k], 0);
const summary = [
  `Lessons: ${rows.length} curriculum entries; validated ${count("validated")}, failing ${count("failing")}, incomplete ${count("incomplete")}, missing ${count("missing")}, unverified (no test results given) ${count("unverified")}.`,
  `Shallow (Understand words under ${SHALLOW * 100}% of the phase-and-kind median): ${present.filter((r) => r.shallow).length}.`,
  `Examples: ${sum("run")} run, ${sum("local")} python local, ${sum("bash")} bash run. Exercises: ${sum("guided")} guided, ${sum("independent")} independent, ${sum("graded")} graded, ${sum("written")} written. Explicit debug/fix exercises (title): ${sum("debug")} in ${present.filter((r) => r.debug).length} lessons. Checks: ${sum("checks")}.`,
];

const table = [
  "| Id | Kind | Understand (median) | Run/local/bash | G+I | Graded/written | Debug | Checks | Links | Hints 3x | Workspace | Status |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => r.exists
    ? `| ${r.id} | ${r.kind[0]} | ${r.understand}${r.shallow ? " (shallow)" : ""} (${r.median}) | ${r.run}/${r.local}/${r.bash} | ${r.guided}+${r.independent} | ${r.graded}/${r.written} | ${r.debug || ""} | ${r.checks} | ${r.links} | ${r.hints.every((h) => h === 3) ? "yes" : "NO"} | ${r.ws ?? "none"} | ${r.status}${r.test ? ` (${r.test})` : ""} |`
    : `| ${r.id} | ${r.kind[0]} | | | | | | | | | | ${r.status} |`),
].join("\n");

if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify({ summary, rows }, null, 1));
if (process.argv.includes("--write-doc")) {
  const docPath = path.join(here, "../../docs/WORKSPACE_CONTENT_AUDIT.md");
  const doc = fs.readFileSync(docPath, "utf8");
  const next = doc.replace(/<!-- LESSON TABLE START -->[\s\S]*?<!-- LESSON TABLE END -->/, () => `<!-- LESSON TABLE START -->\n${table}\n<!-- LESSON TABLE END -->`);
  fs.writeFileSync(docPath, next);
  console.log(`updated ${docPath}`);
}
console.log(summary.join("\n"));
