import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Search } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { BookmarkButton, LevelBadge, Minutes, RelatedPanel } from "../components/LearnUi";
import { Container, PageHeader } from "../components/ui";
import { Seo, breadcrumbs, canonical, faqPage } from "../lib/seo";
import { guideFaq } from "../lib/frontmatter";
import { NOTE_CATEGORIES, headings, type NoteMeta } from "../lib/learning";
import { markNoteRead, recordVisit, useProgress, type Progress } from "../lib/progress";

/** A note counts as learned when it is read and at least half its linked questions are solved. */
export function noteStatus(n: NoteMeta, p: Progress): "new" | "read" | "learned" {
  if (!p.read?.[n.slug]) return "new";
  const solved = n.questions.filter((q) => p.questions[q]?.solvedAt).length;
  return !n.questions.length || solved * 2 >= n.questions.length ? "learned" : "read";
}

function StatusIcon({ s }: { s: ReturnType<typeof noteStatus> }) {
  if (s === "learned") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Learned" />;
  if (s === "read") return <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-label="Read" />;
  return <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not read" />;
}

export function NotesIndexPage() {
  const { data } = usePage();
  const notes = data.notes ?? [];
  const progress = useProgress();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? notes.filter((n) => `${n.title} ${n.description} ${n.category}`.toLowerCase().includes(needle)) : notes;
  const readCount = notes.filter((n) => progress.read?.[n.slug]).length;

  return (
    <Container>
      <Seo
        title="SQL Theory Notes — From SELECT to Window Functions"
        description="Structured SQL notes for every topic: definitions, syntax, PostgreSQL examples you can run, common mistakes, performance tips and interview questions."
        path="/notes"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Notes", path: "/notes" }])]}
      />
      <PageHeader
        eyebrow="Theory notes"
        title="SQL notes"
        intro={`${notes.length} topics, beginner to expert, each with runnable PostgreSQL examples and interview questions. You've read ${readCount}.`}
      />
      <label className="relative mb-6 block max-w-md">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter notes…" aria-label="Filter notes"
          className="w-full rounded-lg border border-surface-border bg-surface py-2 pl-9 pr-3 text-sm text-ink" />
      </label>
      {NOTE_CATEGORIES.map((c) => {
        const group = shown.filter((n) => n.category === c.slug);
        if (!group.length) return null;
        const done = group.filter((n) => progress.read?.[n.slug]).length;
        return (
          <section key={c.slug} className="mb-8" aria-labelledby={`cat-${c.slug}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`cat-${c.slug}`} className="font-display text-xl font-bold text-ink">{c.label}</h2>
              <span className="text-xs text-ink-faint">{done}/{group.length} read</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-soft" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${(100 * done) / group.length}%` }} />
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((n) => (
                <li key={n.slug}>
                  <Link to={`/notes/${n.slug}`} className="flex h-full gap-3 rounded-card border border-surface-border bg-surface-raised p-3 hover:border-accent/40">
                    <StatusIcon s={noteStatus(n, progress)} />
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{n.title}</span>
                      <span className="mt-1 flex items-center gap-2"><LevelBadge level={n.difficulty} /><Minutes n={n.minutes} /></span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!shown.length && <p className="text-ink-muted">No notes match “{q}”.</p>}
    </Container>
  );
}

export function NotePage() {
  const { data } = usePage();
  const n = data.note!;
  const all = data.notes ?? [];
  const progress = useProgress();
  const path = `/notes/${n.slug}`;
  const toc = headings(n.body);
  const isRead = Boolean(progress.read?.[n.slug]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => recordVisit(`note:${n.slug}`, n.title, path), [n.slug, n.title, path]);

  // Highlight the last section heading that has scrolled past the header.
  useEffect(() => {
    const ids = toc.map((t) => t.id);
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | null = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < 120) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [n.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const bySlug = (s: string) => all.find((x) => x.slug === s);
  const prereqs = n.prerequisites.map(bySlug).filter((x) => x !== undefined);
  const related = n.related.map(bySlug).filter((x) => x !== undefined);
  const patterns = n.patterns.map((s) => data.patterns?.find((p) => p.slug === s)).filter((x) => x !== undefined);
  const guides = n.guides.map((s) => data.guides?.find((g) => g.slug === s)).filter((x) => x !== undefined);
  const questions = n.questions.map((num) => data.index.find((q) => q.number === num)).filter((x) => x !== undefined);
  const inCat = all.filter((x) => x.category === n.category);
  const pos = inCat.findIndex((x) => x.slug === n.slug);
  const prev = inCat[pos - 1];
  const next = inCat[pos + 1];
  const category = NOTE_CATEGORIES.find((c) => c.slug === n.category);
  const faq = guideFaq(n.body);

  const jsonLd: object[] = [
    breadcrumbs([
      { name: "Home", path: "/" },
      { name: "Notes", path: "/notes" },
      { name: n.title, path },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: `${n.title} in SQL`,
      description: n.description,
      url: canonical(path),
      proficiencyLevel: n.difficulty,
      timeRequired: `PT${n.minutes}M`,
      version: String(n.version),
      inLanguage: "en",
    },
  ];
  if (faq.length) jsonLd.push(faqPage(faq));

  return (
    <Container wide className="pt-6">
      <Seo title={`${n.title} — SQL Notes`} description={n.description} path={path} type="article" jsonLd={jsonLd} />
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">On this page</p>
            <ul className="mt-2 space-y-1 border-l border-surface-border">
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className={`-ml-px block border-l-2 py-0.5 pl-3 ${active === t.id ? "border-accent text-accent" : "border-transparent text-ink-muted hover:text-ink"}`}>
                    {t.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 max-w-3xl">
          <nav aria-label="Breadcrumb" className="text-sm text-ink-faint">
            <Link to="/notes" className="hover:text-ink">Notes</Link>
            <span className="mx-1.5">/</span>
            <Link to={`/notes#cat-${n.category}`} className="hover:text-ink">{category?.label ?? n.category}</Link>
          </nav>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{n.title}</h1>
          <p className="mt-2 text-ink-muted">{n.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <LevelBadge level={n.difficulty} />
            <Minutes n={n.minutes} />
            <BookmarkButton itemKey={`note:${n.slug}`} label="note" />
          </div>
          {prereqs.length > 0 && (
            <p className="mt-4 rounded-lg border border-surface-border bg-surface-raised px-4 py-2 text-sm text-ink-muted">
              <strong className="text-ink">Before this:</strong>{" "}
              {prereqs.map((p, i) => (
                <span key={p.slug}>
                  <Link to={`/notes/${p.slug}`} className="text-accent underline">{p.title}</Link>
                  {progress.read?.[p.slug] ? " ✓" : ""}
                  {i < prereqs.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          )}

          <Markdown source={n.body} className="mt-6" />

          <div className="mt-10 flex flex-wrap items-center gap-3 rounded-card border border-surface-border bg-surface-raised p-4">
            <button
              type="button"
              onClick={() => markNoteRead(n.slug, !isRead)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${isRead ? "border border-success/40 text-success" : "bg-accent text-white"}`}
            >
              {isRead ? "✓ Marked as read" : "Mark as read"}
            </button>
            {questions[0] && (
              <Link to={`/questions/${questions[0].slug}`} className="text-sm font-medium text-accent hover:underline">
                Practice it: Q{questions[0].number} {questions[0].title} →
              </Link>
            )}
          </div>

          <nav className="mt-8 flex justify-between gap-4 text-sm" aria-label="Notes in this category">
            {prev ? <Link to={`/notes/${prev.slug}`} className="inline-flex items-center gap-1 text-accent hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden /> {prev.title}</Link> : <span />}
            {next && <Link to={`/notes/${next.slug}`} className="inline-flex items-center gap-1 text-accent hover:underline">{next.title} <ChevronRight className="h-4 w-4" aria-hidden /></Link>}
          </nav>
        </article>

        <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <RelatedPanel
            notes={related}
            patterns={patterns}
            guides={guides}
            maps={data.relatedMaps ?? []}
            questions={questions}
            solved={(num) => Boolean(progress.questions[num]?.solvedAt)}
          />
        </aside>
      </div>
    </Container>
  );
}
