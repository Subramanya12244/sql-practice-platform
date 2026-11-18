// @vitest-environment node
// Unified Exercise Workspace, shared core: converters from existing content to ExerciseDef, id parsing, registry, hint rules,
// and the progress port. Pure logic, no DOM. UI behaviour is in siteWorkspaceCoreUi.test.tsx.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Question, SchemaTable } from "../site/types";
import type { DayExtras, Exercise } from "../site/lib/daily";
import { setJsonFetcher } from "../site/lib/data";
import { loadAllExercises } from "../site/lib/pyExercises";
import { pyKey } from "../site/lib/pyPractice";
import { dailyMistakeRef } from "../site/lib/mistakes";
import {
  dailyDayExercises, dailyExerciseToExercise, exerciseProblems, leaksSolution, loadBaseExerciseById, loadEnrichment, loadExerciseById, mergeEnrichment, parseExerciseId, pythonDomainOf,
  pythonExerciseToExercise, sqlQuestionToExercise, distributeHints,
} from "../site/workspace/sources";
import { DOMAIN_FOLDER, hasAdapterSource, normalizeModule, registerAdapter, resetRegistry, resolveAdapter, unregisterAdapter } from "../site/workspace/registry";
import { availableLevels, canOpen, nextLevel, visibleHints } from "../site/workspace/hints";
import { createProgressPort, type ProgressDeps } from "../site/workspace/progressPort";
import { createFakeAdapter } from "../site/workspace/fake/fakeAdapter";
import type { AdapterModule, ExerciseDef } from "../site/workspace/types";

const ROOT = resolve(__dirname, "../..");
const questions = Object.values(import.meta.glob<Question>("../../public/data/q/*.json", { eager: true, import: "default" }));
const dailyFiles = Object.entries(import.meta.glob<DayExtras>("../site/content/daily/days/*.json", { eager: true, import: "default" }));
const schema = JSON.parse(readFileSync(join(ROOT, "public/data/schema.json"), "utf8")) as SchemaTable[];

beforeAll(() => {
  setJsonFetcher(async (path) => JSON.parse(readFileSync(join(ROOT, "public", path), "utf8")));
});

const dailyAll = () => dailyFiles.flatMap(([, d]) => dailyDayExercises(d.id, d));

describe("SQL question source", () => {
  const all = questions.map((q) => sqlQuestionToExercise(q, { schema }));
  it("converts every shipped question to a valid exercise with stable, unique ids", () => {
    expect(all.length).toBeGreaterThan(100);
    const bad = all.flatMap((e) => exerciseProblems(e).map((p) => `${e.id}: ${p}`));
    expect(bad).toEqual([]);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const [i, e] of all.entries()) {
      expect(e.id).toBe(`sql:${questions[i].slug}`);
      expect(e.source).toEqual({ kind: "sql-question", slug: questions[i].slug, number: questions[i].number });
    }
  });
  it("carries the grading inputs the SQL practice page passes to submit", () => {
    const q = questions[0];
    const e = sqlQuestionToExercise(q, { schema });
    expect(e.validation).toEqual({ kind: "sql-result", expectedSql: q.referenceQuery, orderMatters: q.sortRequired, orderBy: q.orderBy ?? null, database: "northwind" });
    expect(e.dataset?.id).toBe("northwind");
    expect(e.dataset?.tables?.[0].columns.length).toBeGreaterThan(0);
  });
  it("is deterministic: converting twice gives the same thing", () => {
    expect(sqlQuestionToExercise(questions[3], { schema })).toEqual(sqlQuestionToExercise(questions[3], { schema }));
  });
  it("never puts the solution in levels 1 to 4; level 3 is a skeleton", () => {
    for (const e of all) {
      for (const h of e.hints) expect(h.body.includes(e.solution!.code.trim()), `${e.id} level ${h.level}`).toBe(false);
    }
    const e = all[0];
    expect(e.hints.find((h) => h.level === 3)?.body).toContain("___");
  });
});

