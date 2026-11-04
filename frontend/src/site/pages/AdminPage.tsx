import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Container, PageHeader } from "../components/ui";
import { Seo } from "../lib/seo";
import { useAuth } from "../lib/auth";
import { getSupabase } from "../lib/supabase";
import { setChallenge, setHidden, weekStart } from "../lib/community";
import { AdminSubmissions } from "./AdminSubmissions";

interface CommentAdminRow {
  id: number;
  question_number: number;
  user_id: string;
  body: string;
  hidden: boolean;
  created_at: string;
}

/** Recent comments with hide/unhide, plus this week's challenge questions. */
function Moderation({ name, onChange }: { name: (id: string | null) => string; onChange: () => void }) {
  const [rows, setRows] = useState<CommentAdminRow[]>([]);
  const [nums, setNums] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const sb = await getSupabase();
    const { data } = await sb.from("comments").select("id, question_number, user_id, body, hidden, created_at").order("created_at", { ascending: false }).limit(50);
    setRows((data ?? []) as CommentAdminRow[]);
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <>
      <h2 className="mt-10 font-display text-xl font-bold text-ink">Comments</h2>
      <div className="mt-3 overflow-x-auto rounded-card border border-surface-border">
        <table className="w-full min-w-[560px]">
          <thead className="bg-surface-raised"><tr><th className={th}>Time</th><th className={th}>User</th><th className={th}>Q</th><th className={th}>Comment</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((c) => (
              <tr key={c.id} className={c.hidden ? "opacity-60" : ""}>
                <td className={td}>{fmt(c.created_at)}</td>
                <td className={td}>{name(c.user_id)}</td>
                <td className={td}>Q{c.question_number}</td>
                <td className={`${td} max-w-md truncate`} title={c.body}>{c.body}</td>
                <td className={td}>
                  <button type="button" className="text-xs underline" onClick={() => setHidden("comments", c.id, !c.hidden).then(() => { void load(); onChange(); })}>
                    {c.hidden ? "Unhide" : "Hide"}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td className={td} colSpan={5}>No comments yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 font-display text-xl font-bold text-ink">Weekly challenge</h2>
      <form
        className="mt-3 flex flex-wrap items-center gap-2 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const list = nums.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
          try {
            await setChallenge(weekStart(), list);
            setMsg(`Set week of ${weekStart()} to Q${list.join(", Q")}.`);
          } catch (ex) {
            setMsg((ex as Error).message);
          }
        }}
      >
        <input value={nums} onChange={(e) => setNums(e.target.value)} placeholder="Question numbers, e.g. 14, 64, 101" aria-label="Challenge question numbers"
          className="rounded-lg border border-surface-border bg-surface px-3 py-1.5 text-ink" />
        <button className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">Set this week</button>
        {msg && <span className="text-ink-muted">{msg}</span>}
      </form>
    </>
  );
}

interface Stats {
  users: number;
  admins: number;
  active7: number;
  active30: number;
  solves: number;
  mocks: number;
  signupsByDay: { day: string; n: number }[];
}

interface UserRow {
  id: string;
  username: string;
  role: "user" | "admin";
  created_at: string;
  last_seen_at: string | null;
  solved: number;
  attempts: number;
  mocks: number;
}

interface AuditRow {
  id: number;
  user_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

const ACTIONS = ["", "signup", "login", "logout", "submit", "solve", "mock_finish", "password_change", "role_change", "progress_import", "solution_share", "comment", "comment_hide", "submission_review"];
const PAGE = 50;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-faint";
const td = "px-3 py-2 text-sm text-ink";

export function AdminPage() {
  const { enabled, ready, profile, session } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isAdmin = profile?.role === "admin";

  const loadOverview = useCallback(async () => {
    const sb = await getSupabase();
    const [s, u] = await Promise.all([sb.rpc("admin_stats"), sb.rpc("admin_users")]);
    if (s.error || u.error) return setErr((s.error ?? u.error)!.message);
    setStats(s.data as Stats);
    setUsers((u.data ?? []) as UserRow[]);
  }, []);

  const loadAudit = useCallback(async () => {
    const sb = await getSupabase();
    let q = sb.from("audit_log").select("id, user_id, action, detail, created_at").order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE);
    if (filterUser) q = q.eq("user_id", filterUser);
    if (filterAction) q = q.eq("action", filterAction);
    const { data, error } = await q;
    if (error) return setErr(error.message);
    setHasMore((data ?? []).length > PAGE);
    setAudit(((data ?? []) as AuditRow[]).slice(0, PAGE));
  }, [page, filterUser, filterAction]);

