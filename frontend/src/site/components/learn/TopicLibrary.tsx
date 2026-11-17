import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, Eye, FolderGit2, Lightbulb, Network, PenLine, Puzzle, Search, X, type LucideIcon } from "lucide-react";
import { Button, Card, EmptyState, SectionHeader } from "../ui";
import { LevelBadge } from "../LearnUi";
import {
  LEVELS, NO_FILTER, RESOURCE_TYPES, SUBJECTS, categoriesFor, filterTopics, isFiltered, topicEyebrow, topicProgress,
  type ResourceType, type Subject, type TopicFilter, type TopicLite,
} from "../../lib/learnTopics";
import type { DailyState } from "../../lib/dailyProgress";
import type { Progress } from "../../lib/progress";
import { SUBJECT_STYLE, StatusPill, TopicDuration } from "./shared";

const PAGE = 12;
const SUBJECT_IDS = SUBJECTS.map((s) => s.id) as string[];
const TYPE_IDS = RESOURCE_TYPES.map((t) => t.id) as string[];

/** The filter the URL describes (?q=&subject=&level=&type=&topic=). Unknown values are ignored, so a stale link never breaks the page. */
export function filterFromSearch(search: string): TopicFilter {
  const p = new URLSearchParams(search);
  const subject = p.get("subject") ?? "";
  const level = p.get("level") ?? "";
  const type = p.get("type") ?? "";
  return {
    q: (p.get("q") ?? "").slice(0, 80),
    subject: SUBJECT_IDS.includes(subject) ? (subject as Subject) : "all",
    level: (LEVELS as readonly string[]).includes(level) ? level : "all",
    type: TYPE_IDS.includes(type) ? (type as ResourceType) : "all",
    category: (p.get("topic") ?? "all").slice(0, 60) || "all",
  };
}

export function filterToSearch(f: TopicFilter): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.subject !== "all") p.set("subject", f.subject);
  if (f.level !== "all") p.set("level", f.level);
  if (f.type !== "all") p.set("type", f.type);
  if (f.category !== "all") p.set("topic", f.category);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Library filter state. The first render is always unfiltered (so prerendered and hydrated HTML match); the URL is applied after
 * mount and kept in step afterwards. The URL is parsed once and held in a ref, so a second run of the mount effect (React
 * StrictMode in development) cannot read an address this hook has already rewritten.
 */
export function useTopicFilter(): [TopicFilter, (f: TopicFilter) => void] {
  const [filter, setFilter] = useState<TopicFilter>(NO_FILTER);
  const [applied, setApplied] = useState(false);
  const initial = useRef<TopicFilter | null>(null);
  useEffect(() => {
    initial.current ??= filterFromSearch(window.location.search);
    setFilter(initial.current);
    setApplied(true);
  }, []);
  useEffect(() => {
    if (!applied) return;
    const next = `${window.location.pathname}${filterToSearch(filter)}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  }, [filter, applied]);
  return [filter, setFilter];
}

const RESOURCE_ICON: { type: ResourceType; icon: LucideIcon; one: string; many: string }[] = [
  { type: "practice", icon: PenLine, one: "practice problem", many: "practice problems" },
  { type: "pattern", icon: Puzzle, one: "pattern", many: "patterns" },
  { type: "guide", icon: Lightbulb, one: "concept guide", many: "concept guides" },
  { type: "map", icon: Network, one: "mind map", many: "mind maps" },
  { type: "project", icon: FolderGit2, one: "project", many: "projects" },
  { type: "visual", icon: Eye, one: "visual explanation", many: "visual explanations" },
  { type: "daily", icon: Calendar, one: "Daily Learning phase", many: "Daily Learning phases" },
];

export function TopicCard({ t, progress, daily }: { t: TopicLite; progress: Pick<Progress, "read" | "questions">; daily: DailyState }) {
  const st = topicProgress(t, progress, daily);
  const style = SUBJECT_STYLE[t.subject];
  return (
    <li>
      <Link to={`/learn/topic/${t.id}`} data-topic={t.id} className="group flex h-full flex-col rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition-all duration-base ease-out hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow active:scale-[0.995]">
        <span className="flex items-start justify-between gap-2">
          <span className={`min-w-0 text-label uppercase ${style.text}`}>{topicEyebrow(t.subject, t.categoryLabel)}</span>
          <StatusPill status={st.status} label={st.label} />
        </span>
        <span className="mt-1.5 font-semibold leading-snug text-ink group-hover:text-accent">{t.title}</span>
        <span className="mt-1 line-clamp-2 text-sm text-ink-muted">{t.description}</span>
        <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3">
          <LevelBadge level={t.level} />
          <TopicDuration minutes={t.minutes} />
          <span className="ml-auto flex items-center gap-2 text-ink-faint">
            {RESOURCE_ICON.filter((r) => t.n[r.type] > 0).map(({ type, icon: Icon, one, many }) => (
              <span key={type} className="inline-flex items-center gap-0.5 text-[11px] tabular-nums" title={`${t.n[type]} ${t.n[type] === 1 ? one : many}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />{t.n[type]}<span className="sr-only"> {t.n[type] === 1 ? one : many}</span>
              </span>
            ))}
          </span>
        </span>
      </Link>
    </li>
  );
}

