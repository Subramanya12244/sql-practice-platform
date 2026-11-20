// NumPy beats (lib/visual/numpyBeats.ts) checked against the REAL numpy: CPython runs the probe and, separately, computes the truth.
// Every number a beat shows is compared with what numpy itself returns, never with a copy of the rule.
import { describe, expect, it } from "vitest";
import { buildDataModel, runDataProbe, type DataModelData } from "../site/lib/visual/dataframe";
import { buildDataBeats, beatAt, type DataBeat } from "../site/lib/visual/dataBeats";
import { storyProblems } from "../site/lib/visual/story";
import { LANE_CAP, MATMUL_CELL_CAP, matOf, numpyBeats, num, type AlignView, type AxisView, type ComputeView, type ExpandView, type LanesView, type MaskView, type MatmulCellView, type MoveView, type ResultView, type SelectView, type ShapesView } from "../site/lib/visual/numpyBeats";
import { pyShape } from "../site/lib/visual/broadcast";
import { cpythonRun, hasDataPython } from "./siteWorkspaceDataPy";

const HEAD = "import numpy as np\n";

async function run(code: string): Promise<{ data: DataModelData; beats: DataBeat[] }> {
  const r = await runDataProbe(code, { run: cpythonRun });
  const data = buildDataModel("numpy", r.probe!, code);
  return { data, beats: buildDataBeats(data) };
}
/** The beats of the stage whose statement contains `text` (the last such stage). */
const stageBeats = (m: { data: DataModelData; beats: DataBeat[] }, text: string): DataBeat[] => {
  const i = m.data.stages.map((s, k) => (s.stmt.includes(text) || s.code.includes(text) ? k : -1)).filter((k) => k >= 0).pop();
  if (i === undefined) throw new Error(`no stage with ${text}`);
  return m.beats.filter((b) => b.stage === i);
};
/** Run python and read the JSON it prints on its last line: the truth from real numpy. */
async function truth<T = any>(code: string): Promise<T> {
  const r = await cpythonRun(`import json\n${code}`, ""); // the empty tests string keeps the helper's wrapper valid
  if (!r.ok) throw new Error(r.error);
  return JSON.parse(r.stdout.trim().split("\n").pop()!) as T;
}
const view = <T,>(b: DataBeat[], type: string): T => b.find((x) => x.view.type === type)!.view as unknown as T;
const views = <T,>(b: DataBeat[], type: string): T[] => b.filter((x) => x.view.type === type).map((x) => x.view as unknown as T);
const titles = (b: DataBeat[]) => b.map((x) => x.title);
/** A recorded cell or a JSON value as a number, for comparing a displayed value with numpy's. */
const n = (x: unknown): number => (typeof x === "boolean" ? Number(x) : x === null ? NaN : typeof x === "number" ? x : (num(x as string) as number));
const close = (a: unknown, b: unknown) => { const x = n(a), y = n(b); return (Number.isNaN(x) && Number.isNaN(y)) || Math.abs(x - y) <= 1e-6 * (1 + Math.abs(y)); };

