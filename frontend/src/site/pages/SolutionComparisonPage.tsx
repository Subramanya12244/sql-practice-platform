import { Suspense, lazy, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Scale, XCircle } from "lucide-react";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { SampleTable } from "../components/SampleTable";
import { PlanTree } from "../components/PlanTree";
import { Seo, breadcrumbs } from "../lib/seo";
import { runQuery } from "../lib/browserDb";
import { compareSolutions, type Comparison, type SolutionReport } from "../lib/compareSolutions";
import { receive } from "../lib/handoff";

const CodeEditor = lazy(() => import("../components/CodeEditor"));

const PRESETS = [
  {
    label: "NOT EXISTS vs LEFT JOIN … IS NULL",
    a: "SELECT c.customer_id, c.company_name\nFROM customers c\nWHERE NOT EXISTS (\n  SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id\n);",
    b: "SELECT c.customer_id, c.company_name\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nWHERE o.order_id IS NULL;",
  },
  {
    label: "Correlated subquery vs window function",
    a: "SELECT p.product_name, p.category_id, p.unit_price\nFROM products p\nWHERE p.unit_price = (\n  SELECT MAX(p2.unit_price) FROM products p2 WHERE p2.category_id = p.category_id\n);",
    b: "SELECT product_name, category_id, unit_price\nFROM (\n  SELECT p.*, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS r\n  FROM products p\n) t\nWHERE r = 1;",
  },
  {
    label: "CTE vs subquery",
    a: "WITH rev AS (\n  SELECT o.customer_id, SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue\n  FROM orders o JOIN order_details od ON od.order_id = o.order_id\n  GROUP BY o.customer_id\n)\nSELECT customer_id, revenue FROM rev\nWHERE revenue > (SELECT AVG(revenue) FROM rev);",
    b: "SELECT customer_id, revenue\nFROM (\n  SELECT o.customer_id, SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue\n  FROM orders o JOIN order_details od ON od.order_id = o.order_id\n  GROUP BY o.customer_id\n) r\nWHERE revenue > (\n  SELECT AVG(s) FROM (\n    SELECT SUM(od.unit_price * od.quantity * (1 - od.discount)) AS s\n    FROM orders o JOIN order_details od ON od.order_id = o.order_id\n    GROUP BY o.customer_id\n  ) x\n);",
  },
  {
    label: "UNION vs UNION ALL",
    a: "SELECT country FROM customers\nUNION\nSELECT country FROM suppliers;",
    b: "SELECT country FROM customers\nUNION ALL\nSELECT country FROM suppliers;",
  },
];

