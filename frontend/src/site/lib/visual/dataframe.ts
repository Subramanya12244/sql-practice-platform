/**
 * Pandas and NumPy stage engine (Agent 4).
 *
 * Stages come from an instrumented re-run of the learner's code in the EXISTING Pyodide worker (`runPython`; there is no second runtime).
 * The Python side is `dataProbeProgram.ts`; this file builds and runs it, parses its JSON, and derives the facts the visual shows:
 * rows retained/removed, columns added/removed, dtype changes, merge key matching, groups before aggregation, broadcasting and matmul
 * predictions, and CONSISTENCY CHECKS that compare every derived number with the real result.
 *
 * Nothing here is estimated: a shape, dtype or cell is either in the probe's output (captured from the real objects) or is not shown.
 * Pure functions only apart from `runDataProbe`.
 */
import { isPythonWarmed, runPython, FIRST_RUN_TIMEOUT_MS, type PyResult } from "../pyRunner";
import { TRACE_TIMEOUT_MS, type PyVal } from "./pyTrace";
import { DATA_MARK, DATA_PROBE } from "./dataProbeProgram";
import { analyzeNdStage, seedInfo, type NdAnalysis } from "./ndarray";
import { pyShape, type Check } from "./broadcast";
import type { Grid } from "./dataDiff";

export type Cell = string | null;
export { DATA_MARK };

/** A captured value. Same field names as the tracer's `PyVal` for df, series and nd (so `gridOf` works), plus what the stage view needs. */
export interface DataSnap {
  k: PyVal["k"] | "group";
  r: string;
  t?: string;
  shape?: number[];
  n?: number;
  dtype?: string;
  name?: string | null;
  ndim?: number;
  // DataFrame / Series
  cols?: string[];
  dtypes?: string[];
  index?: string[];
  rows?: Cell[][];
  na?: number[];
  more?: boolean;
  /** All column names and dtypes (first 60). */
  colNames?: string[];
  colDtypes?: string[];
  idxName?: (string | null)[];
  idxDtype?: string;
  multiRows?: boolean;
  multiCols?: boolean;
  /** Missing cells in the whole object (null when it was too large to count). */
  naTotal?: number | null;
  // ndarray
  data?: unknown;
  /** Shape of the part of the array that `data` holds. */
  shown?: number[];
  /** Leading dimensions dropped from `data` (only index 0 is shown for arrays with more than 3 dimensions). */
  lead?: number;
  itemsize?: number;
  nbytes?: number;
  strides?: number[];
  c?: boolean;
  owns?: boolean;
  // GroupBy
  by?: string[];
  ngroups?: number;
  groups?: { key: string; size: number; snap: DataSnap }[];
  inGroups?: number | null;
  /** Rows of the table the groups were made from. */
  srcRows?: number | null;
  source?: "df" | "series";
  // rolling / resample
  params?: Record<string, string>;
}

export type StageKind = "call" | "attr" | "select" | "binop" | "compare" | "unary" | "func" | "change";

export interface RowFlow {
  in: number;
  out: number;
  /** `index`: rows were matched by index label and their values agree, so retained/removed are exact. `unknown`: new rows or a reset index, so rows cannot be followed. */
  ident?: "index" | "unknown" | "skipped";
  retained?: number;
  removed?: number;
  added?: number;
  reordered?: boolean;
  /** Per shown input row: kept in the output? Per shown output row: new (not an input row)? */
  shownKept?: boolean[];
  shownNew?: boolean[];
  why?: string;
}

export interface MergeKeyCount { key: string; left?: number; right?: number; rows?: number }
export interface MergeInfo {
  how: string;
  skipped?: string;
  viaJoin?: boolean;
  leftKeys?: string[];
  rightKeys?: string[];
  leftRows?: number;
  rightRows?: number;
  outRows?: number;
  matchedKeys?: MergeKeyCount[];
  matchedKeyCount?: number;
  unmatchedLeftKeys?: MergeKeyCount[];
  unmatchedLeftKeyCount?: number;
  unmatchedRightKeys?: MergeKeyCount[];
  unmatchedRightKeyCount?: number;
  leftMatchedRows?: number;
  leftUnmatchedRows?: number;
  rightMatchedRows?: number;
  rightUnmatchedRows?: number;
  leftShown?: ("matched" | "unmatched")[];
  rightShown?: ("matched" | "unmatched")[];
  /** What the key counts predict for the number of output rows (checked against the real output). */
  expectedOutRows?: number;
  pairRows?: number;
  /** Per shown output row: both / left_only / right_only (from a real indicator run of the same merge). */
  origin?: string[];
  originCounts?: Record<string, number>;
}

export interface ConcatInfo {
  axis: 0 | 1;
  parts: { shape: number[] | null; kind: string }[];
  partCount: number;
  join: string;
  ignoreIndex: boolean;
  rowOrigin?: number[];
  rowCounts?: number[];
  colOrigin?: number[];
}

