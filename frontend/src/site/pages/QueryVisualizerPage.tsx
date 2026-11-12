import { Suspense, lazy, useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Container, Skeleton } from "../components/ui";
import { VizView, type VizSummary } from "../components/VizView";
import { VisualHelp } from "../components/visual/VisualHelp";
import { QueryCompare } from "../components/visual/QueryCompare";
import { Seo, breadcrumbs } from "../lib/seo";
import { receive } from "../lib/handoff";

const CodeEditor = lazy(() => import("../components/CodeEditor"));

const PRESETS: { label: string; sql: string }[] = [
  {
    label: "JOIN + GROUP BY + HAVING",
    sql: "SELECT c.country, COUNT(*) AS orders\nFROM customers c\nJOIN orders o ON o.customer_id = c.customer_id\nWHERE o.freight > 10\nGROUP BY c.country\nHAVING COUNT(*) >= 3\nORDER BY orders DESC, c.country\nLIMIT 5;",
  },
  {
    label: "Customers with many large orders",
    sql: "SELECT c.customer_id, c.company_name, COUNT(o.order_id)\nFROM customers c\nJOIN orders o ON c.customer_id = o.customer_id\nWHERE o.freight > 50\nGROUP BY c.customer_id, c.company_name\nHAVING COUNT(o.order_id) > 2\nORDER BY COUNT(o.order_id) DESC;",
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
  { label: "CTE", sql: "WITH big AS (\n  SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id\n)\nSELECT c.company_name, big.n\nFROM customers c JOIN big ON big.customer_id = c.customer_id\nWHERE big.n > 10\nORDER BY big.n DESC;" },
  { label: "UNION (set operator)", sql: "SELECT country FROM customers\nUNION\nSELECT country FROM suppliers\nORDER BY country;" },
  { label: "INTERSECT", sql: "SELECT country FROM customers\nINTERSECT\nSELECT country FROM suppliers\nORDER BY country;" },
  { label: "EXCEPT", sql: "SELECT country FROM customers\nEXCEPT\nSELECT country FROM suppliers\nORDER BY country;" },
  { label: "UNION ALL with LIMIT", sql: "SELECT country FROM customers\nUNION ALL\nSELECT country FROM suppliers\nORDER BY country\nLIMIT 10;" },
  { label: "Nested set operations", sql: "(SELECT country FROM customers UNION SELECT country FROM suppliers)\nEXCEPT\nSELECT 'USA';" },
  { label: "CASE and NULL", sql: "SELECT customer_id,\n       CASE WHEN region IS NULL THEN 'no region' ELSE region END AS region_label\nFROM customers\nORDER BY customer_id;" },
  { label: "Subquery", sql: "SELECT product_name, unit_price\nFROM products\nWHERE unit_price > (SELECT AVG(unit_price) FROM products)\nORDER BY unit_price DESC;" },
];

const GHOST = ["FROM", "JOIN", "WHERE", "GROUP BY", "HAVING", "SELECT", "ORDER BY", "LIMIT"];

/** Where the cinema will play, before any query has run: the pipeline it is about to draw, not a line of text. */
function Stage() {
  return (
    <section aria-label="Query Cinema" data-testid="cinema-empty" className="cinema-dark rounded-2xl border border-surface-border bg-surface p-4 text-ink sm:p-6">
      <ol aria-hidden className="flex items-center gap-1 overflow-x-auto pb-2">
        {GHOST.map((g, i) => (
          <li key={g} className="flex shrink-0 items-center">
            <span className="rounded-lg border border-dashed border-surface-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint">{g}</span>
            {i < GHOST.length - 1 && <span className="mx-1 text-ink-faint">━▶</span>}
          </li>
        ))}
      </ol>
      <div className="mt-4 grid min-h-[220px] place-items-center rounded-xl border border-dashed border-surface-border text-center">
        <div className="max-w-md space-y-2 px-4 py-8">
          <p className="font-display text-lg font-bold text-ink">Your query will play here</p>
          <p className="text-sm text-ink-muted">Pick an example or write a query and press <strong className="text-ink">Visualize</strong>. You will see the real tables, the rows that match, the rows that are filtered out, the groups and the final result, one stage at a time.</p>
        </div>
      </div>
    </section>
  );
}

export function QueryVisualizerPage() {
  const [sql, setSql] = useState(PRESETS[0].sql);
  const [mounted, setMounted] = useState(false);
  const [ran, setRan] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "running" | "done"; text?: string }>({ kind: "idle" });

  const visualize = (q: string) => {
    if (q === ran) return; // the same query is already on screen: the player has its own Restart
    setRan(q);
    setStatus({ kind: "running" });
  };
  const done = (s: VizSummary) => setStatus({ kind: "done", text: `${s.stages.length} stage${s.stages.length === 1 ? "" : "s"} visualized${s.volatile?.length ? ` (row data skipped: ${s.volatile.join(", ")})` : ""}` });

  useEffect(() => {
    setMounted(true);
    const h = receive("visualizer");
    if (h?.a) {
      setSql(h.a);
      setRan(h.a);
      setStatus({ kind: "running" });
    }
  }, []);

  return (
    <Container wide>
      <Seo
        title="SQL Query Visualizer — See How a Query Runs Step by Step"
        description="Watch FROM, JOIN, WHERE, GROUP BY, HAVING, window functions, SELECT, ORDER BY and LIMIT run on real rows, with the parsed structure and PostgreSQL's plan."
        path="/query-visualizer"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Query visualizer", path: "/query-visualizer" }])]}
      />
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 pb-3 pt-6 sm:pt-8">
        <div className="min-w-0">
          <p className="mb-1 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent"><span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-accent to-secondary" aria-hidden />AI & Intelligence</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">SQL Query Cinema</h1>
        </div>
        <p className="max-w-2xl text-sm text-ink-muted">Press Visualize and watch the query run on real rows: tables are matched, rows are filtered out, groups form, the result is sorted. Runs in your browser on Northwind; every query is rolled back.</p>
      </header>

      <div role="group" aria-label="Example queries" className="mb-3 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => { setSql(p.sql); visualize(p.sql); }} className="shrink-0 rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">{p.label}</button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_230px]">
        <div className="min-w-0">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[128px]" />}>
              <CodeEditor value={sql} onChange={setSql} onRun={() => visualize(sql)} height={128} label="Query to visualize" />
            </Suspense>
          ) : <Skeleton className="h-[128px]" />}
        </div>
        <div className="flex flex-row items-center gap-3 lg:flex-col lg:items-stretch lg:justify-center">
          <button type="button" onClick={() => visualize(sql)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white">
            <Play className="h-4 w-4" aria-hidden /> Visualize
          </button>
          <p role="status" aria-live="polite" data-testid="viz-status" className="flex items-center gap-1.5 text-xs text-ink-muted">
            {status.kind === "running" && <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Running on Northwind…</>}
            {status.kind === "done" && <span className="text-success">✓ {status.text}. Counts are exact.</span>}
            {status.kind === "idle" && "Pick an example or write a query."}
          </p>
        </div>
      </div>

      {ran ? <VizView key={ran} sql={ran} onDone={done} /> : <Stage />}

      <VisualHelp id="sql" className="mt-4" />
      {mounted && <div className="mt-6"><QueryCompare initialA={PRESETS[0].sql} initialB={PRESETS[0].sql} /></div>}
    </Container>
  );
}
