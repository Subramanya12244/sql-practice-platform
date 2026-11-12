import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { Stage, Visualization } from "../../lib/visualize";
import { buildCinema, clauseRange, type CinemaStep } from "../../lib/visual/cinema";
import { keyAction } from "../../lib/visual/playback";
import type { RowTrace } from "../../lib/visual/rowTrace";
import { SampleTable } from "../SampleTable";
import { HighlightedSql } from "./HighlightedSql";
import { PlaybackBar, ProvenanceBadge, type usePlayback } from "./Playback";
import { RowFlow } from "./RowFlow";

/**
 * SQL Query Cinema: the animated pipeline is the page. From top to bottom: the pipeline rail (every stage, with the rows it
 * receives and passes on), the stage's title and exact counts, the query with this stage's clause marked, the canvas where the
 * real rows move, four short answers (what / why / which rows changed / if removed), and the playback controls.
 *
 * It only draws. The steps come from `buildCinema` (lib/visual/cinema.ts) once, so stepping, replaying and restarting never run
 * a query. Logical order only: PostgreSQL's physical plan is a different tab.
 */

const delta = (a?: number, b?: number) => (a === undefined || b === undefined || a === b ? null : b - a);
const fmt = (n?: number) => (n === undefined ? "–" : n.toLocaleString());

