// @vitest-environment node
// Contract tests for Daily Learning (docs/DAILY_LEARNING_CONTENT.md): curriculum shape, references, and for every authored
// day: structure, sequencing, every example's output and every exercise solution.
//
//   DAILY_DAYS=d006..d018,a091..a103   check only these days (ids or ranges); default: every authored day
//   DAILY_REQUIRE_ALL=1                fail when any curriculum day has no lesson
//   DAILY_PYTHON=/path/to/python       interpreter for `python run` / `python local` (default: <repo>/.venv-daily, then python3)
// Run execution tests in parallel: npx vitest run src/test/siteDaily.test.ts --maxConcurrency=8
import { PGlite } from "@electric-sql/pglite";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import indexJson from "../../public/data/index.json";
import registryJson from "../site/content/tracks.json";
import curriculumJson from "../site/content/daily/curriculum.json";
import { execute, submit, type SqlDb } from "../site/lib/sqlRunner";
import {
  REQUIRED_SECTIONS, parseDay, renderResultText, sameOutput, splitSections,
  type Curriculum, type DayContent, type DayExtras, type Exercise,
} from "../site/lib/daily";

const curriculum = curriculumJson as unknown as Curriculum;
const mdFiles = Object.entries(import.meta.glob<string>("../site/content/daily/days/*.md", { eager: true, query: "?raw", import: "default" }));
const jsonFiles = Object.entries(import.meta.glob<DayExtras>("../site/content/daily/days/*.json", { eager: true, import: "default" }));
const noteFiles = Object.keys(import.meta.glob("../site/content/notes/*/*.md", { query: "?raw" }));
const patternFiles = Object.keys(import.meta.glob("../site/content/patterns/*.md", { query: "?raw" }));
const pyFiles = Object.keys(import.meta.glob("../site/content/python/*.md", { query: "?raw" }));
const mapFiles = Object.keys(import.meta.glob("../site/content/mindmaps/*.json", { query: "?raw" }));
const slug = (p: string) => p.split("/").pop()!.replace(/\.(md|json)$/, "");
const noteSlugs = new Set(noteFiles.map(slug));
const patternSlugs = new Set(patternFiles.map(slug));
const pySlugs = new Set(pyFiles.map(slug));
const mapSlugs = new Set(mapFiles.map(slug));
const projectSlugs = new Set((registryJson.projects as { slug: string }[]).map((p) => p.slug));
const questionNums = new Set((indexJson as { number: number }[]).map((q) => q.number));

const ids = new Set(curriculum.days.map((d) => d.id));
const order = curriculum.days.map((d) => d.id);

/** DAILY_DAYS: comma-separated ids or `a..b` ranges (in curriculum order). Undefined means every day. */
function selected(): Set<string> | null {
  const spec = process.env.DAILY_DAYS?.trim();
  if (!spec) return null;
  const out = new Set<string>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.split("..");
    const i = order.indexOf(a);
    const j = b ? order.indexOf(b) : i;
    if (i < 0 || j < 0) throw new Error(`DAILY_DAYS: unknown day in "${part}"`);
    for (let k = Math.min(i, j); k <= Math.max(i, j); k++) out.add(order[k]);
  }
  return out;
}
const only = selected();
const inScope = (id: string) => !only || only.has(id);

const checkLinks = (where: string, l: NonNullable<DayExtras["links"]>) => {
  const bad: string[] = [];
  for (const s of l.notes ?? []) if (!noteSlugs.has(s)) bad.push(`${where} note ${s}`);
  for (const s of l.patterns ?? []) if (!patternSlugs.has(s)) bad.push(`${where} pattern ${s}`);
  for (const s of l.pyExercises ?? []) if (!pySlugs.has(s)) bad.push(`${where} pyExercise ${s}`);
  for (const s of l.mindmaps ?? []) if (!mapSlugs.has(s)) bad.push(`${where} mindmap ${s}`);
  for (const s of l.projects ?? []) if (!projectSlugs.has(s)) bad.push(`${where} project ${s}`);
  for (const n of l.questions ?? []) if (!questionNums.has(n)) bad.push(`${where} question ${n}`);
  return bad;
};

