// @vitest-environment node
// The Python step stories, built from REAL traces recorded in CPython: calculations, loops, calls, branches, scope, errors, sampling, purity.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildTraceProgram, parseTrace, type Trace, type TraceOptions } from "../site/lib/visual/pyTrace";
import { lineEffect, pyStepStory, type PyStoryContext } from "../site/lib/visual/pyStory";
import { storyProblems } from "../site/lib/visual/story";
import { buildPythonVisualModel, type PythonVisualData } from "../site/workspace/adapters/python/model";

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;

function run(code: string, opts?: Partial<TraceOptions>): { trace: Trace; ctx: PyStoryContext } {
  const r = spawnSync(PYTHON, ["-I", "-"], { input: buildTraceProgram(code, opts), encoding: "utf8", timeout: 60_000 });
  const trace = parseTrace(r.stdout);
  if (!trace) throw new Error(`no trace: ${r.stderr}`);
  const m = buildPythonVisualModel(code, trace);
  const data = m?.data as PythonVisualData | undefined;
  return { trace, ctx: { code, source: data?.source, diagnoses: data?.diagnoses } };
}
const all = (t: Trace, ctx: PyStoryContext) => t.steps.map((_, i) => pyStepStory(t, i, ctx));
const at = (t: Trace, line: number, ev: string = "line", nth = 0) => t.steps.map((s, i) => (s.ev === ev && s.line === line ? i : -1)).filter((i) => i >= 0)[nth];
const recorded = (t: Trace, i: number, name: string, frame = -1) => {
  const f = t.steps[i].frames.at(frame)!;
  return name in f.vars ? t.vals[f.vars[name]].r : undefined;
};

const PRICES = "prices = [100, 200, 300]\ntotal = 0\nfor price in prices:\n    total += price\nprint(total)\n";
const CALLS = "def add(a, b):\n    total = a + b\n    return total\ndef twice(x):\n    y = add(x, x)\n    return y\nr = twice(3)\nprint(r)\n";

describe.skipIf(!hasPython)("story: the brief's prices / total example", () => {
  const { trace: t, ctx } = run(PRICES);
  const res = all(t, ctx);
  it("the calculations are exactly 0 + 100 = 100, 100 + 200 = 300, 300 + 300 = 600, in that order", () => {
    expect(res.map((r) => r.scene.calc?.formula).filter(Boolean)).toEqual(["0 + 100 = 100", "100 + 200 = 300", "300 + 300 = 600"]);
    expect(res[at(t, 4, "line", 0)].story.changed).toContain("total went from 0 to 100");
    expect(res[at(t, 4, "line", 2)].story.changed).toContain("total went from 300 to 600");
  });
  it("the loop marks list element 0, 1, 2 at each header and at each body step, and none once it ends", () => {
    const headers = [0, 1, 2, 3].map((n) => res[at(t, 3, "line", n)].scene.loop!);
    expect(headers.map((l) => l.index)).toEqual([0, 1, 2, undefined]);
    expect(headers.map((l) => l.state)).toEqual(["taking", "taking", "taking", "finished"]);
    expect([0, 1, 2].map((n) => res[at(t, 4, "line", n)].scene.loop!.index)).toEqual([0, 1, 2]);
    expect(headers[0].list).toMatchObject({ name: "prices", items: ["100", "200", "300"], length: 3 });
    expect(headers.map((l) => l.iteration)).toEqual([1, 2, 3, 4]);
    expect(res[at(t, 3, "line", 3)].story.changed).toContain("after 3 iterations");
  });
  it("the first step creates the list, the second creates total = 0", () => {
    expect(res[0].story.changed).toContain("prices is created");
    expect(res[0].story.changed).toContain("[100, 200, 300]");
    expect(res[1].story.changed).toContain("total is created: 0 (int)");
  });
  it("the output step reports 600 and says how it was obtained", () => {
    const r = res[at(t, 5, "line")];
    expect(r.scene.output).toMatchObject({ added: "600\n", total: "600\n" });
    expect(r.story.changed).toContain("600");
    expect(r.story.why).toContain("total is 600");
    expect(r.story.why).toContain("0 → 100 → 300 → 600");
    expect(res[at(t, 5, "return")].story.changed).toContain("Output: 600");
  });
  it("every displayed value equals the value recorded at that step", () => {
    t.steps.forEach((s, i) => {
      const { scene } = res[i];
      const eff = lineEffect(t, i);
      for (const d of scene.changes) {
        expect(d.before).toBe(recorded(t, i, d.name, d.depth - 1));
        if (eff.next !== null) expect(d.after).toBe(recorded(t, eff.next, d.name, d.depth - 1));
      }
      if (scene.calc) {
        for (const o of scene.calc.operands) if (o.name) expect(o.value).toBe(recorded(t, i, o.name));
        expect(scene.calc.result).toBe(recorded(t, eff.next!, scene.calc.target));
        expect(scene.calc.before).toBe(recorded(t, i, scene.calc.target));
      }
      const loop = scene.loop;
      if (loop?.list) {
        const v = t.vals[t.steps[i].frames[0].vars[loop.list.name]];
        expect(loop.list.items).toEqual(v.items!.map((x) => t.vals[x].r));
        if (loop.index !== undefined) expect(loop.list.items[loop.index]).toBe(loop.vars[0].value);
      }
      if (scene.output) expect(scene.output.total).toBe(t.stdout.slice(0, s.out + (scene.output.added !== undefined ? scene.output.added.length : 0)));
    });
  });
  it("the loop variable shown at the first header is the value the first body step really holds", () => {
    const h = res[at(t, 3, "line", 0)].scene.loop!;
    expect(h.vars).toEqual([{ name: "price", value: recorded(t, at(t, 4, "line", 0), "price") }]);
  });
  it("a recorded value that disagrees with the arithmetic removes the formula and keeps the plain change", () => {
    const bad: Trace = JSON.parse(JSON.stringify(t));
    bad.vals.push({ k: "int", r: "999" });
    bad.steps[at(t, 3, "line", 1)].frames[0].vars.total = bad.vals.length - 1; // the step after the first `total += price`
    const r = pyStepStory(bad, at(t, 4, "line", 0), ctx);
    expect(r.scene.calc).toBeUndefined();
    expect(r.story.changed).toContain("total went from 0 to 999");
    expect(r.story.changed).not.toContain("=");
  });
});

