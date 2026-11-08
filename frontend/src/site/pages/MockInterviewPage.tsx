import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Clock, Flag, Timer, XCircle } from "lucide-react";
import { usePage } from "../SiteApp";
import { InlineMarkdown, Markdown } from "../components/Markdown";
import { SchemaPanel } from "../components/SchemaPanel";
import { Badge, Button, Card, Container, Difficulty, PageHeader, RadioCard, SegmentedProgress, Skeleton, StatCard } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { loadQuestion } from "../lib/data";
import { recordMock, useProgress } from "../lib/progress";
import {
  MOCK_SIZE,
  formatClock,
  loadMock,
  mockScore,
  pickMockQuestions,
  remainingSec,
  saveMock,
  type MockLevel,
  type MockSession,
} from "../lib/mock";
import type { Question } from "../types";
import type { SubmitResult } from "../../types";

const PracticePanel = lazy(() => import("../components/PracticePanel"));

export function MockInterviewPage() {
  const { data } = usePage();
  const [session, setSession] = useState<MockSession | null>(null);
  const [restored, setRestored] = useState(false);

  // Resume an unfinished session after a reload (browser only).
  useEffect(() => {
    setSession(loadMock());
    setRestored(true);
  }, []);

  const update = useCallback((next: MockSession | null) => {
    setSession(next);
    saveMock(next);
  }, []);

  return (
    <Container>
      <Seo
        title="SQL Mock Interview — 5 Timed Questions"
        description="Practice a timed SQL interview: 5 random questions on joins, aggregation, CTEs, window functions and dates, graded instantly in your browser. Free, no sign-up."
        path="/mock-interview"
        jsonLd={[breadcrumbs([{ name: "Home", path: "/" }, { name: "Mock interview", path: "/mock-interview" }])]}
      />
      {!restored ? (
        <Skeleton className="mt-10 h-64" />
      ) : !session ? (
        <MockSetup onStart={(level, durationMin) =>
          update({
            slugs: pickMockQuestions(data.index, level),
            level,
            durationMin,
            startedAt: Date.now(),
            current: 0,
            results: {},
          })
        } />
      ) : session.finishedAt ? (
        <MockSummary session={session} onAgain={() => update(null)} />
      ) : (
        <MockRunner session={session} onChange={update} />
      )}
    </Container>
  );
}

