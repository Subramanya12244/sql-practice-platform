// @vitest-environment node
// The pandas / NumPy stage engine, run for real: the probe program executes in CPython with numpy and pandas (the browser runs the same
// source in Pyodide, see scripts/data-stages-verify.ts). Every number asserted here is compared with an independent plain run.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { buildDataModel, parseDataProbe, runDataProbe, type DataProbeResult, type DataStage } from "../site/lib/visual/dataframe";
import { DATA_PRESETS } from "../site/workspace/adapters/data/presets";
import { PYTHON, cpythonRun, hasDataPython, pythonVersions } from "./siteWorkspaceDataPy";

async function probe(code: string): Promise<DataProbeResult> {
  const r = await runDataProbe(code, { run: cpythonRun });
  if (!r.probe) throw new Error(`no probe: ${r.result.error ?? r.result.stdout.slice(-400)}`);
  return r.probe;
}
const model = (domain: "pandas" | "numpy", p: DataProbeResult, code: string) => buildDataModel(domain, p, code);
const stageOf = (p: DataProbeResult, op: string, nth = 0): DataStage => {
  const s = p.stages.filter((x) => x.op === op)[nth];
  if (!s) throw new Error(`no stage ${op}#${nth}: ${p.stages.map((x) => x.op).join(",")}`);
  return s;
};
/** Independent ground truth: plain CPython run that prints the shape and dtype of every DataFrame / Series / ndarray global. */
function truth(code: string): Record<string, { shape: number[]; dtype?: string; dtypes?: string[] }> {
  const prog = `${code}\nimport json as _j, sys as _s\n_o = {}\nfor _k, _v in list(globals().items()):\n    if _k.startswith('_'): continue\n    _t = type(_v).__name__\n    if _t == 'DataFrame': _o[_k] = {'shape': list(_v.shape), 'dtypes': [str(x) for x in _v.dtypes]}\n    elif _t in ('Series', 'ndarray'): _o[_k] = {'shape': list(_v.shape), 'dtype': str(_v.dtype)}\n_s.stdout.write('\\x1eTRUTH' + _j.dumps(_o))\n`;
  const r = spawnSync(PYTHON!, ["-I", "-"], { input: prog, encoding: "utf8", timeout: 60_000 });
  const at = r.stdout.lastIndexOf("\x1eTRUTH");
  if (at < 0) throw new Error(`truth run failed: ${r.stderr.slice(-300)}`);
  return JSON.parse(r.stdout.slice(at + 6));
}

