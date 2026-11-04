import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Heart, MessageSquare, Users } from "lucide-react";
import { Markdown } from "./Markdown";
import { useAuth } from "../lib/auth";
import { useProgress } from "../lib/progress";
import {
  addComment, deleteComment, listComments, listSolutions, setHidden, shareSolution, toggleLike,
  type CommentRow, type SolutionRow,
} from "../lib/community";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function SignInPrompt({ what }: { what: string }) {
  return (
    <p className="text-sm text-ink-muted">
      <Link to="/login" className="text-accent underline">Sign in</Link> to {what}.
    </p>
  );
}

/** Other people's solutions. Only shown once you have solved the question yourself. */
export function CommunitySolutions({ number }: { number: number }) {
  const { enabled, session, profile } = useAuth();
  const progress = useProgress();
  const solved = Boolean(progress.questions[number]?.solvedAt);
  const [rows, setRows] = useState<SolutionRow[] | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (session && solved) listSolutions(number).then(setRows).catch((e: Error) => setMsg(e.message));
  }, [session, solved, number]);
  useEffect(load, [load]);

  if (!enabled) return null;
  const mine = rows?.find((r) => r.mine);
  const lastSql = progress.questions[number]?.lastSql;

  return (
    <section aria-labelledby="community-solutions" className="mt-10">
      <h2 id="community-solutions" className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-ink">
        <Users className="h-5 w-5" aria-hidden /> Community solutions
      </h2>
      {!session ? <SignInPrompt what="see how others solved this" /> : !solved ? (
        <p className="text-sm text-ink-muted">Solve it first — other people's answers unlock after your own correct submit.</p>
      ) : (
        <>
          {!mine && lastSql && (
            <form
              className="mb-4 flex flex-wrap items-center gap-2 text-sm"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                try {
                  await shareSolution(session.user.id, number, lastSql, note);
                  setNote("");
                  load();
                } catch (ex) {
                  setMsg((ex as Error).message);
                }
              }}
            >
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional note about your approach" aria-label="Note"
                className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface px-3 py-1.5 text-ink" />
              <button className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">Share my solution</button>
            </form>
          )}
          {msg && <p role="alert" className="mb-2 text-sm text-danger">{msg}</p>}
          {rows && !rows.length && <p className="text-sm text-ink-muted">No shared solutions yet — be the first.</p>}
          <ul className="space-y-3">
            {rows?.map((r) => (
              <li key={r.id} className="rounded-card border border-surface-border bg-surface-raised p-3">
                <div className="flex items-center gap-2 text-xs text-ink-faint">
                  <Link to={`/u/${r.username}`} className="font-semibold text-ink hover:underline">{r.username}</Link>
                  <span>{when(r.created_at)}</span>
                  <button
                    type="button"
                    disabled={r.mine}
                    aria-pressed={r.liked}
                    onClick={() => toggleLike(session.user.id, r.id, r.liked).then(load).catch((e: Error) => setMsg(e.message))}
                    className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${r.liked ? "text-danger" : "hover:text-ink"} disabled:opacity-60`}
                  >
                    <Heart className={`h-3.5 w-3.5 ${r.liked ? "fill-current" : ""}`} aria-hidden /> {r.likes}
                  </button>
                  {profile?.role === "admin" && !r.mine && (
                    <button type="button" className="underline" onClick={() => setHidden("solutions", r.id, true).then(load)}>Hide</button>
                  )}
                </div>
                {r.note && <p className="mt-1 text-sm text-ink-muted">{r.note}</p>}
                <Markdown source={"```sql\n" + r.sql + "\n```"} className="mt-2 text-sm" />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function Comments({ number }: { number: number }) {
  const { enabled, session, profile } = useAuth();
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    if (enabled) listComments(number).then(setRows).catch(() => undefined);
  }, [enabled, number]);
  useEffect(load, [load, session]);
  if (!enabled) return null;

  return (
    <section aria-labelledby="discussion" className="mt-10">
      <h2 id="discussion" className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-ink">
        <MessageSquare className="h-5 w-5" aria-hidden /> Discussion ({rows.length})
      </h2>
      <p className="mb-3 text-xs text-ink-faint">No full solutions here, please — share those under Community solutions.</p>
      <ul className="space-y-3">
        {rows.map((c) => (
          <li key={c.id} className={`rounded-card border border-surface-border p-3 ${c.hidden ? "opacity-60" : "bg-surface-raised"}`}>
            <div className="flex items-center gap-2 text-xs text-ink-faint">
              <Link to={`/u/${c.username}`} className="font-semibold text-ink hover:underline">{c.username}</Link>
              <span>{when(c.created_at)}</span>
              {c.hidden && <span className="text-danger">hidden</span>}
              <span className="ml-auto flex gap-2">
                {c.mine && <button type="button" className="underline" onClick={() => deleteComment(c.id).then(load)}>Delete</button>}
                {profile?.role === "admin" && !c.mine && (
                  <button type="button" className="underline" onClick={() => setHidden("comments", c.id, !c.hidden).then(load)}>
                    {c.hidden ? "Unhide" : "Hide"}
                  </button>
                )}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{c.body}</p>
          </li>
        ))}
      </ul>
      {!session ? <div className="mt-3"><SignInPrompt what="join the discussion" /></div> : (
        <form
          className="mt-3"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (!body.trim()) return;
            try {
              await addComment(session.user.id, number, body);
              setBody("");
              setMsg(null);
              load();
            } catch (ex) {
              setMsg((ex as Error).message);
            }
          }}
        >
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} aria-label="Comment"
            placeholder="Ask a question or share a tip…" className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-ink" />
          {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
          <button className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white">Post</button>
        </form>
      )}
    </section>
  );
}