describe("curriculum", () => {
  it("has 90 common days and 90 days on each path, numbered 1–90 and 91–180", () => {
    const by = (p: string) => curriculum.days.filter((d) => d.path === p).map((d) => d.day);
    expect(by("common")).toEqual(Array.from({ length: 90 }, (_, i) => i + 1));
    expect(by("analyst")).toEqual(Array.from({ length: 90 }, (_, i) => i + 91));
    expect(by("engineer")).toEqual(Array.from({ length: 90 }, (_, i) => i + 91));
    expect(curriculum.programme.totalDays).toBe(180);
    expect(curriculum.days).toHaveLength(270);
  });
  it("gives every day a unique id, title, phase, topics and a realistic duration", () => {
    expect(ids.size).toBe(curriculum.days.length);
    const phases = new Set(curriculum.phases.map((p) => p.id));
    for (const d of curriculum.days) {
      expect(d.id, d.id).toMatch(/^[dae]\d{3}$/);
      expect(d.id.slice(1), d.id).toBe(String(d.day).padStart(3, "0"));
      expect(d.title.length, d.id).toBeGreaterThanOrEqual(5);
      expect(phases.has(d.phase), `${d.id} phase`).toBe(true);
      expect(d.topics.length, `${d.id} topics`).toBeGreaterThanOrEqual(2);
      expect(d.minutes, `${d.id} minutes`).toBeGreaterThanOrEqual(100);
      expect(d.minutes, `${d.id} minutes`).toBeLessThanOrEqual(180);
    }
  });
  it("only lists prerequisites that exist and come earlier on the same route", () => {
    const byId = new Map(curriculum.days.map((d) => [d.id, d]));
    for (const d of curriculum.days) {
      for (const p of d.prerequisites) {
        const pre = byId.get(p);
        expect(pre, `${d.id} prerequisite ${p}`).toBeDefined();
        expect(pre!.day, `${d.id} prerequisite ${p} is earlier`).toBeLessThan(d.day);
        expect(pre!.path === "common" || pre!.path === d.path, `${d.id} prerequisite ${p} is on the same path`).toBe(true);
      }
      if (d.day > 1 && d.path !== "common") expect(d.prerequisites.length, d.id).toBeGreaterThan(0);
    }
  });
  it("covers each phase with a contiguous day range inside its path", () => {
    for (const ph of curriculum.phases) {
      const days = curriculum.days.filter((d) => d.phase === ph.id);
      expect(days.length, ph.id).toBe(ph.lastDay - ph.firstDay + 1);
      expect(days.every((d) => d.path === ph.path), `${ph.id} path`).toBe(true);
      expect(days.map((d) => d.day), ph.id).toEqual(Array.from({ length: days.length }, (_, i) => ph.firstDay + i));
      expect(checkLinks(`phase ${ph.id}`, ph.resources)).toEqual([]);
    }
  });
  it("covers the required topics", () => {
    const text = curriculum.days.map((d) => `${d.title} ${d.topics.join(" ")}`).join(" ").toLowerCase();
    for (const t of [
      "vlookup", "xlookup", "pivottable", "power query", "dax", "power bi", "data storytelling", "pytest", "execution plan", "explain",
      "authentication", "pagination", "rate limit", "retries", "incremental", "upsert", "reconciliation", "source-to-target", "git", "github", "linux",
      "numpy", "pandas", "matplotlib", "seaborn", "plotly", "airflow", "spark", "postgresql", "data warehouse", "star schema", "etl", "elt",
      "statistics", "eda", "rest api", "json", "csv", "excel", "interview", "capstone", "data quality", "business",
    ]) expect(text.includes(t === "data warehouse" ? "warehouse" : t), `topic coverage: ${t}`).toBe(true);
  });
});

// ── Authored days ────────────────────────────────────────────────────────
const mdIds = mdFiles.map(([p]) => slug(p));
const jsonIds = jsonFiles.map(([p]) => slug(p));

describe("authored days", () => {
  it("have both files and a matching curriculum entry", () => {
    const scope = (list: string[]) => list.filter(inScope).sort();
    expect(scope(mdIds)).toEqual(scope(jsonIds));
    for (const id of [...mdIds, ...jsonIds]) expect(ids.has(id), `curriculum entry for ${id}`).toBe(true);
  });
  it.skipIf(!process.env.DAILY_REQUIRE_ALL)("exist for every curriculum day", () => {
    const have = new Set(mdIds.filter((id) => jsonIds.includes(id)));
    expect(order.filter((id) => !have.has(id))).toEqual([]);
  });
});

