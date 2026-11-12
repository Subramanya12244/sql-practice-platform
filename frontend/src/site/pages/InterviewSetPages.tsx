import { Link } from "react-router-dom";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { Container, PageHeader, QuestionCard } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { useProgress } from "../lib/progress";

export function InterviewSetsPage() {
  const { data } = usePage();
  const sets = data.sets ?? [];
  return (
    <Container>
      <Seo
        title="SQL Interview Question Sets by Role"
        description="Curated SQL interview question sets for data analysts, data engineers and FAANG-style screens, plus the top 20 most asked. Practice free in your browser."
        path="/interview"
        jsonLd={[
          breadcrumbs([{ name: "Home", path: "/" }, { name: "Interview sets", path: "/interview" }]),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: sets.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: canonical(`/interview/${s.slug}`), name: s.title })),
          },
        ]}
      />
      <PageHeader eyebrow="Interview prep" title="SQL interview sets" intro="Hand-picked question lists for the role you're interviewing for, ordered easy to hard." />
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Link to="/mock-interview" data-help="interview-mock-link" className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">Take a timed mock interview →</Link>
        <Link to="/shortcuts/interview-revision" data-help="interview-revision-link" className="rounded-lg border border-surface-border px-3 py-1.5 font-medium text-accent">Interview quick revision →</Link>
        <Link to="/patterns" data-help="interview-patterns-link" className="rounded-lg border border-surface-border px-3 py-1.5 font-medium text-accent">Interview patterns →</Link>
      </div>
      <div data-help="interview-sets" className="grid gap-3 sm:grid-cols-2">
        {sets.map((s) => (
          <Link key={s.slug} to={`/interview/${s.slug}`} className="rounded-card border border-surface-border bg-surface-raised p-5 shadow-panel hover:border-accent">
            <p className="font-display text-lg font-bold text-ink">{s.title}</p>
            <p className="mt-1 text-sm text-ink-muted">{s.description}</p>
          </Link>
        ))}
      </div>
    </Container>
  );
}

export function InterviewSetPage() {
  const { data } = usePage();
  const set = data.set!;
  const progress = useProgress();
  const path = `/interview/${set.slug}`;
  const qs = set.questions.map((slug) => data.index.find((q) => q.slug === slug)).filter((q) => q !== undefined);
  const solved = qs.filter((q) => progress.questions[q.number]?.solvedAt).length;

  return (
    <Container className="pt-6">
      <Seo
        title={set.title}
        description={set.description}
        path={path}
        type="article"
        jsonLd={[
          breadcrumbs([
            { name: "Home", path: "/" },
            { name: "Interview sets", path: "/interview" },
            { name: set.title, path },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: set.title,
            description: set.description,
            url: canonical(path),
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: qs.length,
              itemListElement: qs.map((q, i) => ({ "@type": "ListItem", position: i + 1, url: canonical(`/questions/${q.slug}`), name: q.title })),
            },
          },
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint">
        <Link to="/interview" className="hover:text-ink">Interview sets</Link>
      </nav>
      <article className="mt-3 max-w-3xl">
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{set.title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{qs.length} questions · you've solved {solved}</p>
        <Markdown source={set.body} className="mt-6" />
      </article>
      <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {qs.map((q) => (
          <li key={q.slug}><QuestionCard q={q} solved={!!progress.questions[q.number]?.solvedAt} /></li>
        ))}
      </ol>
    </Container>
  );
}
