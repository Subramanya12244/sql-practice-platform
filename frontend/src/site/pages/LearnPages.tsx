import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { InlineMarkdown } from "../components/Markdown";
import { ButtonLink, Card, Chip, Container, EmptyState, PageHeader, ProgressBar, ProgressRing, QuestionCard, SectionHeader, Skeleton, StatCard } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { setDailyGoal, streak, today, useProgress } from "../lib/progress";
import { weekActivity } from "../lib/dashboard";
import { useGamification } from "../lib/useGamification";
import { useAuth } from "../lib/auth";
import { dueQuestions } from "../lib/insights";
import { NOTE_CATEGORIES } from "../lib/learning";
import { PracticeNext } from "./ReviewPage";
import { BarChart3, BookOpen, Bookmark, Flame, Network, Play, Puzzle, Repeat, Sparkles, Target, Trophy, Zap } from "lucide-react";
import { useEffect } from "react";
import type { Lesson, LessonExercise, Question } from "../types";
import { DailyChallenge } from "../components/DailyChallenge";
import { activeMinutes, formatMinutes, subscribeActivity, summarizeMinutes, track } from "../lib/activity";

const PracticePanel = lazy(() => import("../components/PracticePanel"));

const exerciseKey = (slug: string, i: number) => `${slug}#${i}`;

function doneCount(lessons: Record<string, string> | undefined, slug: string, total: number) {
  let n = 0;
  for (let i = 0; i < total; i++) if (lessons?.[exerciseKey(slug, i)]) n++;
  return n;
}

