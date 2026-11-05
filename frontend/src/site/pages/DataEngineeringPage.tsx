import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, CheckCircle2, Clock, FolderGit2, Layers, Network } from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, ButtonLink, Card, Container, PageHeader, ProgressBar, ProgressRing } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { PROJECT_REFS, SQL_TRACK, TRACKS } from "../lib/tracks";
import type { NoteMeta } from "../lib/learning";

/** Reading time in hours from the notes' own minute estimates (rounded to half hours). */
const hours = (notes: (NoteMeta | undefined)[]) => {
  const min = notes.reduce((s, n) => s + (n?.minutes ?? 0), 0);
  return min ? Math.max(0.5, Math.round((min / 60) * 2) / 2) : null;
};

/**
 * Seven data engineering tracks (plus SQL) as learning journeys, built from tracks.json and the
 * notes' front matter. Topic states are Completed (read), Next up (first unread) or Not started;
 * the platform doesn't lock topics, so no "locked" state is shown.
 */
export function DataEngineeringPage() {
  const { data } = usePage();
  const progress = useProgress();
  const notes = data.notes ?? [];
  const maps = new Set((data.mindmaps ?? []).map((m) => m.slug));
  const sqlNotes = notes.filter((n) => !TRACKS.some((t) => t.id === n.category));
  const sqlRead = sqlNotes.filter((n) => progress.read?.[n.slug]).length;
  const tracks = TRACKS.map((t) => {
    const tn = t.topics.map((topic) => ({ topic, note: notes.find((n) => n.slug === topic.slug) }));
    const read = tn.filter(({ topic }) => progress.read?.[topic.slug]).length;
    return { t, tn, read, hrs: hours(tn.map((x) => x.note)), next: tn.find(({ topic, note }) => note && !progress.read?.[topic.slug]) };
  });
  const totalTopics = tracks.reduce((s, x) => s + x.tn.length, 0);
  const totalRead = tracks.reduce((s, x) => s + x.read, 0);

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

      <Card className="mb-6 flex flex-wrap items-center gap-5">
        <ProgressRing value={totalRead} max={totalTopics} size={80} label="Data engineering topics read">
          <span className="font-display text-lg font-bold tabular-nums text-ink">{totalTopics ? Math.round((100 * totalRead) / totalTopics) : 0}%</span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{totalRead} of {totalTopics} topics read across {TRACKS.length} tracks</p>
          <p className="text-sm text-ink-muted">Mark a note as read at the end of the page and it counts here, on your dashboard and in the study planner.</p>
        </div>
      </Card>

      <nav aria-label="Tracks" className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[{ id: "sql", title: SQL_TRACK.title, n: sqlNotes.length, read: sqlRead, hrs: hours(sqlNotes) }, ...tracks.map(({ t, tn, read, hrs }) => ({ id: t.id, title: t.title, n: tn.length, read, hrs }))].map((x) => {
          const pct = x.n ? Math.round((100 * x.read) / x.n) : 0;
          return (
            <a key={x.id} href={`#${x.id}`} className="group rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition duration-fast hover:-translate-y-0.5 hover:border-accent/40">
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold text-ink group-hover:text-accent">{x.title}</span>
                {pct === 100 ? <Badge tone="success">Done</Badge> : pct > 0 ? <Badge tone="accent">{pct}%</Badge> : null}
              </span>
              <span className="mt-1 flex items-center gap-3 text-xs text-ink-faint">
                <span>{x.n} topics</span>
                {x.hrs && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden /> ~{x.hrs} h</span>}
              </span>
              <ProgressBar className="mt-3" value={x.read} max={x.n || 1} label={`${x.title} progress`} />
            </a>
          );
        })}
      </nav>

      <Card as="section" className="mb-6 scroll-mt-24" >
        <div id="sql" className="scroll-mt-24" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold text-ink">{SQL_TRACK.title}</h2>
          <span className="text-xs text-ink-faint">{sqlRead}/{sqlNotes.length} notes read</span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">{SQL_TRACK.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink to="/notes" variant="secondary" size="sm"><BookOpen className="h-4 w-4" aria-hidden /> SQL notes</ButtonLink>
          <ButtonLink to="/questions" variant="secondary" size="sm"><Layers className="h-4 w-4" aria-hidden /> {data.index.length} practice questions</ButtonLink>
          <ButtonLink to="/mindmaps/sql-roadmap" variant="secondary" size="sm"><Network className="h-4 w-4" aria-hidden /> SQL roadmap</ButtonLink>
        </div>
      </Card>

      {tracks.map(({ t, tn, read, hrs, next }) => {
        const projects = PROJECT_REFS.filter((p) => tn.some(({ note }) => note?.projects.includes(p.slug)));
        return (
          <Card as="section" key={t.id} className="mb-6">
            <div id={t.id} className="scroll-mt-24" />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={`t-${t.id}`} className="font-display text-xl font-bold text-ink">{t.title}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.description}</p>
                <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
                  <span>{t.topics.length} topics</span>
                  {hrs && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden /> about {hrs} hours of reading</span>}
                  <span>{read}/{t.topics.length} read</span>
                </p>
              </div>
              {next && <ButtonLink to={`/notes/${next.topic.slug}`} size="sm">{read ? "Continue" : "Start"}: {next.topic.title} <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>}
            </div>
            <ProgressBar className="mt-4" value={read} max={t.topics.length} label={`${t.title} progress`} />
            <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={`${t.title} topics`}>
              {tn.map(({ topic, note }, i) => {
                const done = Boolean(progress.read?.[topic.slug]);
                const isNext = next?.topic.slug === topic.slug;
                const body = (
                  <>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-success text-white" : isNext ? "bg-accent text-white" : "bg-surface-soft text-ink-muted"}`} aria-hidden>
                      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate text-sm ${done ? "text-ink-muted" : "font-medium text-ink"}`}>{topic.title}</span>
                      <span className="text-[11px] text-ink-faint">
                        {done ? "Completed" : isNext ? "Next up" : note ? "Not started" : "Coming soon"}{note?.minutes ? ` · ${note.minutes} min` : ""}{note?.difficulty ? ` · ${note.difficulty}` : ""}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={topic.slug}>
                    {note ? (
                      <Link to={`/notes/${topic.slug}`} className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-fast hover:border-accent/40 ${isNext ? "border-accent/40 bg-accent-dim" : "border-surface-border"}`}>{body}</Link>
                    ) : <div className="flex items-center gap-3 rounded-lg border border-dashed border-surface-border px-3 py-2 opacity-70">{body}</div>}
                  </li>
                );
              })}
            </ol>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-surface-border pt-4">
              {maps.has(t.mindmap) && <ButtonLink to={`/mindmaps/${t.mindmap}`} variant="secondary" size="sm"><Network className="h-4 w-4" aria-hidden /> Mind map</ButtonLink>}
              <ButtonLink to={`/flashcards?deck=${t.id}`} variant="secondary" size="sm"><Layers className="h-4 w-4" aria-hidden /> Flashcards</ButtonLink>
              {projects.map((p) => (
                <ButtonLink key={p.slug} to={`/projects-lab/${p.slug}`} variant="ghost" size="sm"><FolderGit2 className="h-4 w-4" aria-hidden /> {p.title}</ButtonLink>
              ))}
            </div>
          </Card>
        );
      })}
    </Container>
  );
}
