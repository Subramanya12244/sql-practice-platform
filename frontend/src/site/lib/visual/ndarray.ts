/**
 * NumPy stage analysis (Agent 4). Pure.
 *
 * Input: one stage of the stage probe (real arrays captured in Pyodide: shape, ndim, size, dtype, strides, values).
 * Output: the facts the array view shows (broadcast alignment, matmul rule, axis reduction groups, element positions) and CONSISTENCY
 * CHECKS comparing every prediction with the real result, including NumPy's own error text for a failing run.
 */
import type { DataStage, DataSnap } from "./dataframe";
import { alignShapes, crossCheckBroadcast, crossCheckMatmul, numpyShape, planMatmul, type BroadcastTable, type Check, type MatmulPlan } from "./broadcast";

export interface ReduceInfo {
  op: "reduce" | "along";
  axis: number[] | null;
  keepdims: boolean;
  inShape: number[];
  /** Shape the rule predicts. */
  predicted: number[];
}

export interface NdAnalysis {
  broadcast: BroadcastTable | null;
  matmul: MatmulPlan | null;
  reduce: ReduceInfo | null;
  explanation: string;
  checks: Check[];
}

const prod = (a: readonly number[]) => a.reduce((x, y) => x * y, 1);
const same = (a: readonly number[] | null | undefined, b: readonly number[] | null | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/** Shape of a captured value: arrays have one; Python and NumPy scalars are 0-d. Anything else (DataFrame, list) is not an array operand. */
export function operandShape(s: DataSnap): number[] | null {
  if (s.k === "nd") return s.shape ?? null;
  if (s.k === "int" || s.k === "float" || s.k === "bool") return [];
  return null;
}

const UFUNCS = new Set(["add", "subtract", "multiply", "divide", "true_divide", "floor_divide", "power", "mod", "remainder", "maximum", "minimum", "greater", "less", "equal", "not_equal", "greater_equal", "less_equal", "logical_and", "logical_or", "logical_xor", "hypot", "arctan2", "fmax", "fmin", "bitwise_and", "bitwise_or"]);
const REDUCERS = new Set(["sum", "mean", "min", "max", "prod", "std", "var", "argmax", "argmin", "any", "all", "median", "ptp", "average", "nansum", "nanmean", "nanmax", "nanmin", "nanmedian", "count_nonzero", "amax", "amin"]);
const SHAPE_OPS = new Set(["reshape", "ravel", "flatten", "transpose", "T", "swapaxes", "squeeze", "moveaxis", "expand_dims"]);

/** Last-axis-first alignment is for elementwise operators and ufuncs. */
function isElementwise(st: DataStage): boolean {
  if (st.kind === "binop") return st.op !== "@";
  if (st.kind === "compare") return true;
  return st.kind === "func" && UFUNCS.has(st.op);
}
const isMatmul = (st: DataStage) => (st.kind === "binop" && st.op === "@") || (st.kind === "func" && (st.op === "matmul" || st.op === "dot"));

/** Axis labels as the view writes them. */
export function axisLabel(axis: number, ndim: number): string {
  if (ndim === 1) return "axis 0";
  if (ndim === 2) return axis === 0 ? "axis 0 (down the rows)" : "axis 1 (across the columns)";
  return `axis ${axis}`;
}

/** Where one input cell goes in the result of a reduction: its coordinates with the reduced axes removed (or set to 0 with keepdims). */
export function reduceTarget(coords: readonly number[], axis: number[] | null, keepdims: boolean): number[] {
  const ax = axis ?? coords.map((_, i) => i);
  return keepdims ? coords.map((c, i) => (ax.includes(i) ? 0 : c)) : coords.filter((_, i) => !ax.includes(i));
}

/** Unravel a flat C-order position into coordinates. */
export function unravel(flat: number, shape: readonly number[]): number[] {
  const out = new Array<number>(shape.length);
  let r = flat;
  for (let i = shape.length - 1; i >= 0; i--) { out[i] = shape[i] ? r % shape[i] : 0; r = shape[i] ? Math.floor(r / shape[i]) : r; }
  return out;
}

export interface NdPlanes {
  /** One 2-D grid per plane; 1-D arrays are one row, 0-d arrays one cell. */
  planes: (string | null)[][][];
  /** Plane labels (e.g. "a[0, :, :]"); empty for arrays with 2 or fewer dimensions. */
  planeLabels: string[];
  rowLabels: string[];
  colLabels: string[];
}

/** Normalise a captured array into planes for drawing. */
export function ndPlanes(s: DataSnap): NdPlanes | null {
  if (s.k !== "nd" || s.data === undefined) return null;
  const nd = s.ndim ?? s.shape?.length ?? 0;
  const lead = s.lead ?? 0;
  if (nd === 0) return { planes: [[[s.data as string]]], planeLabels: [], rowLabels: [""], colLabels: [""] };
  if (nd === 1) { const row = s.data as (string | null)[]; return { planes: [[row]], planeLabels: [], rowLabels: [""], colLabels: row.map((_, i) => String(i)) }; }
  if (nd === 2) { const g = s.data as (string | null)[][]; return { planes: [g], planeLabels: [], rowLabels: g.map((_, i) => String(i)), colLabels: (g[0] ?? []).map((_, i) => String(i)) }; }
  const pl = s.data as (string | null)[][][];
  const lab = (i: number) => `[${[...Array(lead).fill("0"), String(i), ":", ":"].join(", ")}]`;
  return { planes: pl, planeLabels: pl.map((_, i) => lab(i)), rowLabels: (pl[0] ?? []).map((_, i) => String(i)), colLabels: (pl[0]?.[0] ?? []).map((_, i) => String(i)) };
}

function describeAxis(r: ReduceInfo): string {
  if (r.axis === null) return "all axes";
  return r.axis.map((a) => `axis ${a}`).join(" and ");
}

/** Predicted result shape of a reduction or an along-axis op. */
export function predictReduceShape(inShape: readonly number[], axis: number[] | null, keepdims: boolean, op: string): number[] {
  if (op === "cumsum" || op === "cumprod") return axis === null ? [prod(inShape)] : [...inShape];
  if (["sort", "argsort", "flip", "cummax", "cummin"].includes(op)) return [...inShape];
  const ax = axis ?? inShape.map((_, i) => i);
  return keepdims ? inShape.map((n, i) => (ax.includes(i) ? 1 : n)) : inShape.filter((_, i) => !ax.includes(i));
}

function factsOf(s: DataSnap): string {
  const sh = s.shape ?? [];
  return `shape ${numpyShape(sh)}, ${s.ndim ?? sh.length} dimension${(s.ndim ?? sh.length) === 1 ? "" : "s"}, size ${s.n ?? prod(sh)}, dtype ${s.dtype}`;
}

/** Check that each shown output cell equals the input cell its recorded position points to. */
function checkPositions(st: DataStage, checks: Check[]) {
  const inn = st.inputs[0], out = st.output;
  if (!st.pos || !inn || !out || inn.k !== "nd" || out.k !== "nd" || (inn.lead ?? 0) > 0 || (out.lead ?? 0) > 0) return;
  const src = st.pos.src, inShape = inn.shape ?? [];
  const inPl = ndPlanes(inn), outPl = ndPlanes(out);
  if (!inPl || !outPl) return;
  const nd = out.ndim ?? 0;
  const flatten = (v: unknown, dims: number): { idx: number[]; v: unknown }[] => {
    const res: { idx: number[]; v: unknown }[] = [];
    const walk = (x: unknown, path: number[]) => { if (path.length === dims) res.push({ idx: path, v: x }); else (x as unknown[]).forEach((y, i) => walk(y, [...path, i])); };
    walk(v, []);
    return res;
  };
  const cells = flatten(out.data, nd);
  const srcs = flatten(src, nd);
  let tested = 0, bad = 0;
  const inNd = inn.ndim ?? 0;
  const inVal = (coords: number[]): string | null | undefined => {
    if (inNd === 0) return inn.data as string;
    if (inNd === 1) return (inn.data as (string | null)[])[coords[0]];
    if (inNd === 2) return (inn.data as (string | null)[][])[coords[0]]?.[coords[1]];
    return (inn.data as (string | null)[][][])[coords[0]]?.[coords[1]]?.[coords[2]];
  };
  cells.forEach((c, i) => {
    const flat = srcs[i]?.v as number | undefined;
    if (flat === undefined) return;
    const val = inVal(unravel(flat, inShape));
    if (val === undefined) return; // outside the shown part of the input
    tested++;
    if (val !== c.v) bad++;
  });
  if (tested) checks.push({ name: "element positions agree with the values", ok: bad === 0, detail: `${tested} shown output cell${tested === 1 ? "" : "s"} compared with the input cell at their recorded position${bad ? `; ${bad} differ` : ""}.` });
}

function checkSnap(s: DataSnap, label: string, checks: Check[]) {
  if (s.k !== "nd" || !s.shape || !s.shown) return;
  const nd = s.shape.length;
  const lead = Math.max(0, nd - 3);
  const eff = s.shape.slice(lead);
  const okDims = s.shown.length === eff.length && s.shown.every((v, i) => v <= eff[i]);
  let okData = true;
  if (nd === 1) okData = (s.data as unknown[]).length === s.shown[0];
  else if (nd === 2) okData = (s.data as unknown[][]).length === s.shown[0] && (s.data as unknown[][]).every((r) => r.length === s.shown![1]);
  else if (nd >= 3) okData = (s.data as unknown[][][]).length === s.shown[0] && (s.data as unknown[][][]).every((p) => p.length === s.shown![1] && p.every((r) => r.length === s.shown![2]));
  checks.push({ name: `${label} grid fits its shape`, ok: okDims && okData && s.n === prod(s.shape), detail: `${numpyShape(s.shape)} has ${prod(s.shape)} elements; shown ${s.shown.join("x") || "scalar"}${s.more ? " (truncated)" : ""}.` });
}

/** Facts, explanation and checks for a stage whose inputs or output are NumPy arrays. */
export function analyzeNdStage(st: DataStage): NdAnalysis {
  const checks: Check[] = [];
  const out = st.output;
  const inn = st.inputs[0];
  const inShape = inn ? operandShape(inn) : null;
  const outShape = out ? operandShape(out) : null;
  let broadcast: BroadcastTable | null = null;
  let matmul: MatmulPlan | null = null;
  let reduce: ReduceInfo | null = null;
  let explanation = "";

  for (const s of st.inputs) checkSnap(s, "input", checks);
  if (out) checkSnap(out, "output", checks);

  const shapes = st.inputs.map(operandShape);
  const allOperands = shapes.length >= 2 && shapes.every((s): s is number[] => s !== null);
  const errText = st.error?.msg ?? null;

  if (isElementwise(st) && allOperands) {
    broadcast = alignShapes(shapes as number[][]);
    const cc = crossCheckBroadcast(broadcast, errText ? { errorText: errText } : { resultShape: outShape });
    // A non-broadcast failure (e.g. a TypeError) is reported as the error itself, not as a mismatch.
    if (!(errText && !/could not be broadcast/.test(errText))) checks.push(...cc.checks);
    explanation = errText
      ? broadcast.valid ? `NumPy raised ${st.error!.type}: ${errText.split("\n")[0]}` : `${broadcast.message} NumPy raised ValueError: ${errText.trim()}`
      : `${broadcast.message}${broadcast.rows.some((r) => r.status === "stretched") ? " Size-1 and missing dimensions are stretched to match; no data is copied for the stretch, NumPy repeats the values virtually." : ""}`;
    if (!errText && out?.dtype) explanation += ` Result dtype ${out.dtype}.`;
  } else if (isMatmul(st) && allOperands && shapes.every((s) => (s as number[]).length <= 2 || st.op !== "dot")) {
    matmul = planMatmul(shapes[0]!, shapes[1]!);
    const cc = crossCheckMatmul(matmul, errText ? { errorText: errText } : { resultShape: outShape });
    checks.push(...cc.checks);
    explanation = errText ? `${matmul.message} NumPy raised ValueError: ${errText.trim()}` : `${matmul.rule}. ${matmul.message}`;
  } else if (st.kind === "call" || st.kind === "func") {
    const nm = st.op;
    if (REDUCERS.has(nm) || ["cumsum", "cumprod", "sort", "argsort", "flip", "cummax", "cummin"].includes(nm)) {
      if (st.axis && inn?.k === "nd" && inShape) {
        reduce = { op: st.axis.op, axis: st.axis.axis, keepdims: st.axis.keepdims, inShape, predicted: predictReduceShape(inShape, st.axis.axis, st.axis.keepdims, nm) };
        if (out && !st.error && outShape) checks.push({ name: "reduction shape", ok: same(reduce.predicted, outShape), detail: `Removing ${describeAxis(reduce)} from ${numpyShape(inShape)} predicts ${numpyShape(reduce.predicted)}; NumPy returned ${numpyShape(outShape)}.` });
        explanation = st.axis.op === "reduce"
          ? `${nm} over ${describeAxis(reduce)}: ${numpyShape(inShape)} → ${out ? numpyShape(outShape ?? []) : "?"}. ${reduce.axis === null ? "Every element is combined into one value." : `Each result combines the elements that share the other index; ${describeAxis(reduce)} disappears${reduce.keepdims ? " (kept as size 1)" : ""}.`}`
          : `${nm} runs along ${describeAxis(reduce)}; the shape stays ${numpyShape(outShape ?? inShape)}.`;
      } else if (inn?.k === "nd" && inShape && out && outShape) {
        explanation = `${nm}: ${numpyShape(inShape)} → ${numpyShape(outShape)}.`;
      }
    } else if (SHAPE_OPS.has(nm) && inn?.k === "nd" && out?.k === "nd" && inn.shape && out.shape) {
      checks.push({ name: "element count unchanged", ok: inn.n === out.n, detail: `${inn.n} → ${out.n} elements.` });
      explanation = `${nm}: same ${inn.n} elements, shape ${numpyShape(inn.shape)} → ${numpyShape(out.shape)}.${st.view === true ? " The result is a view: it shares memory with the original." : st.view === false ? " The result is a copy." : ""}`;
    }
  }

  if (!explanation && st.kind === "attr" && inn?.k === "nd" && out) {
    if (st.op === "T" && out.k === "nd" && inn.shape && out.shape) {
      checks.push({ name: "T reverses the shape", ok: same([...inn.shape].reverse(), out.shape), detail: `${numpyShape(inn.shape)} → ${numpyShape(out.shape)}.` });
      explanation = `Transpose: axes are swapped, shape ${numpyShape(inn.shape)} → ${numpyShape(out.shape)}. It is a view; no data moves.`;
    } else explanation = `${st.code} is ${out.r}${out.dtype ? ` (${out.dtype})` : ""}.`;
  }
  if (!explanation && st.kind === "select" && inn?.k === "nd" && out) {
    if (out.k === "nd" && inn.shape && out.shape) {
      const picked = st.pos ? "selected" : "selects";
      explanation = `Indexing ${st.code}: ${numpyShape(inn.shape)} → ${numpyShape(out.shape)} (${out.n} element${out.n === 1 ? "" : "s"} ${picked}).${st.view === true ? " Basic slicing returns a view: writing to it changes the original." : st.view === false ? " Boolean or list indexing returns a copy." : ""}`;
    } else explanation = `Indexing ${st.code} picks one element: ${out.r}${out.dtype ? ` (${out.dtype})` : ""}.`;
  }
  if (!explanation && st.kind === "unary" && inn?.k === "nd") explanation = `${st.op} applied to every element; shape ${numpyShape(inShape ?? [])} is unchanged.`;
  if (!explanation && out?.k === "nd" && st.kind === "func") {
    explanation = st.inputs.length === 0 ? `Creates an array: ${factsOf(out)}.` : `${st.code} returns an array: ${factsOf(out)}.`;
  }
  if (!explanation && st.kind === "change" && out?.k === "nd") {
    explanation = inn ? `In-place change of ${st.assignedTo ?? "the array"}: ${st.stmt}. Shape ${numpyShape(inShape ?? [])} → ${numpyShape(outShape ?? [])}; the highlighted cells changed.${st.unchanged ? " Nothing changed." : ""}` : `Creates ${st.assignedTo ?? "an array"}: ${factsOf(out)}.`;
  }
  if (!explanation && out) explanation = out.k === "nd" ? `${st.code} gives ${factsOf(out)}.` : `${st.code} gives ${out.r}.`;

  checkPositions(st, checks);
  return { broadcast, matmul, reduce, explanation, checks };
}

// ── Reproducibility ────────────────────────────────────────────────────────

export interface SeedInfo {
  /** Seeds found in the code text (np.random.seed(n), default_rng(n), RandomState(n)). */
  seeds: number[];
  /** True when random numbers are used without any seed: the output changes on every run. */
  unseeded: boolean;
}

/** Static scan of the code text. It states what the code says; the run itself is the proof that output is reproducible. */
export function seedInfo(code: string): SeedInfo {
  const src = code.replace(/#.*$/gm, "");
  const seeds = [...src.matchAll(/(?:random\.seed|default_rng|RandomState|SeedSequence|Generator\(\s*\w+\(|manual_seed)\s*\(\s*(\d+)\s*\)/g)].map((m) => Number(m[1]));
  const usesRandom = /\b(?:np|numpy)\.random\.(?:rand|randn|randint|random|random_sample|normal|uniform|choice|permutation|shuffle|standard_normal|binomial|poisson)\s*\(|\bdefault_rng\s*\(|\.(?:integers|standard_normal)\s*\(/.test(src);
  return { seeds: [...new Set(seeds)], unseeded: usesRandom && seeds.length === 0 };
}