  useEffect(() => {
    if (isAdmin) void loadOverview();
  }, [isAdmin, loadOverview]);
  useEffect(() => {
    if (isAdmin) void loadAudit();
  }, [isAdmin, loadAudit]);

  async function setRole(u: UserRow, role: UserRow["role"]) {
    if (u.id === session?.user.id && role !== "admin" && !confirm("Remove your own admin access?")) return;
    const sb = await getSupabase();
    const { error } = await sb.from("profiles").update({ role }).eq("id", u.id);
    if (error) return setErr(error.message);
    await Promise.all([loadOverview(), loadAudit()]);
  }

  const name = (id: string | null) => users.find((u) => u.id === id)?.username ?? (id ? id.slice(0, 8) : "—");

  let body;
  if (!enabled) body = <p className="text-ink-muted">Accounts are not enabled on this deployment.</p>;
  else if (!ready) body = <p className="text-ink-muted">Loading…</p>;
  else if (!session) body = <p className="text-ink-muted"><Link className="text-accent underline" to="/login">Sign in</Link> with an admin account.</p>;
  else if (!isAdmin) body = <p role="alert" className="text-danger">403 — this page is for admins only.</p>;
  else
    body = (
      <>
        {err && <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-dim px-4 py-3 text-sm text-danger">{err}</p>}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Users", stats.users],
              ["Admins", stats.admins],
              ["Active 7d", stats.active7],
              ["Active 30d", stats.active30],
              ["Solves", stats.solves],
              ["Mock interviews", stats.mocks],
            ].map(([label, value]) => (
              <div key={label} className="rounded-card border border-surface-border bg-surface-raised p-4 shadow-panel">
                <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink">{value}</p>
              </div>
            ))}
          </div>
        )}

        <h2 className="mt-10 font-display text-xl font-bold text-ink">Users ({users.length})</h2>
        <div className="mt-3 overflow-x-auto rounded-card border border-surface-border">
          <table className="w-full min-w-[640px]">
            <thead className="bg-surface-raised">
              <tr><th className={th}>Username</th><th className={th}>Role</th><th className={th}>Solved</th><th className={th}>Attempts</th><th className={th}>Mocks</th><th className={th}>Joined</th><th className={th}>Last active</th><th className={th} /></tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className={td}>
                    <button type="button" className="text-accent hover:underline" onClick={() => { setFilterUser(u.id); setPage(0); }}>{u.username}</button>
                  </td>
                  <td className={td}>{u.role}</td>
                  <td className={td}>{u.solved}</td>
                  <td className={td}>{u.attempts}</td>
                  <td className={td}>{u.mocks}</td>
                  <td className={td}>{fmt(u.created_at)}</td>
                  <td className={td}>{fmt(u.last_seen_at)}</td>
                  <td className={td}>
                    <button type="button" className="text-xs text-ink-muted underline hover:text-ink" onClick={() => setRole(u, u.role === "admin" ? "user" : "admin")}>
                      {u.role === "admin" ? "Make user" : "Make admin"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-10 font-display text-xl font-bold text-ink">Audit log</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <select aria-label="Filter by user" value={filterUser} onChange={(e) => { setFilterUser(e.target.value); setPage(0); }} className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-ink">
            <option value="">All users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <select aria-label="Filter by action" value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(0); }} className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-ink">
            {ACTIONS.map((a) => <option key={a} value={a}>{a || "All actions"}</option>)}
          </select>
        </div>
        <div className="mt-3 overflow-x-auto rounded-card border border-surface-border">
          <table className="w-full min-w-[560px]">
            <thead className="bg-surface-raised">
              <tr><th className={th}>Time</th><th className={th}>User</th><th className={th}>Action</th><th className={th}>Detail</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{fmt(a.created_at)}</td>
                  <td className={td}>{name(a.user_id)}</td>
                  <td className={td}>{a.action}</td>
                  <td className={`${td} font-mono text-xs text-ink-muted`}>{Object.keys(a.detail).length ? JSON.stringify(a.detail) : ""}</td>
                </tr>
              ))}
              {!audit.length && <tr><td className={td} colSpan={4}>No events.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex gap-3 text-sm">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-surface-border px-3 py-1.5 disabled:opacity-50">Newer</button>
          <button type="button" disabled={!hasMore} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-surface-border px-3 py-1.5 disabled:opacity-50">Older</button>
        </div>
        <AdminSubmissions name={name} users={users} onChange={() => void loadAudit()} />
        <Moderation name={name} onChange={() => void loadAudit()} />
      </>
    );

  return (
    <Container>
      <Seo title="Admin" description="Admin dashboard." path="/admin" noindex />
      <PageHeader eyebrow="Admin" title="Users & audit" />
      {body}
    </Container>
  );
}
