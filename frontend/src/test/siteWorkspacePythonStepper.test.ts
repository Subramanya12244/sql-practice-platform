// @vitest-environment node
// Step over / into / out / back, and condition, branch and loop views, computed from REAL traces (run in CPython 3.x).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildTraceProgram, parseTrace, type Trace, type TraceStep, type TraceOptions } from "../site/lib/visual/pyTrace";
import { availableMoves, gapBetween, move, stepBack, stepInto, stepOut, stepOver, STEP_RULES } from "../site/lib/visual/pyStepper";
import { analyzeSource, branchAtStep, branchStats, loopExitsAtStep, loopsAtStep, operandsAt } from "../site/lib/visual/pyBranches";

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;

function trace(code: string, opts?: Partial<TraceOptions>): Trace {
  const r = spawnSync(PYTHON, ["-I", "-"], { input: buildTraceProgram(code, opts), encoding: "utf8", timeout: 60_000 });
  const t = parseTrace(r.stdout);
  if (!t) throw new Error(`no trace: ${r.stderr}`);
  return t;
}
const depth = (t: Trace, i: number) => t.steps[i].frames.length;
const at = (t: Trace, line: number, ev: TraceStep["ev"] = "line", nth = 0) => t.steps.map((s, i) => (s.ev === ev && s.line === line ? i : -1)).filter((i) => i >= 0)[nth];

const CALLS = `def add(a, b):
    total = a + b
    return total
def twice(x):
    y = add(x, x)
    return y
r = twice(3)
print(r)
`;

describe.skipIf(!hasPython)("step over, into, out and back on a real trace", () => {
  const t = trace(CALLS);
  it("the trace has the expected call depths", () => {
    expect(t.steps.map((s) => `${s.ev}${s.line}d${depth(t, t.steps.indexOf(s))}`).join(" ")).toBe(
      "line1d1 line4d1 line7d1 call4d2 line5d2 call1d3 line2d3 line3d3 return3d3 line6d2 return6d2 line8d1 return8d1".replace("call4d2", "call4d2").replace("return8d1", "return8d1"));
  });
  it("into goes to the very next recorded event, including a call", () => {
    const i = at(t, 7);
    const m = stepInto(t, i);
    expect(m.to).toBe(i + 1);
    expect(t.steps[m.to!].ev).toBe("call");
    expect(depth(t, m.to!)).toBe(depth(t, i) + 1);
    expect(m.explanation).toContain(STEP_RULES.into);
  });
  it("over skips the whole called function: next event at depth <= current", () => {
    const i = at(t, 7);
    const m = stepOver(t, i);
    expect(t.steps[m.to!].line).toBe(8);
    expect(depth(t, m.to!)).toBe(1);
    // Everything skipped is deeper than the line we stepped over.
    for (let k = i + 1; k < m.to!; k++) expect(depth(t, k)).toBeGreaterThan(depth(t, i));
  });
  it("over from inside add stays in add, and from add's last line leaves it", () => {
    const first = at(t, 2);
    expect(t.steps[stepOver(t, first).to!].line).toBe(3);
    const ret = at(t, 3);
    // Over from the line 'return total' goes to the 'return' event of add (same depth), then the caller.
    const m = stepOver(t, ret);
    expect(t.steps[m.to!].ev).toBe("return");
    expect(depth(t, m.to!)).toBe(3);
    const m2 = stepOver(t, m.to!);
    expect(depth(t, m2.to!)).toBe(2);
    expect(t.steps[m2.to!].line).toBe(6);
  });
  it("out runs the rest of the function and stops in the caller (depth < current)", () => {
    const i = at(t, 2);
    const m = stepOut(t, i);
    expect(depth(t, m.to!)).toBe(2);
    expect(t.steps[m.to!].line).toBe(6);
    for (let k = i + 1; k < m.to!; k++) expect(depth(t, k)).toBeGreaterThanOrEqual(3);
  });
  it("out from the main program is unavailable and says why", () => {
    const m = stepOut(t, at(t, 8));
    expect(m.to).toBeNull();
    expect(m.blocked?.reason).toBe("top-level");
  });
  it("back is the previous recorded event; at the start and end it says so", () => {
    expect(stepBack(t, 5).to).toBe(4);
    expect(stepBack(t, 0).blocked?.reason).toBe("start");
    expect(stepInto(t, t.steps.length - 1).blocked?.reason).toBe("end");
  });
  it("over/out/into/back obey the depth arithmetic at every step (brute force)", () => {
    for (let i = 0; i < t.steps.length; i++) {
      const d = depth(t, i);
      const mv = availableMoves(t, i);
      const firstWhere = (f: (x: number) => boolean) => { for (let k = i + 1; k < t.steps.length; k++) if (f(depth(t, k))) return k; return null; };
      expect(mv.over.to).toBe(firstWhere((x) => x <= d));
      expect(mv.out.to).toBe(d <= 1 ? null : firstWhere((x) => x < d));
      expect(mv.into.to).toBe(i + 1 < t.steps.length ? i + 1 : null);
      expect(mv.back.to).toBe(i > 0 ? i - 1 : null);
    }
  });
  it("walking with step over from the first step visits only top-level events", () => {
    let i = 0;
    const seen: number[] = [];
    for (let n = 0; n < 20; n++) { seen.push(t.steps[i].line); const m = stepOver(t, i); if (m.to === null) break; i = m.to; }
    expect(seen).toEqual([1, 4, 7, 8, 8]);
  });
  it("recursion: step over fact(n-1) does not stop inside the recursive calls", () => {
    const code = "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(3))\n";
    const r = trace(code);
    const first = at(r, 4); // 'return n * fact(n - 1)' at depth 2
    const m = stepOver(r, first);
    expect(depth(r, m.to!)).toBeLessThanOrEqual(depth(r, first));
    expect(r.steps[m.to!].ev).toBe("return");
    for (let k = first + 1; k < m.to!; k++) expect(depth(r, k)).toBeGreaterThan(depth(r, first));
  });
  it("an exception: out from the raising function reaches the caller only if it was recorded", () => {
    const r = trace("def f():\n    return 1 / 0\nf()\n");
    expect(r.error?.type).toBe("ZeroDivisionError");
    const i = at(r, 2);
    const m = stepOut(r, i);
    if (m.to !== null) expect(depth(r, m.to)).toBeLessThan(depth(r, i));
    else expect(m.blocked?.reason).toBe("end");
  });
});