describe("Python exercise source", () => {
  it("converts every practice exercise, with py:<slug> ids that match the progress key", async () => {
    const list = await loadAllExercises();
    expect(list.length).toBeGreaterThan(100);
    const defs = list.map(pythonExerciseToExercise);
    expect(defs.flatMap((e) => exerciseProblems(e).map((p) => `${e.id}: ${p}`))).toEqual([]);
    expect(new Set(defs.map((e) => e.id)).size).toBe(defs.length);
    for (const [i, e] of defs.entries()) expect(e.id).toBe(pyKey(list[i].slug));
  });
  it("keeps visible and hidden tests and the solution separate from the hints", async () => {
    const withHidden = (await loadAllExercises()).find((e) => e.task?.hidden);
    expect(withHidden).toBeTruthy();
    const d = pythonExerciseToExercise(withHidden!);
    expect(d.validation).toMatchObject({ kind: "python-tests", tests: withHidden!.task!.tests, hidden: withHidden!.task!.hidden });
    expect(d.solution?.code).toBe(withHidden!.task!.solution);
    expect(d.starterCode).toBe(withHidden!.task!.starter);
    expect(d.statement).not.toMatch(/^## Hints/m);
  });
});

describe("Daily Learning source", () => {
  it("converts every graded exercise, keeps ids unique across all days, and skips written ones", () => {
    const defs = dailyAll();
    expect(defs.length).toBeGreaterThan(500);
    expect(defs.flatMap((e) => exerciseProblems(e).map((p) => `${e.id}: ${p}`))).toEqual([]);
    expect(new Set(defs.map((e) => e.id)).size).toBe(defs.length);
    const written = dailyFiles.flatMap(([, d]) => [...d.guided, ...d.independent].filter((x) => x.kind === "written").map((x) => dailyExerciseToExercise(d.id, x)));
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((w) => w === null)).toBe(true);
  });
  it("uses the Mistake Notebook ref as id and the existing validation inputs", () => {
    const [, d] = dailyFiles.find(([, x]) => x.guided.some((g) => g.kind === "sql"))!;
    const ex = d.guided.find((g) => g.kind === "sql")!;
    const e = dailyExerciseToExercise(d.id, ex)!;
    expect(e.id).toBe(dailyMistakeRef(d.id, ex.id));
    expect(e.source).toEqual({ kind: "daily", dayId: d.id, exerciseId: ex.id });
    expect(e.validation).toEqual({ kind: "sql-result", expectedSql: ex.solution, orderMatters: !!ex.ordered, orderBy: null, database: "northwind" });
  });
  it("converts the same exercise to the same value whichever path is used", () => {
    const [, d] = dailyFiles[0];
    const a = dailyDayExercises(d.id, d);
    const b = [...d.guided.map((x) => dailyExerciseToExercise(d.id, x, {}, "guided")), ...d.independent.map((x) => dailyExerciseToExercise(d.id, x, {}, "independent"))].filter(Boolean);
    expect(a).toEqual(b);
  });
  it("drops an authored hint that is the whole answer, so level 5 stays on request", () => {
    const leaky: Exercise = { id: "g9", title: "t", kind: "sql", prompt: "p", starter: "SELECT 1;", solution: "SELECT *\nFROM categories\nORDER BY category_id;\n",
      hints: ["Use the shorthand for all columns.", "Sort by the key.", "SELECT * FROM categories ORDER BY category_id; is the whole answer."] };
    const e = dailyExerciseToExercise("d999", leaky)!;
    expect(e.hints.some((h) => /whole answer/.test(h.body))).toBe(false);
    expect(e.hints.map((h) => h.level)).toEqual([2, 4]);
    expect(e.solution?.code).toContain("categories");
    expect(exerciseProblems(e)).toEqual([]);
  });
  it("finds the data domain of a Python exercise from its imports", () => {
    expect(pythonDomainOf("import pandas as pd\nimport numpy as np")).toBe("pandas");
    expect(pythonDomainOf("from numpy import array")).toBe("numpy");
    expect(pythonDomainOf("# pandas is nice\nprint(1)")).toBe("python");
  });
});