describe.skipIf(!hasPython)("story: what is and is not a verified calculation", () => {
  const stories = (code: string) => { const { trace, ctx } = run(code); return { trace, res: all(trace, ctx) }; };
  it("reads a simple binary expression, floats, floor division, modulo and string concatenation", () => {
    const { trace, res } = stories("a = 7\nb = 2\nx = a / b\ny = a // b\nz = a % b\ns = 'ab'\ns = s + 'cd'\nw = a * b - 1\n");
    const f = (line: number) => res[at(trace, line)].scene.calc?.formula;
    expect(f(3)).toBe("7 / 2 = 3.5");
    expect(f(4)).toBe("7 // 2 = 3");
    expect(f(5)).toBe("7 % 2 = 1");
    expect(f(7)).toBe("'ab' + 'cd' = 'abcd'");
    expect(f(8)).toBeUndefined(); // two precedence levels: not read
    expect(res[at(trace, 8)].story.changed).toContain("w is created: 13");
  });
  it("shows no formula for calls, indexing, mixed precedence or an expression after +=", () => {
    const { trace, res } = stories("xs = [1, 2, 3]\nn = len(xs)\nm = xs[1] + 1\nk = 4\nk += n * 2\nq = n + m * k\n");
    for (const line of [2, 3, 5, 6]) expect(res[at(trace, line)].scene.calc).toBeUndefined();
    expect(res[at(trace, 5)].story.changed).toContain("k went from 4 to 10");
  });
  it("a list changed in place is called that, with before and after", () => {
    const { trace, res } = stories("xs = [1]\nxs.append(2)\nprint(xs)\n");
    const r = res[at(trace, 2)];
    expect(r.scene.changes[0]).toMatchObject({ name: "xs", before: "[1]", after: "[1, 2]", inPlace: true });
    expect(r.story.why).toContain("in place");
  });
});

