/**
 * The original SQL query visualizer, as it was before the SQL Query Cinema (commit 9be309e) replaced it: stage buttons, the shared
 * playback bar, rows moving between stages, and the structure, relationships and execution-plan tabs. Recovered unchanged from
 * `9be309e^` (docs/SQL_PRACTICE_ORIGINAL_VISUALIZER_RESTORATION.md); only its imports now point at the matching original copies of
 * its helpers (`visual/RowFlowClassic.tsx`, `lib/visual/classic/rowFlow.ts` and `rowTrace.ts`), because the shared ones were
 * rewritten for the Cinema. The SQL Practice question page uses this; the Cinema (`VizView`) is used elsewhere.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PlanTree, parsePlan, type PlanNode } from "./PlanTree";
import { Markdown } from "./Markdown";
import { usePlayback } from "./visual/Playback";
import { SetOpView } from "./visual/SetOpView";
import { RowFlow } from "./visual/RowFlowClassic";
import { MotionToggle } from "./visual/MotionToggle";
import { ClassicSql } from "./visual/classic/ClassicSql";
import { ClassicPlayer } from "./visual/classic/ClassicPlayer";
import { ClassicStepBar } from "./visual/classic/ClassicStepBar";
import { clauseRange, useClassicStep } from "./visual/classic/useClassicStep";
import { ClassicStepRail } from "./visual/classic/ClassicStepRail";
import { ClassicExplain } from "./visual/classic/ClassicExplain";
import { ClassicTables } from "./visual/classic/ClassicTables";
import { ClassicTable } from "./visual/classic/ClassicTable";
import { teachSteps } from "../lib/visual/classic/teach";
import { useReducedMotion } from "../lib/visual/motion";
import { traceRows, type RowTrace } from "../lib/visual/classic/rowTrace";
import { runQuery } from "../lib/browserDb";
import { visualize, type Provenance, type Visualization } from "../lib/visualize";
import { analyze, cteFlow, type Structure } from "../lib/sqlAst";
import { buildGraphs, type GraphResult } from "../lib/queryGraph";
const QueryDiagrams = lazy(() => import("./QueryDiagram"));

type Source = Provenance | "plan" | "estimated";
const BADGE: Record<Source, { label: string; title: string; cls: string }> = {
  executed: { label: "Executed", title: "Real rows from running a valid query built only from your own clauses. Shows what this logical stage produces, not how PostgreSQL physically ran your query.", cls: "bg-success-dim text-success" },
  parsed: { label: "Parsed", title: "Derived from the query text only; nothing was run for this.", cls: "bg-accent-dim text-accent" },
  plan: { label: "Plan · EXPLAIN", title: "PostgreSQL's chosen execution plan for your query.", cls: "bg-warn-dim text-warn" },
  estimated: { label: "Estimated", title: "Row counts and costs are the planner's estimates, not measurements.", cls: "bg-surface-soft text-ink-muted" },
};
function SourceBadge({ s }: { s: Source }) {
  const b = BADGE[s];
  return <span title={b.title} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${b.cls}`}>{b.label}</span>;
}

export interface VizSummary {
  structure: string;
  stages: string[];
  planCost?: number;
  planRoot?: string;
  volatile?: string[];
}

/**
 * The full visualization for one query: logical stages, parsed structure, and the real plan.
 * Every block is labelled with where its information comes from.
 */
