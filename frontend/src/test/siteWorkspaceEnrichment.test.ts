// @vitest-environment node
// Workspace enrichment content (content/workspace/enrichment/*.json): schema, ids, hint safety, uniqueness, and real execution of
// every alternative solution (SQL on PGlite with the shared grader, Python / pandas / NumPy in CPython). Nothing is mocked.
//
//   DAILY_PYTHON=/path/to/venv/bin/python   interpreter with content/daily/requirements.txt installed
//   ENRICH_REQUIRE_PYTHON=1                 fail instead of skip when the interpreter or its packages are missing
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { setJsonFetcher } from "../site/lib/data";
import { sameOutput, type DayExtras } from "../site/lib/daily";
import { HIDDEN_ROWS, submit, type SqlDb } from "../site/lib/sqlRunner";
import { dailyDayExercises, enrichmentProblems, loadBaseExerciseById, mergeEnrichment, parseExerciseId } from "../site/workspace/sources";
import type { Domain, ExerciseDef, ExerciseEnrichment } from "../site/workspace/types";

const ROOT = resolve(__dirname, "../..");
const files = import.meta.glob<{ version: number; items: Record<string, ExerciseEnrichment> }>("../site/content/workspace/enrichment/*.json", { eager: true, import: "default" });
const dailyFiles = Object.values(import.meta.glob<DayExtras>("../site/content/daily/days/*.json", { eager: true, import: "default" }));
const sqlFileCount = Object.keys(import.meta.glob("../../public/data/q/*.json")).length;
const pyFileCount = Object.keys(import.meta.glob("../site/content/python/*.md", { query: "?raw" })).length;

const ALLOWED_KEYS = new Set(["hints", "debugging", "alternatives", "constraints", "realWorld", "prerequisites", "commonMistakes", "complexity", "interviewRelevance", "explanation"]);
const SQL_CATEGORIES = ["syntax", "join", "filter", "grouping", "aggregation", "null", "window", "performance"];
const PY_CATEGORIES = ["syntax", "types", "variables", "control-flow", "functions", "runtime", "indexing", "filtering", "grouping", "join", "missing-data", "shape", "broadcasting", "axis", "matmul", "transformation"];
const MIN_PER_CATEGORY = 3;

interface Entry { file: string; id: string; item: ExerciseEnrichment }
const entries: Entry[] = Object.entries(files).flatMap(([path, f]) => Object.entries(f?.items ?? {}).map(([id, item]) => ({ file: path.split("/").pop()!, id, item })));
const real = Object.entries(files).filter(([p]) => !p.endsWith("/_empty.json"));

