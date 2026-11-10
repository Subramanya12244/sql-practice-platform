import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookX, CheckCircle2, RotateCcw } from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, ButtonLink, Card, Container, EmptyState, ErrorState, PageHeader, SectionHeader, Skeleton, StatCard, Tabs } from "../components/ui";
import { Seo } from "../lib/seo";
import { setMistakeUnderstood, useProgress } from "../lib/progress";
import { readStats, type PyStat } from "../lib/pyPractice";
import { buildNotebook, filterNotebook, improvement, recurring, type MistakeKind, type MistakeStatus, type NotebookRow } from "../lib/mistakes";

const STATUS: Record<MistakeStatus, { label: string; tone: "warn" | "success" | "neutral" }> = {
  open: { label: "Still open", tone: "warn" }, solved: { label: "Solved since", tone: "success" }, understood: { label: "Understood", tone: "neutral" },
};

function Row({ r }: { r: NotebookRow }) {
  return (
    <li className="rounded-lg border border-surface-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={r.path} className="min-w-0 flex-1 font-medium text-ink hover:text-accent">{r.title}</Link>
        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="What went wrong">
        {r.categories.map((c) => <li key={c.category} className="rounded-full bg-surface-soft px-2 py-0.5 text-xs text-ink">{c.label} · {c.count}</li>)}
      </ul>
      <p className="mt-1.5 text-xs text-ink-muted">
        {r.count} failed attempt{r.count === 1 ? "" : "s"}{r.runErrors ? ` · ${r.runErrors} run error${r.runErrors === 1 ? "" : "s"}` : ""} · last {r.lastAt ? new Date(r.lastAt).toLocaleDateString() : "earlier"}
        {r.notes.length ? ` · ${r.notes.join(" · ")}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ButtonLink to={r.path} variant="secondary" size="sm"><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry</ButtonLink>
        {r.status === "understood"
          ? <button type="button" onClick={() => setMistakeUnderstood(r.ref, false)} className="rounded-lg px-2.5 py-1 text-xs text-ink-muted hover:text-ink">Mark as not understood</button>
          : <button type="button" onClick={() => setMistakeUnderstood(r.ref, true)} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1 text-xs font-medium text-ink hover:border-accent"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> I understand this now</button>}
      </div>
    </li>
  );
}

export function MistakeNotebookPage() {
  const { data } = usePage();
  const progress = useProgress();
  const [mounted, setMounted] = useState(false);
  const [pyStats, setPyStats] = useState<Record<string, PyStat>>({});
  const [kind, setKind] = useState<MistakeKind | "all">("all");
  const [topic, setTopic] = useState("all");
  const [status, setStatus] = useState<MistakeStatus | "all">("all");
  useEffect(() => { setMounted(true); setPyStats(readStats()); }, []);
  const index = data.index ?? [];

  const all = useMemo(() => (mounted && index.length ? buildNotebook({ index, exercises: data.exercises ?? [], progress, pyStats }) : null), [mounted, index, data.exercises, progress, pyStats]);
  const rows = useMemo(() => (all ? filterNotebook(all, { kind, topic, status }) : []), [all, kind, topic, status]);
  const topics = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of filterNotebook(all ?? [], { kind })) m.set(r.topic, r.topicLabel);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, kind]);
  const groups = useMemo(() => {
    const m = new Map<string, NotebookRow[]>();
    for (const r of rows) m.set(`${r.kind === "sql" ? "SQL" : "Python"} · ${r.topicLabel}`, [...(m.get(`${r.kind === "sql" ? "SQL" : "Python"} · ${r.topicLabel}`) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);
  const rec = useMemo(() => recurring(all ?? []), [all]);
  const imp = useMemo(() => improvement(all ?? []), [all]);

  return (
    <Container>
      <Seo title="Mistake notebook" description="Your wrong answers by topic, what kind of mistake each was, and whether you have fixed it." path="/mistakes" noindex />
      <PageHeader eyebrow="Dashboard" title="Mistake notebook" intro="Every challenge you got wrong, grouped by topic and by the kind of mistake. Only the kind and the count are saved, never your code." />
      {!index.length ? (
        <ErrorState title="The notebook could not load">The question list is unavailable. Reload the page to try again.</ErrorState>
      ) : !all ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading notebook"><Skeleton className="h-20" /><Skeleton className="h-40" /></div>
      ) : !all.length ? (
        <EmptyState icon={BookX} title="No mistakes recorded yet" action={<ButtonLink to="/questions" size="sm">Practise SQL</ButtonLink>}>
          When a submit or a check fails, it appears here with the kind of mistake. A clean notebook is a good sign.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Challenges missed" value={imp.missed} />
            <StatCard label="Fixed since" value={imp.fixed} hint={imp.missed ? `${Math.round((imp.fixed / imp.missed) * 100)}% of missed` : undefined} />
            <StatCard label="Still open" value={all.filter((r) => r.status === "open").length} />
            <StatCard label="Recurring kinds" value={rec.length} hint="same mistake on 2+ challenges" />
          </div>

          {rec.length > 0 && (
            <Card pad="md" as="section" aria-label="Recurring mistakes">
              <SectionHeader title="Recurring mistakes" description="The same kind of mistake on different challenges. Fixing these helps most." />
              <ul className="mt-2 space-y-1.5 text-sm">
                {rec.map((x) => <li key={`${x.kind}:${x.category}`} className="flex flex-wrap items-center gap-2"><Badge tone={x.kind === "sql" ? "accent" : "neutral"}>{x.kind === "sql" ? "SQL" : "Python"}</Badge><span className="font-medium text-ink">{x.label}</span><span className="text-ink-muted">{x.count} times on {x.questions} challenges</span></li>)}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Filters">
            <Tabs label="Language" value={kind} onChange={(v) => { setKind(v); setTopic("all"); }} tabs={[{ id: "all", label: "All" }, { id: "sql", label: "SQL" }, { id: "python", label: "Python" }]} />
            <select aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink">
              <option value="all">All topics</option>
              {topics.map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
            </select>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as MistakeStatus | "all")} className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink">
              <option value="all">Any status</option><option value="open">Still open</option><option value="solved">Solved since</option><option value="understood">Understood</option>
            </select>
          </div>

          {!rows.length ? <p className="text-sm text-ink-muted" role="status">Nothing matches these filters.</p> : groups.map(([name, list]) => (
            <section key={name} aria-label={name}>
              <h2 className="text-sm font-semibold text-ink">{name} <span className="font-normal text-ink-faint">({list.length})</span></h2>
              <ul className="mt-2 space-y-2">{list.map((r) => <Row key={r.ref} r={r} />)}</ul>
            </section>
          ))}

          <section aria-label="Improvement by topic">
            <SectionHeader title="Improvement" description="How many missed challenges in each topic are solved now." />
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {imp.topics.map((t) => <li key={`${t.label}`} className="flex justify-between rounded-lg border border-surface-border px-3 py-2 text-sm"><span className="text-ink">{t.label}</span><span className="tabular-nums text-ink-muted">{t.fixed} of {t.missed} fixed</span></li>)}
            </ul>
          </section>
        </div>
      )}
    </Container>
  );
}