const days = mdFiles.map(([p, md]) => {
  const id = slug(p);
  const extras = jsonFiles.find(([jp]) => slug(jp) === id)?.[1];
  return { id, md, extras, meta: curriculum.days.find((d) => d.id === id) };
}).filter((d): d is { id: string; md: string; extras: DayExtras; meta: NonNullable<typeof d.meta> } => !!d.extras && !!d.meta && inScope(d.id));

// ── Interpreters ─────────────────────────────────────────────────────────
const repoRoot = resolve(__dirname, "../../..");
const venvPython = join(repoRoot, ".venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;

interface Ran { stdout: string; stderr: string; status: number | null }
function run(cmd: string, args: string[], opts: { input?: string; cwd: string; env?: NodeJS.ProcessEnv; timeout?: number }): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? { ...process.env, MPLBACKEND: "Agg", PYTHONHASHSEED: "0", TZ: "UTC", LC_ALL: "C.UTF-8" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeout ?? 60_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => { clearTimeout(timer); done({ stdout, stderr, status }); });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input ?? "");
  });
}
async function inSandbox<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "daily-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const runPy = (code: string, stdin = "") => inSandbox((cwd) => run(PYTHON, ["-I", "-c", code], { input: stdin, cwd }));
const runBash = (code: string) => inSandbox((cwd) => run("bash", ["-e", "-c", code], {
  cwd, env: {
    PATH: `${join(repoRoot, ".venv-daily/bin")}:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin`, HOME: cwd, TZ: "UTC", LC_ALL: "C",
    GIT_CONFIG_GLOBAL: join(cwd, ".gitconfig-none"), GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com",
    GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  },
}));

/** Top-level modules a Python source imports, via the interpreter's own parser. "syntax" when the source does not parse. */
const IMPORTS = "import ast,sys,json\ntry:\n  t=ast.parse(sys.stdin.read())\nexcept SyntaxError as e:\n  print('SYNTAX '+str(e)); raise SystemExit\nm=set()\nfor n in ast.walk(t):\n  if isinstance(n,ast.Import): m.update(a.name for a in n.names)\n  elif isinstance(n,ast.ImportFrom) and n.module and n.level==0: m.add(n.module)\nprint(json.dumps(sorted(m)))";
async function pythonImports(code: string): Promise<string[] | "syntax"> {
  const r = await inSandbox((cwd) => run(PYTHON, ["-I", "-c", IMPORTS], { input: code, cwd }));
  return r.stdout.startsWith("SYNTAX") ? "syntax" : (JSON.parse(r.stdout || "[]") as string[]);
}
/** What the in-browser Python (Pyodide) can import. Everything else must be marked `python local`. */
const BROWSER_THIRD_PARTY = new Set(["numpy", "pandas", "scipy", "statsmodels"]);
const BROWSER_BLOCKED = new Set(["socket", "ssl", "http", "urllib", "subprocess", "multiprocessing", "threading", "asyncio", "js", "pyodide", "micropip", "tkinter", "readline"]);
let stdlibCache: Set<string> | undefined;
async function stdlibNames(): Promise<Set<string>> {
  if (!stdlibCache) {
    const r = await inSandbox((cwd) => run(PYTHON, ["-I", "-c", "import sys,json;print(json.dumps(sorted(sys.stdlib_module_names)))"], { cwd }));
    stdlibCache = new Set(JSON.parse(r.stdout) as string[]);
  }
  return stdlibCache;
}
async function browserImportProblems(code: string): Promise<string[]> {
  const mods = await pythonImports(code);
  if (mods === "syntax") return ["does not parse"];
  const stdlib = await stdlibNames();
  return mods.map((m) => m.split(".")[0]).filter((m) => BROWSER_BLOCKED.has(m) || (!stdlib.has(m) && !BROWSER_THIRD_PARTY.has(m))).map((m) => `imports ${m}, which the browser runner cannot use`);
}

let db: SqlDb;
beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(northwind);
  db = pg as unknown as SqlDb;
}, 60_000);
/** PGlite is one connection: concurrent tests must take turns, or their transactions interleave. */
let sqlTail: Promise<unknown> = Promise.resolve();
const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = sqlTail.then(fn, fn);
  sqlTail = next.catch(() => undefined);
  return next;
};
const sqlText = (sql: string) => exclusive(async () => {
  const r = await execute(db, sql);
  if (!r.success) throw new Error(`${r.message}\n${sql}`);
  return renderResultText(r.columns, r.rows);
});

it.skipIf(hasPython)("has Python available", () => { throw new Error(`No Python interpreter at ${PYTHON}. Create .venv-daily (see content/daily/requirements.txt).`); });

