import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { usePage } from "../SiteApp";
import { getSupabase } from "../lib/supabase";
import { downloadCsv, toCsv } from "../lib/csv";
import {
  describeProblem, difficultTopics, failedProblems, filterLearners, inactiveLearners, learnerAccuracy, pct, presetRange, toLearner, validRange,
  type Learner, type LearnerFilter, type LearnerSort, type Overview, type ProblemLookup, type ProblemStat,
} from "../lib/adminAnalytics";
import { PY_CATEGORIES } from "../lib/pyPractice";
import { Button, Card, SectionHeader } from "./ui";

const INPUT = "rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-faint";
const td = "px-3 py-2 text-sm text-ink";
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const n = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v.toLocaleString()}${suffix}`);

/** Exports are audited server-side before the file is produced. */
async function auditedExport(report: string, detail: Record<string, unknown>, file: string, csv: string) {
  const sb = await getSupabase();
  const { error } = await sb.rpc("admin_audit", { p_action: "admin_export", p_detail: { report, ...detail } });
  if (error) throw new Error(error.message);
  downloadCsv(file, csv);
}

/** One measure per chart (no dual axes). Each bar has a hover/focus tooltip; the table is the data view. */
export function TrendChart<T extends { day: string }>({ title, days, field }: { title: string; days: T[]; field: { [K in keyof T]: T[K] extends number ? K : never }[keyof T] }) {
  const v = (d: T) => d[field] as unknown as number;
  const max = Math.max(1, ...days.map(v));
  const total = days.reduce((s, d) => s + v(d), 0);
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? days[hover] : null;
  return (
    <Card pad="sm" as="section" className="min-w-0" aria-label={title}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">{title}</span>
        <span className="text-xs tabular-nums text-ink-muted">{h ? `${h.day}: ${v(h).toLocaleString()}` : `${total.toLocaleString()} total`}</span>
      </div>
      <div className="mt-2 flex h-24 items-end gap-[2px] border-b border-surface-border" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <button key={d.day} type="button" className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-offset-0"
            aria-label={`${d.day}: ${v(d)}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
            <span className={`block w-full rounded-t-[4px] ${hover === i ? "bg-accent" : "bg-accent/70"}`} style={{ height: `${v(d) ? Math.max(4, (v(d) / max) * 100) : 0}%` }} />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint"><span>{days[0]?.day}</span><span>max {max.toLocaleString()}</span><span>{days.at(-1)?.day}</span></div>
    </Card>
  );
}

