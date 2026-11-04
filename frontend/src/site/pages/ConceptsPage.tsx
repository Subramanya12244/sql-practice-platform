import { Link } from "react-router-dom";
import { usePage } from "../SiteApp";
import { Container, PageHeader } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";

export function ConceptsPage() {
  const { data } = usePage();
  const guides = data.guides ?? [];
  return (
    <Container>
      <Seo
        title="SQL Concepts Explained — Joins, GROUP BY, CTEs, Subqueries"
        description="Clear SQL concept guides with PostgreSQL examples: every join type, GROUP BY vs HAVING, CTEs, correlated subqueries, UNION vs UNION ALL, NULL handling and more."
        path="/concepts"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Concepts", path: "/concepts" }])]}
      />
      <PageHeader
        eyebrow="Learn"
        title="SQL concept guides"
        intro="Short, example-driven explanations of the patterns interviewers test. Each guide links to practice questions."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {guides.map((g) => (
          <Link
            key={g.slug}
            to={`/concepts/${g.slug}`}
            className="group rounded-card border border-surface-border bg-surface-raised p-5 shadow-panel hover:border-accent/40"
          >
            <h2 className="font-semibold text-ink group-hover:text-accent">{g.title}</h2>
            <p className="mt-1.5 text-sm text-ink-muted">{g.description}</p>
          </Link>
        ))}
      </div>
    </Container>
  );
}