// ── Structure and sequencing ─────────────────────────────────────────────
const STOP = new Set(["and", "the", "with", "for", "from", "into", "basics", "using", "your", "that", "how", "its"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const seenParagraphs = new Map<string, string>();

for (const { id, md, extras, meta } of days) {
  describe(`${id} ${meta.title}`, () => {
    const content: DayContent = parseDay(md, extras);

    it("has the required sections in order, with substance", () => {
      expect(Object.keys(splitSections(md))).toEqual([...REQUIRED_SECTIONS]);
      const minWords = meta.kind === "lesson" ? 450 : 250;
      expect(content.sections["Understand"].split(/\s+/).length, "Understand words").toBeGreaterThan(minWords);
      expect(content.sections["Objectives"].split("\n").filter((l) => l.startsWith("- ")).length, "objectives").toBeGreaterThanOrEqual(3);
      expect(content.sections["Real-world applications"].length).toBeGreaterThan(200);
      expect(content.sections["Revision task"].length).toBeGreaterThan(80);
      for (const h of ["### Key takeaways", "### Common mistakes", "### Revision notes"]) expect(content.sections["Daily review"], h).toContain(h);
      expect(content.examples.filter((b) => b.kind === "example").length, "examples").toBeGreaterThanOrEqual(3);
    });
    it("has a time budget that matches the plan", () => {
      const t = extras.time;
      const total = t.theory + t.examples + t.guided + t.independent + t.review;
      expect(Math.abs(total - meta.minutes), `sum ${total} vs ${meta.minutes}`).toBeLessThanOrEqual(10);
      expect(Object.values(t).every((n) => n > 0)).toBe(true);
    });
    it("has valid exercises and checks", () => {
      expect(extras.id).toBe(id);
      expect(extras.guided.length).toBeGreaterThanOrEqual(3);
      expect(extras.independent.length).toBeGreaterThanOrEqual(2);
      const all = [...extras.guided, ...extras.independent];
      expect(new Set(all.map((e) => e.id)).size, "exercise ids unique").toBe(all.length);
      for (const e of extras.guided) expect(e.hints?.length, `${e.id} hints`).toBe(3);
      for (const e of extras.independent) expect(e.hints, `${e.id} hints`).toBeUndefined();
      for (const e of all) {
        expect(["python", "sql", "written"], `${e.id} kind`).toContain(e.kind);
        expect(e.prompt.length, `${e.id} prompt`).toBeGreaterThan(60);
        expect(e.solution.trim().length, `${e.id} solution`).toBeGreaterThan(0);
        if (e.kind === "python") expect(e.expected, `${e.id} expected`).toBeTruthy();
        if (e.kind === "written") {
          expect(e.rubric?.length ?? 0, `${e.id} rubric`).toBeGreaterThanOrEqual(2);
          expect(e.solution.length, `${e.id} model answer`).toBeGreaterThan(80);
        } else expect(e.starter.trim().length, `${e.id} starter`).toBeGreaterThan(0);
      }
      const graded = all.filter((e) => e.kind !== "written").length;
      expect(graded, "auto-graded exercises").toBeGreaterThanOrEqual(extras.environment ? 1 : 2);
      expect(all.filter((e) => e.required !== false).length, "at least one required exercise").toBeGreaterThan(0);
      expect(extras.checks.length).toBeGreaterThanOrEqual(4);
      expect(extras.checks.length).toBeLessThanOrEqual(6);
      for (const c of extras.checks) {
        expect(c.options.length, c.id).toBeGreaterThanOrEqual(3);
        expect(c.answer, c.id).toBeGreaterThanOrEqual(0);
        expect(c.answer, c.id).toBeLessThan(c.options.length);
        expect(new Set(c.options).size, `${c.id} options distinct`).toBe(c.options.length);
        expect(c.explanation.length, c.id).toBeGreaterThan(40);
      }
      expect(extras.links ? checkLinks(id, extras.links) : []).toEqual([]);
      expect(extras.links && Object.values(extras.links).flat().length, "links").toBeGreaterThan(0);
    });
    it("documents anything that cannot run in the browser", () => {
      const local = content.examples.filter((b) => b.kind === "example" && !b.browser);
      if (local.length) expect(extras.environment, "environment note for python local / bash run examples").toBeDefined();
      if (extras.environment) {
        expect(extras.environment.note.length, "environment note").toBeGreaterThan(40);
        expect(Array.isArray(extras.environment.packages)).toBe(true);
      }
    });
    it("leads into the next day", () => {
      const seq = curriculum.days.filter((d) => d.path === meta.path);
      const i = seq.findIndex((d) => d.id === id);
      const next = seq[i + 1] ?? (meta.path === "common" ? null : null);
      if (!next || meta.day === 90) return;
      const text = content.sections["Next-day preparation"].toLowerCase();
      expect(words(next.title).some((w) => text.includes(w)), `Next-day preparation should mention "${next.title}" (Day ${next.day})`).toBe(true);
    });
    it("does not repeat paragraphs from other days", () => {
      const clash: string[] = [];
      for (const para of content.sections["Understand"].split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 220 && !p.startsWith("```") && !p.startsWith("|"))) {
        const key = para.replace(/\s+/g, " ");
        const prev = seenParagraphs.get(key);
        if (prev && prev !== id) clash.push(`${prev} and ${id}: "${key.slice(0, 60)}…"`);
        seenParagraphs.set(key, id);
      }
      expect(clash).toEqual([]);
    });
    it("has Python fences that at least parse", async () => {
      const bad: string[] = [];
      const fences = [...md.matchAll(/```(python[^\n]*)\n([\s\S]*?)```/g)].filter((m) => !/\b(run|local|nocheck)\b/.test(m[1]) && !/^\s*>>>/.test(m[2]));
      for (const m of fences) {
        const r = await pythonImports(m[2]);
        if (r === "syntax") bad.push(m[2].split("\n")[0].slice(0, 60));
      }
      expect(bad, "python fences that do not parse (tag them `python nocheck` if intentional)").toEqual([]);
    });
  });
}

// ── Execution ────────────────────────────────────────────────────────────
for (const { id, md, extras } of days) {
  const content = parseDay(md, extras);
  describe.concurrent(`${id} execution`, () => {
    for (const ex of content.examples) {
      if (ex.kind !== "example") continue;
      it(`example ${ex.id} (${ex.title}) prints its expected output`, async () => {
        if (ex.lang === "sql") {
          expect(await sqlText(ex.code)).toBe(ex.output.replace(/\s+$/, ""));
        } else if (ex.lang === "bash") {
          const r = await runBash(ex.code);
          expect(r.status, `exit status; stderr: ${r.stderr}`).toBe(0);
          expect(r.stdout.replace(/\s+$/, "")).toBe(ex.output.replace(/\s+$/, ""));
        } else {
          if (ex.browser) expect(await browserImportProblems(ex.code), "browser-safe imports (tag packages the browser lacks `python local`)").toEqual([]);
          const r = await runPy(ex.code, ex.stdin ? `${ex.stdin}\n` : "");
          expect(r.stderr, "stderr").toBe("");
          expect(r.stdout.replace(/\s+$/, "")).toBe(ex.output.replace(/\s+$/, ""));
        }
      }, 90_000);
    }
    const exercises: { which: string; e: Exercise }[] = [
      ...extras.guided.map((e) => ({ which: "guided", e })),
      ...extras.independent.map((e) => ({ which: "independent", e })),
    ];
    for (const { which, e } of exercises) {
      if (e.kind === "written") continue;
      it(`${which} ${e.id} (${e.title}): the solution passes and the starter does not`, async () => {
        if (e.kind === "python") {
          expect(await browserImportProblems(e.solution), "solution imports").toEqual([]);
          const stdin = e.stdin ? `${e.stdin}\n` : "";
          const sol = await runPy(e.solution, stdin);
          expect(sol.stderr, "solution stderr").toBe("");
          expect(sameOutput(sol.stdout, e.expected!), `solution output:\n${sol.stdout}`).toBe(true);
          const st = await runPy(e.starter, stdin);
          expect(st.status === 0 && sameOutput(st.stdout, e.expected!), "starter must not already pass").toBe(false);
        } else {
          await exclusive(async () => {
            const sol = await execute(db, e.solution);
            expect(sol.success, sol.message ?? "").toBe(true);
            expect(sol.rows.length, "solution returns rows").toBeGreaterThan(0);
            const own = await submit(db, e.solution, e.solution, !!e.ordered);
            expect(own.correct, `solution vs itself: ${own.message}`).toBe(true);
            const st = await submit(db, e.starter, e.solution, !!e.ordered);
            expect(st.correct, "starter must not already pass").toBe(false);
          });
        }
      }, 90_000);
    }
  });
}
