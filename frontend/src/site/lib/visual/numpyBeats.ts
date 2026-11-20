/**
 * NumPy beats: the sequences a learner steps through for one NumPy stage. Pure: a stage and its analysis in, beats out. Nothing runs.
 *
 * Operations with a dedicated sequence (everything else uses the generic beat, which is a real four-part story from the stage's analysis):
 *
 *   element-wise ops, + - * / // % ** & | ^, comparisons and the matching ufuncs (np.add, np.greater, np.maximum ...), with two operands
 *     (arrays or scalars, at least one array)    arrays > shapes > align > stretch > calculate > result
 *     "stretch" is left out when no operand changes shape; "calculate" is left out for a ufunc the calculator does not know
 *     (hypot, arctan2 ...). A failing broadcast gives arrays > shapes > align (conflict marked) > NumPy's error, and no calculation.
 *   matrix multiplication (@, np.matmul, np.dot) of 1-D or 2-D operands
 *                                              arrays > rule > one beat per output cell (at most MATMUL_CELL_CAP, labelled as sampled
 *                                              beyond it) > result. A failing one gives arrays > rule (inner sizes marked) > error.
 *   axis reductions sum mean min max prod std var median any all (+ amin/amax), with axis=0/1/None and keepdims, on 1-D and 2-D arrays
 *                                              array > axis (the collapsing axis, the group each cell feeds) > groups (the values that
 *                                              participate in each output element, at most LANE_CAP) > result
 *   indexing and slicing, basic, fancy (list) and boolean masks, on 1-D and 2-D arrays
 *                                              array > [mask] > selection (the chosen cells and their positions) > result (with origins)
 *   reshape, ravel, flatten, squeeze, transpose, .T, swapaxes, moveaxis (1-D and 2-D)
 *                                              array > regroup / swap (each cell's source and destination) > result (view or copy)
 *
 * Not dedicated (generic beat): array creation, astype, cumsum/sort/flip (along-axis), concatenate/stack, where, unary ufuncs
 * (np.sqrt ...), argmin/argmax, in-place changes, arrays with 3 or more dimensions, matmul with batch dimensions.
 *
 * Rules every beat follows:
 *  - Only recorded data is used: the 'nd' snapshots (windows: 12 values for 1-D, 10 x 10 for 2-D), shapes, dtype, the broadcast table,
 *    the matmul plan, the axis info and `pos` (src / sel). A beat whose data is missing is not produced.
 *  - Every calculation the pictures show is recomputed from the REAL operand windows and compared with the REAL result window
 *    (exact for integer and boolean results; for floats within the 6-decimal rounding the probe applies when it records a cell).
 *    If any shown cell disagrees, the beat carries `ok: false` and the problems, and draws no calculation.
 *  - A window of a larger array is flagged (`windowed`) so the picture says so; numbers in stories come from the exact shapes.
 */
import type { DataSnap, DataStage, StageAnalysis } from "./dataframe";
import type { BeatBuilder, BeatView, DataBeat } from "./dataBeats";
import { operandIndex, pyShape, type BroadcastTable } from "./broadcast";
import { reduceTarget, unravel } from "./ndarray";
import { clip, plural, STORY_MAX, type StepStory } from "./story";

export const MATMUL_CELL_CAP = 6;
export const LANE_CAP = 12;

// ── Data model of the pictures ────────────────────────────────────────────────

export type Cell = string | null;
/** A captured scalar, vector or matrix as a 2-D window of cells. A 1-D array is one row; a scalar one cell. */
export interface Mat { shape: number[]; shown: number[]; cells: Cell[][]; windowed: boolean; dtype: string; scalar: boolean }
export interface Operand { label: string; expr: string | null; mat: Mat }

interface V extends BeatView { owner: "numpy" }
export interface ArraysView extends V { type: "arrays"; items: Operand[] }
export interface ShapesView extends V { type: "shapes"; items: { label: string; shape: number[]; size: number; dtype: string; scalar: boolean }[] }
export interface AlignView extends V { type: "align"; table: BroadcastTable; labels: string[]; padded: number[][]; error: string | null }
export interface ExpandItem { label: string; from: number[]; padded: number[]; to: number[]; mat: Mat; repeated: boolean[][]; stretched: number[]; changed: boolean }
export interface ExpandView extends V { type: "expand"; items: ExpandItem[]; resultShape: number[]; windowed: boolean }
export interface CalcCell { coords: number[]; a: Cell; b: Cell; res: Cell; text: string }
export interface ComputeView extends V { type: "compute"; sym: string; grid: Mat; cells: CalcCell[]; total: number; ok: boolean; problems: string[] }
export interface ResultView extends V {
  type: "result"; name: string; out: Mat; shape: number[]; dtype: string;
  /** Per window cell, the input coordinates it came from (indexing, reshape, transpose). */
  origins: (number[] | null)[][] | null; memory: "view" | "copy" | null; ok: boolean; problems: string[];
}
export interface ErrorView extends V { type: "error"; errorType: string; message: string; reason: string; /** The failed operation was a matrix multiplication (the inner sizes differ). */ matmul?: boolean }
export interface MatmulRuleView extends V { type: "mm-rule"; a: number[]; b: number[]; inner: { a: number; b: number } | null; valid: boolean; result: number[] | null; rule: string }
export interface MatmulCellView extends V {
  type: "mm-cell"; a: Mat; b: Mat; out: Mat; row: number | null; col: number | null; outCoords: number[];
  aVals: Cell[]; bVals: Cell[]; products: string[]; sum: Cell;
  seq: number; seqOf: number; total: number; sampled: boolean; done: number[][]; ok: boolean; problems: string[];
}
export interface AxisView extends V {
  type: "axis"; op: string; input: Mat; axis: number[] | null; keepdims: boolean; inShape: number[]; outShape: number[];
  /** Per window cell: which output element it feeds (the same numbering ArrayView colours by), or null when the lane is not recorded. */
  groups: number[][]; groupCount: number;
}
export interface Lane { out: number[]; label: string; coords: number[][]; values: Cell[]; result: Cell; text: string; group: number }
export interface LanesView extends V { type: "lanes"; op: string; lanes: Lane[]; total: number; sampled: boolean; ok: boolean; problems: string[] }
export interface SelectView extends V {
  type: "select"; mode: "mask" | "element" | "basic" | "fancy"; expr: string; input: Mat; selected: number[][]; count: number; total: number; ok: boolean; problems: string[];
}
export interface MaskView extends V { type: "mask"; expr: string; input: Mat; mask: Mat; trueCount: number; ok: boolean; problems: string[] }
export interface Move { from: number[]; to: number[]; flat: number; value: Cell; inWindow: boolean }
export interface MoveView extends V {
  type: "move"; mode: "regroup" | "swap"; op: string; input: Mat; out: Mat; moves: Move[]; orderPreserved: boolean; swapped: boolean; ok: boolean; problems: string[];
}
export type NumpyView = ArraysView | ShapesView | AlignView | ExpandView | ComputeView | ResultView | ErrorView | MatmulRuleView | MatmulCellView | AxisView | LanesView | SelectView | MaskView | MoveView;

// ── Small helpers ─────────────────────────────────────────────────────────────

const prod = (a: readonly number[]) => a.reduce((x, y) => x * y, 1);
const sameShape = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const padLeft = (s: readonly number[], n: number) => [...Array<number>(Math.max(0, n - s.length)).fill(1), ...s];
const coordsText = (c: readonly number[]) => `[${c.join(", ")}]`;

