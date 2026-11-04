import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { loadProjectIndex } from "../lib/projects";
import { downloadCsv, toCsv } from "../lib/csv";
import type { ReviewStatus } from "../lib/projects";

export interface SubmissionAdminRow {
  id: number;
  user_id: string;
  project_slug: string;
  repo_url: string | null;
  notes: string | null;
  checklist: Record<string, boolean[]>;
  status: ReviewStatus;
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface ReviewRow {
  id: number;
  reviewer_id: string | null;
  from_status: string | null;
  to_status: string;
  comment: string | null;
  created_at: string;
}

const STATUSES: ReviewStatus[] = ["Submitted", "Under evaluation", "Changes requested", "Completed", "Rejected"];
const ACTIONS: { label: string; status: ReviewStatus; tone: string }[] = [
  { label: "Approve", status: "Completed", tone: "bg-success text-white" },
  { label: "Request changes", status: "Changes requested", tone: "bg-warn text-white" },
  { label: "Reject", status: "Rejected", tone: "bg-danger text-white" },
  { label: "Mark under evaluation", status: "Under evaluation", tone: "border border-surface-border text-ink" },
];
const PAGE = 50;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-faint";
const td = "px-3 py-2 text-sm text-ink";
const input = "rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-ink";

/** Ticked / total across every checklist task in a submission. */
export function checklistCompletion(c: Record<string, boolean[]> | null | undefined): { done: number; total: number } {
  const all = Object.values(c ?? {}).flat();
  return { done: all.filter(Boolean).length, total: all.length };
}

/** Text search over username, project and notes; every word must match. */
export function matchesSearch(row: SubmissionAdminRow, username: string, projectTitle: string, query: string): boolean {
  const hay = `${username} ${row.project_slug} ${projectTitle} ${row.notes ?? ""} ${row.repo_url ?? ""}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/**
 * Admin review of project submissions. Authorization is enforced in the database (migration 004):
 * RLS limits reads to admins, and a trigger rejects non-admin updates and stamps reviewer + time.
 */
export function AdminSubmissions({ name, users, onChange }: { name: (id: string | null) => string; users: { id: string; username: string }[]; onChange: () => void }) {
  const [rows, setRows] = useState<SubmissionAdminRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [user, setUser] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<SubmissionAdminRow | null>(null);
  const [history, setHistory] = useState<ReviewRow[]>([]);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    void loadProjectIndex().then((list) => setTitles(Object.fromEntries(list.map((p) => [p.slug, p.title]))));
  }, []);

  const load = useCallback(async () => {
    const sb = await getSupabase();
    let q = sb.from("project_submissions")
      .select("id, user_id, project_slug, repo_url, notes, checklist, status, review_comment, reviewed_by, reviewed_at, created_at")
      .order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
    if (user) q = q.eq("user_id", user);
    if (project) q = q.eq("project_slug", project);
    if (status) q = q.eq("status", status);
    if (from) q = q.gte("created_at", new Date(from).toISOString());
    if (to) q = q.lt("created_at", new Date(new Date(to).getTime() + 86_400_000).toISOString());
    const { data, error } = await q;
    if (error) return setMsg(error.message.includes("review_comment") ? "Apply supabase/migrations/004_submission_review.sql to enable reviews." : error.message);
    setMsg(null);
    setHasMore((data ?? []).length > PAGE);
    setRows(((data ?? []) as SubmissionAdminRow[]).slice(0, PAGE));
  }, [user, project, status, from, to, page]);
  useEffect(() => setPage(0), [user, project, status, from, to]);
  useEffect(() => void load(), [load]);

  const openRow = async (r: SubmissionAdminRow) => {
    setOpen(r);
    setComment(r.review_comment ?? "");
    const sb = await getSupabase();
    const { data } = await sb.from("submission_reviews").select("id, reviewer_id, from_status, to_status, comment, created_at").eq("submission_id", r.id).order("created_at");
    setHistory((data ?? []) as ReviewRow[]);
  };

  async function review(next: ReviewStatus) {
    if (!open) return;
    if ((next === "Changes requested" || next === "Rejected") && !comment.trim()) return setMsg("Add a comment so the learner knows what to change.");
    setBusy(true);
    const sb = await getSupabase();
    // reviewed_by / reviewed_at are set by the database trigger, not sent from here.
    const { data, error } = await sb.from("project_submissions").update({ status: next, review_comment: comment.trim() || null }).eq("id", open.id).select().single();
    setBusy(false);
    if (error) return setMsg(error.message);
    // load() clears messages, so confirm after it finishes.
    await Promise.all([load(), openRow(data as SubmissionAdminRow)]);
    setMsg(`Saved: ${next}.`);
    onChange();
  }

  const shown = useMemo(() => rows.filter((r) => !query || matchesSearch(r, name(r.user_id), titles[r.project_slug] ?? "", query)), [rows, query, name, titles]);
  const projects = useMemo(() => [...new Set([...Object.keys(titles), ...rows.map((r) => r.project_slug)])].sort(), [titles, rows]);

  return (
    <>
      <h2 className="mt-10 font-display text-xl font-bold text-ink">Project submissions</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <input aria-label="Search submissions" placeholder="Search user, project, notes" value={query} onChange={(e) => setQuery(e.target.value)} className={`${input} w-56`} />
        <select aria-label="Filter submissions by user" value={user} onChange={(e) => setUser(e.target.value)} className={input}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <select aria-label="Filter submissions by project" value={project} onChange={(e) => setProject(e.target.value)} className={input}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{titles[p] ?? p}</option>)}
        </select>
        <select aria-label="Filter submissions by status" value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1 text-ink-muted">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></label>
        <button type="button" className="rounded-lg border border-surface-border px-3 py-1.5"
          onClick={() => downloadCsv("dataforge-submissions.csv", toCsv(shown.map((r) => ({ ...r, user: name(r.user_id), project: titles[r.project_slug] ?? r.project_slug, checklist_done: `${checklistCompletion(r.checklist).done}/${checklistCompletion(r.checklist).total}`, reviewer: r.reviewed_by ? name(r.reviewed_by) : "" })), ["created_at", "user", "project", "status", "repo_url", "checklist_done", "review_comment", "reviewer", "reviewed_at"]))}>
          Export CSV
        </button>
        <label className="flex items-center gap-1 text-ink-muted">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></label>
      </div>
      {msg && <p role="status" className="mt-2 text-sm text-ink-muted">{msg}</p>}

      <div className="mt-3 overflow-x-auto rounded-card border border-surface-border">
        <table className="w-full min-w-[720px]">
          <thead className="bg-surface-raised"><tr><th className={th}>Submitted</th><th className={th}>User</th><th className={th}>Project</th><th className={th}>Checklist</th><th className={th}>Status</th><th className={th}>Reviewed</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-surface-border">
            {shown.map((r) => {
              const c = checklistCompletion(r.checklist);
              return (
                <tr key={r.id} className={open?.id === r.id ? "bg-accent-dim" : ""}>
                  <td className={td}>{fmt(r.created_at)}</td>
                  <td className={td}>{name(r.user_id)}</td>
                  <td className={td}>{titles[r.project_slug] ?? r.project_slug}</td>
                  <td className={td}>{c.total ? `${c.done}/${c.total}` : "—"}</td>
                  <td className={td}>{r.status}</td>
                  <td className={td}>{r.reviewed_by ? `${name(r.reviewed_by)}, ${fmt(r.reviewed_at)}` : "—"}</td>
                  <td className={td}><button type="button" className="text-xs text-accent underline" onClick={() => void openRow(r)}>Review</button></td>
                </tr>
              );
            })}
            {!shown.length && <tr><td className={td} colSpan={7}>No submissions match.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex gap-3 text-sm">
        <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-surface-border px-3 py-1.5 disabled:opacity-50">Newer</button>
        <button type="button" disabled={!hasMore} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-surface-border px-3 py-1.5 disabled:opacity-50">Older</button>
      </div>

      {open && (
        <section aria-label="Submission detail" className="mt-4 rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-bold text-ink">{titles[open.project_slug] ?? open.project_slug} · {name(open.user_id)}</h3>
            <button type="button" className="text-xs text-ink-muted underline" onClick={() => setOpen(null)}>Close</button>
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-ink-faint">Status</dt><dd className="text-ink">{open.status}</dd>
            <dt className="text-ink-faint">Submitted</dt><dd className="text-ink">{fmt(open.created_at)}</dd>
            <dt className="text-ink-faint">Repository</dt>
            <dd className="break-all">{open.repo_url ? <a className="text-accent underline" href={open.repo_url} target="_blank" rel="noopener noreferrer nofollow">{open.repo_url}</a> : <span className="text-ink-muted">No link</span>}</dd>
            <dt className="text-ink-faint">Notes</dt><dd className="whitespace-pre-wrap text-ink">{open.notes || <span className="text-ink-muted">None</span>}</dd>
            <dt className="text-ink-faint">Checklist</dt>
            <dd className="text-ink">
              {Object.keys(open.checklist ?? {}).length
                ? Object.entries(open.checklist).map(([task, ticks]) => <div key={task}>{task}: {ticks.filter(Boolean).length}/{ticks.length}</div>)
                : <span className="text-ink-muted">No manual steps</span>}
            </dd>
          </dl>

          <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="review-comment">Reviewer comment</label>
          <textarea id="review-comment" value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} rows={3} className={`${input} mt-1 w-full`} />
          <div className="mt-2 flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <button key={a.status} type="button" disabled={busy} onClick={() => void review(a.status)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${a.tone}`}>{a.label}</button>
            ))}
          </div>

          <h4 className="mt-5 text-sm font-semibold text-ink">Review history</h4>
          <ol className="mt-2 space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="text-ink-muted">
                {fmt(h.created_at)} · {name(h.reviewer_id)}: {h.from_status ?? "—"} → <span className="text-ink">{h.to_status}</span>{h.comment ? ` — ${h.comment}` : ""}
              </li>
            ))}
            {!history.length && <li className="text-ink-muted">Not reviewed yet.</li>}
          </ol>
        </section>
      )}
    </>
  );
}
