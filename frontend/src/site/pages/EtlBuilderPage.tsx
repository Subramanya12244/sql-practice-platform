import { Suspense, lazy, useEffect, useState } from "react";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { Seo } from "../lib/seo";

const EtlWorkspace = lazy(() => import("../components/lab/EtlWorkspace"));

export function EtlBuilderPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Container wide>
      <Seo title="ETL Pipeline Builder" description="Build a Source, Extract, Transform, Validate, Load pipeline on sample data in your browser. No servers, no setup." path="/etl-builder" />
      <PageHeader eyebrow="Data engineering lab" title="ETL pipeline builder" intro="Wire a source to transformations, validation and a destination, then run it on sample data and read the log. Everything runs in your browser; nothing is uploaded." />
      {!mounted ? <Skeleton className="h-[520px]" /> : <Suspense fallback={<Skeleton className="h-[520px]" />}><EtlWorkspace /></Suspense>}
    </Container>
  );
}