describe("hint distribution", () => {
  it("spreads one, two and many hints over levels 2 to 4", () => {
    expect(distributeHints(["a"]).map((h) => h.level)).toEqual([2]);
    expect(distributeHints(["a", "b"]).map((h) => h.level)).toEqual([2, 4]);
    const many = distributeHints(["a", "b", "c", "d"]);
    expect(many.map((h) => h.level)).toEqual([2, 3, 4]);
    expect(many[1].body).toContain("b");
    expect(many[1].body).toContain("c");
  });
  it("detects a leaked solution ignoring case, spacing, backticks and the semicolon", () => {
    expect(leaksSolution("Just `select  *  from t where x = 1;`", "SELECT * FROM t WHERE x = 1")).toBe(true);
    expect(leaksSolution("Use a WHERE clause.", "SELECT * FROM t WHERE x = 1")).toBe(false);
    expect(leaksSolution("anything", "x")).toBe(false);
  });
});

describe("id parsing and loading by id", () => {
  it("parses the three id shapes and rejects the rest", () => {
    expect(parseExerciseId("sql:q01-product-revenue")).toEqual({ kind: "sql", slug: "q01-product-revenue" });
    expect(parseExerciseId("py:cart-line-total")).toEqual({ kind: "py", slug: "cart-line-total" });
    expect(parseExerciseId("daily:d031#g2")).toEqual({ kind: "daily", dayId: "d031", exerciseId: "g2" });
    for (const bad of ["", "sql:", "py:../x", "daily:d031", "daily:#g1", "x:y", "sql:a b"]) expect(parseExerciseId(bad)).toBeNull();
  });
  it("loads each kind by id and returns the same def as the converter", async () => {
    const q = questions[0];
    // loadExerciseById = converter + optional enrichment. The base loader is the converter alone; enrichment never touches grading data.
    const enrichment = await loadEnrichment();
    const sqlBase = sqlQuestionToExercise(q, { schema });
    expect(await loadBaseExerciseById(`sql:${q.slug}`)).toEqual(sqlBase);
    expect(await loadExerciseById(`sql:${q.slug}`)).toEqual(mergeEnrichment(sqlBase, enrichment.get(sqlBase.id)));
    const py = (await loadAllExercises())[0];
    const pyBase = pythonExerciseToExercise(py);
    expect(await loadBaseExerciseById(`py:${py.slug}`)).toEqual(pyBase);
    expect(await loadExerciseById(`py:${py.slug}`)).toEqual(mergeEnrichment(pyBase, enrichment.get(pyBase.id)));
    const [, d] = dailyFiles.find(([, x]) => x.guided.some((g) => g.kind !== "written"))!;
    const g = d.guided.find((x) => x.kind !== "written")!;
    const viaLoader = await loadExerciseById(`daily:${d.id}#${g.id}`);
    expect(viaLoader?.id).toBe(`daily:${d.id}#${g.id}`);
    expect(viaLoader?.validation).toEqual(dailyExerciseToExercise(d.id, g, {}, "guided")?.validation);
  });
  it("resolves to null for unknown or malformed ids", async () => {
    expect(await loadExerciseById("sql:does-not-exist")).toBeNull();
    expect(await loadExerciseById("py:does-not-exist")).toBeNull();
    expect(await loadExerciseById("daily:d031#nope")).toBeNull();
    expect(await loadExerciseById("garbage")).toBeNull();
  });
  it("exerciseProblems reports a broken definition", () => {
    const e = { ...sqlQuestionToExercise(questions[0]), id: "sql:other", validation: { kind: "sql-result", expectedSql: " " } } as ExerciseDef;
    const p = exerciseProblems(e);
    expect(p).toEqual(expect.arrayContaining(["id does not match source", "sql-result validation has no expected query"]));
    expect(exerciseProblems({ ...sqlQuestionToExercise(questions[0]), hints: [{ level: 5, title: "x", body: "y" }] })).toContain("hint level 5 is not 1 to 4 (level 5 is the solution)");
  });
});

