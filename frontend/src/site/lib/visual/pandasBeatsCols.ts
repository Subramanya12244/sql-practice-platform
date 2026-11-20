/**
 * Pandas beats that work on columns and cells: column selection, drop (columns), element-wise calculation (a + b, a > 5), a new or
 * replaced column (assign, df["c"] = ...), missing values (isna, fillna and its relatives) and per-group aggregation.
 * Each beat is built from one stage's own snapshots; see pandasBeats.ts for the list and for what is not covered.
 */
import type { DataSnap, DataStage, StageAnalysis } from "./dataframe";
import { gridOfSnap, isTabular } from "./dataframe";
import { diffGrids } from "./dataDiff";
import type { DataBeat } from "./dataBeats";
import { clip, plural } from "./story";
import {
  beatsOf, callArgs, labelList, quoted, sampledText, scalarText, shapeOf, txt, uniqueLabels, winOf,
  type CalcPart, type CalcView, type GridData, type GridView, type GroupBlock, type GroupsView, type TableView, type Tone, type Win,
} from "./pandasBeatParts";
import { mentioned } from "./pandasBeatsRows";

function gridOf(w: Win, colTone: (c: string) => Tone, colTag: (c: string) => string | null, cellTone?: (r: number, c: number) => Tone | null, cellText?: (r: number, c: number) => string | null): GridData {
  return {
    cols: w.cols, dtypes: w.dtypes, index: w.index, rows: w.rows,
    colTone: w.cols.map(colTone), colTag: w.cols.map(colTag),
    cellTone: cellTone ? w.rows.map((r, i) => r.map((_, j) => cellTone(i, j))) : undefined,
    cellText: cellText ? w.rows.map((r, i) => r.map((_, j) => cellText(i, j))) : undefined,
    all: w.allCols.length > w.cols.length ? w.allCols.map((name) => ({ name, tone: colTone(name) })) : null,
    shape: [w.nrows, w.ncols], more: w.more,
  };
}
const gridBeat = (grid: GridData, caption: string, sampled: string | null): GridView => ({ owner: "pandas", type: "grid", grid, caption, sampled });
const tableBeat = (snap: DataSnap, caption: string, extra: Partial<TableView> = {}): TableView => ({ owner: "pandas", type: "table", snap, caption, ...extra });
const colList = (cols: string[], max = 4) => labelList(cols, max);

// ── Select columns / drop columns ────────────────────────────────────────