export interface AxisInfo { op: "reduce" | "along"; axis: number[] | null; keepdims: boolean }

/** One comparison (or other True/False test) inside `df[...]`, with the operands it really used and its own True/False column. */
export interface CondLeaf { text: string; mask: DataSnap; op?: string; leftText?: string; rightText?: string; left?: DataSnap; right?: DataSnap }
/** The row condition of a boolean filter, split at `&` / `|` (null `joiner` for a single test). Only recorded for call-free expressions. */
export interface CondInfo { joiner: "&" | "|" | null; leaves: CondLeaf[] }

export interface DataStage {
  i: number;
  kind: StageKind;
  /** Method, function or operator name: "sort_values", "[]", "+", "merge", "assign". */
  op: string;
  /** This step only: ".sort_values('a')", ".str.upper()", "a + b", "pd.merge(x, y)". */
  code: string;
  /** The expression up to and including this step. */
  expr: string;
  /** Line of the step in the learner's code (1-based). */
  line: number;
  stmt: string;
  stmtLine: number;
  /** The value(s) this step was applied to: the receiver, or the operands. */
  inputs: DataSnap[];
  /** Data-like arguments (a mask, a key frame). */
  argSnaps: DataSnap[];
  argsRepr?: string[];
  kwargsRepr?: Record<string, string>;
  keyRepr?: string;
  output: DataSnap | null;
  /** Set when this step raised: the real exception. */
  error?: { type: string; msg: string };
  assignedTo?: string;
  alias?: string;
  /** An in-place call that left the data exactly as it was. */
  unchanged?: boolean;
  rows?: RowFlow;
  /** For `df[<condition>]`: the condition's parts (additive; absent when the expression had calls or the condition was a variable). */
  cond?: CondInfo | null;
  merge?: MergeInfo | null;
  concat?: ConcatInfo | null;
  axis?: AxisInfo;
  /** For indexing / reshape: per shown output cell, its flat position in the input (`src`), and which input cells were selected (`sel`). */
  pos?: { src: unknown; sel: unknown };
  view?: boolean;
}

export interface DataProbeResult {
  v: 1;
  ok: boolean;
  syntax?: boolean;
  error: { type: string; msg: string; line?: number | null } | null;
  stdout: string;
  stdoutChars?: number;
  stages: DataStage[];
  dropped: number;
  plain: number;
  notes: { line: number; kind: string }[];
  libs: Record<string, string>;
  finals: Record<string, DataSnap>;
}

export interface DataProbeOptions { rows: number; cols: number; groups: number; maxStages: number; maxStdout: number; bigCells: number; maxFlowRows: number }
export const DEFAULT_PROBE_OPTIONS: Readonly<DataProbeOptions> = { rows: 12, cols: 10, groups: 6, maxStages: 80, maxStdout: 20_000, bigCells: 500_000, maxFlowRows: 200_000 };

/** `import x` / `from x import y` lines repeated in dead code so the worker's package loader sees pandas and numpy. */
function importHints(code: string): string {
  const lines = code.split("\n").map((l) => l.trim()).filter((l) => /^(import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*|from\s+[\w.]+\s+import\s+[\w*]+(\s+as\s+\w+)?(\s*,\s*\w+(\s+as\s+\w+)?)*)$/.test(l));
  return lines.length ? `if False:\n${lines.map((l) => `    ${l}`).join("\n")}\n` : "";
}

/** The program sent to the worker: the probe with the learner's source embedded as a string literal. */
export function buildDataProbe(code: string, options?: Partial<DataProbeOptions>): string {
  const o = { ...DEFAULT_PROBE_OPTIONS, ...options };
  const opt = JSON.stringify(JSON.stringify(o));
  const src = JSON.stringify(code);
  return importHints(code) + DATA_PROBE.replace(/__DF_(SRC|OPT)__/g, (m) => (m === "__DF_SRC__" ? src : opt));
}

/** Read the probe's JSON out of the worker's stdout. Null when the marker is missing (the run died before the end). */
export function parseDataProbe(stdout: string): DataProbeResult | null {
  const at = stdout.lastIndexOf(DATA_MARK);
  if (at < 0) return null;
  try {
    const rest = stdout.slice(at + DATA_MARK.length);
    const nl = rest.indexOf("\n");
    const raw = JSON.parse(nl < 0 ? rest : rest.slice(0, nl)) as DataProbeResult;
    // Anything the program printed before the marker line belongs to the worker, not to the learner's output (which the probe captured).
    return raw && raw.v === 1 && Array.isArray(raw.stages) ? raw : null;
  } catch {
    return null;
  }
}

export type DataRun = { probe: DataProbeResult; result: PyResult } | { probe: null; result: PyResult };

