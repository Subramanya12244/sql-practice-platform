import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Compass, Lightbulb, Play, Search } from "lucide-react";
import { Badge, ButtonLink, Card, ProgressBar, Skeleton } from "../ui";
import { CURRICULUM, isAuthored } from "../../lib/daily";
import { dailyResume } from "../../lib/dailyResume";
import { continueTarget, recommend } from "../../lib/learnPaths";
import type { LearnHubData } from "../../lib/learnLoad";
import type { DailyView } from "../../lib/useDaily";
import { ago } from "./shared";

const LESSONS = CURRICULUM.days.filter((d) => isAuthored(d.id)).length;

/** Where the learner left off, and why each suggestion is there. Real activity only: a new learner sees a start prompt. */
function ContinueCard({ hub, view, mounted }: { hub: LearnHubData; view: DailyView; mounted: boolean }) {
  const resume = useMemo(() => dailyResume(view), [view]);
  const target = useMemo(() => continueTarget({ resume, daily: view.state, progress: view.progress, lessons: hub.lessons }), [resume, view.state, view.progress, hub.lessons]);

  if (!mounted) {
    return (
      <Card data-help="hub-continue" aria-label="Continue learning" className="space-y-3" pad="md">
        <p className="text-label uppercase text-ink-faint">Continue learning</p>
        <div aria-busy="true" className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-6 w-4/5" /><Skeleton className="h-2 w-full" /><Skeleton className="h-10 w-36" /></div>
      </Card>
    );
  }

  if (!target) {
    const first = hub.lessons[0];
    return (
      <Card data-help="hub-continue" aria-label="Start learning" pad="md">
        <p className="text-label uppercase text-accent">Start here</p>
        <h2 className="mt-1 font-display text-h3 text-ink">Pick a starting point</h2>
        <p className="mt-1 text-sm text-ink-muted">Your progress shows up here once you finish a lesson, read a note or solve a question.</p>
        <ul className="mt-4 space-y-2">
          <li><ButtonLink to="/daily/day/1" className="w-full justify-between"><span className="inline-flex items-center gap-2"><Play className="h-4 w-4" aria-hidden /> Start Day 1: Python from scratch</span><ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink></li>
          {first && <li><ButtonLink to={`/learn/${first.slug}`} variant="secondary" className="w-full justify-between"><span>Learn SQL from SELECT</span><ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink></li>}
          <li><a href="#paths" className="inline-flex min-h-[36px] w-full items-center justify-between rounded-xl px-3 text-sm font-semibold text-accent hover:bg-hover/5"><span className="inline-flex items-center gap-2"><Compass className="h-4 w-4" aria-hidden /> Not sure? Compare the four paths</span><ArrowRight className="h-4 w-4" aria-hidden /></a></li>
        </ul>
      </Card>
    );
  }

  const { stats } = resume;
  return (
    <Card data-help="hub-continue" aria-label="Continue learning" pad="md">
      <p className="text-label uppercase text-accent">Continue learning</p>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted"><Badge tone={target.unfinished ? "info" : "neutral"}>{target.unfinished ? "In progress" : target.where.includes("next") ? "Up next" : "Last opened"}</Badge><span>{target.where} · {ago(target.at)}</span></p>
      <h2 className="mt-2 font-display text-h3 text-ink">{target.title}</h2>
      {stats.total > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-ink-muted"><span>Daily Learning</span><span className="tabular-nums">{stats.completed} of {stats.total} lessons completed</span></div>
          <ProgressBar value={stats.completed} max={stats.total} label={`Daily Learning: ${stats.completed} of ${stats.total} lessons completed`} />
        </div>
      )}
      <ButtonLink to={target.to} className="mt-4"><Play className="h-4 w-4" aria-hidden /> Continue</ButtonLink>
    </Card>
  );
}

function Recommendations({ hub, view, mounted }: { hub: LearnHubData; view: DailyView; mounted: boolean }) {
  const recs = useMemo(() => (mounted ? recommend({ topics: hub.topics, progress: view.progress, resume: dailyResume(view) }) : []), [mounted, hub.topics, view]);
  if (!mounted || recs.length === 0) return null;
  return (
    <section aria-labelledby="recs-heading" data-help="hub-recs">
      <h3 id="recs-heading" className="flex items-center gap-2 text-label uppercase text-ink-faint"><Lightbulb className="h-3.5 w-3.5" aria-hidden /> Recommended for you</h3>
      <ul className="mt-2 space-y-2">
        {recs.map((r) => (
          <li key={r.id}>
            <Link to={r.to} className="group block rounded-xl border border-surface-border bg-surface-raised px-3.5 py-2.5 transition-all duration-fast ease-out hover:-translate-y-px hover:border-accent/40">
              <span className="flex items-center justify-between gap-2 text-sm font-semibold text-ink group-hover:text-accent"><span className="min-w-0 truncate">{r.title}</span><ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /></span>
              <span className="mt-0.5 block text-xs text-ink-muted">{r.reason}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LearnHero({ hub, view, mounted, onSearch }: { hub: LearnHubData; view: DailyView; mounted: boolean; onSearch: (q: string) => void }) {
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); onSearch(q.trim()); };
  return (
    <section aria-labelledby="learn-title" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <div>
        <p className="text-label uppercase text-accent">Learn</p>
        <h1 id="learn-title" className="mt-2 font-display text-h1 text-ink">Learn data skills, in the right order</h1>
        <p className="mt-3 max-w-xl text-lead text-ink-muted">
          Four paths, a topic library and a {LESSONS}-lesson plan, all tracking the same progress. Pick a path, or look up a single topic.
        </p>
        <form role="search" onSubmit={submit} className="mt-5 flex max-w-xl gap-2" data-help="hub-search">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search topics</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-faint" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics: joins, pandas, Airflow" className="min-h-[42px] w-full rounded-xl border border-surface-border bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint" />
          </label>
          <button type="submit" className="min-h-[42px] rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent shadow-glow transition-all duration-fast hover:brightness-110 active:scale-[0.98]">Search</button>
        </form>
        <nav aria-label="On this page" className="mt-6 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
          <span className="mr-1 text-label uppercase text-ink-faint">Jump to</span>
          {[["paths", "Paths"], ["topics", "Topics"], ["roadmap", "Roadmap"], ["practice", "Practice"], ["resources", "Resources"]].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors duration-fast hover:border-accent/40 hover:text-accent">{label}</a>
          ))}
        </nav>
        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted" aria-label="What is in the library">
          <li><strong className="font-semibold text-ink tabular-nums">{LESSONS}</strong> daily lessons</li>
          <li><strong className="font-semibold text-ink tabular-nums">{hub.counts.notes}</strong> theory notes</li>
          <li><strong className="font-semibold text-ink tabular-nums">{hub.counts.exercises}</strong> Python problems</li>
          <li><strong className="font-semibold text-ink tabular-nums">{hub.counts.projects}</strong> guided projects</li>
        </ul>
      </div>
      <div className="space-y-4">
        <ContinueCard hub={hub} view={view} mounted={mounted} />
        <Recommendations hub={hub} view={view} mounted={mounted} />
      </div>
    </section>
  );
}