describe.skipIf(!hasPython)("story: function calls and returns", () => {
  const { trace: t, ctx } = run(CALLS);
  const res = all(t, ctx);
  it("a call step maps real arguments to parameters and pushes a frame", () => {
    const c = res[at(t, 1, "call")].scene;
    expect(c.kind).toBe("call");
    expect(c.call).toMatchObject({ fn: "add", callerLine: 5, stackBefore: ["<module>", "twice"], stackAfter: ["<module>", "twice", "add"] });
    expect(c.call!.params).toEqual([
      { name: "a", value: "3", arg: "x", verified: true },
      { name: "b", value: "3", arg: "x", verified: true },
    ]);
    const s = res[at(t, 1, "call")].story;
    expect(s.changed).toContain("x → a = 3");
    expect(s.changed).toContain("depth 2 to 3");
    expect(c.depth).toBe(3);
    const outer = res[at(t, 4, "call")].scene.call!;
    expect(outer.params).toEqual([{ name: "x", value: "3", arg: "3", verified: true }]);
    expect(outer.callSite).toBe("r = twice(3)");
  });
  it("the return step carries the real return value, the discarded locals and the caller's line", () => {
    const r = res[at(t, 3, "return")];
    expect(r.scene.ret).toMatchObject({ fn: "add", value: "6", locals: ["a", "b", "total"], callerLine: 5, stackAfter: ["<module>", "twice"] });
    expect(r.scene.depth).toBe(3);
    expect(t.vals[t.steps[at(t, 3, "return")].ret!].r).toBe("6");
    expect(r.story.what).toContain("returns 6");
    expect(r.story.changed).toContain("depth 3 to 2");
  });
  it("the calling line reports the call's arguments and result, and the value it stored", () => {
    const r = res[at(t, 5)];
    expect(r.scene.effect.calls).toEqual([expect.objectContaining({ fn: "add", args: [{ name: "a", value: "3" }, { name: "b", value: "3" }], returned: "6" })]);
    expect(r.story.changed).toContain("add(a=3, b=3) returned 6");
    expect(r.story.changed).toContain("y is created: 6");
  });
  it("the call stack depth in each scene matches the recorded depth", () => {
    t.steps.forEach((s, i) => { expect(res[i].scene.depth).toBe(s.frames.length); expect(res[i].scene.stack).toEqual(s.frames.map((f) => f.fn)); });
  });
  it("the program's last step is the finish, with the output", () => {
    const r = res[res.length - 1];
    expect(r.scene.kind).toBe("finish");
    expect(r.story.changed).toContain("Output: 6");
  });
});

describe.skipIf(!hasPython)("story: if / elif / else branch selection from executed lines", () => {
  const code = (x: number) => `x = ${x}\nif x > 10:\n    k = "big"\nelif x > 5:\n    k = "mid"\nelse:\n    k = "small"\nprint(k)\n`;
  const branch = (x: number, line: number) => { const { trace, ctx } = run(code(x)); return { trace, r: pyStepStory(trace, at(trace, line), ctx) }; };
  it("x = 20: the if branch runs (next executed line is 3)", () => {
    const { trace, r } = branch(20, 2);
    expect(r.scene.branch).toMatchObject({ kind: "if", outcome: "true", took: "body", nextLine: 3, operands: [{ name: "x", value: "20" }] });
    expect(r.story.changed).toContain("True");
    expect(trace.steps[at(trace, 2) + 1].line).toBe(3);
  });
  it("x = 7: the if is False, the elif is tested and is True, the elif body runs", () => {
    const { trace, r } = branch(7, 2);
    expect(r.scene.branch).toMatchObject({ outcome: "false", took: "elif", nextLine: 4 });
    expect(r.story.changed).toContain("tests the next condition (line 4)");
    const e = pyStepStory(trace, at(trace, 4), run(code(7)).ctx);
    expect(e.scene.branch).toMatchObject({ kind: "elif", outcome: "true", took: "body", nextLine: 5 });
    expect(trace.steps.some((s) => s.line === 3)).toBe(false);
    expect(trace.steps.some((s) => s.line === 7)).toBe(false);
  });
  it("x = 1: both are False and the else body runs", () => {
    const { trace, ctx } = run(code(1));
    const e = pyStepStory(trace, at(trace, 4), ctx);
    expect(e.scene.branch).toMatchObject({ outcome: "false", took: "else", nextLine: 7 });
    expect(e.story.changed).toContain("else branch");
  });
  it("an if with no else and a False condition is skipped", () => {
    const { trace, ctx } = run("n = 1\nif n > 5:\n    n = 0\nprint(n)\n");
    const r = pyStepStory(trace, at(trace, 2), ctx);
    expect(r.scene.branch).toMatchObject({ outcome: "false", took: "skipped", nextLine: 4 });
  });
});