describe.skipIf(!hasPython)("sampled traces: stepping across a gap is disabled", () => {
  const code = "total = 0\nfor i in range(200):\n    total += i\nprint(total)\n";
  const t = trace(code, { loopHead: 3, loopTail: 3, checkpointEvery: 1000 });
  it("the trace really has a gap", () => {
    expect(t.truncated).toBe(true);
    expect(t.gaps?.length).toBeGreaterThan(0);
  });
  const g = t.gaps![0];
  it("step into is refused at the step before the gap, with a jump offered", () => {
    const m = stepInto(t, g.after);
    expect(m.to).toBeNull();
    expect(m.blocked?.reason).toBe("gap");
    expect(m.blocked?.jumpTo).toBe(g.before);
    expect(m.blocked?.gap).toBe(g);
    expect(m.explanation).toContain("not recorded");
    expect(m.explanation).toContain("jump, not a step");
  });
  it("step back is refused at the step after the gap", () => {
    const m = stepBack(t, g.before);
    expect(m.to).toBeNull();
    expect(m.blocked?.reason).toBe("gap");
  });
  it("step over across a gap is refused too (the skipped events might be at this depth)", () => {
    const m = stepOver(t, g.after);
    expect(m.to).toBeNull();
    expect(m.blocked?.reason).toBe("gap");
  });
  it("moves that do not cross the gap still work", () => {
    expect(stepInto(t, 0).to).toBe(1);
    expect(stepInto(t, g.before).to).toBe(g.before + 1);
    expect(gapBetween(t, 0, 1)).toBeNull();
    expect(gapBetween(t, g.after, g.before)).toBe(g);
  });
  it("a step that would land on the synthetic end step of a detached trace is refused", () => {
    const d = trace("n = 0\nwhile n < 5000:\n    n += 1\nprint(n)\n", { maxEvents: 400 });
    expect(d.detached).toBeDefined();
    const endIdx = d.steps.findIndex((s) => s.ev === "end");
    expect(endIdx).toBeGreaterThan(0);
    const m = move(d, endIdx - 1, "into");
    expect(m.to).toBeNull();
  });
});

