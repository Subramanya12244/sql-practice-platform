import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, CheckCircle2 } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { Container, Difficulty, PageHeader, Skeleton } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { registerDataset } from "../lib/browserDb";
import { AFTER_SOLVE } from "../lib/scenarios";
import { VizView } from "../components/VizView";
import { addSession } from "../lib/vizHistory";
import type { Question } from "../types";
import type { SubmitResult } from "../../types";

const PracticePanel = lazy(() => import("../components/PracticePanel"));
const key = (slug: string) => `scenario:${slug}`;

export function ScenariosPage() {
  const { data } = usePage();
  const progress = useProgress();
  const all = data.scenarios ?? [];
  const sets = data.datasets ?? [];
  const done = all.filter((s) => progress.lessons?.[key(s.slug)]).length;
  return (
    <Container>
      <Seo
        title="Real-World SQL Business Scenarios — Practice Like the Job"
        description="SQL practice framed as business requests: declining customers, revenue growth, duplicate payments, reconciliation, retention and more, on six realistic databases."
        path="/scenarios"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Scenarios", path: "/scenarios" }])]}
      />
      <PageHeader
        eyebrow="Business scenarios"
        title="Real-world SQL scenarios"
        intro={`Requirements, not hints: read the business request, decide the approach, write the SQL. Any query that produces the right result passes. You've completed ${done} of ${all.length}.`}
      />
      {sets.map((d) => {
        const group = all.filter((s) => s.dataset === d.id);
        if (!group.length) return null;
        return (
          <section key={d.id} className="mb-8" aria-labelledby={`ds-${d.id}`}>
            <h2 id={`ds-${d.id}`} className="font-display text-xl font-bold text-ink">{d.title}</h2>
            <p className="text-sm text-ink-muted">{d.description} <Link to={`/playground?db=${d.id}`} className="text-accent hover:underline">Explore it →</Link></p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((s) => (
                <li key={s.slug}>
                  <Link to={`/scenarios/${s.slug}`} className="flex h-full flex-col rounded-card border border-surface-border bg-surface-raised p-4 hover:border-accent/40">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{s.title}</span>
                      {progress.lessons?.[key(s.slug)] ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Completed" /> : <Difficulty level={s.difficulty} />}
                    </span>
                    <span className="mt-1 text-sm text-ink-muted">{s.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Container>
  );
}

export function ScenarioPage() {
  const { data } = usePage();
  const s = data.scenario!;
  const progress = useProgress();
  const ds = data.datasets?.find((d) => d.id === s.dataset);
  const [ready, setReady] = useState(false);
  const [justSolved, setJustSolved] = useState(false);
  const [lastSql, setLastSql] = useState("");
  const [vizSql, setVizSql] = useState<string | null>(null);
  const completed = Boolean(progress.lessons?.[key(s.slug)]) || justSolved;
  const path = `/scenarios/${s.slug}`;

  useEffect(() => {
    if (s.dataset !== "northwind") registerDataset({ id: s.dataset, url: `/data/datasets/${s.dataset}.sql` });
    setReady(true);
    setJustSolved(false);
  }, [s.slug, s.dataset]);

  const question = {
    number: 0, slug: key(s.slug), title: s.title, tables: [],
    referenceQuery: s.solution, sortRequired: Boolean(s.orderBy), orderBy: s.orderBy,
    starter: `-- ${s.title}\n-- Database: ${ds?.title ?? s.dataset}. Read the success criteria for the exact output columns.\n\n`,
  } as unknown as Question;

  const before = s.sections.filter((x) => !AFTER_SOLVE.has(x.heading));
  const after = s.sections.filter((x) => AFTER_SOLVE.has(x.heading));
  const noteLinks = s.notes.map((n) => data.notes?.find((x) => x.slug === n)).filter((x) => x !== undefined);

  return (
    <Container wide className="pt-6">
      <Seo
        title={`${s.title} — SQL Business Scenario`}
        description={s.description}
        path={path}
        type="article"
        jsonLd={[
          breadcrumbs([{ name: "Home", path: "/" }, { name: "Scenarios", path: "/scenarios" }, { name: s.title, path }]),
          { "@context": "https://schema.org", "@type": "LearningResource", name: s.title, description: s.description, url: canonical(path), learningResourceType: "Practice problem", educationalLevel: s.difficulty },
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint"><Link to="/scenarios" className="hover:text-ink">Scenarios</Link> / {ds?.title ?? s.dataset}</nav>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{s.title}</h1>
        <Difficulty level={s.difficulty} />
        {completed && <span className="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> Completed</span>}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <article className="min-w-0 space-y-5">
          {before.map((sec) => (
            <section key={sec.heading}>
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                {sec.heading === "Business context" && <Briefcase className="h-3.5 w-3.5" aria-hidden />} {sec.heading}
              </h2>
              <Markdown source={sec.body} className="mt-1 text-sm" />
            </section>
          ))}
          {ds && <p className="text-sm"><Link to={`/playground?db=${ds.id}`} className="text-accent hover:underline">Explore the {ds.title} schema in the playground →</Link></p>}

          {completed ? (
            <div className="space-y-5 rounded-card border border-success/30 bg-success-dim/40 p-4">
              {after.map((sec) => (
                <section key={sec.heading}>
                  <h2 className="font-display text-lg font-bold text-ink">{sec.heading}</h2>
                  <Markdown source={sec.body} className="mt-1 text-sm" />
                </section>
              ))}
              <section>
                <h2 className="font-display text-lg font-bold text-ink">Other valid solutions</h2>
                <p className="text-sm text-ink-muted">Each returns exactly the same rows as the reference.</p>
                {[s.solution, ...s.alternatives].map((sql, i) => (
                  <div key={i} className="mt-2">
                    <p className="text-xs font-semibold text-ink-faint">{i === 0 ? "Reference" : `Alternative ${i}`}</p>
                    <Markdown source={"```sql\n" + sql + "\n```"} />
                  </div>
                ))}
              </section>
            </div>
          ) : (
            <details className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
              <summary className="cursor-pointer font-medium text-ink">Stuck? Show the reference solution</summary>
              <p className="mt-2 text-xs text-ink-muted">The explanation, alternatives and follow-up questions unlock once your query passes.</p>
              <Markdown source={"```sql\n" + s.solution + "\n```"} className="mt-2" />
            </details>
          )}
          {noteLinks.length > 0 && (
            <p className="text-sm text-ink-muted">Related notes: {noteLinks.map((n, i) => <span key={n.slug}><Link to={`/notes/${n.slug}`} className="text-accent hover:underline">{n.title}</Link>{i < noteLinks.length - 1 ? ", " : ""}</span>)}</p>
          )}
        </article>

        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          {ready ? (
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel key={s.slug} question={question} lessonKey={key(s.slug)} fresh dataset={s.dataset} datasetLabel={ds?.title ?? s.dataset}
                onRan={(sql) => setLastSql(sql)}
                onSolved={(r: SubmitResult, sql: string) => { setLastSql(sql); if (r.correct) setJustSolved(true); }} />
            </Suspense>
          ) : <Skeleton className="h-[580px]" />}
          {lastSql && (
            <div className="mt-3 rounded-card border border-surface-border bg-surface-raised p-3">
              <button type="button" onClick={() => setVizSql(lastSql)} className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink">Visualize my query</button>
              {vizSql && <div className="mt-3"><VizView key={vizSql} sql={vizSql} dataset={s.dataset} onDone={(sum) => addSession(`s:${s.slug}`, { sql: vizSql, attempt: 0, dataset: s.dataset, ...sum })} /></div>}
            </div>
          )}
          <p className="mt-2 text-xs text-ink-faint">Graded by comparing your result with the requirement, not by matching SQL text{s.orderBy ? "; row order is checked" : "; row order doesn't matter"}.</p>
        </div>
      </div>
    </Container>
  );
}
