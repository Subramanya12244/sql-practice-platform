// @vitest-environment node
// "Genuinely supports it": every Daily exercise the lesson embeds must be gradeable by the workspace adapter it will use. The lesson's own
// reference answer is run and checked through the adapters (the same `run` and `validate` the embedded workspace calls), against a real
// PostgreSQL (PGlite, every SQL exercise) and real CPython (Python, pandas and NumPy: a sample by default, all with DAILY_ADAPTER_FULL=1).
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import type { DayExtras, Exercise } from "../site/lib/daily";
import type { SqlDb } from "../site/lib/sqlRunner";
import { createDbBackend } from "../site/workspace/adapters/sql/backend";
import { createSqlAdapter } from "../site/workspace/adapters/sql/adapter";
import { createPythonAdapter } from "../site/workspace/adapters/python/adapter";
import { createDataAdapter } from "../site/workspace/adapters/data/adapter";
import { dailyEmbedDecision, sqlWorkspaceRunnable } from "../site/workspace/dailyPort";
import type { ExecutionAdapter, ExerciseDef } from "../site/workspace/types";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PYTHON, hasDataPython } from "./siteWorkspaceDataPy";
import type { PyResult } from "../site/lib/pyRunner";

/** Real CPython behind the signature of lib/pyRunner `runPython`, feeding `stdin` to the program (the shared helper does not). */
function cpythonRun(code: string, _tests?: string, _timeoutMs?: number, stdin = "", _files?: Record<string, string>): Promise<PyResult> {
  const dir = mkdtempSync(path.join(tmpdir(), "daily-adapter-"));
  const file = path.join(dir, "main.py");
  writeFileSync(file, code);
  const t0 = Date.now();
  const r = spawnSync(PYTHON ?? "python3", ["-I", file], { input: stdin, encoding: "utf8", cwd: dir, timeout: 90_000, maxBuffer: 64 * 1024 * 1024 });
  rmSync(dir, { recursive: true, force: true });
  const ms = Date.now() - t0;
  if (r.status === 0) return Promise.resolve({ ok: true, stdout: r.stdout, ms });
  return Promise.resolve({ ok: false, stdout: r.stdout, error: r.stderr.trim().split("\n").slice(-6).join("\n"), phase: "code", ms });
}

const dayFiles = import.meta.glob("../site/content/daily/days/*.json", { eager: true, import: "default" }) as Record<string, DayExtras>;
const loadDays = () => Object.entries(dayFiles).map(([p, extras]) => ({ id: p.split("/").pop()!.replace(".json", ""), extras }));
type Item = { day: string; ex: Exercise; def: ExerciseDef };
const all: Item[] = [];
for (const d of loadDays()) {
  for (const sec of ["guided", "independent"] as const) {
    for (const ex of d.extras[sec]) {
      const r = dailyEmbedDecision(d.id, ex, sec);
      if (r.embed && r.def) all.push({ day: d.id, ex, def: r.def });
    }
  }
}
const full = process.env.DAILY_ADAPTER_FULL === "1";
const every = (list: Item[], n: number) => (full ? list : list.filter((_, i) => i % n === 0));
const grade = async (adapter: ExecutionAdapter, def: ExerciseDef, code: string) => {
  const ctx = { exercise: def };
  const out = await adapter.run(code, ctx);
  return { out, v: await adapter.validate!(code, out, ctx) };
};

describe("SQL: every embedded Daily SQL exercise's reference answer passes the workspace adapter", () => {
  let adapter: ExecutionAdapter;
  beforeAll(async () => {
    const pg = new PGlite();
    await pg.exec(northwind);
    adapter = createSqlAdapter({ backend: createDbBackend(pg as unknown as SqlDb) });
  }, 90_000);
  const sql = all.filter((i) => i.def.domain === "sql");
  it("covers the SQL exercises the lessons embed", () => { expect(sql.length).toBeGreaterThan(300); });
  it("no dead end: wherever the lesson's gate lets the workspace open, run + validate pass the reference answer (setup scripts included)", async () => {
    const failed: string[] = [];
    let gated = 0;
    for (const { day, ex, def } of sql) {
      const gate = await sqlWorkspaceRunnable(def);
      if (!gate.ok) { gated++; continue; } // the lesson keeps the in-page runner for this one
      const { out, v } = await grade(adapter, def, ex.solution);
      if (out.status !== "ok" || !v.passed) failed.push(`${day}/${ex.id}: ${out.error?.message ?? v.tests.map((t) => t.detail).filter(Boolean).join(" | ")}`);
    }
    // eslint-disable-next-line no-console
    console.info(`Daily SQL: ${sql.length - gated} of ${sql.length} reference answers are accepted by the workspace's safety checker (${gated} keep the in-page runner).`);
    expect(failed).toEqual([]);
  }, 600_000);
});

describe.skipIf(!hasDataPython)("Python, pandas and NumPy: reference answers pass the workspace adapters (real CPython)", () => {
  const python = createPythonAdapter({ runner: cpythonRun, stop: () => undefined });
  const adapters: Record<string, ExecutionAdapter> = { python, pandas: createDataAdapter("pandas", { runner: cpythonRun, stop: () => undefined }), numpy: createDataAdapter("numpy", { runner: cpythonRun, stop: () => undefined }) };
  for (const [domain, n] of [["python", 25], ["pandas", 12], ["numpy", 3]] as const) {
    it(`${domain}: reference answers pass${full ? " (all)" : " (a sample; DAILY_ADAPTER_FULL=1 runs all)"}`, async () => {
      const items = every(all.filter((i) => i.def.domain === domain), n);
      expect(items.length).toBeGreaterThan(5);
      const failed: string[] = [];
      for (const { day, ex, def } of items) {
        const { out, v } = await grade(adapters[domain], def, ex.solution);
        if (out.status !== "ok" || !v.passed) failed.push(`${day}/${ex.id}: ${out.error?.message ?? v.tests.map((t) => t.detail).filter(Boolean).join(" | ")}`);
      }
      expect(failed).toEqual([]);
    }, 900_000);
  }
  it("a wrong answer does not pass (the grading is not vacuous)", async () => {
    const { ex, def } = all.find((i) => i.def.domain === "python")!;
    const { v } = await grade(python, def, "print('definitely wrong output')");
    expect(v.passed).toBe(false);
    expect(ex.expected).toBeDefined();
  });
});
