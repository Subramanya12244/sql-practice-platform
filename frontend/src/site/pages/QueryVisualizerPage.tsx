import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, Play } from "lucide-react";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { SampleTable } from "../components/SampleTable";
import { PlanTree, parsePlan, type PlanNode } from "../components/PlanTree";
import { Seo, breadcrumbs } from "../lib/seo";
import { runQuery } from "../lib/browserDb";
import { visualize, type Stage, type Visualization } from "../lib/visualize";
import { receive } from "../lib/handoff";

const CodeEditor = lazy(() => import("../components/CodeEditor"));

const PRESETS: { label: string; sql: string }[] = [
  {
    label: "JOIN + GROUP BY + HAVING",
    sql: "SELECT c.country, COUNT(*) AS orders\nFROM customers c\nJOIN orders o ON o.customer_id = c.customer_id\nWHERE o.freight > 10\nGROUP BY c.country\nHAVING COUNT(*) >= 3\nORDER BY orders DESC, c.country\nLIMIT 5;",
  },
  {
    label: "LEFT JOIN (unmatched rows)",
    sql: "SELECT c.customer_id, c.company_name, o.order_id\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nWHERE o.order_id IS NULL;",
  },
  {
    label: "Window function ranking",
    sql: "SELECT category_id, product_name, unit_price,\n       RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS price_rank\nFROM products\nORDER BY category_id, price_rank;",
  },
  { label: "DISTINCT", sql: "SELECT DISTINCT country\nFROM customers\nORDER BY country;" },
];

const CLAUSE_COLOR: Record<string, string> = {
  from: "bg-sky-500/15", where: "bg-amber-500/20", "group by": "bg-emerald-500/15", having: "bg-rose-500/15",
  window: "bg-violet-500/15", select: "bg-indigo-500/15", distinct: "bg-indigo-500/15", "order by": "bg-teal-500/15", limit: "bg-slate-500/15",
};

/** The query with the current stage's clause highlighted. */
function HighlightedSql({ sql, v, stage }: { sql: string; v: Visualization; stage: Stage }) {
  const key = stage.clause === "distinct" || stage.clause === "window" ? "select" : stage.clause === "limit" ? (v.parsed.ranges.limit ? "limit" : "offset") : stage.clause;
  const r = v.parsed.ranges[key as keyof typeof v.parsed.ranges];
  if (!r) return <pre className="overflow-x-auto rounded-lg bg-surface-soft p-3 font-mono text-xs text-ink">{sql}</pre>;
  return (
    <pre className="overflow-x-auto rounded-lg bg-surface-soft p-3 font-mono text-xs text-ink-muted">
      {sql.slice(0, r[0])}
      <mark className={`rounded px-0.5 text-ink ${CLAUSE_COLOR[stage.clause] ?? "bg-accent-dim"}`}>{sql.slice(r[0], r[1])}</mark>
      {sql.slice(r[1])}
    </pre>
  );
}

