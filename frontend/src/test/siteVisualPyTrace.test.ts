// @vitest-environment node
// The Python Code Time Machine tracer, run in real CPython 3.13 (the browser runs the same source inside Pyodide).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildTraceProgram, changedVars, costNotes, describeStep, lineCounts, memoryAt, parseTrace, traceRun, type Trace } from "../site/lib/visual/pyTrace";

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;
const hasPandas = hasPython && spawnSync(PYTHON, ["-c", "import pandas, numpy"]).status === 0;

function trace(code: string, max?: number): Trace {
  const r = spawnSync(PYTHON, ["-I", "-"], { input: buildTraceProgram(code, max), encoding: "utf8", timeout: 60_000 });
  const t = parseTrace(r.stdout);
  if (!t) throw new Error(`no trace: ${r.stderr}`);
  return t;
}
const val = (t: Trace, i: number, name: string) => {
  const f = t.steps[i].frames[t.steps[i].frames.length - 1];
  return f.vars[name] === undefined ? undefined : t.vals[f.vars[name]];
};
const lastStep = (t: Trace) => t.steps.length - 1;

describe.skipIf(!hasPython)("Python trace: loops and functions", () => {
  const code = "total = 0\nfor i in range(3):\n    total += i\nprint(total)\n";
  it("records every executed line, in order, with real variable values", () => {
    const t = trace(code);
    expect(t.ok).toBe(true);
    const lines = t.steps.filter((s) => s.ev === "line").map((s) => s.line);
    expect(lines).toEqual([1, 2, 3, 2, 3, 2, 3, 2, 4]);
    const afterLoop = t.steps.findIndex((s, i) => s.line === 4 && s.ev === "line" && i > 0);
    expect(val(t, afterLoop, "total")?.r).toBe("3");
    expect(t.stdout).toBe("3\n");
    expect(lineCounts(t)[3]).toBe(3);
  });
  it("shows a loop variable change step by step", () => {
    const t = trace(code);
    const idx = t.steps.map((s, i) => (s.line === 3 && s.ev === "line" ? i : -1)).filter((i) => i >= 0);
    expect(idx.map((i) => val(t, i, "i")?.r)).toEqual(["0", "1", "2"]);
    const ch = changedVars(t, idx[1]);
    expect(ch.find((c) => c.name === "i")?.kind).toBe("changed");
  });
  it("shows calls, the call stack and return values", () => {
    const t = trace("def add(a, b):\n    return a + b\nx = add(2, 3)\n");
    const call = t.steps.find((s) => s.ev === "call" && s.frames.length === 2)!;
    expect(call.frames.map((f) => f.fn)).toEqual(["<module>", "add"]);
    const ret = t.steps.find((s) => s.ev === "return" && s.frames.length === 2)!;
    expect(t.vals[ret.ret!].r).toBe("5");
    expect(describeStep(t, t.steps.indexOf(ret), "def add(a, b):\n    return a + b\nx = add(2, 3)\n".split("\n"))).toContain("returns 5");
  });
  it("does not trace the learner's output into the trace itself and captures print", () => {
    const t = trace("print('hi')\nprint('there')\n");
    expect(t.stdout).toBe("hi\nthere\n");
  });
});

