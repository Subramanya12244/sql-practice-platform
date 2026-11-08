import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePage } from "../SiteApp";
import { useProgress, today } from "../lib/progress";
import { readStats, type PyStat } from "../lib/pyPractice";
import { activeMinutes, formatMinutes } from "../lib/activity";
import { change, learningAnalytics } from "../lib/learningAnalytics";
import { revisionQueue, splitQueue } from "../lib/revision";
import { getProjectProgress, loadAllProjects, projectStatus } from "../lib/projects";
import { useAuth } from "../lib/auth";
import { accountsEnabled, getSupabase } from "../lib/supabase";
import { Card, ProgressBar, SectionHeader, StatCard } from "./ui";

const n = (v: number | null, suffix = "") => (v === null ? "—" : `${v}${suffix}`);

/** Personal analytics from tracked activity only (see lib/learningAnalytics.ts for the definitions). */
export function LearningAnalytics() {
  const { data } = usePage();
  const progress = useProgress();
  const { session } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<Record<string, PyStat>>({});
  const [minutes, setMinutes] = useState<string[]>([]);
  const [projects, setProjects] = useState<{ done: number; started: number; total: number } | null>(null);
  const [assess, setAssess] = useState<{ n: number; avg: number | null; best: number | null } | null>(null);
  useEffect(() => {
    setMounted(true); setStats(readStats()); setMinutes(activeMinutes());
    void loadAllProjects().then((ps) => {
      const st = ps.map((p) => projectStatus(p, getProjectProgress(p.slug)));
      setProjects({ done: st.filter((s) => s === "Completed").length, started: st.filter((s) => s !== "Not started").length, total: ps.length });
    });
  }, []);
  useEffect(() => {
    if (!accountsEnabled || !session) return;
    void getSupabase().then((sb) => sb.from("assessment_attempts").select("score, total").not("submitted_at", "is", null)).then(({ data: rows, error }) => {
      if (error) return;
      const xs = ((rows ?? []) as { score: number; total: number }[]).filter((r) => r.total > 0).map((r) => Math.round((r.score / r.total) * 100));
      setAssess({ n: xs.length, avg: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null, best: xs.length ? Math.max(...xs) : null });
    });
  }, [session]);
  if (!mounted) return null;
  const a = learningAnalytics(data.index, data.exercises ?? [], progress, stats, minutes);
  const q = splitQueue(revisionQueue(data.index, data.exercises ?? [], progress, today()), today());
  const max = Math.max(1, ...a.time.weeks.map((w) => w.minutes));
  const weakest = a.sql.topics.filter((t) => t.submits >= 3 && t.accuracy !== null).sort((x, y) => x.accuracy! - y.accuracy!).slice(0, 3);

  const dir = (now: number, prev: number) => (now > prev ? "up" : now < prev ? "down" : "flat") as "up" | "down" | "flat";
  const tiles: [string, string, string, { direction: "up" | "down" | "flat"; label: string }?][] = [
    ["SQL solved", `${a.sql.solved}/${a.sql.total}`, `${n(a.sql.accuracy, "%")} of ${a.sql.submits} submits correct`],
    ["Python solved", `${a.python.solved}/${a.python.total}`, `${n(a.python.accuracy, "%")} of ${a.python.checks} checks passed (this browser)`],
    ["First-attempt success", `${n(a.sql.firstTry.of ? Math.round((a.sql.firstTry.n / a.sql.firstTry.of) * 100) : null, "%")} SQL`, `${a.sql.firstTry.n} of ${a.sql.firstTry.of} solves with no wrong submit · Python ${n(a.python.firstTry.of ? Math.round((a.python.firstTry.n / a.python.firstTry.of) * 100) : null, "%")}`],
    ["Time to solve (SQL)", a.sql.avgSolveMin === null ? "—" : `${a.sql.avgSolveMin} min avg`, a.sql.medianSolveMin === null ? "from first look to first correct submit" : `median ${a.sql.medianSolveMin} min, from first look to first correct submit`],
    ["Active this week", formatMinutes(a.time.thisWeek), "vs the week before", { direction: dir(a.time.thisWeek, a.time.lastWeek), label: change(a.time.thisWeek, a.time.lastWeek) }],
    ["Active last 30 days", formatMinutes(a.time.month), "vs the 30 days before", { direction: dir(a.time.month, a.time.prevMonth), label: change(a.time.month, a.time.prevMonth) }],
    ["Revision", `${q.overdue.length + q.today.length} due`, `${q.overdue.length} overdue · ${q.upcoming.length} upcoming`],
    ["Projects", projects ? `${projects.done}/${projects.total}` : "—", projects ? `${projects.started} started` : ""],
    ...(assess ? [["Assessments", assess.n ? `${assess.avg}% avg` : "none yet", assess.n ? `${assess.n} taken · best ${assess.best}%` : "timed, server-graded"] as [string, string, string]] : []),
  ];

  return (
    <section aria-labelledby="analytics" className="mt-10">
      <SectionHeader id="analytics" title="Learning analytics" description="From your own tracked activity. Active time counts focused minutes with keyboard, mouse or touch input in this browser, not how long a tab was open." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {tiles.map(([label, value, hint, trend]) => (
          <StatCard key={label} label={label} value={value} hint={hint} trend={trend} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card pad="md" as="section" aria-label="Active time per week" className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">Active time, last 8 weeks</p>
          <ol className="mt-3 flex h-32 items-end gap-2" aria-label="Active minutes per week">
            {a.time.weeks.map((w) => (
              <li key={w.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`Week from ${w.label}: ${formatMinutes(w.minutes)}`}>
                <span className="w-full rounded-t-[4px] bg-accent/80" style={{ height: `${w.minutes ? Math.max(4, (w.minutes / max) * 100) : 0}%` }} />
                <span className="text-[10px] text-ink-faint">{w.label}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card pad="md" as="section" aria-label="Completion by difficulty" className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">Completion by difficulty</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {([["SQL", a.sql.byLevel], ["Python", a.python.byLevel]] as const).map(([label, rows]) => (
              <ul key={label} className="space-y-2"><li className="text-xs font-semibold text-ink">{label}</li>
                {rows.map((r) => <li key={r.level}><div className="flex justify-between text-xs"><span className="text-ink-muted">{r.level}</span><span className="tabular-nums text-ink-muted">{r.done}/{r.total}</span></div><ProgressBar className="mt-1" value={r.done} max={r.total} label={`${label} ${r.level} completed`} /></li>)}
              </ul>
            ))}
          </div>
          {weakest.length > 0 && <p className="mt-3 text-xs text-ink-muted">Lowest SQL accuracy: {weakest.map((t, i) => <span key={t.label}>{i ? ", " : ""}<strong className="text-ink">{t.label}</strong> {t.accuracy}%</span>)}. <Link to="/review" className="text-accent hover:underline">Revise</Link></p>}
        </Card>
      </div>
      <details className="mt-4 rounded-card border border-surface-border bg-surface-raised p-4 text-sm shadow-panel">
        <summary className="cursor-pointer font-semibold text-ink">Accuracy by SQL topic</summary>
        <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-xs text-ink-faint"><th className="py-1 font-medium">Topic</th><th className="py-1 font-medium">Solved</th><th className="py-1 font-medium">Submits</th><th className="py-1 text-right font-medium">Accuracy</th></tr></thead>
          <tbody>{a.sql.topics.map((t) => <tr key={t.label} className="border-t border-surface-border"><td className="py-1 text-ink">{t.label}</td><td className="py-1 tabular-nums text-ink-muted">{t.solved}/{t.total}</td><td className="py-1 tabular-nums text-ink-muted">{t.submits}</td><td className={`py-1 text-right tabular-nums ${t.accuracy !== null && t.accuracy < 50 ? "text-danger" : "text-ink"}`}>{n(t.accuracy, "%")}</td></tr>)}</tbody>
        </table>
      </details>
    </section>
  );
}
