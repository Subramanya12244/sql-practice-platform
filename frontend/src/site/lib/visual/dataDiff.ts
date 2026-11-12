import type { PyVal } from "./pyTrace";

export interface Grid { colLabels: string[]; rowLabels: string[]; cells: (string | null)[][] }

/** A DataFrame, Series or 1-2 D array as a labelled grid of short strings (what the trace captured, never the full data). */
export function gridOf(v: PyVal | undefined): Grid | null {
  if (!v) return null;
  if (v.k === "df" && v.cols && v.rows) return { colLabels: v.cols, rowLabels: v.index ?? v.rows.map((_, i) => String(i)), cells: v.rows };
  if (v.k === "series" && v.rows) return { colLabels: [v.name ?? "value"], rowLabels: v.index ?? v.rows.map((_, i) => String(i)), cells: v.rows };
  if (v.k === "nd") {
    const d = v.data;
    if (Array.isArray(d) && d.length && Array.isArray(d[0])) { const cells = d as (string | null)[][]; return { colLabels: cells[0].map((_, i) => String(i)), rowLabels: cells.map((_, i) => String(i)), cells }; }
    if (Array.isArray(d)) return { colLabels: (d as unknown[]).map((_, i) => String(i)), rowLabels: ["0"], cells: [d as (string | null)[]] };
    if (d !== undefined) return { colLabels: ["0"], rowLabels: ["0"], cells: [[d as string]] };
  }
  return null;
}

export interface CellChange { row: number; col: number; before: string | null; after: string | null }

export interface GridDiff {
  /** True when rows and columns line up by label, so cell-by-cell comparison is meaningful. */
  aligned: boolean;
  /** Cells whose value differs (only when aligned). */
  changed: CellChange[];
  /** Row labels only in `after` (added) / only in `before` (removed). */
  addedRows: string[];
  removedRows: string[];
  addedCols: string[];
  removedCols: string[];
  /** Cells in `after` that are missing (NaN/None) and were not missing before. */
  newMissing: number;
}

/** Compare two captured grids by row and column label. Pure and deterministic. */
export function diffGrids(before: Grid | null, after: Grid | null): GridDiff {
  const empty: GridDiff = { aligned: false, changed: [], addedRows: [], removedRows: [], addedCols: [], removedCols: [], newMissing: 0 };
  if (!before || !after) return empty;
  const rowsB = new Map(before.rowLabels.map((l, i) => [l, i])), rowsA = new Map(after.rowLabels.map((l, i) => [l, i]));
  const colsB = new Map(before.colLabels.map((l, i) => [l, i])), colsA = new Map(after.colLabels.map((l, i) => [l, i]));
  const out: GridDiff = {
    ...empty,
    addedRows: after.rowLabels.filter((l) => !rowsB.has(l)), removedRows: before.rowLabels.filter((l) => !rowsA.has(l)),
    addedCols: after.colLabels.filter((l) => !colsB.has(l)), removedCols: before.colLabels.filter((l) => !colsA.has(l)),
  };
  out.aligned = true;
  for (const [rl, ra] of rowsA) {
    const rb = rowsB.get(rl);
    if (rb === undefined) continue;
    for (const [cl, ca] of colsA) {
      const cb = colsB.get(cl);
      if (cb === undefined) continue;
      const b = before.cells[rb]?.[cb] ?? null, a = after.cells[ra]?.[ca] ?? null;
      if (b !== a) { out.changed.push({ row: ra, col: ca, before: b, after: a }); if (a === null && b !== null) out.newMissing++; }
    }
  }
  return out;
}

/** Sentence for what changed between two data values (shape, dtype, cells). Only facts from the two captures. */
export function describeDataChange(before: PyVal | undefined, after: PyVal | undefined, name: string): string {
  if (!after) return "";
  const shape = (v: PyVal) => (v.shape ? `(${v.shape.join(", ")})` : "");
  const parts: string[] = [];
  if (!before) parts.push(`${name} is created with shape ${shape(after)}`);
  else if (before.id !== undefined && before.id === after.id && JSON.stringify(before) !== JSON.stringify(after)) parts.push(`${name} was changed in place (same object)`);
  else if (before.id !== after.id) parts.push(`${name} now refers to a new object`);
  if (before?.shape && after.shape && shape(before) !== shape(after)) parts.push(`shape ${shape(before)} → ${shape(after)}`);
  if (before?.dtypes && after.dtypes && before.dtypes.join() !== after.dtypes.join()) parts.push(`dtypes ${before.dtypes.join(", ")} → ${after.dtypes.join(", ")}`);
  if (before?.dtype && after.dtype && before.dtype !== after.dtype) parts.push(`dtype ${before.dtype} → ${after.dtype}`);
  const d = diffGrids(gridOf(before), gridOf(after));
  if (d.changed.length) parts.push(`${d.changed.length} shown cell${d.changed.length === 1 ? "" : "s"} changed${d.newMissing ? `, ${d.newMissing} became missing` : ""}`);
  if (d.addedCols.length) parts.push(`new column${d.addedCols.length > 1 ? "s" : ""}: ${d.addedCols.join(", ")}`);
  if (d.removedCols.length) parts.push(`dropped column${d.removedCols.length > 1 ? "s" : ""}: ${d.removedCols.join(", ")}`);
  if (d.removedRows.length) parts.push(`${d.removedRows.length} shown row${d.removedRows.length > 1 ? "s" : ""} removed`);
  if (d.addedRows.length) parts.push(`${d.addedRows.length} row${d.addedRows.length > 1 ? "s" : ""} added`);
  return parts.length ? `${parts.join("; ")}.` : "";
}
