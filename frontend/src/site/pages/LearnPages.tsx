import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { InlineMarkdown } from "../components/Markdown";
import { Chip, Container, PageHeader, QuestionCard, Skeleton } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { setDailyGoal, today, useProgress } from "../lib/progress";
import { dueQuestions } from "../lib/insights";
import { NOTE_CATEGORIES } from "../lib/learning";
import { PracticeNext } from "./ReviewPage";
import { BookOpen, Bookmark, Brain, Network, Puzzle, Repeat, Target, Zap } from "lucide-react";
import { useEffect } from "react";
import type { Lesson, LessonExercise, Question } from "../types";

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
      provider: { "@type": "Organization", name: "SQL Practice Lab", sameAs: canonical("/") },
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
        eyebrow="Learning path"
        title="Learn SQL, start to finish"
        intro={`Theory, visual maps, patterns, practice and revision in one place. ${lessons.length} lessons and ${totalEx} graded exercises — you've passed ${doneEx}.`}
      />
      <LearnDashboard />
      <h2 className="mt-12 font-display text-2xl font-bold text-ink" id="roadmap">Learning roadmap</h2>
      <p className="mt-1 text-sm text-ink-muted">Hands-on lessons in order. Each ends with exercises graded in your browser.</p>
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
                      className="block h-full rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition-colors hover:border-accent"
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

/** Personal panel on /learn: goal, continue, recommendations, revision, bookmarks, topic progress. */
function LearnDashboard() {
  const { data } = usePage();
  const progress = useProgress();
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(today()), []);
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
    .slice(0, 8);
  const card = "rounded-card border border-surface-border bg-surface-raised p-4";

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => (
          <Link key={m.to} to={m.to} className={`${card} flex gap-3 hover:border-accent/40`}>
            <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span><span className="block font-semibold text-ink">{m.label}</span><span className="block text-sm text-ink-muted">{m.desc}</span></span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={card} aria-labelledby="goal">
          <h2 id="goal" className="flex items-center gap-2 font-semibold text-ink"><Target className="h-4 w-4 text-accent" aria-hidden /> Today's goal</h2>
          <p className="mt-2 text-sm text-ink-muted">{doneToday} of {goal} learning actions (solves, reviews, notes, exercises)</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-soft" aria-hidden>
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, (100 * doneToday) / goal)}%` }} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
            Daily goal
            <select value={goal} onChange={(e) => setDailyGoal(Number(e.target.value))} className="rounded border border-surface-border bg-surface px-1 py-0.5 text-ink">
              {[1, 2, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </section>

        <section className={card} aria-labelledby="revision">
          <h2 id="revision" className="flex items-center gap-2 font-semibold text-ink"><Repeat className="h-4 w-4 text-accent" aria-hidden /> Revision queue</h2>
          <p className="mt-2 text-sm text-ink-muted">{due} questions and {dueCards} flashcards due.</p>
          <div className="mt-3 flex gap-3 text-sm">
            <Link to="/review" className="font-medium text-accent hover:underline">Review questions →</Link>
            <Link to="/flashcards" className="font-medium text-accent hover:underline">Flashcards →</Link>
          </div>
        </section>

        <section className={card} aria-labelledby="continue">
          <h2 id="continue" className="flex items-center gap-2 font-semibold text-ink"><Brain className="h-4 w-4 text-accent" aria-hidden /> Recommended next</h2>
          {nextNotes.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {nextNotes.map((n) => <li key={n.slug}><Link to={`/notes/${n.slug}`} className="text-accent hover:underline">{n.title}</Link> <span className="text-xs text-ink-muted">· {n.difficulty}</span></li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-muted">You've read every note — try a mock interview.</p>}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-labelledby="recent">
          <h2 id="recent" className="font-semibold text-ink">Recently viewed</h2>
          {progress.recent?.length ? (
            <ul className="mt-2 space-y-1 text-sm">{progress.recent.slice(0, 6).map((r) => <li key={r.key}><Link to={r.path} className="text-accent hover:underline">{r.title}</Link></li>)}</ul>
          ) : <p className="mt-2 text-sm text-ink-muted">Pages you open will show up here.</p>}
        </section>
        <section className={card} aria-labelledby="bookmarks">
          <h2 id="bookmarks" className="flex items-center gap-2 font-semibold text-ink"><Bookmark className="h-4 w-4 text-accent" aria-hidden /> Bookmarks</h2>
          {bookmarks.length ? (
            <ul className="mt-2 space-y-1 text-sm">{bookmarks.map((b) => <li key={b.path}><Link to={b.path} className="text-accent hover:underline">{b.title}</Link></li>)}</ul>
          ) : <p className="mt-2 text-sm text-ink-muted">Bookmark notes, patterns and maps to find them here.</p>}
        </section>
      </div>

      <section className={card} aria-labelledby="concepts-progress">
        <h2 id="concepts-progress" className="font-semibold text-ink">Concept progress</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {NOTE_CATEGORIES.map((c) => {
            const group = notes.filter((n) => n.category === c.slug);
            const read = group.filter((n) => progress.read?.[n.slug]).length;
            const qs = [...new Set(group.flatMap((n) => n.questions))];
            const solved = qs.filter((q) => progress.questions[q]?.solvedAt).length;
            return (
              <li key={c.slug}>
                <Link to={`/notes#cat-${c.slug}`} className="block text-sm hover:underline">
                  <span className="font-medium text-ink">{c.label}</span>
                  <span className="block text-xs text-ink-muted">{read}/{group.length} notes · {solved}/{qs.length} questions</span>
                </Link>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-soft" aria-hidden>
                  <div className="h-full bg-accent" style={{ width: `${group.length ? (100 * read) / group.length : 0}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <PracticeNext title="Practice your weak spots" />
    </div>
  );
}
