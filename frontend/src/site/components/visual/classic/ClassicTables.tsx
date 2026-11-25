/**
 * The intermediate tables of the current step: the rows going in, the rows coming out, the rows removed, join counts and
 * partitions. All of it is real data from the stage run (Stage) or the teaching card (TableSnapshot); nothing is computed to look right.
 */
import { memo } from "react";
import type { Stage } from "../../../lib/visualize";
import type { TableSnapshot, TeachCard } from "../../../lib/visual/classic/contract";
import { ClassicTable } from "./ClassicTable";

/** Steps that drop rows. Grouping, aggregating and projecting also lower the count, but nothing is "removed": rows are folded together. */
const FILTERS = new Set(["where", "having", "distinct", "limit", "setop"]);

function Counts({ rowsIn, rowsOut, kind }: { rowsIn?: number; rowsOut?: number; kind: TeachCard["kind"] }) {
  if (rowsIn === undefined && rowsOut === undefined) return null;
  let delta: string | null = null;
  let tone = "text-ink-muted";
  if (rowsIn !== undefined && rowsOut !== undefined && rowsIn > 0) {
    if (rowsOut < rowsIn) {
      const n = (rowsIn - rowsOut).toLocaleString();
      const pct = Math.round(((rowsIn - rowsOut) / rowsIn) * 100);
      if (FILTERS.has(kind)) { delta = `${n} removed (${pct}%)`; tone = "text-danger"; } else delta = `${n} fewer rows (${pct}%)`;
    }
    else if (rowsOut > rowsIn) { delta = `${(rowsOut - rowsIn).toLocaleString()} added (${(rowsOut / rowsIn).toFixed(1)}x)`; tone = "text-accent"; }
    else delta = "all rows kept";
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="classic-counts">
      {rowsIn !== undefined && <span className="rounded bg-surface-soft px-2 py-0.5 text-ink-muted">in <strong className="tabular-nums text-ink">{rowsIn.toLocaleString()}</strong></span>}
      {rowsOut !== undefined && <span className="rounded bg-accent-dim px-2 py-0.5 text-accent">out <strong className="tabular-nums">{rowsOut.toLocaleString()}</strong></span>}
      {delta && <span className={`font-medium ${tone}`}>{delta}</span>}
    </p>
  );
}

function JoinDetail({ j }: { j: NonNullable<Stage["joins"]>[number] }) {
  const upper = j.kind.toUpperCase();
  const outer = upper.includes("LEFT");
  const rightOuter = upper.includes("RIGHT") || upper.includes("FULL");
  const fanOut = Boolean(j.leftRows && j.matchedPairs && j.matchedPairs > j.leftRows);
  const note = "rounded-md border border-surface-border bg-surface-soft px-2.5 py-1.5 text-xs text-ink-muted";
  return (
    <div className="space-y-2 rounded-lg border border-surface-border p-2.5 text-sm">
      <p className="font-semibold text-ink">{j.kind} {j.right}{j.on ? <span className="font-normal text-ink-muted"> ON {j.on}</span> : null}</p>
      {j.leftRows !== undefined && (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-1.5">
          {([["Left rows", j.leftRows], ["Right rows", j.rightRows], ["Matching pairs", j.matchedPairs], ["Unmatched left", j.unmatchedLeft], ["Unmatched right", j.unmatchedRight]] as const).map(([k, val]) => (
            <div key={k} className="rounded-md bg-surface-soft px-2 py-1">
              <dt className="text-[11px] text-ink-faint">{k}</dt>
              <dd className="font-mono tabular-nums text-ink">{typeof val === "number" ? val.toLocaleString() : (val ?? "—")}</dd>
            </div>
          ))}
        </dl>
      )}
      {fanOut && <p className="rounded-md border border-accent/30 bg-accent-dim px-2.5 py-1.5 text-xs text-ink"><strong>Fan-out:</strong> {j.matchedPairs?.toLocaleString()} matching pairs for {j.leftRows?.toLocaleString()} left rows, so some left rows matched more than one right row.</p>}
      {Boolean(j.unmatchedLeft && j.unmatchedLeft > 0) && <p className={note}><strong className="text-ink">Unmatched left rows:</strong> {j.unmatchedLeft?.toLocaleString()} had no match in {j.right}. {outer ? "Kept, with NULL in the right columns (LEFT JOIN)." : "Dropped (INNER JOIN)."}</p>}
      {Boolean(j.unmatchedRight && j.unmatchedRight > 0) && <p className={note}><strong className="text-ink">Unmatched right rows:</strong> {j.unmatchedRight?.toLocaleString()} in {j.right} had no match. {rightOuter ? "Kept, with NULL in the left columns." : "Dropped."}</p>}
      {j.resultRows !== undefined && <p className="text-xs text-ink-muted">Rows after this join: <strong className="tabular-nums text-ink">{j.resultRows.toLocaleString()}</strong></p>}
      {j.unmatchedLeftSample && <ClassicTable table={{ title: "Unmatched left rows (sample)", ...j.unmatchedLeftSample, role: "other" }} />}
      {j.unmatchedRightSample && <ClassicTable table={{ title: "Unmatched right rows (sample)", ...j.unmatchedRightSample, role: "other" }} />}
    </div>
  );
}