export function VizViewClassic({ sql, dataset = "northwind", onDone, onClause }: {
  sql: string;
  dataset?: string;
  onDone?: (s: VizSummary) => void;
  /** Called with the character range of the clause being viewed (to highlight it in an editor). */
  onClause?: (range: [number, number] | null) => void;
}) {
  // The key (query + dataset) the visualization in `v` was built for: while it differs from the current one the stages on screen are stale, so the host says it is visualizing.
  const [vKey, setVKey] = useState<string | null>(null);
  // Only the Flow diagram tab keeps its own selection (a box the learner clicked); it also seeks the playback, so the Logical steps tab agrees.
  const [picked, setPicked] = useState<[number, number] | null>(null);
  const [v, setV] = useState<Visualization | null>(null);
  const [st, setSt] = useState<Structure | null>(null);
  const [plan, setPlan] = useState<{ node: PlanNode | null; error?: string } | null>(null);
  const [analyzed, setAnalyzed] = useState<{ node: PlanNode | null; error?: string; ms?: number } | null>(null);
  const [counts, setCounts] = useState<{ ctes: Record<string, number | string>; branches: (number | string)[] }>({ ctes: {}, branches: [] });
  const reduced = useReducedMotion();
  // Row-level data for the stage animations: fetched after the stages, never blocks them, and never runs the learner's query.
  const [trace, setTrace] = useState<{ viz: Visualization; t: RowTrace } | null>(null);
  const tracing = useRef<Promise<unknown>>(Promise.resolve());
  // Set when the row trace failed for this visualization: the board stops saying it is looking up row ids.
  const [traceFailed, setTraceFailed] = useState<Visualization | null>(null);
  const pb = usePlayback(v?.stages.length ?? 0);
  const { dispatch } = pb;
  const setStep = useCallback((i: number) => dispatch({ type: "seek", index: i }), [dispatch]);
  const traceT = trace && trace.viz === v ? trace.t : undefined;
  // The one execution state: the SQL highlight, the row board, the tables, the explanation and the progress all render from it.
  const cur = useClassicStep(v, traceT, pb);
  const [tab, setTab] = useState<"logical" | "flow" | "rel" | "structure" | "plan">("logical");
  // Each runQuery is one BEGIN..ROLLBACK on one connection, so two overlapping calls can poison each other (one failing query makes the
  // other report "current transaction is aborted"). Every query this host issues (stages, EXPLAIN, CTE counts, row trace) goes through
  // this queue and runs alone, in the order it was asked for.
  const rootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback((q: string) => {
    const job = queue.current.then(() => runQuery(q, dataset));
    queue.current = job.catch(() => undefined);
    return job;
  }, [dataset]);
  const body = sql.trim().replace(/;\s*$/, "");
  const [graphs, setGraphs] = useState<GraphResult | null>(null);
  useEffect(() => {
    let live = true;
    setGraphs(null);
    void buildGraphs(body).then((g) => live && setGraphs(g));
    return () => { live = false; };
  }, [body]);

  useEffect(() => {
    let alive = true;
    setAnalyzed(null);
    setStep(0);
    (async () => {
      const [viz, structure, ex] = await Promise.all([visualize(body, run), analyze(body), run(`EXPLAIN (FORMAT JSON) ${body}`)]);
      if (!alive) return;
      const node = ex.success ? parsePlan(ex.rows[0]?.[0]) : null;
      setV(viz);
      setVKey(`${dataset}\n${body}`);
      setSt(structure);
      setPlan(ex.success ? { node } : { node: null, error: ex.message ?? "EXPLAIN failed" });
      // Each CTE and each set-operation branch is itself a complete query, so running it is safe.
      const c: typeof counts = { ctes: {}, branches: [] };
      if (!structure.volatile.length) {
        const withPrefix = viz.parsed.with;
        for (const cte of structure.ctes) {
          const r = withPrefix ? await run(`${withPrefix}\nSELECT COUNT(*) FROM ${cte.name}`) : null;
          c.ctes[cte.name] = r?.success ? Number(r.rows[0]?.[0]) : "—";
        }
        if (structure.branches.length > 1 && !structure.ctes.length) {
          for (const b of structure.branches) {
            const r = await run(`SELECT COUNT(*) FROM (${b.sql}) AS _branch`);
            c.branches.push(r.success ? Number(r.rows[0]?.[0]) : "—");
          }
        }
      }
      if (!alive) return;
      setCounts(c);
      if (viz.unsupported) setTab("structure");
      onDone?.({
        structure: [structure.statement, structure.joins.length ? `${structure.joins.length} join(s)` : "", structure.ctes.length ? `${structure.ctes.length} CTE(s)` : "", structure.subqueries ? `${structure.subqueries} subquery(ies)` : "", structure.windows ? `${structure.windows} window fn` : ""].filter(Boolean).join(" · "),
        stages: viz.stages.map((s) => s.clause),
        planCost: node?.["Total Cost"],
        planRoot: node?.["Node Type"],
        volatile: viz.volatile,
      });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, dataset]);

  useEffect(() => {
    if (!v || v.unsupported) return;
    let live = true;
    setTrace(null);
    setTraceFailed(null);
    const job = traceRows(body, run, v).then((t) => { if (live) setTrace({ viz: v, t }); }).catch(() => { if (live) setTraceFailed(v); });
    tracing.current = job;
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  async function runAnalyze() {
    // EXPLAIN ANALYZE really runs the query; never overlap it with the row-trace queries.
    await tracing.current;
    if (!confirm("EXPLAIN ANALYZE actually runs your query once (8s limit, rolled back). Continue?")) return;
    const started = performance.now();
    const r = await run(`EXPLAIN (ANALYZE, FORMAT JSON) ${body}`);
    setAnalyzed(r.success ? { node: parsePlan(r.rows[0]?.[0]), ms: Math.round(performance.now() - started) } : { node: null, error: r.message ?? "failed" });
  }

  const stages = useMemo(() => v?.stages ?? [], [v]);
  const cards = useMemo(() => (v && !v.unsupported ? teachSteps(v, traceT) : []), [v, traceT]);
  const railTitles = useMemo(() => stages.map((x) => x.title), [stages]);
  // The learner's own SQL error (visualize() ends with the stage "Your query has an error"): open on it and say it first.
  const errStage = useMemo(() => stages.findIndex((x) => x.title === "Your query has an error"), [stages]);
  const railLabels = useMemo(() => cards.map((c, i) => (i === errStage ? "ERROR" : c.label)), [cards, errStage]);
  const seekedErr = useRef<Visualization | null>(null);
  useEffect(() => {
    if (!v || errStage < 0 || pb.count !== stages.length || seekedErr.current === v) return;
    seekedErr.current = v;
    setStep(errStage);
  }, [v, errStage, stages.length, pb.count, setStep]);
  // A step change (playback or rail) always wins over a stale diagram selection.
  useEffect(() => { setPicked(null); }, [cur?.index]);
  const rangeStart = cur?.range?.[0];
  const rangeEnd = cur?.range?.[1];
  useEffect(() => {
    if (cur && tab === "logical") onClause?.(rangeStart === undefined || rangeEnd === undefined ? null : [rangeStart, rangeEnd]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.index, rangeStart, rangeEnd, v, tab]);
  /** A box clicked in the Flow diagram: show its clause and move the playback to the step that works on it. */
  const pickClause = useCallback((r: [number, number] | null) => {
    onClause?.(r);
    const at = r && v ? v.stages.findIndex((x) => { const c = clauseRange(v, x); return c && c[0] <= r[0] && r[1] <= c[1]; }) : -1;
    // A box that belongs to a step moves the playback there (the highlight then follows the step); only a box no step works on keeps its own range.
    if (at >= 0) { setPicked(null); setStep(at); } else setPicked(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, setStep]);

  // Loading and empty are different states: loading while this query's stages are being built, empty when they were built and there are none.
  if (!v || !st || vKey !== `${dataset}\n${body}`) return <p role="status" data-testid="classic-loading" className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Visualizing…</p>;

  const s = cur?.stage;
  const card = cur?.teach;
  const failed = errStage >= 0 ? v.stages[errStage] : undefined;
  const step = cur?.index ?? 0;

  return (
    <div ref={rootRef} className="vizc space-y-3" data-testid="classic-viz" data-step-index={step} data-step-count={cur?.count ?? 0}>
      {v.volatile && (
        <p className="rounded-lg border border-warn/30 bg-warn-dim px-3 py-2 text-xs text-ink">
          Your query uses {v.volatile.join(", ")}, which return different values on each run. Intermediate rows aren't shown because re-running parts of the query wouldn't reproduce your result — the explanation and plan still apply.
        </p>
      )}
      {failed && (
        <div role="alert" data-testid="classic-query-error" className="rounded-lg border border-danger/40 bg-danger-dim px-3 py-2 text-sm text-ink">
          <p className="font-semibold text-danger">Your query has an error</p>
          <p className="mt-0.5 break-words font-mono text-xs">{failed.error ?? failed.explanation}</p>
          <p className="mt-1 text-xs text-ink-muted">PostgreSQL rejected the query, so the steps before it can only be explained, not run. Fix the error in the editor and visualize again.</p>
        </div>
      )}
      <div role="tablist" className="vizc-tabs flex flex-wrap gap-1 text-xs">
        {([["logical", "Logical steps"], ["flow", "Flow diagram"], ["rel", "Relationships"], ["structure", "Structure"], ["plan", "Execution plan"]] as const).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setPicked(null); if (t !== "logical") { dispatch({ type: "pause" }); onClause?.(null); } }}
            className={`whitespace-nowrap rounded-lg px-2 py-1 font-medium ${tab === t ? "bg-accent text-white" : "border border-surface-border text-ink-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      {(tab === "flow" || tab === "rel") && (
        !graphs ? <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Parsing…</p>
          : !graphs.ok ? <p role="status" className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-ink-muted">{graphs.reason}</p>
            : (
              <div className="space-y-2">
                <p className="text-xs text-ink-faint">{tab === "flow" ? `${graphs.statement}. ${graphs.notes[0]} Click a box to highlight its clause.` : "Tables this query reads, with each join's type and columns. PK/FK markers come from the database catalog; dashed lines are foreign keys the query doesn't join on."}</p>
                <Suspense fallback={<p className="text-sm text-ink-muted">Loading diagram…</p>}>
                  <QueryDiagrams mode={tab} flow={graphs.flow} rel={graphs.rel} dataset={dataset} onSelect={pickClause} />
                </Suspense>
                {tab === "flow" && picked && <div className="vizc-sql"><ClassicSql sql={body} range={picked} /></div>}
              </div>
            )
      )}

      {tab === "logical" && (
        v.unsupported ? (
          <p className="text-sm text-ink-muted">{v.unsupported} The Structure tab shows how it's built.</p>
        ) : !cur ? (
          <p role="status" data-testid="classic-no-steps" className="rounded-lg border border-dashed border-surface-border px-3 py-2 text-sm text-ink-muted">This query has no steps to show, so there is nothing to play. The Structure and Execution plan tabs still describe it.</p>
        ) : (
          <>
            <div className="vizc-head flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 flex-1 basis-24 text-xs text-ink-faint" title="SQL's logical processing order: the order a query's clauses are defined to apply. PostgreSQL may physically execute it differently (see Execution plan); the result is the same.">
                <strong className="font-semibold text-ink-muted">Logical order</strong><span className="vizc-head-note">: the order SQL defines each clause to apply. PostgreSQL may run it differently (see Execution plan).</span>
              </p>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {s && (s.title === "Your query has an error" ? <span className="rounded-full bg-danger-dim px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger">Error</span> : <SourceBadge s={card?.provenance ?? s.source ?? "parsed"} />)}
                <button type="button" data-testid="classic-reset" onClick={() => dispatch({ type: "restart" })} title="Go back to the first step" className="rounded-md border border-surface-border px-2 py-0.5 text-xs font-medium text-ink-muted hover:text-ink">Reset</button>
                <MotionToggle />
              </div>
            </div>
            <ClassicStepBar pb={pb} label={railLabels[step]} watch={playerRef} root={rootRef} />
            <div className="vizc-sql"><ClassicSql sql={body} step={cur} /></div>
            <ClassicStepRail labels={railLabels} titles={railTitles} index={step} onSeek={setStep} />
            <div ref={playerRef} className="vizc-player"><ClassicPlayer pb={pb} count={cur.count} labels={railTitles} keyRoot={rootRef} /></div>
            {s && card && (
              <div className="vizc-stage" data-step-index={step}>
                <div className="vizc-board min-w-0">
                  <RowFlow stage={s} prev={stages[step - 1]} reduced={reduced} frame={cur?.frame} stageIndex={step} speed={pb.speed} refining={!traceT && traceFailed !== v} />
                  {!traceT && traceFailed === v && <p role="status" className="mt-1 text-xs text-ink-muted">Row ids could not be looked up for this query, so the board draws the rows of the step itself. The tables and counts are still real.</p>}
                  {s.setOp && <div className="mt-3"><SetOpView data={s.setOp} /></div>}
                </div>
                <ClassicExplain card={card} index={step} />
                <ClassicTables stage={s} card={card} index={step} />
              </div>
            )}
            {v.final && (
              <div className="vizc-final">
                <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Final result ({v.final.rowCount} rows) <SourceBadge s="executed" /></p>
                <ClassicTable bare table={{ columns: v.final.columns, rows: v.final.rows, role: "other" }} />
              </div>
            )}
          </>
        )
      )}

      {tab === "structure" && (
        <div className="space-y-4 text-sm">
          <p className="flex flex-wrap items-center gap-2 text-ink">
            <strong>{st.statement}</strong> <SourceBadge s="parsed" />
            <span className="text-xs text-ink-faint">{st.source === "ast" ? "from a PostgreSQL syntax tree" : `from clause analysis (the full parser couldn't read this query${st.parseError ? `: ${st.parseError}` : ""})`}</span>
          </p>
          {st.tables.length > 0 && <p className="text-ink-muted">Tables: {st.tables.map((t) => <code key={t.name + (t.alias ?? "")} className="mr-2 text-ink">{t.name}{t.alias ? ` ${t.alias}` : ""}</code>)}</p>}
          {st.joins.length > 0 && (
            <ul className="space-y-1">{st.joins.map((j, i) => <li key={i}><span className="rounded bg-accent-dim px-1.5 py-0.5 font-mono text-xs">{j.type}</span> <code>{j.table}</code>{j.on && <span className="text-ink-muted"> ON {j.on}</span>}</li>)}</ul>
          )}
          {st.ctes.length > 0 && (
            <div>
              <p className="font-semibold text-ink">CTEs and data flow</p>
              <ul className="mt-1 space-y-1">
                {st.ctes.map((c) => (
                  <li key={c.name}>
                    <code className="text-ink">{c.name}</code>{c.recursive && <span className="ml-1 text-xs text-warn">recursive</span>}
                    {c.dependsOn.length > 0 && <span className="text-ink-muted"> ← reads {c.dependsOn.join(", ")}</span>}
                    {counts.ctes[c.name] !== undefined && <span className="ml-2 text-xs text-ink-muted">{counts.ctes[c.name]} rows <SourceBadge s="executed" /></span>}
                  </li>
                ))}
              </ul>
              <Markdown source={"```mermaid\n" + cteFlow(st) + "\n```"} className="mt-2" />
            </div>
          )}
          {st.branches.length > 1 && (
            <div>
              <p className="font-semibold text-ink">Set operation branches</p>
              <ol className="mt-1 space-y-2">
                {st.branches.map((b, i) => (
                  <li key={i}>
                    {b.op && <p className="my-1 text-center font-mono text-xs font-bold text-accent">{b.op}</p>}
                    <pre className="overflow-x-auto rounded bg-surface-soft p-2 font-mono text-xs text-ink">{b.sql}</pre>
                    {counts.branches[i] !== undefined && <p className="mt-0.5 text-xs text-ink-muted">{counts.branches[i]} rows <SourceBadge s="executed" /></p>}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-ink-muted">UNION removes duplicates across branches; UNION ALL keeps them; INTERSECT keeps rows in both; EXCEPT keeps rows of the left branch missing from the right.</p>
              {v.final && <p className="mt-1 text-xs text-ink-muted">Combined result: <strong className="text-ink">{v.final.rowCount}</strong> rows <SourceBadge s="executed" /></p>}
            </div>
          )}
          {st.subqueries > 0 && <p className="text-ink-muted">{st.subqueries} nested subquer{st.subqueries === 1 ? "y" : "ies"} — PostgreSQL may inline or pre-compute them; see the plan.</p>}
          {st.windows > 0 && <p className="text-ink-muted">{st.windows} window function call(s): computed per row after WHERE/GROUP BY/HAVING, before ORDER BY.</p>}
        </div>
      )}

      {tab === "plan" && (
        <div className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 text-ink-muted"><SourceBadge s="plan" /> <SourceBadge s="estimated" /> How PostgreSQL chose to run your query on this data. Costs and row counts are estimates. <Link to="/notes/query-optimization" className="text-accent underline">Reading plans</Link></p>
          {plan?.node ? <PlanTree plan={plan.node} /> : <p className="text-danger">{plan?.error}</p>}
          <button type="button" onClick={runAnalyze} className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink">Run EXPLAIN ANALYZE (actual timings)</button>
          {analyzed && (
            <div>
              <p className="mb-1 text-xs text-ink-faint">Actual run {analyzed.ms !== undefined && `· ${analyzed.ms} ms in this browser`} <SourceBadge s="executed" /></p>
              {analyzed.node ? <PlanTree plan={analyzed.node} /> : <p className="text-danger">{analyzed.error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
