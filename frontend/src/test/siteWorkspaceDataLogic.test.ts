// @vitest-environment node
// Pure logic of the pandas / NumPy stage view: shape arithmetic, cross-checks, positions, seeds, grids. No Python needed.
import { describe, expect, it } from "vitest";
import { alignShapes, crossCheckBroadcast, crossCheckMatmul, numpyShape, operandIndex, parseBroadcastError, planMatmul, pyShape } from "../site/lib/visual/broadcast";
import { axisLabel, ndPlanes, predictReduceShape, reduceTarget, seedInfo, unravel } from "../site/lib/visual/ndarray";
import { analyzeStage, gridOfSnap, rowMarks, stageTitle, type DataSnap, type DataStage } from "../site/lib/visual/dataframe";
import { diffGrids } from "../site/lib/visual/dataDiff";
import { compareWithExpectation } from "../site/workspace/adapters/data/failure";

describe("broadcasting rule (shapes in, alignment table out)", () => {
  it("aligns on the right and marks equal, stretched, missing", () => {
    const t = alignShapes([[2, 3], [3]]);
    expect(t.valid).toBe(true);
    expect(t.resultShape).toEqual([2, 3]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toMatchObject({ fromRight: 0, outAxis: 1, resultSize: 3, status: "equal" });
    expect(t.rows[0].cells.map((c) => c.status)).toEqual(["equal", "equal"]);
    expect(t.rows[1].cells.map((c) => [c.size, c.status])).toEqual([[2, "equal"], [null, "missing"]]);
    expect(t.rows[1].status).toBe("stretched");
    expect(t.message).toBe("Shapes (2,3) and (3,) are compatible. The result has shape (2,3).");
  });
  it("a size of 1 stretches in both directions", () => {
    const t = alignShapes([[4, 1], [1, 5]]);
    expect(t.resultShape).toEqual([4, 5]);
    expect(t.rows.map((r) => r.cells.map((c) => c.status))).toEqual([["stretch", "equal"], ["equal", "stretch"]]);
  });
  it("scalars, empty axes and three operands", () => {
    expect(alignShapes([[2, 3], []]).resultShape).toEqual([2, 3]);
    expect(alignShapes([[], []]).resultShape).toEqual([]);
    expect(alignShapes([[2, 1], [1, 3], [3]]).resultShape).toEqual([2, 3]);
    expect(alignShapes([[0, 3], [1, 3]]).resultShape).toEqual([0, 3]);
    expect(alignShapes([[0], [3]]).valid).toBe(false);
  });
  it("invalid: names the exact conflicting dimensions", () => {
    const t = alignShapes([[2, 3], [4]]);
    expect(t.valid).toBe(false);
    expect(t.resultShape).toBeNull();
    expect(t.conflicts).toEqual([{ fromRight: 0, axisNegative: -1, sizes: [{ operand: 0, axis: 1, size: 3 }, { operand: 1, axis: 0, size: 4 }] }]);
    expect(t.rows[0].cells.map((c) => c.status)).toEqual(["incompatible", "incompatible"]);
    expect(t.message).toContain("axis -1 (the last axis) has sizes 3 (first array, axis 1) and 4 (second array, axis 0); neither is 1");
    expect(t.numpyMessage).toBe("operands could not be broadcast together with shapes (2,3) (4,) ");
  });
  it("two conflicting axes are both reported; a stretched 1 is not a conflict", () => {
    const t = alignShapes([[2, 3, 1], [4, 1, 5]]);
    expect(t.valid).toBe(false);
    expect(t.conflicts.map((c) => c.axisNegative)).toEqual([-3]);
    const u = alignShapes([[2, 3], [3, 2]]);
    expect(u.conflicts.map((c) => c.axisNegative)).toEqual([-1, -2]);
    expect(u.rows[0].cells[0].status).toBe("incompatible");
  });
  it("source index of a result element", () => {
    expect(operandIndex([1, 2], [3])).toEqual([2]);
    expect(operandIndex([1, 2], [2, 1])).toEqual([1, 0]);
    expect(operandIndex([1, 2], [1, 3])).toEqual([0, 2]);
  });
  it("formats shapes the way NumPy and Python write them", () => {
    expect([numpyShape([]), numpyShape([3]), numpyShape([2, 3])]).toEqual(["()", "(3,)", "(2,3)"]);
    expect([pyShape([]), pyShape([3]), pyShape([2, 3])]).toEqual(["()", "(3,)", "(2, 3)"]);
  });
});

describe("cross-checks against what NumPy really did", () => {
  const real = "operands could not be broadcast together with shapes (2,3) (4,) ";
  it("parses the shapes NumPy quotes", () => {
    expect(parseBroadcastError(real)).toEqual([[2, 3], [4]]);
    expect(parseBroadcastError("operands could not be broadcast together with shapes (3,) () (2,1) ")).toEqual([[3], [], [2, 1]]);
    expect(parseBroadcastError("TypeError: nope")).toBeNull();
  });
  it("success: result shape must match; failure: shapes and verdict must match", () => {
    const ok = alignShapes([[2, 3], [3]]);
    expect(crossCheckBroadcast(ok, { resultShape: [2, 3] }).ok).toBe(true);
    expect(crossCheckBroadcast(ok, { resultShape: [3, 2] }).ok).toBe(false);
    expect(crossCheckBroadcast(ok, { errorText: real }).ok).toBe(false); // table says valid, NumPy refused
    const bad = alignShapes([[2, 3], [4]]);
    expect(crossCheckBroadcast(bad, { errorText: real }).ok).toBe(true);
    expect(crossCheckBroadcast(bad, { resultShape: [2, 3] }).ok).toBe(false); // table says invalid but the run worked
    expect(crossCheckBroadcast(alignShapes([[2, 3], [5]]), { errorText: real }).ok).toBe(false); // different shapes quoted
    expect(crossCheckBroadcast(bad, { errorText: "TypeError: x" }).ok).toBe(false);
  });
});

describe("matrix multiplication shape rule", () => {
  it("(m,n)@(n,p) -> (m,p)", () => {
    const p = planMatmul([2, 3], [3, 4]);
    expect(p).toMatchObject({ valid: true, resultShape: [2, 4], inner: { a: 3, b: 3 }, rule: "(2,3) @ (3,4) -> (2,4)" });
  });
  it("vectors and batches", () => {
    expect(planMatmul([3], [3]).resultShape).toEqual([]);
    expect(planMatmul([2, 3], [3]).resultShape).toEqual([2]);
    expect(planMatmul([3], [3, 4]).resultShape).toEqual([4]);
    expect(planMatmul([5, 2, 3], [3, 4]).resultShape).toEqual([5, 2, 4]);
    expect(planMatmul([5, 2, 3], [5, 3, 4]).resultShape).toEqual([5, 2, 4]);
    expect(planMatmul([5, 2, 3], [4, 3, 2]).valid).toBe(false);
  });
  it("inner mismatch: both NumPy wordings are reproduced exactly", () => {
    const p = planMatmul([2, 3], [2, 4]);
    expect(p.valid).toBe(false);
    expect(p.inner).toEqual({ a: 3, b: 2 });
    expect(p.numpyMessage).toBe("matmul: Input operand 1 has a mismatch in its core dimension 0, with gufunc signature (n?,k),(k,m?)->(n?,m?) (size 2 is different from 3)");
    expect(p.dotMessage).toBe("shapes (2,3) and (2,4) not aligned: 3 (dim 1) != 2 (dim 0)");
    expect(planMatmul([3], [4]).numpyMessage).toContain("(size 4 is different from 3)");
  });
  it("a scalar operand is rejected like NumPy does", () => {
    expect(planMatmul([], [3]).valid).toBe(false);
    expect(planMatmul([], [3]).numpyMessage).toContain("Input operand 0 does not have enough dimensions");
  });
  it("cross-check against the real result or error", () => {
    const ok = planMatmul([2, 3], [3, 4]);
    expect(crossCheckMatmul(ok, { resultShape: [2, 4] }).ok).toBe(true);
    expect(crossCheckMatmul(ok, { resultShape: [4, 2] }).ok).toBe(false);
    const bad = planMatmul([2, 3], [2, 4]);
    expect(crossCheckMatmul(bad, { errorText: bad.numpyMessage }).ok).toBe(true);
    expect(crossCheckMatmul(bad, { errorText: bad.dotMessage }).ok).toBe(true);
    expect(crossCheckMatmul(ok, { errorText: bad.numpyMessage }).ok).toBe(false);
    expect(crossCheckMatmul(bad, { errorText: "matmul: Input operand 1 has a mismatch in its core dimension 0, with gufunc signature (n?,k),(k,m?)->(n?,m?) (size 9 is different from 3)" }).ok).toBe(false);
  });
});

describe("axis, positions and seeds", () => {
  it("reduction shapes", () => {
    expect(predictReduceShape([3, 4], [0], false, "sum")).toEqual([4]);
    expect(predictReduceShape([3, 4], [1], true, "max")).toEqual([3, 1]);
    expect(predictReduceShape([3, 4], null, false, "sum")).toEqual([]);
    expect(predictReduceShape([2, 3, 4], [0, 2], false, "sum")).toEqual([3]);
    expect(predictReduceShape([3, 4], null, false, "cumsum")).toEqual([12]);
    expect(predictReduceShape([3, 4], [1], false, "sort")).toEqual([3, 4]);
  });
  it("which output element a cell feeds", () => {
    expect(reduceTarget([1, 2], [0], false)).toEqual([2]);
    expect(reduceTarget([1, 2], [1], true)).toEqual([1, 0]);
    expect(reduceTarget([1, 2, 3], null, false)).toEqual([]);
  });
  it("unravel, axis labels", () => {
    expect(unravel(6, [3, 4])).toEqual([1, 2]);
    expect(unravel(23, [2, 3, 4])).toEqual([1, 2, 3]);
    expect(axisLabel(0, 2)).toMatch(/axis 0/);
    expect(axisLabel(1, 1)).toBe("axis 0");
  });
  it("planes for 0-d to 3-d arrays", () => {
    const nd = (shape: number[], data: unknown, extra: Partial<DataSnap> = {}): DataSnap => ({ k: "nd", r: "ndarray", shape, ndim: shape.length, n: shape.reduce((a, b) => a * b, 1), data, ...extra });
    expect(ndPlanes(nd([], "5"))!.planes).toEqual([[["5"]]]);
    expect(ndPlanes(nd([3], ["1", "2", "3"]))!.colLabels).toEqual(["0", "1", "2"]);
    expect(ndPlanes(nd([2, 2], [["1", "2"], ["3", "4"]]))!.rowLabels).toEqual(["0", "1"]);
    const three = ndPlanes(nd([2, 1, 2], [[["1", "2"]], [["3", "4"]]]))!;
    expect(three.planes).toHaveLength(2);
    expect(three.planeLabels).toEqual(["[0, :, :]", "[1, :, :]"]);
  });
  it("seed detection reads what the code says", () => {
    expect(seedInfo("np.random.seed(42)\nx = np.random.rand(3)")).toEqual({ seeds: [42], unseeded: false });
    expect(seedInfo("rng = np.random.default_rng(7)\nrng.integers(0, 5)")).toEqual({ seeds: [7], unseeded: false });
    expect(seedInfo("x = np.random.rand(3)")).toEqual({ seeds: [], unseeded: true });
    expect(seedInfo("rng = np.random.default_rng()\nrng.integers(0,5)")).toEqual({ seeds: [], unseeded: true });
    expect(seedInfo("# np.random.seed(1)\nx = np.arange(3)")).toEqual({ seeds: [], unseeded: false });
    expect(seedInfo("x = np.arange(3)")).toEqual({ seeds: [], unseeded: false });
  });
});

describe("grids and row marks", () => {
  const df = (rows: (string | null)[][], index: string[], cols = ["a", "b"]): DataSnap => ({ k: "df", r: "DataFrame", shape: [rows.length, cols.length], cols, dtypes: cols.map(() => "int64"), colNames: cols, colDtypes: cols.map(() => "int64"), index, rows, na: [0, 0], naTotal: 0 });
  it("diffGrids sees changed cells, added columns and removed rows on a captured snapshot", () => {
    const before = gridOfSnap(df([["1", "2"], ["3", "4"]], ["0", "1"]));
    const after = gridOfSnap(df([["1", "9", "x"]], ["0"], ["a", "b", "c"]));
    const d = diffGrids(before, after);
    expect(d.changed).toEqual([{ row: 0, col: 1, before: "2", after: "9" }]);
    expect(d.addedCols).toEqual(["c"]);
    expect(d.removedRows).toEqual(["1"]);
  });
  it("row marks use words and come from the stage's real facts", () => {
    const st = { rows: { in: 3, out: 2, ident: "index", retained: 2, removed: 1, shownKept: [true, false, true], shownNew: [false, false] } } as unknown as DataStage;
    expect(rowMarks(st, "in0")!.map((m) => m?.label)).toEqual(["kept", "removed", "kept"]);
    expect(rowMarks(st, "out")).toBeUndefined();
    const mg = { merge: { how: "left", leftShown: ["matched", "unmatched"], rightShown: ["matched"], origin: ["both", "left_only"] } } as unknown as DataStage;
    expect(rowMarks(mg, "in0")!.map((m) => m?.label)).toEqual(["matched", "no match"]);
    expect(rowMarks(mg, "out")!.map((m) => m?.label)).toEqual(["both", "left only"]);
    const cc = { concat: { rowOrigin: [0, 0, 1] } } as unknown as DataStage;
    expect(rowMarks(cc, "out")!.map((m) => m?.label)).toEqual(["part 1", "part 1", "part 2"]);
  });
});

describe("consistency checks catch a disagreement between the picture and the result", () => {
  const nd = (shape: number[], data: unknown): DataSnap => ({ k: "nd", r: "ndarray", shape, ndim: shape.length, dtype: "float64", n: shape.reduce((a, b) => a * b, 1), data, shown: shape });
  const stage = (over: Partial<DataStage>): DataStage => ({ i: 0, kind: "binop", op: "+", code: "a + b", expr: "a + b", line: 1, stmt: "c = a + b", stmtLine: 1, inputs: [], argSnaps: [], output: null, ...over });
  it("a result whose real shape is the predicted one passes", () => {
    const a = analyzeStage(stage({ inputs: [nd([2, 3], [["1", "2", "3"], ["4", "5", "6"]]), nd([3], ["1", "1", "1"])], output: nd([2, 3], [["2", "3", "4"], ["5", "6", "7"]]) }));
    expect(a.consistent).toBe(true);
    expect(a.nd!.broadcast!.resultShape).toEqual([2, 3]);
  });
  it("a result with a different shape than the rule predicts is flagged", () => {
    const a = analyzeStage(stage({ inputs: [nd([2, 3], [["1", "2", "3"], ["4", "5", "6"]]), nd([3], ["1", "1", "1"])], output: nd([3, 2], [["1", "2"], ["3", "4"], ["5", "6"]]) }));
    expect(a.consistent).toBe(false);
    expect(a.checks.find((c) => !c.ok)!.name).toBe("result shape");
  });
  it("a grid that does not fit its shape is flagged", () => {
    const a = analyzeStage(stage({ kind: "func", op: "array", inputs: [], output: nd([2, 2], [["1", "2"]]) }));
    expect(a.consistent).toBe(false);
    expect(a.checks.find((c) => !c.ok)!.name).toBe("output grid fits its shape");
  });
  it("a merge whose key counts do not predict the output rows is flagged", () => {
    const df: DataSnap = { k: "df", r: "DataFrame", shape: [3, 1], cols: ["a"], dtypes: ["int64"], rows: [["1"], ["2"], ["3"]], index: ["0", "1", "2"] };
    const a = analyzeStage(stage({ kind: "call", op: "merge", inputs: [df, df], output: df, merge: { how: "inner", outRows: 3, expectedOutRows: 4 } }));
    expect(a.consistent).toBe(false);
  });
  it("titles are short", () => {
    expect(stageTitle(stage({ kind: "call", code: ".dropna()" }))).toBe(".dropna()");
    expect(stageTitle(stage({ kind: "change", stmt: "x".repeat(100) })).length).toBe(64);
  });
});

describe("failure explanation compares the test with the real final values", () => {
  const finals: Record<string, DataSnap> = {
    result: { k: "df", r: "DataFrame", shape: [4, 2], colNames: ["id", "total"], colDtypes: ["int64", "object"] },
    arr: { k: "nd", r: "ndarray", shape: [3, 2], ndim: 2, dtype: "int64" },
  };
  it("shape, rows, dtype, columns, dimensions", () => {
    expect(compareWithExpectation("assert result.shape == (3, 2)", finals)).toMatchObject({ category: "Shapes", message: expect.stringContaining("has shape (4, 2) but the exercise expects (3, 2). The row count is too high by 1") });
    expect(compareWithExpectation("assert len(result) == 5", finals)!.message).toContain("has 4 rows but the exercise expects 5");
    expect(compareWithExpectation("assert result['total'].dtype == 'float64'", finals)).toMatchObject({ category: "Dtypes", message: expect.stringContaining("dtype object but the exercise expects float64") });
    expect(compareWithExpectation("assert list(result.columns) == ['id', 'sum']", finals)).toMatchObject({ category: "Columns and labels" });
    expect(compareWithExpectation("assert arr.ndim == 1", finals)!.message).toContain("2 dimension(s) but the exercise expects 1");
    expect(compareWithExpectation("assert result.shape == (4, 2)", finals)).toBeNull();
  });
});
