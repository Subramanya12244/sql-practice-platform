// Shared reader for Daily Learning content, used by the report and browser-verification scripts.
// It mirrors src/site/lib/daily.ts (splitSections, parseExamples) in plain JavaScript.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const dailyDir = path.join(here, "../src/site/content/daily");
export const curriculum = JSON.parse(fs.readFileSync(path.join(dailyDir, "curriculum.json"), "utf8"));

export function splitSections(md) {
  const out = {};
  const marks = [...md.matchAll(/^##\s+(.+)$/gm)];
  marks.forEach((m, i) => {
    out[m[1].trim()] = md.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim();
  });
  return out;
}

/** Runnable examples in "Learn by example": python run, sql run, python local, bash run (with optional stdin and the output block). */
export function parseExamples(section) {
  const out = [];
  let pending = null;
  let n = 0;
  for (const m of section.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)) {
    const info = m[1].trim();
    const body = m[2].replace(/\n$/, "");
    const [lang, mode] = info.split(/\s+/);
    if (info === "stdin" && pending) { pending.stdin = body; continue; }
    if (info === "output" && pending) { out.push({ ...pending, output: body }); pending = null; continue; }
    if ((mode === "run" && ["python", "sql", "bash"].includes(lang)) || (mode === "local" && lang === "python")) {
      pending = { id: `ex${++n}`, lang, browser: mode === "run" && lang !== "bash", code: body };
    }
  }
  return out;
}

export function loadDays() {
  const dir = path.join(dailyDir, "days");
  const ids = new Set(fs.readdirSync(dir).map((f) => f.replace(/\.(md|json)$/, "")));
  const days = [];
  for (const id of ids) {
    const mdPath = path.join(dir, `${id}.md`);
    const jsonPath = path.join(dir, `${id}.json`);
    if (!fs.existsSync(mdPath) || !fs.existsSync(jsonPath)) continue;
    const md = fs.readFileSync(mdPath, "utf8");
    const extras = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const sections = splitSections(md);
    days.push({ id, md, extras, sections, examples: parseExamples(sections["Learn by example"] ?? ""), meta: curriculum.days.find((d) => d.id === id) });
  }
  return days.sort((a, b) => curriculum.days.findIndex((d) => d.id === a.id) - curriculum.days.findIndex((d) => d.id === b.id));
}