describe.skipIf(!hasDataPython)(`data probe in real CPython (${pythonVersions()})`, () => {
  it("marker line parses and unknown output does not", async () => {
    expect(parseDataProbe("no marker")).toBeNull();
    const p = await probe("x = 1\n");
    expect(p.ok).toBe(true);
    expect(p.stages).toEqual([]);
  });

  describe("pandas", () => {
    it("filtering: rows retained and removed are exact, with the removed rows marked", async () => {
      const code = "import pandas as pd\ndf = pd.DataFrame({'city': ['Oslo', 'Rome', 'Lima', 'Kyiv', 'Pune'], 'sales': [120, 75, 200, 90, 60]})\nbig = df[df['sales'] > 80]\n";
      const p = await probe(code);
      const sel = stageOf(p, "[]");
      expect(sel.kind).toBe("select");
      expect(sel.inputs[0].shape).toEqual([5, 2]);
      expect(sel.output!.shape).toEqual([3, 2]);
      expect(sel.rows).toMatchObject({ in: 5, out: 3, ident: "index", retained: 3, removed: 2, added: 0 });
      expect(sel.rows!.shownKept).toEqual([true, false, true, true, false]);
      expect(sel.output!.rows!.map((r) => r[0])).toEqual(["Oslo", "Lima", "Kyiv"]);
      expect(sel.output!.index).toEqual(["0", "2", "3"]);
      expect(sel.argSnaps[0].dtype).toBe("bool");
      const m = model("pandas", p, code);
      expect(m.consistent).toBe(true);
      expect(m.analyses[sel.i].rowsRemoved).toBe(2);
      expect(m.analyses[sel.i].explanation).toMatch(/3 rows kept, 2 rows removed/);
    });

    it("column selection, sorting and calculated columns report columns added/removed and the dtype", async () => {
      const code = "import pandas as pd\ndf = pd.DataFrame({'price': [2.5, 4.0, 1.0], 'qty': [4, 2, 10], 'tag': ['a', 'b', 'c']})\nsub = df[['price', 'qty']]\ns = sub.sort_values('price')\ndf['total'] = df['price'] * df['qty']\n";
      const p = await probe(code);
      const m = model("pandas", p, code);
      const cols = m.analyses[stageOf(p, "[]").i];
      expect(cols.colsRemoved).toEqual(["tag"]);
      expect(cols.rowsRemoved).toBe(0);
      const sorted = stageOf(p, "sort_values");
      expect(sorted.rows).toMatchObject({ ident: "index", retained: 3, removed: 0, reordered: true });
      expect(sorted.output!.index).toEqual(["2", "0", "1"]);
      const change = p.stages.find((s) => s.kind === "change")!;
      expect(m.analyses[change.i].colsAdded).toEqual(["total"]);
      expect(change.output!.colNames).toEqual(["price", "qty", "tag", "total"]);
      expect(change.output!.colDtypes).toEqual(["float64", "int64", "object", "float64"]);
      expect(change.output!.rows![0][3]).toBe("10.0");
      expect(m.consistent).toBe(true);
    });

    it("missing values: dropna removes rows, fillna fills cells, counts are exact", async () => {
      const code = "import pandas as pd\ndf = pd.DataFrame({'a': [1.0, None, 3.0, None], 'b': ['x', 'y', None, 'z']})\nclean = df.dropna()\nfilled = df.fillna({'a': 0, 'b': 'unknown'})\n";
      const p = await probe(code);
      const m = model("pandas", p, code);
      const d = stageOf(p, "dropna");
      expect(d.inputs[0].naTotal).toBe(3);
      expect(d.output!.shape).toEqual([1, 2]);
      expect(d.rows).toMatchObject({ retained: 1, removed: 3 });
      expect(m.analyses[d.i].missingBefore).toBe(3);
      expect(m.analyses[d.i].missingAfter).toBe(0);
      const f = stageOf(p, "fillna");
      expect(f.rows).toMatchObject({ retained: 4, removed: 0 });
      expect(f.output!.naTotal).toBe(0);
      expect(m.analyses[f.i].explanation).toMatch(/Missing cells 3 → 0/);
      expect(m.consistent).toBe(true);
    });

    it("drop_duplicates and rename", async () => {
      const code = "import pandas as pd\ndf = pd.DataFrame({'id': [1, 2, 2, 3], 'v': [10, 20, 20, 30]})\nu = df.drop_duplicates()\nr = u.rename(columns={'v': 'value'})\n";
      const p = await probe(code);
      const m = model("pandas", p, code);
      expect(stageOf(p, "drop_duplicates").rows).toMatchObject({ retained: 3, removed: 1 });
      const ren = m.analyses[stageOf(p, "rename").i];
      expect(ren.colsAdded).toEqual(["value"]);
      expect(ren.colsRemoved).toEqual(["v"]);
      expect(m.consistent).toBe(true);
    });

    it("groupby shows the groups BEFORE aggregation, then the aggregate", async () => {
      const code = "import pandas as pd\ndf = pd.DataFrame({'team': ['a', 'b', 'a', 'b', 'a', None], 'pts': [3, 5, 4, 1, 2, 9]})\ntotals = df.groupby('team')['pts'].sum()\n";
      const p = await probe(code);
      const m = model("pandas", p, code);
      const g = stageOf(p, "groupby");
      expect(g.output!.k).toBe("group");
      expect(g.output!.by).toEqual(["team"]);
      expect(g.output!.ngroups).toBe(2);
      expect(g.output!.srcRows).toBe(6);
      expect(g.output!.inGroups).toBe(5); // the row with a missing key is excluded, and we say so
      expect(g.output!.groups!.map((x) => [x.key, x.size])).toEqual([["a", 3], ["b", 2]]);
      expect(g.output!.groups![0].snap.rows!.map((r) => r[1])).toEqual(["3", "4", "2"]); // a's own rows, not yet summed
      expect(m.analyses[g.i].explanation).toMatch(/Nothing is aggregated yet/);
      expect(m.analyses[g.i].explanation).toMatch(/1 row with a missing key is left out/);
      const col = stageOf(p, "[]");
      expect(col.output!.k).toBe("group");
      const sum = stageOf(p, "sum");
      expect(sum.inputs[0].k).toBe("group");
      expect(sum.output!.rows!.map((r) => r[0])).toEqual(["9", "6"]);
      expect(sum.output!.index).toEqual(["a", "b"]);
      expect(m.analyses[sum.i].explanation).toMatch(/Collapses each of the 2 groups/);
      expect(m.consistent).toBe(true);
    });

    it("aggregation without groups reduces to a scalar", async () => {
      const code = "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2, 3]})\ntotal = df['a'].sum()\nm = df.agg({'a': 'mean'})\n";
      const p = await probe(code);
      const s = stageOf(p, "sum");
      expect(s.output).toMatchObject({ k: "int", r: "6" });
      expect(p.stages.some((x) => x.op === "agg")).toBe(true);
    });

    const MERGE = "import pandas as pd\nusers = pd.DataFrame({'id': [1, 2, 3, 4], 'name': ['Ana', 'Ben', 'Chen', 'Dee']})\norders = pd.DataFrame({'user_id': [1, 1, 3, 9], 'amount': [10, 20, 5, 7]})\n";
    it.each([["inner", 3, { both: 3 }], ["left", 5, { both: 3, left_only: 2 }], ["right", 4, { both: 3, right_only: 1 }], ["outer", 6, { both: 3, left_only: 2, right_only: 1 }]] as const)(
      "merge how=%s: matched keys, unmatched rows on each side and the real output (%i rows)", async (how, outRows, origin) => {
        const code = `${MERGE}r = users.merge(orders, left_on='id', right_on='user_id', how='${how}')\n`;
        const p = await probe(code);
        const st = stageOf(p, "merge");
        const mg = st.merge!;
        expect(mg.how).toBe(how);
        expect(mg.matchedKeys).toEqual([{ key: "1", left: 1, right: 2 }, { key: "3", left: 1, right: 1 }]);
        expect(mg.unmatchedLeftKeys!.map((k) => k.key)).toEqual(["2", "4"]);
        expect(mg.unmatchedRightKeys!.map((k) => k.key)).toEqual(["9"]);
        expect([mg.leftMatchedRows, mg.leftUnmatchedRows, mg.rightMatchedRows, mg.rightUnmatchedRows]).toEqual([2, 2, 3, 1]);
        expect(mg.leftShown).toEqual(["matched", "unmatched", "matched", "unmatched"]);
        expect(mg.rightShown).toEqual(["matched", "matched", "matched", "unmatched"]);
        expect(mg.outRows).toBe(outRows);
        expect(mg.expectedOutRows).toBe(outRows);
        expect(mg.originCounts).toEqual(origin);
        expect(st.output!.shape![0]).toBe(outRows);
        const m = model("pandas", p, code);
        expect(m.consistent).toBe(true);
        expect(m.analyses[st.i].checks.some((c) => c.name === "key counts predict the output rows" && c.ok)).toBe(true);
      });

    it("pd.merge and join on the index", async () => {
      const code = "import pandas as pd\na = pd.DataFrame({'x': [1, 2, 3]}, index=['p', 'q', 'r'])\nb = pd.DataFrame({'y': [10, 20, 30]}, index=['q', 'r', 's'])\nj = a.join(b, how='outer')\nm = pd.merge(a, b, left_index=True, right_index=True, how='left')\n";
      const p = await probe(code);
      const j = stageOf(p, "join").merge!;
      expect([j.matchedKeyCount, j.leftUnmatchedRows, j.rightUnmatchedRows, j.outRows, j.expectedOutRows]).toEqual([2, 1, 1, 4, 4]);
      const mm = stageOf(p, "merge").merge!;
      expect([mm.matchedKeyCount, mm.outRows, mm.expectedOutRows]).toEqual([2, 3, 3]);
      expect(model("pandas", p, code).consistent).toBe(true);
    });

    it("concat records the origin of every row", async () => {
      const code = "import pandas as pd\na = pd.DataFrame({'id': [1, 2]})\nb = pd.DataFrame({'id': [3]})\nc = pd.concat([a, b], ignore_index=True)\n";
      const p = await probe(code);
      const st = stageOf(p, "concat");
      expect(st.concat).toMatchObject({ axis: 0, partCount: 2, ignoreIndex: true, rowOrigin: [0, 0, 1], rowCounts: [2, 1] });
      expect(st.output!.shape).toEqual([3, 1]);
      expect(st.inputs.map((s) => s.shape)).toEqual([[2, 1], [1, 1]]);
    });

    it("reshaping: pivot, melt and pivot_table", async () => {
      const code = "import pandas as pd\nlong = pd.DataFrame({'m': ['Jan', 'Jan', 'Feb', 'Feb'], 'k': ['x', 'y', 'x', 'y'], 'v': [1, 2, 3, 4]})\nwide = long.pivot(index='m', columns='k', values='v')\nback = wide.reset_index().melt(id_vars='m')\nt = long.pivot_table(index='m', values='v', aggfunc='sum')\n";
      const p = await probe(code);
      const pv = stageOf(p, "pivot");
      expect(pv.inputs[0].shape).toEqual([4, 3]);
      expect(pv.output!.shape).toEqual([2, 2]);
      expect(pv.output!.index).toEqual(["Feb", "Jan"]);
      expect(pv.output!.cols).toEqual(["x", "y"]);
      expect(pv.output!.rows).toEqual([["3", "4"], ["1", "2"]]);
      const me = stageOf(p, "melt");
      expect(me.output!.shape).toEqual([4, 3]);
      expect(me.output!.cols).toEqual(["m", "k", "value"]);
      expect(stageOf(p, "pivot_table").output!.rows).toEqual([["7"], ["3"]]);
      expect(model("pandas", p, code).consistent).toBe(true);
    });

    it("apply/map, string and datetime operations, rolling windows", async () => {
      const code = "import pandas as pd\ns = pd.Series([1, 2, 3])\nd = s.apply(lambda x: x * 2)\nl = s.map({1: 'one', 2: 'two'})\nt = pd.Series(['ana lee', 'ben ray']).str.title()\nyr = pd.Series(pd.to_datetime(['2024-01-05'])).dt.year\nr = pd.Series([1, 2, 3, 4]).rolling(3).mean()\n";
      const p = await probe(code);
      expect(stageOf(p, "apply").output!.rows).toEqual([["2"], ["4"], ["6"]]);
      expect(stageOf(p, "map").output!.rows).toEqual([["one"], ["two"], [null]]);
      expect(stageOf(p, "map").output!.naTotal).toBe(1);
      expect(stageOf(p, "title").code).toBe(".str.title()");
      expect(stageOf(p, "title").output!.rows).toEqual([["Ana Lee"], ["Ben Ray"]]);
      expect(stageOf(p, "year").output!.dtype).toMatch(/int/);
      const roll = stageOf(p, "rolling");
      expect(roll.output).toMatchObject({ k: "obj", t: "Rolling" });
      expect(roll.output!.params!.window).toBe("3");
      const mean = stageOf(p, "mean");
      expect(mean.output!.rows).toEqual([[null], [null], ["2.0"], ["3.0"]]);
    });

    it("an in-place call that changes nothing is still shown, and in-place edits show before and after", async () => {
      const code = "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2, 3]})\ndf.dropna(inplace=True)\ndf.loc[0, 'a'] = 99\ndf.drop(columns=['a'], inplace=True)\n";
      const p = await probe(code);
      const ch = p.stages.filter((s) => s.kind === "change" && s.op !== "assign");
      expect(ch).toHaveLength(3);
      expect(ch[0].unchanged).toBe(true);
      expect(ch[1].inputs[0].rows![0][0]).toBe("1");
      expect(ch[1].output!.rows![0][0]).toBe("99");
      expect(ch[2].output!.shape).toEqual([3, 0]);
    });
  });

  describe("numpy", () => {
    it("shape, ndim, size, dtype and strides come from the real array", async () => {
      const code = "import numpy as np\na = np.arange(12).reshape(3, 4)\nshape = a.shape\nz = np.zeros((2, 3), dtype=np.float32)\n";
      const p = await probe(code);
      const a = stageOf(p, "reshape").output!;
      expect(a).toMatchObject({ k: "nd", shape: [3, 4], ndim: 2, n: 12, dtype: "int64", itemsize: 8, nbytes: 96, c: true });
      expect(a.strides).toEqual([32, 8]);
      expect(a.data).toEqual([["0", "1", "2", "3"], ["4", "5", "6", "7"], ["8", "9", "10", "11"]]);
      expect(stageOf(p, "shape").output!.r).toBe("(3, 4)");
      expect(stageOf(p, "zeros").output).toMatchObject({ dtype: "float32", shape: [2, 3] });
      expect(stageOf(p, "reshape").view).toBe(true);
    });

    it("indexing and slicing: positions of the selected elements, view vs copy", async () => {
      const code = "import numpy as np\na = np.arange(12).reshape(3, 4)\nel = a[1, 2]\ncol = a[:, 1]\nblock = a[1:, :2]\nm = a > 8\nbig = a[m]\n";
      const p = await probe(code);
      const m = model("numpy", p, code);
      const sels = p.stages.filter((s) => s.kind === "select");
      expect(sels[0].output).toMatchObject({ k: "int", r: "6" });
      expect(sels[0].pos!.src).toBe(6); // a scalar result still says which input cell it is
      expect((sels[0].pos!.sel as boolean[][]).flat().filter(Boolean)).toHaveLength(1);
      expect(sels[1].output!.data).toEqual(["1", "5", "9"]);
      expect(sels[1].pos!.src).toEqual([1, 5, 9]);
      expect(sels[1].pos!.sel).toEqual([[false, true, false, false], [false, true, false, false], [false, true, false, false]]);
      expect(sels[1].view).toBe(true);
      expect(sels[2].output!.data).toEqual([["4", "5"], ["8", "9"]]);
      expect(sels[2].pos!.src).toEqual([[4, 5], [8, 9]]);
      expect(sels[3].output!.data).toEqual(["9", "10", "11"]);
      expect(sels[3].view).toBe(false); // a boolean mask returns a copy
      expect(m.analyses[sels[1].i].checks.some((c) => c.name === "element positions agree with the values" && c.ok)).toBe(true);
      expect(m.consistent).toBe(true);
    });

    it("reshape, flatten, transpose keep the element count; positions follow the elements", async () => {
      const code = "import numpy as np\na = np.arange(6).reshape(2, 3)\nf = a.flatten()\nt = a.T\nr = a.reshape(3, 2)\n";
      const p = await probe(code);
      const m = model("numpy", p, code);
      expect(stageOf(p, "flatten").view).toBe(false);
      expect(stageOf(p, "T").view).toBe(true);
      expect(stageOf(p, "T").output!.data).toEqual([["0", "3"], ["1", "4"], ["2", "5"]]);
      expect(stageOf(p, "T").pos!.src).toEqual([[0, 3], [1, 4], [2, 5]]);
      expect(stageOf(p, "reshape", 1).output!.shape).toEqual([3, 2]);
      expect(m.analyses[stageOf(p, "reshape", 1).i].checks.find((c) => c.name === "element count unchanged")!.ok).toBe(true);
      expect(m.consistent).toBe(true);
    });

    it("broadcasting (valid): the alignment table predicts the real result shape", async () => {
      const code = "import numpy as np\na = np.arange(6).reshape(2, 3)\nrow = np.array([10, 20, 30])\ncol = np.array([[100], [200]])\nc = a + row\nd = a + col\ne = col + row\n";
      const p = await probe(code);
      const m = model("numpy", p, code);
      const adds = p.stages.filter((s) => s.kind === "binop");
      const [c, d, e] = adds.map((s) => m.analyses[s.i].nd!.broadcast!);
      expect(c.valid && c.resultShape).toEqual([2, 3]);
      expect(c.rows.map((r) => r.cells.map((x) => x.status))).toEqual([["equal", "equal"], ["equal", "missing"]]);
      expect(d.rows[0].cells.map((x) => x.status)).toEqual(["equal", "stretch"]);
      expect(d.rows[1].cells.map((x) => x.status)).toEqual(["equal", "equal"]);
      expect(e.resultShape).toEqual([2, 3]);
      expect(e.rows.map((r) => r.status)).toEqual(["stretched", "stretched"]);
      for (const s of adds) expect(m.analyses[s.i].nd!.broadcast!.resultShape).toEqual(s.output!.shape);
      expect(d.shapes).toEqual([[2, 3], [2, 1]]);
      expect(adds[1].output!.data).toEqual([["100", "101", "102"], ["203", "204", "205"]]);
      expect(m.consistent).toBe(true);
    });

    it("broadcasting (invalid): the conflict is named and NumPy's real error agrees", async () => {
      const code = "import numpy as np\na = np.ones((2, 3))\nb = np.ones(4)\nc = a + b\n";
      const p = await probe(code);
      expect(p.ok).toBe(false);
      expect(p.error!.type).toBe("ValueError");
      expect(p.error!.msg).toContain("operands could not be broadcast together with shapes (2,3) (4,)");
      const st = p.stages[p.stages.length - 1];
      expect(st.error!.msg).toBe(p.error!.msg);
      expect(st.output).toBeNull();
      const m = model("numpy", p, code);
      const t = m.analyses[st.i].nd!.broadcast!;
      expect(t.valid).toBe(false);
      expect(t.conflicts).toHaveLength(1);
      expect(t.conflicts[0]).toMatchObject({ axisNegative: -1, sizes: [{ operand: 0, axis: 1, size: 3 }, { operand: 1, axis: 0, size: 4 }] });
      expect(t.numpyMessage).toBe(p.error!.msg);
      expect(m.analyses[st.i].checks.every((c) => c.ok)).toBe(true);
      expect(m.analyses[st.i].checks.map((c) => c.name)).toEqual(expect.arrayContaining(["shapes match NumPy's error", "table predicts the failure"]));
    });

    it("axis operations: the predicted reduction shape equals the real one", async () => {
      const code = "import numpy as np\nx = np.arange(12).reshape(3, 4)\ns0 = x.sum(axis=0)\nm1 = x.mean(axis=1)\nk = x.max(axis=1, keepdims=True)\nt = x.sum()\ncube = np.arange(24).reshape(2, 3, 4)\nc = cube.sum(axis=(0, 2))\n";
      const p = await probe(code);
      const m = model("numpy", p, code);
      const r = (op: string, n = 0) => m.analyses[stageOf(p, op, n).i].nd!.reduce!;
      expect(r("sum", 0)).toMatchObject({ axis: [0], predicted: [4], keepdims: false });
      expect(stageOf(p, "sum", 0).output!.data).toEqual(["12", "15", "18", "21"]);
      expect(r("mean")).toMatchObject({ axis: [1], predicted: [3] });
      expect(r("max")).toMatchObject({ axis: [1], predicted: [3, 1], keepdims: true });
      expect(r("sum", 1)).toMatchObject({ axis: null, predicted: [] });
      expect(r("sum", 2)).toMatchObject({ axis: [0, 2], predicted: [3] });
      expect(m.consistent).toBe(true);
      expect(m.analyses.every((a) => a.checks.every((c) => c.ok))).toBe(true);
    });

    it("matrix multiplication (valid): (m,n)@(n,p) -> (m,p) agrees with the real product", async () => {
      const code = "import numpy as np\na = np.arange(6).reshape(2, 3)\nb = np.arange(12).reshape(3, 4)\nc = a @ b\nd = np.dot(a, b)\n";
      const p = await probe(code);
      const m = model("numpy", p, code);
      for (const s of p.stages.filter((x) => x.op === "@" || x.op === "dot")) {
        const plan = m.analyses[s.i].nd!.matmul!;
        expect(plan).toMatchObject({ valid: true, resultShape: [2, 4], inner: { a: 3, b: 3 } });
        expect(s.output!.shape).toEqual([2, 4]);
      }
      expect(stageOf(p, "@").output!.data).toEqual([["20", "23", "26", "29"], ["56", "68", "80", "92"]]);
      expect(m.consistent).toBe(true);
    });

    it("matrix multiplication (invalid): the inner-dimension mismatch matches NumPy's error", async () => {
      const code = "import numpy as np\na = np.arange(6).reshape(2, 3)\nb = np.arange(8).reshape(2, 4)\nc = a @ b\n";
      const p = await probe(code);
      expect(p.error!.msg).toContain("size 2 is different from 3");
      const m = model("numpy", p, code);
      const st = p.stages[p.stages.length - 1];
      const plan = m.analyses[st.i].nd!.matmul!;
      expect(plan.valid).toBe(false);
      expect(plan.inner).toEqual({ a: 3, b: 2 });
      expect(plan.numpyMessage).toBe(p.error!.msg);
      expect(m.analyses[st.i].checks.every((c) => c.ok)).toBe(true);
    });

    it("np.dot with mismatched shapes: NumPy's other wording is cross-checked too", async () => {
      const code = "import numpy as np\nc = np.dot(np.ones((2, 3)), np.ones((2, 3)))\n";
      const p = await probe(code);
      expect(p.error!.msg).toBe("shapes (2,3) and (2,3) not aligned: 3 (dim 1) != 2 (dim 0)");
      const m = model("numpy", p, code);
      const st = p.stages[p.stages.length - 1];
      expect(m.analyses[st.i].nd!.matmul!.dotMessage).toBe(p.error!.msg);
      expect(m.analyses[st.i].checks.every((c) => c.ok)).toBe(true);
    });

    it("seeded random numbers are reproducible and the seed is stated; an unseeded program is flagged", async () => {
      const code = "import numpy as np\nnp.random.seed(42)\nr = np.random.randint(0, 100, size=(2, 3))\ng = np.random.default_rng(7).integers(0, 100, size=4)\n";
      const a = await probe(code), b = await probe(code);
      expect(a.finals.r.data).toEqual(b.finals.r.data);
      expect(a.finals.g.data).toEqual(b.finals.g.data);
      expect(a.finals.r.data).toEqual([["51", "92", "14"], ["71", "60", "20"]]); // numpy's own seed-42 stream
      const m = model("numpy", a, code);
      expect(m.seeds).toEqual({ seeds: [42, 7], unseeded: false });
      const loose = "import numpy as np\nx = np.random.rand(3)\n";
      expect(model("numpy", await probe(loose), loose).seeds).toEqual({ seeds: [], unseeded: true });
    });

    it("an in-place change shows the array before and after", async () => {
      const code = "import numpy as np\na = np.arange(4).reshape(2, 2)\na[0, 0] = 99\na *= 2\n";
      const p = await probe(code);
      const ch = p.stages.filter((s) => s.kind === "change");
      expect(ch).toHaveLength(2);
      expect(ch[0].inputs[0].data).toEqual([["0", "1"], ["2", "3"]]);
      expect(ch[0].output!.data).toEqual([["99", "1"], ["2", "3"]]);
      expect(ch[1].output!.data).toEqual([["198", "2"], ["4", "6"]]);
    });

    it("3-D arrays and large arrays are truncated honestly with the real shape", async () => {
      const code = "import numpy as np\nc = np.arange(2 * 3 * 4).reshape(2, 3, 4)\nbig = np.arange(1000).reshape(50, 20)\n";
      const p = await probe(code);
      const c = stageOf(p, "reshape", 0).output!;
      expect(c.shown).toEqual([2, 3, 4]);
      expect(c.more).toBe(false);
      const big = stageOf(p, "reshape", 1).output!;
      expect(big.shape).toEqual([50, 20]);
      expect(big.shown).toEqual([10, 10]);
      expect(big.more).toBe(true);
      expect(model("numpy", p, code).notes.join(" ")).toMatch(/first rows and columns/);
    });
  });

  describe("equivalence with a plain run, errors and limits", () => {
    it("the probe does not change what a program prints or raises", async () => {
      const prog = "import pandas as pd\nprint('hello')\ndf = pd.DataFrame({'a': [1, 2]})\nprint(df['a'].sum())\nprint(df)\n";
      const plain = await cpythonRun(prog);
      const p = await probe(prog);
      expect(p.ok).toBe(true);
      expect(p.stdout).toBe(plain.stdout);
      const bad = "import pandas as pd\ndf = pd.DataFrame({'a': [1]})\nprint('before')\nx = df['nope']\nprint('after')\n";
      const pe = await probe(bad);
      const plainBad = await cpythonRun(bad);
      expect(pe.ok).toBe(false);
      expect(plainBad.ok).toBe(false);
      expect(pe.stdout).toBe("before\n");
      expect(plainBad.stdout).toBe("before\n");
      expect(pe.error).toMatchObject({ type: "KeyError", line: 4 });
      expect(plainBad.error).toContain("KeyError: 'nope'");
      expect(pe.stages[pe.stages.length - 1].error!.type).toBe("KeyError");
    });

    it("a syntax error is reported as such (the adapter then asks the plain runner for Python's own message)", async () => {
      const p = await probe("x = (1,\n");
      expect(p).toMatchObject({ ok: false, syntax: true });
      expect(p.error!.type).toBe("SyntaxError");
    });

    it("loops and functions run as one step and are reported, never faked", async () => {
      const code = "import numpy as np\na = np.zeros(3)\nfor i in range(3):\n    a[i] = i * 2\n";
      const p = await probe(code);
      expect(p.notes).toEqual([{ line: 3, kind: "For" }]);
      const ch = p.stages.filter((s) => s.kind === "change");
      expect(ch).toHaveLength(1);
      expect(ch[0].output!.data).toEqual(["0.0", "2.0", "4.0"]);
      expect(model("numpy", p, code).notes.join(" ")).toMatch(/A loop \(line 3\) ran as one step/);
    });

    it("the stage cap keeps the program running and says how many stages were not kept", async () => {
      const lines = ["import numpy as np", "a = np.arange(3)", ...Array.from({ length: 5 }, (_, i) => `b${i} = a + ${i}`)];
      const r = await runDataProbe(lines.join("\n"), { run: cpythonRun, options: { maxStages: 3 } });
      expect(r.probe!.stages).toHaveLength(3);
      expect(r.probe!.dropped).toBe(3);
      expect(r.probe!.ok).toBe(true);
      expect(Object.keys(r.probe!.finals)).toHaveLength(6);
    });
  });

  describe("every worked example: runs, is consistent, and matches an independent run", () => {
    it.each(DATA_PRESETS.map((p) => [p.id, p] as const))("%s", async (_id, preset) => {
      const p = await probe(preset.code);
      expect(p.ok).toBe(!preset.fails);
      expect(p.stages.length).toBeGreaterThan(0);
      const m = model(preset.domain, p, preset.code);
      expect(m.failedChecks).toEqual([]);
      expect(m.consistent).toBe(true);
      for (const a of m.analyses) expect(a.explanation.length).toBeGreaterThan(5);
      if (!preset.fails) {
        const t = truth(preset.code);
        expect(Object.keys(p.finals).sort()).toEqual(Object.keys(t).sort());
        for (const [name, snap] of Object.entries(p.finals)) {
          expect(snap.shape, `${name} shape`).toEqual(t[name].shape);
          if (snap.k === "df") expect(snap.colDtypes, `${name} dtypes`).toEqual(t[name].dtypes!.slice(0, 60));
          else expect(snap.dtype, `${name} dtype`).toBe(t[name].dtype);
        }
      }
    });
  });
});
