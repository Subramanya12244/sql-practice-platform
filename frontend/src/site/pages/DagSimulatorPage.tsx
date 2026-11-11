import { Suspense, lazy, useEffect, useState } from "react";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { Seo } from "../lib/seo";

const DagWorkspace = lazy(() => import("../components/lab/DagWorkspace"));

export function DagSimulatorPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Container wide>
      <Seo title="Pipeline Orchestration Simulator (Airflow concepts)" description="Learn DAGs, dependencies, schedules, retries and failures by simulating a data pipeline in your browser." path="/dag-simulator" />
      <PageHeader eyebrow="Data engineering lab" title="Pipeline orchestration simulator" intro="Build a DAG, set its schedule and retries, make tasks fail on purpose, then retry and read the logs. It uses Apache Airflow's vocabulary on a virtual clock, with nothing to install." />
      {!mounted ? <Skeleton className="h-[520px]" /> : <Suspense fallback={<Skeleton className="h-[520px]" />}><DagWorkspace /></Suspense>}
    </Container>
  );
}