describe.skipIf(!hasPython)("story: while loops", () => {
  const { trace: t, ctx } = run("n = 3\nwhile n > 0:\n    n -= 1\nprint(n)\n");
  const res = all(t, ctx);
  it("each check shows the real operand and the outcome read from the next executed line", () => {
    const checks = [0, 1, 2, 3].map((k) => res[at(t, 2, "line", k)].scene);
    expect(checks.map((c) => c.loop!.operands)).toEqual([[{ name: "n", value: "3" }], [{ name: "n", value: "2" }], [{ name: "n", value: "1" }], [{ name: "n", value: "0" }]]);
    expect(checks.map((c) => c.loop!.state)).toEqual(["taking", "taking", "taking", "finished"]);
    expect(checks[3].branch === undefined).toBe(true);
    expect(res[at(t, 2, "line", 3)].story.changed).toContain("False");
    expect(res[at(t, 2, "line", 0)].story.changed).toContain("True");
  });
  it("the body calculates 3 - 1 = 2, 2 - 1 = 1, 1 - 1 = 0", () => {
    expect([0, 1, 2].map((k) => res[at(t, 3, "line", k)].scene.calc?.formula)).toEqual(["3 - 1 = 2", "2 - 1 = 1", "1 - 1 = 0"]);
  });
});

describe.skipIf(!hasPython)("story: scope changes", () => {
  const code = "counter = 0\ndef bump(step):\n    global counter\n    counter += step\n    local = step * 2\n    return local\nr = bump(2)\nprint(counter, r)\n";
  const { trace: t, ctx } = run(code);
  const res = all(t, ctx);
  it("module steps are global, steps inside the function are local to it", () => {
    expect(res[0].scene.scope).toBe("global");
    expect(res[at(t, 4)].scene.scope).toBe("local to bump()");
  });
  it("a write to a global from inside the function is reported as global, with a verified calculation", () => {
    const r = res[at(t, 4)];
    expect(r.scene.calc?.formula).toBe("0 + 2 = 2");
    expect(r.scene.calc?.operands.map((o) => o.scope)).toEqual(["<module>", undefined]);
    expect(r.scene.changes).toEqual([expect.objectContaining({ name: "counter", scope: "<module>", before: "0", after: "2" })]);
    expect(r.story.changed).toContain("counter (global) went from 0 to 2");
  });
  it("a local is created in the function scope and discarded on return", () => {
    const r = res[at(t, 5)];
    expect(r.scene.changes[0]).toMatchObject({ name: "local", scope: "bump" });
    expect(r.scene.calc?.formula).toBe("2 * 2 = 4");
    expect(res[at(t, 6, "return")].scene.ret!.locals).toEqual(["step", "local"]);
  });
  it("the story of print shows two values joined by a space", () => {
    const r = res[at(t, 8)];
    expect(r.scene.output!.added).toBe("2 4\n");
  });
});