describe("hand-built traces", () => {
  const mk = (frames: number[]): Trace => ({
    ok: true, vals: [], stdout: "", truncated: false, stat: { loopDepth: 0, recursive: [], loops: 0 },
    steps: frames.map((d, i) => ({ ev: "line", line: i + 1, out: 0, frames: Array.from({ length: d }, () => ({ fn: "f", line: i + 1, vars: {} })) })),
  });
  it("over = depth <= current, out = depth < current on arbitrary depth sequences", () => {
    const t = mk([1, 2, 3, 3, 2, 3, 1]);
    expect(stepOver(t, 1).to).toBe(4); // from depth 2: next depth <= 2 is index 4
    expect(stepOut(t, 1).to).toBe(6); // next depth < 2
    expect(stepOver(t, 2).to).toBe(3);
    expect(stepOut(t, 2).to).toBe(4);
    expect(stepOver(t, 0).to).toBe(6);
  });
  it("a break in event numbers with no gap record is still refused", () => {
    const t = mk([1, 1, 1]);
    t.steps[0].seq = 1; t.steps[1].seq = 2; t.steps[2].seq = 9;
    expect(stepInto(t, 0).to).toBe(1);
    expect(stepInto(t, 1).blocked?.reason).toBe("not-recorded");
  });
  it("an empty trace has no moves", () => {
    const t = mk([]);
    expect(availableMoves(t, 0).into.to).toBeNull();
  });
});

const BRANCHY = `total = 0
for i in range(4):
    if i % 2 == 0:
        total += i
    elif i == 3:
        total += 100
    else:
        total -= 1
n = 2
while n > 0:
    n -= 1
for k in range(10):
    if k == 2:
        break
print(total)
`;

describe("source shape reader", () => {
  it("finds if, elif, else, while and for with their bodies", () => {
    const m = analyzeSource(BRANCHY);
    expect(m.supported).toBe(true);
    expect(m.constructs.map((c) => `${c.kind}@${c.line}[${c.bodyStart}-${c.bodyEnd}]`)).toEqual([
      "for@2[3-8]", "if@3[4-4]", "elif@5[6-6]", "else@7[8-8]", "while@10[11-11]", "for@12[13-14]", "if@13[14-14]",
    ]);
    const chain = m.constructs.filter((c) => c.chain === 3).map((c) => c.kind);
    expect(chain).toEqual(["if", "elif", "else"]);
    expect(m.constructs.find((c) => c.kind === "for")?.target).toBe("i");
  });
  it("reads a multi-line condition, comments, strings with colons and brackets", () => {
    const m = analyzeSource('if (a and\n    b):  # note: yes\n    x = "if y:"\nelse:\n    z = [1,\n 2]\n');
    expect(m.constructs.map((c) => `${c.kind}@${c.line}-${c.headerEnd}[${c.bodyStart}-${c.bodyEnd}]`)).toEqual(["if@1-2[3-3]", "else@4-4[5-6]"]);
  });
  it("loop else belongs to the loop, and try/else is left alone", () => {
    const m = analyzeSource("for x in y:\n    pass\nelse:\n    z = 1\ntry:\n    a = 1\nexcept E:\n    pass\nelse:\n    b = 1\n");
    const els = m.constructs.filter((c) => c.kind === "else");
    expect(els).toHaveLength(1);
    expect(els[0].loopElse).toBe(true);
  });
  it("one-line compound statements and tab indentation are reported, not guessed", () => {
    const m = analyzeSource("if x: y = 1\nfor i in z: print(i)\n");
    expect(m.constructs).toEqual([]);
    expect(m.notes.join(" ")).toContain("2 one-line compound statements");
    const tabs = analyzeSource("if x:\n\ty = 1\n");
    expect(tabs.supported).toBe(false);
    expect(tabs.notes[0]).toContain("tab");
  });
  it("marks a body that starts with a constant (no line event) as ambiguous", () => {
    expect(analyzeSource('if x:\n    "doc"\n    y = 1\n').constructs[0].ambiguousBody).toBe(true);
    expect(analyzeSource("if x:\n    y = 1\n").constructs[0].ambiguousBody).toBe(false);
  });
  it("never throws on odd input", () => {
    for (const s of ["", "\n\n", "if", "(((", '"""', "else:\n", "for x in\n", "if x:\n"]) expect(() => analyzeSource(s)).not.toThrow();
  });
});