/** Run `code` in the browser's Pyodide worker through the probe. Same worker and sandbox as a normal run. */
export async function runDataProbe(code: string, opts: { files?: Record<string, string>; stdin?: string; run?: typeof runPython; options?: Partial<DataProbeOptions> } = {}): Promise<DataRun> {
  const run = opts.run ?? runPython;
  const result = await run(buildDataProbe(code, opts.options), undefined, isPythonWarmed() ? TRACE_TIMEOUT_MS : FIRST_RUN_TIMEOUT_MS, opts.stdin ?? "", opts.files);
  const probe = parseDataProbe(result.stdout ?? "");
  return probe ? { probe, result } : { probe: null, result };
}

// ── Derived facts ─────────────────────────────────────────────────────────

export interface DtypeChange { name: string; before: string; after: string }

export interface StageAnalysis {
  index: number;
  domain: "pandas" | "numpy" | "python" | "mixed";
  /** Short heading for the timeline, e.g. ".dropna()". */
  title: string;
  inShape: number[] | null;
  outShape: number[] | null;
  inShapes: (number[] | null)[];
  rowsIn: number | null;
  rowsOut: number | null;
  rowsRetained: number | null;
  rowsRemoved: number | null;
  rowsAdded: number | null;
  /** True when retained/removed are exact (rows matched by label and values). */
  rowsExact: boolean;
  colsIn: string[] | null;
  colsOut: string[] | null;
  colsAdded: string[];
  colsRemoved: string[];
  /** The column list was cut at 60 names, so added/removed lists may be incomplete (counts from shapes stay exact). */
  colsCapped: boolean;
  dtypeIn: string | null;
  dtypeOut: string | null;
  dtypeChanges: DtypeChange[];
  missingBefore: number | null;
  missingAfter: number | null;
  nd: NdAnalysis | null;
  /** One or two sentences built only from the measured numbers above. */
  explanation: string;
  checks: Check[];
  consistent: boolean;
}

export const isTabular = (s?: DataSnap | null): s is DataSnap & { k: "df" | "series" } => !!s && (s.k === "df" || s.k === "series");
const shapeOf = (s?: DataSnap | null): number[] | null => (s && (s.k === "df" || s.k === "series" || s.k === "nd") && s.shape ? s.shape : null);
const rowsOf = (s?: DataSnap | null): number | null => (isTabular(s) ? s.shape?.[0] ?? s.n ?? null : s?.k === "group" ? s.srcRows ?? null : null);
const columnsOf = (s?: DataSnap | null): string[] | null => (s?.k === "df" ? s.colNames ?? null : s?.k === "series" ? [s.name ?? "(unnamed)"] : null);
const dtypesOf = (s?: DataSnap | null): string[] | null => (s?.k === "df" ? s.colDtypes ?? null : s?.k === "series" && s.dtype ? [s.dtype] : null);
const naOf = (s?: DataSnap | null): number | null => (s?.k === "df" || s?.k === "series" ? s.naTotal ?? null : null);