const bases = new Map<string, ExerciseDef | null>();
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// ---------- Python environment ----------
const venvPython = join(ROOT, ".venv-daily", "bin", "python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const pyVersion = spawnSync(PYTHON, ["--version"]);
const hasPython = pyVersion.status === 0;
const hasData = hasPython && spawnSync(PYTHON, ["-c", "import numpy, pandas"]).status === 0;
const requirePython = process.env.ENRICH_REQUIRE_PYTHON === "1";
if (!hasPython || !hasData) {
  // eslint-disable-next-line no-console
  console.warn(`[enrichment] ${!hasPython ? `no Python at ${PYTHON}` : `${PYTHON} lacks numpy or pandas`}: ${requirePython ? "failing (ENRICH_REQUIRE_PYTHON=1)" : "Python alternatives that need it are skipped. Set DAILY_PYTHON to a venv with content/daily/requirements.txt"}.`);
}

const scratch = mkdtempSync(join(tmpdir(), "enrich-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function runPython(code: string, stdin = ""): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(PYTHON, ["-I", "-c", code], { cwd: scratch, input: stdin, encoding: "utf8", timeout: 60_000, env: { ...process.env, MPLBACKEND: "Agg", PYTHONHASHSEED: "0", TZ: "UTC", LC_ALL: "C.UTF-8" } });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Exercises are loaded at module level (top-level await) so the tests below can be generated per domain.
setJsonFetcher(async (path) => JSON.parse(readFileSync(join(ROOT, "public", path), "utf8")));
{
  const ids = [...new Set(entries.map((e) => e.id))];
  const loaded = await Promise.all(ids.map((id) => loadBaseExerciseById(id)));
  ids.forEach((id, i) => bases.set(id, loaded[i]));
}

let db: SqlDb;
beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  db = pg as unknown as SqlDb;
}, 120_000);

const domainOf = (id: string): Domain | "unknown" => bases.get(id)?.domain ?? "unknown";
const textsOf = (e: ExerciseEnrichment): string[] => [
  ...(e.hints ?? []).flatMap((h) => [h.title, h.body]),
  ...(e.debugging ?? []).flatMap((d) => [d.category, d.symptom, d.cause, d.fix]),
  ...(e.alternatives ?? []).flatMap((a) => [a.title, a.code, ...(a.note === undefined ? [] : [a.note])]),
  ...(e.constraints ?? []), ...(e.commonMistakes ?? []), ...(e.prerequisites ?? []),
  ...(e.realWorld === undefined ? [] : [e.realWorld]), ...(e.interviewRelevance === undefined ? [] : [e.interviewRelevance]), ...(e.explanation === undefined ? [] : [e.explanation]),
  ...(e.complexity ? Object.values(e.complexity) : []),
];

describe("enrichment files: schema", () => {
  it("has at least one real file and no placeholder next to real content", () => {
    expect(real.length).toBeGreaterThan(0);
    expect(Object.keys(files).some((p) => p.endsWith("/_empty.json"))).toBe(false);
  });
  for (const [path, f] of real) {
    const name = path.split("/").pop()!;
    it(`${name}: version 1 with an items object and known keys only`, () => {
      expect(f.version).toBe(1);
      expect(f.items && typeof f.items === "object" && !Array.isArray(f.items)).toBe(true);
      expect(Object.keys(f.items).length).toBeGreaterThan(0);
      for (const [id, item] of Object.entries(f.items)) {
        expect(parseExerciseId(id), `${id}: id is not sql:, py: or daily:<day>#<id>`).not.toBeNull();
        const extra = Object.keys(item).filter((k) => !ALLOWED_KEYS.has(k));
        expect(extra, `${id}: unknown keys`).toEqual([]);
      }
    });
  }
  it("no id appears in two files or twice in the data", () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const e of entries) {
      if (seen.has(e.id)) dup.push(`${e.id} in ${seen.get(e.id)} and ${e.file}`);
      seen.set(e.id, e.file);
    }
    expect(dup).toEqual([]);
    // JSON.parse keeps only the last of two equal keys inside one file, so count the raw text as well.
    for (const [path] of real) {
      const raw = readFileSync(join(__dirname, "../site/content/workspace/enrichment", path.split("/").pop()!), "utf8");
      const ids = [...raw.matchAll(/^ {4}"((?:sql|py|daily):[^"]+)": \{/gm)].map((m) => m[1]);
      expect(new Set(ids).size, `${path}: duplicate id inside the file`).toBe(ids.length);
    }
  });
});

