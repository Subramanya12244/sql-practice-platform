import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePage } from "../SiteApp";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { erDiagramSource } from "../lib/data";

// Mermaid is ~1 MB, so the diagram renders only in the browser, on demand.
const ErDiagram = lazy(() => import("../../components/ErDiagram").then((m) => ({ default: m.ErDiagram })));

export function SchemaPage() {
  const { data } = usePage();
  const schema = data.schema ?? [];
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const relationships = schema.flatMap((t) =>
    t.columns.filter((c) => c.fk).map((c) => ({ from: t.name, column: c.name, to: c.fk!.table, toColumn: c.fk!.column })),
  );

  return (
    <Container>
      <Seo
        title="Northwind Database Schema & ER Diagram (PostgreSQL)"
        description="The Northwind sample database explained: all 8 tables, columns, data types, primary keys and foreign keys, with an entity-relationship diagram for SQL practice."
        path="/schema"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Schema", path: "/schema" }])]}
      />
      <PageHeader
        eyebrow="Reference"
        title="Northwind database schema"
        intro="Every practice question runs on these 8 tables. Orders link customers, employees and shippers; order_details links orders to products, which belong to categories and suppliers."
      />

      <section aria-labelledby="er" className="rounded-card border border-surface-border bg-[#151b23] p-4">
        <h2 id="er" className="sr-only">Entity-relationship diagram</h2>
        {mounted ? (
          <Suspense fallback={<Skeleton className="h-[480px]" />}>
            <ErDiagram source={erDiagramSource(schema)} />
          </Suspense>
        ) : (
          <Skeleton className="h-[480px]" />
        )}
      </section>

      <h2 className="mt-12 font-display text-xl font-bold text-ink">Relationships</h2>
      <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
        {relationships.map((r) => (
          <li key={`${r.from}.${r.column}`} className="font-mono text-ink-muted">
            <span className="text-ink">{r.from}.{r.column}</span> → {r.to}.{r.toColumn}
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-display text-xl font-bold text-ink">Tables</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {schema.map((t) => (
          <section key={t.name} id={t.name} className="overflow-hidden rounded-card border border-surface-border bg-surface-raised shadow-panel">
            <h3 className="border-b border-surface-border px-4 py-2.5 font-mono font-semibold text-ink">{t.name}</h3>
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr><th>Column</th><th>Type</th><th>Key</th></tr>
              </thead>
              <tbody>
                {t.columns.map((c) => (
                  <tr key={c.name} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-1.5 font-mono text-ink">{c.name}</td>
                    <td className="px-2 py-1.5 font-mono text-xs text-ink-faint">{c.type}{c.notNull ? " not null" : ""}</td>
                    <td className="px-4 py-1.5 text-right text-xs">
                      {c.pk && <span className="font-semibold text-warn">PK</span>}
                      {c.fk && (
                        <a href={`#${c.fk.table}`} className="ml-2 text-accent hover:underline">FK → {c.fk.table}</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <p className="mt-8 text-sm text-ink-muted">
        Ready to query it? <Link to="/questions" className="font-medium text-accent hover:underline">Pick a practice question</Link>.
      </p>
    </Container>
  );
}
