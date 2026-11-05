/** Display-only sort and filter for a result grid. The query result itself is never changed. */
export type SortDir = "asc" | "desc";
export interface ResultView { sortCol: number | null; dir: SortDir; filter: string }

const isNum = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)));

/** NULLs sort last in both directions; numbers compare numerically, everything else as text. */
export function compareCells(a: unknown, b: unknown): number {
  const an = a === null || a === undefined, bn = b === null || b === undefined;
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;
  if (isNum(a) && isNum(b)) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function applyResultView(rows: unknown[][], v: ResultView): unknown[][] {
  const q = v.filter.trim().toLowerCase();
  let out = q ? rows.filter((r) => r.some((c) => (c === null || c === undefined ? "null" : typeof c === "object" ? JSON.stringify(c) : String(c)).toLowerCase().includes(q))) : rows;
  if (v.sortCol !== null) {
    const i = v.sortCol;
    out = [...out].sort((a, b) => {
      const an = a[i] === null || a[i] === undefined, bn = b[i] === null || b[i] === undefined;
      if (an || bn) return compareCells(a[i], b[i]); // NULLs last regardless of direction
      return v.dir === "asc" ? compareCells(a[i], b[i]) : compareCells(b[i], a[i]);
    });
  }
  return out;
}

/** Header click cycles: unsorted → ascending → descending → unsorted. */
export function nextSort(v: ResultView, col: number): ResultView {
  if (v.sortCol !== col) return { ...v, sortCol: col, dir: "asc" };
  return v.dir === "asc" ? { ...v, dir: "desc" } : { ...v, sortCol: null, dir: "asc" };
}