const selectCls = "min-h-[40px] w-full rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-sm text-ink";

export function TopicLibrary({ topics, filter, setFilter, progress, daily }: { topics: TopicLite[]; filter: TopicFilter; setFilter: (f: TopicFilter) => void; progress: Pick<Progress, "read" | "questions">; daily: DailyState }) {
  const [shown, setShown] = useState(PAGE);
  const results = useMemo(() => filterTopics(topics, filter), [topics, filter]);
  useEffect(() => setShown(PAGE), [filter]);
  const categories = useMemo(() => categoriesFor(topics, filter.subject), [topics, filter.subject]);
  const levels = LEVELS.filter((l) => topics.some((t) => t.level === l));
  const types = RESOURCE_TYPES.filter((r) => topics.some((t) => t.n[r.id] > 0));
  const set = (patch: Partial<TopicFilter>) => setFilter({ ...filter, ...patch });
  const active = isFiltered(filter);
  const countBy = (s: Subject) => topics.filter((t) => t.subject === s).length;
  const visible = results.slice(0, shown);

  return (
    <section id="topics" aria-labelledby="topics-heading" data-help="hub-topics" className="scroll-mt-20">
      <SectionHeader id="topics-heading" title="Explore topics" description="Every theory note and analytics module in one searchable library. Open a topic to see its notes, practice and projects together." />
      <Card pad="sm" className="space-y-3">
        <form role="search" onSubmit={(e) => e.preventDefault()}>
          <label className="relative block">
            <span className="sr-only">Search topics</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-faint" aria-hidden />
            <input type="search" value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search by name, category or what it covers" className="min-h-[42px] w-full rounded-xl border border-surface-border bg-surface py-2 pl-9 pr-9 text-sm text-ink placeholder:text-ink-faint" />
            {filter.q && <button type="button" aria-label="Clear search" onClick={() => set({ q: "" })} className="absolute right-2 top-2 rounded-md p-1 text-ink-faint hover:text-ink"><X className="h-4 w-4" aria-hidden /></button>}
          </label>
        </form>
        <div role="group" aria-label="Subject" className="flex flex-wrap gap-1.5">
          {[{ id: "all" as const, label: "All subjects", count: topics.length }, ...SUBJECTS.map((s) => ({ id: s.id, label: s.label, count: countBy(s.id) }))].map((s) => (
            <button key={s.id} type="button" aria-pressed={filter.subject === s.id} onClick={() => set({ subject: s.id, category: "all" })}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-fast ${filter.subject === s.id ? "border-accent/50 bg-accent-dim text-accent" : "border-surface-border text-ink-muted hover:border-accent/40 hover:text-ink"}`}>
              {s.label}<span className="text-xs tabular-nums opacity-70">{s.count}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-xs font-medium text-ink-muted">Difficulty
            <select className={`${selectCls} mt-1`} value={filter.level} onChange={(e) => set({ level: e.target.value })}>
              <option value="all">All levels</option>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-ink-muted">Topic
            <select className={`${selectCls} mt-1`} value={filter.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="all">All topics</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label} ({c.count})</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-ink-muted">Resource type
            <select className={`${selectCls} mt-1`} value={filter.type} onChange={(e) => set({ type: e.target.value as TopicFilter["type"] })}>
              <option value="all">Any resource</option>
              {types.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          {results.length === 0 ? "No topics found" : `Showing ${Math.min(shown, results.length)} of ${results.length} topic${results.length === 1 ? "" : "s"}`}
        </p>
        {active && <Button variant="ghost" size="sm" onClick={() => setFilter(NO_FILTER)}><X className="h-4 w-4" aria-hidden /> Clear filters</Button>}
      </div>

      {results.length === 0 ? (
        <div className="mt-3">
          <EmptyState icon={Search} title="No topics match these filters" action={<Button variant="secondary" onClick={() => setFilter(NO_FILTER)}>Clear filters</Button>}>
            Try a shorter search, another subject, or remove the resource type.
          </EmptyState>
        </div>
      ) : (
        <>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Topics">
            {visible.map((t) => <TopicCard key={t.id} t={t} progress={progress} daily={daily} />)}
          </ul>
          {results.length > shown && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, results.length - shown)} more <span className="text-ink-faint">({results.length - shown} left)</span></Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
