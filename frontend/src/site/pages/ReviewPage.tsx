import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Sparkles } from "lucide-react";
import { usePage } from "../SiteApp";
import { InlineMarkdown, Markdown } from "../components/Markdown";
import { Container, Difficulty, PageHeader, QuestionCard, Skeleton } from "../components/ui";
import { Seo } from "../lib/seo";
import { loadQuestion } from "../lib/data";
import { reviewQuestion, today, useProgress } from "../lib/progress";
import { dueQuestions, practiceNext, topicScores } from "../lib/insights";
import type { Question } from "../types";

const PracticePanel = lazy(() => import("../components/PracticePanel"));

/** "Practice next" cards from the weakest topics; shared with Home and Progress. */
export function PracticeNext({ title = "Practice next", onlyIfStarted = false }: { title?: string; onlyIfStarted?: boolean }) {
  const { data } = usePage();
  const progress = useProgress();
  const picks = practiceNext(data.index, data.topics, progress);
  const weakest = topicScores(data.index, data.topics, progress)
    .filter((s) => s.attempts > 0 && s.solved < s.total)
    .sort((a, b) => b.weakness - a.weakness)[0];
  if (!picks.length || (onlyIfStarted && !Object.keys(progress.questions).length)) return null;
  return (
    <section aria-labelledby="practice-next" className="mt-10">
      <h2 id="practice-next" className="flex items-center gap-2 font-display text-xl font-bold text-ink">
        <Sparkles className="h-5 w-5 text-accent" aria-hidden /> {title}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        {weakest ? `Picked from your weakest topics — ${weakest.label} needs the most work.` : "A starting mix across topics."}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {picks.map((q) => <QuestionCard key={q.slug} q={q} />)}
      </div>
    </section>
  );
}

export function ReviewPage() {
  const { data } = usePage();
  const progress = useProgress();
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(today()), []);
  const due = day ? dueQuestions(data.index, progress, day) : [];
  const dueCards = day ? Object.values(progress.cards).filter((c) => c.due <= day).length : 0;
  const [current, setCurrent] = useState<Question | null>(null);
  const [outcome, setOutcome] = useState<boolean | null>(null);
  const nextSlug = due[0]?.slug;

  useEffect(() => {
    if (!current && nextSlug) loadQuestion(nextSlug).then(setCurrent);
  }, [current, nextSlug]);

  const done = () => {
    setCurrent(null);
    setOutcome(null);
  };

  return (
    <Container>
      <Seo title="Review queue" description="Spaced-repetition review of SQL questions you have solved." path="/review" noindex />
      <PageHeader
        eyebrow="Spaced repetition"
        title="Review queue"
        intro="Re-solve questions from memory. Get it right and it comes back later; miss it and it comes back tomorrow."
      />
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2">
          <strong className="text-ink">{due.length}</strong> questions due
        </span>
        <Link to="/flashcards" className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2 hover:border-accent">
          <strong className="text-ink">{dueCards}</strong> flashcards due →
        </Link>
      </div>

      {day && !due.length && (
        <div className="mt-8 rounded-card border border-surface-border bg-surface-raised p-6 text-center">
          <p className="font-semibold text-ink">Nothing due right now.</p>
          <p className="mt-1 text-sm text-ink-muted">Solved questions come back 3 days after you solve them.</p>
        </div>
      )}

      {current && (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <article className="min-w-0">
            <p className="text-sm text-ink-faint">Q{current.number} · {current.topicLabel}</p>
            <h2 className="mt-1 font-display text-2xl font-bold text-ink">{current.title}</h2>
            <div className="mt-2"><Difficulty level={current.difficulty} /></div>
            <Markdown source={current.problem} className="mt-4" />
            {current.objective && (
              <p className="mt-4 rounded-lg border-l-4 border-accent bg-accent-dim px-4 py-3 text-sm text-ink">
                <strong>Task:</strong> <InlineMarkdown source={current.objective} />
              </p>
            )}
            {outcome !== null && (
              <div className={`mt-6 rounded-card border p-4 text-sm ${outcome ? "border-success/30 bg-success-dim" : "border-danger/30 bg-danger-dim"}`}>
                <p className="font-semibold text-ink">{outcome ? "Remembered — scheduled further out." : "Not quite — it comes back tomorrow."}</p>
                {!outcome && <Markdown source={"```sql\n" + current.solution + "\n```"} className="mt-2" />}
                <button type="button" onClick={done} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Next
                </button>
              </div>
            )}
          </article>
          <div className="min-w-0">
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel
                key={current.slug}
                question={current}
                fresh
                onSolved={(r) => {
                  if (outcome !== null) return;
                  reviewQuestion(current.number, r.correct);
                  setOutcome(r.correct);
                }}
              />
            </Suspense>
            {outcome === null && (
              <button type="button" className="mt-3 text-sm text-ink-muted underline hover:text-ink" onClick={() => { reviewQuestion(current.number, false); setOutcome(false); }}>
                I don't remember — show the answer
              </button>
            )}
          </div>
        </div>
      )}

      <PracticeNext />
    </Container>
  );
}