export function LearnPage() {
  const { data } = usePage();
  const lessons = data.lessons ?? [];
  const progress = useProgress();
  const levels = ["Beginner", "Intermediate", "Advanced"];
  const totalEx = lessons.reduce((s, l) => s + l.exercises, 0);
  const doneEx = lessons.reduce((s, l) => s + doneCount(progress.lessons, l.slug, l.exercises), 0);

  const jsonLd = [
    breadcrumbs([{ name: "Home", path: "/" }, { name: "Learn SQL", path: "/learn" }]),
    {
      "@context": "https://schema.org",
      "@type": "Course",
      name: "Learn SQL from scratch",
      description: "A free, hands-on SQL course: SELECT to window functions, transactions and indexes, with exercises graded in your browser.",
      url: canonical("/learn"),
      provider: { "@type": "Organization", name: "DataForge", sameAs: canonical("/") },
      isAccessibleForFree: true,
      hasCourseInstance: { "@type": "CourseInstance", courseMode: "online", courseWorkload: "PT10H" },
      syllabusSections: lessons.map((l) => ({ "@type": "Syllabus", name: l.title, url: canonical(`/learn/${l.slug}`) })),
    },
  ];

  return (
    <Container>
      <Seo
        title="Learn SQL — Free Interactive SQL Course with Exercises"
        description="Learn SQL step by step: SELECT, joins, GROUP BY, subqueries, CTEs, window functions, DML, indexes and transactions. Exercises run in your browser."
        path="/learn"
        jsonLd={jsonLd}
      />
      <PageHeader
        eyebrow="Dashboard"
        title="Your learning dashboard"
        intro={`Goals, progress and what to do next, plus the ${lessons.length}-lesson SQL course with ${totalEx} graded exercises.`}
      />
      <LearnDashboard />
      <h2 className="mt-12 font-display text-2xl font-bold text-ink" id="roadmap">SQL course roadmap</h2>
      <p className="mt-1 text-sm text-ink-muted">Hands-on lessons in order. Each ends with exercises graded in your browser. {doneEx > 0 && `You've passed ${doneEx} of ${totalEx}.`}</p>
      {levels.map((level) => {
        const group = lessons.filter((l) => l.level === level);
        if (!group.length) return null;
        return (
          <section key={level} className="mt-8" aria-labelledby={`lvl-${level}`}>
            <h2 id={`lvl-${level}`} className="font-display text-xl font-bold text-ink">{level}</h2>
            <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((l) => {
                const done = doneCount(progress.lessons, l.slug, l.exercises);
                return (
                  <li key={l.slug}>
                    <Link
                      to={`/learn/${l.slug}`}
                      className="block h-full rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition duration-fast hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow"
                    >
                      <p className="flex items-center justify-between text-xs text-ink-faint">
                        <span>Lesson {l.order}</span>
                        <span className={done === l.exercises && done > 0 ? "inline-flex items-center gap-1 text-success" : ""}>
                          {done === l.exercises && done > 0 && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                          {done}/{l.exercises} exercises
                        </span>
                      </p>
                      <p className="mt-1 font-semibold text-ink">{l.title}</p>
                      <p className="mt-1 text-sm text-ink-muted">{l.description}</p>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </Container>
  );
}

function Exercise({ lesson, ex }: { lesson: Lesson; ex: LessonExercise }) {
  const [open, setOpen] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const progress = useProgress();
  const key = exerciseKey(lesson.slug, ex.index);
  const done = Boolean(progress.lessons?.[key]);
  const question = {
    number: 0,
    slug: key,
    title: `Exercise ${ex.index + 1}`,
    tables: [],
    referenceQuery: ex.solution,
    sortRequired: Boolean(ex.orderBy),
    orderBy: ex.orderBy,
    starter: `-- Exercise ${ex.index + 1}: ${ex.prompt}\n\n`,
  } as unknown as Question;

  return (
    <section className="my-8 rounded-card border border-accent/30 bg-accent-dim/40 p-4" aria-label={`Exercise ${ex.index + 1}`}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
        Exercise {ex.index + 1}
        {done && <span className="inline-flex items-center gap-1 normal-case text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> passed</span>}
      </p>
      <p className="mt-1 text-ink"><InlineMarkdown source={ex.prompt} /></p>
      {ex.orderBy && <p className="mt-1 text-xs text-ink-faint">Row order is checked.</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">
            Try it
          </button>
        )}
        <button type="button" onClick={() => setShowSolution((v) => !v)} className="rounded-lg border border-surface-border px-3 py-1.5 text-ink-muted hover:text-ink">
          {showSolution ? "Hide solution" : "Show solution"}
        </button>
      </div>
      {showSolution && <Markdown source={"```sql\n" + ex.solution + "\n```"} className="mt-3" />}
      {open && (
        <div className="mt-3">
          <Suspense fallback={<Skeleton className="h-[540px]" />}>
            <PracticePanel question={question} lessonKey={key} fresh />
          </Suspense>
        </div>
      )}
    </section>
  );
}

export function LessonPage() {
  const { data } = usePage();
  const l = data.lesson!;
  useEffect(() => track("lesson_opened", `lesson:${l.slug}`), [l.slug]);
  const all = data.lessons ?? [];
  const progress = useProgress();
  const path = `/learn/${l.slug}`;
  const pos = all.findIndex((x) => x.slug === l.slug);
  const prev = all[pos - 1];
  const next = all[pos + 1];
  const related = l.related.map((s) => data.index.find((q) => q.slug === s)).filter(Boolean);

  const jsonLd = [
    breadcrumbs([
      { name: "Home", path: "/" },
      { name: "Learn SQL", path: "/learn" },
      { name: l.title, path },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: l.title,
      description: l.description,
      url: canonical(path),
      proficiencyLevel: l.level,
      isPartOf: { "@type": "Course", name: "Learn SQL from scratch", url: canonical("/learn") },
      inLanguage: "en",
    },
  ];

  return (
    <Container className="pt-6">
      <Seo title={`${l.title} — Lesson ${l.order}`} description={l.description} path={path} type="article" jsonLd={jsonLd} />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-faint">
        <Link to="/learn" className="hover:text-ink">Learn SQL</Link> · Lesson {l.order} of {all.length}
      </nav>
      <article className="mt-3 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{l.level}</Chip>
        </div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{l.title}</h1>
        {l.segments.map((s, i) =>
          s.kind === "md" ? <Markdown key={i} source={s.text} className="mt-6" /> : <Exercise key={i} lesson={l} ex={s.exercise} />,
        )}
        {related.length > 0 && (
          <>
            <h2 className="mt-10 font-display text-xl font-bold text-ink">Practice questions</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {related.map((q) => q && <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
            </div>
          </>
        )}
        <nav className="mt-10 flex justify-between gap-4 border-t border-surface-border pt-6 text-sm" aria-label="Lessons">
          {prev ? (
            <Link to={`/learn/${prev.slug}`} className="inline-flex items-center gap-1 text-accent hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden /> {prev.title}</Link>
          ) : <span />}
          {next && (
            <Link to={`/learn/${next.slug}`} className="inline-flex items-center gap-1 text-accent hover:underline">{next.title} <ChevronRight className="h-4 w-4" aria-hidden /></Link>
          )}
        </nav>
      </article>
    </Container>
  );
}

const MODULES = [
  { to: "/notes", label: "Theory notes", desc: "Every topic, beginner to expert", icon: BookOpen },
  { to: "/mindmaps", label: "Mind maps", desc: "See how concepts connect", icon: Network },
  { to: "/patterns", label: "Patterns", desc: "Reusable interview solutions", icon: Puzzle },
  { to: "/shortcuts", label: "Shortcuts", desc: "Searchable syntax reference", icon: Zap },
  { to: "/review", label: "Revision", desc: "Spaced-repetition queue", icon: Repeat },
  { to: "/mock-interview", label: "Assessment", desc: "Timed mock interview", icon: Target },
];

const bookmarkLink = (key: string, notes: { slug: string; title: string }[], patterns: { slug: string; title: string }[], maps: { slug: string; title: string }[]) => {
  const [kind, slug] = key.split(":");
  if (kind === "note") return { path: `/notes/${slug}`, title: notes.find((n) => n.slug === slug)?.title ?? slug };
  if (kind === "pattern") return { path: `/patterns/${slug}`, title: patterns.find((n) => n.slug === slug)?.title ?? slug };
  if (kind === "map") return { path: `/mindmaps/${slug}`, title: maps.find((n) => n.slug === slug)?.title ?? slug };
  return null;
};

const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });

/**
 * Personal dashboard on /learn. Every number comes from this visitor's progress record (browser or
 * synced account); a new visitor sees zeros and empty states, never sample data. Values that
 * depend on today's date or localStorage render after mount, so the prerendered HTML is neutral.
 */
function LearnDashboard() {
  const { data } = usePage();
  const progress = useProgress();
  const { profile } = useAuth();
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(today()), []);
  const mounted = day !== null;
  const notes = data.notes ?? [];
  const goal = progress.dailyGoal ?? 3;
  const doneToday = day ? progress.dayCounts?.[day] ?? 0 : 0;
  const due = day ? dueQuestions(data.index, progress, day).length : 0;
  const dueCards = day ? Object.values(progress.cards).filter((c) => c.due <= day).length : 0;
  // Next unread note in curriculum order, skipping ones whose prerequisites are unread.
  const nextNotes = notes.filter((n) => !progress.read?.[n.slug] && n.prerequisites.every((p) => progress.read?.[p] || !notes.some((x) => x.slug === p))).slice(0, 3);
  const bookmarks = (progress.bookmarks ?? [])
    .map((k) => bookmarkLink(k, notes, data.patterns ?? [], data.mindmaps ?? []))
    .filter((b) => b !== null)
    .slice(0, 6);

  const g = useGamification(data.projectTasks);
  const days = streak(progress.activeDays);
  const week = day ? weekActivity(progress, day) : [];
  const weekMax = Math.max(1, ...week.map((d) => d.count));
  const weekTotal = week.reduce((s, d) => s + d.count, 0);
  const sqlSolved = data.index.filter((q) => progress.questions[q.number]?.solvedAt).length;
  const deNotes = notes.filter((n) => NOTE_CATEGORIES.find((c) => c.slug === n.category)?.group === "de");
  const deRead = deNotes.filter((n) => progress.read?.[n.slug]).length;
  const pyTotal = data.exercises?.length ?? 0;
  const pyDone = Object.keys(progress.lessons ?? {}).filter((k) => k.startsWith("py:")).length;
  const continueItem = progress.recent?.[0];
  const isNew = mounted && g.xp === 0 && !progress.recent?.length;
  const name = profile?.username;
  const [minutes, setMinutes] = useState<string[]>([]);
  useEffect(() => { setMinutes(activeMinutes()); return subscribeActivity(() => setMinutes(activeMinutes())); }, []);
  const time = day ? summarizeMinutes(minutes, new Date().toISOString().slice(0, 10)) : null;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-card border border-surface-border bg-surface-raised p-6 shadow-panel sm:p-8" aria-labelledby="welcome">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 right-40 h-60 w-60 rounded-full bg-secondary/10 blur-3xl" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-medium text-accent">{mounted && days > 0 ? `${days}-day streak · keep it going` : "Your learning hub"}</p>
            <h2 id="welcome" className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {name ? `Welcome back, ${name}` : isNew ? "Welcome to DataForge" : "Welcome back"}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              {isNew
                ? "Start with a lesson or a first SQL question. Your goal, streak and progress fill in from what you actually do."
                : "Everything below comes from your own activity on this device" + (name ? " and your synced account." : ".")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {continueItem ? (
                <ButtonLink to={continueItem.path}><Play className="h-4 w-4" aria-hidden /> Continue: {continueItem.title.length > 32 ? `${continueItem.title.slice(0, 32)}…` : continueItem.title}</ButtonLink>
              ) : (
                <ButtonLink to={data.lessons?.[0] ? `/learn/${data.lessons[0].slug}` : "/questions"}><Play className="h-4 w-4" aria-hidden /> Start the first lesson</ButtonLink>
              )}
              <ButtonLink to="/questions" variant="secondary">Practice SQL</ButtonLink>
              {!name && <ButtonLink to="/signup?next=/learn" variant="ghost">Sync across devices</ButtonLink>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ProgressRing value={doneToday} max={goal} size={96} label="Today's goal">
              <span className="block font-display text-xl font-bold text-ink tabular-nums">{mounted ? `${doneToday}/${goal}` : "—"}</span>
              <span className="block text-[10px] uppercase tracking-wider text-ink-faint">today</span>
            </ProgressRing>
            <div className="text-sm">
              <p className="font-semibold text-ink">Daily goal</p>
              <p className="text-xs text-ink-muted">Solves, reviews, notes and exercises</p>
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                Target
                <select value={goal} onChange={(e) => setDailyGoal(Number(e.target.value))} className="rounded-md border border-surface-border bg-surface px-1.5 py-1 text-ink">
                  {[1, 2, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} a day</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Flame} label="Streak" value={mounted ? `${days} day${days === 1 ? "" : "s"}` : "—"} hint={mounted ? `Longest ${g.longest} · days with learning` : "Days in a row with activity"} />
        <Link to="/achievements" className="block rounded-card focus-visible:outline-offset-4">
          <Card pad="sm" className="h-full transition duration-fast hover:border-accent/40">
            <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{g.level.name}</p><span className="rounded-lg bg-accent-dim p-1.5 text-accent"><Sparkles className="h-4 w-4" aria-hidden /></span></div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-ink">{mounted ? `${g.xp} XP` : "—"}</p>
            <ProgressBar className="mt-2" value={mounted ? Math.round(g.level.share * 100) : 0} max={100} label="Progress to next level" />
            <p className="mt-1 text-xs text-ink-muted">{g.level.next ? `${mounted ? g.level.toNext : "—"} XP to ${g.level.next.name}` : "Top level"}</p>
          </Card>
        </Link>
        <StatCard icon={Repeat} label="Due for review" value={mounted ? due + dueCards : "—"} hint={`${due} questions · ${dueCards} flashcards`} />
        <StatCard icon={CheckCircle2} label="SQL solved" value={mounted ? `${sqlSolved}/${data.index.length}` : "—"} hint="Includes solves imported from your repo" />
      </div>

      <DailyChallenge />
      <p className="-mt-2 text-sm"><Link to="/study-notes" className="font-semibold text-accent hover:underline">Visual study notes</Link> <span className="text-ink-muted">· turn what you have solved into a PDF study guide</span></p>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card as="section" className="lg:col-span-3">
          <SectionHeader title="This week" description={mounted ? `${weekTotal} learning action${weekTotal === 1 ? "" : "s"} in the last 7 days` : "Learning actions per day"} />
          {time && (
            <p className="-mt-2 mb-4 text-xs text-ink-muted" title="Minutes with keyboard, mouse or touch activity in a focused tab; idle time is not counted">
              Active time: <span className="font-semibold text-ink">{formatMinutes(time.todayMin)}</span> today · {formatMinutes(time.weekMin)} this week · {formatMinutes(time.totalMin)} total on this device
            </p>
          )}
          {mounted && weekTotal === 0 ? (
            <EmptyState icon={BarChart3} title="No activity this week yet">Solve a question, read a note or review flashcards and your week fills in here.</EmptyState>
          ) : (
            <ol className="flex h-40 items-end gap-2 sm:gap-3" aria-label="Learning actions per day, last 7 days">
              {(mounted ? week : Array.from({ length: 7 }, (_, i) => ({ day: String(i), count: 0 }))).map((d) => (
                <li key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                  <span className="text-xs font-semibold tabular-nums text-ink">{mounted && d.count ? d.count : ""}</span>
                  <span className={`w-full rounded-t-md transition-[height] duration-500 ${d.day === day ? "bg-gradient-to-t from-accent to-accent-muted" : "bg-accent/40"}`}
                    style={{ height: `${mounted ? Math.max(4, (d.count / weekMax) * 100) : 4}%` }} aria-hidden />
                  <span className="text-[11px] text-ink-faint">{mounted ? shortDay(d.day) : ""}</span>
                  <span className="sr-only">{mounted ? `${shortDay(d.day)}: ${d.count}` : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card as="section" className="lg:col-span-2">
          <SectionHeader title="Skills" description="Share of each area you've completed" />
          <ul className="space-y-4">
            {[
              { label: "SQL", detail: `${sqlSolved}/${data.index.length} questions`, value: sqlSolved, max: data.index.length, tone: "accent" as const, to: "/questions" },
              { label: "Python", detail: `${pyDone}/${pyTotal} exercises`, value: pyDone, max: pyTotal, tone: "secondary" as const, to: "/practice/python" },
              { label: "Data engineering", detail: `${deRead}/${deNotes.length} topics read`, value: deRead, max: deNotes.length, tone: "success" as const, to: "/data-engineering" },
            ].map((s) => (
              <li key={s.label}>
                <div className="mb-1.5 flex justify-between text-sm"><Link to={s.to} className="font-medium text-ink hover:text-accent">{s.label}</Link><span className="text-xs tabular-nums text-ink-muted">{mounted ? s.detail : ""}</span></div>
                <ProgressBar value={mounted ? s.value : 0} max={s.max || 1} label={`${s.label} progress`} tone={s.tone} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card as="section">
          <SectionHeader title="Recommended next" />
          {nextNotes.length ? (
            <ul className="space-y-2">
              {nextNotes.map((n) => (
                <li key={n.slug}>
                  <Link to={`/notes/${n.slug}`} className="group flex items-center justify-between gap-2 rounded-lg border border-surface-border px-3 py-2 hover:border-accent/40">
                    <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink group-hover:text-accent">{n.title}</span><span className="text-xs text-ink-faint">{n.difficulty} · {n.minutes} min</span></span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-muted">You've read every note. Try a <Link to="/mock-interview" className="text-accent underline">mock interview</Link>.</p>}
        </Card>
        <Card as="section">
          <SectionHeader title="Revision queue" action={<Link to="/review" className="text-sm font-medium text-accent hover:underline">Open</Link>} />
          {mounted && due + dueCards === 0 ? (
            <p className="text-sm text-ink-muted">Nothing due. Solved questions and flashcards come back here on a spaced schedule.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Link to="/review" className="rounded-lg bg-surface-overlay p-3 hover:ring-1 hover:ring-accent/40"><span className="block font-display text-2xl font-bold text-ink">{mounted ? due : "—"}</span><span className="text-xs text-ink-muted">questions</span></Link>
              <Link to="/flashcards" className="rounded-lg bg-surface-overlay p-3 hover:ring-1 hover:ring-accent/40"><span className="block font-display text-2xl font-bold text-ink">{mounted ? dueCards : "—"}</span><span className="text-xs text-ink-muted">flashcards</span></Link>
            </div>
          )}
        </Card>
        <Card as="section">
          <SectionHeader title="Bookmarks" />
          {mounted && bookmarks.length ? (
            <ul className="space-y-1.5 text-sm">{bookmarks.map((b) => <li key={b.path}><Link to={b.path} className="flex items-center gap-2 text-ink hover:text-accent"><Bookmark className="h-3.5 w-3.5 text-ink-faint" aria-hidden />{b.title}</Link></li>)}</ul>
          ) : <p className="text-sm text-ink-muted">Bookmark notes, patterns and mind maps to find them here.</p>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section">
          <SectionHeader title="Achievements" description={mounted ? `${g.achievements.filter((x) => x.unlocked).length} of ${g.achievements.length} unlocked` : "Unlocked from real activity"} action={<Link to="/achievements" className="text-sm font-medium text-accent hover:underline">All</Link>} />
          {mounted && g.achievements.some((x) => x.unlocked) ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.achievements.filter((x) => x.unlocked).sort((x, y) => (y.unlockedAt ?? "").localeCompare(x.unlockedAt ?? "")).slice(0, 4).map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-ink"><Trophy className="h-4 w-4 shrink-0 text-warn" aria-hidden /><span className="min-w-0"><span className="block truncate">{m.name}</span><span className="text-[11px] text-ink-faint">+{m.xp} XP</span></span></li>
              ))}
            </ul>
          ) : <EmptyState icon={Trophy} title="No achievements yet">Your first solved question unlocks "First SQL Query".</EmptyState>}
        </Card>
        <Card as="section">
          <SectionHeader title="Daily missions" description={g.weekRank ? `#${g.weekRank} this week · ${g.weekXp} XP` : `${mounted ? g.weekXp : 0} XP this week`} action={<Link to="/achievements" className="text-sm font-medium text-accent hover:underline">All missions</Link>} />
          <ul className="space-y-3">
            {g.missions.filter((m) => m.period === "day").slice(0, 4).map((m) => (
              <li key={m.id}>
                <div className="mb-1 flex justify-between text-sm"><span className={m.done ? "text-success" : "text-ink"}>{m.done ? "✓ " : ""}{m.label}</span><span className="text-xs tabular-nums text-ink-muted">{mounted ? m.value : 0}/{m.target} · +{m.xp}</span></div>
                <ProgressBar value={mounted ? m.value : 0} max={m.target} label={m.label} tone={m.done ? "success" : "accent"} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card as="section">
        <SectionHeader title="Concept progress" description="Notes read and questions solved per area" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NOTE_CATEGORIES.map((c) => {
            const group = notes.filter((n) => n.category === c.slug);
            const read = group.filter((n) => progress.read?.[n.slug]).length;
            const qs = [...new Set(group.flatMap((n) => n.questions))];
            const solved = qs.filter((q) => progress.questions[q]?.solvedAt).length;
            return (
              <li key={c.slug}>
                <Link to={c.group === "de" ? `/data-engineering#${c.slug}` : `/notes#cat-${c.slug}`} className="block text-sm hover:text-accent">
                  <span className="font-medium text-ink">{c.label}</span>
                  <span className="block text-xs text-ink-muted">{mounted ? read : 0}/{group.length} notes{qs.length ? ` · ${mounted ? solved : 0}/${qs.length} questions` : ""}</span>
                </Link>
                <ProgressBar className="mt-1.5" value={mounted ? read : 0} max={group.length || 1} label={`${c.label} notes read`} />
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => (
          <Link key={m.to} to={m.to} className="flex gap-3 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition duration-fast hover:-translate-y-0.5 hover:border-accent/40">
            <span className="rounded-lg bg-accent-dim p-2 text-accent"><m.icon className="h-4 w-4" aria-hidden /></span>
            <span><span className="block font-semibold text-ink">{m.label}</span><span className="block text-sm text-ink-muted">{m.desc}</span></span>
          </Link>
        ))}
      </div>

      <PracticeNext title="Practice your weak spots" />
    </div>
  );
}