/** A recorded array (1-D or 2-D, first window) or scalar as a Mat. Null for anything else: those stages use the generic beat. */
export function matOf(s: DataSnap | null | undefined): Mat | null {
  if (!s) return null;
  if (s.k === "int" || s.k === "float" || s.k === "bool") return { shape: [], shown: [], cells: [[s.r]], windowed: false, dtype: s.dtype ?? `Python ${s.k}`, scalar: true };
  if (s.k !== "nd" || !s.shape || s.data === undefined || (s.lead ?? 0) > 0) return null;
  const nd = s.shape.length;
  const dtype = s.dtype ?? "unknown";
  if (nd === 0) return { shape: [], shown: [], cells: [[s.data as Cell]], windowed: false, dtype, scalar: true };
  if (nd === 1) { const row = s.data as Cell[]; return { shape: [...s.shape], shown: [row.length], cells: [row], windowed: row.length < s.shape[0], dtype, scalar: false }; }
  if (nd === 2) { const g = s.data as Cell[][]; return { shape: [...s.shape], shown: [g.length, g[0]?.length ?? 0], cells: g, windowed: g.length < s.shape[0] || (g[0]?.length ?? 0) < s.shape[1], dtype, scalar: false }; }
  return null;
}

/** The cell at array coordinates: undefined when it lies outside the recorded window. */
export function cellAt(m: Mat, idx: readonly number[]): Cell | undefined {
  if (idx.length !== m.shape.length) return undefined;
  if (idx.length === 0) return m.cells[0]?.[0];
  if (idx.length === 1) return m.cells[0]?.[idx[0]];
  return m.cells[idx[0]]?.[idx[1]];
}

/** Coordinates of every window cell in reading order: [], [c] or [r, c] by dimension. */
export function windowCoords(m: Mat): { r: number; c: number; idx: number[] }[] {
  const out: { r: number; c: number; idx: number[] }[] = [];
  m.cells.forEach((row, r) => row.forEach((_, c) => out.push({ r, c, idx: m.shape.length === 0 ? [] : m.shape.length === 1 ? [c] : [r, c] })));
  return out;
}

const isIntDtype = (d: string) => /^(u?int|bool)/.test(d) || d === "Python int" || d === "Python bool";
const NAN_WORDS = /^(nan|\+?inf|-inf)$/i;

/** A recorded cell as a number. NaN for a missing value, undefined when the text is not a plain number. */
export function num(c: Cell | undefined): number | undefined {
  if (c === undefined) return undefined;
  if (c === null) return NaN;
  if (c === "True") return 1;
  if (c === "False") return 0;
  if (NAN_WORDS.test(c)) return /^nan$/i.test(c) ? NaN : /^-/.test(c) ? -Infinity : Infinity;
  return /^[-+]?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(c) ? Number(c) : undefined;
}

/** Equality of a recomputed number and a recorded one: exact for integers and booleans, within the probe's 6-decimal rounding for floats. */
function agrees(x: number, y: number, exact: boolean, magnitude: number): boolean {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) && Number.isNaN(y);
  if (x === y) return true;
  if (exact) return false;
  return Math.abs(x - y) <= 1e-6 * (1 + magnitude);
}

const show = (c: Cell | undefined) => (c === null || c === undefined ? "NaN" : c);
/** A cell as a word in a story: never the raw missing-value text. */
const word = (c: Cell | undefined) => (c === null || c === undefined || NAN_WORDS.test(c) ? "a missing value" : c);
const storyable = (...cs: (Cell | undefined)[]) => cs.every((c) => c !== null && c !== undefined && !NAN_WORDS.test(c));

function fmtNum(x: number, intLike: boolean): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x < 0 ? "-inf" : "inf";
  if (intLike) return String(x);
  const t = Number(x.toPrecision(10));
  return Number.isInteger(t) && Math.abs(t) < 1e15 ? t.toFixed(1) : String(t);
}

const story = (what: string, changed: string, why: string, remember: string): StepStory => ({ what: clip(what, STORY_MAX), changed: clip(changed, STORY_MAX), why: clip(why, STORY_MAX), remember: clip(remember, STORY_MAX) });
const mkBeat = (index: number, k: number, title: string, s: StepStory, view: NumpyView): DataBeat => ({ id: `${index}.${k}`, stage: index, beat: k, of: 1, title, story: s, view });
const windowNote = (m: Mat) => (m.windowed ? ` The picture is a window: the first ${m.shown.join(" × ")} cells of the real ${pyShape(m.shape)} array.` : "");
const ndWord = (n: number) => (n === 0 ? "a scalar" : n === 1 ? "a 1-D array" : n === 2 ? "a 2-D array" : `a ${n}-D array`);
const describe = (m: Mat) => (m.scalar ? `the scalar ${m.cells[0][0]}` : `an array of shape ${pyShape(m.shape)}`);

/** The two operand expressions of `a + b` or `np.add(a, b)`, for the labels. Null when the text is not that simple. */
export function operandTexts(st: DataStage): [string, string] | null {
  const code = st.code.trim();
  const split = (text: string, sep: (s: string, i: number) => number): string[] => {
    const parts: string[] = [];
    let depth = 0, from = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      else if (depth === 0) {
        const w = sep(text, i);
        if (w > 0) { parts.push(text.slice(from, i)); from = i + w; i += w - 1; }
      }
    }
    parts.push(text.slice(from));
    return parts.map((p) => p.trim());
  };
  let parts: string[] | null = null;
  if (st.kind === "binop" || st.kind === "compare") {
    const opText = ` ${st.op} `;
    const p = split(code, (s, i) => (s.startsWith(opText, i) ? opText.length : 0));
    if (p.length === 2) parts = p;
  } else if (st.kind === "func") {
    const m = /^[\w.]+\((.*)\)$/s.exec(code);
    if (m) { const p = split(m[1], (s, i) => (s[i] === "," ? 1 : 0)); if (p.length === 2) parts = p; }
  }
  return parts && parts.every((p) => p.length > 0) ? [clip(parts[0], 24), clip(parts[1], 24)] : null;
}

// ── Element-wise operations ───────────────────────────────────────────────────

interface BinOp { sym: string; call: boolean; fn: (a: number, b: number) => number }
const int32 = (x: number) => Number.isInteger(x) && Math.abs(x) < 2 ** 31;
const BIN: Record<string, BinOp> = {};
const defBin = (names: string[], sym: string, fn: BinOp["fn"], call = false) => names.forEach((n) => { BIN[n] = { sym, call, fn }; });
defBin(["+", "add"], "+", (a, b) => a + b);
defBin(["-", "subtract"], "-", (a, b) => a - b);
defBin(["*", "multiply"], "*", (a, b) => a * b);
defBin(["/", "divide", "true_divide"], "/", (a, b) => a / b);
defBin(["//", "floor_divide"], "//", (a, b) => Math.floor(a / b));
defBin(["%", "mod", "remainder"], "%", (a, b) => (b === 0 ? NaN : a - Math.floor(a / b) * b));
defBin(["**", "power"], "**", (a, b) => Math.pow(a, b));
defBin([">", "greater"], ">", (a, b) => (a > b ? 1 : 0));
defBin(["<", "less"], "<", (a, b) => (a < b ? 1 : 0));
defBin([">=", "greater_equal"], ">=", (a, b) => (a >= b ? 1 : 0));
defBin(["<=", "less_equal"], "<=", (a, b) => (a <= b ? 1 : 0));
defBin(["==", "equal"], "==", (a, b) => (a === b ? 1 : 0));
defBin(["!=", "not_equal"], "!=", (a, b) => (a !== b ? 1 : 0));
defBin(["maximum"], "maximum", (a, b) => (Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.max(a, b)), true);
defBin(["minimum"], "minimum", (a, b) => (Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.min(a, b)), true);
defBin(["logical_and"], "and", (a, b) => (a !== 0 && b !== 0 ? 1 : 0));
defBin(["logical_or"], "or", (a, b) => (a !== 0 || b !== 0 ? 1 : 0));
defBin(["&"], "&", (a, b) => (int32(a) && int32(b) ? a & b : NaN));
defBin(["|"], "|", (a, b) => (int32(a) && int32(b) ? a | b : NaN));
defBin(["^"], "^", (a, b) => (int32(a) && int32(b) ? a ^ b : NaN));

const pairText = (op: BinOp, a: string, b: string) => (op.call ? `${op.sym}(${a}, ${b})` : `${a} ${op.sym} ${b}`);

