import { Link } from "react-router-dom";
import { BookOpen, CheckCircle2, Circle, FolderGit2, Layers, Network } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, PageHeader } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { PROJECT_REFS, SQL_TRACK, TRACKS } from "../lib/tracks";

export function DataEngineeringPage() {
  const { data } = usePage();
  const progress = useProgress();
  const notes = data.notes ?? [];
  const maps = new Set((data.mindmaps ?? []).map((m) => m.slug));
  const sqlNotes = notes.filter((n) => !TRACKS.some((t) => t.id === n.category));
  const sqlRead = sqlNotes.filter((n) => progress.read?.[n.slug]).length;

  return (
    <Container>
      <Seo
        title="Data Engineering Learning Tracks — Python, ETL, Warehousing, Spark, Airflow, dbt, Cloud"
        description="Free data engineering learning tracks: Python, ETL/ELT, data warehousing, Apache Spark, Airflow, dbt and cloud, with diagrams, mind maps, exercises and projects."
        path="/data-engineering"
        jsonLd={[
          breadcrumbs([{ name: "Home", path: "/" }, { name: "Data engineering", path: "/data-engineering" }]),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: TRACKS.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.title, url: canonical(`/data-engineering#${t.id}`) })),
          },
        ]}
      />
      <PageHeader
        eyebrow="Data engineering"
        title="Learning tracks"
        intro="From Python and SQL to pipelines, warehouses, distributed processing and orchestration. Every topic has notes, diagrams, exercises and interview questions; every track has a mind map, flashcards and projects."
      />

      <section id="sql" className="mb-6 scroll-mt-20 rounded-card border border-surface-border bg-surface-raised p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold text-ink">{SQL_TRACK.title}</h2>
          <span className="text-xs text-ink-faint">{sqlRead}/{sqlNotes.length} notes read</span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">{SQL_TRACK.description}</p>
        <p className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link to="/notes" className="inline-flex items-center gap-1 text-accent hover:underline"><BookOpen className="h-4 w-4" aria-hidden /> SQL notes</Link>
          <Link to="/questions" className="inline-flex items-center gap-1 text-accent hover:underline"><Layers className="h-4 w-4" aria-hidden /> 133 practice questions</Link>
          <Link to="/mindmaps/sql-roadmap" className="inline-flex items-center gap-1 text-accent hover:underline"><Network className="h-4 w-4" aria-hidden /> SQL roadmap</Link>
        </p>
      </section>

      {TRACKS.map((t) => {
        const tn = t.topics.map((topic) => ({ topic, note: notes.find((n) => n.slug === topic.slug) }));
        const read = tn.filter(({ topic }) => progress.read?.[topic.slug]).length;
        const projects = PROJECT_REFS.filter((p) => tn.some(({ note }) => note?.projects.includes(p.slug)));
        return (
          <section key={t.id} id={t.id} className="mb-6 scroll-mt-20 rounded-card border border-surface-border bg-surface-raised p-5" aria-labelledby={`t-${t.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`t-${t.id}`} className="font-display text-xl font-bold text-ink">{t.title}</h2>
              <span className="text-xs text-ink-faint">{read}/{t.topics.length} topics read</span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">{t.description}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-soft" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${(100 * read) / t.topics.length}%` }} />
            </div>
            <ol className="mt-4 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {tn.map(({ topic, note }, i) => (
                <li key={topic.slug} className="flex items-center gap-2 text-sm">
                  {progress.read?.[topic.slug] ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Read" /> : <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not read" />}
                  {note ? (
                    <Link to={`/notes/${topic.slug}`} className="text-ink hover:text-accent hover:underline">{i + 1}. {topic.title}</Link>
                  ) : (
                    <span className="text-ink-faint">{i + 1}. {topic.title} (coming soon)</span>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-4 flex flex-wrap gap-3 text-sm">
              {maps.has(t.mindmap) && <Link to={`/mindmaps/${t.mindmap}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Network className="h-4 w-4" aria-hidden /> Mind map</Link>}
              <Link to={`/flashcards?deck=${t.id}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Layers className="h-4 w-4" aria-hidden /> Flashcards</Link>
              {projects.map((p) => (
                <Link key={p.slug} to={`/projects-lab/${p.slug}`} className="inline-flex items-center gap-1 text-accent hover:underline"><FolderGit2 className="h-4 w-4" aria-hidden /> {p.title}</Link>
              ))}
            </p>
          </section>
        );
      })}
    </Container>
  );
}
