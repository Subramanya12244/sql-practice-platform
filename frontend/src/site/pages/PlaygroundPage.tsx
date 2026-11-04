import { Suspense, lazy, useEffect, useState } from "react";
import { usePage } from "../SiteApp";
import { SchemaPanel } from "../components/SchemaPanel";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { saveDraft } from "../lib/progress";
import type { Question } from "../types";

const PracticePanel = lazy(() => import("../components/PracticePanel"));

/** Stand-in "question" so the practice panel can run free-form SQL. Drafts are stored under number 0. */
const PLAYGROUND: Question = {
  number: 0, slug: "playground", title: "Playground", topic: "", topicLabel: "", difficulty: "", concepts: [],
  hadMistakes: false, watchOutFor: "", takeaway: "", category: "", outcome: "", problem: "", objective: "",
  tables: [], expectedOutput: "", approach: "", mySolution: "", myMistakes: [], solution: "", referenceQuery: "",
  sortRequired: false, why: "", pitfalls: [], followups: [], related: [],
};

const EXAMPLES: { label: string; sql: string }[] = [
  { label: "Top customers by revenue", sql: "SELECT c.company_name,\n       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue\nFROM customers c\nJOIN orders o ON o.customer_id = c.customer_id\nJOIN order_details od ON od.order_id = o.order_id\nGROUP BY c.company_name\nORDER BY revenue DESC\nLIMIT 10;" },
  { label: "Monthly orders", sql: "SELECT DATE_TRUNC('month', order_date)::date AS month, COUNT(*) AS orders\nFROM orders\nGROUP BY month\nORDER BY month;" },
  { label: "Rank products in category", sql: "SELECT c.category_name, p.product_name, p.unit_price,\n       DENSE_RANK() OVER (PARTITION BY c.category_id ORDER BY p.unit_price DESC) AS price_rank\nFROM products p\nJOIN categories c ON c.category_id = p.category_id\nORDER BY c.category_name, price_rank;" },
  { label: "Org chart", sql: "SELECT e.first_name || ' ' || e.last_name AS employee,\n       m.first_name || ' ' || m.last_name AS manager\nFROM employees e\nLEFT JOIN employees m ON m.employee_id = e.reports_to\nORDER BY manager NULLS FIRST, employee;" },
  { label: "Late shipments", sql: "SELECT order_id, required_date, shipped_date,\n       shipped_date - required_date AS days_late\nFROM orders\nWHERE shipped_date > required_date\nORDER BY days_late DESC;" },
];

export function PlaygroundPage() {
  const { data } = usePage();
  const [mounted, setMounted] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => setMounted(true), []);

  const load = (sql: string) => {
    saveDraft(0, sql);
    setVersion((v) => v + 1);
  };

  return (
    <Container>
      <Seo
        title="Online PostgreSQL Playground with the Northwind Database"
        description="Run any SQL query on the Northwind sample database in your browser — a free online PostgreSQL playground with schema reference and example queries. No install, no sign-up."
        path="/playground"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Playground", path: "/playground" }])]}
      />
      <PageHeader
        eyebrow="Playground"
        title="Online SQL playground"
        intro="Write any query against Northwind. Nothing is graded and nothing you run changes the data — every query is rolled back."
      />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Example queries">
        {EXAMPLES.map((ex) => (
          <button key={ex.label} type="button" onClick={() => load(ex.sql)}
            className="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-sm text-ink-muted hover:border-accent/40 hover:text-ink">
            {ex.label}
          </button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="order-2 lg:order-1">{data.schema && <SchemaPanel schema={data.schema} />}</div>
        <div className="order-1 min-w-0 lg:order-2">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel key={version} question={PLAYGROUND} playground />
            </Suspense>
          ) : (
            <Skeleton className="h-[580px]" />
          )}
        </div>
      </div>
    </Container>
  );
}