describe.skipIf(!hasPython)("branch and loop views from real executed events", () => {
  const t = trace(BRANCHY);
  const map = analyzeSource(BRANCHY);
  it("reads each condition's outcome from the next executed line", () => {
    const ifs = t.steps.map((s, i) => (s.ev === "line" && s.line === 3 ? i : -1)).filter((i) => i >= 0);
    expect(ifs).toHaveLength(4);
    const outcomes = ifs.map((i) => branchAtStep(t, map, i)!.outcome);
    expect(outcomes).toEqual(["true", "false", "true", "false"]); // i = 0, 1, 2, 3
    const v = branchAtStep(t, map, ifs[0])!;
    expect(v.kind).toBe("if");
    expect(v.text).toBe("i % 2 == 0");
    expect(v.operands).toEqual([{ name: "i", value: "0", type: "int" }]);
    expect(v.evidence).toContain("next executed line is 4");
    expect(branchAtStep(t, map, ifs[1])!.evidence).toContain("outside the body");
  });
  it("elif is evaluated only when the if was false, and its outcome is read the same way", () => {
    const elifs = t.steps.map((s, i) => (s.ev === "line" && s.line === 5 ? i : -1)).filter((i) => i >= 0);
    expect(elifs).toHaveLength(2); // i = 1 and i = 3
    expect(elifs.map((i) => branchAtStep(t, map, i)!.outcome)).toEqual(["false", "true"]);
  });
  it("a for header says which item was taken, and when it is exhausted", () => {
    const heads = t.steps.map((s, i) => (s.ev === "line" && s.line === 2 ? i : -1)).filter((i) => i >= 0);
    expect(heads).toHaveLength(5);
    const v = branchAtStep(t, map, heads[1])!;
    expect(v.outcome).toBe("true");
    expect(v.item).toEqual({ name: "i", value: "1" });
    expect(branchAtStep(t, map, heads[4])!.outcome).toBe("false");
    expect(branchAtStep(t, map, heads[4])!.summary).toContain("no items left");
  });
  it("a while header reports the condition result and the loop's end", () => {
    const heads = t.steps.map((s, i) => (s.ev === "line" && s.line === 10 ? i : -1)).filter((i) => i >= 0);
    expect(heads.map((i) => branchAtStep(t, map, i)!.outcome)).toEqual(["true", "true", "false"]);
  });
  it("returns null for lines that are not a condition", () => {
    expect(branchAtStep(t, map, at(t, 4))).toBeNull();
    expect(branchAtStep(t, map, at(t, 1))).toBeNull();
  });
  it("exact whole-run branch counts come from the tracer's line counts", () => {
    const stats = branchStats(t, map);
    const get = (kind: string, line: number) => stats.find((s) => s.construct.kind === kind && s.construct.line === line)!;
    expect(get("if", 3)).toMatchObject({ evaluations: 4, taken: 2, notTaken: 2, exact: true });
    expect(get("elif", 5)).toMatchObject({ evaluations: 2, taken: 1, notTaken: 1 });
    expect(get("else", 7)).toMatchObject({ taken: 1 });
    expect(get("for", 2)).toMatchObject({ evaluations: 5, taken: 4, notTaken: 1, finishedNormally: 1, leftEarly: 0 });
    expect(get("while", 10)).toMatchObject({ evaluations: 3, taken: 2, finishedNormally: 1, leftEarly: 0 });
    // The loop with a break: 3 checks, 3 bodies, ended early once.
    expect(get("for", 12)).toMatchObject({ evaluations: 3, taken: 3, finishedNormally: 0, leftEarly: 1 });
  });
  it("loop view: iteration number, loop variable, and exact whole-run stats", () => {
    const body = t.steps.map((s, i) => (s.ev === "line" && s.line === 4 ? i : -1)).filter((i) => i >= 0);
    const views = body.map((i) => loopsAtStep(t, map, i)[0]);
    expect(views.map((v) => v.iteration)).toEqual([1, 3]); // lines 4 runs for i = 0 and i = 2 (iterations 1 and 3)
    expect(views[0].loopVars).toEqual([{ name: "i", value: "0" }]);
    expect(views[1].loopVars).toEqual([{ name: "i", value: "2" }]);
    expect(views[0].stat).toMatchObject({ line: 2, entries: 1, iterations: 4 });
    expect(views[0].construct.line).toBe(2);
  });
  it("iteration numbers derived from events agree with the tracer's own field", () => {
    const stripped: Trace = { ...t, steps: t.steps.map((s) => ({ ...s, loop: undefined })) };
    for (let i = 0; i < t.steps.length; i++) {
      const a = loopsAtStep(t, map, i), b = loopsAtStep(stripped, map, i);
      expect(b.map((v) => v.iteration)).toEqual(a.map((v) => v.iteration));
    }
  });
  it("shows how a loop ended: finished, break", () => {
    const afterWhile = at(t, 12);
    expect(loopExitsAtStep(t, map, BRANCHY, afterWhile).map((e) => `${e.construct.kind}@${e.construct.line}:${e.how}`)).toEqual(["while@10:finished"]);
    const afterBreak = at(t, 15);
    expect(loopExitsAtStep(t, map, BRANCHY, afterBreak).map((e) => `${e.construct.kind}@${e.construct.line}:${e.how}`)).toEqual(["for@12:break"]);
    expect(loopExitsAtStep(t, map, BRANCHY, at(t, 4))).toEqual([]);
  });
  it("nested loops: the outer iteration is derived from events", () => {
    const code = "for a in range(2):\n    for b in range(3):\n        x = a * b\n";
    const r = trace(code);
    const m = analyzeSource(code);
    const idx = r.steps.map((s, i) => (s.line === 3 ? i : -1)).filter((i) => i >= 0);
    const pairs = idx.map((i) => loopsAtStep(r, m, i).map((v) => v.iteration));
    expect(pairs).toEqual([[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2]]);
  });
  it("operands list only names that exist in the frame", () => {
    const i = at(t, 3);
    expect(operandsAt(t, i, "i % 2 == 0 and undefined_name > limit")).toEqual([{ name: "i", value: "0", type: "int" }]);
  });
});

