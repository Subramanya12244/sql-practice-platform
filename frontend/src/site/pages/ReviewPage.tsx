import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Sparkles } from "lucide-react";
import { usePage } from "../SiteApp";
import { InlineMarkdown, Markdown } from "../components/Markdown";
import { Button, ButtonLink, Container, Difficulty, PageHeader, QuestionCard, Skeleton, StatCard } from "../components/ui";
import { Seo } from "../lib/seo";
import { HelpTooltip } from "../help/HelpTooltip";
import { loadQuestion } from "../lib/data";
import { reviewQuestion, today, toggleRevisionMark, useProgress } from "../lib/progress";
import { RULES, improvement, revisionQueue, revisionStats, splitQueue, stage } from "../lib/revision";
import { practiceNext, topicScores } from "../lib/insights";
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
  const [kind, setKind] = useState<"" | "sql" | "python">("");
  const [mark, setMark] = useState("");
  const queue = day ? revisionQueue(data.index, data.exercises ?? [], progress, day).filter((i) => !kind || i.kind === kind) : [];
  const parts = day ? splitQueue(queue, day) : { overdue: [], today: [], upcoming: [] };
  const dueNow = [...parts.overdue, ...parts.today];
  const dueCards = day ? Object.values(progress.cards).filter((c) => c.due <= day).length : 0;
  const [current, setCurrent] = useState<Question | null>(null);
  const [outcome, setOutcome] = useState<boolean | null>(null);
  const concepts = [...new Set([...data.index.flatMap((q) => [q.topicLabel, ...q.concepts]), ...(data.exercises ?? []).flatMap((e) => e.concepts)])].sort();

  const startSql = (slug: string) => { setOutcome(null); void loadQuestion(slug).then(setCurrent); };
  const done = () => { setCurrent(null); setOutcome(null); };

  return (
    <Container>
      <Seo title="Review queue" description="Rule-based revision of the SQL questions and Python problems you have worked on." path="/review" noindex />
      <PageHeader eyebrow="Spaced repetition" title="Review queue"
        intro="Problems come back on a fixed schedule based on how you did. Re-solve them from memory: the schedule moves on with each outcome." />

      <details className="mb-4 rounded-card border border-surface-border bg-surface-raised p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-ink">How the schedule works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
          <li>Gaps between reviews: <strong className="text-ink">{RULES.ladder.join(" → ")} days</strong>. A clean review moves a problem up one step.</li>
          <li>Wrong submit or failed check: back to <strong className="text-ink">{RULES.incorrectDays} day</strong>.</li>
          <li>Correct but with help (a hint from level {RULES.helpHintLevel}, {RULES.manyAttempts}+ attempts, or slow: SQL over {RULES.slowMinutes} minutes, Python {RULES.slowFailedChecks}+ failed checks): the <strong className="text-ink">same gap</strong> again.</li>
          <li>Correct, fast (within half your goal time) after {RULES.skipAfterClean} clean answers in a row: skips a step.</li>
          <li>Correct {RULES.masteredAfter} times in a row: marked mastered. The longest gap is <strong className="text-ink">{RULES.masteredDays} days</strong>.</li>
          <li>Concepts you mark below put their problems in today's queue.</li>
        </ul>
      </details>

      {day && (() => {
        const st = revisionStats(progress.revision, day);
        const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
        return (
          <section aria-label="Revision statistics" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Reviews this week" value={st.week.reviews} hint={st.all.reviews ? `${st.all.reviews} in total` : "none yet"} />
            <StatCard label="Remembered" value={pct(st.week.correct, st.week.reviews)} hint="this week" />
            <StatCard label="On time" value={pct(st.week.onTime, st.week.reviews)} hint="done by the due day" />
            <StatCard label="Mastered" value={st.mastered} hint={`${st.byStage.reduce((a, b) => a + b, 0)} scheduled`} />
          </section>
        );
      })()}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <HelpTooltip id="revision-queue" label="What is the revision queue?" />
        {[["Overdue", parts.overdue.length, "text-danger"], ["Due today", parts.today.length, "text-ink"], ["Upcoming", parts.upcoming.length, "text-ink-muted"]].map(([label, n, tone]) => (
          <span key={label as string} className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2"><strong className={tone as string}>{day ? n : "—"}</strong> {label}</span>
        ))}
        <Link to="/flashcards" className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2 hover:border-accent"><strong className="text-ink">{dueCards}</strong> flashcards due →</Link>
        <select aria-label="Language" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="ml-auto rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-ink">
          <option value="">SQL and Python</option><option value="sql">SQL</option><option value="python">Python</option>
        </select>
      </div>

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
                <p className="font-semibold text-ink">{outcome ? "Remembered: scheduled further out." : `Not quite: it comes back in ${RULES.incorrectDays} day.`}</p>
                {!outcome && <Markdown source={"```sql\n" + current.solution + "\n```"} className="mt-2" />}
                <button type="button" onClick={done} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Back to the queue
                </button>
              </div>
            )}
          </article>
          <div className="min-w-0">
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel key={current.slug} question={current} fresh onSolved={(r) => { if (outcome !== null) return; reviewQuestion(current.number, r.correct); setOutcome(r.correct); }} />
            </Suspense>
            {outcome === null && (
              <button type="button" className="mt-3 text-sm text-ink-muted underline hover:text-ink" onClick={() => { reviewQuestion(current.number, false); setOutcome(false); }}>
                I don't remember: show the answer
              </button>
            )}
          </div>
        </div>
      )}

      {!current && day && (
        <div className="mt-6 space-y-6">
          {!queue.length && <div className="rounded-card border border-surface-border bg-surface-raised p-6 text-center"><p className="font-semibold text-ink">Nothing scheduled yet.</p><p className="mt-1 text-sm text-ink-muted">Problems join the queue when you submit or check them, or when you mark a concept below.</p></div>}
          {([["Overdue", parts.overdue], ["Due today", parts.today], ["Upcoming", parts.upcoming.slice(0, 30)]] as const).map(([label, items]) => items.length > 0 && (
            <section key={label} aria-label={label}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-faint">{label} ({items.length})</h2>
              <ul className="divide-y divide-surface-border overflow-hidden rounded-card border border-surface-border bg-surface-raised">
                {items.map((i) => {
                  const imp = i.item ? improvement(i.item) : null;
                  return (
                    <li key={i.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="w-14 shrink-0 text-xs uppercase tracking-wider text-ink-faint">{i.kind}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{i.title}</span>
                        <span className="block text-xs text-ink-muted">
                          {i.item ? `${stage(i.item)} · next in ${i.item.interval} day${i.item.interval === 1 ? "" : "s"}` : i.manual ? "marked concept" : "solved earlier"}
                          {imp && imp.after > 0 && ` · since the first miss: ${imp.correctAfter}/${imp.after} correct`}
                        </span>
                      </span>
                      {i.item && <span className="flex gap-0.5" aria-label={`Recent outcomes: ${i.item.history.map((h) => (h.ok ? "correct" : "incorrect")).join(", ")}`}>{i.item.history.slice(-8).map((h, k) => <span key={k} className={`h-2 w-2 rounded-full ${h.ok ? "bg-success" : "bg-danger"}`} />)}</span>}
                      <span className="w-20 shrink-0 text-right text-xs text-ink-faint">{i.due === day ? "today" : i.due}</span>
                      {label !== "Upcoming" && (i.kind === "sql"
                        ? <Button size="sm" variant="secondary" onClick={() => startSql((i.ref as { slug: string }).slug)}>Re-solve</Button>
                        : <ButtonLink size="sm" variant="secondary" to={i.path}>Open</ButtonLink>)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <section aria-label="Marked concepts" className="rounded-card border border-surface-border bg-surface-raised p-4">
            <h2 className="text-sm font-semibold text-ink">Concepts to revise</h2>
            <p className="text-xs text-ink-muted">Marked concepts put every problem that uses them into today's queue until you unmark them.</p>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (mark.trim()) { toggleRevisionMark(mark); setMark(""); } }}>
              <input list="concepts" value={mark} onChange={(e) => setMark(e.target.value)} placeholder="e.g. Window Functions, LEFT JOIN, generators" aria-label="Concept to revise"
                className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink" />
              <datalist id="concepts">{concepts.map((c) => <option key={c} value={c} />)}</datalist>
              <Button size="sm" type="submit">Mark</Button>
            </form>
            {(progress.revisionMarks ?? []).length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">{progress.revisionMarks!.map((m) => <li key={m}><button type="button" onClick={() => toggleRevisionMark(m)} className="rounded-full border border-accent/40 bg-accent-dim px-2 py-0.5 text-xs text-accent" aria-label={`Unmark ${m}`}>{m} ×</button></li>)}</ul>
            )}
          </section>
        </div>
      )}

      {!current && dueNow.length === 0 && <PracticeNext />}
    </Container>
  );
}
