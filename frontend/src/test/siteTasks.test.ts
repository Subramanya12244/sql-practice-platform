// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { extractTasks, interpretCheck, runPythonTask, runSqlTask, type SqlTask } from "../site/lib/tasks";

describe("task engine", () => {
  it("extracts task blocks and leaves placeholders", () => {
    const { tasks, rest, errors } = extractTasks('Intro\n```task\n{"id":"a","title":"A","type":"checklist","instructions":"x","items":["one"]}\n```\nAfter\n```task\n{bad json}\n```');
    expect(tasks.map((t) => t.id)).toEqual(["a"]);
    expect(errors.length).toBe(1);
    expect(rest).toContain("<!--task:a-->");
  });

  it("runs learner SQL and the check in one transaction (and nothing persists)", async () => {
    const pg = new PGlite();
    await pg.exec(northwind);
    const db = pg as unknown as SqlDb;
    const task: SqlTask = {
      id: "t", title: "t", type: "sql", instructions: "", starter: "", solution: "",
      check: "SELECT (COUNT(*) = 8) AS ok, 'staging_categories should have 8 rows' AS message FROM staging_categories",
    };
    const run = (sql: string) => execute(db, sql);
    expect((await runSqlTask(task, "CREATE TABLE staging_categories AS SELECT * FROM categories", run)).ok).toBe(true);
    const wrong = await runSqlTask(task, "CREATE TABLE staging_categories AS SELECT * FROM categories LIMIT 3", run);
    expect(wrong).toMatchObject({ ok: false, message: "staging_categories should have 8 rows" });
    expect((await execute(db, "SELECT to_regclass('staging_categories') IS NULL AS gone")).rows[0][0]).toBe(true);
    expect(interpretCheck({ success: true, columns: ["x"], rows: [[1]] }).ok).toBe(false);
  }, 60_000);

  it("maps python runner outcomes to clear messages", async () => {
    const task = { id: "p", title: "p", type: "python" as const, instructions: "", starter: "", solution: "", tests: "assert f() == 1" };
    const fake = (r: object) => async () => ({ ok: false, stdout: "", ms: 1, ...r });
    expect((await runPythonTask(task, "x", fake({ phase: "tests", error: "Traceback\nAssertionError: expected 1" }))).message).toBe("A test failed: expected 1");
    expect((await runPythonTask(task, "x", fake({ phase: "code", error: "NameError: name 'y' is not defined" }))).message).toMatch(/NameError/);
    expect((await runPythonTask(task, "x", fake({ phase: "timeout", error: "Stopped after 10s" }))).message).toMatch(/Stopped/);
    expect((await runPythonTask(task, "x", async () => ({ ok: true, stdout: "hi", ms: 1 }))).ok).toBe(true);
  });
});

import { isRepoUrl, projectStatus, type ProjectProgress } from "../site/lib/projects";
describe("project status", () => {
  const sql = { id: "a", title: "", type: "sql" as const, instructions: "", starter: "", solution: "", check: "" };
  const py = { id: "b", title: "", type: "python" as const, instructions: "", starter: "", solution: "", tests: "" };
  const manual = { id: "c", title: "", type: "checklist" as const, instructions: "", items: ["x"] };
  const P = (tasks: object = {}, extra: object = {}) => ({ tasks, checklist: {}, ...extra }) as unknown as ProjectProgress;
  it("is earned from task evidence, never from opening or submitting alone", () => {
    expect(projectStatus({ tasks: [sql, py] }, P())).toBe("Not started");
    expect(projectStatus({ tasks: [sql, py] }, P({ a: { passed: false, at: "" } }))).toBe("In progress");
    expect(projectStatus({ tasks: [sql, py] }, P({ a: { passed: true, at: "" } }, { submission: { at: "" } }))).toBe("Submitted");
    expect(projectStatus({ tasks: [sql, py] }, P({ a: { passed: true, at: "" }, b: { passed: true, at: "" } }))).toBe("Completed");
    expect(projectStatus({ tasks: [sql, manual] }, P({ a: { passed: true, at: "" } }))).toBe("In progress");
    expect(projectStatus({ tasks: [sql, manual] }, P({ a: { passed: true, at: "" } }, { submission: { at: "" } }))).toBe("Under evaluation");
    expect(projectStatus({ tasks: [manual] }, P({}, { checklist: { c: [true] }, submission: { at: "" } }))).toBe("Submitted");
  });
  it("accepts only https repository links on known hosts", () => {
    expect(isRepoUrl("https://github.com/user/repo")).toBe(true);
    expect(isRepoUrl("http://github.com/user/repo")).toBe(false);
    expect(isRepoUrl("https://github.com/user")).toBe(false);
    expect(isRepoUrl("https://evil.example/user/repo")).toBe(false);
  });
});

