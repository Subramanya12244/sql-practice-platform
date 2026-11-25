/**
 * A compact table of real rows for the SQL Practice visualizer: sticky header, numbers right-aligned in tabular figures, NULL
 * shown as its own marker (not as the word "null" in a string), long values truncated with the full value in a tooltip.
 * It only draws what it is given. Wider than its pane it scrolls sideways INSIDE itself and says so: a slim scrollbar that stays visible,
 * a fade on the edge that has more columns, a "scrolls sideways" hint, a sticky first column, and headers that wrap (full text in a title).
 */
import { Fragment, memo, useCallback, useEffect, useRef, useState } from "react";
import type { TableSnapshot } from "../../../lib/visual/classic/contract";

const NUMERIC = /^-?\d+(\.\d+)?$/;
const isNum = (v: unknown) => typeof v === "number" || typeof v === "bigint" || (typeof v === "string" && NUMERIC.test(v));
/** A column name with a break opportunity after every "." and "_" (c.customer_id wraps as c. / customer_ / id, never mid-word). */
const breakable = (c: string) => c.split(/(?<=[._])/).map((part, i, all) => <Fragment key={i}>{part}{i < all.length - 1 && <wbr />}</Fragment>);
const text = (v: unknown) => (typeof v === "object" ? JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) : String(v));

const ROLE: Record<TableSnapshot["role"], { tag: string; cls: string }> = {
  input: { tag: "in", cls: "bg-surface-soft text-ink-muted" },
  output: { tag: "out", cls: "bg-accent-dim text-accent" },
  removed: { tag: "removed", cls: "bg-danger-dim text-danger" },
  other: { tag: "", cls: "" },
};

function ClassicTableBase({ table, max = 20, bare = false }: { table: Pick<TableSnapshot, "columns" | "rows"> & Partial<Pick<TableSnapshot, "title" | "total" | "role">>; max?: number; bare?: boolean }) {
  const { columns, rows, title, total, role = "other" } = table;
  const shown = rows.slice(0, max);
  const numeric = columns.map((_, j) => shown.some((r) => r[j] !== null && r[j] !== undefined) && shown.every((r) => r[j] === null || r[j] === undefined || isNum(r[j])));
  const known = total ?? rows.length;
  const r = ROLE[role];
  const box = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    measure();
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = el.querySelector("table");
    if (t) ro.observe(t);
    return () => ro.disconnect();
  }, [measure, columns, rows]);
  if (!columns.length) return null;
  const first = (j: number) => (j === 0 ? " vizc-col-first" : "");
  return (
    <figure className="vizc-table min-w-0" data-role={role}>
      {!bare && title && (
        <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
          {r.tag && <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${r.cls}`}>{r.tag}</span>}
          <span className="font-medium text-ink">{title}</span>
          <span className="tabular-nums text-ink-faint">{shown.length < known ? `first ${shown.length} of ${known.toLocaleString()} rows` : `${known.toLocaleString()} ${known === 1 ? "row" : "rows"}`}</span>
        </figcaption>
      )}
      <div className="vizc-scrollwrap" data-more-right={edge.right} data-more-left={edge.left}>
      <div ref={box} tabIndex={0} role="region" aria-label={`${title ?? "Rows"}, table, scrolls sideways when wide`} data-help="sample-table" onScroll={measure} className="vizc-scroll max-h-56 overflow-auto rounded-lg border border-surface-border bg-surface">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>{columns.map((c, i) => (
              <th key={i} scope="col" title={c} aria-label={c} className={`vizc-th sticky top-0 z-[2] border-b border-surface-border bg-surface-soft px-2 py-1 font-semibold text-ink-muted${first(i)} ${numeric[i] ? "text-right" : "text-left"}`}>{breakable(c)}</th>
            ))}</tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} data-tone={role === "removed" ? "removed" : undefined} className={role === "removed" ? "vizc-row-removed" : "even:bg-surface-raised/60"}>
                {columns.map((_, j) => {
                  const v = row[j];
                  const nul = v === null || v === undefined;
                  const s = nul ? "NULL" : text(v);
                  return (
                    <td key={j} title={nul ? "NULL (no value)" : s} className={`max-w-[14rem] truncate whitespace-nowrap border-b border-surface-border/60 px-2 py-1 font-mono${first(j)} ${numeric[j] ? "text-right tabular-nums" : "text-left"} ${nul ? "vizc-null" : "text-ink"}`}>{s === "" ? <span className="vizc-null">(empty)</span> : s}</td>
                  );
                })}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={columns.length} className="px-2 py-2 text-ink-muted">No rows.</td></tr>}
          </tbody>
        </table>
      </div>
      </div>
      {edge.right && <p className="vizc-scrollhint" data-testid="classic-scroll-hint">More columns to the right: scroll sideways.</p>}
    </figure>
  );
}

export const ClassicTable = memo(ClassicTableBase);
