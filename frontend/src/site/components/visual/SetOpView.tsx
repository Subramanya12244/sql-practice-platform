import { FATE_TEXT, opName, type ColumnPair, type RowFate, type SetOpData, type SetSample } from "../../lib/visual/setOps";
import { SampleTable } from "../SampleTable";
import { ProvenanceBadge } from "./Playback";

const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Row tint plus a text label, so the meaning never depends on colour alone. */
const FATE_CLASS: Record<RowFate, string> = {
  kept: "bg-success-dim",
  duplicate: "bg-warn-dim",
  cancelled: "bg-danger-dim",
  unmatched: "bg-danger-dim",
  "not output": "",
};

/** One input with the per-row check: whether an identical row exists on the other side, and what happens to the row. */
function InputTable({ title, label, count, distinct, sample }: { title: string; label?: string; count?: number; distinct?: number; sample: SetSample }) {
  const marks = sample.marks;
  return (
    <section aria-label={title} className="min-w-0 space-y-1">
      <h4 className="text-xs font-semibold text-ink">{title} <span className="font-normal text-ink-faint">{count === undefined ? "row count unavailable" : `${count} row${count === 1 ? "" : "s"}${distinct !== undefined ? `, ${distinct} distinct` : ""}`}</span></h4>
      {label && <p className="truncate font-mono text-[11px] text-ink-faint" title={label}>{label}</p>}
      {!sample.columns.length ? (
        <p className="text-xs text-ink-faint">Rows unavailable for this input.</p>
      ) : (
        <div tabIndex={0} className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="min-w-full text-xs">
            <thead className="bg-surface-soft">
              <tr>
                {sample.columns.map((c, i) => <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-semibold text-ink-muted">{c}</th>)}
                {marks && <th className="whitespace-nowrap px-2 py-1 text-left font-semibold text-ink-muted">In other input?</th>}
                {marks && <th className="whitespace-nowrap px-2 py-1 text-left font-semibold text-ink-muted">Result</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {sample.rows.map((r, i) => (
                <tr key={i} className={marks ? FATE_CLASS[marks[i].fate] : ""}>
                  {r.map((v, j) => <td key={j} className={`whitespace-nowrap px-2 py-1 font-mono ${v === null ? "italic text-ink-faint" : "text-ink"}`}>{cell(v)}</td>)}
                  {marks && <td className="whitespace-nowrap px-2 py-1 text-ink-muted">{marks[i].matched ? "yes" : "no"}</td>}
                  {marks && <td className="whitespace-nowrap px-2 py-1 text-ink-muted">{FATE_TEXT[marks[i].fate]}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {count !== undefined && count > sample.rows.length && sample.columns.length > 0 && <p className="text-[11px] text-ink-faint">First {sample.rows.length} of {count} rows shown; counts are exact.</p>}
    </section>
  );
}

function Compat({ data }: { data: SetOpData }) {
  const pairs: ColumnPair[] = data.pairs ?? [];
  return (
    <section aria-label="Column compatibility" className="space-y-1">
      <h4 className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink">
        Compatibility check
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${data.compat.ok ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>{data.compat.ok ? "Compatible" : "Rejected by PostgreSQL"}</span>
      </h4>
      {!data.compat.ok && data.error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 font-mono text-xs text-ink">{data.error}</p>}
      {pairs.length > 0 && (
        <div tabIndex={0} className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="min-w-full text-xs">
            <caption className="sr-only">Column pairing: position, output name from the left input, and the column type on each side</caption>
            <thead className="bg-surface-soft">
              <tr>{["#", "Output name (from left)", "Left type", "Right type", "Output type"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1 text-left font-semibold text-ink-muted">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {pairs.map((p) => (
                <tr key={p.position}>
                  <td className="px-2 py-1 text-ink-muted">{p.position}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-ink">{p.name}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-ink">{p.left ?? "unavailable"}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-ink">{p.right ?? "unavailable"}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-ink">{p.result ?? (data.compat.ok ? "unavailable" : "no common type")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.compat.ok && data.compat.notes.map((n, i) => <p key={i} className="text-xs text-ink-muted">{n}</p>)}
      {!data.compat.ok && data.compat.notes.slice(1).map((n, i) => <p key={i} className="text-xs text-ink-muted">{n}</p>)}
      {data.unavailable?.types && <p className="text-xs text-ink-faint">Types unavailable: {data.unavailable.types}</p>}
    </section>
  );
}

/** Draws one set-operation stage: both inputs, the compatibility check, matched and removed rows, and the result. */
export function SetOpView({ data }: { data: SetOpData }) {
  const name = opName(data.op, data.all);
  const marked = Boolean(data.left.marks);
  return (
    <div className="space-y-4" data-testid="setop-view">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{name}</h3>
        <ProvenanceBadge p="executed" />
        <span className="text-[11px] text-ink-faint">Real rows from running each input and the operation in this browser; the plan may combine them differently.</span>
      </div>
      <p className="rounded-lg bg-surface-soft px-3 py-2 text-xs text-ink-muted"><strong className="text-ink">Duplicate rule.</strong> {data.rule}</p>

      <Compat data={data} />

      <div className="grid gap-3 md:grid-cols-2">
        <InputTable title="Left input" label={data.leftLabel} count={data.leftCount} distinct={data.leftDistinct} sample={data.left} />
        <InputTable title="Right input" label={data.rightLabel} count={data.rightCount} distinct={data.rightDistinct} sample={data.right} />
      </div>
      {marked && <p className="text-[11px] text-ink-faint">Row tint and the last two columns: green = reaches the result, amber = extra copy dropped, red = removed or no match. Matching treats NULL as equal to NULL.</p>}
      {data.unavailable?.marks && <p className="text-xs text-ink-faint">Per-row marks unavailable: {data.unavailable.marks}</p>}

      {data.compat.ok && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {data.matched && (
              <section aria-label="Matching rows" className="min-w-0 space-y-1">
                <h4 className="text-xs font-semibold text-ink">Matching rows <span className="font-normal text-ink-faint">{data.matchedCount === undefined ? "" : `${data.matchedCount}`}</span></h4>
                <p className="text-[11px] text-ink-faint">{data.matchedLabel}</p>
                <SampleTable columns={data.matched.columns} rows={data.matched.rows} />
              </section>
            )}
            {data.removed && (
              <section aria-label="Removed rows" className="min-w-0 space-y-1">
                <h4 className="text-xs font-semibold text-ink">Removed <span className="font-normal text-ink-faint">{data.removedCount === undefined ? "" : `${data.removedCount}`}</span></h4>
                <p className="text-[11px] text-ink-faint">{data.removedLabel}</p>
                {data.removed.rows.length ? <SampleTable columns={data.removed.columns} rows={data.removed.rows} /> : <p className="text-xs text-ink-muted">None.</p>}
              </section>
            )}
          </div>
          {data.unavailable?.matched && <p className="text-xs text-ink-faint">Matching rows unavailable: {data.unavailable.matched}</p>}
          {data.unavailable?.removed && <p className="text-xs text-ink-faint">Removed rows unavailable: {data.unavailable.removed}</p>}
          {data.unavailable?.counts && <p className="text-xs text-ink-faint">Some counts unavailable: {data.unavailable.counts}</p>}

          <section aria-label="Result" className="space-y-1">
            <h4 className="text-xs font-semibold text-ink">Result <span className="font-normal text-ink-faint">{data.resultCount ?? data.result.rows.length} row{(data.resultCount ?? data.result.rows.length) === 1 ? "" : "s"}</span></h4>
            {data.arithmetic && <p className={`text-xs ${data.arithmetic.ok ? "text-ink-muted" : "text-warn"}`}>{data.arithmetic.text}</p>}
            <SampleTable columns={data.result.columns} rows={data.result.rows} />
            {(data.resultCount ?? 0) > data.result.rows.length && <p className="text-[11px] text-ink-faint">First {data.result.rows.length} of {data.resultCount} rows shown.</p>}
          </section>
        </>
      )}
    </div>
  );
}