describe("adapter registry", () => {
  beforeEach(() => resetRegistry());
  it("maps pandas and numpy to the one data module but keeps them separate domains", async () => {
    expect(DOMAIN_FOLDER).toEqual({ sql: "sql", python: "python", pandas: "data", numpy: "data" });
    const pandas = createFakeAdapter({ domain: "pandas" }), numpy = createFakeAdapter({ domain: "numpy" });
    const getAdapter = vi.fn((d: string) => (d === "pandas" ? pandas : numpy));
    const mod: AdapterModule = { getAdapter };
    registerAdapter("pandas", async () => mod);
    registerAdapter("numpy", async () => mod);
    const [p, n] = await Promise.all([resolveAdapter("pandas"), resolveAdapter("numpy")]);
    expect(p.status === "ready" && p.adapter).toBe(pandas);
    expect(n.status === "ready" && n.adapter).toBe(numpy);
    expect(getAdapter).toHaveBeenCalledWith("pandas");
    expect(getAdapter).toHaveBeenCalledWith("numpy");
  });
  it("accepts the documented module shapes", () => {
    const a = createFakeAdapter();
    const V = () => null;
    expect(normalizeModule({ adapterModule: { getAdapter: () => a, Visualizer: V } }, "sql")).toEqual({ adapter: a, Visualizer: V });
    expect(normalizeModule({ getAdapter: () => a, Visualizer: V }, "sql")).toEqual({ adapter: a, Visualizer: V });
    expect(normalizeModule({ adapter: a, Visualizer: V }, "python")?.adapter).toBe(a);
    expect(normalizeModule({ default: a }, "python")?.adapter).toBe(a);
    expect(normalizeModule(a, "python")?.adapter).toBe(a);
    expect(normalizeModule({ nothing: 1 }, "sql")).toBeNull();
    expect(normalizeModule(null, "sql")).toBeNull();
  });
  it("returns an honest missing state for a module with no adapter, or one that fails to load", async () => {
    registerAdapter("sql", async () => ({}));
    const r = await resolveAdapter("sql");
    expect(r).toMatchObject({ status: "missing" });
    expect(r.status === "missing" && r.reason).toMatch(/SQL engine did not provide an adapter/);
    registerAdapter("python", async () => { throw new Error("chunk failed"); });
    const f = await resolveAdapter("python");
    expect(f.status === "missing" && f.reason).toMatch(/Python engine could not be loaded: chunk failed/);
  });
  it("finds each domain adapter that exists on disk under adapters/<folder>/index.ts, by the documented convention", async () => {
    for (const d of ["sql", "python", "pandas", "numpy"] as const) {
      if (!hasAdapterSource(d)) continue; // not delivered yet: the workspace shows its "not available" state
      const r = await resolveAdapter(d);
      expect(r, d).toMatchObject({ status: "ready" });
      if (r.status === "ready") { expect(r.adapter.domain, d).toBe(d); expect(r.adapter.capabilities.has("run"), d).toBe(true); }
    }
  });
  it("lets a manual registration replace and remove an earlier one", async () => {
    const a = createFakeAdapter(), b = createFakeAdapter();
    registerAdapter("sql", a);
    expect((await resolveAdapter("sql")).status === "ready" && (await resolveAdapter("sql") as { adapter: unknown }).adapter).toBe(a);
    registerAdapter("sql", b);
    expect((await resolveAdapter("sql") as { adapter: unknown }).adapter).toBe(b);
    unregisterAdapter("sql");
  });
});