describe.skipIf(!hasPython)("Python trace: mutable and immutable objects, aliasing, copies", () => {
  it("shows an alias: two names, one object, a change visible through both", () => {
    const t = trace("a = [1, 2]\nb = a\nb.append(3)\nc = a.copy()\nc.append(4)\n");
    const end = lastStep(t);
    const m = memoryAt(t, end);
    const a = m.names.find((n) => n.name === "a")!, b = m.names.find((n) => n.name === "b")!, c = m.names.find((n) => n.name === "c")!;
    expect(a.val.r).toBe("[1, 2, 3]");
    expect(b.objectId).toBe(a.objectId);
    expect(c.objectId).not.toBe(a.objectId);
    expect(m.aliased).toContain(a.objectId);
    expect(c.val.r).toBe("[1, 2, 3, 4]");
  });
  it("treats ints and strings as immutable values (rebinding makes a new value, no shared object)", () => {
    const t = trace("x = 5\ny = x\ny += 1\ns = 'ab'\nt = s\nt += 'c'\n");
    const m = memoryAt(t, lastStep(t));
    expect(m.names.find((n) => n.name === "x")!.val.r).toBe("5");
    expect(m.names.find((n) => n.name === "y")!.val.r).toBe("6");
    expect(m.names.find((n) => n.name === "s")!.val.r).toContain("ab");
    expect(m.objects).toEqual([]); // no mutable objects at all
  });
  it("shows a shallow copy sharing an inner list, and a deep copy that does not", () => {
    const t = trace("import copy\nouter = [[1], [2]]\nshallow = outer.copy()\ndeep = copy.deepcopy(outer)\nouter[0].append(9)\n");
    const end = t.steps[lastStep(t)].frames[0].vars;
    const v = (n: string) => t.vals[end[n]];
    const inner = (n: string) => t.vals[v(n).items![0]];
    expect(inner("shallow").id).toBe(inner("outer").id);
    expect(inner("deep").id).not.toBe(inner("outer").id);
    expect(inner("outer").r).toBe("[1, 9]");
    expect(inner("deep").r).toBe("[1]");
  });
  it("shows list operations before and after", () => {
    const t = trace("nums = [3, 1, 2]\nnums.append(4)\nnums.sort()\nlast = nums.pop()\n");
    const at = (line: number) => t.steps.findIndex((s) => s.ev === "line" && s.line === line);
    expect(val(t, at(2), "nums")?.r).toBe("[3, 1, 2]");
    expect(val(t, at(3), "nums")?.r).toBe("[3, 1, 2, 4]");
    expect(val(t, at(4), "nums")?.r).toBe("[1, 2, 3, 4]");
    expect(val(t, lastStep(t), "last")?.r).toBe("4");
  });
  it("shows dictionary insert, update and delete", () => {
    const t = trace("d = {}\nd['a'] = 1\nd['a'] = 2\ndel d['a']\nv = d.get('a')\n");
    const at = (line: number) => t.steps.findIndex((s) => s.ev === "line" && s.line === line);
    expect(val(t, at(3), "d")?.n).toBe(1);
    expect(val(t, at(4), "d")?.r).toBe("{'a': 2}");
    expect(val(t, at(5), "d")?.n).toBe(0);
    expect(val(t, lastStep(t), "v")?.k).toBe("none");
  });
});

describe.skipIf(!hasPython)("Python trace: recursion, generators, exceptions, structures", () => {
  it("shows the recursive call stack growing and unwinding", () => {
    const t = trace("def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(3))\n");
    const maxDepth = Math.max(...t.steps.map((s) => s.frames.length));
    expect(maxDepth).toBe(4); // module + fact(3), fact(2), fact(1)
    const rets = t.steps.filter((s) => s.ev === "return" && s.frames.length > 1).map((s) => t.vals[s.ret!].r);
    expect(rets).toEqual(["1", "2", "6"]);
    expect(t.stat.recursive).toEqual(["fact"]);
    expect(costNotes(t).conceptual.join(" ")).toContain("calls itself");
  });
  it("shows a generator yielding lazily, one value at a time", () => {
    const t = trace("def gen():\n    for i in range(3):\n        yield i * 10\ng = gen()\nfirst = next(g)\nsecond = next(g)\n");
    const yields = t.steps.filter((s) => s.ev === "yield").map((s) => t.vals[s.ret!].r);
    expect(yields).toEqual(["0", "10"]); // only two values were ever requested
    expect(t.vals.some((v) => v.k === "gen")).toBe(true);
  });
  it("shows where an exception happened, its type and the state before it", () => {
    const t = trace("data = [1, 2]\ntotal = 0\nfor i in range(3):\n    total += data[i]\n");
    expect(t.ok).toBe(false);
    expect(t.error).toMatchObject({ type: "IndexError", line: 4 });
    const exc = t.steps.find((s) => s.ev === "exception")!;
    expect(exc.exc?.type).toBe("IndexError");
    const before = t.steps.indexOf(exc);
    expect(val(t, before, "total")?.r).toBe("3");
    expect(val(t, before, "i")?.r).toBe("2");
  });
  it("reports a syntax error without running anything", () => {
    const t = trace("def broken(:\n    pass\n");
    expect(t.ok).toBe(false);
    expect(t.error?.type).toBe("SyntaxError");
    expect(t.steps).toEqual([]);
  });
  it("shows a linked list as objects that point at objects", () => {
    const t = trace("class Node:\n    def __init__(self, v, nxt=None):\n        self.v = v\n        self.next = nxt\nhead = Node(1, Node(2))\n");
    const head = t.vals[t.steps[lastStep(t)].frames[0].vars.head];
    expect(head.k).toBe("obj");
    const nxt = t.vals[head.attrs!.next];
    expect(t.vals[nxt.attrs!.v].r).toBe("2");
  });
  it("shows sets, tuples and string facts", () => {
    const t = trace("s = {3, 1, 2}\npoint = (1, 2)\nword = 'hello'\n");
    const v = (n: string) => t.vals[t.steps[lastStep(t)].frames[0].vars[n]];
    expect(v("s")).toMatchObject({ k: "set", n: 3 });
    expect(v("point").k).toBe("tuple");
    expect(v("word")).toMatchObject({ k: "str", n: 5 });
  });
  it("keeps the recorded steps within the budget, says what was not recorded, and the program still finishes", () => {
    // The second argument of buildTraceProgram may still be a number: the most steps that may be recorded.
    const t = trace("n = 0\nfor i in range(5000):\n    n += 1\nprint(n)\n", 50);
    expect(t.truncated).toBe(true);
    expect(t.steps.length).toBeLessThanOrEqual(50);
    expect(t.stdout).toBe("5000\n");
    // Sampling replaces the old hard stop: counts are exact for the whole run and the notes say how much was not recorded.
    expect(lineCounts(t)[3]).toBe(5000);
    const notes = costNotes(t).measured.join(" ");
    expect(notes).toContain("not recorded as steps");
    expect(notes).toContain("exact");
  });
  it("counts loop nesting and gives measured counts separately from the growth note", () => {
    const t = trace("c = 0\nfor i in range(3):\n    for j in range(2):\n        c += 1\n");
    expect(t.stat.loopDepth).toBe(2);
    const notes = costNotes(t);
    expect(notes.measured.join(" ")).toContain("Line 3 ran 9 times");
    expect(notes.conceptual.join(" ")).toContain("nested 2 deep");
    expect(notes.conceptual.join(" ")).toContain("not timings");
  });
  it("blocks nothing extra and cannot change the learner's code result", () => {
    const t = trace("x = [i * i for i in range(4)]\nprint(sum(x))\n");
    expect(t.stdout).toBe("14\n");
  });
});

