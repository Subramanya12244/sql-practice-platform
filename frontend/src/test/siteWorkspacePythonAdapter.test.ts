// @vitest-environment node
// The Python ExecutionAdapter against a runner that executes in REAL CPython with the same contract as the Pyodide worker
// (code, then tests in one namespace; error text cleaned by the app's own friendlyPyError; phases; stdin). The grading and the
// tracer are the app's real code. Pyodide itself is not started here.
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPythonAdapter, PYTHON_CAPABILITIES, PYTHON_LIMITATIONS, stdinOf, toRunOutcome } from "../site/workspace/adapters/python/adapter";
import { isPythonVisualData, untraceableReason } from "../site/workspace/adapters/python/model";
import { learnerLine } from "../site/workspace/adapters/python/failure";
import type { ExerciseDef, RunContext, Validation } from "../site/workspace/types";
import type { PyResult, runPython } from "../site/lib/pyRunner";
import { runPythonTask, type PythonTask } from "../site/lib/tasks";
import { friendlyPyError } from "../site/lib/pyErrors";
import { analyzeSource } from "../site/lib/visual/pyBranches";

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;
const dir = hasPython ? mkdtempSync(path.join(tmpdir(), "dfpy-")) : "";
const DRIVER = `import sys, json, traceback
p = json.load(open(sys.argv[1]))
g = {"__name__": "__main__"}
phase = "code"; res = {"ok": True}
try:
    exec(compile(p["code"], "<exec>", "exec"), g)
    if p.get("tests"):
        phase = "tests"
        exec(compile(p["tests"], "<exec>", "exec"), g)
except BaseException:
    res = {"ok": False, "phase": phase, "tb": traceback.format_exc()}
sys.stderr.write("\\x1eRES\\x1e" + json.dumps(res))
`;
if (hasPython) writeFileSync(path.join(dir, "driver.py"), DRIVER);
let seq = 0;