describe("help ladder rules", () => {
  const ex = { hints: [{ level: 1 as const, title: "c", body: "one" }, { level: 3 as const, title: "p", body: "three" }, { level: 4 as const, title: "d", body: "SECRET-4" }], solution: { code: "SOLUTION", explanation: "" } };
  it("offers only the next available level, skipping levels with no content", () => {
    expect(availableLevels(ex)).toEqual([1, 3, 4, 5]);
    expect(nextLevel(ex, 0)).toBe(1);
    expect(nextLevel(ex, 1)).toBe(3);
    expect(nextLevel(ex, 4)).toBe(5);
    expect(nextLevel(ex, 5)).toBeNull();
  });
  it("refuses to skip ahead, so the solution cannot be opened first", () => {
    expect(canOpen(ex, 0, 5)).toBe(false);
    expect(canOpen(ex, 0, 3)).toBe(false);
    expect(canOpen(ex, 0, 1)).toBe(true);
    expect(canOpen(ex, 4, 5)).toBe(true);
  });
  it("lists only opened levels 1 to 4 and never the solution", () => {
    expect(visibleHints(ex, 0)).toEqual([]);
    expect(visibleHints(ex, 1).map((h) => h.level)).toEqual([1]);
    expect(visibleHints(ex, 5).map((h) => h.body)).not.toContain("SOLUTION");
  });
  it("has no solution level when the exercise has no solution", () => {
    expect(availableLevels({ hints: [], solution: undefined })).toEqual([]);
  });
});