describe.skipIf(!hasPandas)("Python trace: pandas and numpy values", () => {
  it("snapshots a DataFrame (shape, dtypes, missing values) and shows the filtered result", () => {
    const t = trace("import pandas as pd\ndf = pd.DataFrame({'a': [1, 2, 3], 'b': [1.5, None, 3.5]})\nbig = df[df['a'] > 1]\n");
    const m = t.vals[t.steps[lastStep(t)].frames[0].vars.df];
    expect(m).toMatchObject({ k: "df", shape: [3, 2], cols: ["a", "b"], na: [0, 1] });
    expect(m.dtypes).toEqual(["int64", "float64"]);
    const big = t.vals[t.steps[lastStep(t)].frames[0].vars.big];
    expect(big.shape).toEqual([2, 2]);
    expect(big.index).toEqual(["1", "2"]);
    expect(big.rows![0][1]).toBeNull();
  });
  it("shows NumPy broadcasting: shapes, dtype and values", () => {
    const t = trace("import numpy as np\na = np.arange(6).reshape(2, 3)\nb = np.array([10, 20, 30])\nc = a + b\n");
    const v = (n: string) => t.vals[t.steps[lastStep(t)].frames[0].vars[n]];
    expect(v("a")).toMatchObject({ k: "nd", shape: [2, 3], ndim: 2 });
    expect(v("b").shape).toEqual([3]);
    expect(v("c")).toMatchObject({ shape: [2, 3], data: [["10", "21", "32"], ["13", "24", "35"]] });
  });
  it("shows a boolean mask and a vectorised aggregate", () => {
    const t = trace("import numpy as np\nx = np.array([1, 5, 9])\nmask = x > 4\nkept = x[mask]\ntotal = x.sum()\n");
    const v = (n: string) => t.vals[t.steps[lastStep(t)].frames[0].vars[n]];
    expect(v("mask").dtype).toBe("bool");
    expect(v("kept").data).toEqual(["5", "9"]);
    expect(v("total").r).toBe("15");
  });
});

describe("Python trace: browser path", () => {
  it("parseTrace returns null when the run died before the tracer finished", () => {
    expect(parseTrace("partial output")).toBeNull();
  });
  it("traceRun passes the program to the shared runner and returns its raw result when no trace came back", async () => {
    const calls: string[] = [];
    const r = await traceRun("print(1)", "", async (code) => { calls.push(code); return { ok: false, stdout: "", error: "timeout", phase: "timeout", ms: 1 }; });
    expect(calls[0]).toContain("settrace");
    expect(calls[0]).toContain(JSON.stringify("print(1)"));
    expect(r.trace).toBeNull();
    expect(r.result.phase).toBe("timeout");
  });
});
