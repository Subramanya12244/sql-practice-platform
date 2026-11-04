import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { usePage } from "../SiteApp";
import { Markdown } from "../components/Markdown";
import { InlineMarkdown } from "../components/Markdown";
import { Chip, Container, PageHeader, QuestionCard, Skeleton } from "../components/ui";
import { Seo, breadcrumbs, canonical } from "../lib/seo";
import { useProgress } from "../lib/progress";
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
        intro={`${lessons.length} lessons and ${totalEx} graded exercises on the Northwind database. You have passed ${doneEx} of ${totalEx}.`}
      />
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