/** The two window cells an element-wise result cell combines, found by broadcasting the result coordinates back to each operand. */
function operandCells(mats: Mat[], idx: number[]): [Cell | undefined, Cell | undefined] {
  const [a, b] = mats;
  return [cellAt(a, operandIndex(idx, a.shape)), cellAt(b, operandIndex(idx, b.shape))];
}

interface Calc { cells: CalcCell[]; ok: boolean; problems: string[] }
/** Recompute every result window cell from the operand windows and compare it with the recorded result. Null when it cannot be done honestly. */
function calculate(op: BinOp, mats: Mat[], out: Mat): Calc | null {
  const cells: CalcCell[] = [];
  const problems: string[] = [];
  const exact = isIntDtype(out.dtype);
  for (const { r, c, idx } of windowCoords(out)) {
    const [a, b] = operandCells(mats, idx);
    if (a === undefined || b === undefined) return null;
    const x = num(a), y = num(b), real = num(out.cells[r][c]);
    if (x === undefined || y === undefined || real === undefined) return null;
    const v = op.fn(x, y);
    if (exact && !Number.isFinite(v)) return null; // integer overflow or division by zero: NumPy's integer result is not what JavaScript computes
    if (exact && Math.abs(v) > Number.MAX_SAFE_INTEGER) return null;
    if (!agrees(v, real, exact, Math.abs(x) + Math.abs(y) + (Number.isFinite(real) ? Math.abs(real) : 0))) problems.push(`result ${coordsText(idx)}: ${pairText(op, show(a), show(b))} is ${fmtNum(v, exact)}, but NumPy's result cell is ${show(out.cells[r][c])}`);
    cells.push({ coords: idx, a, b, res: out.cells[r][c], text: `${pairText(op, show(a), show(b))} = ${show(out.cells[r][c])}` });
  }
  return { cells, ok: problems.length === 0, problems };
}

const axisPhrase = (d: number, nd: number) => (nd === 2 ? (d === 0 ? "down the rows" : "across the columns") : `along axis ${d}`);

function repeatPhrase(it: ExpandItem, nd: number): string {
  if (it.from.length === 0) return `${it.label} (the scalar) is repeated in every cell`;
  const how = it.stretched.map((d) => axisPhrase(d, nd)).join(" and ");
  return `${it.label} ${pyShape(it.from)}${it.padded.length !== it.from.length ? ` (as ${pyShape(it.padded)})` : ""} is repeated ${how} to ${pyShape(it.to)}`;
}