import { parseProject } from "../site/lib/projects";
import { parseExercise } from "../site/lib/pyExercises";
import registry from "../site/content/tracks.json";
const projectFiles = Object.entries(import.meta.glob<string>("../site/content/projects/*.md", { eager: true, query: "?raw", import: "default" }));
const exerciseFiles = Object.entries(import.meta.glob<string>("../site/content/python/*.md", { eager: true, query: "?raw", import: "default" }));
const dsFiles = import.meta.glob<string>("../../public/data/datasets/*.sql", { eager: true, query: "?raw", import: "default" });

describe("projects lab content", () => {
  const projects = projectFiles.map(([p, r]) => parseProject(r, p.split("/").pop()!.replace(/\.md$/, "")));
  it("every task block parses (none silently dropped)", () => {
    const bad = projectFiles.flatMap(([p, r]) => extractTasks(r).errors.map((e) => `${p}: ${e}`));
    expect(bad).toEqual([]);
    for (const [p, r] of projectFiles) expect(extractTasks(r).tasks.length, p).toBe((r.match(/```task\n/g) ?? []).length);
  });
  it("has every registered project, with valid tasks", () => {
    expect(projects.map((p) => p.slug).sort()).toEqual(registry.projects.map((p) => p.slug).sort());
    for (const p of projects) {
      expect(p.tasks.length, p.slug).toBeGreaterThan(2);
      expect(p.tasks.some((t) => t.type !== "checklist"), p.slug).toBe(true);
      for (const t of p.tasks) expect(p.body.includes(`<!--task:${t.id}-->`), `${p.slug}/${t.id}`).toBe(true);
    }
  });
  it("every SQL task: solution passes and starter fails on the project's dataset", async () => {
    const dbs = new Map<string, SqlDb>();
    const db = async (id: string) => {
      if (!dbs.has(id)) {
        const pg = new PGlite();
        await pg.exec(id === "northwind" ? northwind : Object.entries(dsFiles).find(([p]) => p.endsWith(`/${id}.sql`))![1]);
        dbs.set(id, pg as unknown as SqlDb);
      }
      return dbs.get(id)!;
    };
    const bad: string[] = [];
    let n = 0;
    for (const p of projects) {
      const d = await db(p.dataset);
      for (const t of p.tasks) {
        if (t.type !== "sql") continue;
        n++;
        const run = (sql: string) => execute(d, sql);
        const good = await runSqlTask(t, t.solution, run);
        if (!good.ok) bad.push(`${p.slug}/${t.id}: solution fails — ${good.message}`);
        const start = await runSqlTask(t, t.starter || "SELECT 1", run);
        if (start.ok) bad.push(`${p.slug}/${t.id}: starter passes`);
      }
    }
    expect(n).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  }, 300_000);
});

describe("python exercises content", () => {
  it("each has one python task with starter, solution and tests, and a real topic", () => {
    const topics = new Set(registry.tracks.find((t) => t.id === "python")!.topics.map((t) => t.slug));
    const ex = exerciseFiles.map(([p, r]) => parseExercise(r, p.split("/").pop()!.replace(/\.md$/, "")));
    expect(ex.length).toBe(150);
    for (const e of ex) {
      expect(e.task, e.slug).not.toBeNull();
      expect(e.task!.tests.includes("assert"), e.slug).toBe(true);
      expect(topics.has(e.topic), `${e.slug} topic ${e.topic}`).toBe(true);
    }
  });
});

import { PY_CATEGORIES, PY_SKILLS } from "../site/lib/pyPractice";
describe("python practice library", () => {
  it("has exactly 150 complete problems: 50 Easy, 60 Medium, 40 Hard, unique ids", async () => {
    const { parseExercise } = await import("../site/lib/pyExercises");
    const files = Object.entries(import.meta.glob<string>("../site/content/python/*.md", { eager: true, query: "?raw", import: "default" }));
    const all = files.map(([p, raw]) => ({ raw, ex: parseExercise(raw, p.split("/").pop()!.replace(/\.md$/, "")) }));
    expect(all.length).toBe(150);
    const count = (d: string) => all.filter((x) => x.ex.difficulty === d).length;
    expect([count("Easy"), count("Medium"), count("Hard")]).toEqual([50, 60, 40]);
    const ids = all.map((x) => x.ex.code);
    expect(new Set(ids).size).toBe(150);
    expect([...ids].sort()).toEqual(Array.from({ length: 150 }, (_, i) => `PY-${String(i + 1).padStart(3, "0")}`));
    const bad: string[] = [];
    for (const { raw, ex } of all) {
      for (const h of ["## Scenario", "## Problem", "## Objective", "## Input format", "## Output format", "## Constraints", "## Examples", "## Hints", "## Why it matters"]) if (!raw.includes(h)) bad.push(`${ex.slug}: no ${h}`);
      if (!PY_CATEGORIES.some((c) => c.slug === ex.category)) bad.push(`${ex.slug}: category ${ex.category}`);
      if (!PY_SKILLS[ex.skill]) bad.push(`${ex.slug}: skill ${ex.skill}`);
      if (!ex.time || !ex.space) bad.push(`${ex.slug}: no complexity`);
      if (!ex.task?.hidden?.trim()) bad.push(`${ex.slug}: no hidden tests`);
      if (/^(\s*)(def|class) [^\n]*:\n\1(?!\s)\S/m.test(ex.task?.starter ?? "")) bad.push(`${ex.slug}: starter body is not indented`);
      if (!ex.task?.explanation?.trim()) bad.push(`${ex.slug}: no explanation`);
      if (!ex.concepts.length) bad.push(`${ex.slug}: no concepts`);
    }
    expect(bad).toEqual([]);
    // Every category is represented, and no two problems share a title or statement.
    for (const c of PY_CATEGORIES) expect(all.filter((x) => x.ex.category === c.slug).length, c.slug).toBeGreaterThanOrEqual(15);
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    expect(new Set(all.map((x) => norm(x.ex.title))).size).toBe(150);
    expect(new Set(all.map((x) => norm(x.ex.task!.instructions))).size).toBe(150);
  });
});

describe("project design decisions", () => {
  it("every project has well-formed decisions", async () => {
    const { parseProject } = await import("../site/lib/projects");
    const files = Object.entries(import.meta.glob<string>("../site/content/projects/*.md", { eager: true, query: "?raw", import: "default" }));
    for (const [p, raw] of files) {
      const proj = parseProject(raw, p.split("/").pop()!.replace(/\.md$/, ""));
      const ds = proj.tasks.filter((t) => t.type === "decision");
      expect(ds.length, proj.slug).toBeGreaterThanOrEqual(2);
      for (const d of ds) {
        if (d.type !== "decision") continue;
        expect(d.options.length, d.id).toBeGreaterThanOrEqual(3);
        expect(d.answer).toBeGreaterThanOrEqual(0);
        expect(d.answer).toBeLessThan(d.options.length);
        expect(d.why).toHaveLength(d.options.length);
      }
      expect(new Set(proj.tasks.map((t) => t.id)).size, `${proj.slug} task ids`).toBe(proj.tasks.length);
    }
  });
});
