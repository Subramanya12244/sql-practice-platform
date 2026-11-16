import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  CheckCircle2,
  Code2,
  Database,
  Flame,
  FolderKanban,
  Play,
  RotateCcw,
  Timer,
} from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, ButtonLink, Card, Container, ProgressBar } from "../components/ui";
import { Reveal } from "../components/Motion";
import { HeroPipeline } from "../components/home/HeroPipeline";
import { DailyResume, FeaturedTools, LearningDomains, LearningJourney } from "../components/home/HomeSections";
import { dailyResume } from "../lib/dailyResume";
import { projectActivity } from "../lib/dashboardModel";
import { getProjectProgress } from "../lib/projects";
import { CURRICULUM, dayHref, isAuthored } from "../lib/daily";
import { useDaily } from "../lib/useDaily";
import { DailyChallenge } from "../components/DailyChallenge";
import { SITE_NAME, SITE_URL, Seo } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { readStats, type PyStat } from "../lib/pyPractice";
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
  const dailyView = useDaily();
  const daily = dailyResume(dailyView);
  const startHref = daily.target && isAuthored(daily.target.id) ? dayHref(daily.target) : "/daily";
  const [stats, setStats] = useState<Record<string, PyStat>>({});

  useEffect(() => {
    setStats(readStats());
  }, []);

  const todayIso = new Date().toISOString().slice(0, 10);
  const pyCount = data.exercises?.length ?? 0;
  const projects = data.projects?.length ?? 0;

  // Dashboard metrics derived from local storage & progress
  const recSql = getRecommendedNextSql(data.index, progress);
  const recPy = getRecommendedNextPython(data.exercises ?? [], progress, stats);
  const activeProj = getActiveProject(data.projects ?? [], (data.projectTasks ?? []) as never);
  const mistakes = getFrequentMistakes(progress);
  const recentCompletions = getRecentCompletions(progress, data.index, data.exercises ?? []);
  const activityWeek = weekActivity(progress, todayIso);
  const maxActivity = Math.max(1, ...activityWeek.map((d) => d.count));
  const weekTotal = activityWeek.reduce((sum, d) => sum + d.count, 0);

  // Completed guided projects, read from local progress after mount (the prerendered page has none).
  const [completedProjectsCount, setCompletedProjects] = useState(0);
  useEffect(() => {
    setCompletedProjects(projectActivity(data.projects ?? [], data.projectTasks ?? [], getProjectProgress).completed.length);
  }, [data.projects, data.projectTasks]);

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
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgb(var(--color-accent)/0.14),transparent)]" aria-hidden />
        <div className="hero-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
        <Container className="relative py-14 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
            <div className="stagger">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-raised px-3 py-1 text-xs font-medium text-ink-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> SQL · Python · Analytics · Data Engineering
              </p>
              <h1 className="max-w-3xl font-display text-display text-ink">Become a Data Professional.</h1>
              <p className="mt-5 max-w-2xl text-lead text-ink-muted">
                Learn SQL, Python, analytics and data engineering through interactive lessons, real-world projects and hands-on practice.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink to={startHref} size="lg">
                  <Play className="h-4 w-4" aria-hidden /> {daily.started ? "Continue learning" : "Start Learning"}
                </ButtonLink>
                <ButtonLink to="/daily" variant="secondary" size="lg">
                  Explore Curriculum <ArrowRight className="h-4 w-4" aria-hidden />
                </ButtonLink>
              </div>
              <dl className="mt-10 grid max-w-xl grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {[
                  [String(CURRICULUM.days.length), "daily lessons"],
                  [String(data.index.length), "SQL questions"],
                  [String(pyCount), "Python problems"],
                  [String(projects), "guided projects"],
                ].map(([n, label]) => (
                  <div key={label}>
                    <dd className="font-display text-2xl font-bold tabular-nums text-ink">{n}</dd>
                    <dt className="text-xs text-ink-faint">{label}</dt>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-ink-faint">PostgreSQL and Python run in your browser. No install; sign-up is optional.</p>
            </div>
            <div className="animate-fade-up [animation-delay:120ms]"><HeroPipeline /></div>
          </div>
        </Container>
      </section>


      {/* ── Personalized Learning Dashboard / Continue Learning ── */}
      <Reveal>
        <section aria-labelledby="continue-learning" className="border-b border-surface-border bg-surface/50 py-10">
          <Container>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-label uppercase text-accent">{summary.hasActivity || daily.started ? "Welcome back" : "Your next steps"}</p>
                <h2 id="continue-learning" className="mt-2 font-display text-h2 text-ink">
                  {summary.hasActivity || daily.started ? "Continue your learning" : "Where to start"}
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
                <DailyResume view={dailyView} />
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

      <LearningDomains />
      <LearningJourney />
      <FeaturedTools />

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

    </>
  );
}