export function selectBeats(st: DataStage, an: StageAnalysis, index: number, mode: "select" | "drop"): DataBeat[] | null {
  const inp = winOf(st.inputs[0]), out = st.output;
  if (!inp || st.inputs[0].k !== "df" || !isTabular(out) || !an.colsIn || !an.colsOut || an.colsCapped) return null;
  if (an.rowsIn === null || an.rowsIn !== an.rowsOut) return null;
  if (st.argSnaps.some((s) => isTabular(s) && s.dtype === "bool")) return null;
  const all = an.colsIn;
  const chosen = mode === "select" ? (out.k === "series" ? [out.name ?? "(unnamed)"] : an.colsOut) : an.colsRemoved;
  if (!chosen.length || chosen.some((c) => !all.includes(c))) return null;
  if (mode === "select" && (chosen.length >= all.length || an.colsRemoved.length === 0 && out.k === "df")) return null;
  if (mode === "drop" && (out.k !== "df" || an.colsAdded.length)) return null;
  const rest = all.filter((c) => !chosen.includes(c));
  const sample = sampledText(inp);
  const total = all.length;
  const toneOf = (c: string): Tone => (mode === "select" ? (chosen.includes(c) ? "kept" : "removed") : chosen.includes(c) ? "removed" : "kept");
  const tagOf = (c: string): string | null => (mode === "select" ? (chosen.includes(c) ? "selected" : "left out") : chosen.includes(c) ? "dropped" : "stays");
  const plain = gridOf(inp, () => "normal", () => null);
  const marked = gridOf(inp, toneOf, tagOf);
  const nrows = an.rowsIn;
  const what1 = `The table has ${plural(nrows, "row")} and ${plural(total, "column")}: ${colList(all, 6)}.`;
  const resultKind = out.k === "series" ? "Series" : "DataFrame";
  if (mode === "select") {
    return beatsOf(index, [
      { title: "All columns", story: { what: what1, changed: `Nothing yet: all ${total} columns are still here.`, why: "Selecting columns starts from the whole table, then keeps only the names you ask for.", remember: "Column selection never changes rows: the same rows come out." }, view: gridBeat(plain, `Input DataFrame: ${plural(total, "column")}`, sample) },
      { title: "Pick columns", story: {
        what: `Picks ${chosen.length === 1 ? "the column" : "the columns"} ${colList(chosen)} by name.`,
        changed: `${chosen.length} of ${total} columns selected; ${rest.length} left out${rest.length ? ` (${colList(rest, 4)})` : ""}.`,
        why: "Square brackets with a name (or a list of names) choose columns. Rows are not touched.",
        remember: "One name in brackets gives a Series; a list of names gives a DataFrame.",
      }, view: gridBeat(marked, "Chosen columns stay; the others are left out", sample) },
      { title: "Result", story: {
        what: `The result is a ${resultKind}${out.k === "series" ? ` named ${chosen[0]}` : ` with ${colList(chosen, 5)}`}.`,
        changed: `Shape ${shapeOf(an.inShape)} → ${shapeOf(an.outShape)}: rows stay ${nrows}, columns ${total} → ${out.k === "series" ? 1 : chosen.length}.`,
        why: out.k === "series" ? "A single column name returns that column as a Series (one labelled column of values)." : "A list of names returns a new DataFrame holding only those columns, in the order you listed them.",
        remember: "Use double brackets, df[['a']], when you want a DataFrame with one column.",
      }, view: tableBeat(out, `Result: ${resultKind} ${shapeOf(an.outShape)}`, { sampled: sampledText(winOf(out)) }) },
    ]);
  }
  return beatsOf(index, [
    { title: "All columns", story: { what: what1, changed: `Nothing yet: all ${total} columns are still here.`, why: "drop() starts from the whole table, then removes what you name.", remember: "drop() returns a new DataFrame; the original keeps its columns until you assign the result." }, view: gridBeat(plain, `Input DataFrame: ${plural(total, "column")}`, sample) },
    { title: "Mark columns to drop", story: {
      what: `Marks ${chosen.length === 1 ? "the column" : "the columns"} ${colList(chosen)} to be dropped.`,
      changed: `${plural(chosen.length, "column")} to drop; ${plural(rest.length, "column")} stay (${colList(rest, 4)}).`,
      why: "drop(columns=[...]) or drop(..., axis=1) removes columns by name. Rows are not touched.",
      remember: "Drop by name, not by position: names keep working when columns move.",
    }, view: gridBeat(marked, "Columns marked for dropping", sample) },
    { title: "Result", story: {
      what: `The result keeps ${plural(rest.length, "column")}: ${colList(rest, 5)}.`,
      changed: `Shape ${shapeOf(an.inShape)} → ${shapeOf(an.outShape)}: columns ${total} → ${rest.length}, rows stay ${nrows}.`,
      why: "The dropped columns are simply absent from the new table; every remaining value is unchanged.",
      remember: "Pass inplace=True, or assign the result, to keep the smaller table.",
    }, view: tableBeat(out, `Result: DataFrame ${shapeOf(an.outShape)}`, { sampled: sampledText(winOf(out)) }) },
  ]);
}

// ── Element-wise calculation: a * b, df["x"] > 5 ─────────────────────────