function SortHead({ label, k, f, set }: { label: string; k: LearnerSort; f: LearnerFilter; set: (f: LearnerFilter) => void }) {
  const on = f.sort === k;
  return (
    <th className={th} aria-sort={on ? (f.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => set({ ...f, sort: k, desc: on ? !f.desc : k !== "username" })}>
        {label}{on && (f.desc ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );
}

export function AdminAnalytics({ onSelect, onRole, selfId, refreshKey }: {
  onSelect: (l: Learner, range: { from: string; to: string }) => void;
  onRole: (l: Learner, role: Learner["role"]) => void;
  selfId?: string;
  refreshKey: number;
}) {
  const { data } = usePage();
  const [range, setRange] = useState(() => presetRange(30));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [stats, setStats] = useState<ProblemStat[]>([]);
  const [insights, setInsights] = useState<QuestionInsight[]>([]);
  const [extras, setExtras] = useState<Map<string, LearnerExtra>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<LearnerFilter>({ q: "", role: "", activity: "", sort: "created_at", desc: true });

  const load = useCallback(async () => {
    if (!validRange(range.from, range.to)) return setErr("Choose a valid range of at most one year.");
    setErr(null);
    const sb = await getSupabase();
    const args = { p_from: range.from, p_to: range.to };
    const [o, l, p] = await Promise.all([sb.rpc("admin_overview", args), sb.rpc("admin_learners"), sb.rpc("admin_problem_stats", args)]);
    const e = o.error ?? l.error ?? p.error;
    if (e) return setErr(/admin_overview|function .* does not exist/.test(e.message) ? "Analytics need migration 008_admin_analytics.sql (and 007). Apply them in the Supabase SQL editor." : e.message);
    setOverview(o.data as Overview);
    setLearners(((l.data ?? []) as Record<string, unknown>[]).map(toLearner));
    setStats(((p.data ?? []) as ProblemStat[]).map((s) => ({ ...s, submits: Number(s.submits), passed: Number(s.passed), hidden_failed: Number(s.hidden_failed), learners: Number(s.learners) })));
    // Migration 012 (optional): question insights and per-learner extras.
    const [qi, ex] = await Promise.all([sb.rpc("admin_question_insights", args), sb.rpc("admin_learner_extras")]);
    setInsights(qi.error ? [] : ((qi.data ?? []) as Record<string, unknown>[]).map(toInsight));
    setExtras(ex.error ? new Map() : new Map(((ex.data ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), { assessments: Number(r.assessments), avg_score: r.avg_score === null ? null : Number(r.avg_score), projects_started: Number(r.projects_started), projects_completed: Number(r.projects_completed), revision_due: Number(r.revision_due) }])));
  }, [range]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const lookup: ProblemLookup = useMemo(() => ({
    sql: new Map(data.index.map((q) => [q.number, { title: q.title, topic: q.topicLabel, path: `/questions/${q.slug}` }])),
    python: new Map((data.exercises ?? []).map((e) => [e.slug, { title: `${e.code} ${e.title}`, topic: PY_CATEGORIES.find((c) => c.slug === e.category)?.short ?? "Python" }])),
  }), [data.index, data.exercises]);
  const shown = filterLearners(learners, f);
  const inactive = inactiveLearners(learners, 14);
  const failed = failedProblems(stats, lookup);
  const topics = difficultTopics(stats, lookup);
  const sqlTotal = data.index.length, pyTotal = data.exercises?.length ?? 150;
  const users = learners.filter((l) => l.role === "user");
  const avg = (fn: (l: Learner) => number) => (users.length ? Math.round(users.reduce((s, l) => s + fn(l), 0) / users.length) : null);
  const exportErr = (e: unknown) => setErr((e as Error).message);

  const o = overview;
  const tiles: [string, string, string?][] = o ? [
    ["Daily active", n(o.dau), `on ${range.to}`], ["Weekly active", n(o.wau)], ["Monthly active", n(o.mau)],
    ["Registrations", n(o.registrations), "in range"], ["Sessions", n(o.sessions), o.avgSessionMin !== null ? `avg ${o.avgSessionMin} min long` : undefined],
    ["Active time", n(o.activeMinutes, " min"), o.avgActiveMinPerUser !== null ? `avg ${o.avgActiveMinPerUser} min per active learner` : undefined],
    ["SQL checks", n(o.sqlSubmits), `${n(pct(o.sqlPassed, o.sqlSubmits), "%")} accuracy · ${o.sqlSolves} solves`],
    ["Python checks", n(o.pySubmits), `${n(pct(o.pyPassed, o.pySubmits), "%")} accuracy · ${o.pySolves} completions`],
    ["SQL completion", n(avg((l) => (l.sql_solved / sqlTotal) * 100), "%"), `avg per learner of ${sqlTotal}`],
    ["Python completion", n(avg((l) => (l.py_solved / pyTotal) * 100), "%"), `avg per learner of ${pyTotal}`],
    ["Lessons & projects", `${o.lessonsCompleted} / ${o.projectsCompleted}`, "lessons / projects completed"],
    ["Assessments", n(o.assessments), "mock interviews finished"],
  ] : [];

  return (
    <section aria-labelledby="analytics" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader id="analytics" title="Analytics" description="Active time and accuracy are estimates reported by learners' browsers (focused, interacting minutes only)." />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[7, 30, 90].map((d) => <Button key={d} size="sm" variant={range.from === presetRange(d).from && range.to === presetRange(d).to ? "primary" : "secondary"} onClick={() => setRange(presetRange(d))}>{d} days</Button>)}
          <label className="flex items-center gap-1 text-xs text-ink-muted">From <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={INPUT} /></label>
          <label className="flex items-center gap-1 text-xs text-ink-muted">To <input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={INPUT} /></label>
        </div>
      </div>
      {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-dim px-4 py-3 text-sm text-danger">{err}</p>}

      {o && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tiles.map(([label, value, hint]) => (
              <Card key={label} pad="sm">
                <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
                <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
                {hint && <p className="text-xs text-ink-muted">{hint}</p>}
              </Card>
            ))}
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Trends</h3>
              <Button size="sm" variant="ghost" onClick={() => void auditedExport("trend", range, `dataforge-trend-${range.from}-${range.to}.csv`, toCsv(o.trend as unknown as Record<string, string>[], ["day", "activeUsers", "activeMinutes", "signups", "sqlSubmits", "pySubmits"])).catch(exportErr)}><Download className="h-3.5 w-3.5" aria-hidden /> CSV</Button>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <TrendChart title="Active learners" days={o.trend} field="activeUsers" />
              <TrendChart title="Active minutes" days={o.trend} field="activeMinutes" />
              <TrendChart title="Registrations" days={o.trend} field="signups" />
              <TrendChart title="SQL checks" days={o.trend} field="sqlSubmits" />
              <TrendChart title="Python checks" days={o.trend} field="pySubmits" />
            </div>
          </div>
        </>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Learners ({shown.length} of {learners.length})</h3>
          <Button size="sm" variant="ghost" onClick={() => void auditedExport("learners", { filter: f }, "dataforge-learners.csv", toCsv(shown.map((l) => ({ ...l, accuracy: learnerAccuracy(l) ?? "" })) as unknown as Record<string, string>[],
            ["username", "role", "created_at", "last_activity_at", "sql_solved", "sql_attempts", "sql_submits", "sql_passed", "py_solved", "py_submits", "py_passed", "accuracy", "active_min_7d", "active_min_30d", "active_min_total", "sessions", "mocks"])).catch(exportErr)}>
            <Download className="h-3.5 w-3.5" aria-hidden /> CSV
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <span className="sr-only">Search learners</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search by username" className={`${INPUT} w-full pl-8`} />
          </label>
          <select aria-label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as LearnerFilter["role"] })} className={INPUT}>
            <option value="">All roles</option><option value="user">Learners</option><option value="admin">Admins</option>
          </select>
          <select aria-label="Activity" value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value as LearnerFilter["activity"] })} className={INPUT}>
            <option value="">Any activity</option><option value="active7">Active in 7 days</option><option value="inactive14">Inactive 14+ days</option><option value="never">Never active</option>
          </select>
        </div>
        <div className="mt-2 overflow-x-auto rounded-card border border-surface-border">
          <table className="w-full min-w-[820px]">
            <thead className="bg-surface-raised">
              <tr>
                <SortHead label="Username" k="username" f={f} set={setF} /><th className={th}>Role</th>
                <SortHead label="SQL solved" k="sql_solved" f={f} set={setF} /><SortHead label="Python solved" k="py_solved" f={f} set={setF} />
                <SortHead label="Accuracy" k="accuracy" f={f} set={setF} /><SortHead label="Active 30d" k="active_min_30d" f={f} set={setF} /><th className={th}>Assessments</th><th className={th}>Projects</th>
                <SortHead label="Joined" k="created_at" f={f} set={setF} /><SortHead label="Last active" k="last_activity_at" f={f} set={setF} /><th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {shown.map((l) => (
                <tr key={l.id}>
                  <td className={td}><button type="button" className="text-accent hover:underline" onClick={() => onSelect(l, range)}>{l.username}</button></td>
                  <td className={td}>{l.role}</td>
                  <td className={`${td} tabular-nums`}>{l.sql_solved}</td>
                  <td className={`${td} tabular-nums`}>{l.py_solved}</td>
                  <td className={`${td} tabular-nums`}>{n(learnerAccuracy(l), "%")}</td>
                  <td className={`${td} tabular-nums`}>{l.active_min_30d} min</td>
                  <td className={`${td} tabular-nums`}>{extras.get(l.id)?.assessments ? `${extras.get(l.id)!.assessments} · ${n(extras.get(l.id)!.avg_score, "%")}` : "—"}</td>
                  <td className={`${td} tabular-nums`}>{extras.get(l.id) ? `${extras.get(l.id)!.projects_completed}/${extras.get(l.id)!.projects_started}` : "—"}</td>
                  <td className={td}>{fmtDay(l.created_at)}</td>
                  <td className={td}>{fmtDay(l.last_activity_at ?? l.last_seen_at)}</td>
                  <td className={td}>
                    <button type="button" className="text-xs text-ink-muted underline hover:text-ink" onClick={() => onRole(l, l.role === "admin" ? "user" : "admin")}>
                      {l.role === "admin" ? (l.id === selfId ? "Remove my admin" : "Make user") : "Make admin"}
                    </button>
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td className={td} colSpan={11}>No learners match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card pad="sm" as="section" className="min-w-0" aria-label="Inactive learners">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-ink">Inactive 14+ days ({inactive.length})</h3>
            <Button size="sm" variant="ghost" aria-label="Export inactive learners" onClick={() => void auditedExport("inactive", { days: 14 }, "dataforge-inactive.csv", toCsv(inactive.map(({ l, idleDays }) => ({ username: l.username, idle_days: idleDays ?? "never active", last_activity_at: l.last_activity_at ?? "", sql_solved: l.sql_solved, py_solved: l.py_solved })) as unknown as Record<string, string>[], ["username", "idle_days", "last_activity_at", "sql_solved", "py_solved"])).catch(exportErr)}><Download className="h-3.5 w-3.5" aria-hidden /></Button></div>
          <ul className="mt-2 space-y-1 text-sm">
            {inactive.slice(0, 10).map(({ l, idleDays }) => <li key={l.id} className="flex justify-between gap-2"><button type="button" className="truncate text-ink hover:text-accent" onClick={() => onSelect(l, range)}>{l.username}</button><span className="shrink-0 text-xs text-ink-muted">{idleDays === null ? "never active" : `${idleDays} days`}</span></li>)}
            {!inactive.length && <li className="text-xs text-ink-muted">Everyone has been active recently.</li>}
          </ul>
        </Card>
        <Card pad="sm" as="section" className="min-w-0" aria-label="Commonly failed problems">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-ink">Most failed problems</h3>
            <Button size="sm" variant="ghost" aria-label="Export failed problems" onClick={() => void auditedExport("failed_problems", range, `dataforge-failed-${range.from}-${range.to}.csv`, toCsv(failed as unknown as Record<string, string>[], ["kind", "ref", "title", "topic", "submits", "passed", "fails", "failRate", "hidden_failed", "learners"])).catch(exportErr)}><Download className="h-3.5 w-3.5" aria-hidden /></Button></div>
          <ul className="mt-2 space-y-1 text-sm">
            {failed.slice(0, 10).map((p) => (
              <li key={p.kind + p.ref} className="flex justify-between gap-2">
                {p.path ? <Link to={p.path} className="truncate text-ink hover:text-accent">{p.title}</Link> : <span className="truncate text-ink">{p.title}</span>}
                <span className="shrink-0 text-xs tabular-nums text-ink-muted" title={`${p.fails} of ${p.submits} checks failed by ${p.learners} learner(s)`}>{p.fails} fails · {p.failRate}%</span>
              </li>
            ))}
            {!failed.length && <li className="text-xs text-ink-muted">No problem has 2+ checks in this range.</li>}
          </ul>
        </Card>
        <Card pad="sm" as="section" className="min-w-0" aria-label="Difficult topics">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-ink">Difficult topics</h3>
            <Button size="sm" variant="ghost" aria-label="Export difficult topics" onClick={() => void auditedExport("difficult_topics", range, `dataforge-topics-${range.from}-${range.to}.csv`, toCsv(topics as unknown as Record<string, string>[], ["kind", "topic", "problems", "submits", "passed", "failRate"])).catch(exportErr)}><Download className="h-3.5 w-3.5" aria-hidden /></Button></div>
          <ul className="mt-2 space-y-1 text-sm">
            {topics.slice(0, 10).map((t) => <li key={t.kind + t.topic} className="flex justify-between gap-2"><span className="truncate text-ink">{t.topic} <span className="text-xs text-ink-faint">{t.kind === "sql" ? "SQL" : "Python"}</span></span><span className="shrink-0 text-xs tabular-nums text-ink-muted">{t.failRate}% fail · {t.submits} checks</span></li>)}
            {!topics.length && <li className="text-xs text-ink-muted">Not enough checks in this range.</li>}
          </ul>
        </Card>
      </div>
      {insights.length > 0 && <QuestionInsights rows={insights} lookup={lookup} />}
    </section>
  );
}

interface QuestionInsight { kind: "sql" | "python"; ref: string; opened_by: number; submits: number; passed: number; hidden_failed: number; learners: number; median_solve_sec: number | null }
interface LearnerExtra { assessments: number; avg_score: number | null; projects_started: number; projects_completed: number; revision_due: number }
const toInsight = (r: Record<string, unknown>): QuestionInsight => ({ kind: r.kind as "sql" | "python", ref: String(r.ref), opened_by: Number(r.opened_by), submits: Number(r.submits), passed: Number(r.passed), hidden_failed: Number(r.hidden_failed), learners: Number(r.learners), median_solve_sec: r.median_solve_sec === null ? null : Number(r.median_solve_sec) });

/**
 * Rules (visible to admins): slow = median first solve over 20 minutes (SQL); low engagement =
 * opened by 3+ learners but checked by under a third of them; possibly faulty = 5+ checks with a
 * pass rate of 10% or less, or most failures coming from hidden tests.
 */
function QuestionInsights({ rows, lookup }: { rows: QuestionInsight[]; lookup: ProblemLookup }) {
  const title = (r: QuestionInsight) => describeProblem({ kind: r.kind, ref: r.ref, submits: 0, passed: 0, hidden_failed: 0, learners: 0 }, lookup).title;
  const slow = rows.filter((r) => (r.median_solve_sec ?? 0) > 1200).sort((a, b) => (b.median_solve_sec ?? 0) - (a.median_solve_sec ?? 0)).slice(0, 8);
  const low = rows.filter((r) => r.opened_by >= 3 && r.learners < r.opened_by / 3).sort((a, b) => b.opened_by - a.opened_by).slice(0, 8);
  const faulty = rows.filter((r) => r.submits >= 5 && (r.passed / r.submits <= 0.1 || r.hidden_failed > (r.submits - r.passed) / 2)).sort((a, b) => a.passed / a.submits - b.passed / b.submits).slice(0, 8);
  const col = (label: string, hint: string, items: QuestionInsight[], value: (r: QuestionInsight) => string) => (
    <Card pad="sm" as="section" className="min-w-0" aria-label={label}>
      <h3 className="text-sm font-semibold text-ink">{label}</h3>
      <p className="text-[11px] text-ink-faint">{hint}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((r) => <li key={r.kind + r.ref} className="flex justify-between gap-2"><span className="truncate text-ink">{title(r)}</span><span className="shrink-0 text-xs tabular-nums text-ink-muted">{value(r)}</span></li>)}
        {!items.length && <li className="text-xs text-ink-muted">None in this range.</li>}
      </ul>
    </Card>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {col("Slow to solve", "Median first-solve time over 20 min (SQL, all time).", slow, (r) => `${Math.round((r.median_solve_sec ?? 0) / 60)} min median`)}
      {col("Low engagement", "Opened by 3+ learners, checked by under a third of them.", low, (r) => `${r.learners}/${r.opened_by} tried`)}
      {col("Possibly faulty", "5+ checks with ≤10% passing, or failures mostly on hidden tests: review the question.", faulty, (r) => `${Math.round((r.passed / r.submits) * 100)}% pass · ${r.hidden_failed} hidden`)}
    </div>
  );
}
