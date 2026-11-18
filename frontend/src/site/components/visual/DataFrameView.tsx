import { useMemo } from "react";
import { diffGrids } from "../../lib/visual/dataDiff";
import { gridOfSnap, type DataSnap, type MarkTone, type RowMark } from "../../lib/visual/dataframe";

export type { MarkTone, RowMark };

const cell = "border border-surface-border px-1.5 py-0.5 text-xs tabular-nums";
const TONE: Record<MarkTone, string> = { ok: "bg-success-dim", bad: "bg-danger-dim", warn: "bg-warn-dim", info: "bg-info-dim", none: "" };
const TONE_TEXT: Record<MarkTone, string> = { ok: "text-success", bad: "text-danger", warn: "text-ink", info: "text-ink", none: "text-ink-faint" };

export interface DataFrameViewProps {
  snap: DataSnap;
  /** The same variable before the step: changed cells, added columns and new rows are highlighted against it. */
  before?: DataSnap | null;
  caption?: string;
  /** One mark per shown row (e.g. kept / removed, matched / unmatched). */
  rowMarks?: (RowMark | null)[];
  markHeader?: string;
  /** Highlight these columns (e.g. the merge keys). */
  keyCols?: string[];
  reducedMotion?: boolean;
}

/** A captured DataFrame or Series as an accessible table. Shows the real shape and says when only the first rows and columns are drawn. */
export function DataFrameView({ snap, before, caption, rowMarks, markHeader = "Row", keyCols = [], reducedMotion }: DataFrameViewProps) {
  const g = useMemo(() => gridOfSnap(snap), [snap]);
  const diff = useMemo(() => (before ? diffGrids(gridOfSnap(before), g) : null), [before, g]);
  if (!g) return null;
  const changed = new Set((diff?.changed ?? []).map((c) => `${c.row}:${c.col}`));
  const addedCols = new Set(diff?.addedCols ?? []);
  const addedRows = new Set(diff?.addedRows ?? []);
  const shape = snap.shape ?? [];
  const nrows = shape[0] ?? g.cells.length, ncols = snap.k === "df" ? shape[1] ?? g.colLabels.length : 1;
  const hasMarks = !!rowMarks?.some(Boolean);
  const trans = reducedMotion ? "" : "transition-colors duration-300";
  const dt = snap.k === "df" ? snap.dtypes : [snap.dtype ?? ""];
  const na = snap.na ?? [];
  return (
    <div className="min-w-0 overflow-x-auto" data-df-view={snap.k}>
      <table className="border-collapse text-left" aria-label={caption ?? (snap.k === "df" ? "DataFrame" : "Series")}>
        {caption && <caption className="mb-1 text-left text-xs font-medium text-ink-muted">{caption}</caption>}
        <thead>
          <tr>
            {hasMarks && <th scope="col" className={`${cell} bg-surface-soft text-ink-faint`}>{markHeader}</th>}
            <th scope="col" className={`${cell} bg-surface-soft`}><span className="sr-only">index</span></th>
            {g.colLabels.map((c, i) => (
              <th key={i} scope="col" className={`${cell} ${trans} bg-surface-soft font-semibold ${addedCols.has(c) ? "bg-accent-dim text-accent" : keyCols.includes(c) ? "bg-info-dim text-ink" : ""}`}>
                {c}{keyCols.includes(c) ? <span className="ml-1 text-[10px] font-normal text-ink-faint">key</span> : null}{addedCols.has(c) ? <span className="ml-1 text-[10px] font-normal">new</span> : null}
                <span className="block text-[10px] font-normal text-ink-faint">{dt?.[i] ?? ""}{na[i] ? ` · ${na[i]} missing` : ""}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.cells.map((row, r) => {
            const mark = rowMarks?.[r] ?? null;
            const isNew = addedRows.has(g.rowLabels[r]);
            return (
              <tr key={r} className={mark ? TONE[mark.tone] : ""}>
                {hasMarks && <td className={`${cell} text-[10px] font-semibold uppercase tracking-wide ${mark ? TONE_TEXT[mark.tone] : ""}`}>{mark?.label ?? ""}</td>}
                <th scope="row" className={`${cell} bg-surface-soft font-medium ${isNew ? "text-accent" : ""}`}>{g.rowLabels[r]}</th>
                {row.map((c, ci) => {
                  const ch = changed.has(`${r}:${ci}`);
                  return (
                    <td key={ci} data-changed={ch ? "true" : undefined} title={ch ? `Changed in this step (before: ${diff?.changed.find((x) => x.row === r && x.col === ci)?.before ?? "NaN"})` : undefined}
                      className={`${cell} ${trans} ${ch ? "bg-warn-dim font-semibold text-ink" : addedCols.has(g.colLabels[ci]) ? "bg-accent-dim" : ""} ${c === null ? "italic text-ink-faint" : "text-ink"}`}>
                      {c === null ? "NaN" : c}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {g.cells.length === 0 && <tr><td className={`${cell} text-ink-faint`} colSpan={g.colLabels.length + 2}>no rows</td></tr>}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-ink-faint">
        shape ({shape.join(", ")}){snap.k === "df" ? "" : ` · dtype ${snap.dtype}`}{snap.k === "df" && snap.naTotal ? ` · ${snap.naTotal} missing cell${snap.naTotal === 1 ? "" : "s"}` : ""}
        {snap.more ? ` · showing the first ${g.cells.length} of ${nrows} row${nrows === 1 ? "" : "s"}${snap.k === "df" ? ` and ${g.colLabels.length} of ${ncols} column${ncols === 1 ? "" : "s"}` : ""}` : ""}
      </p>
    </div>
  );
}