function Counts({ step }: { step: CinemaStep }) {
  const d = delta(step.rowsIn, step.rowsOut);
  if (step.rowsIn === undefined && step.rowsOut === undefined) return null;
  const unit = step.kind === "filter" && step.clause === "having" ? "groups" : step.kind === "group" ? "rows → groups" : "rows";
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm" data-testid="cinema-counts" aria-label={`Rows in ${fmt(step.rowsIn)}, rows out ${fmt(step.rowsOut)}`}>
      {step.rowsIn !== undefined && <><span className="text-2xl font-bold text-ink">{fmt(step.rowsIn)}</span><span className="text-ink-faint">in</span><span aria-hidden className="text-ink-faint">→</span></>}
      <span className="text-2xl font-bold text-accent">{fmt(step.rowsOut)}</span><span className="text-ink-faint">{step.rowsIn !== undefined ? "out" : unit}</span>
      {d !== null && <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${d < 0 ? "bg-danger-dim text-danger" : "bg-accent-dim text-accent"}`}>{d > 0 ? "+" : "−"}{Math.abs(d).toLocaleString()}</span>}
    </p>
  );
}

function Rail({ steps, index, onPick }: { steps: CinemaStep[]; index: number; onPick: (i: number) => void }) {
  return (
    <ol aria-label="Stages" data-testid="cinema-rail" className="flex items-stretch gap-0 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const state = i < index ? "done" : i === index ? "active" : "next";
        return (
          <li key={s.id} className="flex shrink-0 items-center">
            <button type="button" onClick={() => onPick(i)} aria-current={i === index ? "step" : undefined} data-state={state} data-step={s.id}
              className={`flex min-w-[88px] flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                state === "active" ? "border-accent bg-accent-dim shadow-glow" : state === "done" ? "border-surface-border bg-surface-soft text-ink-muted hover:text-ink" : "border-dashed border-surface-border text-ink-faint hover:text-ink"}`}>
              <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider">
                {state === "done" && <Check className="h-3 w-3 text-success" aria-hidden />}{s.label}
              </span>
              <span className="font-mono text-[11px]">
                {s.rowsIn !== undefined ? `${fmt(s.rowsIn)} → ${fmt(s.rowsOut)}` : s.rowsOut !== undefined ? `${fmt(s.rowsOut)} rows` : "·"}
              </span>
            </button>
            {i < steps.length - 1 && <span aria-hidden className={`mx-1 text-sm ${i < index ? "text-accent" : "text-ink-faint"}`}>━▶</span>}
          </li>
        );
      })}
    </ol>
  );
}

const Q = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="rounded-lg border border-surface-border bg-surface-soft/60 p-2.5">
    <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{title}</dt>
    <dd className="mt-1 text-xs leading-relaxed text-ink">{children}</dd>
  </div>
);

export function QueryCinema({ viz, trace, sql, pb, steps, reduced, refining, details, tools, extra }: {
  viz: Visualization;
  trace?: RowTrace;
  sql: string;
  pb: ReturnType<typeof usePlayback>;
  steps: CinemaStep[];
  reduced: boolean;
  refining: boolean;
  /** The existing per-stage tables and counts, kept as a collapsed detail under the story. */
  details?: (stage: Stage) => ReactNode;
  /** Controls that belong in the header (the motion setting). */
  tools?: ReactNode;
  /** Stage-specific extras shown under the answers (the set-operation view). */
  extra?: (stage: Stage) => ReactNode;
}) {
  void trace;
  const root = useRef<HTMLElement>(null);
  // When the cinema first appears, bring it to the top of the screen so the animation, not the form above it, is what is seen.
  useEffect(() => { root.current?.scrollIntoView?.({ block: "start", behavior: reduced ? "auto" : "smooth" }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const index = Math.min(pb.index, Math.max(0, steps.length - 1));
  const step = steps[index];
  const stage = step ? viz.stages[step.stageIndex] : undefined;
  const range = stage ? clauseRange(viz, stage) : undefined;
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (["SELECT", "TEXTAREA"].includes(t.tagName) || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") || (t.tagName === "BUTTON" && e.key === " ")) return;
    const a = keyAction(e.key);
    if (a) { e.preventDefault(); pb.dispatch(a); }
  };
  if (!step || !stage) return null;
  return (
    <section ref={root} aria-label="Query Cinema" data-testid="cinema" data-step={step.id} data-index={index} tabIndex={-1} onKeyDown={onKey}
      className="cinema-dark scroll-mt-20 space-y-3 rounded-2xl border border-surface-border bg-surface p-3 text-ink shadow-soft sm:p-4">
      <Rail steps={steps} index={index} onPick={(i) => pb.dispatch({ type: "seek", index: i })} />
      <p className="text-[11px] text-ink-faint">Logical order: how SQL defines the result, one clause at a time. PostgreSQL may run the query differently (see Execution plan); the result is the same.</p>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-display text-lg font-bold text-ink" data-testid="cinema-title">{step.title}</h3>
          <Counts step={step} />
        </div>
        <div className="flex items-center gap-2">{step.source && <ProvenanceBadge p={step.source} />}{tools}</div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(250px,320px)_minmax(0,1fr)]">
        <div className="min-w-0 xl:order-2">
          {step.frame?.board && !step.tableOnly ? (
            <RowFlow key={step.id} stage={stage} prev={viz.stages[step.stageIndex - 1]} reduced={reduced} frame={step.frame} stageIndex={index} speed={pb.speed} refining={refining} sql={sql} expr={step.expr} />
          ) : (
            <div className="space-y-2 rounded-xl border border-surface-border bg-surface-raised p-3" data-testid="cinema-table-only">
              <p aria-live="polite" className="text-sm text-ink">{step.note ?? step.summary}</p>
              {refining && <p className="text-xs text-ink-faint">Looking up the rows for this stage…</p>}
              {stage.sample && stage.sample.columns.length > 0 && <SampleTable caption={`Rows at this stage (first ${stage.sample.rows.length}; the count above is exact)`} columns={stage.sample.columns} rows={stage.sample.rows} />}
            </div>
          )}
        </div>
        <aside className="min-w-0 space-y-3 xl:order-1" aria-label="This stage in words">
          <HighlightedSql sql={sql} range={range} clause={step.clause} className="max-h-40 overflow-auto" />
          <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1" data-testid="cinema-insights">
            <Q title="What SQL does here">{step.text.does}</Q>
            <Q title="Why this stage">{step.text.why}</Q>
            <Q title="Which rows changed">{step.text.changed}</Q>
            <Q title="If this clause were removed">{step.text.ifRemoved}</Q>
          </dl>
        </aside>
      </div>

      <div className="sticky bottom-2 z-10 space-y-1 rounded-xl bg-surface/90 p-1 backdrop-blur" data-testid="cinema-controls">
        <PlaybackBar pb={pb} labels={steps.map((x) => x.title)} />
        <p className="hidden px-1 text-[11px] text-ink-faint sm:block">Keys: Space play or pause · ← → step · Home restart · End last stage. Pause on any stage to look at its rows.</p>
      </div>

      {extra?.(stage)}

      <details className="rounded-lg border border-surface-border text-xs">
        <summary className="cursor-pointer px-3 py-2 text-ink-muted hover:text-ink">The SQL for this step, and its exact tables and counts</summary>
        <div className="space-y-3 border-t border-surface-border p-3">
          {step.fragment && <div><p className="mb-1 text-ink-faint">The part of your query this step runs</p><pre className="overflow-x-auto rounded bg-surface-soft p-2 font-mono text-ink">{step.fragment}</pre></div>}
          {stage.sql && stage.source === "executed" && <div><p className="mb-1 text-ink-faint">Query used to measure this stage (built from your clauses)</p><pre className="overflow-x-auto rounded bg-surface-soft p-2 font-mono text-ink-muted">{stage.sql}</pre></div>}
          {details?.(stage)}
        </div>
      </details>

    </section>
  );
}

/** The cinema's steps for a visualization, rebuilt only when the stages or the row trace change. */
export function useCinemaSteps(viz: Visualization | null, trace: RowTrace | undefined, sql: string): CinemaStep[] {
  return useMemo(() => (viz && !viz.unsupported ? buildCinema(viz, trace, sql) : []), [viz, trace, sql]);
}