describe.skipIf(!hasPython)("story: an exception", () => {
  const { trace: t, ctx } = run("def ratio(a, b):\n    return a / b\nvalues = [10, 0]\nprint('start')\nprint(ratio(values[0], values[1]))\n");
  const res = all(t, ctx);
  it("the line that raises says so, then the exception step is the error scene with the real values", () => {
    const ex = t.steps.findIndex((s) => s.ev === "exception");
    expect(ex).toBeGreaterThan(0);
    const line = res[ex - 1];
    expect(line.scene.effect.status).toBe("raised");
    expect(line.story.changed).toContain("ZeroDivisionError is raised");
    const e = res[ex];
    expect(e.scene.kind).toBe("exception");
    expect(e.scene.error).toMatchObject({ type: "ZeroDivisionError", line: 2, codeLine: "return a / b", fate: "propagates" });
    expect(e.scene.error!.values).toEqual([{ name: "a", value: "10" }, { name: "b", value: "0" }]);
    expect(e.story.what).toContain("ZeroDivisionError");
    expect(e.story.what).toContain("line 2");
    expect(e.scene.output?.total).toBe("start\n");
  });
  it("the diagnosis is used for the why and remember answers", () => {
    const ex = t.steps.findIndex((s) => s.ev === "exception");
    const d = ctx.diagnoses![0];
    expect(d).toBeTruthy();
    expect(res[ex].scene.error!.diagnosis).toBe(d);
    expect(res[ex].story.why.length).toBeGreaterThan(30);
    expect(res[ex].story.remember).toBeTruthy();
  });
  it("the last exception step is uncaught and the final step says the program ended because of it", () => {
    const exs = t.steps.map((s, i) => (s.ev === "exception" ? i : -1)).filter((i) => i >= 0);
    expect(res[exs[exs.length - 1]].scene.error!.fate).toBe("uncaught");
    expect(res[res.length - 1].story.what).toContain("ZeroDivisionError was not handled");
  });
  it("a caught exception continues in the handler", () => {
    const { trace, ctx: c } = run("try:\n    x = 1 / 0\nexcept ZeroDivisionError:\n    x = 0\nprint(x)\n");
    const ex = trace.steps.findIndex((s) => s.ev === "exception");
    expect(pyStepStory(trace, ex, c).scene.error!.fate).toBe("caught");
  });
});

describe.skipIf(!hasPython)("story: sampled traces and gaps never invent a calculation", () => {
  const { trace: t, ctx } = run("t = 0\nfor i in range(5000):\n    t += i\nprint(t)\n");
  const res = all(t, ctx);
  it("the trace really is sampled", () => { expect(t.truncated).toBe(true); expect(t.gaps!.length).toBeGreaterThan(0); });
  it("a step whose next step is not adjacent says so and claims no change or calculation", () => {
    const before = t.gaps!.map((g) => g.after);
    expect(before.length).toBeGreaterThan(0);
    for (const i of before) {
      const r = res[i];
      if (t.steps[i].ev !== "line") continue;
      expect(r.scene.sampled).toBe(true);
      expect(r.scene.calc).toBeUndefined();
      expect(r.scene.changes).toEqual([]);
      expect(r.story.changed).toMatch(/sampled/);
      expect(r.story.changed).toContain("Not shown");
    }
  });
  it("every formula in the whole trace comes from adjacent steps and equals the recorded value", () => {
    let n = 0;
    t.steps.forEach((_, i) => {
      const c = res[i].scene.calc;
      if (!c) return;
      n++;
      const eff = lineEffect(t, i);
      expect(eff.status).toBe("ok");
      expect(c.result).toBe(recorded(t, eff.next!, "t"));
    });
    expect(n).toBeGreaterThan(3);
  });
  it("a hand-made break in the event numbers is treated as a gap too", () => {
    const { trace, ctx: c } = run(PRICES);
    const cut: Trace = JSON.parse(JSON.stringify(trace));
    const k = at(trace, 4, "line", 0);
    cut.steps.splice(k + 1, 1); // drop the step after the first `total += price`; `seq` now jumps
    const r = pyStepStory(cut, k, c);
    expect(r.scene.sampled).toBe(true);
    expect(r.scene.calc).toBeUndefined();
    expect(r.story.changed).toContain("Not shown");
  });
  it("a loop header at a gap says the outcome is not known", () => {
    const { trace, ctx: c } = run(PRICES);
    const cut: Trace = JSON.parse(JSON.stringify(trace));
    const k = at(trace, 3, "line", 1);
    cut.steps.splice(k + 1, 1);
    const r = pyStepStory(cut, k, c);
    expect(r.scene.loop!.state).toBe("unknown");
    expect(r.scene.loop!.index).toBeUndefined();
    expect(r.story.changed).toContain("Not shown");
  });
});

