import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Brain, Code2, Database, FileText, FolderKanban, Layers, Play, Sparkles, Timer, Workflow } from "lucide-react";
import { usePage } from "../SiteApp";
import { ButtonLink, Card, Container, QuestionCard } from "../components/ui";
import { DailyChallenge } from "../components/DailyChallenge";
import { SITE_NAME, SITE_URL, Seo } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { PY_CATEGORIES } from "../lib/pyPractice";
import { PracticeNext } from "./ReviewPage";
import { BRAND } from "../../brand";

export function HomePage() {
  const { data } = usePage();
  const progress = useProgress();
  const solved = Object.values(progress.questions).filter((q) => q.solvedAt).length;
  const featured = [1, 25, 49, 83].map((n) => data.index.find((q) => q.number === n)).filter(Boolean);
  const pyCount = data.exercises?.length ?? 0;
  const projects = data.projects?.length ?? 0;
  const tracks = [
    { icon: Database, title: `${data.index.length} SQL questions`, body: `${data.topics.length} topics on a real PostgreSQL copy of Northwind, graded by result set.`, to: "/questions" },
    { icon: Code2, title: `${pyCount} Python problems`, body: "Data engineering work: parsing, cleaning, deduplication, incremental loads, retries, pipelines.", to: "/practice/python" },
    { icon: FolderKanban, title: `${projects} guided projects`, body: "End-to-end builds whose tasks are checked automatically.", to: "/projects-lab" },
    { icon: FileText, title: "Visual study notes", body: "PDFs of what you solved, with schema, query-flow and data-flow diagrams.", to: "/study-notes" },
  ];

  return (
    <>
      <Seo
        title={`${SITE_NAME} | Learn SQL & Data Engineering`}
        description={`${SITE_NAME} is an interactive SQL and data engineering learning platform: ${data.index.length} graded SQL questions on real PostgreSQL in your browser, Python, ETL, warehousing, Spark, Airflow and dbt tracks, and projects.`}
        path="/"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            alternateName: "SQL Practice Lab",
            description: BRAND.description,
            url: `${SITE_URL}/`,
          },
        ]}
      />

      <section className="relative overflow-hidden border-b border-surface-border">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgb(var(--color-accent)/0.16),transparent)]" aria-hidden />
        <Container className="relative py-16 sm:py-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-raised px-3 py-1 text-xs font-medium text-ink-muted">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden /> {BRAND.tagline}
          </p>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
          <div>
          <h1 className="max-w-3xl font-display text-4xl font-bold tracking-tight text-ink sm:text-6xl">
            Learn SQL and data engineering by building
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Practise SQL and Python on real data, right in your browser. PostgreSQL and Python run locally, every answer is graded, and the
            tracks take you through ETL, warehousing, Spark, Airflow, dbt and cloud. No install, and sign-up is optional.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink to={`/questions/${data.index[0]?.slug ?? ""}`} size="lg">
              <Play className="h-4 w-4" aria-hidden /> Start practicing
            </ButtonLink>
            <ButtonLink to="/questions" variant="secondary" size="lg">
              Browse SQL questions <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink to="/practice/python" variant="secondary" size="lg">
              Python for data engineering <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-ink-faint">SQL questions</dt>
              <dd className="font-display text-2xl font-bold tabular-nums text-ink">{data.index.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-ink-faint">Python problems</dt>
              <dd className="font-display text-2xl font-bold tabular-nums text-ink">{pyCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-ink-faint">{solved ? "You solved" : "Topics"}</dt>
              <dd className="font-display text-2xl font-bold tabular-nums text-ink">{solved || data.topics.length}</dd>
            </div>
          </dl>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1" aria-label="What you can practise">
            {tracks.map(({ icon: Icon, title, body, to }) => (
              <li key={to}>
                <Link to={to} className="group flex items-start gap-4 rounded-card border border-surface-border bg-surface-raised/80 p-4 shadow-panel backdrop-blur hover:border-accent/40">
                  <span className="rounded-xl bg-accent-dim p-2.5 text-accent"><Icon className="h-5 w-5" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-semibold text-ink group-hover:text-accent">{title} <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /></span>
                    <span className="mt-0.5 block text-sm text-ink-muted">{body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          </div>
        </Container>
      </section>

      <Container className="grid gap-4 pt-14 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <DailyChallenge />
        <Card>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            <Timer className="h-3.5 w-3.5" aria-hidden /> Mock interview
          </p>
          <p className="mt-2 font-display text-xl font-bold text-ink">5 questions. One timer. No hints.</p>
          <p className="mt-1 text-sm text-ink-muted">Simulate a real SQL screen, then review what you missed.</p>
          <Link to="/mock-interview" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
            Start a mock interview <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Card>
      </Container>

      <Container>
        <PracticeNext onlyIfStarted />
      </Container>

      <Container className="py-14">
        <h2 className="font-display text-2xl font-bold text-ink">Learn by topic</h2>
        <p className="mt-2 text-ink-muted">Questions build from simple aggregation up to multi-step analytics.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.topics.map((t, i) => (
            <Link
              key={t.slug}
              to={`/topics/${t.slug}`}
              // Phones show the first six; the rest are one tap away on the questions page.
              className={`${i >= 6 ? "hidden sm:flex" : "flex"} group items-center gap-4 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition duration-fast hover:-translate-y-0.5 hover:border-accent/40`}
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
        <Link to="/questions" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline sm:hidden">All {data.topics.length} topics <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </Container>

      <section aria-labelledby="python" className="border-t border-surface-border">
        <Container className="py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="python" className="font-display text-2xl font-bold text-ink">Python for data engineering</h2>
              <p className="mt-2 max-w-2xl text-ink-muted">{pyCount} problems built on real data work, graded by visible and hidden tests in your browser. No competitive-programming puzzles.</p>
            </div>
            <span className="flex flex-wrap gap-3 text-sm font-semibold">
              <Link to="/practice/python" className="text-accent hover:underline">All problems</Link>
              <Link to="/practice/python/assessment" className="text-accent hover:underline">Timed assessment</Link>
            </span>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PY_CATEGORIES.map((c) => {
              const n = data.exercises?.filter((e) => e.category === c.slug).length ?? 0;
              return (
                <Link key={c.slug} to="/practice/python" className="group flex items-center gap-4 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition duration-fast hover:-translate-y-0.5 hover:border-accent/40">
                  <span className="rounded-xl bg-accent-dim p-2.5 text-accent"><Workflow className="h-5 w-5" aria-hidden /></span>
                  <span>
                    <span className="block font-semibold text-ink group-hover:text-accent">{c.label}</span>
                    <span className="text-sm text-ink-muted">{n} problems</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </Container>
      </section>

      <section className="border-y border-surface-border bg-surface-raised/50">
        <Container className="grid gap-6 py-14 md:grid-cols-3">
          {[
            { icon: Layers, title: "Graded like an interview", body: "Your result set is compared with the expected one: columns, rows and ordering. Hints point at what is off without giving the answer away." },
            { icon: BookOpen, title: "The why, not just the what", body: "Each question explains the approach, the real mistakes made while solving it, and the follow-up questions interviewers ask next." },
            { icon: Brain, title: "Revise and keep notes", body: "Spaced-repetition flashcards, a revision list of what you got wrong, and PDF study notes of what you solved. Progress stays in your browser, or syncs when you sign in." },
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
