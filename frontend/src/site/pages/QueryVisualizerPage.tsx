import { Suspense, lazy, useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { VizView } from "../components/VizView";
import { Seo, breadcrumbs } from "../lib/seo";
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

export function QueryVisualizerPage() {
  const [sql, setSql] = useState(PRESETS[0].sql);
  const [mounted, setMounted] = useState(false);
  const [ran, setRan] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const h = receive("visualizer");
    if (h?.a) {
      setSql(h.a);
      setRan(h.a);
    }
  }, []);

  return (
    <Container wide>
      <Seo
        title="SQL Query Visualizer — See How a Query Runs Step by Step"
        description="Step through FROM, JOIN, WHERE, GROUP BY, HAVING, window functions, SELECT, ORDER BY and LIMIT with real intermediate rows, the parsed structure and PostgreSQL's plan."
        path="/query-visualizer"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Query visualizer", path: "/query-visualizer" }])]}
      />
      <PageHeader
        eyebrow="AI & Intelligence"
        title="Query execution visualizer"
        intro="Step through SQL's logical processing order with real intermediate rows, see the query's parsed structure (CTEs, joins, set operations) and PostgreSQL's actual plan. Every block says where its information comes from. Every practice question has this built in too."
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setSql(p.sql)} className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">{p.label}</button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-3">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[260px]" />}>
              <CodeEditor value={sql} onChange={setSql} onRun={() => setRan(sql)} height={260} label="Query to visualize" />
            </Suspense>
          ) : <Skeleton className="h-[260px]" />}
          <button type="button" onClick={() => setRan(sql)} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
            <Play className="h-4 w-4" aria-hidden /> Visualize
          </button>
          <p className="text-xs text-ink-faint">Runs in your browser on Northwind; every query is rolled back. Stages show up to 20 sample rows; counts are exact.</p>
        </div>
        <div className="min-w-0 rounded-card border border-surface-border bg-surface-raised p-4">
          {ran ? <VizView key={ran} sql={ran} /> : <p className="text-sm text-ink-muted">Pick an example or write a query, then press Visualize.</p>}
        </div>
      </div>
    </Container>
  );
}
