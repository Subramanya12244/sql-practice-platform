import { CheckCircle2, CircleSlash } from "lucide-react";
import { useProgress } from "../lib/progress";
import { historyFor } from "../lib/solveAnalytics";
import { formatDuration } from "../lib/solveSessions";

/** Every timed session for one challenge, newest first. Earlier results are never overwritten. */
export function SessionHistory({ sessionRef, className = "" }: { sessionRef: string; className?: string }) {
  const progress = useProgress();
  const rows = historyFor(progress.sessions ?? [], sessionRef);
  const solved = rows.filter((r) => r.status === "solved").length;
  return (
    <section aria-label="Solve sessions" className={className}>
      <h2 className="font-display text-lg font-bold text-ink">Solve sessions</h2>
      {!rows.length ? (
        <p className="mt-1 text-sm text-ink-muted">No finished sessions yet. The timer starts when you open a challenge; a session is saved when you solve it or end it.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-muted">{rows.length} session{rows.length === 1 ? "" : "s"} · {solved} solved. Each visit is its own attempt; earlier ones are kept.</p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-surface-border">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <caption className="sr-only">Previous solve sessions for this challenge</caption>
              <thead className="bg-surface-overlay text-ink-faint">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">Date</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Time</th>
                  <th scope="col" className="px-2 py-1.5 font-medium" title="Submissions graded">Attempts</th>
                  <th scope="col" className="px-2 py-1.5 font-medium" title="Every run of the editor">Runs</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Hints</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r) => (
                  <tr key={r.id} className="border-t border-surface-border">
                    <td className="px-2 py-1.5 text-ink-muted"><time dateTime={r.endedAt}>{new Date(r.endedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></td>
                    <td className="px-2 py-1.5 tabular-nums text-ink">{formatDuration(r.activeSec)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{r.attempts}</td>
                    <td className="px-2 py-1.5 tabular-nums">{r.executions}</td>
                    <td className="px-2 py-1.5 tabular-nums">{r.hints || "—"}</td>
                    <td className="px-2 py-1.5">
                      {r.status === "solved"
                        ? <span className="inline-flex items-center gap-1 font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Solved</span>
                        : <span className="inline-flex items-center gap-1 text-ink-muted"><CircleSlash className="h-3.5 w-3.5" aria-hidden /> Not solved</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