function StageView({ s }: { s: Stage }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink">{s.explanation}</p>
      {(s.rowsIn !== undefined || s.rowsOut !== undefined) && (
        <p className="flex flex-wrap gap-3 text-sm">
          {s.rowsIn !== undefined && <span className="rounded-lg bg-surface-soft px-2 py-1">in: <strong>{s.rowsIn}</strong></span>}
          {s.rowsOut !== undefined && <span className="rounded-lg bg-accent-dim px-2 py-1 text-accent">out: <strong>{s.rowsOut}</strong></span>}
        </p>
      )}
      {s.joins?.map((j, i) => (
        <div key={i} className="rounded-card border border-surface-border p-3 text-sm">
          <p className="font-semibold text-ink">{j.kind} {j.right}{j.on ? <span className="font-normal text-ink-muted"> ON {j.on}</span> : null}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[["Left rows", j.leftRows], ["Right rows", j.rightRows], ["Matching pairs", j.matchedPairs], ["Unmatched left", j.unmatchedLeft], ["Unmatched right", j.unmatchedRight]].map(([k, val]) => (
              <div key={String(k)} className="rounded-lg bg-surface-soft p-2"><p className="text-[11px] text-ink-faint">{k}</p><p className="font-mono text-ink">{val ?? "—"}</p></div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">Result after this join: <strong className="text-ink">{j.resultRows ?? "—"}</strong> rows.</p>
          {j.unmatchedLeftSample && <div className="mt-2"><SampleTable caption="Unmatched left rows (sample)" columns={j.unmatchedLeftSample.columns} rows={j.unmatchedLeftSample.rows} /></div>}
          {j.unmatchedRightSample && <div className="mt-2"><SampleTable caption="Unmatched right rows (sample)" columns={j.unmatchedRightSample.columns} rows={j.unmatchedRightSample.rows} /></div>}
        </div>
      ))}
      {s.partitions && <SampleTable caption="Partitions (rows per window partition)" columns={s.partitions.columns} rows={s.partitions.rows} />}
      {s.sample && s.sample.columns.length > 0 && <SampleTable caption={`Rows at this stage (first ${s.sample.rows.length})`} columns={s.sample.columns} rows={s.sample.rows} />}
      {s.removed && <SampleTable caption="Removed at this stage (sample)" columns={s.removed.columns} rows={s.removed.rows} />}
      {s.sql && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-faint">Derived query for this stage</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-surface-soft p-2 font-mono text-ink-muted">{s.sql}</pre>
        </details>
      )}
      {s.error && <p role="alert" className="text-sm text-danger">This stage couldn't be computed: {s.error}</p>}
    </div>
  );
}

export function QueryVisualizerPage() {
  const [sql, setSql] = useState(PRESETS[0].sql);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<Visualization | null>(null);
  const [ran, setRan] = useState("");
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"logical" | "physical">("logical");
  const [plan, setPlan] = useState<{ node: PlanNode | null; error?: string } | null>(null);

  useEffect(() => {
    setMounted(true);
    const h = receive("visualizer");
    if (h?.a) setSql(h.a);
  }, []);

  async function go() {
    setBusy(true);
    setPlan(null);
    try {
      const res = await visualize(sql, runQuery);
      setV(res);
      setRan(sql.replace(/;\s*$/, ""));
      setStep(0);
      const ex = await runQuery(`EXPLAIN (FORMAT JSON) ${sql.trim().replace(/;\s*$/, "")}`);
      setPlan(ex.success ? { node: parsePlan(ex.rows[0]?.[0]) } : { node: null, error: ex.message ?? "EXPLAIN failed" });
    } finally {
      setBusy(false);
    }
  }

  const stages = v?.stages ?? [];
  const s = stages[step];

  return (
    <Container wide>
      <Seo
        title="SQL Query Visualizer — See How a Query Runs Step by Step"
        description="Step through FROM, JOIN, WHERE, GROUP BY, HAVING, window functions, SELECT, ORDER BY and LIMIT with real intermediate rows from PostgreSQL."
        path="/query-visualizer"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Query visualizer", path: "/query-visualizer" }])]}
      />
      <PageHeader
        eyebrow="Visual learning"
        title="Query execution visualizer"
        intro="Step through SQL's logical processing order with real intermediate rows. The physical plan PostgreSQL actually runs is on the second tab — the two are different things."
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setSql(p.sql)} className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">{p.label}</button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-3">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[220px]" />}>
              <CodeEditor value={sql} onChange={setSql} onRun={go} label="Query to visualize" />
            </Suspense>
          ) : <Skeleton className="h-[220px]" />}
          <button type="button" onClick={go} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Visualize
          </button>
          <p className="text-xs text-ink-faint">Runs in your browser on Northwind; every query is rolled back. Stages show up to 20 sample rows; counts are exact.</p>
          {v && s && <HighlightedSql sql={ran} v={v} stage={s} />}
          {v?.final && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Final result ({v.final.rowCount} rows)</p>
              <SampleTable columns={v.final.columns} rows={v.final.rows} />
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-card border border-surface-border bg-surface-raised p-4">
          {!v ? (
            <p className="text-sm text-ink-muted">Pick an example or write a SELECT, then press Visualize.</p>
          ) : v.unsupported ? (
            <p role="alert" className="text-sm text-danger">{v.unsupported}</p>
          ) : (
            <>
              <div role="tablist" className="mb-4 flex gap-2 text-sm">
                {(["logical", "physical"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`rounded-lg px-3 py-1.5 ${tab === t ? "bg-accent text-white" : "border border-surface-border text-ink-muted"}`}>
                    {t === "logical" ? "Logical order" : "Physical plan (EXPLAIN)"}
                  </button>
                ))}
              </div>
              {tab === "logical" ? (
                <>
                  <ol className="mb-4 flex flex-wrap gap-1.5" aria-label="Stages">
                    {stages.map((st, i) => (
                      <li key={i}>
                        <button type="button" onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${i === step ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>
                          {i + 1}. {st.clause.toUpperCase()}
                        </button>
                      </li>
                    ))}
                  </ol>
                  {s && (
                    <>
                      <h2 className="font-display text-lg font-bold text-ink">{s.title}</h2>
                      <div className="mt-2"><StageView s={s} /></div>
                      <div className="mt-4 flex justify-between">
                        <button type="button" disabled={step === 0} onClick={() => setStep((x) => x - 1)} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-sm disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /> Back</button>
                        <button type="button" disabled={step >= stages.length - 1} onClick={() => setStep((x) => x + 1)} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-sm disabled:opacity-40">Next <ChevronRight className="h-4 w-4" aria-hidden /></button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="text-sm">
                  <p className="mb-3 text-ink-muted">
                    This is how PostgreSQL's planner chose to execute the query on this data. It may scan, join and filter in a different order than the logical stages — the result is the same.
                    <Link to="/notes/query-optimization" className="ml-1 text-accent underline">Reading plans →</Link>
                  </p>
                  {plan?.node ? <PlanTree plan={plan.node} /> : <p className="text-danger">{plan?.error ?? "No plan"}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Container>
  );
}
