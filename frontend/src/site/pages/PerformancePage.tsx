import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Clock, Flame, Target, Timer, Trophy } from "lucide-react";
import { usePage } from "../SiteApp";
import { Badge, ButtonLink, Card, Container, EmptyState, ErrorState, PageHeader, ProgressBar, SectionHeader, Skeleton, StatCard } from "../components/ui";
import { Seo } from "../lib/seo";
import { today, useProgress } from "../lib/progress";
import { readStats, type PyStat } from "../lib/pyPractice";
import { dueQuestions } from "../lib/insights";
import { formatDuration } from "../lib/solveSessions";
import { groupMastery, heatmap, overall, streaks, topicRows, weeklySeconds, type MasteryLevel, type TopicRow } from "../lib/solveAnalytics";
import { generateInsights, recommendations, type ProjectState } from "../lib/learningInsights";
import { getProjectProgress } from "../lib/projects";
import { HelpTooltip } from "../help/HelpTooltip";

const LEVEL: Record<MasteryLevel, { label: string; tone: "success" | "accent" | "warn" | "neutral" }> = {
  strong: { label: "Strong", tone: "success" },
  developing: { label: "Developing", tone: "accent" },
  "needs-practice": { label: "Needs practice", tone: "warn" },
  "not-started": { label: "Not started", tone: "neutral" },
};
const CELL = ["bg-surface-soft", "bg-accent/25", "bg-accent/50", "bg-accent/75", "bg-accent"];
const n = (v: number | null, f: (x: number) => string = String) => (v === null ? "—" : f(v));
const hours = (sec: number) => (sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);