function elementwiseBeats(st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null {
  const bc = an.nd?.broadcast;
  if (!bc || st.inputs.length !== 2 || bc.shapes.length !== 2) return null;
  const mats = st.inputs.map(matOf);
  if (mats.some((m) => !m) || !mats.some((m) => m!.shape.length > 0)) return null;
  const ms = mats as Mat[];
  const failing = !!st.error;
  if (failing && (bc.valid || !/could not be broadcast/.test(st.error!.msg))) return null;
  if (!failing && !bc.valid) return null;
  const out = failing ? null : matOf(st.output);
  if (!failing && (!out || !bc.resultShape || !sameShape(out.shape, bc.resultShape) || out.scalar)) return null;

  const texts = operandTexts(st);
  const labels = ["A", "B"];
  const items: Operand[] = ms.map((m, i) => ({ label: labels[i], expr: texts?.[i] ?? null, mat: m }));
  const code = clip(st.code, 40);
  const op = BIN[st.op];
  const nd = bc.ndim;
  const padded = ms.map((m) => padLeft(m.shape, nd));
  const beats: DataBeat[] = [];
  const add = (title: string, s: StepStory, view: NumpyView) => beats.push(mkBeat(index, beats.length, title, s, view));
  const total = (m: Mat) => (m.scalar ? 1 : prod(m.shape));

  // 1 arrays
  add("Arrays",
    story(`Before ${code} runs, here are its two real operands: A is ${describe(ms[0])} and B is ${describe(ms[1])}.`,
      `Nothing has been calculated yet. A holds ${plural(total(ms[0]), "value")} and B holds ${plural(total(ms[1]), "value")}; every cell is drawn with its position.${ms.some((m) => m.windowed) ? " Large arrays are drawn as a window." : ""}`,
      "NumPy decides what to do from the shapes of the arrays first, and only then touches the values.",
      "Before combining arrays, write down both shapes."),
    { owner: "numpy", type: "arrays", items });

  // 2 shapes
  const same = sameShape(ms[0].shape, ms[1].shape);
  add("Shapes",
    story(`A has shape ${pyShape(ms[0].shape)} and B has shape ${pyShape(ms[1].shape)}.`,
      same ? `The shapes are identical, so every cell of A has a partner in the same position of B.` : `A is ${ndWord(ms[0].shape.length)} of ${plural(total(ms[0]), "element")}; B is ${ndWord(ms[1].shape.length)} of ${plural(total(ms[1]), "element")}. The shapes differ, so NumPy compares them axis by axis.`,
      "The shape lists the size of each axis, and its length is the number of axes. A size of 1 on an axis is still an axis.",
      "A shape is a tuple: count its numbers to know how many axes the array has."),
    { owner: "numpy", type: "shapes", items: items.map((it) => ({ label: it.label, shape: it.mat.shape, size: total(it.mat), dtype: it.mat.dtype, scalar: it.mat.scalar })) });

  // 3 alignment
  const padNote = padded.map((p, i) => (p.length !== ms[i].shape.length ? `${labels[i]} ${ms[i].scalar ? "(a scalar)" : pyShape(ms[i].shape)} is treated as ${pyShape(p)}` : "")).filter(Boolean);
  const rowText = (r: BroadcastTable["rows"][number]) => `axis ${-(r.fromRight + 1)}: ${r.cells.map((c) => c.size ?? 1).join(" and ")}${r.status === "incompatible" ? ", no match" : r.status === "stretched" ? `, the 1 stretches to ${r.resultSize}` : " match"}`;
  if (bc.valid) {
    add("Align shapes",
      story(`Line the shapes up from the right${padNote.length ? `: ${padNote.join("; ")}` : `: both already have ${nd} ${nd === 1 ? "axis" : "axes"}`}.`,
        `${bc.rows.map(rowText).join("; ")}. Result shape ${pyShape(bc.resultShape!)}.`,
        "Two sizes are compatible when they are equal or one of them is 1. A missing leading axis counts as 1.",
        "Compare shapes from the right, not from the left."),
      { owner: "numpy", type: "align", table: bc, labels, padded, error: null });
  } else {
    const c = bc.conflicts[0];
    const sizes = c.sizes.map((s) => `${labels[s.operand]} has ${s.size}`).join(" and ");
    const fine = bc.rows.filter((r) => r.status !== "incompatible").map(rowText);
    add("Conflict",
      story(`Lined up from the right, axis ${c.axisNegative} cannot match: ${sizes}, and neither is 1.`,
        `${bc.conflicts.length > 1 ? `${bc.conflicts.length} axes conflict; the first from the right is axis ${c.axisNegative}. ` : ""}${fine.length ? `${fine.join("; ")}. ` : ""}No result shape exists, so nothing is calculated.`,
        `NumPy only repeats a size-1 axis. It never guesses how to turn ${c.sizes[0].size} into ${c.sizes[1]?.size ?? "the other size"}.`,
        "To fix it, make the two sizes equal, or reshape one array so that axis has size 1."),
      { owner: "numpy", type: "align", table: bc, labels, padded, error: st.error!.msg });
    const c0 = c.sizes;
    add("NumPy's error",
      story(`NumPy stops with ${st.error!.type}: the operands cannot be broadcast together.`,
        `No array is created. NumPy said: ${clip(st.error!.msg.trim(), 150)}.`,
        `The message lists the shapes ${bc.shapes.map((s) => pyShape(s)).join(" and ")}. On axis ${c.axisNegative} the sizes are ${c0.map((s) => s.size).join(" and ")}, which differ and neither is 1.`,
        "Read the shapes in the message: the first axis from the right whose sizes differ is the culprit."),
      { owner: "numpy", type: "error", errorType: st.error!.type, message: st.error!.msg, reason: `axis ${c.axisNegative}: ${c0.map((s) => `${labels[s.operand]} has ${s.size}`).join(", ")}` });
    return beats;
  }

  const outM = out!;
  // 4 stretch
  const exp: ExpandItem[] = ms.map((m, i) => {
    const to = bc.resultShape!;
    const stretched = padded[i].map((n, d) => (n !== to[d] ? d : -1)).filter((d) => d >= 0);
    const win = windowCoords(outM);
    const cells: Cell[][] = outM.cells.map((row) => row.map(() => null));
    const repeated: boolean[][] = outM.cells.map((row) => row.map(() => false));
    let missing = false;
    for (const { r, c, idx } of win) {
      const v = cellAt(m, operandIndex(idx, m.shape));
      if (v === undefined) missing = true; else cells[r][c] = v;
      repeated[r][c] = padded[i].some((n, d) => n === 1 && to[d] > 1 && idx[d] > 0);
    }
    return { label: labels[i], from: m.shape, padded: padded[i], to, mat: missing ? { ...outM, cells: [] } : { ...outM, cells, dtype: m.dtype }, repeated, stretched, changed: !sameShape(m.shape, to) };
  });
  if (exp.some((e) => e.mat.cells.length === 0)) return null;
  if (exp.some((e) => e.changed)) {
    const clauses = exp.filter((e) => e.changed).map((e) => repeatPhrase(e, nd));
    add("Stretch",
      story(`To combine them, NumPy stretches the arrays to the common shape ${pyShape(bc.resultShape!)}: ${clauses.join("; ")}.`,
        `${exp.map((e) => e.label).join(" and ")} now each have ${plural(prod(bc.resultShape!), "cell")} (shape ${pyShape(bc.resultShape!)}). The highlighted cells are repeats of an original value; nothing is copied in memory.${outM.windowed ? ` Only the first ${outM.shown.join(" × ")} cells are drawn.` : ""}`,
        "Broadcasting treats a size-1 axis as if it were repeated, so NumPy needs no loop and no tiled copy.",
        "Stretching is virtual: the repeated values are not stored again."),
      { owner: "numpy", type: "expand", items: exp, resultShape: bc.resultShape!, windowed: outM.windowed });
  }

  // 5 calculate
  if (op) {
    const calc = calculate(op, ms, outM);
    if (calc) {
      const ex = calc.cells.slice(0, 2).map((c) => c.text);
      const exStory = calc.cells.length && calc.cells.slice(0, 2).every((c) => storyable(c.a, c.b, c.res)) ? ` For example result ${coordsText(calc.cells[0].coords)} = ${ex[0]}${ex[1] ? `, then result ${coordsText(calc.cells[1].coords)} = ${ex[1]}` : ""}.` : "";
      const gen = op.call ? `${op.sym}(A[i, j], B[i, j])` : `A[i, j] ${op.sym} B[i, j]`;
      add("Calculate",
        calc.ok
          ? story(`Apply ${op.sym} to every pair of cells: result[i, j] = ${gen}.`,
            `${plural(calc.cells.length, "cell")} calculated${calc.cells.length < outM.shape.reduce((x, y) => x * y, 1) ? ` of ${prod(outM.shape)} (the window drawn)` : ""}, and every one equals NumPy's real result.${exStory}`,
            "After stretching, both arrays have the same shape, so NumPy pairs the cells by position. The cells do not depend on each other.",
            `Broadcast first, then calculate position by position.`)
          : story(`The calculation did not match NumPy's real result, so it is not drawn.`,
            `${plural(calc.problems.length, "cell")} disagreed: ${clip(calc.problems[0], 150)}.`,
            "The pictures only show a calculation that reproduces the recorded result exactly.",
            "Trust the recorded result below, and report this step if it keeps happening."),
        { owner: "numpy", type: "compute", sym: op.sym, grid: outM, cells: calc.ok ? calc.cells : [], total: prod(outM.shape), ok: calc.ok, problems: calc.problems });
    }
  }

  // 6 result
  const inDtypes = [...new Set(ms.map((m) => m.dtype))];
  const dtypeNote = inDtypes.length === 1 && inDtypes[0] === outM.dtype ? `dtype stays ${outM.dtype}` : `dtype ${inDtypes.join(" and ")} → ${outM.dtype}`;
  add("Result",
    story(`The result is the (${outM.shape.join(", ")}) array${st.assignedTo ? ` stored in ${st.assignedTo}` : ""}.`,
      `Shape ${pyShape(ms[0].shape)} and ${pyShape(ms[1].shape)} → ${pyShape(outM.shape)}: ${plural(prod(outM.shape), "element")}; ${dtypeNote}.${outM.windowed ? ` The picture shows the first ${outM.shown.join(" × ")} cells.` : ""}`,
      "The result takes the larger size on every axis. Its dtype follows NumPy's promotion rules for the two operands.",
      "Check result.shape after a broadcast to confirm it is the shape you meant."),
    { owner: "numpy", type: "result", name: st.assignedTo ?? "result", out: outM, shape: outM.shape, dtype: outM.dtype, origins: null, memory: null, ok: true, problems: [] });
  return beats;
}

// ── Matrix multiplication ─────────────────────────────────────────────────────

function matmulBeats(st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null {
  const plan = an.nd?.matmul;
  if (!plan || st.inputs.length !== 2 || !plan.inner) return null;
  const ms = st.inputs.map(matOf);
  if (ms.some((m) => !m || m.shape.length < 1 || m.shape.length > 2)) return null;
  const [a, b] = ms as Mat[];
  const failing = !!st.error;
  if (failing && (plan.valid || !/mismatch in its core dimension|not aligned/.test(st.error!.msg))) return null;
  if (!failing && !plan.valid) return null;
  const out = failing ? null : matOf(st.output);
  if (!failing && (!out || !plan.resultShape || !sameShape(out.shape, plan.resultShape))) return null;
  const texts = operandTexts(st);
  const labels = ["A", "B"];
  const items: Operand[] = [a, b].map((m, i) => ({ label: labels[i], expr: texts?.[i] ?? null, mat: m }));
  const beats: DataBeat[] = [];
  const add = (title: string, s: StepStory, view: NumpyView) => beats.push(mkBeat(index, beats.length, title, s, view));
  const code = clip(st.code, 40);
  add("Arrays",
    story(`Before ${code} runs, here are the two real matrices: A has shape ${pyShape(a.shape)} and B has shape ${pyShape(b.shape)}.`,
      `Nothing has been multiplied yet. A holds ${plural(prod(a.shape), "value")} and B holds ${plural(prod(b.shape), "value")}.${a.windowed || b.windowed ? " Large arrays are drawn as a window." : ""}`,
      "Matrix multiplication combines whole rows of A with whole columns of B, so the sizes along those lines must agree.",
      "Write the shapes as (m, n) @ (n, p) before multiplying."),
    { owner: "numpy", type: "arrays", items });
  const { inner } = plan;
  if (!plan.valid) {
    add("Inner sizes differ",
      story(`A has ${inner.a} ${a.shape.length === 1 ? "elements" : "columns"} but B has ${inner.b} ${b.shape.length === 1 ? "elements" : "rows"}: the inner sizes ${inner.a} and ${inner.b} differ.`,
        `No result shape exists, so no row of A can be paired with a column of B. Nothing is multiplied.`,
        "Each result cell multiplies a row of A with a column of B pair by pair, so both must have the same length.",
        "For (m, n) @ (n, p) the two inner sizes must be equal."),
      { owner: "numpy", type: "mm-rule", a: a.shape, b: b.shape, inner, valid: false, result: null, rule: plan.rule });
    add("NumPy's error",
      story(`NumPy stops with ${st.error!.type}: the matrices are not aligned.`,
        `No array is created. NumPy said: ${clip(st.error!.msg.trim(), 170)}.`,
        `The inner sizes are ${inner.a} (A's last axis) and ${inner.b} (B's ${b.shape.length === 1 ? "only axis" : "first axis"}); they must be equal.`,
        "If the inner sizes differ, transpose one matrix (.T) or fix the shapes that built it."),
      { owner: "numpy", type: "error", errorType: st.error!.type, message: st.error!.msg, reason: `inner sizes ${inner.a} and ${inner.b}`, matmul: true });
    return beats;
  }
  const res = plan.resultShape!;
  const outM = out!;
  add("Rule",
    story(`A's last axis (${inner.a}) matches B's ${b.shape.length === 1 ? "only axis" : "first axis"} (${inner.b}), so the matrices can be multiplied.`,
      `${pyShape(a.shape)} @ ${pyShape(b.shape)} → ${pyShape(res)}: the inner size ${inner.a} is summed away and the result has shape ${pyShape(res)}${res.length ? `, so ${plural(prod(res), "cell")}` : ", a single number"}, each the sum of ${plural(inner.a, "product")}.`,
      "Each result cell is the dot product of one row of A with one column of B: multiply the pairs, then add them up.",
      "(m, n) @ (n, p) gives (m, p): the inner n disappears."),
    { owner: "numpy", type: "mm-rule", a: a.shape, b: b.shape, inner, valid: true, result: res, rule: plan.rule });

  // one beat per output cell, from the recorded windows
  const n = inner.a;
  const m = a.shape.length === 1 ? 1 : a.shape[0];
  const p = b.shape.length === 1 ? 1 : b.shape[1];
  const aFull = (a.shape.length === 1 ? a.shown[0] : a.shown[1]) === n;
  const bFull = b.shown[0] === n;
  const outAt = (i: number, j: number): Cell | undefined => (res.length === 0 ? outM.cells[0]?.[0] : res.length === 2 ? cellAt(outM, [i, j]) : cellAt(outM, [a.shape.length === 1 ? j : i]));
  const aVal = (i: number, k: number) => (a.shape.length === 1 ? a.cells[0]?.[k] : a.cells[i]?.[k]);
  const bVal = (k: number, j: number) => (b.shape.length === 1 ? b.cells[0]?.[k] : b.cells[k]?.[j]);
  const exact = isIntDtype(outM.dtype);
  const cand: { i: number; j: number }[] = [];
  if (aFull && bFull) for (let i = 0; i < m; i++) for (let j = 0; j < p; j++) {
    if (cand.length >= MATMUL_CELL_CAP) break;
    if (aVal(i, 0) !== undefined && bVal(0, j) !== undefined && outAt(i, j) !== undefined) cand.push({ i, j });
  }
  const totalCells = m * p;
  const cells: MatmulCellView[] = [];
  let usable = cand.length > 0;
  for (const [seq, { i, j }] of cand.entries()) {
    const av: Cell[] = [], bv: Cell[] = [];
    for (let k = 0; k < n; k++) { av.push(aVal(i, k) as Cell); bv.push(bVal(k, j) as Cell); }
    const xs = av.map(num), ys = bv.map(num), real = num(outAt(i, j));
    if (xs.some((x) => x === undefined) || ys.some((y) => y === undefined) || real === undefined) { usable = false; break; }
    const ps = xs.map((x, k) => (x as number) * (ys[k] as number));
    if (exact && ps.some((x) => !Number.isSafeInteger(x))) { usable = false; break; }
    const sum = ps.reduce((s, x) => s + x, 0);
    const mag = ps.reduce((s, x) => s + Math.abs(x), 0);
    const problems: string[] = [];
    if (exact && !Number.isSafeInteger(sum)) { usable = false; break; }
    if (!agrees(sum, real, exact, mag)) problems.push(`the products add up to ${fmtNum(sum, exact)}, but NumPy's result cell is ${show(outAt(i, j))}`);
    const outCoords = res.length === 0 ? [] : res.length === 2 ? [i, j] : [a.shape.length === 1 ? j : i];
    cells.push({
      owner: "numpy", type: "mm-cell", a, b, out: outM, row: a.shape.length === 1 ? null : i, col: b.shape.length === 1 ? null : j, outCoords,
      aVals: av, bVals: bv, products: ps.map((x) => fmtNum(x, exact)), sum: outAt(i, j) as Cell,
      seq, seqOf: cand.length, total: totalCells, sampled: totalCells > cand.length, done: [], ok: problems.length === 0, problems,
    });
  }
  if (usable) {
    cells.forEach((c, k) => { c.done = cells.slice(0, k).map((d) => d.outCoords); });
    for (const c of cells) {
      const where = c.outCoords.length ? ` ${coordsText(c.outCoords)}` : "";
      const aPart = c.row === null ? "A" : `row ${c.row} of A`, bPart = c.col === null ? "B" : `column ${c.col} of B`;
      const terms = c.aVals.map((x, k) => `${show(x)} × ${show(c.bVals[k])}`);
      const shownTerms = terms.length > 5 ? [...terms.slice(0, 4), "…"] : terms;
      const prods = c.products.length > 5 ? [...c.products.slice(0, 4), "…"] : c.products;
      const sampleNote = c.sampled ? ` Sampled: ${c.seq + 1} of the first ${c.seqOf} cells shown, ${totalCells} in all.` : "";
      add(`Cell${where}`,
        c.ok
          ? story(`Result${where}${c.sampled ? "" : ` (cell ${c.seq + 1} of ${c.seqOf})`}: multiply ${aPart} by ${bPart}, pair by pair.${sampleNote}`,
            `${shownTerms.join(" + ")} = ${prods.join(" + ")} = ${show(c.sum)}. This equals NumPy's real result cell.`,
            "The k-th number of the row meets the k-th number of the column; the products are added into one cell.",
            "One result cell = one row of A times one column of B.")
          : story(`The calculation for result${where} did not match NumPy's result, so it is not drawn.`,
            `${clip(c.problems[0], 160)}.`,
            "The pictures only show a calculation that reproduces the recorded result.",
            "Trust the recorded result, and report this step if it keeps happening."),
        c);
    }
  }
  add("Result",
    story(`The result is ${res.length === 0 ? "a single number" : `the (${res.join(", ")}) matrix`}${st.assignedTo ? ` stored in ${st.assignedTo}` : ""}.`,
      `Shape ${pyShape(a.shape)} @ ${pyShape(b.shape)} → ${pyShape(res)}: ${plural(prod(res), "value")}, dtype ${outM.dtype}.${usable && totalCells > cells.length ? ` Only ${cells.length} of the ${totalCells} cells were walked through; the rest follow the same rule.` : ""}${outM.windowed ? ` The picture shows the first ${outM.shown.join(" × ")} cells.` : ""}`,
      "Every cell of the result is built the same way, from its own row of A and column of B.",
      "The result has A's row count and B's column count."),
    { owner: "numpy", type: "result", name: st.assignedTo ?? "result", out: outM, shape: outM.shape, dtype: outM.dtype, origins: null, memory: null, ok: true, problems: [] });
  return beats;
}

// ── Axis reductions ───────────────────────────────────────────────────────────

interface RedOp { fn: (xs: number[]) => number; join: string | null }
const RED: Record<string, RedOp> = {
  sum: { fn: (xs) => xs.reduce((s, x) => s + x, 0), join: " + " },
  prod: { fn: (xs) => xs.reduce((s, x) => s * x, 1), join: " × " },
  mean: { fn: (xs) => xs.reduce((s, x) => s + x, 0) / xs.length, join: null },
  min: { fn: (xs) => (xs.some(Number.isNaN) ? NaN : Math.min(...xs)), join: null },
  max: { fn: (xs) => (xs.some(Number.isNaN) ? NaN : Math.max(...xs)), join: null },
  any: { fn: (xs) => (xs.some((x) => x !== 0) ? 1 : 0), join: null },
  all: { fn: (xs) => (xs.every((x) => x !== 0) ? 1 : 0), join: null },
  var: { fn: (xs) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length; }, join: null },
  std: { fn: (xs) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length); }, join: null },
  median: { fn: (xs) => { if (xs.some(Number.isNaN)) return NaN; const s = [...xs].sort((p, q) => p - q), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }, join: null },
};
RED.amin = RED.min;
RED.amax = RED.max;

