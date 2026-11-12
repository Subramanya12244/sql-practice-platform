import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { SampleTable } from "./SampleTable";
import { PlanTree, parsePlan, type PlanNode } from "./PlanTree";
import { Markdown } from "./Markdown";
import { usePlayback } from "./visual/Playback";
import { SetOpView } from "./visual/SetOpView";
import { QueryCinema, useCinemaSteps } from "./visual/QueryCinema";
import { HighlightedSql } from "./visual/HighlightedSql";
import { MotionToggle } from "./visual/MotionToggle";
import { useReducedMotion } from "../lib/visual/motion";
import { traceRows, type RowTrace } from "../lib/visual/rowTrace";
import { runQuery } from "../lib/browserDb";
import { visualize, type Provenance, type Stage, type Visualization } from "../lib/visualize";
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
export function SourceBadge({ s }: { s: Source }) {
  const b = BADGE[s];
  return <span title={b.title} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${b.cls}`}>{b.label}</span>;
}

function clauseRange(v: Visualization, stage: Stage): [number, number] | undefined {
  if (stage.range) return stage.range;
  const key = stage.clause === "distinct" || stage.clause === "window" ? "select" : stage.clause === "limit" ? (v.parsed.ranges.limit ? "limit" : "offset") : stage.clause;
  return v.parsed.ranges[key as keyof typeof v.parsed.ranges];
}

export { HighlightedSql };

function StageView({ s }: { s: Stage }) {
  const hasIn = s.rowsIn !== undefined;
  const hasOut = s.rowsOut !== undefined;
  const inCount = s.rowsIn ?? 0;
  const outCount = s.rowsOut ?? 0;

  let transformIndicator = null;
  if (hasIn && hasOut && inCount > 0) {
    if (outCount < inCount) {
      const dropped = inCount - outCount;
      const dropPct = Math.round((dropped / inCount) * 100);
      const retainPct = 100 - dropPct;
      transformIndicator = (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs">
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            {dropPct}% filtered out
          </span>
          <span className="text-ink-muted">
            ({dropped.toLocaleString()} rows removed · {outCount.toLocaleString()} rows / {retainPct}% retained)
          </span>
        </div>
      );
    } else if (outCount > inCount) {
      const added = outCount - inCount;
      const mult = (outCount / inCount).toFixed(1);
      transformIndicator = (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/25 bg-accent-dim px-3 py-2 text-xs">
          <span className="font-semibold text-accent">
            +{added.toLocaleString()} rows added
          </span>
          <span className="text-ink-muted">
            ({mult}x row expansion from join fan-out / product)
          </span>
        </div>
      );
    } else {
      transformIndicator = (
        <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-soft px-3 py-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">100% rows retained</span>
          <span>(all {outCount.toLocaleString()} rows pass to next stage)</span>
        </div>
      );
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink">{s.explanation}</p>
      {(hasIn || hasOut) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {hasIn && <span className="rounded-lg bg-surface-soft px-2.5 py-1">in: <strong>{inCount.toLocaleString()}</strong> rows</span>}
            {hasOut && <span className="rounded-lg bg-accent-dim px-2.5 py-1 text-accent">out: <strong>{outCount.toLocaleString()}</strong> rows</span>}
          </div>
          {transformIndicator}
        </div>
      )}
      {s.joins?.map((j, i) => {
        const isLeftJoin = j.kind.toUpperCase().includes("LEFT");
        const isRightJoin = j.kind.toUpperCase().includes("RIGHT") || j.kind.toUpperCase().includes("FULL");
        const hasLeftUnmatched = Boolean(j.unmatchedLeft && j.unmatchedLeft > 0);
        const hasRightUnmatched = Boolean(j.unmatchedRight && j.unmatchedRight > 0);
        const hasFanOut = Boolean(j.leftRows && j.matchedPairs && j.matchedPairs > j.leftRows);

        return (
          <div key={i} className="rounded-card border border-surface-border p-3 text-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-ink">
                {j.kind} {j.right}
                {j.on ? <span className="font-normal text-ink-muted"> ON {j.on}</span> : null}
              </p>
              {j.matchedPairs !== undefined && (
                <span className="rounded-full bg-surface-soft px-2 py-0.5 text-xs font-mono text-ink">
                  {j.matchedPairs.toLocaleString()} matched pairs
                </span>
              )}
            </div>

            {j.leftRows !== undefined && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Left rows", j.leftRows],
                  ["Right rows", j.rightRows],
                  ["Matching pairs", j.matchedPairs],
                  ["Unmatched left", j.unmatchedLeft],
                  ["Unmatched right", j.unmatchedRight],
                ].map(([k, val]) => (
                  <div key={String(k)} className="rounded-lg bg-surface-soft p-2">
                    <p className="text-[11px] text-ink-faint">{k}</p>
                    <p className="font-mono text-ink">{typeof val === "number" ? val.toLocaleString() : (val ?? "—")}</p>
                  </div>
                ))}
              </div>
            )}

            {hasFanOut && (
              <p className="rounded-md border border-accent/20 bg-accent-dim/40 px-2.5 py-1.5 text-xs text-ink">
                <strong>Fan-out detected:</strong> Matching pairs ({j.matchedPairs?.toLocaleString()}) exceed left input rows ({j.leftRows?.toLocaleString()}). One or more left rows matched multiple right rows.
              </p>
            )}

            {hasLeftUnmatched && (
              <p className={`rounded-md border px-2.5 py-1.5 text-xs ${isLeftJoin ? "border-surface-border bg-surface-soft text-ink-muted" : "border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-200"}`}>
                <strong>Unmatched left rows:</strong> {j.unmatchedLeft?.toLocaleString()} rows had no matching key in {j.right}. {isLeftJoin ? "Preserved with NULL right columns because this is a LEFT JOIN." : "Dropped from the result set because this is an INNER JOIN."}
              </p>
            )}

            {hasRightUnmatched && (
              <p className={`rounded-md border px-2.5 py-1.5 text-xs ${isRightJoin ? "border-surface-border bg-surface-soft text-ink-muted" : "border-surface-border bg-surface-soft text-ink-muted"}`}>
                <strong>Unmatched right rows:</strong> {j.unmatchedRight?.toLocaleString()} rows in {j.right} had no matching left key. {isRightJoin ? "Preserved with NULL left columns." : "Dropped from the result set."}
              </p>
            )}

            {j.resultRows !== undefined && (
              <p className="text-xs text-ink-muted">
                Rows after this join: <strong className="text-ink">{j.resultRows.toLocaleString()}</strong>.
              </p>
            )}
            {j.unmatchedLeftSample && <div className="mt-2"><SampleTable caption="Unmatched left rows (sample)" columns={j.unmatchedLeftSample.columns} rows={j.unmatchedLeftSample.rows} /></div>}
            {j.unmatchedRightSample && <div className="mt-2"><SampleTable caption="Unmatched right rows (sample)" columns={j.unmatchedRightSample.columns} rows={j.unmatchedRightSample.rows} /></div>}
          </div>
        );
      })}
      {s.partitions && <SampleTable caption="Partitions (rows per window partition)" columns={s.partitions.columns} rows={s.partitions.rows} />}
      {s.sample && s.sample.columns.length > 0 && <SampleTable caption={`Rows at this stage (first ${s.sample.rows.length})`} columns={s.sample.columns} rows={s.sample.rows} />}
      {s.removed && <SampleTable caption="Removed at this stage (sample)" columns={s.removed.columns} rows={s.removed.rows} />}
      {s.sql && s.source === "executed" && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-faint">Query used for this stage (built from your clauses)</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-surface-soft p-2 font-mono text-ink-muted">{s.sql}</pre>
        </details>
      )}
      {s.error && <p role="alert" className="text-sm text-ink-muted">Rows for this stage couldn't be computed ({s.error}); the explanation above still applies.</p>}
    </div>
  );
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
export function VizView({ sql, dataset = "northwind", onDone, onClause }: {
  sql: string;
  dataset?: string;
  onDone?: (s: VizSummary) => void;
  /** Called with the character range of the clause being viewed (to highlight it in an editor). */
  onClause?: (range: [number, number] | null) => void;
}) {
  const [busy, setBusy] = useState(true);
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
  const body = sql.trim().replace(/;\s*$/, "");
  // The cinema's script is built once from the stages and the row trace; stepping only moves an index through it.
  const steps = useCinemaSteps(v, trace?.viz === v ? trace?.t : undefined, body);
  const pb = usePlayback(steps.length);
  const setStep = (i: number) => pb.dispatch({ type: "seek", index: i });
  const [tab, setTab] = useState<"logical" | "flow" | "rel" | "structure" | "plan">("logical");
  const run = (q: string) => runQuery(q, dataset);
  const [graphs, setGraphs] = useState<GraphResult | null>(null);
  useEffect(() => {
    let live = true;
    setGraphs(null);
    void buildGraphs(body).then((g) => live && setGraphs(g));
    return () => { live = false; };
  }, [body]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setAnalyzed(null);
    setStep(0);
    (async () => {
      const [viz, structure, ex] = await Promise.all([visualize(body, run), analyze(body), run(`EXPLAIN (FORMAT JSON) ${body}`)]);
      if (!alive) return;
      const node = ex.success ? parsePlan(ex.rows[0]?.[0]) : null;
      setV(viz);
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
      setBusy(false);
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
    const job = traceRows(body, run, v).then((t) => { if (live) setTrace({ viz: v, t }); }).catch(() => undefined);
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

  const stages = v?.stages ?? [];
  const cur = steps[Math.min(pb.index, Math.max(0, steps.length - 1))];
  const s = cur ? stages[cur.stageIndex] : undefined;
  useEffect(() => {
    if (v && s && tab === "logical") onClause?.(clauseRange(v, s) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb.index, v, tab]);

  if (busy && !v) return <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Analysing your query…</p>;
  if (!v || !st) return null;

  return (
    <div className="space-y-4">
      {v.volatile && (
        <p className="rounded-lg border border-warn/30 bg-warn-dim px-3 py-2 text-xs text-ink">
          Your query uses {v.volatile.join(", ")}, which return different values on each run. Intermediate rows aren't shown because re-running parts of the query wouldn't reproduce your result — the explanation and plan still apply.
        </p>
      )}
      <div role="tablist" className="flex flex-wrap gap-2 text-sm">
        {([["logical", "Logical steps"], ["flow", "Flow diagram"], ["rel", "Relationships"], ["structure", "Structure"], ["plan", "Execution plan"]] as const).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); if (t !== "logical") onClause?.(null); }}
            className={`rounded-lg px-3 py-1.5 ${tab === t ? "bg-accent text-white" : "border border-surface-border text-ink-muted"}`}>
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
                  <QueryDiagrams mode={tab} flow={graphs.flow} rel={graphs.rel} dataset={dataset} onSelect={(r) => { setPicked(r); onClause?.(r); }} />
                </Suspense>
                {tab === "flow" && picked && <HighlightedSql sql={body} range={picked} />}
              </div>
            )
      )}

      {tab === "logical" && (
        v.unsupported ? (
          <p className="text-sm text-ink-muted">{v.unsupported} The Structure tab shows how it's built.</p>
        ) : (
          <>
            <QueryCinema viz={v} trace={trace?.viz === v ? trace.t : undefined} sql={body} pb={pb} steps={steps} reduced={reduced} refining={!trace || trace.viz !== v}
              extra={(stage) => (stage.setOp ? <SetOpView data={stage.setOp} /> : null)} details={(stage) => <StageView s={stage} />} tools={<MotionToggle />} />
            {v.final && (
              <div>
                <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Final result ({v.final.rowCount} rows) <SourceBadge s="executed" /></p>
                <SampleTable columns={v.final.columns} rows={v.final.rows} />
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
            <ul className="space-y-1">{st.joins.map((j, i) => <li key={i}><span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-xs">{j.type}</span> <code>{j.table}</code>{j.on && <span className="text-ink-muted"> ON {j.on}</span>}</li>)}</ul>
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