const fmtShape = (s: DataSnap | null | undefined) => {
  const sh = shapeOf(s);
  return sh ? pyShape(sh) : s?.k === "group" ? `${s.ngroups} groups` : s ? s.r : "nothing";
};
const plural = (n: number, w: string, p = `${w}s`) => `${n} ${n === 1 ? w : p}`;
const list = (xs: string[], max = 6) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`);

export function domainOf(st: DataStage): StageAnalysis["domain"] {
  const all = [...st.inputs, ...(st.output ? [st.output] : [])];
  const nd = all.some((s) => s.k === "nd"), pd = all.some((s) => s.k === "df" || s.k === "series" || s.k === "group" || (s.k === "obj" && !!s.params));
  return nd && pd ? "mixed" : nd ? "numpy" : pd ? "pandas" : "python";
}

/** Heading for the timeline and the stage card. */
export function stageTitle(st: DataStage): string {
  const t = st.kind === "change" ? st.stmt : st.kind === "call" || st.kind === "attr" || st.kind === "select" ? st.code : st.expr;
  return t.length > 64 ? `${t.slice(0, 63)}…` : t;
}

const CREATE = new Set(["DataFrame", "Series", "read_csv", "read_json", "read_excel", "read_table", "from_dict", "from_records", "date_range", "array", "arange", "zeros", "ones", "full", "linspace", "empty", "eye", "identity", "asarray", "default_rng", "rand", "randn", "randint", "random", "integers", "normal", "uniform", "choice", "permutation", "shuffle", "standard_normal", "zeros_like", "ones_like", "meshgrid", "fromfunction", "repeat", "tile"]);
const AGG = new Set(["sum", "mean", "median", "min", "max", "count", "size", "std", "var", "nunique", "first", "last", "prod", "agg", "aggregate", "idxmax", "idxmin", "cumsum", "cumcount", "describe", "mode", "quantile", "sem", "any", "all"]);

function explainPandas(st: DataStage, a: Omit<StageAnalysis, "explanation" | "checks" | "consistent" | "title">): string {
  const inn = st.inputs[0], out = st.output;
  const op = st.op;
  if (st.error) return `${st.code} raised ${st.error.type}: ${st.error.msg.split("\n")[0]}`;
  if (!out) return "";
  const rowsPart = () => {
    if (a.rowsIn === null || a.rowsOut === null) return "";
    if (a.rowsExact && a.rowsRemoved !== null && a.rowsRetained !== null) {
      return a.rowsRemoved === 0 && !a.rowsAdded ? `All ${plural(a.rowsIn, "row")} are kept.` : `${plural(a.rowsRetained, "row")} kept, ${plural(a.rowsRemoved, "row")} removed (${a.rowsIn} → ${a.rowsOut}).`;
    }
    return a.rowsIn === a.rowsOut ? `Row count unchanged (${a.rowsIn}).` : `Rows ${a.rowsIn} → ${a.rowsOut}.`;
  };
  const colsPart = () => {
    const bits: string[] = [];
    if (a.colsAdded.length) bits.push(`added column${a.colsAdded.length > 1 ? "s" : ""} ${list(a.colsAdded)}`);
    if (a.colsRemoved.length) bits.push(`removed column${a.colsRemoved.length > 1 ? "s" : ""} ${list(a.colsRemoved)}`);
    return bits.length ? `Columns: ${bits.join("; ")}.` : "";
  };
  const dtypePart = () => (a.dtypeChanges.length ? `Types changed: ${a.dtypeChanges.slice(0, 4).map((d) => `${d.name} ${d.before} → ${d.after}`).join(", ")}.` : "");
  const naPart = () => {
    if (a.missingBefore === null || a.missingAfter === null || a.missingBefore === a.missingAfter) return "";
    return `Missing cells ${a.missingBefore} → ${a.missingAfter}.`;
  };
  const join = (...s: string[]) => s.filter(Boolean).join(" ");

  if (st.merge && !st.merge.skipped) {
    const m = st.merge;
    const keys = (m.leftKeys ?? []).join(", ") === (m.rightKeys ?? []).join(", ") ? (m.leftKeys ?? []).join(", ") : `${(m.leftKeys ?? []).join(", ")} (left) = ${(m.rightKeys ?? []).join(", ")} (right)`;
    return join(
      `${m.how} ${m.viaJoin ? "join" : "merge"} on ${keys || "the index"}: ${plural(m.matchedKeyCount ?? 0, "key")} appear on both sides.`,
      `${plural(m.leftUnmatchedRows ?? 0, "left row")} and ${plural(m.rightUnmatchedRows ?? 0, "right row")} have no match.`,
      `Output has ${plural(m.outRows ?? 0, "row")}.`,
    );
  }
  if (st.merge?.skipped) return `${op} ran; key matching was not analysed (${st.merge.skipped}). Output ${fmtShape(out)}.`;
  if (st.concat) {
    const c = st.concat;
    return join(`Stacks ${plural(c.partCount, "object")} ${c.axis === 0 ? "one below the other (rows are added)" : "side by side (columns are added)"}.`, `Output ${fmtShape(out)}.`, c.ignoreIndex ? "The index was rebuilt (ignore_index=True)." : "");
  }
  if (out.k === "group") {
    const by = out.by?.length ? out.by.join(", ") : "the grouping key";
    const lost = out.srcRows != null && out.inGroups != null ? out.srcRows - out.inGroups : 0;
    const exclu = lost > 0 ? ` ${plural(lost, "row")} with a missing key ${lost === 1 ? "is" : "are"} left out (groupby drops them by default).` : "";
    if (inn?.k === "group") return `Selects ${out.name ? `the column ${out.name}` : "columns"} to aggregate. The ${plural(out.ngroups ?? 0, "group")} stay as they are.`;
    return `Splits ${out.srcRows ?? "the"} rows into ${plural(out.ngroups ?? 0, "group")} by ${by}. Nothing is aggregated yet: each group keeps its own rows.${exclu}`;
  }
  if (inn?.k === "group" && isTabular(out)) {
    return `Collapses each of the ${plural(inn.ngroups ?? 0, "group")} to ${out.k === "df" ? "one row" : "one value"} with ${op}. Output ${fmtShape(out)}.`;
  }
  if (out.k === "obj" && out.params) return `Prepares a ${out.t} object (${Object.entries(out.params).map(([k, v]) => `${k}=${v}`).join(", ")}). Nothing is computed until a method like mean() is applied.`;
  if (inn?.k === "obj" && isTabular(out)) {
    const lead = out.naTotal ?? 0;
    return `Applies ${op} to each ${inn.t === "Resampler" ? "group" : "window"}. Output ${fmtShape(out)}${lead ? `; ${plural(lead, "result")} missing where a full window is not available` : ""}.`;
  }
  if (CREATE.has(op) && st.kind === "func" && !a.inShape) {
    const cols = out.k === "df" ? ` with columns ${list(out.colNames ?? [])}` : "";
    return `${op === "read_csv" ? "Reads the CSV text into a DataFrame" : `Creates ${out.k === "df" ? "a DataFrame" : out.k === "series" ? "a Series" : "a value"}`} of shape ${fmtShape(out)}${cols}.`;
  }
  if (st.kind === "change") {
    if (!inn) return `Creates ${st.assignedTo ?? "a variable"}${st.alias ? ` as another name for ${st.alias} (the same object)` : ""}: ${fmtShape(out)}.`;
    if (st.unchanged) return `${st.stmt} ran in place and changed nothing in ${st.assignedTo ?? "the data"}: the shape, types and values are the same.`;
    return join(`${st.stmt} changed ${st.assignedTo ?? "the data"} in place.`, rowsPart(), colsPart(), dtypePart(), naPart(), a.colsAdded.length + a.colsRemoved.length + a.dtypeChanges.length === 0 && a.rowsIn === a.rowsOut ? "Shape and types are the same; some values changed (highlighted)." : "");
  }
  if ((st.kind === "binop" || st.kind === "compare" || st.kind === "unary") && isTabular(out)) {
    const what = st.kind === "compare" ? "Compares every value; the result is True or False per row" : `Calculates ${st.expr} element by element, matching rows by index label`;
    return `${what}. Output ${fmtShape(out)}, dtype ${out.dtype ?? "?"}.${naPart() ? ` ${naPart()}` : ""}`;
  }
  if (op === "[]" || st.kind === "select") {
    const mask = st.argSnaps[0];
    if (isTabular(mask) && mask.dtype === "bool" && a.rowsIn !== null) return `Keeps the rows where the condition is True. ${rowsPart()}`;
    if (inn?.k === "df" && out.k === "series") return `Selects the column ${out.name ?? ""} as a Series of ${plural(out.shape?.[0] ?? 0, "value")}.`;
    if (inn?.k === "df" && out.k === "df" && a.colsRemoved.length) return join(`Selects ${plural(a.colsOut?.length ?? 0, "column")}.`, colsPart());
    if (isTabular(out) && a.rowsIn !== null) return join(`Selects rows by position or label.`, rowsPart());
    return `Indexes the value; result ${fmtShape(out)}.`;
  }
  switch (op) {
    case "dropna": return join(a.rowsRemoved !== null ? (a.rowsRemoved ? `Drops ${plural(a.rowsRemoved, "row")} that contained a missing value.` : "No row contains a missing value, so nothing is dropped.") : "Drops rows with missing values.", rowsPart(), naPart());
    case "fillna": case "ffill": case "bfill": case "interpolate": return join(`Replaces missing values.`, naPart() || "No missing cell changed.", dtypePart());
    case "drop_duplicates": return join(a.rowsRemoved ? `Removes ${plural(a.rowsRemoved, "duplicate row")}; the first occurrence of each is kept.` : "There are no duplicate rows.", rowsPart());
    case "sort_values": case "sort_index": return join(`Same rows in a new order${a.rowsExact && a.rowsAdded === 0 ? "" : ""}.`, a.rowsExact && st.rows?.reordered === false ? "The rows were already in this order." : "");
    case "head": case "tail": return `Takes the ${op === "head" ? "first" : "last"} ${plural(a.rowsOut ?? 0, "row")} of ${a.rowsIn ?? "?"}.`;
    case "sample": return `Takes a random sample of ${plural(a.rowsOut ?? 0, "row")} from ${a.rowsIn ?? "?"}.`;
    case "query": case "where": case "mask": case "filter": case "isin": case "between": return join(op === "query" ? "Keeps the rows that satisfy the expression." : `Applies ${op}.`, rowsPart());
    case "rename": return join(a.colsAdded.length ? `Renames ${a.colsRemoved.map((c, i) => `${c} → ${a.colsAdded[i] ?? "?"}`).join(", ")}.` : "Renames labels.", "Values are unchanged.");
    case "drop": return join(a.colsRemoved.length ? `Drops column${a.colsRemoved.length > 1 ? "s" : ""} ${list(a.colsRemoved)}.` : "Drops rows by label.", rowsPart());
    case "assign": return join(`Adds or replaces columns.`, colsPart());
    case "astype": case "to_numeric": case "to_datetime": case "convert_dtypes": return join(`Converts values to another type.`, dtypePart() || "No dtype changed.", naPart());
    case "reset_index": case "set_index": {
      const drop = st.kwargsRepr?.drop === "True";
      return join(op === "reset_index" ? (drop ? "Rebuilds the index as 0..n-1 and discards the old one." : "Moves the index into a column and rebuilds a 0..n-1 index.") : "Moves a column into the index.", colsPart());
    }
    case "pivot_table": case "pivot": return join(`Reshapes long data to wide: row labels become the index, one column per distinct value.`, `Shape ${a.inShape ? pyShape(a.inShape) : "?"} → ${fmtShape(out)}.`);
    case "melt": case "stack": return join(`Reshapes wide data to long: one row per (id, variable) pair.`, `Shape ${a.inShape ? pyShape(a.inShape) : "?"} → ${fmtShape(out)}.`);
    case "unstack": return `Moves the inner index level into columns. Shape ${a.inShape ? pyShape(a.inShape) : "?"} → ${fmtShape(out)}.`;
    case "apply": case "map": case "applymap": case "transform": case "agg": case "aggregate":
      if (op === "agg" || op === "aggregate") break;
      return join(`Calls the function on each ${out.k === "series" && inn?.k === "series" ? "value" : "element or row"}.`, `Output ${fmtShape(out)}${out.dtype ? `, dtype ${out.dtype}` : ""}.`, dtypePart());
    case "merge": case "join": return `Combines two tables by key. Output ${fmtShape(out)}.`;
    case "groupby": return "Groups rows by key.";
    case "copy": return "Makes an independent copy.";
    case "round": case "abs": case "clip": case "replace": return join(`Changes values.`, dtypePart());
    default: break;
  }
  if (inn?.k === "series" && out.k === "series" && /\.(str|dt)\./.test(st.code)) {
    return `Applies ${st.code.replace(/^\./, "")} to each value. Output ${fmtShape(out)}, dtype ${out.dtype ?? "?"}${naPart() ? `. ${naPart()}` : ""}.`;
  }
  if (AGG.has(op) || !isTabular(out)) {
    if (!isTabular(out)) return `${st.code} returns ${out.r}${out.dtype ? ` (${out.dtype})` : ""}.`;
    return join(`Aggregates with ${op}.`, `Output ${fmtShape(out)}.`);
  }
  return join(`${st.code} returned ${fmtShape(out)}.`, rowsPart(), colsPart(), dtypePart());
}

/** Compare displayed numbers with the real result. Every check is something a learner could verify by running `.shape` themselves. */
function pandasChecks(st: DataStage, a: Omit<StageAnalysis, "explanation" | "checks" | "consistent" | "title">): Check[] {
  const checks: Check[] = [];
  const out = st.output;
  if (out && isTabular(out)) {
    const sh = out.shape;
    const shown = out.rows?.length ?? 0;
    const full = !out.more;
    if (sh) checks.push({ name: "shown rows fit the shape", ok: full ? shown === sh[0] : shown < sh[0] || (out.k === "df" && (out.cols?.length ?? 0) < (sh[1] ?? 0)), detail: `Shape ${pyShape(sh)}, ${shown} row${shown === 1 ? "" : "s"} shown${out.more ? " (truncated)" : ""}.` });
    if (out.k === "df" && sh) checks.push({ name: "shown columns fit the shape", ok: full ? out.cols?.length === sh[1] : (out.cols?.length ?? 0) <= sh[1], detail: `${sh[1]} columns, ${out.cols?.length ?? 0} shown.` });
  }
  if (st.rows?.ident === "index" && st.rows.retained !== undefined && st.rows.removed !== undefined) {
    checks.push({ name: "retained + removed = rows in", ok: st.rows.retained + st.rows.removed === st.rows.in, detail: `${st.rows.retained} + ${st.rows.removed} vs ${st.rows.in}.` });
    checks.push({ name: "retained + added = rows out", ok: st.rows.retained + (st.rows.added ?? 0) === st.rows.out, detail: `${st.rows.retained} + ${st.rows.added ?? 0} vs ${st.rows.out}.` });
  }
  if (st.rows && out && rowsOf(out) !== null) checks.push({ name: "rows out equals the result's row count", ok: st.rows.out === rowsOf(out), detail: `${st.rows.out} vs ${rowsOf(out)}.` });
  if (a.colsIn && a.colsOut && !a.colsCapped && st.inputs[0]?.k === "df" && out?.k === "df") {
    const nIn = st.inputs[0].shape?.[1] ?? 0, nOut = out.shape?.[1] ?? 0;
    checks.push({ name: "columns in - removed + added = columns out", ok: nIn - a.colsRemoved.length + a.colsAdded.length === nOut || a.colsIn.length !== nIn || (a.colsOut.length !== nOut), detail: `${nIn} - ${a.colsRemoved.length} + ${a.colsAdded.length} vs ${nOut}.` });
  }
  const m = st.merge;
  if (m && !m.skipped && m.expectedOutRows !== undefined && m.outRows !== undefined) {
    checks.push({ name: "key counts predict the output rows", ok: m.expectedOutRows === m.outRows, detail: `Predicted ${m.expectedOutRows} rows from the key counts, the merge returned ${m.outRows}.` });
    if (out?.shape) checks.push({ name: "merge output rows match the result", ok: out.shape[0] === m.outRows, detail: `${out.shape[0]} vs ${m.outRows}.` });
    if (m.originCounts) checks.push({ name: "origin counts add up", ok: Object.values(m.originCounts).reduce((x, y) => x + y, 0) === m.outRows, detail: `${Object.entries(m.originCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}.` });
    if (m.leftMatchedRows !== undefined && m.leftUnmatchedRows !== undefined && m.leftRows !== undefined) checks.push({ name: "left rows matched + unmatched = left rows", ok: m.leftMatchedRows + m.leftUnmatchedRows === m.leftRows, detail: `${m.leftMatchedRows} + ${m.leftUnmatchedRows} vs ${m.leftRows}.` });
  }
  if (out?.k === "group" && out.srcRows != null && out.inGroups != null) checks.push({ name: "group sizes fit the row count", ok: out.inGroups <= out.srcRows, detail: `${out.inGroups} rows in groups of ${out.srcRows}.` });
  return checks;
}

/** Facts and checks for one stage. Pure. */
export function analyzeStage(st: DataStage): StageAnalysis {
  const inn = st.inputs[0] ?? null;
  const out = st.output;
  const domain = domainOf(st);
  const colsIn = columnsOf(inn), colsOut = columnsOf(out);
  const dIn = dtypesOf(inn), dOut = dtypesOf(out);
  const sameKind = inn?.k === "df" && out?.k === "df";
  const colsAdded = sameKind && colsIn && colsOut ? colsOut.filter((c) => !colsIn.includes(c)) : [];
  const colsRemoved = sameKind && colsIn && colsOut ? colsIn.filter((c) => !colsOut.includes(c)) : [];
  const dtypeChanges: DtypeChange[] = [];
  if (sameKind && colsIn && colsOut && dIn && dOut) {
    for (const c of colsOut) {
      const i = colsIn.indexOf(c), j = colsOut.indexOf(c);
      if (i >= 0 && dIn[i] !== dOut[j]) dtypeChanges.push({ name: c, before: dIn[i], after: dOut[j] });
    }
  } else if (inn?.k === "series" && out?.k === "series" && inn.dtype && out.dtype && inn.dtype !== out.dtype) dtypeChanges.push({ name: out.name ?? inn.name ?? "values", before: inn.dtype, after: out.dtype });
  const rf = st.rows;
  const rowsIn = rf?.in ?? rowsOf(inn), rowsOut = rf?.out ?? rowsOf(out);
  const exact = rf?.ident === "index";
  const base = {
    index: st.i, domain,
    inShape: shapeOf(inn), outShape: shapeOf(out), inShapes: st.inputs.map(shapeOf),
    rowsIn, rowsOut, rowsRetained: exact ? rf?.retained ?? null : null, rowsRemoved: exact ? rf?.removed ?? null : null, rowsAdded: exact ? rf?.added ?? null : null, rowsExact: exact,
    colsIn, colsOut, colsAdded, colsRemoved, colsCapped: (inn?.k === "df" && (inn.shape?.[1] ?? 0) > 60) || (out?.k === "df" && (out.shape?.[1] ?? 0) > 60),
    dtypeIn: inn?.dtype ?? (inn?.k === "df" ? null : null), dtypeOut: out?.dtype ?? null, dtypeChanges,
    missingBefore: naOf(inn), missingAfter: naOf(out),
  };
  const nd = domain === "numpy" || (domain === "mixed" && st.inputs.some((s) => s.k === "nd")) ? analyzeNdStage(st) : null;
  const explanation = nd ? nd.explanation : explainPandas(st, { ...base, nd: null });
  const checks = [...(nd ? nd.checks : []), ...(st.error ? [] : pandasChecks(st, { ...base, nd: null }))];
  return { ...base, title: stageTitle(st), nd, explanation, checks, consistent: checks.every((c) => c.ok) };
}

export interface DataModelData {
  domain: "pandas" | "numpy";
  ok: boolean;
  error: DataProbeResult["error"];
  stdout: string;
  stages: DataStage[];
  analyses: StageAnalysis[];
  libs: Record<string, string>;
  notes: string[];
  seeds: { seeds: number[]; unseeded: boolean };
  dropped: number;
  plain: number;
  consistent: boolean;
  failedChecks: string[];
  /** Final values of the learner's DataFrame / Series / array variables. */
  finals: Record<string, DataSnap>;
}

/** Plain-language notes about what this stage view does not cover for this program. */
export function probeNotes(p: DataProbeResult): string[] {
  const notes: string[] = [];
  const kinds = new Map<string, number[]>();
  for (const n of p.notes) kinds.set(n.kind, [...(kinds.get(n.kind) ?? []), n.line]);
  for (const [k, lines] of kinds) {
    const what = k === "For" || k === "While" || k === "AsyncFor" ? "A loop" : k === "If" ? "An if block" : k === "With" ? "A with block" : k === "Try" ? "A try block" : k === "FunctionDef" ? "A function definition" : "A class";
    notes.push(`${what} (line${lines.length > 1 ? "s" : ""} ${lines.slice(0, 4).join(", ")}) ran as one step: operations inside it are not split into stages, only the variables it changed are shown.`);
  }
  if (p.dropped > 0) notes.push(`Only the first ${p.stages.length} stages are kept; ${p.dropped} more ran but are not shown.`);
  const more = p.stages.some((s) => [...s.inputs, ...(s.output ? [s.output] : [])].some((x) => x.more));
  if (more) notes.push("Large tables and arrays show only their first rows and columns (up to 12 rows by 10 columns; 3-D arrays show 4 planes of 8 by 8). Shapes, dtypes and counts are exact.");
  if (p.stages.some((s) => [...s.inputs, ...(s.output ? [s.output] : [])].some((x) => x.multiRows || x.multiCols))) notes.push("MultiIndex labels are shown flattened as 'a | b'.");
  return notes;
}

/** Grid view of a tabular snapshot (for dataDiff.diffGrids). */
export function gridOfSnap(s: DataSnap | null | undefined): Grid | null {
  if (!s) return null;
  if (s.k === "df" && s.cols && s.rows) return { colLabels: s.cols, rowLabels: s.index ?? s.rows.map((_, i) => String(i)), cells: s.rows };
  if (s.k === "series" && s.rows) return { colLabels: [s.name ?? "value"], rowLabels: s.index ?? s.rows.map((_, i) => String(i)), cells: s.rows };
  return null;
}

/** Everything a visualizer needs, from one real run. `consistent` is false when any derived number disagrees with the real result. */
export function buildDataModel(domain: "pandas" | "numpy", probe: DataProbeResult, code: string): DataModelData {
  const analyses = probe.stages.map(analyzeStage);
  const failedChecks = analyses.flatMap((a) => a.checks.filter((c) => !c.ok).map((c) => `Stage ${a.index + 1} (${a.title}): ${c.name}. ${c.detail}`));
  return {
    domain, ok: probe.ok, error: probe.error, stdout: probe.stdout, stages: probe.stages, analyses, libs: probe.libs, notes: probeNotes(probe),
    seeds: seedInfo(code), dropped: probe.dropped, plain: probe.plain, consistent: failedChecks.length === 0, failedChecks, finals: probe.finals,
  };
}

export type MarkTone = "ok" | "bad" | "warn" | "info" | "none";
/** A word (never colour alone) and a tone for one shown row. */
export interface RowMark { label: string; tone: MarkTone }

/**
 * Row marks for the shown rows of one panel of a stage. `in0`/`in1`: the receiver and the second table; `out`: the result.
 * Everything comes from the real run: kept/removed from index matching, matched/unmatched from the key counts, origin from an
 * indicator run of the same merge, part numbers from the order of the concatenated objects.
 */
export function rowMarks(st: DataStage, role: "in0" | "in1" | "out"): (RowMark | null)[] | undefined {
  const m = st.merge && !st.merge.skipped ? st.merge : null;
  if (role === "in0") {
    if (m?.leftShown) return m.leftShown.map((x) => (x === "matched" ? { label: "matched", tone: "ok" } : { label: "no match", tone: "bad" }));
    if (st.rows?.ident === "index" && st.rows.shownKept) return st.rows.shownKept.map((k) => (k ? { label: "kept", tone: "none" } : { label: "removed", tone: "bad" }));
    return undefined;
  }
  if (role === "in1") return m?.rightShown?.map((x) => (x === "matched" ? { label: "matched", tone: "ok" } : { label: "no match", tone: "bad" }));
  if (m?.origin) return m.origin.map((o) => (o === "both" ? { label: "both", tone: "ok" } : o === "left_only" ? { label: "left only", tone: "warn" } : o === "right_only" ? { label: "right only", tone: "info" } : { label: o, tone: "none" }));
  if (st.concat?.rowOrigin) return st.concat.rowOrigin.map((p) => ({ label: `part ${p + 1}`, tone: p % 2 === 0 ? "info" : "warn" }));
  if (st.rows?.ident === "index" && st.rows.shownNew && st.rows.shownNew.some(Boolean)) return st.rows.shownNew.map((n) => (n ? { label: "new", tone: "ok" } : null));
  return undefined;
}