describe("enrichment items: ids exist and content is valid", () => {
  it("every id resolves to a real exercise", () => {
    const missing = entries.filter((e) => !bases.get(e.id)).map((e) => e.id);
    expect(missing).toEqual([]);
  });
  it("enrichmentProblems is empty for every item against its real exercise (no category typo, no empty field, no solution in a hint)", () => {
    const problems = entries.flatMap((e) => enrichmentProblems(e.id, e.item, bases.get(e.id) ?? undefined));
    expect(problems).toEqual([]);
  });
  it("every item is complete: hints 1 to 4, 2 or more debugging notes, constraints, real world, common mistakes", () => {
    const bad: string[] = [];
    for (const { id, item } of entries) {
      const levels = (item.hints ?? []).map((h) => h.level).sort();
      if (levels.join() !== "1,2,3,4") bad.push(`${id}: hints are ${levels.join() || "missing"}`);
      if ((item.debugging?.length ?? 0) < 2) bad.push(`${id}: fewer than 2 debugging notes`);
      if (!item.constraints?.length) bad.push(`${id}: no constraints`);
      if (!item.realWorld?.trim()) bad.push(`${id}: no realWorld`);
      if (!item.commonMistakes?.length) bad.push(`${id}: no commonMistakes`);
      for (const [i, t] of textsOf(item).entries()) if (!t.trim()) bad.push(`${id}: empty text #${i}`);
    }
    expect(bad).toEqual([]);
  });
  it("debugging categories belong to the exercise's own domain list", () => {
    const bad: string[] = [];
    for (const { id, item } of entries) {
      const allowed = domainOf(id) === "sql" ? SQL_CATEGORIES : PY_CATEGORIES;
      for (const d of item.debugging ?? []) if (!allowed.includes(d.category)) bad.push(`${id}: "${d.category}" is not a ${domainOf(id) === "sql" ? "SQL" : "Python-family"} category`);
    }
    expect(bad).toEqual([]);
  });
  it("hint 4 and the debugging fixes never hold the stored solution (checked again here, whitespace and case ignored)", () => {
    const bad: string[] = [];
    for (const { id, item } of entries) {
      const sol = norm(bases.get(id)?.solution?.code ?? "").replace(/[`;]/g, "");
      if (sol.length < 12) continue;
      for (const h of item.hints ?? []) if (norm(h.body).replace(/[`;]/g, "").includes(sol)) bad.push(`${id}: hint ${h.level}`);
      for (const d of item.debugging ?? []) if (norm(d.fix).replace(/[`;]/g, "").includes(sol)) bad.push(`${id}: debugging fix`);
    }
    expect(bad).toEqual([]);
  });
  it("no hint, debugging cause or real-world text is reused across different exercises", () => {
    const owner = new Map<string, string>();
    const reused: string[] = [];
    const check = (kind: string, id: string, text: string) => {
      const key = `${kind}|${norm(text)}`;
      const o = owner.get(key);
      if (o && o !== id) reused.push(`${kind} shared by ${o} and ${id}: "${text.slice(0, 70)}"`);
      owner.set(key, id);
    };
    for (const { id, item } of entries) {
      for (const h of item.hints ?? []) check("hint", id, h.body);
      for (const d of item.debugging ?? []) { check("cause", id, d.cause); check("symptom", id, d.symptom); }
      if (item.realWorld) check("realWorld", id, item.realWorld);
    }
    expect(reused).toEqual([]);
  });
  it("an exercise's own hints are all different from each other", () => {
    const bad = entries.filter(({ item }) => new Set((item.hints ?? []).map((h) => norm(h.body))).size !== (item.hints ?? []).length).map((e) => e.id);
    expect(bad).toEqual([]);
  });
});

describe("the validator rejects bad content (negative controls on real exercises)", () => {
  const sample = () => {
    const id = entries[0].id;
    return { id, base: bases.get(id)!, item: entries[0].item };
  };
  it("rejects an unknown category, an empty note field, a hint level 5, a duplicate level and an empty alternative note", () => {
    const { id, base, item } = sample();
    const bad: ExerciseEnrichment = {
      hints: [{ level: 5, title: "x", body: "full solution" } as never, { level: 1, title: "a", body: "x" }, { level: 1, title: "b", body: "y" }],
      debugging: [{ category: "made-up", symptom: "s", cause: "c", fix: "f" }, { category: "syntax", symptom: " ", cause: "c", fix: "f" }],
      alternatives: [{ title: "t", code: "SELECT 1", note: " " }],
    };
    const problems = enrichmentProblems(id, bad, base).join("\n");
    for (const needle of ["level 5", "duplicate hint level 1", "unknown debugging category", "incomplete", "empty note"]) expect(problems).toContain(needle);
    expect(enrichmentProblems(id, item, base)).toEqual([]);
  });
  it("rejects a hint that holds the stored solution, even with different spacing and case", () => {
    const { id, base } = sample();
    const sol = base.solution!.code;
    const spaced = sol.replace(/\s+/g, "  ").toUpperCase();
    expect(enrichmentProblems(id, { hints: [{ level: 3, title: "x", body: `try ${spaced}` }] }, base).join()).toContain("contains the full solution");
  });
});

describe("merging never changes grading data", () => {
  it("validation, starterCode and solution.code are deep-equal before and after mergeEnrichment, for every item", () => {
    const changed: string[] = [];
    let merged = 0;
    for (const { id, item } of entries) {
      const base = bases.get(id);
      if (!base) continue;
      const before = JSON.stringify({ v: base.validation, s: base.starterCode, c: base.solution?.code });
      const out = mergeEnrichment(base, item);
      const after = JSON.stringify({ v: out.validation, s: out.starterCode, c: out.solution?.code });
      if (before !== after) changed.push(id);
      if (out !== base) merged++;
      expect(out.hints.map((h) => h.level).every((l) => [1, 2, 3, 4].includes(l)), `${id}: a level outside 1 to 4`).toBe(true);
      expect(out.hints.filter((h) => item.hints?.some((n) => n.level === h.level)).map((h) => h.body).sort()).toEqual((item.hints ?? []).map((h) => h.body).sort());
      expect(out.debugging?.length ?? 0).toBe(item.debugging?.length ?? 0);
    }
    expect(changed).toEqual([]);
    expect(merged, "every valid item must actually merge").toBe(entries.length);
  });
  it("an item with a leaked hint is ignored whole (the safety net works on real data)", () => {
    const e = entries.find((x) => bases.get(x.id)?.solution?.code && bases.get(x.id)!.solution!.code.length > 20)!;
    const base = bases.get(e.id)!;
    const bad: ExerciseEnrichment = { ...e.item, hints: [{ level: 4, title: "x", body: `Answer:\n${base.solution!.code}` }] };
    expect(mergeEnrichment(base, bad)).toBe(base);
  });
});

const sqlAlts = entries.filter((e) => e.id.startsWith("sql:")).flatMap((e) => (e.item.alternatives ?? []).map((a) => ({ ...e, alt: a })));
const dailySqlAlts = entries.filter((e) => e.id.startsWith("daily:")).flatMap((e) => (e.item.alternatives ?? []).map((a) => ({ ...e, alt: a })));

describe("SQL alternatives run on real PGlite and return the reference result", () => {
  it("there are SQL alternatives to run", () => { expect(sqlAlts.length).toBeGreaterThan(0); });
  for (const a of sqlAlts) {
    it(`${a.id}: "${a.alt.title}" matches the reference query (visible and hidden rows)`, async () => {
      const base = bases.get(a.id)!;
      expect(base.validation.kind).toBe("sql-result");
      const v = base.validation as Extract<ExerciseDef["validation"], { kind: "sql-result" }>;
      expect(norm(a.alt.code), "an alternative must differ from the stored solution").not.toBe(norm(base.solution?.code ?? ""));
      const r = await submit(db, a.alt.code, v.expectedSql, !!v.orderMatters, v.orderBy ?? null, HIDDEN_ROWS);
      expect(r.correct, `${r.message} ${(r.feedback ?? []).join(" ")}`).toBe(true);
    }, 60_000);
  }
});

// Daily SQL alternatives (graded with the same helper), Python library alternatives, Daily Python / pandas / NumPy alternatives.
describe("Daily SQL alternatives run on real PGlite and return the reference result", () => {
  for (const a of dailySqlAlts.filter((x) => bases.get(x.id)?.validation.kind === "sql-result")) {
    it(`${a.id}: "${a.alt.title}"`, async () => {
      const base = bases.get(a.id)!;
      const v = base.validation as Extract<ExerciseDef["validation"], { kind: "sql-result" }>;
      const r = await submit(db, a.alt.code, v.expectedSql, !!v.orderMatters, null, HIDDEN_ROWS);
      expect(r.correct, `${r.message} ${(r.feedback ?? []).join(" ")}`).toBe(true);
    }, 60_000);
  }
});

const libAlts = entries.filter((e) => e.id.startsWith("py:")).flatMap((e) => (e.item.alternatives ?? []).map((a) => ({ ...e, alt: a })));
describe("Python library alternatives pass the exercise's own visible and hidden tests in CPython", () => {
  it("there are Python alternatives to run", () => { expect(libAlts.length).toBeGreaterThan(0); });
  const run = hasPython || requirePython ? it : it.skip;
  for (const a of libAlts) {
    run(`${a.id}: "${a.alt.title}"`, () => {
      expect(hasPython, `no Python at ${PYTHON}`).toBe(true);
      const base = bases.get(a.id)!;
      expect(base.validation.kind).toBe("python-tests");
      const v = base.validation as Extract<ExerciseDef["validation"], { kind: "python-tests" }>;
      expect(norm(a.alt.code), "an alternative must differ from the stored solution").not.toBe(norm(base.solution?.code ?? ""));
      const r = runPython([a.alt.code, v.tests, v.hidden ?? ""].join("\n"));
      expect(r.status, r.stderr.split("\n").slice(-6).join("\n")).toBe(0);
    }, 70_000);
  }
});

const dailyPyAlts = entries.filter((e) => e.id.startsWith("daily:")).flatMap((e) => (e.item.alternatives ?? []).map((a) => ({ ...e, alt: a })));
describe("Daily Python, pandas and NumPy alternatives print the exercise's expected output in CPython", () => {
  for (const a of dailyPyAlts.filter((x) => bases.get(x.id)?.domain !== "sql")) {
    const dom = bases.get(a.id)?.domain;
    const needs = dom === "pandas" || dom === "numpy";
    const run = (needs ? hasData : hasPython) || requirePython ? it : it.skip;
    run(`${a.id} (${dom}): "${a.alt.title}"`, () => {
      const base = bases.get(a.id)!;
      expect(base.validation.kind).toBe("python-stdout");
      const v = base.validation as Extract<ExerciseDef["validation"], { kind: "python-stdout" }>;
      expect(norm(a.alt.code), "an alternative must differ from the stored solution").not.toBe(norm(base.solution?.code ?? ""));
      const r = runPython(a.alt.code, v.stdin ? `${v.stdin}\n` : "");
      expect(r.status, r.stderr.split("\n").slice(-6).join("\n")).toBe(0);
      expect(sameOutput(r.stdout, v.expected), `output:\n${r.stdout}\nexpected:\n${v.expected}`).toBe(true);
    }, 70_000);
  }
});

describe("coverage", () => {
  it("reports and enforces coverage", () => {
    const supply = {
      sql: sqlFileCount, python: pyFileCount,
      daily: dailyFiles.flatMap((d) => dailyDayExercises(d.id, d)).length,
    };
    const dailyByDomain: Record<string, number> = {};
    for (const d of dailyFiles) for (const e of dailyDayExercises(d.id, d)) dailyByDomain[e.domain] = (dailyByDomain[e.domain] ?? 0) + 1;
    const byKind = (p: string) => entries.filter((e) => e.id.startsWith(p));
    const byDomain: Record<string, number> = {};
    for (const e of entries) {
      const origin = e.id.startsWith("daily:") ? "daily" : e.id.startsWith("py:") ? "library" : "bank";
      const key = `${origin}-${domainOf(e.id)}`;
      byDomain[key] = (byDomain[key] ?? 0) + 1;
    }
    const cat: Record<string, Record<string, number>> = { sql: {}, python: {} };
    const catItems: Record<string, Record<string, Set<string>>> = { sql: {}, python: {} };
    for (const { id, item } of entries) {
      const fam = domainOf(id) === "sql" ? "sql" : "python";
      for (const d of item.debugging ?? []) {
        cat[fam][d.category] = (cat[fam][d.category] ?? 0) + 1;
        (catItems[fam][d.category] ??= new Set()).add(id);
      }
    }
    const alts = entries.reduce((n, e) => n + (e.item.alternatives?.length ?? 0), 0);
    const report = {
      items: entries.length,
      bySource: { "sql:": byKind("sql:").length, "py:": byKind("py:").length, "daily:": byKind("daily:").length },
      byDomain,
      supply: { ...supply, dailyByDomain },
      fractionEnriched: {
        sqlBank: `${byKind("sql:").length}/${supply.sql}`,
        pythonLibrary: `${byKind("py:").length}/${supply.python}`,
        dailyGraded: `${byKind("daily:").length}/${supply.daily}`,
        all: `${entries.length}/${supply.sql + supply.python + supply.daily}`,
      },
      alternatives: alts,
      debuggingNotesByCategory: cat,
    };
    // eslint-disable-next-line no-console
    console.log(`[enrichment coverage] ${JSON.stringify(report, null, 2)}`);
    expect(byKind("sql:").length).toBeGreaterThanOrEqual(40);
    expect(byKind("py:").length).toBeGreaterThanOrEqual(30);
    expect(byKind("daily:").length).toBeGreaterThanOrEqual(40);
    const dailyDomains = new Set(byKind("daily:").map((e) => domainOf(e.id)));
    for (const d of ["sql", "python", "pandas", "numpy"]) expect(dailyDomains.has(d as Domain), `no Daily ${d} item`).toBe(true);
    for (const c of SQL_CATEGORIES) expect(cat.sql[c] ?? 0, `SQL category ${c}`).toBeGreaterThanOrEqual(MIN_PER_CATEGORY);
    for (const c of PY_CATEGORIES) expect(cat.python[c] ?? 0, `Python-family category ${c}`).toBeGreaterThanOrEqual(MIN_PER_CATEGORY);
    expect(alts).toBeGreaterThanOrEqual(20);
  });
});
