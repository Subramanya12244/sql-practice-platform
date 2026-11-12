// Python trace scalability: sampled loops, ring buffer, event budget, honest counts and the viewer's pages, gaps and jumps.
// The tracer runs in real CPython (the browser runs the same source in Pyodide); the viewer runs in jsdom on real traces.
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_TRACE_OPTIONS, buildTraceProgram, changeBase, changedVars, costNotes, describeStep, lineCounts, memoryAt, parseTrace, resolveTraceOptions, traceRun, type Trace, type TraceOptions } from "../site/lib/visual/pyTrace";
import { PAGE_SIZE, decodeSteps, encodeSteps, gapAfter, gapBefore, gapLabel, gapSummary, jumpTargets, pageCount, pageOf, pageRows, stepPosition } from "../site/lib/visual/traceStore";
import { TraceViewer } from "../site/components/visual/PythonTimeMachine";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(cleanup);

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;
// Pyodide 0.29 runs Python 3.13: when a 3.13 interpreter is on this machine the same checks run there too.
const PY313 = process.env.PY313 ?? "/opt/anaconda3/bin/python3.13";
const has313 = existsSync(PY313) && spawnSync(PY313, ["--version"]).stdout.toString().includes("3.13");

const dir = mkdtempSync(path.join(tmpdir(), "dftrace-"));
let seq = 0;
const file = (src: string) => { const f = path.join(dir, `p${++seq}.py`); writeFileSync(f, src); return f; };

interface Run { t: Trace; ms: number; stderr: string; raw: string }
/** Trace `code` in CPython. The program goes in a file so stdin stays free for input(). */
function traced(code: string, options?: number | Partial<TraceOptions>, stdin = "", py = PYTHON): Run {
  const t0 = Date.now();
  const r = spawnSync(py, ["-I", file(buildTraceProgram(code, options))], { input: stdin, encoding: "utf8", timeout: 120_000, maxBuffer: 1 << 28 });
  const ms = Date.now() - t0;
  const t = parseTrace(r.stdout);
  if (!t) throw new Error(`no trace: ${r.stderr}`);
  return { t, ms, stderr: r.stderr, raw: r.stdout };
}
/** The same program with no tracer at all. */
function plain(code: string, stdin = "", py = PYTHON) {
  const t0 = Date.now();
  const r = spawnSync(py, ["-I", file(code)], { input: stdin, encoding: "utf8", timeout: 120_000, maxBuffer: 1 << 28 });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, ms: Date.now() - t0 };
}
const lastLine = (s: string) => s.trim().split("\n").pop() ?? "";
const valOf = (t: Trace, stepIdx: number, name: string) => {
  const f = t.steps[stepIdx].frames[t.steps[stepIdx].frames.length - 1];
  return f.vars[name] === undefined ? undefined : t.vals[f.vars[name]];
};
const iterations = (t: Trace, line: number) => new Set(t.steps.filter((s) => s.loop?.[0] === line).map((s) => s.loop![1]));

const LOOP = "total = 0\nfor i in range(10000):\n    total += i\nprint(total)\n";

describe.skipIf(!hasPython)("scalable trace: a 10,000-iteration loop", () => {
  const { t } = traced(LOOP);
  it("keeps the first 10 iterations in full, in order", () => {
    for (let k = 1; k <= 10; k++) {
      expect(iterations(t, 2).has(k)).toBe(true);
      const mine = t.steps.filter((s) => s.loop?.[1] === k);
      expect(mine.map((s) => s.line)).toEqual([2, 3]); // the loop header, then the body
      expect(valOf(t, t.steps.indexOf(mine[1]), "i")?.r).toBe(String(k - 1));
    }
  });
  it("keeps the last 10 iterations in full, then the exit test and the end of the program", () => {
    for (let k = 9991; k <= 10000; k++) expect(t.steps.filter((s) => s.loop?.[1] === k).map((s) => s.line)).toEqual([2, 3]);
    const after = t.steps.slice(-3);
    expect(after.map((s) => `${s.ev}:${s.line}`)).toEqual(["line:2", "line:4", "return:4"]); // the loop test that ends the loop, print, program end
    expect(valOf(t, t.steps.length - 1, "total")?.r).toBe("49995000");
    expect(valOf(t, t.steps.length - 1, "i")?.r).toBe("9999");
  });
  it("keeps every 1,000th iteration as a checkpoint and summarises the rest, saying where", () => {
    const cps = t.checkpoints!.map((i) => t.steps[i].loop![1]);
    expect(cps).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
    const ranges = t.gaps!.flatMap((g) => g.loops.map((l) => [l.from, l.to] as const));
    expect(ranges[0]).toEqual([11, 999]);
    expect(ranges[ranges.length - 1]).toEqual([9001, 9990]);
    // Every iteration between the first 10 and the last 10 is a checkpoint or inside exactly one summary.
    for (let k = 11; k <= 9990; k++) {
      const inGap = ranges.filter(([a, b]) => k >= a && k <= b).length;
      expect(inGap + (k % 1000 === 0 ? 1 : 0)).toBe(1);
    }
    const g = t.gaps![0];
    expect(g.kind).toBe("loop");
    expect(g.loops[0]).toMatchObject({ line: 2, fn: "<module>" });
    expect(g.loops[0].lines).toEqual({ 2: 989, 3: 989 }); // exact lines run in iterations 11 to 999
    const total = g.loops[0].vars.find((v) => v.name === "total")!;
    expect(t.vals[total.first].r).toBe("45"); // total at the start of iteration 11 = 0+1+...+9
    expect(total.changes).toBe(988);
    expect(gapSummary(g)).toContain("iterations 11 to 999 summarised");
    expect(gapLabel(g)).toContain("events not recorded");
  });
  it("counts every line exactly, recorded or not, and says which numbers are exact", () => {
    expect(lineCounts(t)).toEqual({ 1: 1, 2: 10001, 3: 10000, 4: 1 });
    expect(t.counts).toMatchObject({ events: 20004, exact: true, maxDepth: 1, exceptions: 0 });
    expect(t.loops).toEqual([{ line: 2, entries: 1, iterations: 10000, longest: 10000, approx: false }]);
    expect(t.skipped!.events + t.steps.length).toBe(t.counts!.events);
    expect(t.truncated).toBe(true);
    const notes = costNotes(t).measured.join(" ");
    expect(notes).toContain("exact for the whole run");
    expect(notes).toContain("10,000 iterations");
    expect(t.steps.length).toBeLessThan(80);
  });
  it("produces the same output and final value as the same program with no tracer", () => {
    const p = plain(LOOP);
    expect(t.stdout).toBe(p.stdout);
    expect(t.stdout).toBe("49995000\n");
    expect(t.ok).toBe(true);
  });
  it("lets the learner inspect any recorded snapshot and never invents the skipped ones", () => {
    // All sequence numbers are real, strictly increasing; a gap says exactly how many events lie between neighbours.
    const seqs = t.steps.map((s) => s.seq!);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    for (const g of t.gaps!) {
      expect(t.steps[g.before].seq! - t.steps[g.after].seq! - 1).toBe(g.skipped);
      expect(g.fromSeq).toBe(t.steps[g.after].seq! + 1);
    }
    const base = changeBase(t, t.gaps![0].before);
    expect(base!.skippedBetween).toBe(t.gaps![0].skipped);
    const ch = changedVars(t, t.gaps![0].before);
    expect(ch.find((c) => c.name === "total")?.kind).toBe("changed");
    expect(describeStep(t, t.gaps![0].before, LOOP.split("\n"))).toContain("steps were skipped before this one");
  });
});

