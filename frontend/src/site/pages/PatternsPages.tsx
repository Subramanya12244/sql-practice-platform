import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { BookmarkButton, LevelBadge, RelatedPanel } from "../components/LearnUi";
import { Container, PageHeader } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { PATTERN_CATEGORIES, headings } from "../lib/learning";
import { recordVisit, useProgress } from "../lib/progress";

export function PatternsIndexPage() {
  const { data } = usePage();
  const patterns = data.patterns ?? [];
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? patterns.filter((p) => `${p.title} ${p.description}`.toLowerCase().includes(needle)) : patterns;

  return (
    <Container>
      <Seo
        title="SQL Problem-Solving Patterns — Duplicates, Top N, Gaps & Islands"
        description="Reusable SQL patterns for interviews: duplicates, top N per group, latest record, running totals, gaps and islands, growth, pivots, anti-joins and hierarchies."
        path="/patterns"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Patterns", path: "/patterns" }])]}
      />
      <PageHeader eyebrow="Patterns library" title="SQL patterns" intro="Recognise the shape of a problem, then reach for a proven query. Each pattern has a solution, alternatives, a walkthrough and practice questions." />
      <label className="relative mb-6 block max-w-md">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter patterns…" aria-label="Filter patterns"
          className="w-full rounded-lg border border-surface-border bg-surface py-2 pl-9 pr-3 text-sm text-ink" />
      </label>
      {Object.entries(PATTERN_CATEGORIES).map(([cat, label]) => {
        const group = shown.filter((p) => p.category === cat);
        if (!group.length) return null;
        return (
          <section key={cat} className="mb-8">
            <h2 className="font-display text-xl font-bold text-ink">{label}</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((p) => (
                <li key={p.slug}>
                  <Link to={`/patterns/${p.slug}`} className="block h-full rounded-card border border-surface-border bg-surface-raised p-4 hover:border-accent/40">
                    <span className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{p.title}</span><LevelBadge level={p.difficulty} /></span>
                    <span className="mt-1 block text-sm text-ink-muted">{p.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {shown.filter((p) => !PATTERN_CATEGORIES[p.category]).length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.filter((p) => !PATTERN_CATEGORIES[p.category]).map((p) => (
            <li key={p.slug}><Link to={`/patterns/${p.slug}`} className="text-accent hover:underline">{p.title}</Link></li>
          ))}
        </ul>
      )}
    </Container>
  );
}

export function PatternPage() {
  const { data } = usePage();
  const p = data.pattern!;
  const progress = useProgress();
  const path = `/patterns/${p.slug}`;
  useEffect(() => recordVisit(`pattern:${p.slug}`, p.title, path), [p.slug, p.title, path]);
  const toc = headings(p.body);

  return (
    <Container wide className="pt-6">
      <Seo
        title={`${p.title} — SQL Pattern`}
        description={p.description}
        path={path}
        type="article"
        jsonLd={[
          breadcrumbs([{ name: "Home", path: "/" }, { name: "Patterns", path: "/patterns" }, { name: p.title, path }]),
          { "@context": "https://schema.org", "@type": "TechArticle", headline: `${p.title} in SQL`, description: p.description, url: canonical(path), proficiencyLevel: p.difficulty },
        ]}
      />
      <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)_260px]">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-20 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">On this page</p>
            <ul className="mt-2 space-y-1">
              {toc.map((t) => <li key={t.id}><a href={`#${t.id}`} className="text-ink-muted hover:text-ink">{t.text}</a></li>)}
            </ul>
          </nav>
        </aside>
        <article className="min-w-0 max-w-3xl">
          <nav aria-label="Breadcrumb" className="text-sm text-ink-faint">
            <Link to="/patterns" className="hover:text-ink">Patterns</Link>
            <span className="mx-1.5">/</span>
            {PATTERN_CATEGORIES[p.category] ?? p.category}
          </nav>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{p.title}</h1>
          <p className="mt-2 text-ink-muted">{p.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <LevelBadge level={p.difficulty} />
            <BookmarkButton itemKey={`pattern:${p.slug}`} label="pattern" />
          </div>
          <Markdown source={p.body} className="mt-6" />
        </article>
        <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <RelatedPanel
            notes={p.notes.map((s) => data.notes?.find((n) => n.slug === s)).filter((x) => x !== undefined)}
            guides={p.guides.map((s) => data.guides?.find((g) => g.slug === s)).filter((x) => x !== undefined)}
            maps={data.relatedMaps ?? []}
            questions={p.questions.map((n) => data.index.find((q) => q.number === n)).filter((x) => x !== undefined)}
            solved={(n) => Boolean(progress.questions[n]?.solvedAt)}
          />
        </aside>
      </div>
    </Container>
  );
}