function MockSetup({ onStart }: { onStart: (level: MockLevel, durationMin: number) => void }) {
  const progress = useProgress();
  const [level, setLevel] = useState<MockLevel>("balanced");
  const [duration, setDuration] = useState(30);
  const history = [...(progress.mocks ?? [])].reverse().slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="Interview mode"
        title="SQL mock interview"
        intro={`${MOCK_SIZE} random questions against the clock. No hints or solutions until you finish — just like the real thing.`}
      />
      <Card pad="none" className="max-w-xl space-y-6 p-6">
        <div>
          <p id="mock-level" className="text-sm font-semibold text-ink">Difficulty</p>
          <div role="radiogroup" aria-labelledby="mock-level" className="mt-2 grid gap-2 sm:grid-cols-3">
            {([["easier", "Warm-up"], ["balanced", "Balanced"], ["harder", "Senior"]] as const).map(([v, label]) => (
              <RadioCard key={v} name="mock-level" value={v} checked={level === v} onChange={() => setLevel(v)} title={label} />
            ))}
          </div>
        </div>
        <div>
          <p id="mock-time" className="text-sm font-semibold text-ink">Time limit</p>
          <div role="radiogroup" aria-labelledby="mock-time" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[20, 30, 45, 60].map((m) => (
              <RadioCard key={m} name="mock-time" value={String(m)} checked={duration === m} onChange={() => setDuration(m)} title={`${m} min`} />
            ))}
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-ink-muted">
          <li>{MOCK_SIZE} random questions, graded instantly in your browser.</li>
          <li>No hints or solutions until you finish.</li>
          <li>The interview finishes automatically when time runs out.</li>
        </ul>
        <Button size="lg" onClick={() => onStart(level, duration)}>
          <Timer className="h-4 w-4" aria-hidden /> Start interview
        </Button>
      </Card>

      {history.length > 0 && (
        <section className="mt-10 max-w-xl" aria-labelledby="past">
          <h2 id="past" className="font-display text-lg font-bold text-ink">Recent mock interviews</h2>
          <ul className="mt-3 divide-y divide-surface-border rounded-card border border-surface-border">
            {history.map((m) => (
              <li key={m.date} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-ink-muted">{new Date(m.date).toLocaleDateString()}</span>
                <span className="font-semibold text-ink">{m.solved}/{m.total} solved</span>
                <span className="text-ink-faint">{formatClock(m.usedSec)} of {m.durationMin}:00</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function MockRunner({ session, onChange }: { session: MockSession; onChange: (s: MockSession) => void }) {
  const { data } = usePage();
  const [questions, setQuestions] = useState<Record<string, Question>>({});
  const [left, setLeft] = useState(() => remainingSec(session));
  const slug = session.slugs[session.current];
  const q = questions[slug];

  useEffect(() => {
    Promise.all(session.slugs.map((s) => loadQuestion(s))).then((qs) =>
      setQuestions(Object.fromEntries(qs.map((x) => [x.slug, x]))),
    );
  }, [session.slugs]);

  const finish = useCallback(
    (s: MockSession) => {
      const done = { ...s, finishedAt: Date.now() };
      const score = mockScore(done);
      recordMock({ solved: score.solved, total: score.total, usedSec: score.usedSec, durationMin: s.durationMin });
      onChange(done);
    },
    [onChange],
  );

  useEffect(() => {
    const t = setInterval(() => {
      const sec = remainingSec(session);
      setLeft(sec);
      if (sec === 0) finish(session);
    }, 1000);
    return () => clearInterval(t);
  }, [session, finish]);

  const onSubmitted = (r: SubmitResult) => {
    const prev = session.results[slug] ?? { attempts: 0, correct: false };
    onChange({
      ...session,
      results: {
        ...session.results,
        [slug]: {
          attempts: prev.attempts + 1,
          correct: prev.correct || r.correct,
          solvedAfterSec: prev.solvedAfterSec ?? (r.correct ? Math.round((Date.now() - session.startedAt) / 1000) : undefined),
        },
      },
    });
  };

  const go = (i: number) => onChange({ ...session, current: i });

  return (
    <div className="pt-6">
      <div className="sticky top-14 z-30 -mx-4 flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border">
        <span role="timer" aria-live="off" aria-label={`${Math.floor(left / 60)} minutes left`}>
          <Badge tone={left < 300 ? "warn" : "neutral"} className="px-3 py-1 font-mono text-base font-bold"><Clock className="h-4 w-4" aria-hidden /> {formatClock(left)}</Badge>
        </span>
        <nav className="flex gap-1.5" aria-label="Interview questions">
          {session.slugs.map((s, i) => {
            const r = session.results[s];
            const Icon = r?.correct ? CheckCircle2 : r?.attempts ? XCircle : Circle;
            return (
              <button key={s} type="button" onClick={() => go(i)} aria-current={i === session.current ? "step" : undefined}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm ${i === session.current ? "bg-accent-dim font-semibold text-accent" : "text-ink-muted hover:bg-hover/5"}`}>
                <Icon className={`h-3.5 w-3.5 ${r?.correct ? "text-success" : r?.attempts ? "text-warn" : ""}`} aria-hidden /> {i + 1}
              </button>
            );
          })}
        </nav>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => window.confirm("Finish the interview now?") && finish(session)}>
          <Flag className="h-4 w-4" aria-hidden /> Finish
        </Button>
        <SegmentedProgress className="w-full basis-full" done={session.slugs.filter((s) => session.results[s]?.correct).length} total={session.slugs.length} label="Questions solved" />
      </div>

      {!q ? (
        <Skeleton className="mt-6 h-96" />
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <article key={q.slug} className="min-w-0 animate-fade-in">
            <p className="text-xs text-ink-faint">Question {session.current + 1} of {session.slugs.length}</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-ink">{q.title}</h1>
            <div className="mt-2"><Difficulty level={q.difficulty} /></div>
            <Markdown source={q.problem} className="mt-4" />
            {q.objective && (
              <p className="mt-4 rounded-lg border-l-4 border-accent bg-accent-dim px-4 py-3 text-sm text-ink">
                <strong>Task:</strong> <InlineMarkdown source={q.objective} />
              </p>
            )}
            {q.expectedOutput && <Markdown source={q.expectedOutput} className="mt-4 text-sm" />}
            {data.schema && <div className="mt-6"><SchemaPanel schema={data.schema} highlight={q.tables} /></div>}
          </article>
          <div className="min-w-0 lg:sticky lg:top-36 lg:self-start">
            <Suspense fallback={<Skeleton className="h-[580px]" />}>
              <PracticePanel key={q.slug} question={q} onSolved={onSubmitted} fresh />
            </Suspense>
            <div className="mt-3 flex justify-between text-sm">
              <button type="button" disabled={session.current === 0} onClick={() => go(session.current - 1)} className="text-ink-muted hover:text-ink disabled:opacity-40">← Previous</button>
              {session.current < session.slugs.length - 1 ? (
                <button type="button" onClick={() => go(session.current + 1)} className="font-medium text-accent hover:underline">Next question →</button>
              ) : (
                <button type="button" onClick={() => finish(session)} className="font-medium text-accent hover:underline">Finish interview</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MockSummary({ session, onAgain }: { session: MockSession; onAgain: () => void }) {
  const { data } = usePage();
  const { solved, total, usedSec } = mockScore(session);
  const verdict = solved === total ? "Interview-ready on this set." : solved >= total - 1 ? "Strong — review the one you missed." : "Review the missed questions, then try again.";
  return (
    <>
      <PageHeader eyebrow="Mock interview complete" title={`${solved} of ${total} solved`} intro={`${verdict} Time used: ${formatClock(usedSec)} of ${session.durationMin}:00.`} />
      <div className="stagger mb-6 grid max-w-2xl grid-cols-3 gap-3">
        <StatCard label="Score" value={`${Math.round((solved / Math.max(1, total)) * 100)}%`} />
        <StatCard label="Time" value={formatClock(usedSec)} hint={`of ${session.durationMin}:00`} />
        <StatCard label="Correct" value={`${solved}/${total}`} />
      </div>
      <ul className="max-w-2xl divide-y divide-surface-border rounded-card border border-surface-border bg-surface-raised">
        {session.slugs.map((slug, i) => {
          const meta = data.index.find((x) => x.slug === slug);
          const r = session.results[slug];
          return (
            <li key={slug} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              {r?.correct ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Solved" /> : <XCircle className="h-4 w-4 text-danger" aria-label="Not solved" />}
              <span className="text-ink-faint">{i + 1}.</span>
              <Link to={`/questions/${slug}`} className="font-medium text-ink hover:text-accent">{meta?.title ?? slug}</Link>
              {meta && <Difficulty level={meta.difficulty} />}
              <Badge tone={r?.correct ? "success" : "danger"}>{r?.correct ? "Solved" : "Not solved"}</Badge>
              <span className="ml-auto text-ink-faint">
                {r?.attempts ?? 0} attempt{r?.attempts === 1 ? "" : "s"}{r?.solvedAfterSec != null ? ` · solved at ${formatClock(r.solvedAfterSec)}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-ink-muted">Open a question to see its solution, the common traps and interview follow-ups.</p>
      <Button size="lg" className="mt-6" onClick={onAgain}>
        <Timer className="h-4 w-4" aria-hidden /> New mock interview
      </Button>
    </>
  );
}
