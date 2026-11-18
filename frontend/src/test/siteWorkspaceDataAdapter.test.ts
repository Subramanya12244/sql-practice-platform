// @vitest-environment node
// The pandas and NumPy ExecutionAdapters end to end: execution, validation (the existing runPythonTask grading), visualization and
// failure explanation, with real CPython + numpy + pandas standing in for the browser's Pyodide worker.
import { describe, expect, it, vi } from "vitest";
import { createDataAdapter, adapterModule, NUMPY_CAPABILITIES, PANDAS_CAPABILITIES, isDataRunRaw } from "../site/workspace/adapters/data";
import { normalizeModule } from "../site/workspace/registry";
import type { ExerciseDef, RunContext } from "../site/workspace/types";
import type { DataModelData } from "../site/lib/visual/dataframe";
import { cpythonRun, hasDataPython } from "./siteWorkspaceDataPy";

const ex = (over: Partial<ExerciseDef> = {}): ExerciseDef => ({
  id: "authored:data-test", domain: "pandas", source: { kind: "authored", id: "data-test" }, title: "t", difficulty: "Easy", topic: "pandas", statement: "", objectives: [], concepts: [], starterCode: "",
  validation: { kind: "none" }, hints: [], ...over,
});
const ctx = (e: ExerciseDef = ex(), signal?: AbortSignal): RunContext => ({ exercise: e, signal });
const counted = () => { const f = vi.fn(cpythonRun); return f as typeof f & typeof cpythonRun; };

describe("capabilities and module shape (no Python needed)", () => {
  it("declares only what exists: shapes is numpy-only; no trace, plan or compare", () => {
    expect([...PANDAS_CAPABILITIES].sort()).toEqual(["beforeAfter", "reset", "run", "stages", "submit"]);
    expect([...NUMPY_CAPABILITIES].sort()).toEqual(["beforeAfter", "reset", "run", "shapes", "stages", "submit"]);
    const p = createDataAdapter("pandas"), n = createDataAdapter("numpy");
    expect(p.domain).toBe("pandas");
    expect(n.domain).toBe("numpy");
    expect(p.capabilities.has("trace")).toBe(false);
    expect(p.limitations!.join(" ")).toMatch(/loops|first rows/);
    expect(n.limitations!.join(" ")).toMatch(/seed/);
  });
  it("one module serves both domains and the registry can read it", async () => {
    expect(adapterModule.getAdapter("pandas").domain).toBe("pandas");
    expect(adapterModule.getAdapter("numpy").domain).toBe("numpy");
    expect(() => adapterModule.getAdapter("sql")).toThrow();
    expect(adapterModule.Visualizer).toBeTypeOf("function");
    const mod = await import("../site/workspace/adapters/data/index");
    expect(normalizeModule(mod, "numpy")!.adapter.domain).toBe("numpy");
    expect(normalizeModule(mod, "pandas")!.Visualizer).toBeDefined();
  });
});