function TablesBase({ stage, card, index }: { stage: Stage; card: TeachCard; index: number }) {
  const snaps: TableSnapshot[] = [...card.inputs, ...card.outputs];
  const has = (role: TableSnapshot["role"]) => snaps.some((t) => t.role === role);
  // The card supplies the tables; the stage's own samples fill in only what the card leaves out (the starter card has no input or removed rows).
  if (!has("output") && !has("input") && stage.sample?.columns.length) snaps.push({ title: `Rows at this step`, role: "output", columns: stage.sample.columns, rows: stage.sample.rows, total: stage.rowsOut });
  if (!has("removed") && stage.removed?.columns.length) snaps.push({ title: "Removed at this step (sample)", role: "removed", columns: stage.removed.columns, rows: stage.removed.rows });
  if (stage.partitions && !snaps.some((t) => /partition/i.test(t.title))) snaps.push({ title: "Partitions (rows per window partition)", role: "other", columns: stage.partitions.columns, rows: stage.partitions.rows });
  const ordered = [...snaps.filter((t) => t.role === "input"), ...snaps.filter((t) => t.role === "output"), ...snaps.filter((t) => t.role === "other"), ...snaps.filter((t) => t.role === "removed")];
  return (
    <section data-testid="classic-tables" data-step-index={index} aria-label="Rows at this step" className="vizc-tables min-w-0 space-y-2">
      <h3 className="vizc-tables-head">Tables: rows at this step</h3>
      <Counts rowsIn={card.rowsIn ?? stage.rowsIn} rowsOut={card.rowsOut ?? stage.rowsOut} kind={card.kind} />
      {ordered.length === 0 && (card.rowsOut ?? stage.rowsOut) === 0 && <p data-testid="classic-empty" className="rounded-lg border border-dashed border-surface-border px-3 py-2 text-sm text-ink-muted">0 rows. This step produced no rows, which is a valid result.</p>}
      <div className="vizc-table-grid">
        {ordered.map((t, i) => <ClassicTable key={`${i}:${t.title}`} table={t} />)}
      </div>
      {stage.joins?.map((j, i) => <JoinDetail key={i} j={j} />)}
      {stage.sql && stage.source === "executed" && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-faint">Query used for this step (built from your clauses)</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-surface-soft p-2 font-mono text-ink-muted">{stage.sql}</pre>
        </details>
      )}
      {stage.error && <p role="alert" className="text-sm text-ink-muted">Rows for this step couldn&apos;t be computed ({stage.error}); the explanation still applies.</p>}
    </section>
  );
}

export const ClassicTables = memo(TablesBase);