describe.skipIf(!hasDataPython)("broadcasting: a = [[1],[2],[3]], b = [10, 20, 30], a + b", () => {
  const code = `${HEAD}a = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nresult = a + b\n`;
  it("has exactly the six beats, in order", async () => {
    const m = await run(code);
    const b = stageBeats(m, "result = a + b");
    expect(titles(b)).toEqual(["Arrays", "Shapes", "Align shapes", "Stretch", "Calculate", "Result"]);
    expect(b.map((x) => x.view.type)).toEqual(["arrays", "shapes", "align", "expand", "compute", "result"]);
    expect(b.every((x) => x.view.owner === "numpy")).toBe(true);
    expect(b.map((x) => x.beat)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(b.every((x) => x.of === 6)).toBe(true);
    // the player's steps are every beat of every stage: two array creations (one generic beat each) and the six beats of a + b
    expect(m.beats).toHaveLength(8);
  });
  it("beat 1 draws the real arrays as grids of their real cells", async () => {
    const m = await run(code);
    const arr = view<{ items: { label: string; mat: ReturnType<typeof matOf> }[] }>(stageBeats(m, "result = a + b"), "arrays");
    const t = await truth(`${HEAD}a = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nprint(json.dumps({"a": a.tolist(), "b": b.tolist()}))`);
    expect(arr.items.map((i) => i.label)).toEqual(["A", "B"]);
    expect(arr.items[0].mat!.cells.map((r) => r.map(n))).toEqual(t.a);
    expect(arr.items[1].mat!.cells[0].map(n)).toEqual(t.b);
  });
  it("beat 2 names the shapes, beat 3 pairs the dimensions from the right, beat 4 stretches both to (3, 3)", async () => {
    const m = await run(code);
    const b = stageBeats(m, "result = a + b");
    const t = await truth(`${HEAD}a = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nr = a + b\nprint(json.dumps({"sa": a.shape, "sb": b.shape, "sr": r.shape, "ba": np.broadcast_to(a, r.shape).tolist(), "bb": np.broadcast_to(b, r.shape).tolist()}))`);
    const sh = view<ShapesView>(b, "shapes");
    expect(sh.items.map((i) => i.shape)).toEqual([t.sa, t.sb]);
    expect(sh.items.map((i) => pyShape(i.shape))).toEqual(["(3, 1)", "(3,)"]);
    expect(b[1].story.what).toBe("A has shape (3, 1) and B has shape (3,).");
    const al = view<AlignView>(b, "align");
    expect(al.table.valid).toBe(true);
    expect(al.padded).toEqual([[3, 1], [1, 3]]); // B is treated as (1, 3)
    expect(b[2].story.what).toContain("B (3,) is treated as (1, 3)");
    // Right to left: axis -1 first (A has 1, B has 3: stretch), then axis -2 (A has 3, B is missing: counts as 1).
    expect(al.table.rows.map((r) => [r.fromRight, r.cells.map((c) => c.size), r.cells.map((c) => c.status), r.resultSize])).toEqual([
      [0, [1, 3], ["stretch", "equal"], 3],
      [1, [3, null], ["equal", "missing"], 3],
    ]);
    expect(b[2].story.changed).toContain("axis -1: 1 and 3");
    expect(b[2].story.changed).toContain("axis -2: 3 and 1");
    expect(b[2].story.changed).toContain("Result shape (3, 3)");
    const ex = view<ExpandView>(b, "expand");
    expect(ex.resultShape).toEqual(t.sr);
    expect(ex.items.map((i) => i.to)).toEqual([[3, 3], [3, 3]]);
    // The stretched grids are exactly what numpy's own broadcast_to gives, and the repeated cells are the copies.
    expect(ex.items[0].mat.cells.map((r) => r.map(n))).toEqual(t.ba);
    expect(ex.items[1].mat.cells.map((r) => r.map(n))).toEqual(t.bb);
    expect(ex.items[0].repeated.flat().filter(Boolean)).toHaveLength(6);
    expect(ex.items[1].repeated.flat().filter(Boolean)).toHaveLength(6);
    expect(ex.items[0].repeated.map((r) => r.map(Number))).toEqual([[0, 1, 1], [0, 1, 1], [0, 1, 1]]);
    expect(ex.items[1].repeated.map((r) => r.map(Number))).toEqual([[0, 0, 0], [1, 1, 1], [1, 1, 1]]);
  });
  it("beat 5: the nine calculations are derived from the real operands and equal the real result; beat 6 is the real array", async () => {
    const m = await run(code);
    const b = stageBeats(m, "result = a + b");
    const t = await truth(`${HEAD}a = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nr = a + b\nprint(json.dumps({"r": r.tolist(), "shape": r.shape, "dtype": str(r.dtype), "ba": np.broadcast_to(a, r.shape).tolist(), "bb": np.broadcast_to(b, r.shape).tolist()}))`);
    const c = view<ComputeView>(b, "compute");
    expect(c.ok).toBe(true);
    expect(c.cells).toHaveLength(9);
    for (const cell of c.cells) {
      const [i, j] = cell.coords;
      expect(n(cell.a)).toBe(t.ba[i][j]);
      expect(n(cell.b)).toBe(t.bb[i][j]);
      expect(n(cell.res)).toBe(t.r[i][j]);
      expect(n(cell.a) + n(cell.b)).toBe(t.r[i][j]);
      expect(cell.text).toBe(`${t.ba[i][j]} + ${t.bb[i][j]} = ${t.r[i][j]}`);
    }
    expect(c.cells[0].text).toBe("1 + 10 = 11");
    expect(b[4].story.changed).toContain("1 + 10 = 11");
    const r = view<ResultView>(b, "result");
    expect(r.out.cells.map((row) => row.map(n))).toEqual(t.r);
    expect(r.shape).toEqual(t.shape);
    expect(r.dtype).toBe(t.dtype);
    expect(r.name).toBe("result");
    expect(b[5].story.changed).toContain("(3, 3)");
  });
});

describe.skipIf(!hasDataPython)("other broadcast cases and operators", () => {
  const cases: { name: string; code: string; stmt: string; titles: string[]; op: string }[] = [
    { name: "(2,3) + (3,)", code: `${HEAD}a = np.arange(6).reshape(2, 3)\nb = np.array([10, 20, 30])\nr = a + b\n`, stmt: "r = a + b", titles: ["Arrays", "Shapes", "Align shapes", "Stretch", "Calculate", "Result"], op: "+" },
    { name: "(2,1) * (1,3)", code: `${HEAD}a = np.array([[1], [2]])\nb = np.array([[1, 2, 3]])\nr = a * b\n`, stmt: "r = a * b", titles: ["Arrays", "Shapes", "Align shapes", "Stretch", "Calculate", "Result"], op: "*" },
    { name: "(3,) * scalar", code: `${HEAD}a = np.array([1, 5, 3])\nr = a * 2.5\n`, stmt: "r = a * 2.5", titles: ["Arrays", "Shapes", "Align shapes", "Stretch", "Calculate", "Result"], op: "*" },
    { name: "equal shapes (3,) - (3,): nothing to stretch", code: `${HEAD}a = np.array([5, 7, 9])\nb = np.array([1, 2, 3])\nr = a - b\n`, stmt: "r = a - b", titles: ["Arrays", "Shapes", "Align shapes", "Calculate", "Result"], op: "-" },
    { name: "comparison a > 2", code: `${HEAD}a = np.array([1, 5, 3])\nr = a > 2\n`, stmt: "r = a > 2", titles: ["Arrays", "Shapes", "Align shapes", "Stretch", "Calculate", "Result"], op: ">" },
    { name: "division gives floats", code: `${HEAD}a = np.array([[1, 2], [3, 4]])\nb = np.array([2, 4])\nr = a / b\n`, stmt: "r = a / b", titles: ["Arrays", "Shapes", "Align shapes", "Stretch", "Calculate", "Result"], op: "/" },
    { name: "np.maximum ufunc", code: `${HEAD}a = np.array([[1], [7]])\nb = np.array([3, 4, 5])\nr = np.maximum(a, b)\n`, stmt: "r = np.maximum(a, b)", titles: ["Arrays", "Shapes", "Align shapes", "Stretch", "Calculate", "Result"], op: "maximum" },
    { name: "power with a scalar", code: `${HEAD}a = np.array([1, 2, 3])\nr = a ** 2\n`, stmt: "r = a ** 2", titles: ["Arrays", "Shapes", "Align shapes", "Stretch", "Calculate", "Result"], op: "**" },
  ];
  for (const c of cases) {
    it(`${c.name}: beats, stretched operands and every cell calculation equal numpy`, async () => {
      const m = await run(c.code);
      const b = stageBeats(m, c.stmt);
      expect(titles(b)).toEqual(c.titles);
      const t = await truth(`${c.code.replace(HEAD, HEAD)}\nA = ${varsOf(c.stmt)[0]}\nB = ${varsOf(c.stmt)[1]}\nprint(json.dumps({"r": np.asarray(r).tolist(), "ba": np.broadcast_to(A, np.shape(r)).tolist(), "bb": np.broadcast_to(B, np.shape(r)).tolist(), "shape": list(np.shape(r))}))`);
      const cal = view<ComputeView>(b, "compute");
      expect(cal.ok).toBe(true);
      const at = (g: any, coords: number[]) => coords.reduce((x, k) => x[k], g);
      for (const cell of cal.cells) {
        expect(n(cell.a)).toBe(n(at(t.ba, cell.coords)));
        expect(n(cell.b)).toBe(n(at(t.bb, cell.coords)));
        expect(close(cell.res, at(t.r, cell.coords))).toBe(true);
      }
      expect(cal.cells).toHaveLength(t.shape.reduce((x: number, y: number) => x * y, 1));
      expect(cal.sym).toBe(c.op);
      const res = view<ResultView>(b, "result");
      expect(res.shape).toEqual(t.shape);
      const flat = (g: any): any[] => (Array.isArray(g) ? g.flatMap(flat) : [g]);
      expect(flat(res.out.cells).map(n)).toEqual(flat(t.r).map(n));
      const ex = b.find((x) => x.view.type === "expand")?.view as ExpandView | undefined;
      if (ex) { expect(flat(ex.items[0].mat.cells).map(n)).toEqual(flat(t.ba).map(n)); expect(flat(ex.items[1].mat.cells).map(n)).toEqual(flat(t.bb).map(n)); }
    });
  }
  it("a scalar operand is drawn as one cell, shape () and 'treated as (1,)'", async () => {
    const m = await run(`${HEAD}a = np.array([1, 5, 3])\nr = a * 2.5\n`);
    const b = stageBeats(m, "r = a * 2.5");
    expect(view<ShapesView>(b, "shapes").items.map((i) => pyShape(i.shape))).toEqual(["(3,)", "()"]);
    expect(b[0].story.what).toContain("the scalar 2.5");
    expect(b[2].story.what).toContain("B (a scalar) is treated as (1,)");
  });
  it("a function that has no calculator (np.hypot) still gets its beats but no calculation", async () => {
    const m = await run(`${HEAD}a = np.array([3.0, 5.0])\nb = np.array([4.0, 12.0])\nr = np.hypot(a, b)\n`);
    expect(titles(stageBeats(m, "r = np.hypot"))).toEqual(["Arrays", "Shapes", "Align shapes", "Result"]);
  });
});

/** "r = a * 2.5" -> ["a", "2.5"], "r = np.maximum(a, b)" -> ["a", "b"] (the two operands for numpy's broadcast_to). */
function varsOf(stmt: string): [string, string] {
  const rhs = stmt.split("=").slice(1).join("=").trim();
  const f = /^np\.\w+\((.*)\)$/.exec(rhs);
  const parts = (f ? f[1].split(",") : rhs.split(/ (?:\*\*|[-+*/><]) /)).map((x) => x.trim());
  return [parts[0], parts[1]];
}

describe.skipIf(!hasDataPython)("invalid broadcast: (3, 2) + (4, 2)", () => {
  const code = `${HEAD}a = np.ones((3, 2))\nb = np.ones((4, 2))\nresult = a + b\n`;
  it("arrays, shapes, the conflicting axis, and NumPy's real error; no calculation is drawn", async () => {
    const m = await run(code);
    const b = stageBeats(m, "result = a + b");
    expect(titles(b)).toEqual(["Arrays", "Shapes", "Conflict", "NumPy's error"]);
    expect(b.some((x) => ["compute", "expand", "result"].includes(x.view.type))).toBe(false);
    const real = await truth(`${HEAD}a = np.ones((3, 2))\nb = np.ones((4, 2))\ntry:\n    a + b\nexcept Exception as e:\n    print(json.dumps({"type": type(e).__name__, "msg": str(e)}))`);
    const al = view<AlignView>(b, "align");
    expect(al.table.valid).toBe(false);
    expect(al.table.conflicts).toHaveLength(1);
    expect(al.table.conflicts[0].axisNegative).toBe(-2);
    expect(al.table.conflicts[0].sizes.map((s) => s.size)).toEqual([3, 4]);
    expect(al.table.rows.map((r) => r.status)).toEqual(["equal", "incompatible"]);
    expect(b[2].story.what).toContain("axis -2");
    expect(b[2].story.what).toContain("A has 3 and B has 4");
    expect(b[2].story.what).toContain("neither is 1");
    const err = b[3].view as unknown as { errorType: string; message: string; reason: string };
    expect(err.errorType).toBe(real.type);
    expect(err.message).toBe(real.msg); // NumPy's real text, verbatim
    expect(b[3].story.changed).toContain(real.msg.trim());
    expect(err.reason).toBe("axis -2: A has 3, B has 4");
    expect(b[3].story.why).toContain("axis -2");
    expect(b[3].story.why).toContain("3 and 4");
  });
  it("a missing leading axis and a conflict on an earlier axis: (2, 3) + (4,) names axis -1", async () => {
    const m = await run(`${HEAD}a = np.ones((2, 3))\nb = np.ones(4)\nc = a + b\n`);
    const b = stageBeats(m, "c = a + b");
    expect(titles(b)).toEqual(["Arrays", "Shapes", "Conflict", "NumPy's error"]);
    expect(view<AlignView>(b, "align").table.conflicts[0].axisNegative).toBe(-1);
    expect(b[2].story.what).toContain("A has 3 and B has 4");
    expect(b[2].story.changed).toContain("axis -2");
  });
  it("a non-broadcast error (TypeError) is left to the generic beat", async () => {
    const m = await run(`${HEAD}a = np.array([1, 2])\nr = a + "x"\n`);
    const b = m.beats.filter((x) => x.view.owner === "numpy" && x.view.type === "compute");
    expect(b).toHaveLength(0);
  });
});

describe.skipIf(!hasDataPython)("a disagreeing calculation is never drawn", () => {
  it("corrupting one recorded result cell gives a visible consistency failure and no formulas", async () => {
    const m = await run(`${HEAD}a = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nresult = a + b\n`);
    const i = m.data.stages.length - 1;
    const st = JSON.parse(JSON.stringify(m.data.stages[i]));
    st.output.data[1][1] = "999";
    const beats = numpyBeats(st, m.data.analyses[i], i)!;
    const c = view<ComputeView>(beats, "compute");
    expect(c.ok).toBe(false);
    expect(c.cells).toEqual([]);
    expect(c.problems[0]).toContain("999");
    expect(beats.find((x) => x.view.type === "compute")!.story.what).toMatch(/did not match/);
    expect(storyProblems(beats.find((x) => x.view.type === "compute")!.story)).toEqual([]);
  });
  it("an operand cell that cannot be read as a number leaves the calculation out", async () => {
    const m = await run(`${HEAD}a = np.array([1, 2])\nb = np.array([3, 4])\nr = a + b\n`);
    const i = m.data.stages.length - 1;
    const st = JSON.parse(JSON.stringify(m.data.stages[i]));
    st.inputs[0].data[0] = "oops";
    expect(titles(numpyBeats(st, m.data.analyses[i], i)!)).not.toContain("Calculate");
  });
});

describe.skipIf(!hasDataPython)("matrix multiplication", () => {
  const code = `${HEAD}a = np.arange(6).reshape(2, 3)\nb = np.arange(6).reshape(3, 2)\nr = a @ b\n`;
  it("(2,3) @ (3,2): arrays, rule, one beat per output cell with its row, column, products and sum, then the result", async () => {
    const m = await run(code);
    const b = stageBeats(m, "r = a @ b");
    expect(titles(b)).toEqual(["Arrays", "Rule", "Cell [0, 0]", "Cell [0, 1]", "Cell [1, 0]", "Cell [1, 1]", "Result"]);
    const t = await truth(`${HEAD}a = np.arange(6).reshape(2, 3)\nb = np.arange(6).reshape(3, 2)\nr = a @ b\nprint(json.dumps({"a": a.tolist(), "b": b.tolist(), "r": r.tolist(), "shape": r.shape}))`);
    const cells = views<MatmulCellView>(b, "mm-cell");
    expect(cells).toHaveLength(4);
    for (const c of cells) {
      const [i, j] = c.outCoords;
      expect(c.row).toBe(i);
      expect(c.col).toBe(j);
      expect(c.aVals.map(n)).toEqual(t.a[i]);
      expect(c.bVals.map(n)).toEqual(t.b.map((r: number[]) => r[j]));
      expect(c.products.map(Number)).toEqual(t.a[i].map((x: number, k: number) => x * t.b[k][j]));
      expect(c.products.map(Number).reduce((x, y) => x + y, 0)).toBe(t.r[i][j]);
      expect(n(c.sum)).toBe(t.r[i][j]);
      expect(c.ok).toBe(true);
      expect(c.sampled).toBe(false);
    }
    expect(cells[1].done).toEqual([[0, 0]]); // earlier cells are already filled in this beat
    expect(b[3].story.changed).toBe("0 × 1 + 1 × 3 + 2 × 5 = 0 + 3 + 10 = 13. This equals NumPy's real result cell.");
    expect(b[1].story.changed).toContain("(2, 3) @ (3, 2) → (2, 2)");
    const res = view<ResultView>(b, "result");
    expect(res.out.cells.map((r) => r.map(n))).toEqual(t.r);
    expect(res.shape).toEqual(t.shape);
  });
  it("beyond the cap the beats are a labelled sample of the output cells", async () => {
    const m = await run(`${HEAD}a = np.arange(16).reshape(4, 4)\nb = np.arange(16).reshape(4, 4)\nr = a @ b\n`);
    const b = stageBeats(m, "r = a @ b");
    const cells = views<MatmulCellView>(b, "mm-cell");
    expect(MATMUL_CELL_CAP).toBe(6);
    expect(cells).toHaveLength(MATMUL_CELL_CAP);
    expect(cells.every((c) => c.sampled && c.total === 16 && c.seqOf === 6)).toBe(true);
    expect(b[2].story.what).toContain("Sampled: 1 of the first 6 cells shown, 16 in all");
    expect(b[b.length - 1].story.changed).toContain("Only 6 of the 16 cells were walked through");
    const t = await truth(`${HEAD}a = np.arange(16).reshape(4, 4)\nr = a @ a\nprint(json.dumps(r.tolist()))`);
    for (const c of cells) expect(n(c.sum)).toBe(t[c.outCoords[0]][c.outCoords[1]]);
  });
  it("1-D cases: vector @ vector is one number, matrix @ vector is a vector", async () => {
    const m = await run(`${HEAD}u = np.array([1, 2, 3])\nv = np.array([4, 5, 6])\nd = u @ v\nM = np.array([[1, 2, 3], [4, 5, 6]])\ne = M @ v\n`);
    const d = stageBeats(m, "d = u @ v");
    expect(titles(d)).toEqual(["Arrays", "Rule", "Cell", "Result"]);
    const cell = view<MatmulCellView>(d, "mm-cell");
    expect(cell.products).toEqual(["4", "10", "18"]);
    expect(n(cell.sum)).toBe(32);
    const e = stageBeats(m, "e = M @ v");
    const cells = views<MatmulCellView>(e, "mm-cell");
    const t = await truth(`${HEAD}M = np.array([[1, 2, 3], [4, 5, 6]])\nv = np.array([4, 5, 6])\nprint(json.dumps((M @ v).tolist()))`);
    expect(cells.map((c) => n(c.sum))).toEqual(t);
    expect(cells.map((c) => c.row)).toEqual([0, 1]);
    expect(cells.every((c) => c.col === null)).toBe(true);
  });
  it("np.dot and np.matmul use the same sequence", async () => {
    const m = await run(`${HEAD}a = np.ones((2, 2))\nb = np.ones((2, 2))\nx = np.dot(a, b)\ny = np.matmul(a, b)\n`);
    expect(titles(stageBeats(m, "x = np.dot(a, b)")).slice(0, 2)).toEqual(["Arrays", "Rule"]);
    expect(titles(stageBeats(m, "y = np.matmul(a, b)"))).toHaveLength(7);
  });
  it("invalid (2,3) @ (2,3): the inner sizes 3 and 2 are named and NumPy's real error is shown; no multiplication is drawn", async () => {
    const m = await run(`${HEAD}a = np.ones((2, 3))\nb = np.ones((2, 3))\nr = a @ b\n`);
    const b = stageBeats(m, "r = a @ b");
    expect(titles(b)).toEqual(["Arrays", "Inner sizes differ", "NumPy's error"]);
    const rule = view<{ inner: { a: number; b: number }; valid: boolean }>(b, "mm-rule");
    expect(rule.valid).toBe(false);
    expect(rule.inner).toEqual({ a: 3, b: 2 });
    expect(b[1].story.what).toContain("3 columns");
    expect(b[1].story.what).toContain("2 rows");
    expect(b.some((x) => x.view.type === "mm-cell")).toBe(false);
    const real = await truth(`${HEAD}a = np.ones((2, 3))\ntry:\n    a @ a\nexcept Exception as e:\n    print(json.dumps(str(e)))`);
    expect((b[2].view as unknown as { message: string }).message).toBe(real);
    expect(b[2].story.changed).toContain("size 2 is different from 3");
  });
  it("a windowed output keeps exact numbers in the story; an inner size larger than the window has no per-cell beats", async () => {
    const big = await run(`${HEAD}a = np.arange(24).reshape(12, 2)\nb = np.arange(24).reshape(2, 12)\nr = a @ b\n`);
    const b = stageBeats(big, "r = a @ b");
    const cells = views<MatmulCellView>(b, "mm-cell");
    expect(cells).toHaveLength(6);
    expect(cells[0].total).toBe(144);
    expect(b[b.length - 1].story.changed).toContain("144");
    expect(b[b.length - 1].story.changed).toContain("10 × 10");
    const wide = await run(`${HEAD}a = np.ones((2, 12))\nb = np.ones((12, 2))\nr = a @ b\n`);
    const w = stageBeats(wide, "r = a @ b");
    expect(titles(w)).toEqual(["Arrays", "Rule", "Result"]);
    expect(w[1].story.changed).toContain("12 products");
  });
});

describe.skipIf(!hasDataPython)("axis reductions", () => {
  const A = "a = np.arange(6).reshape(2, 3)";
  const cases: { stmt: string; code: string; axis: number[] | null; keepdims: boolean; op: string }[] = [
    { stmt: "r0 = a.sum(axis=0)", code: "r0 = a.sum(axis=0)", axis: [0], keepdims: false, op: "sum" },
    { stmt: "r1 = a.sum(axis=1)", code: "r1 = a.sum(axis=1)", axis: [1], keepdims: false, op: "sum" },
    { stmt: "r2 = a.sum()", code: "r2 = a.sum()", axis: null, keepdims: false, op: "sum" },
    { stmt: "r3 = np.mean(a, axis=1, keepdims=True)", code: "r3 = np.mean(a, axis=1, keepdims=True)", axis: [1], keepdims: true, op: "mean" },
    { stmt: "r4 = a.max(axis=0, keepdims=True)", code: "r4 = a.max(axis=0, keepdims=True)", axis: [0], keepdims: true, op: "max" },
    { stmt: "r5 = a.prod(axis=1)", code: "r5 = a.prod(axis=1)", axis: [1], keepdims: false, op: "prod" },
    { stmt: "r6 = np.min(a)", code: "r6 = np.min(a)", axis: null, keepdims: false, op: "min" },
  ];
  for (const c of cases) {
    it(`${c.stmt}: the reduced axis and the values of every output element equal numpy`, async () => {
      const m = await run(`${HEAD}${A}\n${c.code}\n`);
      const b = stageBeats(m, c.stmt);
      expect(titles(b)).toEqual(["Array", "Axis", "Groups", "Result"]);
      const ax = view<AxisView>(b, "axis");
      expect(ax.axis).toEqual(c.axis);
      expect(ax.keepdims).toBe(c.keepdims);
      expect(ax.inShape).toEqual([2, 3]);
      const t = await truth(`${HEAD}${A}\n${c.code}\nr = ${c.code.split("=").slice(1).join("=").trim()}\nax = ${c.axis === null ? "None" : c.axis[0]}\nkd = ${c.keepdims ? "True" : "False"}\nout = np.asarray(r)\nlanes = []\nfor o in np.ndindex(*out.shape):\n    if ax is None: v = a.ravel().tolist()\n    else:\n        it = iter(o)\n        idx = tuple(slice(None) if d == ax else (o[d] if kd else next(it)) for d in range(a.ndim))\n        v = np.asarray(a[idx]).ravel().tolist()\n    lanes.append({"o": list(o), "v": v, "r": out[o].item()})\nprint(json.dumps({"shape": list(out.shape), "lanes": lanes}))`);
      expect(ax.outShape).toEqual(t.shape);
      const lanes = view<LanesView>(b, "lanes");
      expect(lanes.ok).toBe(true);
      expect(lanes.lanes).toHaveLength(t.lanes.length);
      for (const [k, l] of lanes.lanes.entries()) {
        expect(l.out).toEqual(t.lanes[k].o);
        expect(l.values.map(n)).toEqual(t.lanes[k].v);
        expect(close(l.result, t.lanes[k].r)).toBe(true);
      }
      // Cells of one lane share one group number, different lanes have different ones: the colouring follows the axis.
      const groupOfCoord = (co: number[]) => ax.groups[co[0]][co[1]];
      for (const l of lanes.lanes) expect(new Set(l.coords.map(groupOfCoord)).size).toBe(1);
      expect(new Set(lanes.lanes.map((l) => groupOfCoord(l.coords[0]))).size).toBe(lanes.lanes.length);
      expect(ax.groupCount).toBe(lanes.lanes.length);
      const res = view<ResultView>(b, "result");
      expect(res.shape).toEqual(t.shape);
      expect(res.out.cells.flat().map(n)).toEqual(t.lanes.map((l: { r: number }) => l.r));
    });
  }
  it("the story names the collapsing axis", async () => {
    const m = await run(`${HEAD}${A}\nr0 = a.sum(axis=0)\nr1 = a.sum(axis=1)\n`);
    expect(stageBeats(m, "r0 = ")[1].story.what).toContain("axis 0 (down the rows): each column becomes one number");
    expect(stageBeats(m, "r1 = ")[1].story.what).toContain("axis 1 (across the columns): each row becomes one number");
    expect(stageBeats(m, "r0 = ")[1].story.changed).toContain("(2, 3) → (3,)");
  });
  it("1-D arrays, floats and the other reducers (any, all, std, var, median) are checked the same way", async () => {
    const m = await run(`${HEAD}x = np.array([1.5, 2.5, 4.0, 8.0])\ns = x.sum()\nm = x.mean()\nsd = x.std()\nv = x.var()\nmd = np.median(x)\nb = np.array([True, False, True])\nan = b.any()\nal = b.all()\n`);
    for (const stmt of ["s = x.sum()", "m = x.mean()", "sd = x.std()", "v = x.var()", "md = np.median(x)", "an = b.any()", "al = b.all()"]) {
      const bb = stageBeats(m, stmt);
      expect(titles(bb), stmt).toEqual(["Array", "Axis", "Groups", "Result"]);
      expect(view<LanesView>(bb, "lanes").ok, stmt).toBe(true);
    }
    expect(view<LanesView>(stageBeats(m, "an = b.any()"), "lanes").lanes[0].values).toEqual(["True", "False", "True"]);
  });
  it("a reduction whose lane is larger than the recorded window has no 'Groups' beat but exact numbers", async () => {
    const m = await run(`${HEAD}a = np.arange(14 * 12).reshape(14, 12)\nr = a.sum(axis=0)\n`);
    const b = stageBeats(m, "r = a.sum(axis=0)");
    expect(titles(b)).toEqual(["Array", "Axis", "Result"]);
    expect(b[0].story.what).toContain("(14, 12)");
    expect(b[0].story.changed).toContain("168 values");
    expect(view<AxisView>(b, "axis").input.windowed).toBe(true);
    expect(b[2].story.changed).toContain("(14, 12) → (12,)");
  });
  it("the output elements listed are the ones whose whole group is recorded, and the beat says how many exist", async () => {
    const m = await run(`${HEAD}a = np.arange(40).reshape(2, 20)\nr = a.sum(axis=0)\n`);
    const l = view<LanesView>(stageBeats(m, "r = a.sum(axis=0)"), "lanes");
    expect(LANE_CAP).toBeGreaterThanOrEqual(10); // a 2-D window has at most 10 columns, so the cap is a safety bound
    expect(l.lanes).toHaveLength(10); // the recorded window has 10 of the 20 columns
    expect(l.total).toBe(20);
    expect(l.sampled).toBe(true);
    const t = await truth(`${HEAD}a = np.arange(40).reshape(2, 20)\nprint(json.dumps(a.sum(axis=0).tolist()))`);
    expect(l.lanes.map((x) => n(x.result))).toEqual(t.slice(0, 10));
    expect(stageBeats(m, "r = a.sum(axis=0)")[2].story.changed).toContain("10 of 20 elements listed");
  });
  it("ddof is not modelled: std(ddof=1) uses the generic beat", async () => {
    const m = await run(`${HEAD}x = np.array([1.0, 2.0, 4.0])\nr = x.std(ddof=1)\n`);
    expect(stageBeats(m, "r = x.std")[0].view.owner).toBe("generic");
  });
});

describe.skipIf(!hasDataPython)("indexing, slicing and masks", () => {
  const A = "a = np.arange(12).reshape(3, 4)";
  const sel = (b: DataBeat[]) => view<SelectView>(b, "select");
  it("a basic slice: the highlighted cells are exactly the cells numpy selects", async () => {
    const m = await run(`${HEAD}${A}\nb = a[1:, ::2]\n`);
    const b = stageBeats(m, "b = a[1:, ::2]");
    expect(titles(b)).toEqual(["Array", "Selection", "Result"]);
    const t = await truth(`${HEAD}${A}\nidx = np.arange(12).reshape(3, 4)[1:, ::2]\nprint(json.dumps({"cells": [[int(i // 4), int(i % 4)] for i in idx.ravel()], "val": a[1:, ::2].tolist(), "shape": list(a[1:, ::2].shape), "view": bool(a[1:, ::2].base is not None)}))`);
    expect(sel(b).mode).toBe("basic");
    expect(sel(b).selected).toEqual(t.cells);
    expect(sel(b).count).toBe(4);
    expect(sel(b).total).toBe(12);
    const res = view<ResultView>(b, "result");
    expect(res.out.cells.map((r) => r.map(n))).toEqual(t.val);
    expect(res.memory).toBe(t.view ? "view" : "copy");
    // each result cell points at the input cell numpy took it from
    res.origins!.forEach((row, r) => row.forEach((o, c) => expect(o).toEqual(t.cells[r * 2 + c])));
    expect(b[1].story.changed).toContain("[1, 0], [1, 2], [2, 0], [2, 2]");
    expect(b[2].story.changed).toContain("4, 6, 8, 10 from [1, 0], [1, 2], [2, 0], [2, 2]");
  });
  it("a boolean mask: the mask is its own beat and the selected cells are where it is True", async () => {
    const m = await run(`${HEAD}${A}\nc = a[a > 5]\n`);
    const b = stageBeats(m, "c = a[a > 5]");
    expect(titles(b)).toEqual(["Array", "Mask", "Selection", "Result"]);
    const t = await truth(`${HEAD}${A}\nmk = a > 5\nprint(json.dumps({"true": np.argwhere(mk).tolist(), "mask": mk.tolist(), "val": a[mk].tolist(), "n": int(mk.sum())}))`);
    const mask = view<MaskView>(b, "mask");
    expect(mask.mask.cells.map((r) => r.map((x) => x === "True"))).toEqual(t.mask);
    expect(mask.trueCount).toBe(t.n);
    expect(sel(b).mode).toBe("mask");
    expect(sel(b).selected).toEqual(t.true);
    expect(view<ResultView>(b, "result").out.cells[0].map(n)).toEqual(t.val);
    expect(view<ResultView>(b, "result").memory).toBe("copy");
    expect(b[1].story.what).toContain("a > 5");
    expect(b[1].story.changed).toContain("6 entries of 12 are True");
  });
  it("one element, one column and fancy (list) indexing", async () => {
    const m = await run(`${HEAD}${A}\nd = a[1, 2]\ne = a[:, 1]\nf = a[[0, 2]]\n`);
    const d = stageBeats(m, "d = a[1, 2]");
    expect(sel(d).mode).toBe("element");
    expect(sel(d).selected).toEqual([[1, 2]]);
    expect(view<ResultView>(d, "result").out.cells[0][0]).toBe("6");
    const e = stageBeats(m, "e = a[:, 1]");
    expect(sel(e).selected).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(view<ResultView>(e, "result").out.cells[0].map(n)).toEqual([1, 5, 9]);
    const f = stageBeats(m, "f = a[[0, 2]]");
    expect(sel(f).mode).toBe("fancy");
    expect(sel(f).selected).toEqual([0, 1, 2, 3].map((c) => [0, c]).concat([0, 1, 2, 3].map((c) => [2, c])));
    expect(view<ResultView>(f, "result").memory).toBe("copy");
  });
  it("1-D slices and a window of a big array: the picture is labelled a window, the counts stay exact", async () => {
    const m = await run(`${HEAD}x = np.arange(20)\ny = x[2:20:3]\nz = x[x % 2 == 0]\n`);
    const y = stageBeats(m, "y = x[2:20:3]");
    expect(sel(y).selected).toEqual([[2], [5], [8], [11]]); // 14, 17 lie beyond the 12-value window
    expect(sel(y).count).toBe(6);
    expect(sel(y).input.windowed).toBe(true);
    expect(y[0].story.changed).toContain("20 values");
    expect(y[1].story.what).toContain("6 of the 20 cells");
    const z = stageBeats(m, "z = x[x % 2 == 0]");
    expect(titles(z)).toEqual(["Array", "Mask", "Selection", "Result"]);
    expect(sel(z).count).toBe(10);
    expect(view<ResultView>(z, "result").shape).toEqual([10]);
  });
  it("a selection that disagrees with the recorded result is flagged, not highlighted", async () => {
    const m = await run(`${HEAD}${A}\nb = a[1:, ::2]\n`);
    const i = m.data.stages.length - 1;
    const st = JSON.parse(JSON.stringify(m.data.stages[i]));
    st.output.data[0][0] = "77";
    const beats = numpyBeats(st, m.data.analyses[i], i)!;
    expect(sel(beats).ok).toBe(false);
    expect(sel(beats).selected).toEqual([]);
    expect(beats.find((x) => x.view.type === "select")!.story.what).toMatch(/did not match/);
  });
});

describe.skipIf(!hasDataPython)("reshape, flatten and transpose", () => {
  const code = `${HEAD}a = np.arange(6)\nb = a.reshape(2, 3)\nc = b.T\nd = b.flatten()\ne = b.ravel()\nf = np.transpose(b)\ng = np.reshape(a, (3, 2))\n`;
  const mv = (b: DataBeat[]) => view<MoveView>(b, "move");
  it("reshape: the same elements in the same order; every cell's source and destination are the real ones", async () => {
    const m = await run(code);
    for (const [stmt, shape] of [["b = a.reshape(2, 3)", [2, 3]], ["g = np.reshape(a, (3, 2))", [3, 2]]] as const) {
      const b = stageBeats(m, stmt);
      expect(titles(b)).toEqual(["Array", "Regroup", "Result"]);
      const t = await truth(`${HEAD}a = np.arange(6)\nsrc = np.arange(6).reshape${JSON.stringify(shape).replace("[", "(").replace("]", ")")}\nprint(json.dumps({"src": src.tolist(), "val": a.reshape(src.shape).tolist(), "view": bool(a.reshape(src.shape).base is not None)}))`);
      const v = mv(b);
      expect(v.orderPreserved).toBe(true);
      expect(v.moves).toHaveLength(6);
      for (const mo of v.moves) {
        expect(mo.flat).toBe(t.src[mo.to[0]][mo.to[1]]); // numpy's own position of the element
        expect(mo.from).toEqual([mo.flat]); // 1-D input: the position is the flat index
        expect(n(mo.value)).toBe(t.val[mo.to[0]][mo.to[1]]);
      }
      expect(view<ResultView>(b, "result").memory).toBe(t.view ? "view" : "copy");
      expect(b[1].story.changed).toContain("0, 1, 2, 3, 4, 5");
    }
  });
  it("transpose (.T and np.transpose): each cell moves from [r, c] to [c, r]; view not copy", async () => {
    const m = await run(code);
    for (const stmt of ["c = b.T", "f = np.transpose(b)"]) {
      const b = stageBeats(m, stmt);
      expect(titles(b)).toEqual(["Array", "Swap axes", "Result"]);
      const t = await truth(`${HEAD}b = np.arange(6).reshape(2, 3)\nsrc = np.arange(6).reshape(2, 3).T\nprint(json.dumps({"src": src.tolist(), "val": b.T.tolist(), "shape": list(b.T.shape)}))`);
      const v = mv(b);
      expect(v.swapped).toBe(true);
      expect(v.moves).toHaveLength(6);
      for (const mo of v.moves) {
        expect(mo.flat).toBe(t.src[mo.to[0]][mo.to[1]]);
        expect(mo.from).toEqual([Math.floor(mo.flat / 3), mo.flat % 3]); // the real source position in the (2, 3) array
        expect(mo.from).toEqual([mo.to[1], mo.to[0]]);
        expect(n(mo.value)).toBe(t.val[mo.to[0]][mo.to[1]]);
      }
      expect(view<ResultView>(b, "result").shape).toEqual(t.shape);
      expect(view<ResultView>(b, "result").memory).toBe("view");
      expect(b[1].story.what).toContain("(2, 3) → (3, 2)");
      expect(b[1].story.changed).toContain("moves to");
    }
  });
  it("flatten copies and ravel is a view, and the story says which", async () => {
    const m = await run(code);
    const d = stageBeats(m, "d = b.flatten()"), e = stageBeats(m, "e = b.ravel()");
    expect(view<ResultView>(d, "result").memory).toBe("copy");
    expect(view<ResultView>(e, "result").memory).toBe("view");
    expect(d[2].story.changed).toContain("a copy");
    expect(e[2].story.changed).toContain("a view");
    const t = await truth(`${HEAD}b = np.arange(6).reshape(2, 3)\nprint(json.dumps({"src": np.arange(6).reshape(2, 3).ravel().tolist()}))`);
    expect(mv(e).moves.map((x) => x.flat)).toEqual(t.src);
    expect(mv(e).moves.map((x) => x.from)).toEqual(t.src.map((f: number) => [Math.floor(f / 3), f % 3]));
  });
  it("a window of a big array: sources are exact positions in the full shape", async () => {
    const m = await run(`${HEAD}a = np.arange(120)\nb = a.reshape(10, 12)\nc = b.T\n`);
    const r = stageBeats(m, "b = a.reshape(10, 12)");
    const v = mv(r);
    expect(v.out.windowed).toBe(true); // 10 x 12 recorded as 10 x 10
    expect(v.moves).toHaveLength(100);
    expect(v.moves.every((x) => x.flat === x.to[0] * 12 + x.to[1])).toBe(true);
    expect(r[2].story.changed).toContain("120 elements");
    const t = stageBeats(m, "c = b.T");
    expect(mv(t).moves.every((x) => x.from[0] === x.to[1] && x.from[1] === x.to[0])).toBe(true);
    expect(mv(t).moves.every((x) => x.flat === x.from[0] * 12 + x.from[1])).toBe(true);
  });
  it("3-D arrays use the generic beat (documented)", async () => {
    const m = await run(`${HEAD}a = np.arange(24).reshape(2, 3, 4)\nb = a.T\nc = a + 1\n`);
    expect(m.beats.filter((x) => x.stage >= 1).every((x) => x.view.owner === "generic")).toBe(true);
  });
});

describe.skipIf(!hasDataPython)("every story, windows, purity and the step count", () => {
  const programs = [
    `${HEAD}a = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nresult = a + b\n`,
    `${HEAD}a = np.ones((3, 2))\nb = np.ones((4, 2))\nresult = a + b\n`,
    `${HEAD}a = np.arange(6).reshape(2, 3)\nb = np.arange(6).reshape(3, 2)\nr = a @ b\nbad = a @ a\n`,
    `${HEAD}a = np.arange(6).reshape(2, 3)\nr0 = a.sum(axis=0)\nr1 = np.mean(a, axis=1, keepdims=True)\nr2 = a.sum()\nr3 = a.max(axis=1)\n`,
    `${HEAD}a = np.arange(12).reshape(3, 4)\nb = a[1:, ::2]\nc = a[a > 5]\nd = a[1, 2]\nf = a[[0, 2]]\n`,
    `${HEAD}a = np.arange(6)\nb = a.reshape(2, 3)\nc = b.T\nd = b.flatten()\n`,
    `${HEAD}a = np.arange(14 * 12).reshape(14, 12)\nb = np.arange(12)\nr = a + b\ns = a.sum(axis=0)\nt = a[::3, ::5]\nu = a > 100\n`,
    `${HEAD}a = np.array([1.5, np.nan, 3.0])\nr = a + 1\ns = a.sum()\nt = a > 2\n`,
  ];
  it("(h) every beat of every program has a complete story that passes storyProblems", async () => {
    let numpyBeatCount = 0;
    for (const code of programs) {
      const m = await run(code);
      for (const b of m.beats) {
        expect(storyProblems(b.story), `${b.id} ${b.title}`).toEqual([]);
        if (b.view.owner === "numpy") numpyBeatCount++;
      }
    }
    expect(numpyBeatCount).toBeGreaterThan(60);
  });
  it("(i) a window is labelled as a window while the numbers in the stories stay exact", async () => {
    const m = await run(programs[6]);
    const b = stageBeats(m, "r = a + b");
    const arr = view<{ items: { mat: { windowed: boolean; shape: number[]; shown: number[] } }[] }>(b, "arrays");
    expect(arr.items[0].mat.windowed).toBe(true);
    expect(arr.items[0].mat.shown).toEqual([10, 10]);
    expect(arr.items[0].mat.shape).toEqual([14, 12]);
    expect(arr.items[1].mat.windowed).toBe(false); // (12,) is recorded whole: the 1-D window is 12 values
    expect(b[0].story.changed).toContain("168 values");
    expect(b[0].story.changed).toContain("12 values");
    const c = view<ComputeView>(b, "compute");
    expect(c.cells).toHaveLength(100);
    expect(c.total).toBe(168);
    expect(b[4].story.changed).toContain("of 168 (the window drawn)");
    expect(b[5].story.changed).toContain("168 elements");
    expect(view<ResultView>(b, "result").out.windowed).toBe(true);
    const t = await truth(`${HEAD}a = np.arange(14 * 12).reshape(14, 12)\nb = np.arange(12)\nr = a + b\nprint(json.dumps(r[:10, :10].tolist()))`);
    expect(c.cells.every((x) => n(x.res) === t[x.coords[0]][x.coords[1]])).toBe(true);
  });
  it("(i) missing values and floats are shown as they are and never break a story", async () => {
    const m = await run(programs[7]);
    const b = stageBeats(m, "r = a + 1");
    const c = view<ComputeView>(b, "compute");
    expect(c.ok).toBe(true);
    expect(c.cells[1].text).toBe("NaN + 1 = NaN");
    expect(b[4].story.changed).not.toMatch(/nan/i);
    const s = stageBeats(m, "s = a.sum()");
    expect(view<LanesView>(s, "lanes").ok).toBe(true);
  });
  it("(j) beats are pure: building twice gives identical beats, the stage is never changed, and the player clamps", async () => {
    const m = await run(programs[2]);
    const before = JSON.stringify(m.data.stages);
    const again = buildDataBeats(m.data);
    expect(JSON.stringify(again)).toBe(JSON.stringify(m.beats));
    expect(JSON.stringify(m.data.stages)).toBe(before);
    const idx = m.data.stages.length - 1;
    expect(JSON.stringify(numpyBeats(m.data.stages[idx], m.data.analyses[idx], idx))).toBe(JSON.stringify(numpyBeats(m.data.stages[idx], m.data.analyses[idx], idx)));
    // Previous / Next / Reset are index moves over the same array: the same index is the same beat object, whatever came before.
    const walk = [0, 3, 5, 2, 3, 0, 5, 5, 3];
    const seen = new Map<number, DataBeat>();
    for (const s of walk) { const bt = beatAt(m.beats, s)!; if (seen.has(s)) expect(bt).toBe(seen.get(s)); seen.set(s, bt); }
    expect(beatAt(m.beats, -3)).toBe(m.beats[0]);
    expect(beatAt(m.beats, 999)).toBe(m.beats[m.beats.length - 1]);
  });
  it("(l) buildDataBeats(...).length is what the adapter reports as model.steps", async () => {
    const { createDataAdapter } = await import("../site/workspace/adapters/data");
    const a = createDataAdapter("numpy", { runner: cpythonRun });
    const code = programs[0];
    const ctx = { exercise: { id: "authored:n", domain: "numpy", source: { kind: "authored", id: "n" }, title: "t", difficulty: "Easy", topic: "numpy", statement: "", objectives: [], concepts: [], starterCode: "", validation: { kind: "none" }, hints: [] } } as never;
    const out = await a.run(code, ctx);
    const vm = await a.visualize!(code, out, ctx);
    expect(vm!.steps).toBe(buildDataBeats(vm!.data as DataModelData).length);
    expect(vm!.steps).toBe(2 + 6); // two array creations (generic) + the six beats of a + b
  });
  it("matOf refuses what it cannot draw honestly: 3-D arrays and other values", async () => {
    const m = await run(`${HEAD}a = np.zeros((2, 2, 2))\n`);
    expect(matOf(m.data.stages[0].output)).toBeNull();
    expect(matOf(null)).toBeNull();
  });
});