function ReportCard({ name, r }: { name: string; r: SolutionReport }) {
  return (
    <div className="min-w-0 space-y-3 rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
      <p className="font-display text-lg font-bold text-ink">{name}</p>
      {!r.ok ? (
        <p role="alert" className="text-danger">{r.error}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">{r.approaches.map((a) => <span key={a} className="rounded-full bg-accent-dim px-2 py-0.5 text-xs font-medium text-accent">{a}</span>)}</div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["Rows", r.rowCount],
              ["Median time", r.medianMs !== undefined ? `${r.medianMs.toFixed(1)} ms` : "—"],
              ["Plan cost", r.planCost?.toFixed(1) ?? "—"],
              ["Joins", r.complexity.joins],
              ["Subqueries", r.complexity.subqueries],
              ["Nesting / lines", `${r.complexity.nesting} / ${r.complexity.lines}`],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg bg-surface-soft p-2"><dt className="text-[11px] text-ink-faint">{k}</dt><dd className="font-mono text-ink">{v}</dd></div>
            ))}
          </dl>
          <p className="text-xs text-ink-faint">Timed runs: {r.runsMs.join(", ")} ms</p>
          {r.notes.length > 0 && (
            <ul className="space-y-1">
              {r.notes.map((n, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-ink-muted">
                  {n.level === "warn" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />}
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          <SampleTable caption="Result (first 20 rows)" columns={r.columns} rows={r.rows} />
          {r.plan && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-ink-muted">Execution plan</summary>
              <div className="mt-2"><PlanTree plan={r.plan} /></div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function SolutionComparisonPage() {
  const [a, setA] = useState(PRESETS[0].a);
  const [b, setB] = useState(PRESETS[0].b);
  const [labels, setLabels] = useState(["Query A", "Query B"]);
  const [ordered, setOrdered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Comparison | null>(null);

  useEffect(() => {
    setMounted(true);
    const h = receive("compare");
    if (h?.a && h.b) {
      setA(h.a);
      setB(h.b);
      setLabels([h.labelA ?? "Query A", h.labelB ?? "Query B"]);
    }
  }, []);

  async function go() {
    setBusy(true);
    try {
      setRes(await compareSolutions(a, b, runQuery, { ordered }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container wide>
      <Seo
        title="Compare SQL Solutions — Results, Plans and Timing Side by Side"
        description="Compare two SQL queries on the same data: result equivalence, row differences, execution plans, timing and the trade-offs of JOIN, subquery, CTE, EXISTS and window approaches."
        path="/solution-comparison"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Solution comparison", path: "/solution-comparison" }])]}
      />
      <PageHeader
        eyebrow="Advanced practice"
        title="Compare two solutions"
        intro="Check whether two queries return the same rows, then look at how they differ. There is rarely one universally best query; the trade-offs depend on data size, indexes and readability."
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => { setA(p.a); setB(p.b); setLabels(["Query A", "Query B"]); setRes(null); }}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">{p.label}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[{ v: a, set: setA, label: labels[0] }, { v: b, set: setB, label: labels[1] }].map((e) => (
          <div key={e.label} className="min-w-0">
            <p className="mb-1 text-sm font-semibold text-ink">{e.label}</p>
            {mounted ? (
              <Suspense fallback={<Skeleton className="h-[240px]" />}>
                <CodeEditor value={e.v} onChange={e.set} onRun={go} height={240} label={e.label} />
              </Suspense>
            ) : <Skeleton className="h-[240px]" />}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button type="button" onClick={go} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Scale className="h-4 w-4" aria-hidden />} Compare
        </button>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} /> Row order must match
        </label>
      </div>

      {res && (
        <div className="mt-6 space-y-4">
          <div className={`flex items-start gap-2 rounded-card border p-4 text-sm ${res.equivalent ? "border-success/30 bg-success-dim" : "border-danger/30 bg-danger-dim"}`} role="status">
            {res.equivalent ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />}
            <div>
              <p className="font-semibold text-ink">{res.equivalent ? "Same result" : "Different results"}</p>
              <p className="text-ink-muted">{res.message}</p>
              {res.diff && (res.diff.missingCount > 0 || res.diff.extraCount > 0) && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {res.diff.extraCount > 0 && <SampleTable caption={`Only in ${labels[0]} (${res.diff.extraCount})`} columns={res.a.columns} rows={res.diff.extra} />}
                  {res.diff.missingCount > 0 && <SampleTable caption={`Only in ${labels[1]} (${res.diff.missingCount})`} columns={res.b.columns} rows={res.diff.missing} />}
                </div>
              )}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ReportCard name={labels[0]} r={res.a} />
            <ReportCard name={labels[1]} r={res.b} />
          </div>
          <div className="rounded-card border border-surface-border bg-surface-raised p-4 text-xs text-ink-muted">
            <p className="font-semibold text-ink">Measurement conditions</p>
            <p className="mt-1">
              {res.environment.version} (PGlite, in this browser tab) · each query: 1 warm-up + {res.environment.runs} timed runs, median shown.
              Timings on a dataset this small are dominated by overhead and vary between runs; plan cost is the planner's estimate, not a measurement.
            </p>
            <ul className="mt-2 space-y-0.5">
              {res.environment.tables.map((t) => <li key={t.name}><code>{t.name}</code>: {t.rows} rows · indexes: {t.indexes.join(", ") || "none"}</li>)}
            </ul>
          </div>
        </div>
      )}
    </Container>
  );
}