const axisSentence = (axis: number[] | null, nd: number): string =>
  axis === null ? "every axis" : nd === 2 && axis.length === 1 ? (axis[0] === 0 ? "axis 0 (down the rows)" : "axis 1 (across the columns)") : axis.map((a) => `axis ${a}`).join(" and ");

function laneCoords(o: readonly number[], inShape: readonly number[], reduced: readonly number[], keepdims: boolean): number[][] {
  let fixedAt = 0;
  const per: number[][] = inShape.map((n, d) => {
    if (reduced.includes(d)) return Array.from({ length: n }, (_, i) => i);
    const v = keepdims ? o[d] : o[fixedAt];
    fixedAt++;
    return [v];
  });
  let acc: number[][] = [[]];
  for (const choices of per) acc = acc.flatMap((pre) => choices.map((c) => [...pre, c]));
  return acc;
}

function reduceBeats(st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null {
  const red = an.nd?.reduce;
  const op = RED[st.op];
  if (!red || red.op !== "reduce" || !op || st.error || st.inputs.length !== 1 || st.inputs[0].k !== "nd") return null;
  if (red.inShape.length < 1 || red.inShape.length > 2) return null;
  if (st.kwargsRepr && ("ddof" in st.kwargsRepr || "where" in st.kwargsRepr || "initial" in st.kwargsRepr || "out" in st.kwargsRepr)) return null;
  const inp = matOf(st.inputs[0]);
  const out = matOf(st.output);
  if (!inp || !out || !sameShape(out.shape, red.predicted)) return null;
  const nd = red.inShape.length;
  const reduced = red.axis ?? red.inShape.map((_, i) => i);
  const beats: DataBeat[] = [];
  const add = (title: string, s: StepStory, view: NumpyView) => beats.push(mkBeat(index, beats.length, title, s, view));
  const name = st.op;
  add("Array",
    story(`Before ${clip(st.code, 40)} runs, here is the real input array of shape ${pyShape(red.inShape)}.`,
      `It holds ${plural(prod(red.inShape), "value")} (dtype ${inp.dtype}); every cell is drawn with its [row, column] position.${windowNote(inp)}`,
      `A reduction such as ${name} turns many values into fewer. The axis argument decides which values are combined.`,
      "Name the axis you want to collapse before you call a reduction."),
    { owner: "numpy", type: "arrays", items: [{ label: "Input", expr: null, mat: inp }] });
  const groupIds = new Map<string, number>();
  const groups = inp.cells.map((row, r) => row.map((_, c) => {
    const key = reduceTarget(nd === 1 ? [c] : [r, c], red.axis, red.keepdims).join(",");
    if (!groupIds.has(key)) groupIds.set(key, groupIds.size);
    return groupIds.get(key)!;
  }));
  const where = red.axis === null ? `the whole array collapses into ${red.keepdims ? "one value (kept as size 1 per axis)" : "a single number"}` : nd === 2 && red.axis.length === 1 ? `each ${red.axis[0] === 0 ? "column" : "row"} becomes one number` : `the values along ${axisSentence(red.axis, nd)} are combined`;
  const outTotal = prod(red.predicted);
  add("Axis",
    story(`${name} over ${axisSentence(red.axis, nd)}: ${where}.`,
      `Shape ${pyShape(red.inShape)} → ${pyShape(out.shape)}${red.keepdims ? " (keepdims keeps the collapsed axis as size 1)" : ""}. The ${plural(outTotal, "colour group")} below are the values that feed each output element.`,
      `The axis you name is the one that disappears. The other axes stay and index the ${outTotal === 1 ? "result" : "results"}.`,
      "axis=0 collapses down the rows, axis=1 collapses across the columns; keepdims=True leaves the axis as size 1."),
    { owner: "numpy", type: "axis", op: name, input: inp, axis: red.axis, keepdims: red.keepdims, inShape: red.inShape, outShape: out.shape, groups, groupCount: groupIds.size });

  // groups: every participating value for output elements whose whole lane is in the recorded window
  const lanes: Lane[] = [];
  const problems: string[] = [];
  const exact = isIntDtype(out.dtype);
  let honest = true;
  const outIdx = windowCoords(out);
  for (const { r, c, idx } of outIdx) {
    if (lanes.length >= LANE_CAP) break;
    const cs = laneCoords(idx, red.inShape, reduced, red.keepdims);
    const vals = cs.map((k) => cellAt(inp, k));
    if (vals.some((v) => v === undefined)) continue;
    const xs = vals.map((v) => num(v as Cell));
    const real = num(out.cells[r][c]);
    if (xs.some((x) => x === undefined) || real === undefined) { honest = false; break; }
    const v = op.fn(xs as number[]);
    const mag = (xs as number[]).reduce((s, x) => s + (Number.isFinite(x) ? Math.abs(x) : 0), 0) + (Number.isFinite(real) ? Math.abs(real) : 0);
    if (exact && !Number.isFinite(v)) { honest = false; break; }
    if (!agrees(v, real, exact, mag)) problems.push(`${name} of ${vals.map(show).join(", ")} is ${fmtNum(v, exact)}, but NumPy's result element ${idx.length ? coordsText(idx) : ""} is ${show(out.cells[r][c])}`);
    const strs = vals.map(show);
    const text = op.join && strs.length <= 6 ? `${strs.join(op.join)} = ${show(out.cells[r][c])}` : `${name}(${strs.length > 8 ? `${strs.slice(0, 7).join(", ")}, …` : strs.join(", ")}) = ${show(out.cells[r][c])}`;
    const key = reduceTarget(cs[0] ?? [], red.axis, red.keepdims).join(",");
    lanes.push({ out: idx, label: idx.length ? `result${coordsText(idx)}` : "result", coords: cs, values: vals as Cell[], result: out.cells[r][c], text, group: groupIds.get(key) ?? 0 });
  }
  if (honest && lanes.length) {
    const ok = problems.length === 0;
    const l0 = lanes[0];
    const ex = storyable(...l0.values, l0.result) ? ` For example ${l0.label} = ${l0.text}.` : "";
    add("Groups",
      ok
        ? story(`Combine each colour group with ${name}: ${plural(outTotal, "output element")}.`,
          `${lanes.length < outTotal ? `${lanes.length} of ${outTotal} elements listed. ` : ""}Each equals NumPy's real result.${ex}`,
          `Every output element uses only the values of its own group (${red.axis === null ? "all of them" : `${plural(l0.values.length, "value")} here`}); the groups do not overlap.`,
          `${name}(axis) = one ${name} per group of values that differ only along the axis.`)
        : story(`The recomputed ${name} did not match NumPy's real result, so it is not drawn.`,
          `${clip(problems[0], 170)}.`,
          "The pictures only show a calculation that reproduces the recorded result.",
          "Trust the recorded result, and report this step if it keeps happening."),
      { owner: "numpy", type: "lanes", op: name, lanes: ok ? lanes : [], total: outTotal, sampled: lanes.length < outTotal, ok, problems });
  }
  add("Result",
    story(`The result is ${out.scalar ? "a single number" : `the ${pyShape(out.shape)} array`}${st.assignedTo ? ` stored in ${st.assignedTo}` : ""}.`,
      `Shape ${pyShape(red.inShape)} → ${pyShape(out.shape)}: ${plural(outTotal, "value")}, dtype ${out.dtype}${inp.dtype !== out.dtype ? ` (input was ${inp.dtype})` : ""}.${out.windowed ? ` The picture shows the first ${out.shown.join(" × ")} cells.` : ""}`,
      `${name} returns a new array; the input is unchanged. The axis that was named is gone from the shape${red.keepdims ? " (it stays as size 1 because of keepdims)" : ""}.`,
      "Compare the output shape with the input shape to see which axis was collapsed."),
    { owner: "numpy", type: "result", name: st.assignedTo ?? "result", out, shape: out.shape, dtype: out.dtype, origins: null, memory: st.view === true ? "view" : st.view === false ? "copy" : null, ok: true, problems: [] });
  return beats;
}

// ── Indexing and slicing ──────────────────────────────────────────────────────

function toCoords(sel: unknown, nd: number): number[][] | null {
  const out: number[][] = [];
  if (nd === 1) { if (!Array.isArray(sel)) return null; (sel as unknown[]).forEach((v, c) => { if (v === true) out.push([c]); }); return out; }
  if (nd === 2) { if (!Array.isArray(sel)) return null; for (const [r, row] of (sel as unknown[]).entries()) { if (!Array.isArray(row)) return null; (row as unknown[]).forEach((v, c) => { if (v === true) out.push([r, c]); }); } return out; }
  return null;
}

/** Origin coordinates per output window cell, from the recorded flat positions. Null when `src` does not have the output's shape. */
function originsOf(src: unknown, out: Mat, inShape: readonly number[]): (number[] | null)[][] | null {
  if (out.shape.length === 0) return typeof src === "number" ? [[unravel(src, inShape)]] : null;
  const rows: unknown[] = out.shape.length === 1 ? [src] : (src as unknown[]);
  if (!Array.isArray(rows) || rows.length !== out.cells.length) return null;
  const res: (number[] | null)[][] = [];
  for (const [r, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== out.cells[r].length) return null;
    res.push((row as unknown[]).map((f) => (typeof f === "number" ? unravel(f, inShape) : null)));
  }
  return res;
}

function indexBeats(st: DataStage, _an: StageAnalysis, index: number): DataBeat[] | null {
  if (st.kind !== "select" || st.op !== "[]" || st.error || st.inputs.length !== 1 || st.inputs[0].k !== "nd" || !st.pos) return null;
  const inp = matOf(st.inputs[0]);
  const out = matOf(st.output);
  if (!inp || !out || inp.shape.length < 1) return null;
  const origins = originsOf(st.pos.src, out, inp.shape);
  const selected = toCoords(st.pos.sel, inp.shape.length);
  if (!origins || !selected) return null;
  const maskSnap = st.argSnaps[0];
  const maskM = maskSnap && maskSnap.k === "nd" && maskSnap.dtype === "bool" ? matOf(maskSnap) : null;
  const mode: SelectView["mode"] = maskM ? "mask" : out.scalar ? "element" : st.view === true ? "basic" : "fancy";
  const expr = clip(st.expr, 40);
  const problems: string[] = [];
  // Every window cell of the result must equal the input cell its recorded position points to, and that cell must be marked selected.
  const isSel = new Set(selected.map((c) => c.join(",")));
  origins.forEach((row, r) => row.forEach((o, c) => {
    if (!o) return;
    const v = cellAt(inp, o);
    if (v !== undefined && v !== out.cells[r][c]) problems.push(`result cell ${coordsText(out.shape.length === 2 ? [r, c] : out.shape.length === 1 ? [c] : [])} is ${show(out.cells[r][c])}, but input ${coordsText(o)} is ${show(v)}`);
    if (v !== undefined && !isSel.has(o.join(","))) problems.push(`input ${coordsText(o)} feeds the result but is not marked selected`);
  }));
  let trueCount = 0;
  if (maskM) {
    if (!sameShape(maskM.shape, inp.shape) || maskM.cells.length !== inp.cells.length) return null;
    maskM.cells.forEach((row, r) => row.forEach((v, c) => {
      const idx = inp.shape.length === 1 ? [c] : [r, c];
      if (v === "True") trueCount++;
      if ((v === "True") !== isSel.has(idx.join(","))) problems.push(`mask ${coordsText(idx)} is ${v} but the selection disagrees`);
    }));
  }
  const ok = problems.length === 0;
  const beats: DataBeat[] = [];
  const add = (title: string, s: StepStory, view: NumpyView) => beats.push(mkBeat(index, beats.length, title, s, view));
  const inner = /^\[(.*)\]$/s.exec(st.code.trim())?.[1];
  const maskText = inner ? `The condition ${clip(inner, 40)}` : "The condition";
  const total = prod(inp.shape);
  const nOut = out.scalar ? 1 : prod(out.shape);
  const failStory = story("The selection did not match NumPy's real result, so it is not highlighted.", `${clip(problems[0] ?? "", 170)}.`, "The pictures only show a selection that reproduces the recorded result.", "Trust the recorded result, and report this step if it keeps happening.");
  add("Array",
    story(`Before ${clip(st.expr, 40)} runs, here is the real array of shape ${pyShape(inp.shape)}.`,
      `It holds ${plural(total, "value")} (dtype ${inp.dtype}). Each cell is drawn with its position, so you can read which ones the index will pick.${windowNote(inp)}`,
      "An index is a rule that picks cells by position (or by a True/False mask). The positions are what matter, not the values.",
      "Positions count from 0, and the first number is the row."),
    { owner: "numpy", type: "arrays", items: [{ label: "Input", expr: null, mat: inp }] });
  if (maskM) {
    add("Mask",
      ok
        ? story(`${maskText} gives a True/False mask with the same shape as the array.`,
          `${plural(nOut, "entry", "entries")} of ${total} are True (${plural(total - nOut, "entry", "entries")} False). The mask is drawn next to the array, cell for cell.`,
          "A comparison is evaluated for every element, so its result has the array's shape and can be used as an index.",
          "A boolean mask must have the same shape as the array it indexes.")
        : failStory,
      { owner: "numpy", type: "mask", expr, input: inp, mask: maskM, trueCount, ok, problems });
  }
  const where = selected.slice(0, 4).map(coordsText).join(", ");
  add("Selection",
    ok
      ? story(`${expr} picks ${out.scalar ? "one" : nOut.toLocaleString()} of the ${plural(total, "cell")}: the highlighted ones.`,
        `${mode === "mask" ? "Cells whose mask entry is True are kept" : "Selected"}${selected.length ? ` at ${where}${selected.length > 4 ? ", …" : ""}` : ""}. ${plural(total - nOut >= 0 ? total - nOut : 0, "cell")} are left out.${inp.windowed ? " The picture is a window of the real array." : ""}`,
        mode === "basic" ? "Basic slicing picks cells by position with start:stop:step on each axis, so the choice is a regular pattern." : mode === "element" ? "Giving one position for every axis picks a single element." : mode === "mask" ? "Boolean indexing keeps the cells where the mask is True, in reading order." : "A list of positions picks exactly those rows or cells, in the order given.",
        "Read the index axis by axis: first the rows, then the columns.")
      : failStory,
    { owner: "numpy", type: "select", mode, expr, input: inp, selected: ok ? selected : [], count: nOut, total, ok, problems });
  const moved = origins.flat().filter(Boolean) as number[][];
  const orig = moved.slice(0, 4).map(coordsText).join(", ");
  const sameMemory = mode === "basic" ? "The result is a view: it shares memory with the original, so writing to it changes the original." : mode === "element" ? "A single element is returned as a number." : "This index makes a copy: changing the result leaves the original alone.";
  add("Result",
    story(`The result is ${out.scalar ? `the number ${word(out.cells[0][0])}` : `a ${pyShape(out.shape)} array`}${st.assignedTo ? ` stored in ${st.assignedTo}` : ""}.`,
      `Shape ${pyShape(inp.shape)} → ${out.scalar ? "a single value" : pyShape(out.shape)}${storyable(...out.cells.flat().slice(0, 4)) && !out.scalar ? `: ${out.cells.flat().slice(0, 4).join(", ")}${nOut > 4 ? ", …" : ""} from ${orig}${nOut > 4 ? ", …" : ""}` : ""}.${out.windowed ? ` The picture shows the first ${out.shown.join(" × ")} cells.` : ""}`,
      sameMemory,
      mode === "basic" ? "Slices are views; masks and lists make copies." : mode === "element" ? "Giving a position for every axis returns one value, not an array." : "Masks and lists make copies; slices make views."),
    { owner: "numpy", type: "result", name: st.assignedTo ?? "result", out, shape: out.scalar ? [] : out.shape, dtype: out.dtype, origins: ok ? origins : null, memory: st.view === true ? "view" : st.view === false ? "copy" : null, ok, problems });
  return beats;
}

// ── Reshape, flatten, transpose ───────────────────────────────────────────────

const REGROUP = new Set(["reshape", "ravel", "flatten", "squeeze"]);
const SWAP = new Set(["transpose", "T", "swapaxes", "moveaxis"]);

function ravel(idx: readonly number[], shape: readonly number[]): number {
  let f = 0;
  for (let d = 0; d < shape.length; d++) f = f * shape[d] + idx[d];
  return f;
}

function moveBeats(st: DataStage, _an: StageAnalysis, index: number): DataBeat[] | null {
  const regroup = REGROUP.has(st.op), swap = SWAP.has(st.op);
  if (!(regroup || swap) || (st.kind !== "call" && st.kind !== "func" && st.kind !== "attr") || st.error || st.inputs.length !== 1 || st.inputs[0].k !== "nd" || !st.pos) return null;
  const inp = matOf(st.inputs[0]);
  const out = matOf(st.output);
  if (!inp || !out || inp.scalar || out.scalar || out.shape.length < 1) return null;
  if (swap && (inp.shape.length !== 2 || out.shape.length !== 2)) return null;
  if (prod(inp.shape) !== prod(out.shape)) return null;
  const origins = originsOf(st.pos.src, out, inp.shape);
  if (!origins) return null;
  const moves: Move[] = [];
  const problems: string[] = [];
  for (const { r, c, idx } of windowCoords(out)) {
    const from = origins[r][c];
    if (!from) return null;
    const v = cellAt(inp, from);
    if (v !== undefined && v !== out.cells[r][c]) problems.push(`output ${coordsText(idx)} is ${show(out.cells[r][c])}, but input ${coordsText(from)} is ${show(v)}`);
    moves.push({ from, to: idx, flat: ravel(from, inp.shape), value: out.cells[r][c], inWindow: v !== undefined });
  }
  const orderPreserved = moves.every((m) => m.flat === ravel(m.to, out.shape));
  const swapped = inp.shape.length === 2 && out.shape.length === 2 && moves.every((m) => m.from[0] === m.to[1] && m.from[1] === m.to[0]);
  if (regroup && !orderPreserved) problems.push("the elements are not in their original order, so this is not a plain regroup");
  if (swap && !swapped && st.op !== "moveaxis") problems.push("the cells did not move from [r, c] to [c, r]");
  const ok = problems.length === 0;
  const mode: MoveView["mode"] = regroup ? "regroup" : "swap";
  const beats: DataBeat[] = [];
  const add = (title: string, s: StepStory, view: NumpyView) => beats.push(mkBeat(index, beats.length, title, s, view));
  const n = prod(inp.shape);
  const memory = st.view === true ? "a view of the same memory (no data is copied)" : st.view === false ? "a copy (new memory)" : null;
  const first = out.cells.flat().slice(0, 6);
  add("Array",
    story(`Before ${clip(st.code, 40)} runs, here is the real array of shape ${pyShape(inp.shape)}.`,
      `It holds ${plural(n, "element")} (dtype ${inp.dtype}); each cell is drawn with its position.${windowNote(inp)}`,
      mode === "regroup" ? "NumPy stores the elements in one row-major run. Its shape only says how that run is cut into rows and columns." : "A 2-D array has two axes: axis 0 runs down the rows, axis 1 across the columns.",
      "The shape is a view on the elements, not the elements themselves."),
    { owner: "numpy", type: "arrays", items: [{ label: "Input", expr: null, mat: inp }] });
  if (mode === "regroup") {
    add("Regroup",
      ok
        ? story(`${st.op === "squeeze" ? "squeeze drops size-1 axes" : `${st.op} reads the ${plural(n, "element")} in order and regroups them`}: shape ${pyShape(inp.shape)} → ${pyShape(out.shape)}.`,
          `${storyable(...first) ? `The elements stay in the same order (${first.join(", ")}${n > first.length ? ", …" : ""}); only the grouping changes. ` : "The elements stay in the same order; only the grouping changes. "}Each output cell shows the input position it came from.`,
          "The run of elements in memory never moves. Only the way it is cut into rows and columns changes, so the element count must stay the same.",
          "reshape keeps the order and the element count: the product of the shape does not change.")
        : story("The regrouping did not match NumPy's real result, so it is not drawn.", `${clip(problems[0] ?? "", 170)}.`, "The pictures only show a movement that reproduces the recorded result.", "Trust the recorded result, and report this step if it keeps happening."),
      { owner: "numpy", type: "move", mode, op: st.op, input: inp, out, moves: ok ? moves : [], orderPreserved, swapped, ok, problems });
  } else {
    const ex = moves.find((m) => m.from[0] !== m.from[1]) ?? moves[0];
    add("Swap axes",
      ok
        ? story(`${st.op === "T" ? ".T" : st.op} swaps the two axes: shape ${pyShape(inp.shape)} → ${pyShape(out.shape)}.`,
          `${swapped ? `Cell ${coordsText(ex.from)} moves to ${coordsText(ex.to)}` : "Cells are rearranged"}${storyable(ex.value) && swapped ? ` (value ${ex.value})` : ""}: rows become columns and columns become rows. Every output cell shows where it came from.`,
          "A transpose exchanges the roles of axis 0 and axis 1. Element [r, c] of the original is element [c, r] of the result.",
          "A transpose of an (r, c) array has shape (c, r).")
        : story("The movement did not match NumPy's real result, so it is not drawn.", `${clip(problems[0] ?? "", 170)}.`, "The pictures only show a movement that reproduces the recorded result.", "Trust the recorded result, and report this step if it keeps happening."),
      { owner: "numpy", type: "move", mode, op: st.op, input: inp, out, moves: ok ? moves : [], orderPreserved, swapped, ok, problems });
  }
  add("Result",
    story(`The result has shape ${pyShape(out.shape)}${st.assignedTo ? ` and is stored in ${st.assignedTo}` : ""}.`,
      `Shape ${pyShape(inp.shape)} → ${pyShape(out.shape)}; still ${plural(n, "element")}, dtype ${out.dtype}${memory ? `. It is ${memory}` : ""}.${out.windowed ? ` The picture shows the first ${out.shown.join(" × ")} cells.` : ""}`,
      mode === "regroup" ? (st.view === false ? `${st.op} returned a copy in new memory, so changing it leaves the original alone.` : "Because the order is unchanged, NumPy can hand back the same memory with new strides instead of copying.") : "A transpose swaps the strides instead of moving data, so it is normally a view.",
      mode === "regroup" ? "ravel and reshape give a view when they can; flatten always copies. The order of elements never changes." : "A view and the original share memory: change one and the other changes."),
    { owner: "numpy", type: "result", name: st.assignedTo ?? "result", out, shape: out.shape, dtype: out.dtype, origins: ok ? origins : null, memory: st.view === true ? "view" : st.view === false ? "copy" : null, ok, problems });
  return beats;
}

// ── Entry ─────────────────────────────────────────────────────────────────────

/** Beats for NumPy stages. Returns null for operations without a dedicated sequence (they use the generic beat). */
export const numpyBeats: BeatBuilder = (st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null => {
  if (an.domain !== "numpy") return null;
  if (st.kind === "binop" && st.op === "@") return matmulBeats(st, an, index);
  if (st.kind === "func" && (st.op === "matmul" || st.op === "dot")) return matmulBeats(st, an, index);
  if (an.nd?.broadcast) return elementwiseBeats(st, an, index);
  if (an.nd?.reduce) return reduceBeats(st, an, index);
  if (st.kind === "select") return indexBeats(st, an, index);
  if (st.pos && (st.kind === "call" || st.kind === "func" || st.kind === "attr")) return moveBeats(st, an, index);
  return null;
};