function TopicList({ title, rows, empty, compact = false }: { title: string; rows: TopicRow[]; empty: string; compact?: boolean }) {
  return (
    <Card pad="md" as="section" aria-label={title}>
      <h3 className="text-sm font-semibold text-ink">{title} <span className="font-normal text-ink-faint">({rows.length})</span></h3>
      {!rows.length ? <p className="mt-2 text-sm text-ink-muted">{empty}</p> : compact ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {rows.map((r) => <li key={`${r.kind}:${r.topic}`} className="rounded-full border border-surface-border px-2.5 py-0.5 text-xs text-ink-muted" title={`${r.total} ${r.kind === "sql" ? "questions" : "problems"}`}>{r.label} <span className="text-ink-faint">· {r.kind === "sql" ? "SQL" : "Py"}</span></li>)}
        </ul>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={`${r.kind}:${r.topic}`} className="rounded-lg border border-surface-border p-2.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">{r.label} <span className="text-xs font-normal text-ink-faint">· {r.kind === "sql" ? "SQL" : "Python"}</span></span>
                <span className="shrink-0 text-xs tabular-nums text-ink-muted">{r.solved}/{r.total}</span>
              </div>
              {r.score !== null && <ProgressBar className="mt-1.5" value={r.score} label={`${r.label} strength ${r.score} out of 100`} tone={r.level === "strong" ? "success" : r.level === "needs-practice" ? "secondary" : "accent"} />}
              <details className="mt-1.5 text-xs text-ink-muted">
                <summary className="cursor-pointer text-ink-faint hover:text-ink">Why {r.level === "strong" ? "strong" : r.level === "needs-practice" ? "needs practice" : r.level === "not-started" ? "not started" : "developing"}?</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">{r.reasons.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Heatmap({ sessions }: { sessions: ReturnType<typeof useProgress>["sessions"] }) {
  const t = today();
  const list = sessions ?? [];
  const h = useMemo(() => heatmap(list, t, 26), [list, t]);
  const st = useMemo(() => streaks(list, t), [list, t]);
  const weeks = useMemo(() => weeklySeconds(list, t, 8), [list, t]);
  const maxW = Math.max(1, ...weeks.map((w) => w.sec));
  return (
    <Card pad="md" as="section" aria-label="Practice activity">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Practice time" value={hours(h.total)} hint="last 26 weeks" icon={Clock} />
        <StatCard label="Current streak" value={`${st.current} day${st.current === 1 ? "" : "s"}`} hint="through today" icon={Flame} />
        <StatCard label="Longest streak" value={`${st.longest} day${st.longest === 1 ? "" : "s"}`} icon={Trophy} />
        <StatCard label="Days practised" value={st.activeDays} hint="days with a timed session" icon={Target} />
      </div>
      <div className="mt-4 overflow-x-auto pb-1">
        <div role="group" aria-label="Daily practice heatmap, oldest week on the left" className="flex w-max gap-[3px]">
          {h.columns.map((col, c) => (
            <div key={c} className="flex flex-col gap-[3px]">
              {col.map((d, r) => d
                ? <span key={r} title={`${d.day}: ${d.sec ? formatDuration(d.sec) : "no practice"}`} aria-label={`${d.day}: ${d.sec ? formatDuration(d.sec) : "no practice"}`} role="img" className={`h-3 w-3 rounded-[3px] ${CELL[d.level]}`} />
                : <span key={r} className="h-3 w-3" aria-hidden />)}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-faint">
        <span>Built from timed practice sessions, not page visits. Days are UTC. Rest days are fine: nothing here counts against you.</span>
        <span className="inline-flex items-center gap-1" aria-hidden>Less {CELL.map((c, i) => <span key={i} className={`h-3 w-3 rounded-[3px] ${c}`} />)} More</span>
      </div>
      <div className="mt-4" role="group" aria-label="Practice time per week">
        <p className="text-xs font-medium text-ink-muted">Weekly practice</p>
        <div className="mt-1.5 flex h-24 gap-1.5">
          {weeks.map((w) => (
            <div key={w.week} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`Week of ${w.week}: ${w.sec ? formatDuration(w.sec) : "none"}`}>
              <div className="flex min-h-0 w-full flex-1 items-end">
                <div className="w-full rounded-t bg-accent" style={{ height: `${Math.max(w.sec ? 8 : 3, (w.sec / maxW) * 100)}%`, opacity: w.sec ? 0.8 : 0.25 }} />
              </div>
              <span className="text-[10px] text-ink-faint">{w.week}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function PerformancePage() {
  const { data } = usePage();
  const progress = useProgress();
  const [mounted, setMounted] = useState(false);
  const [pyStats, setPyStats] = useState<Record<string, PyStat>>({});
  useEffect(() => { setMounted(true); setPyStats(readStats()); }, []);
  const sessions = progress.sessions ?? [];
  const index = data.index ?? [];
  const exercises = data.exercises ?? [];

  const calc = useMemo(() => {
    if (!mounted || !index.length) return null;
    const inputs = { index, exercises, progress, pyStats, sessions };
    const rows = topicRows(inputs);
    const inputs2 = { ...inputs, today: today() };
    const projectState: Record<string, ProjectState> = {};
    for (const p of data.projects ?? []) {
      const prog = getProjectProgress(p.slug);
      const auto = (data.projectTasks?.find((x) => x.slug === p.slug)?.tasks ?? []).filter((t) => t.type !== "checklist");
      const passed = auto.filter((t) => prog.tasks[t.id]?.passed).length;
      projectState[p.slug] = auto.length && passed === auto.length ? "Completed" : passed > 0 || Object.keys(prog.checklist).length ? "In progress" : "Not started";
    }
    return {
      o: overall(sessions), rows, groups: groupMastery(rows),
      insights: generateInsights(inputs2),
      recs: recommendations({ ...inputs2, dueSql: dueQuestions(index, progress, today()), projects: data.projects ?? [], projectState }),
    };
  }, [mounted, index, exercises, progress, pyStats, sessions, data.projects, data.projectTasks]);

  return (
    <Container>
      <Seo title="Performance analytics" description="Your solve times, attempts, topic strength and practice activity on DataForge." path="/analytics" noindex />
      <PageHeader eyebrow="Dashboard" title="Performance analytics" intro="How you practise, built from the timer that starts when you open a challenge. Time is active time: paused time and idle tabs are not counted." />
      {!index.length ? (
        <ErrorState title="Analytics could not load">The question list is unavailable. Reload the page to try again.</ErrorState>
      ) : !calc ? (
        <div className="grid gap-3 sm:grid-cols-3" aria-busy="true" aria-label="Loading analytics">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="space-y-8">
          {!sessions.length && (
            <EmptyState icon={Timer} title="No timed sessions yet"
              action={<ButtonLink to="/questions" variant="primary" size="sm">Start a SQL question</ButtonLink>}>
              Open any SQL or Python challenge: the timer starts by itself and your first solve fills this page. Topic strength below already uses what you solved before.
            </EmptyState>
          )}

          <section data-help="analytics-overall" aria-labelledby="overall"><SectionHeader id="overall" title="Overall" description="From timed sessions on this device and your account." />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Active learning time" value={n(sessions.length ? calc.o.totalActiveSec : null, formatDuration)} icon={Clock} />
              <StatCard label="Challenges attempted" value={calc.o.attempted} hint={`${calc.o.sessions} session${calc.o.sessions === 1 ? "" : "s"}`} icon={BarChart3} />
              <StatCard label="Challenges completed" value={calc.o.completed} icon={Trophy} />
              <StatCard label="Success rate" value={n(calc.o.successRate, (x) => `${x}%`)} hint="completed of attempted" icon={Target} />
              <StatCard label="Average solve time" value={n(calc.o.avgSolveSec, formatDuration)} hint={<HelpTooltip id="solve-time" label="What is solve time?" />} />
              <StatCard label="Fastest solve" value={n(calc.o.fastest?.sec ?? null, formatDuration)} hint={calc.o.fastest ? calc.o.fastest.ref.replace("sql:", "Q").replace("py:", "") : undefined} />
              <StatCard label="Attempts per solve" value={n(calc.o.avgAttemptsPerSolve)} hint="average, lower is cleaner" />
            </div>
          </section>

          <section data-help="analytics-activity" aria-labelledby="activity"><SectionHeader id="activity" title="Activity" /><Heatmap sessions={progress.sessions} /></section>

          {calc.insights.length > 0 && (
            <section aria-labelledby="insights"><SectionHeader id="insights" title="What your records say" description="Short observations, each with what it is based on. They appear only when there is enough data." />
              <ul className="space-y-2">
                {calc.insights.map((x) => (
                  <li key={x.id}><Card pad="md" className={x.severity === "warn" ? "border-warn/40" : ""}>
                    <p className="text-sm font-medium text-ink">{x.text}</p>
                    <p className="mt-0.5 text-xs text-ink-muted"><span className="font-medium">Based on: </span>{x.evidence}</p>
                    {x.action && <Link to={x.action.path} className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline">{x.action.label}</Link>}
                  </Card></li>
                ))}
              </ul>
            </section>
          )}

          <section data-help="analytics-strength" aria-labelledby="strength"><SectionHeader id="strength" title="Topic strength" description="Based on what you completed (harder questions count more), recent results, attempts per solve and hints used. Speed is never part of it." action={<HelpTooltip id="topic-strength" label="How is topic strength worked out?" />} />
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <TopicList title="Strong topics" rows={calc.groups.strong} empty="None yet. Solving a few questions in a topic without hints makes it strong." />
              <TopicList title="Needs practice" rows={calc.groups.needsPractice} empty="Nothing is struggling right now." />
              <TopicList title="Developing" rows={calc.groups.developing} empty="No topics in progress." />
              <TopicList title="Not started" rows={calc.groups.notStarted} empty="You have touched every topic." compact />
            </div>
          </section>

          <section data-help="analytics-recommended" aria-labelledby="recs"><SectionHeader id="recs" title="Recommended next" description="Chosen from weak topics, missed questions, due revisions, the Python stage you are in, and a project or mock interview when you are ready." />
            {calc.recs.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {calc.recs.map((r) => (
                  <li key={r.path}><Card pad="md" interactive>
                    <div className="flex items-center gap-2"><Badge tone={r.kind === "sql" ? "accent" : "neutral"}>{r.kind === "sql" ? "SQL" : "Python"}</Badge><span className="text-xs text-ink-faint">{r.difficulty}</span></div>
                    <Link to={r.path} className="mt-1 block font-semibold text-ink hover:text-accent">{r.title}</Link>
                    <p className="mt-1 text-sm text-ink-muted"><span className="font-medium text-ink">Why: </span>{r.reason}</p>
                  </Card></li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-muted">You are caught up. Pick any topic to keep going.</p>}
          </section>

          <section data-help="analytics-by-topic" aria-labelledby="bytopic"><SectionHeader id="bytopic" title="By topic" description="Time and results per curriculum topic (SQL topics and Python categories)." />
            <div className="overflow-x-auto rounded-card border border-surface-border">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Practice time and results by topic</caption>
                <thead className="bg-surface-overlay text-xs text-ink-faint"><tr>
                  <th scope="col" className="px-3 py-2 font-medium">Topic</th><th scope="col" className="px-3 py-2 font-medium">Solved</th>
                  <th scope="col" className="px-3 py-2 font-medium">Sessions</th><th scope="col" className="px-3 py-2 font-medium">Time</th>
                  <th scope="col" className="px-3 py-2 font-medium">Avg solve</th><th scope="col" className="px-3 py-2 font-medium">Strength</th>
                </tr></thead>
                <tbody>
                  {calc.rows.map((r) => (
                    <tr key={`${r.kind}:${r.topic}`} className="border-t border-surface-border">
                      <th scope="row" className="px-3 py-2 font-medium text-ink">{r.label} <span className="text-xs font-normal text-ink-faint">{r.kind === "sql" ? "SQL" : "Python"}</span></th>
                      <td className="px-3 py-2 tabular-nums">{r.solved}/{r.total}</td>
                      <td className="px-3 py-2 tabular-nums">{r.sessions || "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{r.activeSec ? formatDuration(r.activeSec) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{n(r.avgSolveSec, formatDuration)}</td>
                      <td className="px-3 py-2"><Badge tone={LEVEL[r.level].tone}>{LEVEL[r.level].label}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-faint">Solves from before the timer existed count toward "Solved" and strength but have no recorded time.</p>
          </section>
          <p className="text-xs text-ink-faint">Looking for solved-question totals, XP and reports? See <Link to="/progress" className="text-accent hover:underline">Progress</Link>.</p>
        </div>
      )}
    </Container>
  );
}
