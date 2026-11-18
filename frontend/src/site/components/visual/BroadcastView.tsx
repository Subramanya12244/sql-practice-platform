import type { BroadcastTable, CrossCheck, DimStatus } from "../../lib/visual/broadcast";
import { numpyShape } from "../../lib/visual/broadcast";

const cell = "border border-surface-border px-2 py-1 text-xs tabular-nums";
const WORD: Record<DimStatus, string> = { equal: "equal", stretch: "stretched (1)", missing: "missing, counts as 1", incompatible: "incompatible" };
const TONE: Record<DimStatus, string> = { equal: "", stretch: "bg-accent-dim", missing: "bg-accent-dim", incompatible: "bg-danger-dim text-danger font-semibold" };

export interface BroadcastViewProps {
  table: BroadcastTable;
  /** Names of the operands in order, e.g. ["a", "b"]. */
  names?: string[];
  /** NumPy's real error text when the run failed. */
  errorText?: string | null;
  check?: CrossCheck | null;
}

/**
 * The broadcasting rule on the real shapes: shapes aligned on the right, one row per axis (last axis first), each cell marked
 * equal / stretched / missing / incompatible with the word, not only a colour. Says whether the shapes are valid and, if not,
 * exactly which axes conflict.
 */
export function BroadcastView({ table, names, errorText, check }: BroadcastViewProps) {
  const label = (i: number) => names?.[i] ?? `array ${i + 1}`;
  return (
    <div className="min-w-0 space-y-2" data-broadcast-valid={table.valid ? "true" : "false"}>
      <div className="overflow-x-auto">
        <table className="border-collapse text-left" aria-label="Broadcasting: shapes aligned on the right">
          <caption className="mb-1 text-left text-xs font-medium text-ink-muted">Shapes are lined up from the last axis. Each pair of sizes must be equal, or one of them must be 1.</caption>
          <thead>
            <tr>
              <th scope="col" className={`${cell} bg-surface-soft`}>Axis</th>
              {table.shapes.map((s, i) => <th key={i} scope="col" className={`${cell} bg-surface-soft`}>{label(i)} <span className="font-normal text-ink-faint">{numpyShape(s)}</span></th>)}
              <th scope="col" className={`${cell} bg-surface-soft`}>Result <span className="font-normal text-ink-faint">{table.resultShape ? numpyShape(table.resultShape) : "none"}</span></th>
            </tr>
          </thead>
          <tbody>
            {[...table.rows].map((r) => (
              <tr key={r.fromRight}>
                <th scope="row" className={`${cell} bg-surface-soft font-medium`}>{-(r.fromRight + 1)}<span className="ml-1 text-[10px] font-normal text-ink-faint">{r.fromRight === 0 ? "last" : ""}</span></th>
                {r.cells.map((c, i) => (
                  <td key={i} data-status={c.status} className={`${cell} ${TONE[c.status]}`}>
                    {c.size === null ? "·" : c.size} <span className="text-[10px] font-normal opacity-80">{WORD[c.status]}</span>
                  </td>
                ))}
                <td data-status={r.status} className={`${cell} ${r.status === "incompatible" ? TONE.incompatible : ""}`}>{r.resultSize === null ? "conflict" : r.resultSize}</td>
              </tr>
            ))}
            {table.rows.length === 0 && <tr><td className={`${cell} text-ink-faint`} colSpan={table.shapes.length + 2}>Both are scalars: nothing to align.</td></tr>}
          </tbody>
        </table>
      </div>
      <p role="status" className={`text-sm ${table.valid ? "text-ink" : "text-danger"}`}>
        <span className="font-semibold">{table.valid ? "Valid." : "Not valid."}</span> {table.message}
      </p>
      {!table.valid && table.conflicts.length > 0 && (
        <ul className="list-inside list-disc text-xs text-ink-muted">
          {table.conflicts.map((c) => <li key={c.fromRight}>Axis {c.axisNegative}: {c.sizes.map((s) => `${label(s.operand)} has ${s.size}`).join(", ")}</li>)}
        </ul>
      )}
      {errorText && <p className="rounded border border-danger/30 bg-danger-dim px-2 py-1 font-mono text-xs text-danger"><span className="font-sans font-semibold">NumPy said: </span>ValueError: {errorText.trim()}</p>}
      {check && <p className={`text-[11px] ${check.ok ? "text-ink-faint" : "text-danger"}`}>{check.ok ? "Checked against the real run: " : "Mismatch with the real run: "}{check.checks.map((c) => c.detail).join(" ")}</p>}
    </div>
  );
}