describe.skipIf(!hasPython)("branch views never invent an outcome when the trace is sampled", () => {
  const code = "n = 0\nfor i in range(300):\n    if i % 2 == 0:\n        n += 1\nprint(n)\n";
  const t = trace(code, { loopHead: 2, loopTail: 3 });
  const map = analyzeSource(code);
  it("a condition just before a gap is 'unknown'", () => {
    const g = t.gaps![0];
    // The last recorded step before the gap, if it is a condition line, has no recorded next event.
    const views = t.steps.map((_, i) => branchAtStep(t, map, i)).filter((v) => v !== null);
    expect(views.some((v) => v!.outcome === "unknown")).toBe(true);
    const before = branchAtStep(t, map, g.after);
    expect(t.steps[g.after].line).toBe(3); // the last recorded step before the gap is the condition itself
    expect(before?.outcome).toBe("unknown");
    expect(before?.evidence).toContain("sampled gap");
  });
  it("whole-run counts stay exact even though steps are skipped", () => {
    const stats = branchStats(t, map);
    expect(stats.find((s) => s.construct.line === 3)).toMatchObject({ evaluations: 300, taken: 150, notTaken: 150, exact: true });
    expect(stats.find((s) => s.construct.line === 2)).toMatchObject({ evaluations: 301, taken: 300, finishedNormally: 1 });
  });
  it("the iteration number inside a sampled loop comes from the tracer, never from counting", () => {
    const last = t.steps.length - 1;
    const views = loopsAtStep(t, map, last - 2);
    const v = views[0];
    if (v?.iteration !== undefined) expect(v.iterationSource).toBe("tracer");
  });
});