describe.skipIf(!hasDataPython)("pandas adapter on real CPython", () => {
  const code = "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2, 3, 4], 'b': ['x', 'y', 'x', 'y']})\nprint(len(df))\nresult = df[df['a'] > 1]\n";
  it("run: output, a table of the real last result, and the stages in raw (one execution)", async () => {
    const runner = counted();
    const a = createDataAdapter("pandas", { runner });
    const out = await a.run(code, ctx());
    expect(out.status).toBe("ok");
    expect(out.stdout).toBe("4\n");
    expect(out.table).toEqual({ columns: ["a", "b"], rows: [["2", "y"], ["3", "x"], ["4", "y"]], truncated: false });
    expect(isDataRunRaw(out.raw)).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
  });
  it("visualize reuses that same run: no second execution, real stages, consistent", async () => {
    const runner = counted();
    const a = createDataAdapter("pandas", { runner });
    const out = await a.run(code, ctx());
    const vm = await a.visualize!(code, out, ctx());
    expect(runner).toHaveBeenCalledTimes(1);
    expect(vm).not.toBeNull();
    expect(vm!.provenance).toBe("executed");
    const d = vm!.data as DataModelData;
    expect(vm!.steps).toBe(d.stages.length);
    expect(d.domain).toBe("pandas");
    expect(d.consistent).toBe(true);
    expect(d.analyses.find((x) => x.rowsRemoved === 1)).toBeDefined();
    expect(d.libs.pandas).toMatch(/^\d/);
  });
  it("visualize runs the probe when the outcome carries no stages (or other code), and returns null with nothing to show", async () => {
    const runner = counted();
    const a = createDataAdapter("pandas", { runner });
    const vm = await a.visualize!(code, { status: "ok", durationMs: 1 }, ctx());
    expect(runner).toHaveBeenCalledTimes(1);
    expect(vm!.steps).toBeGreaterThan(1);
    const none = "x = [1, 2, 3]\nprint(sum(x))\n";
    expect(await a.visualize!(none, await a.run(none, ctx()), ctx())).toBeNull();
    expect(await a.visualize!("x = (", { status: "error", durationMs: 1 }, ctx())).toBeNull();
    expect(await a.visualize!(code, { status: "timeout", durationMs: 1 }, ctx())).toBeNull(); // a run that timed out is not run again for a picture
  });
  it("run: a runtime error keeps the real message and line, and the stages up to the failure", async () => {
    const a = createDataAdapter("pandas", { runner: cpythonRun });
    const bad = "import pandas as pd\ndf = pd.DataFrame({'a': [1]})\nprint('ok')\nx = df['nope']\n";
    const out = await a.run(bad, ctx());
    expect(out.status).toBe("error");
    expect(out.error).toMatchObject({ type: "KeyError", line: 4 });
    expect(out.stdout).toBe("ok\n");
    const fb = a.explainFailure!(bad, out, null, ctx());
    expect(fb[0]).toMatchObject({ category: "Columns and labels", line: 4 });
    expect(fb[0].message).toContain("Columns available: a");
  });
  it("run: a syntax error falls back to the plain runner's message", async () => {
    const a = createDataAdapter("pandas", { runner: cpythonRun });
    const out = await a.run("df = (1,\n", ctx());
    expect(out.status).toBe("error");
    expect(out.error!.type).toBe("SyntaxError");
    expect(a.explainFailure!("df = (1,\n", out, null, ctx())[0].category).toBe("Syntax");
  });
  it("run: empty code and an aborted run", async () => {
    const a = createDataAdapter("pandas", { runner: cpythonRun, stop: () => {} });
    expect((await a.run("  ", ctx())).error!.type).toBe("EMPTY");
    const ac = new AbortController(); ac.abort();
    expect((await a.run(code, ctx(ex(), ac.signal))).status).toBe("stopped");
  });
  it("passes read_csv files the exercise provides", async () => {
    const a = createDataAdapter("pandas", { runner: cpythonRun });
    const e = Object.assign(ex(), { files: { "d.csv": "x,y\n1,2\n3,4\n" } });
    const out = await a.run("import pandas as pd\ndf = pd.read_csv('d.csv')\n", ctx(e));
    expect(out.status).toBe("ok");
    expect(out.table!.rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  describe("validate through the existing runPythonTask grading", () => {
    const tests = "assert result.shape == (3, 2)\nassert list(result.columns) == ['a', 'b']\nassert result['a'].sum() == 9\n";
    const exercise = ex({ validation: { kind: "python-tests", tests } });
    it("a correct answer passes all tests", async () => {
      const a = createDataAdapter("pandas", { runner: cpythonRun });
      const out = await a.run(code, ctx(exercise));
      const v = await a.validate!(code, out, ctx(exercise));
      expect(v.passed).toBe(true);
      expect(v.tests[0]).toMatchObject({ name: "Visible tests", passed: true, detail: "3 of 3 passed" });
      expect(v.feedback).toEqual([]);
    });
    it("a wrong answer fails and says how the shape differs, from the real result", async () => {
      const a = createDataAdapter("pandas", { runner: cpythonRun });
      const wrong = code.replace("> 1", "> 0");
      const out = await a.run(wrong, ctx(exercise));
      const v = await a.validate!(wrong, out, ctx(exercise));
      expect(v.passed).toBe(false);
      expect(v.tests.some((t) => !t.passed && t.name.includes("result.shape"))).toBe(true);
      const f = v.feedback!.find((x) => x.category === "Shapes")!;
      expect(f.message).toBe("`result` has shape (4, 2) but the exercise expects (3, 2). The row count is too high by 1.");
      expect(f.suggestion).toMatch(/filter/);
    });
    it("a dtype expectation names the column and both dtypes", async () => {
      const a = createDataAdapter("pandas", { runner: cpythonRun });
      const e2 = ex({ validation: { kind: "python-tests", tests: "assert result['a'].dtype == 'float64'\n" } });
      const out = await a.run(code, ctx(e2));
      const v = await a.validate!(code, out, ctx(e2));
      expect(v.passed).toBe(false);
      expect(v.feedback![0]).toMatchObject({ category: "Dtypes", message: "Column `a` of `result` has dtype int64 but the exercise expects float64." });
    });
    it("a hidden test failure is reported without showing the test", async () => {
      const a = createDataAdapter("pandas", { runner: cpythonRun });
      const e3 = ex({ validation: { kind: "python-tests", tests: "assert len(result) == 3\n", hidden: "assert result['a'].min() == 99\n" } });
      const out = await a.run(code, ctx(e3));
      const v = await a.validate!(code, out, ctx(e3));
      expect(v.passed).toBe(false);
      expect(v.tests.find((t) => t.hidden)).toMatchObject({ passed: false });
      expect(JSON.stringify(v)).not.toContain("99");
      expect(v.feedback![0].message).toMatch(/hidden check fails/);
    });
    it("an error in the learner's code is explained, not graded as a wrong answer", async () => {
      const a = createDataAdapter("pandas", { runner: cpythonRun });
      const bad = "import pandas as pd\nresult = pd.DataFrame({'a': [1]})['nope']\n";
      const out = await a.run(bad, ctx(exercise));
      const v = await a.validate!(bad, out, ctx(exercise));
      expect(v.passed).toBe(false);
      expect(v.feedback!.some((f) => f.category === "Columns and labels")).toBe(true);
    });
    it("stdout exercises compare the output; 'none' only needs the code to run", async () => {
      const a = createDataAdapter("pandas", { runner: cpythonRun });
      const so = ex({ validation: { kind: "python-stdout", expected: "4\n" } });
      const out = await a.run(code, ctx(so));
      expect((await a.validate!(code, out, ctx(so))).passed).toBe(true);
      const so2 = ex({ validation: { kind: "python-stdout", expected: "5\n" } });
      const v2 = await a.validate!(code, out, ctx(so2));
      expect(v2.passed).toBe(false);
      expect(v2.tests[0].detail).toContain("expected \"5\"");
      expect((await a.validate!(code, out, ctx(ex()))).passed).toBe(true);
    });
  });
});

describe.skipIf(!hasDataPython)("numpy adapter on real CPython", () => {
  it("broadcast failure: run reports NumPy's error, visualize shows the failing stage, explainFailure names the shapes", async () => {
    const a = createDataAdapter("numpy", { runner: cpythonRun });
    const bad = "import numpy as np\na = np.ones((2, 3))\nb = np.ones(4)\nc = a + b\n";
    const out = await a.run(bad, ctx(ex({ domain: "numpy" })));
    expect(out.status).toBe("error");
    expect(out.error!.message).toContain("operands could not be broadcast together with shapes (2,3) (4,)");
    expect(out.error!.line).toBe(4);
    const vm = await a.visualize!(bad, out, ctx());
    const d = vm!.data as DataModelData;
    expect(d.ok).toBe(false);
    const last = d.analyses[d.analyses.length - 1];
    expect(last.nd!.broadcast!.valid).toBe(false);
    expect(d.consistent).toBe(true);
    const fb = a.explainFailure!(bad, out, null, ctx());
    expect(fb[0].category).toBe("Shapes");
    expect(fb[0].message).toContain("(2,3) and (4,)");
    expect(fb[0].message).toContain("It happened at a + b");
  });
  it("matmul failure is explained with the inner dimensions", async () => {
    const a = createDataAdapter("numpy", { runner: cpythonRun });
    const bad = "import numpy as np\na = np.ones((2, 3))\nc = a @ np.ones((2, 3))\n";
    const out = await a.run(bad, ctx());
    const fb = a.explainFailure!(bad, out, null, ctx());
    expect(fb[0].category).toBe("Shapes");
    expect(fb[0].message).toContain("(m, n) @ (n, p)");
  });
  it("validation of a numpy exercise (ndim and shape expectations)", async () => {
    const a = createDataAdapter("numpy", { runner: cpythonRun });
    const e = ex({ domain: "numpy", validation: { kind: "python-tests", tests: "assert arr.shape == (2, 3)\nassert arr.ndim == 2\nassert arr.sum() == 15\n" } });
    const good = "import numpy as np\narr = np.arange(6).reshape(2, 3)\n";
    const g = await a.validate!(good, await a.run(good, ctx(e)), ctx(e));
    expect(g.passed).toBe(true);
    const wrong = "import numpy as np\narr = np.arange(6).reshape(3, 2)\n";
    const w = await a.validate!(wrong, await a.run(wrong, ctx(e)), ctx(e));
    expect(w.passed).toBe(false);
    expect(w.feedback![0].message).toContain("`arr` has shape (3, 2) but the exercise expects (2, 3)");
  });
  it("seeded random exercise: the same output on every run", async () => {
    const a = createDataAdapter("numpy", { runner: cpythonRun });
    const rnd = "import numpy as np\nnp.random.seed(42)\nr = np.random.randint(0, 100, size=3)\nprint(r)\n";
    const x = await a.run(rnd, ctx()), y = await a.run(rnd, ctx());
    expect(x.stdout).toBe(y.stdout);
    expect(x.stdout).toBe("[51 92 14]\n");
    const vm = await a.visualize!(rnd, x, ctx());
    expect((vm!.data as DataModelData).seeds.seeds).toEqual([42]);
  });
});
