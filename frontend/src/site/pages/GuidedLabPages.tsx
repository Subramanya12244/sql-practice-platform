import { Container, PageHeader } from "../components/ui";
import { GuidedWorkspace } from "../components/lab/GuidedWorkspace";
import { DQ_EXERCISES } from "../lib/lab/dqContent";
import { DE_SCENARIOS } from "../lib/lab/deContent";
import { Seo } from "../lib/seo";

export function DqExercisesPage() {
  return (
    <Container wide>
      <Seo title="Data Quality Exercises: Completeness, Accuracy, Consistency, Uniqueness, Validity" description="Guided exercises that clean deliberately messy data with SQL and Python, with a before and after quality score." path="/dq-exercises" />
      <PageHeader eyebrow="Data engineering lab" title="Data quality exercises" intro="Messy customers and orders, five quality dimensions. Find the problems, fix them with SQL or Python, and watch the quality score move. Every exercise is checked by running your answer." />
      <GuidedWorkspace items={DQ_EXERCISES} storageKey="sqlp.guided.dq" groupBy="dimension" />
    </Container>
  );
}

export function DeScenariosPage() {
  return (
    <Container wide>
      <Seo title="Data Engineering Scenario Challenges: Batch ETL, Incremental Loads, Idempotency" description="Practical pipeline scenarios: upserts, late-arriving data, duplicates, validation, retries and reconciliation, checked in your browser." path="/de-scenarios" />
      <PageHeader eyebrow="Data engineering lab" title="Data engineering scenarios" intro="Real pipeline problems with a business context, requirements, input data and evaluation criteria. Your answer runs against a real PostgreSQL (or Python) in your browser and is checked automatically." />
      <GuidedWorkspace items={DE_SCENARIOS} storageKey="sqlp.guided.de" groupBy="level" />
    </Container>
  );
}
