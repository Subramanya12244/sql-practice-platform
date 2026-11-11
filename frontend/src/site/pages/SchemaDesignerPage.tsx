import { Suspense, lazy, useEffect, useState } from "react";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { Seo } from "../lib/seo";

const SchemaDesignWorkspace = lazy(() => import("../components/lab/SchemaDesignWorkspace"));

export function SchemaDesignerPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Container wide>
      <Seo title="Database Design Playground: Keys, Relationships, Normalization" description="Design tables, keys and relationships, create them in PostgreSQL in your browser, and practise 1NF, 2NF and 3NF." path="/schema-designer" />
      <PageHeader eyebrow="Data engineering lab" title="Database design playground" intro="Create tables with keys and constraints, see the ER diagram and the SQL, create them in a real PostgreSQL in your browser, and practise normalization and relationships with exercises checked by exact algorithms." />
      {!mounted ? <Skeleton className="h-[520px]" /> : <Suspense fallback={<Skeleton className="h-[520px]" />}><SchemaDesignWorkspace /></Suspense>}
    </Container>
  );
}
