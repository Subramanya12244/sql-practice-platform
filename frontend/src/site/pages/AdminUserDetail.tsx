import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { usePage } from "../SiteApp";
import { getSupabase } from "../lib/supabase";
import { TrendChart } from "../components/AdminAnalytics";
import { pct } from "../lib/adminAnalytics";

interface Detail {
  progress: { question_number: number; attempts: number; solved_at: string | null; revealed: boolean; updated_at: string }[];
  tasks: { project_slug: string; task_id: string; passed: boolean; updated_at: string }[];
  submissions: { id: number; project_slug: string; status: string; repo_url: string | null; created_at: string; reviewed_at: string | null }[];
  audit: { id: number; action: string; detail: Record<string, unknown>; created_at: string }[];
  mocks: { solved: number; total: number; created_at: string }[];
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

/** Summary of one learner for admins. Every read goes through RLS admin policies. */
export function summarize(d: Pick<Detail, "progress" | "tasks">, index: { number: number; topic: string; topicLabel: string }[]) {
  const solved = new Set(d.progress.filter((p) => p.solved_at).map((p) => p.question_number));
  const topics = new Map<string, { label: string; solved: number; total: number }>();
  for (const q of index) {
    const t = topics.get(q.topic) ?? { label: q.topicLabel, solved: 0, total: 0 };
    t.total++;
    if (solved.has(q.number)) t.solved++;
    topics.set(q.topic, t);
  }
  const projects = new Map<string, { passed: number; tried: number }>();
  for (const t of d.tasks) {
    if (t.task_id.startsWith("checklist:")) continue;
    const p = projects.get(t.project_slug) ?? { passed: 0, tried: 0 };
    p.tried++;
    if (t.passed) p.passed++;
    projects.set(t.project_slug, p);
  }
  const attempts = d.progress.reduce((s, p) => s + p.attempts, 0);
  return {
    solved: solved.size,
    attempts,
    revealed: d.progress.filter((p) => p.revealed).length,
    topics: [...topics.values()],
    projects: [...projects.entries()].map(([slug, v]) => ({ slug, ...v })),
  };
}

interface Activity {
  days: { day: string; minutes: number; sql: number; python: number; lessons: number }[];
  sessions: { started_at: string; last_activity_at: string }[];
  problems: { type: string; ref: string; submits: number; passed: number; fails: number }[];
}

export function AdminUserDetail({ userId, username, onClose, range }: { userId: string; username: string; onClose: () => void; range?: { from: string; to: string } }) {
  const { data } = usePage();
  const [d, setD] = useState<Detail | null>(null);
  const [act, setAct] = useState<Activity | null>(null);
  useEffect(() => {
    if (!range) return;
    setAct(null);
    void (async () => {
      // The RPC writes an admin_view_learner audit row before returning anything.
      const sb = await getSupabase();
      const { data: a, error } = await sb.rpc("admin_learner_activity", { p_user: userId, p_from: range.from, p_to: range.to });
      if (!error) setAct(a as Activity);
    })();
  }, [userId, range?.from, range?.to]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    void (async () => {
      const sb = await getSupabase();
      const [progress, tasks, submissions, audit, mocks] = await Promise.all([
        sb.from("progress").select("question_number, attempts, solved_at, revealed, updated_at").eq("user_id", userId),
        sb.from("project_progress").select("project_slug, task_id, passed, updated_at").eq("user_id", userId),
        sb.from("project_submissions").select("id, project_slug, status, repo_url, created_at, reviewed_at").eq("user_id", userId).order("created_at", { ascending: false }),
        sb.from("audit_log").select("id, action, detail, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(15),
        sb.from("mock_sessions").select("solved, total, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
      ]);
      const e = progress.error ?? tasks.error ?? submissions.error ?? audit.error ?? mocks.error;
      if (e) return setErr(e.message);
      setD({
        progress: (progress.data ?? []) as Detail["progress"], tasks: (tasks.data ?? []) as Detail["tasks"],
        submissions: (submissions.data ?? []) as Detail["submissions"], audit: (audit.data ?? []) as Detail["audit"], mocks: (mocks.data ?? []) as Detail["mocks"],
      });
    })();
  }, [userId]);

  const s = d ? summarize(d, data.index) : null;
  const title = (slug: string) => data.projects?.find((p) => p.slug === slug)?.title ?? slug;

  return (
    <section aria-label={`Learner ${username}`} className="mt-4 rounded-card border border-accent/40 bg-surface-raised p-4 shadow-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-ink">{username}</h3>
        <button type="button" onClick={onClose} aria-label="Close learner details" className="text-ink-muted hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      {!d || !s ? !err && <p className="mt-2 text-sm text-ink-muted">Loading…</p> : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
            {[["Solved", `${s.solved}/${data.index.length}`], ["Attempts", s.attempts], ["Solutions viewed", s.revealed], ["Mocks", d.mocks.length], ["Submissions", d.submissions.length]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface p-2"><dt className="text-xs text-ink-faint">{k}</dt><dd className="font-display text-lg font-bold text-ink">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">SQL by topic</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {s.topics.map((t) => (
                  <li key={t.label} className="flex items-center gap-2">
                    <span className="w-36 shrink-0 truncate text-ink-muted">{t.label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-soft" aria-hidden><span className="block h-full bg-accent" style={{ width: `${t.total ? (t.solved / t.total) * 100 : 0}%` }} /></span>
                    <span className="w-12 text-right font-mono text-xs text-ink">{t.solved}/{t.total}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Projects (automated checks passed)</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {s.projects.length ? s.projects.map((p) => (
                  <li key={p.slug} className="flex justify-between gap-2"><Link to={`/projects-lab/${p.slug}`} className="truncate text-ink hover:underline">{title(p.slug)}</Link><span className="font-mono text-xs text-ink">{p.passed}/{p.tried} tried</span></li>
                )) : <li className="text-ink-muted">No project work yet.</li>}
              </ul>
              <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink-faint">Submissions</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {d.submissions.length ? d.submissions.map((x) => (
                  <li key={x.id} className="flex flex-wrap justify-between gap-2"><span className="text-ink">{title(x.project_slug)}</span><span className="text-xs text-ink-muted">{x.status} · {fmt(x.created_at)}</span></li>
                )) : <li className="text-ink-muted">None.</li>}
              </ul>
            </div>
          </div>
          {act && range && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Activity {range.from} to {range.to}</h4>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <TrendChart title="Active minutes" days={act.days} field="minutes" />
                <TrendChart title="SQL checks" days={act.days} field="sql" />
                <TrendChart title="Python checks" days={act.days} field="python" />
                <TrendChart title="Lessons" days={act.days} field="lessons" />
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                {act.sessions.length} session{act.sessions.length === 1 ? "" : "s"}
                {act.sessions.length > 0 && ` · avg ${Math.round(act.sessions.reduce((s, x) => s + (Date.parse(x.last_activity_at) - Date.parse(x.started_at)), 0) / act.sessions.length / 60000)} min long`}
                {" · "}accuracy {pct(act.problems.reduce((s, p) => s + Number(p.passed), 0), act.problems.reduce((s, p) => s + Number(p.submits), 0)) ?? "—"}%
              </p>
              {act.problems.some((p) => Number(p.fails) > 0) && (
                <p className="mt-1 text-xs text-ink-muted">Most failed: {act.problems.filter((p) => Number(p.fails) > 0).slice(0, 5).map((p) => `${p.ref} (${p.fails})`).join(", ")}</p>
              )}
            </div>
          )}
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink-faint">Recent activity</h4>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
            {d.audit.length ? d.audit.map((a) => <li key={a.id}>{fmt(a.created_at)} · <span className="text-ink">{a.action}</span>{Object.keys(a.detail).length ? ` ${JSON.stringify(a.detail)}` : ""}</li>) : <li>No events.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