/** Same contract as runPython (lib/pyRunner.ts), executed by CPython. */
const runner: typeof runPython = async (code, tests, timeoutMs = 10_000, stdin = "") => {
  const f = path.join(dir, `p${seq++}.json`);
  writeFileSync(f, JSON.stringify({ code, tests }));
  const started = Date.now();
  const limit = Math.min(timeoutMs, 2000);
  const r = spawnSync(PYTHON, ["-I", path.join(dir, "driver.py"), f], { input: stdin, encoding: "utf8", timeout: limit, maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - started;
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return { ok: false, phase: "timeout", stdout: r.stdout ?? "", error: `Stopped after ${Math.round(limit / 1000)}s — check for an infinite loop.`, ms } as PyResult;
  const [, tail] = (r.stderr ?? "").split("\x1eRES\x1e");
  const res = JSON.parse(tail ?? "{\"ok\":true}") as { ok: boolean; phase?: "code" | "tests"; tb?: string };
  if (res.ok) return { ok: true, stdout: r.stdout, ms };
  const msg = res.tb ?? "";
  const lines = friendlyPyError(msg).split("\n");
  const at = res.phase === "code" ? [...msg.matchAll(/File "<exec>", line (\d+)/g)].pop()?.[1] : undefined;
  return { ok: false, phase: res.phase, stdout: r.stdout, error: lines.slice(-16).join("\n").trim(), errorLine: at ? Number(at) : undefined, ms };
};

const ex = (code: string, validation: Validation, over: Partial<ExerciseDef> = {}): ExerciseDef => ({
  id: "py:test", domain: "python", source: { kind: "authored", id: "t" }, title: "T", difficulty: "Easy", topic: "t", statement: "", objectives: [], concepts: [], starterCode: code, validation, hints: [], ...over,
});
const ctxOf = (e: ExerciseDef): RunContext => ({ exercise: e });
const make = () => createPythonAdapter({ runner, stop: () => {} });

describe("python adapter: contract", () => {
  it("declares only the capabilities it really has", () => {
    expect([...PYTHON_CAPABILITIES].sort()).toEqual(["callStack", "reset", "run", "stepBack", "submit", "trace", "variables"]);
    for (const no of ["stages", "plan", "compare", "beforeAfter", "shapes"] as const) expect(PYTHON_CAPABILITIES.has(no)).toBe(false);
    const a = make();
    expect(a.domain).toBe("python");
    expect(a.capabilities).toBe(PYTHON_CAPABILITIES);
  });
  it("limitations state what the tracer really does not do", () => {
    const text = PYTHON_LIMITATIONS.join("\n");
    for (const phrase of ["supported-subset line tracer", "not a full CPython debugger", "sampled", "Threads", "asyncio", "input()", "One-line compound", "C extensions", "recorded call depth"]) expect(text).toContain(phrase);
    expect(make().limitations).toEqual([...PYTHON_LIMITATIONS]);
  });
  it("stdinOf adds the newline Daily Learning adds", () => {
    expect(stdinOf(ex("", { kind: "python-stdout", expected: "", stdin: "5" }))).toBe("5\n");
    expect(stdinOf(ex("", { kind: "python-tests", tests: "", stdin: "a\nb\n" }))).toBe("a\nb\n");
    expect(stdinOf(ex("", { kind: "none" }))).toBe("");
  });
});

describe.skipIf(!hasPython)("python adapter: run()", () => {
  const a = make();
  const none = ex("", { kind: "none" });
  it("runs code and returns stdout", async () => {
    const o = await a.run("print(sum(range(5)))", ctxOf(none));
    expect(o).toMatchObject({ status: "ok", stdout: "10\n" });
  });
  it("reports an error with its type, message and line", async () => {
    const o = await a.run("x = 1\nprint(x / 0)\n", ctxOf(none));
    expect(o.status).toBe("error");
    expect(o.error).toMatchObject({ type: "ZeroDivisionError", line: 2 });
    expect(o.error?.message).toContain("division by zero");
    expect(o.stderr).toContain("ZeroDivisionError");
  });
  it("reports a syntax error with its line", async () => {
    const o = await a.run("x = 1\nif x\n    pass\n", ctxOf(none));
    expect(o.error).toMatchObject({ type: "SyntaxError", line: 2 });
  });
  it("a time-limit stop is a timeout, not an error", async () => {
    const o = await a.run("while True:\n    pass\n", ctxOf(none));
    expect(o.status).toBe("timeout");
    expect(o.error?.type).toBe("TimeoutError");
  });
  it("an empty program is refused without running", async () => {
    const spy = vi.fn(runner);
    const o = await createPythonAdapter({ runner: spy }).run("  \n", ctxOf(none));
    expect(o.error?.type).toBe("EMPTY");
    expect(spy).not.toHaveBeenCalled();
  });
  it("uses the exercise's stdin", async () => {
    const e = ex("", { kind: "python-stdout", expected: "HI\n", stdin: "hi" });
    expect((await a.run("print(input().upper())", ctxOf(e))).stdout).toBe("HI\n");
  });
  it("without stdin input() fails with EOFError, which is explained", async () => {
    const o = await a.run("x = input()\n", ctxOf(none));
    expect(o.error?.type).toBe("EOFError");
    expect(a.explainFailure!("x = input()\n", o, null, ctxOf(none))[0].suggestion).toContain("stdin");
  });
  it("an aborted signal stops before running, and an abort during a run stops the interpreter", async () => {
    const stop = vi.fn();
    const ctl = new AbortController();
    ctl.abort();
    const never = vi.fn(() => new Promise<PyResult>(() => {}));
    const b = createPythonAdapter({ runner: never as unknown as typeof runPython, stop });
    expect((await b.run("print(1)", { exercise: none, signal: ctl.signal })).status).toBe("stopped");
    expect(never).not.toHaveBeenCalled();
    const ctl2 = new AbortController();
    const p = b.run("while True: pass", { exercise: none, signal: ctl2.signal });
    ctl2.abort();
    expect((await p).status).toBe("stopped");
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("toRunOutcome maps every runner phase", () => {
    expect(toRunOutcome({ ok: false, phase: "load", stdout: "", error: "Python could not start", ms: 1 }).error?.type).toBe("LoadError");
    expect(toRunOutcome({ ok: false, phase: "stopped", stdout: "", error: "Stopped.", ms: 1 }).status).toBe("stopped");
    expect(toRunOutcome({ ok: false, phase: "timeout", stdout: "", error: "Stopped after 10s", ms: 1 }).status).toBe("timeout");
  });
});

const TESTS = "assert double(2) == 4\nassert double(0) == 0\nassert double(-3) == -6";
const HIDDEN = "assert double(10**6) == 2 * 10**6\nassert double(2.5) == 5.0";
const tasks = (validation: Validation) => ex("def double(x):\n    pass\n", validation, { id: "py:double", title: "Double" });
const toTask = (e: ExerciseDef): PythonTask => {
  const v = e.validation as Extract<Validation, { kind: "python-tests" }>;
  return { id: e.id, title: e.title, type: "python", instructions: "", starter: e.starterCode, solution: "", tests: v.tests, hidden: v.hidden };
};

describe.skipIf(!hasPython)("python adapter: validate() is the existing grading (parity with lib/tasks.ts)", () => {
  const a = make();
  const e = tasks({ kind: "python-tests", tests: TESTS, hidden: HIDDEN });
  const cases: [string, string][] = [
    ["correct", "def double(x):\n    return x * 2\n"],
    ["wrong visible result", "def double(x):\n    return x + 2\n"],
    ["passes visible, fails hidden", "def double(x):\n    return x * 2 if abs(x) < 1000 else 0\n"],
    ["raises in the code", "def double(x):\n    return x * y\n"],
    ["syntax error", "def double(x)\n    return x * 2\n"],
    ["no return", "def double(x):\n    x * 2\n"],
  ];
  for (const [name, code] of cases) {
    it(`${name}: same verdict and counts as runPythonTask`, async () => {
      const direct = await runPythonTask(toTask(e), code, (c, t) => runner(c, t, 10_000, ""), { count: true });
      const out = await a.run(code, ctxOf(e));
      const v = await a.validate!(code, out, ctxOf(e));
      expect(v.passed).toBe(direct.ok);
      const vis = direct.counts?.visible, hid = direct.counts?.hidden;
      if (vis) expect(v.tests.find((t) => t.name === "Visible tests")?.detail).toBe(`${vis.passed} of ${vis.total} passed`);
      if (hid) expect(v.tests.find((t) => t.hidden)?.detail).toContain(`${hid.passed} of ${hid.total} passed`);
      if (v.passed) expect(v.feedback).toEqual([]);
      else expect(v.feedback!.length).toBeGreaterThan(0);
    });
  }
  it("hidden tests never expose their source", async () => {
    const code = "def double(x):\n    return x * 2 if abs(x) < 1000 else 0\n";
    const v = await a.validate!(code, await a.run(code, ctxOf(e)), ctxOf(e));
    const hidden = v.tests.find((t) => t.hidden)!;
    expect(hidden.passed).toBe(false);
    expect(JSON.stringify(v)).not.toContain("10**6");
    expect(v.feedback![0].category).toBe("unexpected output");
  });
  it("a failing visible test is listed with its assertion", async () => {
    const code = "def double(x):\n    return x + 2\n";
    const v = await a.validate!(code, await a.run(code, ctxOf(e)), ctxOf(e));
    expect(v.passed).toBe(false);
    expect(v.tests.some((t) => !t.passed && t.name.includes("assert double"))).toBe(true);
    const cats = v.feedback!.map((f) => f.category);
    expect(cats).toContain("unexpected output");
  });
  it("a function without return is named in the feedback", async () => {
    const code = "def double(x):\n    x * 2\n";
    const v = await a.validate!(code, await a.run(code, ctxOf(e)), ctxOf(e));
    expect(v.feedback!.map((f) => f.message).join(" ")).toContain("double()");
  });
  it("a syntax error is a syntax-category item with its line", async () => {
    const code = "def double(x)\n    return x * 2\n";
    const v = await a.validate!(code, await a.run(code, ctxOf(e)), ctxOf(e));
    expect(v.feedback![0]).toMatchObject({ category: "syntax", line: 1 });
    expect(v.feedback![0].suggestion).toContain("colon");
  });
  it("python-stdout exercises compare through the Daily Learning comparison", async () => {
    const stdoutEx = ex("", { kind: "python-stdout", expected: "1\n2\n3\n" });
    const ok = "for i in (1, 2, 3):\n    print(i)\n";
    expect((await a.validate!(ok, await a.run(ok, ctxOf(stdoutEx)), ctxOf(stdoutEx))).passed).toBe(true);
    const bad = "for i in (1, 2, 4):\n    print(i)\n";
    const v = await a.validate!(bad, await a.run(bad, ctxOf(stdoutEx)), ctxOf(stdoutEx));
    expect(v.passed).toBe(false);
    expect(v.tests[0].detail).toContain("Line 3");
    expect(v.tests[0].detail).toContain('"3"');
    expect(v.feedback![0].category).toBe("unexpected output");
    const trailing = "for i in (1, 2, 3):\n    print(i, end='  \\n')\n";
    expect((await a.validate!(trailing, await a.run(trailing, ctxOf(stdoutEx)), ctxOf(stdoutEx))).passed).toBe(true); // trailing spaces ignored, as for Daily Learning
  });
  it("a graded exercise with no validation only reports whether the code runs", async () => {
    const n = ex("", { kind: "none" });
    expect((await a.validate!("print(1)", await a.run("print(1)", ctxOf(n)), ctxOf(n))).passed).toBe(true);
    const bad = await a.validate!("print(", await a.run("print(", ctxOf(n)), ctxOf(n));
    expect(bad.passed).toBe(false);
    expect(bad.feedback![0].category).toBe("syntax");
  });
});

describe.skipIf(!hasPython)("python adapter: explainFailure() categories", () => {
  const a = make();
  const none = ex("", { kind: "none" });
  const cat = async (code: string) => {
    const o = await a.run(code, ctxOf(none));
    return a.explainFailure!(code, o, null, ctxOf(none));
  };
  const cases: [string, string, string][] = [
    ["syntax", "if True\n    pass\n", "syntax"],
    ["data types", "print('a' + 1)\n", "data types"],
    ["control flow", "items = [1]\nfor i in range(len(items) + 1):\n    print(items[i])\n", "control flow"],
    ["functions", "def f(a):\n    return a\nf(1, 2)\n", "functions"],
    ["collections", "d = {}\nprint(d['x'])\n", "collections"],
    ["algorithms", "def f(n):\n    return f(n + 1)\nf(1)\n", "algorithms"],
    ["runtime errors", "print(1 / 0)\n", "runtime errors"],
  ];
  for (const [name, code, expected] of cases) {
    it(`${name}`, async () => {
      const fb = await cat(code);
      expect(fb[0].category).toBe(expected);
      expect(fb[0].message.length).toBeGreaterThan(20);
      expect(fb[0].suggestion!.length).toBeGreaterThan(20);
    });
  }
  it("unexpected output (a passing run with a wrong result)", () => {
    const e = ex("", { kind: "python-stdout", expected: "2\n" });
    const fb = a.explainFailure!("print(1)", { status: "ok", durationMs: 1, stdout: "1\n" }, { passed: false, tests: [{ name: "Output matches the expected output", passed: false, detail: "Line 1: expected \"2\", your output has \"1\"." }] }, ctxOf(e));
    expect(fb[0].category).toBe("unexpected output");
    expect(fb[0].message).toContain("Line 1");
  });
  it("a stopped run has nothing to explain; a mutable default is explained after a wrong answer", () => {
    expect(a.explainFailure!("x", { status: "stopped", durationMs: 0 }, null, ctxOf(none))).toEqual([]);
    const code = "def add(x, items=[]):\n    items.append(x)\n    return items\n";
    const e = ex("", { kind: "python-tests", tests: "assert add(1) == [1]\nassert add(2) == [2]" });
    const fb = a.explainFailure!(code, { status: "ok", durationMs: 1, stdout: "" }, { passed: false, tests: [{ name: "assert add(2) == [2]", passed: false, detail: "AssertionError: assert add(2) == [2]" }] }, ctxOf(e));
    expect(fb.map((f) => f.category)).toEqual(["unexpected output", "functions"]);
    expect(fb[1].suggestion).toContain("items=None");
  });
  it("learnerLine trusts a traceback line only when the printed source is the learner's line", () => {
    const code = "x = 1\nprint(y)\n";
    const tb = 'Traceback (most recent call last):\n  File "<exec>", line 2, in <module>\n    print(y)\nNameError: name \'y\' is not defined';
    expect(learnerLine(code, tb)).toBe(2);
    expect(learnerLine(code, tb.replace("print(y)", "assert f(1) == 2"))).toBeUndefined();
    expect(learnerLine(code, tb, 7)).toBe(7);
  });
});

describe.skipIf(!hasPython)("python adapter: visualize() builds the model from a real trace", () => {
  const a = make();
  const none = ex("", { kind: "none" });
  const model = async (code: string, e = none) => {
    const m = await a.visualize!(code, { status: "ok", durationMs: 1 }, ctxOf(e));
    if (!m) throw new Error("no model");
    expect(isPythonVisualData(m.data)).toBe(true);
    return { m, d: m.data as import("../site/workspace/adapters/python/model").PythonVisualData };
  };
  const varAt = (d: { trace: import("../site/lib/visual/pyTrace").Trace }, step: number, name: string, frame = -1) => {
    const fr = d.trace.steps[step].frames.at(frame)!;
    return fr.vars[name] === undefined ? undefined : d.trace.vals[fr.vars[name]];
  };

  it("variables: values and types per step, executed provenance, supported-subset note", async () => {
    const { m, d } = await model("x = 1\nx = x + 1\ny = 'hi'\n");
    expect(m.provenance).toBe("executed");
    expect(m.steps).toBe(d.trace.steps.length);
    expect(m.notes![0]).toContain("supported-subset line tracer");
    const end = d.trace.steps.length - 1;
    expect(varAt(d, end, "x")).toMatchObject({ k: "int", r: "2" });
    expect(varAt(d, end, "y")).toMatchObject({ k: "str" });
  });
  it("loops: iteration counts and the loop variable", async () => {
    const { d } = await model("total = 0\nfor i in range(3):\n    total += i\n");
    expect(d.trace.loops).toMatchObject([{ line: 2, iterations: 3 }]);
    const body = d.trace.steps.map((s, i) => (s.line === 3 ? i : -1)).filter((i) => i >= 0);
    expect(body.map((i) => varAt(d, i, "i")?.r)).toEqual(["0", "1", "2"]);
  });
  it("functions: call arguments, return values and the call stack", async () => {
    const { d } = await model("def add(a, b):\n    return a + b\nr = add(2, 3)\n");
    const call = d.trace.steps.find((s) => s.ev === "call" && s.frames.length === 2)!;
    expect(call.frames.map((f) => f.fn)).toEqual(["<module>", "add"]);
    expect(Object.keys(call.frames[1].vars)).toEqual(["a", "b"]);
    const ret = d.trace.steps.find((s) => s.ev === "return" && s.frames.length === 2)!;
    expect(d.trace.vals[ret.ret!].r).toBe("5");
  });
  it("nested functions and closures: three frames deep", async () => {
    const { d } = await model("def outer(n):\n    def inner(k):\n        return k * n\n    return inner(2)\nprint(outer(5))\n");
    const deepest = d.trace.steps.reduce((a, s) => (s.frames.length > a.frames.length ? s : a));
    expect(deepest.frames.map((f) => f.fn)).toEqual(["<module>", "outer", "inner"]);
    expect(d.trace.stdout).toBe("10\n");
  });
  it("lists and dictionaries: items and lengths", async () => {
    const { d } = await model("nums = [3, 1]\nnums.append(2)\nm = {'a': 1}\nm['b'] = 2\n");
    const end = d.trace.steps.length - 1;
    expect(varAt(d, end, "nums")).toMatchObject({ k: "list", n: 3, r: "[3, 1, 2]" });
    expect(varAt(d, end, "m")).toMatchObject({ k: "dict", n: 2 });
  });
  it("exceptions: the trace ends at the exception and carries the diagnosis", async () => {
    const { m, d } = await model("items = [1, 2]\nprint(items[5])\n");
    expect(d.trace.error?.type).toBe("IndexError");
    expect(m.notes!.join(" ")).toContain("IndexError");
    expect(d.diagnoses[0]).toMatchObject({ cls: "index-out-of-range", errorType: "IndexError", line: 2 });
    expect(d.diagnoses[0].evidence.join(" ")).toContain("`items` has 2 items");
  });
  it("a sampled trace says so and keeps exact counts", async () => {
    const { m, d } = await model("t = 0\nfor i in range(5000):\n    t += i\n");
    expect(d.trace.truncated).toBe(true);
    expect(m.notes!.join(" ")).toContain("trace is sampled");
    expect(d.trace.loops?.[0].iterations).toBe(5000);
  });
  it("uses the exercise's stdin for the traced run", async () => {
    const e = ex("", { kind: "python-stdout", expected: "", stdin: "7" });
    const { m, d } = await model("n = int(input())\nprint(n * 2)\n", e);
    expect(d.trace.stdout).toBe("14\n");
    expect(m.notes!.join(" ")).toContain("stdin");
  });
  it("the source map is read for the branch view", async () => {
    const { d } = await model("if 1 < 2:\n    x = 1\n");
    expect(d.source.constructs.map((c) => c.kind)).toEqual(["if"]);
  });
  describe("unsupported cases fall back to null (the workspace then shows the limitations)", () => {
    it("threads, multiprocessing, asyncio and async def", async () => {
      for (const code of ["import threading\nthreading.Thread(target=print).start()\n", "from multiprocessing import Pool\n", "import asyncio\nasyncio.run(asyncio.sleep(0))\n", "async def f():\n    await g()\n"]) {
        expect(untraceableReason(code), code).toBeTruthy();
        expect(await a.visualize!(code, { status: "ok", durationMs: 1 }, ctxOf(none))).toBeNull();
      }
      expect(untraceableReason("import math\nprint(math.pi)\n")).toBeNull();
    });
    it("empty code, a syntax error (nothing ran) and a runner that returns no trace", async () => {
      expect(await a.visualize!("", { status: "ok", durationMs: 1 }, ctxOf(none))).toBeNull();
      expect(await a.visualize!("if x\n    pass\n", { status: "ok", durationMs: 1 }, ctxOf(none))).toBeNull();
      const dead = createPythonAdapter({ runner: async () => ({ ok: false, phase: "load", stdout: "", error: "Python could not start", ms: 1 }) });
      expect(await dead.visualize!("x = 1", { status: "ok", durationMs: 1 }, ctxOf(none))).toBeNull();
    });
  });
  it("branch analysis of the traced source never claims what it did not read", () => {
    const m = analyzeSource("x = 1 if True else 2\nif x: print(x)\n");
    expect(m.constructs).toEqual([]);
    expect(m.notes.join(" ")).toContain("not analysed");
  });
});
