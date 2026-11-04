import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Play, Search } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown, highlightSql } from "../components/Markdown";
import { Container, PageHeader } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { sendTo } from "../lib/handoff";
import type { ShortcutItem } from "../lib/learning";

function Item({ it, noteTitle }: { it: ShortcutItem; noteTitle: (s: string) => string | undefined }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  return (
    <li id={it.id} className="min-w-0 rounded-card border border-surface-border bg-surface-raised p-4">
      <p className="font-semibold text-ink">{it.operation}</p>
      <code className="mt-1 block overflow-x-auto whitespace-pre rounded bg-surface-soft px-2 py-1 font-mono text-xs text-ink" dangerouslySetInnerHTML={{ __html: highlightSql(it.syntax) }} />
      <p className="mt-2 text-sm text-ink-muted">{it.explanation}</p>
      <div className="relative mt-2">
        <pre className="overflow-x-auto rounded-lg bg-surface-soft p-3 pr-20 font-mono text-xs text-ink"><code dangerouslySetInnerHTML={{ __html: highlightSql(it.example) }} /></pre>
        <div className="absolute right-2 top-2 flex gap-1">
          <button type="button" aria-label="Copy example" title="Copy" className="rounded border border-surface-border bg-surface-raised p-1 text-ink-muted hover:text-ink"
            onClick={() => navigator.clipboard?.writeText(it.example).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}>
            {copied ? <span className="px-1 text-[11px]">Copied</span> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button type="button" aria-label="Run example in playground" title="Run in playground" className="rounded border border-surface-border bg-surface-raised p-1 text-ink-muted hover:text-ink"
            onClick={() => { sendTo({ tool: "playground", a: it.example }); navigate("/playground"); }}>
            <Play className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-faint"><strong className="text-ink-muted">Result:</strong> {it.expected}</p>
      {it.notes.length > 0 && (
        <p className="mt-2 text-xs">
          {it.notes.map((s) => (
            <Link key={s} to={`/notes/${s}`} className="mr-2 text-accent hover:underline">{noteTitle(s) ?? s} →</Link>
          ))}
        </p>
      )}
    </li>
  );
}

export function ShortcutsPage() {
  const { data } = usePage();
  const cats = data.shortcuts ?? [];
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const needle = q.trim().toLowerCase();
  const noteTitle = (s: string) => data.notes?.find((n) => n.slug === s)?.title;
  const total = cats.reduce((s, c) => s + c.items.length, 0);

  return (
    <Container>
      <Seo
        title="SQL Cheat Sheet & Shortcuts — Searchable Quick Reference"
        description="Searchable SQL quick reference: syntax, short explanations and runnable PostgreSQL examples for joins, aggregates, window functions, dates, strings and more."
        path="/shortcuts"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Shortcuts", path: "/shortcuts" }])]}
      />
      <PageHeader eyebrow="Quick reference" title="SQL shortcuts" intro={`${total} snippets you can copy or run. Also see the side-by-side comparisons and the one-page interview revision.`} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link to="/shortcuts/comparisons" className="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 font-medium text-accent hover:border-accent">Quick comparisons →</Link>
        <Link to="/shortcuts/interview-revision" className="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 font-medium text-accent hover:border-accent">Interview quick revision →</Link>
        <Link to="/cheatsheet" className="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 font-medium text-accent hover:border-accent">Printable cheat sheet →</Link>
      </div>
      <div className="sticky top-14 z-10 -mx-4 mb-6 flex flex-wrap items-center gap-2 bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search syntax, e.g. lag, coalesce, date_trunc" aria-label="Search shortcuts"
            className="w-full rounded-lg border border-surface-border bg-surface py-2 pl-9 pr-3 text-sm text-ink" />
        </label>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" className="rounded-lg border border-surface-border bg-surface px-2 py-2 text-sm text-ink">
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c.category} value={c.category}>{c.title}</option>)}
        </select>
      </div>
      {cats.filter((c) => cat === "all" || c.category === cat).map((c) => {
        const items = needle
          ? c.items.filter((it) => `${it.operation} ${it.syntax} ${it.explanation} ${it.example}`.toLowerCase().includes(needle))
          : c.items;
        if (!items.length) return null;
        return (
          <section key={c.category} className="mb-8" aria-labelledby={`sc-${c.category}`}>
            <h2 id={`sc-${c.category}`} className="font-display text-xl font-bold text-ink">{c.title}</h2>
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {items.map((it) => <Item key={it.id} it={it} noteTitle={noteTitle} />)}
            </ul>
          </section>
        );
      })}
    </Container>
  );
}

export function ShortcutDocPage() {
  const { data } = usePage();
  const page = data.shortcutPage!;
  const path = `/shortcuts/${page.slug}`;
  return (
    <Container className="pt-6">
      <Seo title={page.title} description={page.description} path={path} type="article"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Shortcuts", path: "/shortcuts" }, { name: page.title, path }])]} />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint"><Link to="/shortcuts" className="hover:text-ink">Shortcuts</Link></nav>
      <article className="mt-2 max-w-3xl">
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{page.title}</h1>
        <p className="mt-2 text-ink-muted">{page.description}</p>
        <Markdown source={page.body} className="mt-6" />
      </article>
    </Container>
  );
}