describe.skipIf(!hasPython)("story: purity", () => {
  const progs = { prices: PRICES, calls: CALLS };
  for (const [name, code] of Object.entries(progs)) {
    it(`${name}: the story of step i is the same however the player reached it (Next, Previous, jump, Reset)`, () => {
      const { trace, ctx } = run(code);
      const n = trace.steps.length;
      const canon = all(trace, ctx).map((r) => JSON.stringify(r));
      let seed = 7;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      let i = 0;
      const moves: string[] = [];
      for (let k = 0; k < 300; k++) {
        const m = Math.floor(rnd() * 5);
        if (m === 0) i = Math.min(n - 1, i + 1); // Next
        else if (m === 1) i = Math.max(0, i - 1); // Previous
        else if (m === 2) i = Math.floor(rnd() * n); // jump
        else if (m === 3) i = 0; // Reset
        else i = n - 1; // Last
        moves.push(String(i));
        expect(JSON.stringify(pyStepStory(trace, i, ctx))).toBe(canon[i]);
      }
      expect(new Set(moves).size).toBeGreaterThan(3);
    });
  }
  it("the trace and the context are not modified", () => {
    const { trace, ctx } = run(PRICES);
    const before = JSON.stringify(trace);
    all(trace, ctx);
    expect(JSON.stringify(trace)).toBe(before);
  });
  it("an out-of-range step is clamped", () => {
    const { trace, ctx } = run(PRICES);
    expect(pyStepStory(trace, 9999, ctx).scene.step).toBe(trace.steps.length - 1);
    expect(pyStepStory(trace, -3, ctx).scene.step).toBe(0);
  });
});

describe.skipIf(!hasPython)("story: every story passes the contract", () => {
  const programs: Record<string, string> = {
    prices: PRICES, calls: CALLS,
    branches: "x = 7\nif x > 10:\n    k = 1\nelif x > 5:\n    k = 2\nelse:\n    k = 3\nprint(k)\n",
    while: "n = 3\nwhile n > 0:\n    n -= 1\nprint(n)\n",
    nested: "total = 0\nfor i in range(2):\n    for j in [10, 20]:\n        total += i * j\nprint(total)\n",
    recursion: "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(4))\n",
    generator: "def gen():\n    yield 1\n    yield 2\nfor v in gen():\n    print(v)\n",
    strings: "s = ''\nfor ch in 'abc':\n    s = s + ch\nprint(s)\n",
    dict: "d = {'a': 1}\nd['b'] = 2\nfor k in d:\n    print(k, d[k])\n",
    breakout: "for i in range(5):\n    if i == 2:\n        break\nprint(i)\n",
    multiline: "total = (1 +\n         2)\nprint(total)\n",
    error: "a = [1, 2]\nprint(a[5])\n",
    nameError: "print(undefined_name)\n",
    comprehension: "xs = [i * 2 for i in range(3)]\nprint(xs)\n",
    classes: "class P:\n    def __init__(self, x):\n        self.x = x\np = P(3)\nprint(p.x)\n",
    float: "x = 0.1\ny = x + 0.2\nprint(y)\n",
    enumerate: "xs = ['a', 'b']\nfor i, v in enumerate(xs):\n    print(i, v)\n",
  };
  for (const [name, code] of Object.entries(programs)) {
    it(`${name}: all four parts present, short and clean on every step`, () => {
      const { trace, ctx } = run(code);
      trace.steps.forEach((_, i) => {
        const { story } = pyStepStory(trace, i, ctx);
        expect(storyProblems(story), `${name} step ${i}: ${JSON.stringify(story)}`).toEqual([]);
      });
    });
  }
  it("a sampled trace also passes on every recorded step", () => {
    const { trace, ctx } = run("t = 0\nfor i in range(5000):\n    t += i\nprint(t)\n");
    trace.steps.forEach((_, i) => expect(storyProblems(pyStepStory(trace, i, ctx).story)).toEqual([]));
  });
  it("enumerate: two loop variables, no invented list position", () => {
    const { trace, ctx } = run(programs.enumerate);
    const body = pyStepStory(trace, at(trace, 3), ctx).scene.loop!;
    expect(body.vars.map((v) => v.name)).toEqual(["i", "v"]);
    expect(body.index).toBeUndefined();
  });
  it("a long statement and a long value are clipped, never overflow the limit", () => {
    const { trace, ctx } = run(`long_name = "${"x".repeat(300)}"\nprint(long_name)\n`);
    trace.steps.forEach((_, i) => expect(storyProblems(pyStepStory(trace, i, ctx).story)).toEqual([]));
  });
});