export function calcBeats(st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null {
  const out = winOf(st.output);
  if (!out || out.kind !== "series" || !uniqueLabels(out) || st.inputs.length !== 2 || !(st.kind === "binop" || st.kind === "compare")) return null;
  const compare = st.kind === "compare";
  const ops = st.inputs.map((s) => {
    if (isTabular(s)) {
      const w = winOf(s);
      if (!w || w.kind !== "series" || !uniqueLabels(w)) return null;
      return { name: w.cols[0], at: (l: string): string | null => { const i = w.index.indexOf(l); return i >= 0 ? txt(w.rows[i][0]) : w.more ? null : "NaN"; }, scalar: false };
    }
    if (s.k === "df" || s.k === "group" || s.k === "nd" || s.k === "obj") return null;
    return { name: scalarText(s.r), at: () => scalarText(s.r), scalar: true };
  });
  if (ops.some((o) => !o) || ops.every((o) => o!.scalar)) return null;
  const [a, b] = ops as NonNullable<(typeof ops)[number]>[];
  const sym = st.op;
  const rows = out.index.map((label, i) => {
    const l = a.at(label), r = b.at(label);
    return l === null || r === null ? null : { label, l, r, res: txt(out.rows[i][0]) };
  });
  if (rows.some((r) => r === null)) return null;
  const R = rows as { label: string; l: string; r: string; res: string }[];
  const calcRows = () => R.map((x) => ({
    label: x.label, ident: [],
    parts: [{ text: x.l }, { text: sym, muted: true }, { text: x.r }, { text: x.res, chip: compare ? (x.res === "True" ? "true" : "false") : "value" }] as CalcPart[],
  }));
  const heads = [{ text: a.scalar ? "value" : a.name, span: 1 }, { text: "op", span: 1 }, { text: b.scalar ? "value" : b.name, span: 1 }, { text: "result", span: 1 }];
  const sample = sampledText(out);
  const view = (hideResult: boolean): CalcView => ({ owner: "pandas", type: "calc", heads, identHeads: [], rows: calcRows(), caption: `${clip(st.expr, 50)} row by row`, sampled: sample, hideResult });
  const n = an.rowsOut ?? out.nrows;
  const ex = R.slice(0, 2).map((x) => `row ${x.label}: ${x.l} ${sym} ${x.r} = ${x.res}`).join("; ");
  const nTrue = compare && !out.more ? R.filter((x) => x.res === "True").length : null;
  const nameA = a.scalar ? a.name : `the ${a.name} column`, nameB = b.scalar ? b.name : `the ${b.name} column`;
  return beatsOf(index, [
    { title: "Operands", story: {
      what: `Takes the two operands of ${clip(st.expr, 60)}: ${nameA} and ${nameB}.`,
      changed: `Nothing calculated yet. ${plural(n, "row")} will each get a result.`,
      why: "An operator works on whole columns: the same operation is applied to every row.",
      remember: "Two columns are matched by index label, row for row.",
    }, view: view(true) },
    { title: compare ? "Compare each row" : "Calculate each row", story: {
      what: `${compare ? "Compares" : "Calculates"} ${clip(st.expr, 60)} separately for every row.`,
      changed: `${ex}${n > 2 ? " …" : ""}.`,
      why: compare ? "Each row's own two values are compared, so every row gets its own True or False." : "Each row's own two values are combined, so every row gets its own result.",
      remember: compare ? "A comparison gives a column of True/False, not a single answer." : "No loop is needed: the operator runs on every row.",
    }, view: view(false) },
    { title: "Result", story: {
      what: `Collects the row results into a new Series of ${plural(n, "value")}.`,
      changed: `Result shape ${shapeOf(an.outShape)}, dtype ${st.output?.dtype ?? "?"}${nTrue !== null ? `; ${nTrue} True, ${R.length - nTrue} False` : ""}.`,
      why: "The result has the same index as the operands, so it lines up with the original rows.",
      remember: compare ? "Use this True/False column inside df[...] to keep the matching rows." : "Assign the result to a column, e.g. df['new'] = ..., to keep it.",
    }, view: tableBeat(st.output!, `Result: Series ${shapeOf(an.outShape)}`, { sampled: sample }) },
  ]);
}

// ── A new or replaced column: df["c"] = expr, df.assign(c=...) ───────────

export function assignBeats(st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null {
  const before = winOf(st.inputs[0]), after = winOf(st.output);
  if (!before || !after || before.kind !== "df" || after.kind !== "df" || !uniqueLabels(before) || before.index.join("\u0001") !== after.index.join("\u0001")) return null;
  if (an.rowsIn === null || an.rowsIn !== an.rowsOut) return null;
  const d = diffGrids(gridOfSnap(st.inputs[0]), gridOfSnap(st.output));
  if (!d.aligned || d.removedCols.length) return null;
  const changedCols = [...new Set(d.changed.map((c) => after.cols[c.col]))].filter((c) => !d.addedCols.includes(c));
  const targets = [...d.addedCols, ...changedCols];
  if (!targets.length) return null;
  const text = st.kind === "change" ? st.stmt : st.code;
  const opCols = mentioned(before.cols, text).filter((c) => !d.addedCols.includes(c));
  const toneBefore = (c: string): Tone => (opCols.includes(c) ? "used" : "normal");
  const toneAfter = (c: string): Tone => (targets.includes(c) ? "new" : opCols.includes(c) ? "used" : "normal");
  const tagAfter = (c: string): string | null => (d.addedCols.includes(c) ? "new" : changedCols.includes(c) ? "changed" : opCols.includes(c) ? "used" : null);
  const ti = targets.map((c) => after.cols.indexOf(c));
  const gridB = gridOf(before, toneBefore, (c) => (opCols.includes(c) ? "used" : null));
  const gridA = gridOf(after, toneAfter, tagAfter, (_, j) => (targets.includes(after.cols[j]) ? "new" : null));
  const sample = sampledText(before, after);
  const nr = an.rowsIn;
  const rowText = (i: number) => {
    const from = opCols.map((c) => `${c} ${txt(before.rows[i][before.cols.indexOf(c)])}`).join(", ");
    const to = targets.map((c, k) => `${c} ${txt(after.rows[i][ti[k]])}`).join(", ");
    return `row ${after.index[i]}: ${from ? `${from} → ` : ""}${to}`;
  };
  const tname = colList(targets, 3), oname = colList(opCols, 3);
  const verb = d.addedCols.length ? "new column" : "column";
  return beatsOf(index, [
    { title: "Before", story: {
      what: `The table has ${plural(nr, "row")} and ${plural(before.ncols, "column")} (${colList(before.allCols, 5)}). ${opCols.length ? `The code reads ${oname}` : "The code builds"} to make ${targets.length === 1 ? `the ${verb}` : "the columns"} ${tname}.`,
      changed: `Nothing yet: ${tname} ${d.addedCols.length ? "does not exist" : "still has its old values"}.`,
      why: "A calculated column is made from columns that already exist, row by row.",
      remember: "The code on the right of = runs first. The assignment comes after.",
    }, view: gridBeat(gridB, `Before: ${plural(before.ncols, "column")}`, sample) },
    { title: "Calculate each row", story: {
      what: `Calculates ${tname} for every row${opCols.length ? ` from ${oname}` : ""}.`,
      changed: `${[0, 1].filter((i) => i < after.rows.length).map(rowText).join("; ")}${nr > 2 ? " …" : ""}.`,
      why: opCols.length ? `The expression runs on whole columns, so each row's result uses that same row's ${oname}.` : "The values are computed for the whole column at once, one value per row.",
      remember: "The new column is lined up with the rows by index label, so row order cannot get mixed up.",
    }, view: gridBeat(gridA, `Each row's ${tname} next to the values it used`, sample) },
    { title: "After", story: {
      what: `${tname} ${targets.length === 1 ? "is" : "are"} now ${d.addedCols.length ? "part of" : "updated in"} the DataFrame.`,
      changed: `Columns ${an.colsIn?.length ?? before.ncols} → ${an.colsOut?.length ?? after.ncols}; shape ${shapeOf(an.inShape)} → ${shapeOf(an.outShape)}.${d.addedCols.length ? "" : ` ${plural(d.changed.length, "drawn cell")} changed.`}`,
      why: d.addedCols.length ? "Assigning to a name that does not exist yet adds a column. Existing columns are untouched." : "Assigning to an existing name replaces that column's values.",
      remember: "Calculated columns change the DataFrame itself, so run the cell once, or the column is added twice.",
    }, view: tableBeat(st.output!, `After: ${tname} highlighted`, { before: st.inputs[0], sampled: sampledText(after) }) },
  ]);
}

// ── Missing values: isna, fillna, ffill, bfill, interpolate ──────────────

const FILL_RULE: Record<string, string> = { ffill: "copies the last known value down into the gap", bfill: "copies the next known value up into the gap", interpolate: "estimates each gap from the values around it" };

export function fillBeats(st: DataStage, an: StageAnalysis, index: number, op: string): DataBeat[] | null {
  const before = winOf(st.inputs[0]), after = winOf(st.output);
  if (!before || !after || before.kind !== after.kind || !uniqueLabels(before) || before.index.join("\u0001") !== after.index.join("\u0001") || before.cols.join("\u0001") !== after.cols.join("\u0001")) return null;
  const naCount = before.rows.reduce((n, r) => n + r.filter((c) => c === null).length, 0);
  if (!naCount || an.missingBefore === null || an.missingAfter === null || an.missingBefore === an.missingAfter) return null;
  const filledAt = (i: number, j: number) => before.rows[i][j] === null && after.rows[i][j] !== null;
  let filled = 0;
  before.rows.forEach((r, i) => r.forEach((_, j) => { if (filledAt(i, j)) filled++; }));
  const args = callArgs(st, op);
  const naTag = (c: string) => { const j = before.cols.indexOf(c); const k = st.inputs[0].na?.[j] ?? 0; return k ? `${k} missing` : null; };
  const grid1 = gridOf(before, () => "normal", naTag, (i, j) => (before.rows[i][j] === null ? "nan" : null));
  const grid2 = gridOf(before, () => "normal", naTag, (i, j) => (before.rows[i][j] === null ? (filledAt(i, j) ? "new" : "nan") : null), (i, j) => (filledAt(i, j) ? `NaN → ${txt(after.rows[i][j])}` : null));
  const sample = sampledText(before);
  const total = an.missingBefore - an.missingAfter;
  const firstFill = (() => { for (let i = 0; i < before.rows.length; i++) for (let j = 0; j < before.cols.length; j++) if (filledAt(i, j)) return { i, j }; return null; })();
  const valueArg = args.kw.value ?? args.pos[0];
  const rule = op === "fillna" ? (valueArg ? `fills each missing cell with ${clip(valueArg, 40)}` : FILL_RULE[args.kw.method?.replace(/['"]/g, "") ?? ""] ?? "fills missing cells with the value you gave") : FILL_RULE[op];
  const left = an.missingAfter;
  const eg = firstFill ? `row ${before.index[firstFill.i]}, ${before.cols[firstFill.j]}: NaN → ${txt(after.rows[firstFill.i][firstFill.j])}` : "";
  return beatsOf(index, [
    { title: "Find the gaps", story: {
      what: `The input has ${plural(an.missingBefore, "missing cell")} (NaN) in ${plural(before.nrows, "row")}.`,
      changed: `Nothing filled yet: ${an.missingBefore} NaN ${an.missingBefore === 1 ? "cell is" : "cells are"} marked${before.more ? " (the drawn part is shown)" : ""}.`,
      why: "NaN means a value is absent. Calculations skip it or return NaN, so gaps are worth handling.",
      remember: "Find the gaps first: df.isna().sum() counts them per column.",
    }, view: gridBeat(grid1, "Missing cells are marked", sample) },
    { title: "Apply the fill rule", story: {
      what: `${op}() ${rule}.`,
      changed: `${plural(total, "cell")} get a value${eg ? ` (${eg})` : ""}; ${left === 0 ? "no NaN remains" : `${plural(left, "NaN cell")} remain`}.`,
      why: op === "fillna" ? "Only the missing cells change. Every other value stays exactly as it was." : "The fill follows the row order, so sort the data first if order matters.",
      remember: op === "fillna" ? "Fill with a value that fits the column's meaning, not just any number." : "A gap at the very start (or end) has nothing to copy from, so it can stay NaN.",
    }, view: gridBeat(grid2, "Each missing cell and the value it receives", sample) },
    { title: "Result", story: {
      what: `The result has ${plural(left, "missing cell")} left (was ${an.missingBefore}).`,
      changed: `Missing cells ${an.missingBefore} → ${left}; shape stays ${shapeOf(an.outShape)}.`,
      why: "The filled cells are highlighted; all other cells match the input.",
      remember: "fillna returns a new object unless you assign it back or pass inplace=True.",
    }, view: tableBeat(st.output!, "Result: filled cells highlighted", { before: st.inputs[0], sampled: sampledText(after) }) },
  ]);
}

export function isnaBeats(st: DataStage, an: StageAnalysis, index: number, op: string): DataBeat[] | null {
  const before = winOf(st.inputs[0]), after = winOf(st.output);
  if (!before || !after || st.output?.dtype !== "bool" && st.output?.k === "series" || before.index.join("\u0001") !== after.index.join("\u0001")) return null;
  if (an.missingBefore === null || !uniqueLabels(before)) return null;
  const inverse = op === "notna" || op === "notnull";
  const naTag = (c: string) => { const j = before.cols.indexOf(c); const k = st.inputs[0].na?.[j] ?? 0; return k ? `${k} missing` : null; };
  const grid = gridOf(before, () => "normal", naTag, (i, j) => (before.rows[i][j] === null ? "nan" : null));
  const sample = sampledText(before);
  const cells = (an.inShape ?? []).reduce((a, b) => a * b, 1);
  const count = inverse ? cells - an.missingBefore : an.missingBefore;
  const word = inverse ? "True where a value is present" : "True where a value is missing";
  return beatsOf(index, [
    { title: "Input values", story: {
      what: `The input has ${plural(cells, "cell")}, of which ${an.missingBefore} ${an.missingBefore === 1 ? "is" : "are"} missing (NaN).`,
      changed: "Nothing yet: the table is exactly as it was.",
      why: "isna() tests every cell on its own, so it needs to see all of them.",
      remember: "None and NaN both count as missing in pandas.",
    }, view: gridBeat(grid, "Input: missing cells are marked", sample) },
    { title: "Test every cell", story: {
      what: `${op}() tests each cell: ${word}.`,
      changed: `${plural(an.missingBefore, "missing cell")} → ${plural(count, "True value")} out of ${cells}.`,
      why: "The test gives one True or False per cell, in the same position as the cell it came from.",
      remember: "df.isna().sum() counts the missing cells per column; .sum().sum() counts them all.",
    }, view: gridBeat(grid, "Each marked cell becomes True in the result", sample) },
    { title: "Result", story: {
      what: `The result is a ${st.output?.k === "series" ? "Series" : "DataFrame"} of True/False with the same shape ${shapeOf(an.outShape)}.`,
      changed: `${count} True, ${cells - count} False (${inverse ? "present" : "missing"} cells are True).`,
      why: "Booleans are numbers in pandas (True is 1), so you can add them up to count.",
      remember: "Use df[df['col'].notna()] to keep only the rows where a column has a value.",
    }, view: tableBeat(st.output!, `Result: ${shapeOf(an.outShape)} of True/False`, { sampled: sampledText(after) }) },
  ]);
}

// ── Aggregation: groups collapse into one value each ─────────────────────

const AGG_WHY: Record<string, string> = {
  sum: "adds up the values", mean: "adds the values and divides by how many there are", count: "counts the values that are not missing", size: "counts the rows, missing values included",
  min: "picks the smallest value", max: "picks the largest value", median: "takes the middle value", std: "measures how spread out the values are", var: "measures the squared spread of the values",
  nunique: "counts the different values", first: "takes the first value", last: "takes the last value", prod: "multiplies the values",
};

export function aggBeats(st: DataStage, an: StageAnalysis, index: number, op: string): DataBeat[] | null {
  const gin = st.inputs[0], out = winOf(st.output);
  if (gin?.k !== "group" || !gin.groups || !out || gin.ngroups == null || gin.srcRows == null) return null;
  const args = callArgs(st, op);
  const fn = op === "agg" || op === "aggregate" ? quoted(args.pos[0] ?? args.kw.func)[0] : op;
  if (!fn || !(fn in AGG_WHY) || ((op === "agg" || op === "aggregate") && (args.pos.length + Object.keys(args.kw).length !== 1))) return null;
  const by = gin.by ?? [];
  const keyAt = (r: number): string => (by.length && by.every((c) => out.cols.includes(c)) ? by.map((c) => txt(out.rows[r][out.cols.indexOf(c)])).join(" | ") : out.index[r]);
  const valueCols = fn === "size" ? [] : out.kind === "series" ? [out.cols[0]] : out.cols.filter((c) => !by.includes(c));
  const blocks: GroupBlock[] = [];
  for (let gi = 0; gi < gin.groups.length; gi++) {
    const g = gin.groups[gi];
    const w = winOf(g.snap);
    const r = out.index.length ? Array.from({ length: out.rows.length }, (_, k) => k).find((k) => keyAt(k) === g.key) : undefined;
    if (!w || r === undefined) return null;
    const complete = g.size <= w.rows.length;
    const members = w.rows.map((row, i) => ({ label: w.index[i], cells: valueCols.map((c) => { const j = gin.source === "series" ? 0 : w.cols.indexOf(c); return j >= 0 ? txt(row[j]) : "?"; }) }));
    if (gin.source !== "series" && valueCols.some((c) => !w.cols.includes(c))) return null;
    const calcs = fn === "size"
      ? [{ col: "rows", fn, values: w.index.map((l) => `row ${l}`), value: txt(out.rows[r][0]), complete }]
      : valueCols.map((c, k) => ({ col: c, fn, values: members.map((m) => m.cells[k]), value: txt(out.rows[r][out.cols.indexOf(c)]), complete }));
    blocks.push({ key: g.key, size: g.size, color: gi, members, hidden: Math.max(0, g.size - w.rows.length), calcs });
  }
  const more = gin.ngroups - blocks.length;
  const sample = more > 0 ? `Sampled: ${blocks.length} of ${gin.ngroups} groups are drawn (up to 5 rows each). The numbers in the text are exact.` : blocks.some((b) => b.hidden) ? "Sampled: up to 5 rows of each group are drawn. The numbers in the text are exact." : null;
  const view = (phase: 0 | 1 | 2): GroupsView => ({ owner: "pandas", type: "groups", phase, cols: valueCols.length ? valueCols : ["rows"], groups: blocks, moreGroups: more, fn, result: phase === 2 ? st.output : null, caption: ["The groups", `${fn} inside each group`, `Result: one row per group`][phase], sampled: sample });
  const calcLine = (b: GroupBlock) => { const c = b.calcs[0]; return `${b.key}: ${fn}(${c.complete ? c.values.slice(0, 5).join(", ") : `${c.values.slice(0, 4).join(", ")}, …`}) = ${c.value}`; };
  const col = valueCols.length ? labelList(valueCols, 3) : "the rows";
  const resultRows = out.nrows;
  return beatsOf(index, [
    { title: "The groups", story: {
      what: `The ${plural(gin.ngroups, "group")} from the groupby are ready. ${fn}() will reduce each one to ${out.kind === "series" ? "a single value" : "one row"}.`,
      changed: `${gin.srcRows} rows sit in ${plural(gin.ngroups, "group")}: ${labelList(blocks.map((b) => `${b.key} (${b.size})`), 5)}.`,
      why: "Each group is calculated on its own: values from different groups never mix.",
      remember: "The aggregation, not groupby, does the arithmetic.",
    }, view: view(0) },
    { title: `${fn} per group`, story: {
      what: `${fn}() runs inside every group and uses only that group's ${col}.`,
      changed: `${labelList(blocks.map(calcLine), 3)}${blocks.length > 3 || more > 0 ? " …" : ""}.`,
      why: `${fn} ${AGG_WHY[fn]}.`,
      remember: "Many rows per group become one value per group.",
    }, view: view(1) },
    { title: "Result", story: {
      what: `The result has ${plural(resultRows, "row")}: one per group.`,
      changed: `${gin.srcRows} rows → ${resultRows} ${resultRows === 1 ? "row" : "rows"}; shape ${shapeOf(an.outShape)}. ${labelList(blocks.map((b) => `${b.key} = ${b.calcs[0].value}`), 3)}.`,
      why: by.length && !by.every((c) => out.cols.includes(c)) ? "The group keys became the index of the result, so each value is labelled by its group." : "The group keys are kept as a column, so each row says which group it belongs to.",
      remember: by.length && !by.every((c) => out.cols.includes(c)) ? "Use reset_index() or as_index=False to get the keys back as a normal column." : "The keys stay as a column because as_index=False was used.",
    }, view: view(2) },
  ]);
}
