import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Brain, CalendarDays, Layers, Play, Sparkles, Timer } from "lucide-react";
import { usePage } from "../SiteApp";
import { Container, QuestionCard, Skeleton } from "../components/ui";
import { SITE_NAME, SITE_URL, Seo } from "../lib/seo";
import { today, useProgress } from "../lib/progress";

/** Same question for everyone on a given UTC day. */
function dailyPick<T>(items: T[], day: string): T | undefined {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return items[h % items.length];
}

function DailyChallenge() {
  const { data } = usePage();
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(today()), []);
  const q = day ? dailyPick(data.index, day) : undefined;
  return (
    <div className="rounded-card border border-accent/30 bg-accent-dim p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Today's challenge
      </p>
      {q ? (
        <>
          <Link to={`/questions/${q.slug}`} className="mt-2 block font-display text-xl font-bold text-ink hover:text-accent">
            Q{q.number} · {q.title}
          </Link>
          <p className="mt-1 text-sm text-ink-muted">{q.topicLabel} · {q.difficulty}</p>
          <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{q.problemShort}</p>
        </>
      ) : (
        <Skeleton className="mt-3 h-16" />
      )}
    </div>
  );
}

export function HomePage() {
  const { data } = usePage();
  const progress = useProgress();
  const solved = Object.values(progress.questions).filter((q) => q.solvedAt).length;
  const featured = [1, 25, 49, 83].map((n) => data.index.find((q) => q.number === n)).filter(Boolean);
  const traps = data.index.filter((q) => q.hadMistakes).length;

  return (
    <>
      <Seo
        title={`${SITE_NAME} — Free SQL Interview Practice with Real Postgres`}
        description={`Practice ${data.index.length} SQL interview questions on Northwind: joins, GROUP BY, CTEs, window functions and dates, graded instantly in your browser. Free, no sign-up.`}
        path="/"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            url: `${SITE_URL}/`,
          },
        ]}
      />

      <section className="relative overflow-hidden border-b border-surface-border">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgb(var(--color-accent)/0.16),transparent)]" aria-hidden />
        <Container className="relative py-16 sm:py-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-raised px-3 py-1 text-xs font-medium text-ink-muted">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden /> Real PostgreSQL, running in your browser
          </p>
          <h1 className="max-w-3xl font-display text-4xl font-bold tracking-tight text-ink sm:text-6xl">
            Practice SQL interview questions that actually get asked
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            {data.index.length} business-style problems on the Northwind database, from aggregations and joins to window functions and date analysis.
            Write a query, run it, and get graded instantly — with the approach, the common traps, and interview follow-ups for every question.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to={`/questions/${data.index[0]?.slug ?? ""}`}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-white shadow-glow transition-transform duration-fast hover:-translate-y-0.5"
            >
              <Play className="h-4 w-4" aria-hidden /> Start practicing
            </Link>
            <Link
              to="/questions"
              className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-raised px-5 py-3 font-semibold text-ink hover:border-accent/40"
            >
              Browse all questions <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-4 text-center sm:text-left">
            <div>
              <dt className="text-xs uppercase tracking-wider text-ink-faint">Questions</dt>
              <dd className="font-display text-2xl font-bold text-ink">{data.index.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-ink-faint">Topics</dt>
              <dd className="font-display text-2xl font-bold text-ink">{data.topics.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-ink-faint">{solved ? "You solved" : "Traps explained"}</dt>
              <dd className="font-display text-2xl font-bold text-ink">{solved || traps}</dd>
            </div>
          </dl>
        </Container>
      </section>

      <Container className="grid gap-4 pt-14 md:grid-cols-2">
        <DailyChallenge />
        <div className="rounded-card border border-surface-border bg-surface-raised p-5 shadow-panel">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            <Timer className="h-3.5 w-3.5" aria-hidden /> Mock interview
          </p>
          <p className="mt-2 font-display text-xl font-bold text-ink">5 questions. One timer. No hints.</p>
          <p className="mt-1 text-sm text-ink-muted">Simulate a real SQL screen, then review what you missed.</p>
          <Link to="/mock-interview" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
            Start a mock interview <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </Container>

      <Container className="py-14">
        <h2 className="font-display text-2xl font-bold text-ink">Learn by topic</h2>
        <p className="mt-2 text-ink-muted">Questions build from simple aggregation up to multi-step analytics.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.topics.map((t, i) => (
            <Link
              key={t.slug}
              to={`/topics/${t.slug}`}
              className="group flex items-center gap-4 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel hover:border-accent/40"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-dim font-mono text-sm font-bold text-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="block font-semibold text-ink group-hover:text-accent">{t.label}</span>
                <span className="text-sm text-ink-muted">{t.questions.length} questions</span>
              </span>
            </Link>
          ))}
        </div>
      </Container>

      <section className="border-y border-surface-border bg-surface-raised/50">
        <Container className="grid gap-6 py-14 md:grid-cols-3">
          {[
            { icon: Layers, title: "Graded like an interview", body: "Your result set is compared with the expected one: columns, rows and ordering. Hints point at what is off without giving the answer away." },
            { icon: BookOpen, title: "The why, not just the what", body: "Each question explains the approach, the real mistakes made while solving it, and the follow-up questions interviewers ask next." },
            { icon: Brain, title: "Revise with flashcards", body: "Spaced-repetition flashcards for all questions, with the traps first. Progress stays in your browser." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="h-6 w-6 text-accent" aria-hidden />
              <h3 className="mt-3 font-semibold text-ink">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
            </div>
          ))}
        </Container>
      </section>

      <Container className="py-14">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-2xl font-bold text-ink">Popular questions</h2>
          <Link to="/questions" className="text-sm font-medium text-accent hover:underline">See all</Link>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {featured.map((q) => q && <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
        </div>
      </Container>
    </>
  );
}
