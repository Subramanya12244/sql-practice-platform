/**
 * The query text with the active clause marked. OWNER: Agent 4.
 *
 * The active clause is a <mark> (so a screen reader and a copy-paste both know where it is). The box has its own scroll: when the
 * clause is out of view the box scrolls to it, the page never does. Multi-line queries keep their line breaks and indentation.
 * `data-step-index` and `data-range="start,end"` expose the step this text was drawn for, so a test can compare it with the board,
 * the progress bar and the tables. Colours come from the site tokens through classic-motion.css (light and dark).
 */
import { memo, useEffect, useRef } from "react";
import type { ClassicStep } from "../../../lib/visual/classic/contract";
import { useReducedMotion } from "../../../lib/visual/motion";

export interface ClassicSqlProps {
  sql: string;
  range?: [number, number];
  clause?: string;
  /** Step number this text is drawn for, for `data-step-index` (or pass `step` and let it be read from there). */
  stepIndex?: number;
  /** The shared step: supplies `range`, `clause` and `stepIndex` when those are not given. */
  step?: Pick<ClassicStep, "index" | "range"> & { stage?: { clause: string } };
}

export const ClassicSql = memo(function ClassicSql({ sql, range: rangeProp, clause: clauseProp, stepIndex, step }: ClassicSqlProps) {
  const reduced = useReducedMotion();
  const boxRef = useRef<HTMLPreElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const raw = rangeProp ?? step?.range;
  const clause = clauseProp ?? step?.stage?.clause;
  const index = stepIndex ?? step?.index;
  // Offsets come from the clause finder; keep them inside the text so a stale range can never throw or mark the wrong place.
  const start = raw ? Math.max(0, Math.min(raw[0], sql.length)) : -1;
  const end = raw ? Math.max(start, Math.min(raw[1], sql.length)) : -1;
  const marked = raw !== undefined && end > start;

  useEffect(() => {
    const box = boxRef.current, mark = markRef.current;
    if (!box || !mark) return;
    // Scroll inside the box only. offsetTop/offsetLeft are relative to the box (it is the offset parent), read once per step.
    const top = mark.offsetTop, left = mark.offsetLeft;
    const wantTop = top < box.scrollTop || top + mark.offsetHeight > box.scrollTop + box.clientHeight ? Math.max(0, top - box.clientHeight / 3) : box.scrollTop;
    const wantLeft = left < box.scrollLeft || left > box.scrollLeft + box.clientWidth - 48 ? Math.max(0, left - 24) : box.scrollLeft;
    if (wantTop === box.scrollTop && wantLeft === box.scrollLeft) return;
    if (typeof box.scrollTo === "function") box.scrollTo({ top: wantTop, left: wantLeft, behavior: reduced ? "auto" : "smooth" });
    else { box.scrollTop = wantTop; box.scrollLeft = wantLeft; }
  }, [start, end, sql, reduced]);

  return (
    <pre
      ref={boxRef} tabIndex={0} role="group" aria-label={marked && clause ? `Query, active clause ${clause.toUpperCase()}` : "Query"}
      data-testid="classic-sql" data-step-index={index} data-range={marked ? `${start},${end}` : undefined}
      className={`cx-sql rounded-lg bg-surface-soft p-3 font-mono text-xs ${marked ? "text-ink-muted" : "text-ink"}`}
    >
      {marked ? (
        <>
          {sql.slice(0, start)}
          {/* keyed by the range so a new clause fades in once; an unchanged step keeps the same node and does not replay */}
          <mark key={`${start},${end}`} ref={markRef} className="cx-mark" data-clause={clause ?? ""}>{sql.slice(start, end)}</mark>
          {sql.slice(end)}
        </>
      ) : sql}
    </pre>
  );
});
