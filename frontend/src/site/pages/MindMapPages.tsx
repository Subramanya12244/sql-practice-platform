import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Network } from "lucide-react";
import { usePage } from "../SiteApp";
import { BookmarkButton } from "../components/LearnUi";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { walkNodes, type MapNode } from "../lib/learning";
import { recordVisit, useProgress, type Progress } from "../lib/progress";
import type { NodeStatus } from "../components/MindMapCanvas";

const MindMapCanvas = lazy(() => import("../components/MindMapCanvas"));

/** Done: its note is read or every linked question is solved. Weak: attempted questions still unsolved. */
export function nodeStatus(n: MapNode, p: Progress): NodeStatus {
  const qs = n.questions ?? [];
  const solved = qs.filter((q) => p.questions[q]?.solvedAt).length;
  const struggled = qs.some((q) => (p.questions[q]?.attempts ?? 0) > 0 && !p.questions[q]?.solvedAt);
  if (struggled) return "weak";
  if ((n.note && p.read?.[n.note]) || (qs.length > 0 && solved === qs.length)) return "done";
  return "none";
}

export function MindMapsIndexPage() {
  const { data } = usePage();
  const maps = data.mindmaps ?? [];
  return (
    <Container>
      <Seo
        title="Interactive SQL Mind Maps — Joins, Window Functions, Execution Order"
        description="Interactive SQL mind maps: the full SQL roadmap, execution order, joins, aggregation, window functions, PostgreSQL and indexing. Click a node to learn or practice."
        path="/mindmaps"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Mind maps", path: "/mindmaps" }])]}
      />
      <PageHeader eyebrow="Visual learning" title="SQL mind maps" intro="Zoom, expand and search each map. Nodes link to notes, patterns and practice questions, and turn green as you learn them." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {maps.map((m) => (
          <li key={m.slug}>
            <Link to={`/mindmaps/${m.slug}`} className="flex h-full gap-3 rounded-card border border-surface-border bg-surface-raised p-4 hover:border-accent/40">
              <Network className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="block font-semibold text-ink">{m.title}</span>
                <span className="mt-1 block text-sm text-ink-muted">{m.description}</span>
                <span className="mt-1 block text-xs text-ink-faint">{m.nodes} nodes</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}

/** Text outline of the map: what crawlers and screen readers get, and the no-JS fallback. */
function Outline({ n }: { n: MapNode }) {
  return (
    <li>
      <span className="text-ink">{n.label}</span>
      {n.note && <> · <Link to={`/notes/${n.note}`} className="text-accent hover:underline">notes</Link></>}
      {n.pattern && <> · <Link to={`/patterns/${n.pattern}`} className="text-accent hover:underline">pattern</Link></>}
      {n.detail && <span className="block text-xs text-ink-faint">{n.detail}</span>}
      {n.children?.length ? <ul className="ml-4 border-l border-surface-border pl-3">{n.children.map((c) => <Outline key={c.id} n={c} />)}</ul> : null}
    </li>
  );
}

export function MindMapPage() {
  const { data } = usePage();
  const m = data.mindmap!;
  const progress = useProgress();
  const path = `/mindmaps/${m.slug}`;
  const [mounted, setMounted] = useState(false);
  const [selected, setSelected] = useState<MapNode | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => recordVisit(`map:${m.slug}`, m.title, path), [m.slug, m.title, path]);

  const statusOf = useCallback((n: MapNode) => nodeStatus(n, progress), [progress]);
  const byId = new Map<string, MapNode>();
  let total = 0;
  let done = 0;
  let weak = 0;
  walkNodes(m.root, (n) => {
    byId.set(n.id, n);
    total++;
    const s = nodeStatus(n, progress);
    if (s === "done") done++;
    if (s === "weak") weak++;
  });
  const noteTitle = (s: string) => data.notes?.find((n) => n.slug === s)?.title ?? s;
  const patternTitle = (s: string) => data.patterns?.find((p) => p.slug === s)?.title ?? s;

  return (
    <Container wide className="pt-6">
      <Seo
        title={`${m.title} — Interactive SQL Mind Map`}
        description={m.description}
        path={path}
        jsonLd={[
          breadcrumbs([{ name: "Home", path: "/" }, { name: "Mind maps", path: "/mindmaps" }, { name: m.title, path }]),
          { "@context": "https://schema.org", "@type": "LearningResource", name: m.title, description: m.description, url: canonical(path), learningResourceType: "Concept map" },
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint"><Link to="/mindmaps" className="hover:text-ink">Mind maps</Link></nav>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{m.title}</h1>
        <BookmarkButton itemKey={`map:${m.slug}`} label="map" />
        <span className="text-sm text-ink-muted">{done}/{total} learned{weak ? ` · ${weak} need work` : ""}</span>
      </div>
      <p className="mt-1 max-w-3xl text-ink-muted">{m.description}</p>
      <p className="mt-2 flex flex-wrap gap-3 text-xs text-ink-faint">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-success/60 bg-success-dim align-middle" />learned</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-warn/60 bg-warn-dim align-middle" />needs work</span>
        <span>dashed edge = prerequisite · click a node for details</span>
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="h-[70vh] min-h-[460px] overflow-hidden rounded-card border border-surface-border bg-surface">
          {mounted ? (
            <Suspense fallback={<Skeleton className="h-full" />}>
              <MindMapCanvas map={m} statusOf={statusOf} onSelect={setSelected} selectedId={selected?.id ?? null} />
            </Suspense>
          ) : (
            <Skeleton className="h-full" />
          )}
        </div>
        <aside className="rounded-card border border-surface-border bg-surface-raised p-4 text-sm" aria-live="polite">
          {!selected ? (
            <p className="text-ink-muted">Select a node to see its notes, pattern, prerequisites and practice questions.</p>
          ) : (
            <>
              <p className="font-display text-lg font-bold text-ink">{selected.label}</p>
              {selected.detail && <p className="mt-1 text-ink-muted">{selected.detail}</p>}
              {(selected.prereq?.length ?? 0) > 0 && (
                <p className="mt-3 text-ink-muted"><strong className="text-ink">Learn first:</strong> {selected.prereq!.map((id) => byId.get(id)?.label ?? id).join(", ")}</p>
              )}
              <div className="mt-3 flex flex-col gap-1">
                {selected.note && <Link to={`/notes/${selected.note}`} className="text-accent hover:underline">Notes: {noteTitle(selected.note)} →</Link>}
                {selected.pattern && <Link to={`/patterns/${selected.pattern}`} className="text-accent hover:underline">Pattern: {patternTitle(selected.pattern)} →</Link>}
                {(selected.questions ?? []).map((n) => {
                  const q = data.index.find((x) => x.number === n);
                  return q ? (
                    <Link key={n} to={`/questions/${q.slug}`} className="text-accent hover:underline">
                      {progress.questions[n]?.solvedAt ? "✓ " : ""}Q{n} {q.title} →
                    </Link>
                  ) : null;
                })}
              </div>
            </>
          )}
        </aside>
      </div>

      <details className="mt-6 rounded-card border border-surface-border bg-surface-raised p-4">
        <summary className="cursor-pointer font-medium text-ink">Text outline</summary>
        <ul className="mt-3 text-sm"><Outline n={m.root} /></ul>
      </details>
    </Container>
  );
}
