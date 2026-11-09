import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  BookOpen,
  Brain,
  CheckCircle2,
  Code2,
  Database,
  FileText,
  Flame,
  FolderKanban,
  Layers,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
  Workflow,
} from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, ButtonLink, Card, Container, ProgressBar, QuestionCard } from "../components/ui";
import { CountUp, Reveal } from "../components/Motion";
import { DailyChallenge } from "../components/DailyChallenge";
import { SITE_NAME, SITE_URL, Seo } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { PY_CATEGORIES, readStats, type PyStat } from "../lib/pyPractice";
import { BRAND } from "../../brand";
import {
  getActiveProject,
  getFrequentMistakes,
  getOverallProgressSummary,
  getRecentCompletions,
  getRecommendedNextPython,
  getRecommendedNextSql,
  weekActivity,
} from "../lib/dashboard";

export function HomePage() {
  const { data } = usePage();
  const progress = useProgress();
  const [stats, setStats] = useState<Record<string, PyStat>>({});

  useEffect(() => {
    setStats(readStats());
  }, []);

  const todayIso = new Date().toISOString().slice(0, 10);
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

  // Dashboard metrics derived from local storage & progress
  const recSql = getRecommendedNextSql(data.index, progress);
  const recPy = getRecommendedNextPython(data.exercises ?? [], progress, stats);
  const activeProj = getActiveProject(data.projects ?? [], (data.projectTasks ?? []) as never);
  const mistakes = getFrequentMistakes(progress);
  const recentCompletions = getRecentCompletions(progress, data.index, data.exercises ?? []);
  const activityWeek = weekActivity(progress, todayIso);
  const maxActivity = Math.max(1, ...activityWeek.map((d) => d.count));
  const weekTotal = activityWeek.reduce((sum, d) => sum + d.count, 0);

  const completedProjectsCount = (data.projects ?? []).filter((p) => {
    const pt = data.projectTasks?.find((x) => x.slug === p.slug);
    if (!pt) return false;
    const automated = pt.tasks.filter((t) => t.type !== "checklist");
    // Project status will be evaluated when user interacts
    return automated.length > 0 && false;
  }).length;

  const summary = getOverallProgressSummary(
    progress,
    data.index.length,
    pyCount,
    projects,
    completedProjectsCount,
  );

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
        <div className="hero-gradient pointer-events-none absolute inset-0 animate-gradient-pan opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden />
        <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 animate-float rounded-full bg-[radial-gradient(circle,rgb(var(--color-accent)/0.18),transparent_70%)]" aria-hidden />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 animate-float-slow rounded-full bg-[radial-gradient(circle,rgb(var(--color-secondary)/0.16),transparent_70%)] [animation-delay:-4s]" aria-hidden />
        <Container className="relative py-14 sm:py-20">
          <p className="mb-4 inline-flex animate-fade-in items-center gap-2 rounded-full border border-surface-border bg-surface-raised px-3 py-1 text-xs font-medium text-ink-muted">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden /> {BRAND.tagline}
          </p>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
            <div className="stagger">
              <h1 className="max-w-3xl font-display text-4xl font-bold tracking-tight text-ink sm:text-6xl">
                Learn SQL and data engineering by building
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
                Practise SQL and Python on real data, right in your browser. PostgreSQL and Python run locally, every answer is graded, and the
                tracks take you through ETL, warehousing, Spark, Airflow, dbt and cloud. No install, and sign-up is optional.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink to={recSql ? `/questions/${recSql.question.slug}` : `/questions/${data.index[0]?.slug ?? ""}`} size="lg">
                  <Play className="h-4 w-4" aria-hidden /> {recSql?.reason === "resume" ? "Resume SQL" : "Start practicing"}
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
                  <dd className="font-display text-2xl font-bold tabular-nums text-ink"><CountUp value={solved || data.topics.length} /></dd>
                </div>
              </dl>
            </div>
            <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-1 [&>*:nth-child(1)]:[animation-delay:200ms] [&>*:nth-child(2)]:[animation-delay:260ms] [&>*:nth-child(3)]:[animation-delay:320ms] [&>*:nth-child(4)]:[animation-delay:380ms]" aria-label="What you can practise">
              {tracks.map(({ icon: Icon, title, body, to }) => (
                <li key={to}>
                  <Link to={to} className="group flex items-start gap-4 rounded-card border border-surface-border bg-surface-raised/80 p-4 shadow-panel backdrop-blur hover:border-accent/40">
                    <span className="rounded-xl bg-accent-dim p-2.5 text-accent"><Icon className="h-5 w-5" aria-hidden /></span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 font-semibold text-ink group-hover:text-accent">{title} <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition duration-base ease-out group-hover:translate-x-0 group-hover:opacity-100" aria-hidden /></span>
                      <span className="mt-0.5 block text-sm text-ink-muted">{body}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* ── Personalized Learning Dashboard / Continue Learning ── */}
      <Reveal>
        <section aria-labelledby="continue-learning" className="border-b border-surface-border bg-surface/50 py-10">
          <Container>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> Personalized Learning Mission Control
                </p>
                <h2 id="continue-learning" className="mt-1 font-display text-2xl font-bold text-ink">
                  {summary.hasActivity ? "Continue your learning" : "Jump straight into practice"}
                </h2>
              </div>
              <div className="flex items-center gap-3">
                {summary.streakDays > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-dim px-3 py-1 text-xs font-semibold text-warn">
                    <Flame className="h-4 w-4 fill-warn" aria-hidden /> {summary.streakDays} day streak
                  </span>
                )}
                <span className="rounded-full border border-surface-border bg-surface-raised px-3 py-1 text-xs font-medium text-ink-muted">
                  SQL: <strong className="text-ink">{summary.sqlSolved}/{summary.sqlTotal}</strong> · Python: <strong className="text-ink">{summary.pyPassed}/{summary.pyTotal}</strong>
                </span>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
              {/* Left Column: Immediate Next Actions */}
              <div className="space-y-4">
                {/* Recommended SQL */}
                {recSql && (
                  <Card pad="md" className="transition hover:border-accent/40">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="rounded-lg bg-accent-dim p-2 text-accent">
                          <Database className="h-4 w-4" aria-hidden />
                        </span>
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                            Recommended SQL Question
                          </span>
                          <h3 className="font-semibold text-ink">
                            Q{recSql.question.number} · {recSql.question.title}
                          </h3>
                        </div>
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge tone={recSql.reason === "resume" ? "warn" : "accent"}>
                          {recSql.reason === "resume" ? "In Progress" : "Next In Track"}
                        </Badge>
                        <Badge>{recSql.question.difficulty}</Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-ink-muted">{recSql.detail}</p>
                    <div className="mt-4 flex items-center justify-between gap-4">
                      <span className="text-xs text-ink-faint">Topic: {recSql.question.topicLabel}</span>
                      <ButtonLink to={`/questions/${recSql.question.slug}`} size="sm">
                        {recSql.reason === "resume" ? <RotateCcw className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        {recSql.reason === "resume" ? "Resume Attempt" : "Solve Question"}
                      </ButtonLink>
                    </div>
                  </Card>
                )}

                {/* Recommended Python */}
                {recPy && (
                  <Card pad="md" className="transition hover:border-accent/40">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="rounded-lg bg-emerald-500/10 p-2 text-emerald-500">
                          <Code2 className="h-4 w-4" aria-hidden />
                        </span>
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                            Recommended Python Problem
                          </span>
                          <h3 className="font-semibold text-ink">
                            {recPy.exercise.code} · {recPy.exercise.title}
                          </h3>
                        </div>
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge tone="accent">Stage {recPy.stage}</Badge>
                        <Badge>{recPy.exercise.difficulty}</Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-ink-muted">
                      {recPy.detail} — <span className="font-medium text-ink">{recPy.stageName}</span>
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-4">
                      <span className="text-xs text-ink-faint">Time est: ~{recPy.exercise.minutes} min</span>
                      <ButtonLink to={`/practice/python/${recPy.exercise.slug}`} size="sm" variant="secondary">
                        <Play className="h-3.5 w-3.5 mr-1" /> Open Workspace
                      </ButtonLink>
                    </div>
                  </Card>
                )}

                {/* Active Project Widget */}
                {activeProj && (
                  <Card pad="md" className="border-accent/30 bg-surface-raised">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="rounded-lg bg-indigo-500/10 p-2 text-indigo-500">
                          <FolderKanban className="h-4 w-4" aria-hidden />
                        </span>
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                            Active Project
                          </span>
                          <h3 className="font-semibold text-ink">{activeProj.project.title}</h3>
                        </div>
                      </span>
                      <Badge tone="accent">{activeProj.project.level}</Badge>
                    </div>
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-ink-muted">
                        <span>Automated check progress</span>
                        <span className="font-medium text-ink">
                          {activeProj.passedAutomated}/{activeProj.totalAutomated} checks passed ({activeProj.percent}%)
                        </span>
                      </div>
                      <ProgressBar className="mt-1.5" value={activeProj.passedAutomated} max={activeProj.totalAutomated || 1} label="Project checks" tone="accent" />
                    </div>
                    {activeProj.pendingTask && (
                      <p className="mt-2 text-xs text-ink-muted">
                        Next pending task: <strong className="text-ink">{activeProj.pendingTask.title}</strong>
                      </p>
                    )}
                    <div className="mt-3 text-right">
                      <ButtonLink to={`/projects-lab/${activeProj.project.slug}`} size="sm">
                        Continue Project <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </ButtonLink>
                    </div>
                  </Card>
                )}
              </div>

              {/* Right Column: Weekly Activity, Mistakes & Recents */}
              <div className="space-y-4">
                {/* 7-Day Activity Sparkline / Meter */}
                <Card pad="md">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                      <BarChart2 className="h-3.5 w-3.5 text-accent" aria-hidden /> 7-Day Activity
                    </span>
                    <span className="text-xs text-ink-muted">{weekTotal} actions this week</span>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-1.5 h-20 pt-2 border-b border-surface-border">
                    {activityWeek.map((d) => {
                      const dayName = new Date(d.day + "T00:00:00").toLocaleDateString("en-US", { weekday: "narrow" });
                      const heightPercent = d.count > 0 ? Math.max(15, Math.round((d.count / maxActivity) * 100)) : 6;
                      return (
                        <div key={d.day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                          <div
                            className={`w-full rounded-t transition-all ${
                              d.count > 0 ? "bg-accent group-hover:brightness-110" : "bg-surface-soft"
                            }`}
                            style={{ height: `${heightPercent}%` }}
                            title={`${d.day}: ${d.count} action${d.count === 1 ? "" : "s"}`}
                          />
                          <span className="text-[10px] text-ink-faint">{dayName}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-ink-faint">
                    Solves, practice attempts, and test checks save automatically to your browser.
                  </p>
                </Card>

                {/* Frequent Mistakes / Error Patterns */}
                {mistakes.length > 0 && (
                  <Card pad="md" className="border-warn/30 bg-warn/5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-warn">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Areas To Review
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Common query patterns that triggered mismatches in your recent submissions:
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs text-ink">
                      {mistakes.map((m) => (
                        <li key={m.errorKind} className="flex items-center justify-between rounded bg-surface/80 px-2 py-1">
                          <span className="font-mono text-ink">{m.errorKind}</span>
                          <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-ink-muted">
                            {m.count}x
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {/* Recently Completed Exercises */}
                {recentCompletions.length > 0 && (
                  <Card pad="md">
                    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden /> Recently Solved
                    </span>
                    <ul className="mt-2 divide-y divide-surface-border text-xs">
                      {recentCompletions.map((item) => (
                        <li key={item.slug} className="py-2 first:pt-0 last:pb-0">
                          <Link
                            to={item.kind === "sql" ? `/questions/${item.slug}` : `/practice/python/${item.slug}`}
                            className="flex items-center justify-between gap-2 hover:text-accent"
                          >
                            <span className="truncate font-medium text-ink">
                              <span className="text-ink-faint mr-1">{item.id}</span>
                              {item.title}
                            </span>
                            <span className="shrink-0 text-[10px] text-ink-faint">
                              {new Date(item.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            </div>
          </Container>
        </section>
      </Reveal>

      {/* Daily Challenge & Mock Interview */}
      <Reveal>
        <Container className="grid gap-4 pt-10 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
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
      </Reveal>

      {/* Topic browsing */}
      <Reveal>
        <Container className="py-14">
          <h2 className="font-display text-2xl font-bold text-ink">Learn by topic</h2>
          <p className="mt-2 text-ink-muted">Questions build from simple aggregation up to multi-step analytics.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.topics.map((t, i) => (
              <Link
                key={t.slug}
                to={`/topics/${t.slug}`}
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
          <Link to="/questions" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline sm:hidden">
            All {data.topics.length} topics <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Container>
      </Reveal>

      {/* Python for data engineering */}
      <Reveal>
        <section aria-labelledby="python" className="border-t border-surface-border">
          <Container className="py-14">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="python" className="font-display text-2xl font-bold text-ink">Python for data engineering</h2>
                <p className="mt-2 max-w-2xl text-ink-muted">
                  {pyCount} problems across 14 pedagogical stages built on real data work, graded by visible and hidden tests in your browser.
                </p>
              </div>
              <span className="flex flex-wrap gap-3 text-sm font-semibold">
                <Link to="/practice/python" className="text-accent hover:underline">All 14 Stages</Link>
                <Link to="/practice/python/assessment" className="text-accent hover:underline">Timed assessment</Link>
              </span>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PY_CATEGORIES.map((c) => {
                const n = data.exercises?.filter((e) => e.category === c.slug).length ?? 0;
                return (
                  <Link
                    key={c.slug}
                    to="/practice/python"
                    className="group flex items-center gap-4 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel transition duration-fast hover:-translate-y-0.5 hover:border-accent/40"
                  >
                    <span className="rounded-xl bg-accent-dim p-2.5 text-accent">
                      <Workflow className="h-5 w-5" aria-hidden />
                    </span>
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
      </Reveal>

      {/* Feature highlights */}
      <Reveal>
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
      </Reveal>

      {/* Popular questions */}
      <Reveal>
        <Container className="py-14">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-2xl font-bold text-ink">Popular questions</h2>
            <Link to="/questions" className="text-sm font-medium text-accent hover:underline">See all</Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {featured.map((q) => q && <QuestionCard key={q.slug} q={q} solved={!!progress.questions[q.number]?.solvedAt} />)}
          </div>
        </Container>
      </Reveal>
    </>
  );
}