describe.skipIf(!hasPython)("scalable trace: nested loops, loops in functions, recursion", () => {
  it("samples an inner loop each time it runs and the outer loop separately, with exact totals", () => {
    const code = "n = 0\nfor i in range(30):\n    for j in range(500):\n        n += 1\nprint(n)\n";
    const { t } = traced(code, { checkpointEvery: 100 });
    expect(t.stdout).toBe("15000\n");
    expect(lineCounts(t)).toMatchObject({ 3: 30 * 501, 4: 15000 });
    const byLine = Object.fromEntries(t.loops!.map((l) => [l.line, l]));
    expect(byLine[2]).toMatchObject({ entries: 1, iterations: 30, longest: 30 });
    expect(byLine[3]).toMatchObject({ entries: 30, iterations: 15000, longest: 500 });
    // The outer loop keeps its own first 10 and last 10 iterations; the inner loop keeps its own in each of those.
    const outer = iterations(t, 2);
    for (const k of [1, 2, 10, 21, 30]) expect(outer.has(k)).toBe(true);
    expect([11, 15, 20].some((k) => outer.has(k))).toBe(false); // outer iterations in the middle: summarised, not recorded
    expect(t.gaps!.flatMap((g) => g.loops).find((l) => l.line === 2)).toMatchObject({ from: 11, to: 20 });
    expect(t.checkpoints!.map((i) => t.steps[i].loop).filter((l) => l![0] === 3).length).toBeGreaterThan(0);
    expect(t.gaps!.some((g) => g.loops.some((l) => l.line === 2))).toBe(true);
    expect(t.gaps!.some((g) => g.loops.some((l) => l.line === 3))).toBe(true);
    // Inside an outer iteration that was kept, the inner loop is sampled too. A nested loop keeps half as many (5 first, 5 last)
    // so that nesting cannot multiply the recorded steps.
    const inner1 = t.steps.filter((s) => s.loop?.[0] === 3 && s.line === 4 && s.seq! < 1004).map((s) => s.loop![1]);
    expect(inner1.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(inner1.includes(6)).toBe(false);
    expect(inner1.slice(-2)).toEqual([499, 500]);
    expect(t.steps.length).toBeLessThanOrEqual(t.options!.maxSteps);
    expect(valOf(t, t.steps.length - 1, "n")?.r).toBe("15000");
  });
  it("samples a loop inside a function, in that function's frame, once per call", () => {
    const code = "def work(k):\n    s = 0\n    for i in range(k):\n        s += i\n    return s\na = work(3000)\nb = work(2000)\nprint(a + b)\n";
    const { t } = traced(code);
    expect(t.stdout).toBe(`${(2999 * 3000) / 2 + (1999 * 2000) / 2}\n`);
    expect(t.counts!.calls).toEqual({ work: 2 });
    expect(t.loops).toEqual([{ line: 3, entries: 2, iterations: 5000, longest: 3000, approx: false }]);
    const gapFns = t.gaps!.flatMap((g) => g.loops.map((l) => l.fn));
    expect(new Set(gapFns)).toEqual(new Set(["work"]));
    expect(t.gaps!.filter((g) => g.kind === "loop").length).toBeGreaterThanOrEqual(2); // one summary per call
    const inWork = t.steps.filter((s) => s.loop?.[0] === 3);
    expect(inWork.every((s) => s.frames[s.frames.length - 1].fn === "work")).toBe(true);
    // The call stack is kept with every recorded step, including the ones after a gap.
    expect(t.steps.filter((s) => s.loop?.[1] === 3000).every((s) => s.frames.map((f) => f.fn).join() === "<module>,work")).toBe(true);
    const ret = t.steps.filter((s) => s.ev === "return" && s.frames.length === 2).map((s) => t.vals[s.ret!].r);
    expect(ret).toEqual([String((2999 * 3000) / 2), String((1999 * 2000) / 2)]);
  });
  it("does not mistake recursion for a loop, and keeps the deepest call stack", () => {
    const code = "def down(n):\n    if n == 0:\n        return 0\n    return 1 + down(n - 1)\nprint(down(700))\n";
    const { t } = traced(code);
    expect(t.stdout).toBe("700\n");
    expect(t.loops).toEqual([]); // no loop statements: nothing was summarised as a loop
    expect(t.gaps!.every((g) => g.kind !== "loop")).toBe(true);
    expect(t.stat.recursive).toEqual(["down"]);
    expect(t.counts).toMatchObject({ exact: true, maxDepth: 702, calls: { down: 701 } });
    // The deepest point (n == 0) is always kept, with its stack (innermost frames up to the stack limit).
    const deepest = t.steps.findIndex((s) => s.ev === "call" && valOf(t, t.steps.indexOf(s), "n")?.r === "0");
    expect(deepest).toBeGreaterThan(-1);
    expect(t.steps[deepest].frames.length).toBe(t.options!.maxFrames);
    expect(t.truncated).toBe(true);
    expect(costNotes(t).conceptual.join(" ")).toContain("calls itself");
    expect(t.steps.length).toBeLessThanOrEqual(t.options!.maxSteps);
  });
  it("a loop inside a recursive function is sampled per frame, not merged across frames", () => {
    const code = "def f(d):\n    t = 0\n    for i in range(25):\n        t += 1\n    if d > 0:\n        t += f(d - 1)\n    return t\nprint(f(3))\n";
    const { t } = traced(code);
    expect(t.stdout).toBe("100\n");
    expect(t.loops).toEqual([{ line: 3, entries: 4, iterations: 100, longest: 25, approx: false }]);
    expect(t.counts!.calls).toEqual({ f: 4 });
  });
  it("one-line comprehension and while loops are found too", () => {
    const code = "xs = [i * 2 for i in range(3000)]\nk = 0\nwhile k < 4000:\n    k += 1\nprint(len(xs), k)\n";
    const { t } = traced(code);
    expect(t.stdout).toBe("3000 4000\n");
    const byLine = Object.fromEntries(t.loops!.map((l) => [l.line, l]));
    expect(byLine[3]).toMatchObject({ iterations: 4000, entries: 1 });
    expect(byLine[1].iterations).toBeGreaterThanOrEqual(2999); // a one-line loop may be off by one (flagged `approx`)
    expect(byLine[1].approx).toBe(true);
  });
});

describe.skipIf(!hasPython)("scalable trace: exceptions and generators", () => {
  it("keeps the exception, the state just before it and its stack after a long loop", () => {
    const code = "def risky(v):\n    return 10 // v\ntotal = 0\nfor i in range(20000):\n    total += i\nresult = risky(total - total)\nprint(result)\n";
    const { t } = traced(code);
    expect(t.ok).toBe(false);
    expect(t.error).toMatchObject({ type: "ZeroDivisionError", line: 2 });
    expect(t.exceptionStep).toBeDefined();
    const exc = t.steps[t.exceptionStep!];
    expect(exc.ev).toBe("exception");
    expect(exc.exc?.type).toBe("ZeroDivisionError");
    expect(exc.frames.map((f) => f.fn)).toEqual(["<module>", "risky"]); // the stack at the raise
    expect(valOf(t, t.exceptionStep!, "v")?.r).toBe("0");
    expect(t.vals[t.steps[t.exceptionStep!].frames[0].vars.total].r).toBe(String((19999 * 20000) / 2)); // module state just before
    expect(t.gaps!.some((g) => g.kind === "loop")).toBe(true); // the long loop before it was summarised
    expect(jumpTargets(t, 0).exception).toBe(t.exceptionStep);
    expect(t.stdout).toBe("");
    // The same exception, with the same message, as without tracing.
    const plainErr = lastLine(plain(code).stderr);
    expect(plainErr).toBe(`ZeroDivisionError: ${t.error!.msg}`); // the same message Python gives with no tracer
    expect(t.error!.msg).toContain("by zero");
    expect(t.steps[t.steps.length - 1].seq).toBe(t.counts!.events);
  });
  it("an exception inside a very long loop is kept even though most iterations were summarised", () => {
    const code = "i = 0\nwhile True:\n    i += 1\n    if i == 7777:\n        raise ValueError('stop at ' + str(i))\n";
    const { t } = traced(code);
    expect(t.error).toMatchObject({ type: "ValueError", msg: "stop at 7777", line: 5 });
    const exc = t.steps[t.exceptionStep!];
    expect(exc.exc).toEqual({ type: "ValueError", msg: "stop at 7777" });
    expect(valOf(t, t.exceptionStep!, "i")?.r).toBe("7777");
    expect(t.gaps!.some((g) => g.loops.some((l) => l.to > 100))).toBe(true);
    expect(t.truncated).toBe(true);
  });
  it("a generator with many yields: lazy values, exact counts, bounded steps", () => {
    const code = "def gen(n):\n    for i in range(n):\n        yield i\ntotal = 0\nfor v in gen(6000):\n    total += v\nprint(total)\n";
    const { t } = traced(code);
    expect(t.stdout).toBe(`${(5999 * 6000) / 2}\n`);
    expect(t.counts!.calls).toEqual({ gen: 6001 }); // one call to start it, then one per resume
    expect(lineCounts(t)[3]).toBe(6000);
    expect(lineCounts(t)[6]).toBe(6000);
    expect(t.steps.length).toBeLessThan(200);
    const yields = t.steps.filter((s) => s.ev === "yield");
    expect(yields.length).toBeGreaterThan(5);
    expect(t.vals[yields[0].ret!].r).toBe("0");
    expect(t.vals[yields[yields.length - 1].ret!].r).toBe("5999");
    expect(t.gaps!.length).toBeGreaterThan(0);
    expect(valOf(t, t.steps.length - 1, "total")?.r).toBe(String((5999 * 6000) / 2));
  });
  it("a generator consumed by sum() (no loop in the caller) keeps its own first and last iterations", () => {
    const code = "def gen(n):\n    for i in range(n):\n        yield i * 2\nprint(sum(gen(5000)))\n";
    const { t } = traced(code);
    expect(t.stdout).toBe(`${5000 * 4999}\n`);
    expect(iterations(t, 2).has(1)).toBe(true);
    expect(t.steps.length).toBeLessThan(200);
    expect(t.counts!.exact).toBe(true);
  });
  it("a generator that is never finished is still written out", () => {
    const { t } = traced("def g():\n    for i in range(100):\n        yield i\nit = g()\nnext(it)\nnext(it)\nprint('done')\n");
    expect(t.stdout).toBe("done\n");
    expect(t.steps.filter((s) => s.ev === "yield").map((s) => t.vals[s.ret!].r)).toEqual(["0", "1"]);
  });
});

describe.skipIf(!hasPython)("scalable trace: the event budget detaches the tracer and the program carries on", () => {
  const code = "total = 0\nfor i in range(200000):\n    total += i\nprint('total', total)\nprint('end')\n";
  it("stops tracing at the budget, finishes the program with the same output, and says what is exact", () => {
    const { t } = traced(code, { maxEvents: 5000 });
    const p = plain(code);
    expect(t.stdout).toBe(p.stdout);
    expect(t.stdout).toBe("total 19999900000\nend\n");
    expect(t.ok).toBe(true);
    expect(t.detached).toEqual({ atEvent: 5000, reason: "events" });
    expect(t.counts!.exact).toBe(false);
    expect(t.counts!.events).toBe(5000);
    expect(lineCounts(t)[3]).toBe(2499); // a lower bound: what was counted before tracing stopped (event 5000 was the loop test)
    const last = t.steps[t.steps.length - 1];
    expect(last.ev).toBe("end"); // the final state of the program, not a traced event
    expect(t.vals[last.frames[0].vars.total].r).toBe("19999900000");
    expect(t.gaps![t.gaps!.length - 1].kind).toBe("detached");
    expect(describeStep(t, t.steps.length - 1, code.split("\n"))).toContain("Tracing stopped earlier");
    const notes = costNotes(t).measured.join(" ");
    expect(notes).toContain("lower bounds");
    expect(notes).toContain("at least");
    expect(t.truncated).toBe(true);
    expect(t.steps.length).toBeLessThan(120);
  });
  it("a program that fails after the budget still fails with the same exception", () => {
    const failing = "n = 0\nfor i in range(50000):\n    n += i\nprint('before')\nraise KeyError('late')\n";
    const { t } = traced(failing, { maxEvents: 1000 });
    expect(t.stdout).toBe("before\n");
    expect(t.error).toMatchObject({ type: "KeyError", line: 5 });
    expect(lastLine(plain(failing).stderr)).toBe("KeyError: 'late'");
    const end = t.steps[t.steps.length - 1];
    expect(end.ev).toBe("end");
    expect(end.exc).toEqual({ type: "KeyError", msg: "'late'" });
  });
  it("a time budget detaches the same way", () => {
    // Every event after the first 1,024 checks the clock; a budget of 1 ms is always spent by then.
    const { t } = traced("t = 0\nfor i in range(300000):\n    t += i\nprint(t)\n", { maxTraceMs: 1, maxEvents: 50_000_000 });
    expect(t.detached?.reason).toBe("time");
    expect(t.stdout).toBe("44999850000\n");
    expect(t.counts!.exact).toBe(false);
  });
  it("a tracer fault never reaches the program: it is detached and the program continues", () => {
    // maxFrames of 1 with a hostile object whose attribute access raises inside the tracer's reading of values.
    const code = "class Bad:\n    @property\n    def __dict__(self):\n        raise RuntimeError('boom')\nb = Bad()\nfor i in range(30):\n    x = i\nprint('ok', x)\n";
    const { t } = traced(code);
    expect(t.stdout).toBe("ok 29\n");
    expect(t.ok).toBe(true);
  });
});

describe.skipIf(!hasPython)("scalable trace: tracing never changes what the program does", () => {
  const same = (code: string, stdin = "") => {
    const p = plain(code, stdin);
    const { t } = traced(code, undefined, stdin);
    expect(t.stdout).toBe(p.stdout);
    return { p, t };
  };
  it("input() and stdin work as without tracing", () => {
    const { t } = same("name = input('Name? ')\nn = int(input())\nprint(name * n)\nrest = input()\nprint(rest)\n", "ab\n3\nlast line\n");
    expect(t.stdout).toBe("Name? ababab\nlast line\n");
    expect(valOf(t, t.steps.length - 1, "name")?.r).toBe("'ab'");
  });
  it("EOF on stdin raises the same EOFError", () => {
    const { p, t } = same("x = input()\n", "");
    expect(t.error?.type).toBe("EOFError");
    expect(lastLine(p.stderr)).toContain("EOFError");
  });
  it("does not run the learner's __repr__ or __str__ (no extra output, no side effects) and still shows the object", () => {
    const code = "class P:\n    def __init__(self):\n        self.x = 1\n    def __repr__(self):\n        print('REPR CALLED')\n        return 'P!'\nitems = [P(), P()]\none = P()\nprint(len(items))\n";
    const { t } = same(code);
    expect(t.stdout).toBe("2\n");
    const one = t.vals[t.steps[t.steps.length - 1].frames[0].vars.one];
    expect(one.k).toBe("obj");
    expect(t.vals[one.attrs!.x].r).toBe("1");
  });
  it("does not change when finalizers run or what they print", () => {
    const code = "class D:\n    def __del__(self):\n        print('deleted')\nd = D()\nd = None\nprint('after')\nfor i in range(3):\n    t = D()\nprint('end')\n";
    const { p } = same(code);
    expect(p.stdout.split("\n").slice(0, 2)).toEqual(["deleted", "after"]);
  });
  it("does not assign to the learner's variables or change identity and aliasing", () => {
    const code = "a = [1, 2]\nb = a\nfor i in range(200):\n    a.append(i)\nprint(a is b, len(b), id(a) == id(b))\nd = {'k': [1]}\nfor i in range(50):\n    d['k'].append(i)\nprint(sum(d['k']))\nglobal_counter = 0\ndef bump():\n    global global_counter\n    global_counter += 1\nfor i in range(40):\n    bump()\nprint(global_counter)\n";
    const { t } = same(code);
    expect(t.stdout).toBe("True 202 True\n1226\n40\n");
    const m = memoryAt(t, t.steps.length - 1);
    expect(m.names.find((n) => n.name === "global_counter")!.val.r).toBe("40");
  });
  it("a module variable changed by a callee through `global` is shown correctly inside the callee", () => {
    const { t } = traced("count = 0\ndef bump():\n    global count\n    count += 1\n    return count\nfor _ in range(3):\n    bump()\n");
    const inside = t.steps.filter((s) => s.ev === "return" && s.frames.length === 2);
    expect(inside.map((s) => t.vals[s.frames[0].vars.count].r)).toEqual(["1", "2", "3"]);
  });
  it("a program that recurses until RecursionError behaves the same (the caught error and the output)", () => {
    const code = "def f(n):\n    return f(n + 1)\ntry:\n    f(0)\nexcept RecursionError:\n    print('caught')\nprint('after')\n";
    const { t } = same(code);
    expect(t.stdout).toBe("caught\nafter\n");
    expect(t.ok).toBe(true);
  });
  it("print to sys.stdout, sys.stdout.write, end/flush, stderr and large output are all counted honestly", () => {
    const code = "import sys\nprint('a', end='')\nsys.stdout.write('b\\n')\nsys.stdout.flush()\nprint('é' * 3)\nfor i in range(3000):\n    print(i)\n";
    const p = plain(code);
    const { t } = traced(code, { maxStdout: 100 });
    expect(t.stdoutChars).toBe(p.stdout.length);
    expect(t.stdout).toBe(p.stdout.slice(0, 100));
    expect(t.stdoutTruncated).toBe(true);
    const full = traced(code).t;
    expect(full.stdout).toBe(p.stdout);
    expect(full.stdoutTruncated).toBe(false);
    // Output offsets of steps are real: the loop header (line 6) has seen exactly "ab\n" and "ééé\n".
    const s6 = full.steps.find((s) => s.line === 6)!;
    expect(full.stdout.slice(0, s6.out)).toBe("ab\nééé\n");
  });
  it("exceptions raised and caught inside a long loop do not end the trace or change the output", () => {
    const code = "hits = 0\nfor i in range(4000):\n    try:\n        {}[i]\n    except KeyError:\n        hits += 1\nprint(hits)\n";
    const { t } = same(code);
    expect(t.stdout).toBe("4000\n");
    expect(t.counts!.exceptions).toBe(4000);
    expect(t.ok).toBe(true);
    expect(t.steps.length).toBeLessThanOrEqual(t.options!.maxSteps);
  });
  it("a hostile __getattr__/__len__ object does not break the trace", () => {
    const code = "class Odd:\n    def __getattr__(self, n):\n        raise AttributeError(n)\n    def __len__(self):\n        raise RuntimeError('no len')\no = Odd()\nfor i in range(20):\n    pass\nprint('fine')\n";
    const { t } = same(code);
    expect(t.stdout).toBe("fine\n");
    expect(t.detached).toBeUndefined();
  });
  it("syntax errors still run nothing", () => {
    const { t } = traced("for i in range(3)\n    pass\n");
    expect(t.error?.type).toBe("SyntaxError");
    expect(t.steps).toEqual([]);
  });
  it("code containing $& or the placeholder names is embedded unchanged", () => {
    const code = "s = '$& $1 __DF_OPT__ __DF_SRC__'\nprint(s)\n";
    const { t } = traced(code);
    expect(t.stdout).toBe("$& $1 __DF_OPT__ __DF_SRC__\n");
  });
});

describe.skipIf(!hasPython)("scalable trace: speed", () => {
  const code = "total = 0\nfor i in range(1000000):\n    total += i\nprint(total)\n";
  it("a 1,000,000-iteration loop finishes with exact counts, and the traced and untraced times are reported", () => {
    const p = plain(code);
    const { t, ms } = traced(code, { maxEvents: 5_000_000, maxTraceMs: 0 });
    expect(t.stdout).toBe(p.stdout);
    expect(t.stdout).toBe("499999500000\n");
    expect(lineCounts(t)).toEqual({ 1: 1, 2: 1_000_001, 3: 1_000_000, 4: 1 });
    expect(t.counts!.exact).toBe(true);
    expect(t.loops![0]).toMatchObject({ iterations: 1_000_000 });
    expect(t.steps.length).toBeLessThan(120);
    expect(t.checkpoints!.length).toBeLessThanOrEqual(t.options!.maxCheckpoints);
    const ratio = (ms / Math.max(1, p.ms)).toFixed(1);
    console.log(`1,000,000 iterations (2,000,004 events), CPython ${spawnSync(PYTHON, ["--version"]).stdout.toString().trim()}: untraced ${p.ms} ms, traced ${ms} ms (${ratio}x, ${(ms / 2000.004).toFixed(2)} microseconds per event, includes interpreter start)`);
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
  it("with the default limits the same loop is traced up to the event budget, then runs on untraced", () => {
    const p = plain(code);
    const { t, ms } = traced(code);
    expect(t.stdout).toBe(p.stdout);
    expect(t.detached).toMatchObject({ atEvent: DEFAULT_TRACE_OPTIONS.maxEvents, reason: "events" });
    expect(t.counts!.exact).toBe(false);
    console.log(`default budget (${DEFAULT_TRACE_OPTIONS.maxEvents} events): untraced ${p.ms} ms, traced ${ms} ms`);
    expect(ms).toBeLessThan(30_000);
  }, 120_000);
  it("the trace stays small on the wire (deltas) even for many recorded steps", () => {
    const wide = "a = 1\nb = 2\nc = 3\nd = 4\ne = 5\nf = 6\n" + "b = 2\n".repeat(150);
    const { t, raw } = traced(wide);
    expect(t.steps.length).toBeGreaterThan(90);
    const asFull = JSON.stringify(t.steps).length;
    expect(raw.length).toBeLessThan(asFull); // the wire form (deltas + value table) is smaller than the expanded steps
    // Frames that did not change share one object in memory.
    let shared = 0;
    for (let i = 1; i < t.steps.length; i++) if (t.steps[i].frames[0].vars === t.steps[i - 1].frames[0].vars) shared++;
    expect(shared).toBeGreaterThan(10);
  });
});

describe.skipIf(!has313)("scalable trace: the same behaviour on Python 3.13 (Pyodide 0.29 runs 3.13)", () => {
  it("loop sampling, exact counts and output equality hold", () => {
    const { t } = traced(LOOP, undefined, "", PY313);
    expect(t.stdout).toBe(plain(LOOP, "", PY313).stdout);
    expect(lineCounts(t)).toEqual({ 1: 1, 2: 10001, 3: 10000, 4: 1 });
    expect(t.checkpoints!.length).toBe(9);
    expect(iterations(t, 2).has(10000)).toBe(true);
  });
  it("generators, exceptions and the event budget", () => {
    const g = traced("def gen(n):\n    for i in range(n):\n        yield i\nt = 0\nfor v in gen(3000):\n    t += v\nprint(t)\n", undefined, "", PY313).t;
    expect(g.stdout).toBe("4498500\n");
    expect(g.steps.filter((s) => s.ev === "yield").length).toBeGreaterThan(5);
    const e = traced("for i in range(9000):\n    pass\nraise ValueError('x')\n", undefined, "", PY313).t;
    expect(e.steps[e.exceptionStep!].exc?.type).toBe("ValueError");
    const d = traced("t = 0\nfor i in range(20000):\n    t += i\nprint(t)\n", { maxEvents: 3000 }, "", PY313).t;
    expect(d.stdout).toBe("199990000\n");
    expect(d.detached?.reason).toBe("events");
  });
});

describe("trace options", () => {
  it("fill defaults, clamp, and treat a number as the step budget (the old second argument)", () => {
    expect(resolveTraceOptions()).toEqual(resolveTraceOptions({}));
    expect(resolveTraceOptions().maxSteps).toBe(DEFAULT_TRACE_OPTIONS.maxSteps);
    const small = resolveTraceOptions(50);
    expect(small.maxSteps).toBe(50);
    expect(small.headSteps + small.tailSteps).toBeLessThan(50);
    expect(resolveTraceOptions({ loopHead: -5, loopTail: 1e12, checkpointEvery: NaN }).loopHead).toBe(1);
    expect(resolveTraceOptions({ loopTail: 1e12 }).loopTail).toBe(500);
    expect(resolveTraceOptions({ checkpointEvery: NaN }).checkpointEvery).toBe(DEFAULT_TRACE_OPTIONS.checkpointEvery);
    expect(resolveTraceOptions({ maxEvents: 5 }).maxEvents).toBe(100);
  });
  it("buildTraceProgram embeds the resolved options and keeps working with a number", () => {
    expect(buildTraceProgram("x = 1")).toContain(JSON.stringify(JSON.stringify(resolveTraceOptions())));
    expect(buildTraceProgram("x = 1", 77)).toContain('\\"maxSteps\\":77');
    expect(buildTraceProgram("x = 1", { loopHead: 3 })).toContain('\\"loopHead\\":3');
  });
  it("does not use CPython-only features (Pyodide compatibility)", () => {
    const src = buildTraceProgram("x = 1");
    expect(src).not.toContain("sys.monitoring");
    expect(src).not.toContain("_sys.monitoring");
    expect(src).not.toMatch(/\bmatch\s+\w+:/);
    expect(src).not.toContain("f_locals[");
    expect(src).toContain("settrace");
  });
  it("traceRun passes the program, the stdin and a longer limit to the shared runner, and options through", async () => {
    const calls: unknown[][] = [];
    const r = await traceRun("print(1)", "in", async (...a) => { calls.push(a); return { ok: false, stdout: "", error: "timeout", phase: "timeout", ms: 1 }; }, { loopHead: 4 });
    expect(calls[0][0]).toContain('\\"loopHead\\":4');
    expect(calls[0][1]).toBeUndefined();
    expect(typeof calls[0][2]).toBe("number");
    expect(calls[0][3]).toBe("in");
    expect(r.trace).toBeNull();
  });
});

describe("trace store: delta format, pages, jumps", () => {
  const steps = decodeSteps([
    { q: 1, e: "line", l: 1, f: [["<module>", 1, {}]], o: 0 },
    { q: 2, e: "line", l: 2, f: [["<module>", 2, { a: 0 }]], o: 0 },
    { q: 3, e: "line", l: 3, f: [["<module>", 3, [{}, []]]], o: 0 },
    { q: 4, e: "call", l: 5, f: [["<module>", 3, [{ b: 1 }, []]], ["f", 5, { n: 2 }]], o: 0 },
    { q: 5, e: "line", l: 6, f: [["<module>", 3, [{}, []]], ["f", 6, [{ n: 3 }, []]]], o: 0 },
    { q: 6, e: "return", l: 6, f: [["<module>", 3, [{}, ["a"]]]], o: 0, r: 4 },
  ]);
  it("rebuilds full steps from deltas, drops removed names, and shares unchanged variable maps", () => {
    expect(steps[2].frames[0].vars).toEqual({ a: 0 });
    expect(steps[2].frames[0].vars).toBe(steps[1].frames[0].vars); // shared, not copied
    expect(steps[3].frames[0].vars).toEqual({ a: 0, b: 1 });
    expect(steps[3].frames[1].vars).toEqual({ n: 2 });
    expect(steps[4].frames[1].vars).toEqual({ n: 3 });
    expect(steps[5].frames[0].vars).toEqual({ b: 1 });
    expect(steps[5].ret).toBe(4);
  });
  it("encode then decode is lossless", () => {
    expect(decodeSteps(encodeSteps(steps))).toEqual(steps);
  });
  it("legacy steps (every frame in full) decode unchanged", () => {
    const legacy = decodeSteps([{ e: "line", l: 1, f: [["<module>", 1, { x: 1 }]], o: 0 }, { e: "line", l: 2, f: [["<module>", 2, { x: 2 }]], o: 0 }]);
    expect(legacy.map((s) => s.frames[0].vars)).toEqual([{ x: 1 }, { x: 2 }]);
    expect(legacy[0].seq).toBeUndefined();
  });
  const big: Trace = {
    ok: true, truncated: true, stdout: "", stat: { loopDepth: 1, recursive: [], loops: 1 }, vals: [{ k: "int", r: "1" }],
    steps: Array.from({ length: 130 }, (_, i) => ({ ev: "line" as const, line: 2 + (i % 2), out: 0, seq: i < 60 ? i + 1 : i + 9000, frames: [{ fn: "<module>", line: 2, vars: {} }], cp: i === 60 ? true : undefined })),
    gaps: [{ after: 59, before: 60, fromSeq: 61, toSeq: 9059, skipped: 8999, kind: "loop", loops: [{ fn: "<module>", line: 2, from: 11, to: 4500, lines: { 2: 4490 }, vars: [] }] }],
    checkpoints: [60], counts: { events: 9200, lines: { 2: 4600 }, calls: {}, maxDepth: 1, exceptions: 0, exact: true },
  };
  it("pages: a window of the steps with the gap marker where it belongs", () => {
    expect(pageCount(130)).toBe(Math.ceil(130 / PAGE_SIZE));
    expect(pageOf(60)).toBe(Math.floor(60 / PAGE_SIZE));
    const rows = pageRows(big, pageOf(60));
    expect(rows.length).toBeLessThanOrEqual(PAGE_SIZE + 1);
    const at = rows.findIndex((r) => r.type === "gap");
    expect(at).toBeGreaterThan(0);
    const next = rows[at + 1];
    expect(next.type === "step" && next.index).toBe(60);
    expect(pageRows(big, 0).every((r) => r.type === "step")).toBe(true);
    expect(gapBefore(big, 60)?.skipped).toBe(8999);
    expect(gapAfter(big, 59)?.before).toBe(60);
  });
  it("jumps: first, last, checkpoints, next gap, exception", () => {
    expect(jumpTargets(big, 10)).toEqual({ first: 0, last: 129, exception: null, nextCheckpoint: 60, prevCheckpoint: null, nextGap: 60 });
    expect(jumpTargets(big, 100)).toMatchObject({ nextCheckpoint: null, prevCheckpoint: 60, nextGap: null });
    expect(jumpTargets({ ...big, ok: false, steps: big.steps.map((s, i) => (i === 100 ? { ...s, ev: "exception" as const } : s)) }, 0).exception).toBe(100);
    expect(stepPosition(big, 60)).toContain("checkpoint");
    expect(stepPosition(big, 60)).toContain("traced event 9,060 of 9,200");
  });
});

// ── The viewer on real traces ────────────────────────────────────────────
describe.skipIf(!hasPython)("viewer: gap markers, pages and jump buttons on a sampled trace", () => {
  const t = traced(LOOP).t;
  const view = () => render(createElement(TraceViewer, { code: LOOP, trace: t }));

  it("says the trace is sampled and which numbers are exact", () => {
    view();
    const note = screen.getByRole("note", { name: "This trace is sampled" });
    expect(note).toHaveTextContent("20,004 traced events");
    expect(note).toHaveTextContent("Line counts, call counts and the call depth are exact");
    expect(screen.getAllByText(/×10,000/).length).toBeGreaterThan(0); // the exact count on the loop body line
  });
  it("shows a gap marker with the iterations summarised, never listing steps that were not recorded", () => {
    view();
    const list = screen.getByRole("region", { name: "Recorded steps" });
    const gaps = list.querySelectorAll("[data-gap]");
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]).toHaveTextContent("iterations 11 to 999 summarised");
    fireEvent.click(gaps[0].querySelector("summary")!);
    expect(within(gaps[0] as HTMLElement).getByText(/Loop at line 2: iterations 11 to 999/)).toBeInTheDocument();
    expect(gaps[0]).toHaveTextContent("line 2 ×989, line 3 ×989");
    // Only recorded steps have rows: step buttons are numbered by position among recorded steps.
    const buttons = within(list).getAllByRole("button").filter((b) => /^#\d/.test(b.textContent ?? ""));
    expect(buttons.length).toBeLessThanOrEqual(PAGE_SIZE);
  });
  it("paginates: a page of rows, Next page / Previous page, and the page follows the current step", () => {
    view();
    const list = screen.getByRole("region", { name: "Recorded steps" });
    expect(list).toHaveTextContent(`1 to ${PAGE_SIZE} of ${t.steps.length}`);
    expect(within(list).getByText(`Page 1 of ${pageCount(t.steps.length)}`)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Next page" }));
    expect(list).toHaveTextContent(`${PAGE_SIZE + 1} to ${Math.min(t.steps.length, PAGE_SIZE * 2)} of ${t.steps.length}`);
    expect(within(list).getByRole("button", { name: "Previous page" })).toBeEnabled();
    fireEvent.click(within(list).getByRole("button", { name: "Previous page" }));
    expect(within(list).getByRole("button", { name: "Previous page" })).toBeDisabled();
    // Jumping to the last step moves the list to the last page.
    fireEvent.click(screen.getByRole("button", { name: "Last step" }));
    expect(within(screen.getByRole("region", { name: "Recorded steps" })).getByText(`Page ${pageCount(t.steps.length)} of ${pageCount(t.steps.length)}`)).toBeInTheDocument();
    // Selecting a row selects that step.
    fireEvent.click(screen.getByRole("button", { name: "First step" }));
    const row = within(screen.getByRole("region", { name: "Recorded steps" })).getAllByRole("button").find((b) => b.textContent?.startsWith("#3"))!;
    fireEvent.click(row);
    expect(screen.getByTestId("step-position")).toHaveTextContent(/^Recorded step 3 of/);
  });
  it("jump buttons: first, last, next checkpoint, previous checkpoint, next gap", () => {
    view();
    const pos = () => screen.getByTestId("step-position").textContent ?? "";
    expect(pos()).toMatch(/^Recorded step 1 of/);
    expect(screen.getByRole("button", { name: "First step" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Last step" }));
    expect(pos()).toContain(`Recorded step ${t.steps.length} of ${t.steps.length}`);
    expect(screen.getByText("The program finished. These are the final values.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "First step" }));
    fireEvent.click(screen.getByRole("button", { name: "Next checkpoint" }));
    expect(pos()).toContain("loop at line 2, iteration 1,000");
    expect(pos()).toContain("checkpoint");
    fireEvent.click(screen.getByRole("button", { name: "Next checkpoint" }));
    expect(pos()).toContain("iteration 2,000");
    fireEvent.click(screen.getByRole("button", { name: "Previous checkpoint" }));
    expect(pos()).toContain("iteration 1,000");
    fireEvent.click(screen.getByRole("button", { name: "First step" }));
    fireEvent.click(screen.getByRole("button", { name: "Next gap" }));
    expect(screen.getByTestId("gap-before")).toHaveTextContent("iterations 11 to 999 summarised");
    expect(screen.getByText(/steps were skipped before this one/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exception" })).toBeNull(); // the program did not fail
  });
  it("the step description and the gap note agree on what was skipped when stepping across a gap", () => {
    view();
    const gap = t.gaps![0];
    for (let n = 0; n < gap.after; n++) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText(/The next recorded step comes after a gap: iterations 11 to 999 summarised/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByTestId("gap-before")).toBeInTheDocument();
    expect(screen.getByTestId("step-position")).toHaveTextContent(`Recorded step ${gap.before + 1} of ${t.steps.length}`);
  });
});

describe.skipIf(!hasPython)("viewer: exception jump, early stop and a trace that is not sampled", () => {
  it("shows an Exception button that lands on the exception step with the failure message", () => {
    const code = "total = 0\nfor i in range(5000):\n    total += i\nx = 1 // 0\n";
    const t = traced(code).t;
    render(createElement(TraceViewer, { code, trace: t }));
    fireEvent.click(screen.getByRole("button", { name: "Exception" }));
    expect(screen.getByText(/ZeroDivisionError: .*Raised at line 4/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Stopped by ZeroDivisionError");
    expect(screen.getByTestId("step-position")).toHaveTextContent(`Recorded step ${t.exceptionStep! + 1} of`);
  });
  it("an early-stopped trace says tracing stopped, that counts are lower bounds, and ends on the final-state step", () => {
    const code = "t = 0\nfor i in range(100000):\n    t += i\nprint(t)\n";
    const t = traced(code, { maxEvents: 3000 }).t;
    render(createElement(TraceViewer, { code, trace: t }));
    const note = screen.getByRole("note", { name: "This trace is sampled" });
    expect(note).toHaveTextContent("Tracing stopped after 3,000 events");
    expect(note).toHaveTextContent("lower bounds");
    fireEvent.click(screen.getByRole("button", { name: "Last step" }));
    expect(screen.getByText(/Tracing stopped earlier .* ran to its end untraced/)).toBeInTheDocument();
    expect(screen.getAllByText(/≥×/).length).toBeGreaterThan(0);
  });
  it("a small program has no sampling notice, no gap markers and no checkpoint buttons", () => {
    const code = "a = 1\nb = 2\nprint(a + b)\n";
    const t = traced(code).t;
    expect(t.truncated).toBe(false);
    expect(t.gaps).toEqual([]);
    render(createElement(TraceViewer, { code, trace: t }));
    expect(screen.queryByRole("note", { name: "This trace is sampled" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next gap" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next checkpoint" })).toBeNull();
    expect(screen.getByRole("region", { name: "Recorded steps" }).querySelectorAll("[data-gap]").length).toBe(0);
    expect(t.counts).toMatchObject({ exact: true, events: t.steps.length + 0 });
  });
});