describe("progress port", () => {
  const deps = () => {
    const d = Object.fromEntries(["completeExercise", "markRevealed", "recordAttempt", "recordHint", "recordMistake", "recordSession", "updateDay", "recordPyAttempt", "noteAttempt", "noteExecution", "noteHint"].map((k) => [k, vi.fn()])) as unknown as { [K in keyof ProgressDeps]: ReturnType<typeof vi.fn> };
    return d;
  };
  const sql = sqlQuestionToExercise(questions[0]);
  const py = pythonExerciseToExercise({ slug: "cart", title: "Cart", difficulty: "Easy", description: "", topic: "t", minutes: 5, code: "PY-1", concepts: [], category: "fundamentals", skill: "", time: "", space: "", body: "## Problem\nx", task: { id: "cart", title: "Cart", type: "python", instructions: "", starter: "def f(): pass", solution: "def f(): return 1", tests: "assert f()==1" } });
  const daily = dailyExerciseToExercise("d031", { id: "g1", title: "t", kind: "sql", prompt: "p", starter: "s", solution: "SELECT * FROM categories ORDER BY 1;" }, { topics: ["select"], phase: "p1" })!;

  it("SQL: a pass goes to recordAttempt with the question number and code; a failure also files a mistake; nothing else", () => {
    const d = deps();
    const port = createProgressPort(d as unknown as ProgressDeps);
    port.recordAttempt(sql, true, undefined, "SELECT 1");
    expect(d.recordAttempt).toHaveBeenCalledWith(sql.source.kind === "sql-question" && sql.source.number, "SELECT 1", true, undefined);
    expect(d.recordMistake).not.toHaveBeenCalled();
    port.recordAttempt(sql, false, 'column "x" does not exist', "SELECT x");
    expect(d.recordMistake).toHaveBeenCalledWith(expect.objectContaining({ ref: `sql:${sql.source.kind === "sql-question" && sql.source.number}`, kind: "sql", graded: true }));
    expect(d.recordPyAttempt).not.toHaveBeenCalled();
    expect(d.updateDay).not.toHaveBeenCalled();
  });
  it("SQL: hints go to recordHint, the reveal to markRevealed", () => {
    const d = deps();
    const port = createProgressPort(d as unknown as ProgressDeps);
    port.recordHint(sql, 2);
    port.recordReveal(sql);
    expect(d.recordHint).toHaveBeenCalledWith(sql.source.kind === "sql-question" && sql.source.number, 2);
    expect(d.markRevealed).toHaveBeenCalledTimes(1);
  });
  it("Python: pass goes to recordPyAttempt and completeExercise; failure to recordMistake with a classified category", () => {
    const d = deps();
    const port = createProgressPort(d as unknown as ProgressDeps);
    port.recordAttempt(py, true, undefined, "code");
    expect(d.recordPyAttempt).toHaveBeenCalledWith("cart", true);
    expect(d.completeExercise).toHaveBeenCalledWith("py:cart");
    port.recordAttempt(py, false, "KeyError: 'a'", "code");
    expect(d.recordPyAttempt).toHaveBeenLastCalledWith("cart", false);
    expect(d.recordMistake).toHaveBeenCalledWith({ ref: "py:cart", kind: "python", topic: "fundamentals", category: "dicts", graded: true });
    port.recordHint(py, 3);
    expect(d.noteHint).toHaveBeenCalledWith("py:cart", 3);
    expect(d.recordHint).not.toHaveBeenCalled();
  });
  it("Daily: a pass updates the day record and completes `daily:<day>#<id>`; a failure files a mistake under the same ref", () => {
    const d = deps();
    const port = createProgressPort(d as unknown as ProgressDeps);
    port.recordAttempt(daily, true, undefined, "SELECT 1");
    expect(d.completeExercise).toHaveBeenCalledWith("daily:d031#g1");
    const [id, fn, counts] = d.updateDay.mock.calls[0];
    expect(id).toBe("d031");
    expect(counts).toBe(true);
    expect(fn({})).toMatchObject({ attempted: ["g1"], passed: ["g1"] });
    port.recordAttempt(daily, false, "syntax error at or near", "SELEC");
    expect(d.recordMistake).toHaveBeenCalledWith(expect.objectContaining({ ref: "daily:d031#g1", graded: true }));
  });
  it("a run records at most a not-graded mistake; it never completes or attempts anything", () => {
    const d = deps();
    const port = createProgressPort(d as unknown as ProgressDeps);
    port.recordRun!(sql, true);
    port.recordRun!(py, false, "NameError: x");
    expect(d.recordMistake).toHaveBeenCalledWith(expect.objectContaining({ ref: "py:cart", graded: false }));
    for (const k of ["completeExercise", "recordAttempt", "recordPyAttempt", "updateDay", "markRevealed"] as const) expect(d[k]).not.toHaveBeenCalled();
  });
  it("authored exercises have no store and touch none", () => {
    const d = deps();
    const port = createProgressPort(d as unknown as ProgressDeps);
    const authored: ExerciseDef = { ...py, id: "py:demo", source: { kind: "authored", id: "demo" } };
    port.recordAttempt(authored, true, undefined, "x");
    port.recordHint(authored, 2);
    port.recordReveal(authored);
    port.recordRun!(authored, false, "boom");
    for (const f of Object.values(d)) expect(f).not.toHaveBeenCalled();
  });
});

describe("workspace code owns no progress store", () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return /^(adapters|visualizers)$/.test(e.name) ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
  const src = files(resolve(ROOT, "src/site/workspace"));
  it("progressPort imports only the existing stores", () => {
    const text = readFileSync(resolve(ROOT, "src/site/workspace/progressPort.ts"), "utf8");
    const specs = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
    // "./dailyPort" is the Daily lesson's own port over the same existing stores (lib/dailyExercise); the default port delegates Daily exercises to it.
    expect(specs).toEqual(["../lib/dailyProgress", "../lib/errorHelp", "../lib/mistakes", "../lib/progress", "../lib/pyPractice", "../lib/solveSessions", "./dailyPort", "./types"]);
  });
  it("no workspace file writes browser storage or defines a store of its own", () => {
    const offenders = src.filter((f) => /localStorage|sessionStorage|indexedDB|setProgressSink|createStore\(/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(ROOT, ""))).toEqual([]);
  });
});
