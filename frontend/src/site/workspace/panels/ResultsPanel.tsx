import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { SampleTable } from "../../components/SampleTable";
import type { ExerciseSession } from "../useExerciseSession";
import type { RunOutcome } from "../types";

const STATUS_TEXT: Record<RunOutcome["status"], string> = { ok: "Ran without errors", error: "Stopped with an error", timeout: "Timed out", stopped: "Stopped" };

/** Run output, test verdict, and the "what went wrong" feedback. All of it comes from the adapter's real run and grading. */
export function ResultsPanel({ session: s }: { session: ExerciseSession }) {
  const { outcome: o, validation: v, feedback, internalError } = s;
  if (internalError) return <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{internalError}</p>;
  if (s.busy && !o) return <p role="status" className="text-sm text-ink-muted">{s.phase === "submitting" ? "Checking your answer..." : "Running..."}</p>;
  if (!o) return <p className="text-sm text-ink-muted" data-testid="results-empty">Nothing to show yet. Run your code to see its output here.</p>;
  return (
    <div className="space-y-3 text-sm" data-testid="workspace-results">
      {s.busy && <p role="status" className="text-xs text-ink-muted">{s.phase === "submitting" ? "Checking your answer..." : "Running..."}</p>}
      {s.stale && <p className="rounded-lg bg-surface-soft p-2 text-xs text-ink-muted">These results are from an earlier version of your code. Run again to refresh them.</p>}

      {v && (
        <div role="status" className={`flex items-start gap-2 rounded-lg border p-3 ${v.passed ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"}`}>
          {v.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span className="font-medium">{v.passed ? "Correct. All checks passed." : "Not yet. At least one check failed."}</span>
        </div>
      )}
      {v && v.tests.length > 0 && (
        <ul aria-label="Checks" className="space-y-1">
          {v.tests.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              {t.passed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-label="passed" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-label="failed" />}
              <span className="text-ink"><span className="font-medium">{t.hidden ? "Hidden test" : t.name}</span>{t.detail && !t.hidden ? <span className="text-ink-muted">: {t.detail}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}

      {feedback.length > 0 && (
        <section aria-label="Feedback" className="space-y-2">
          {feedback.map((f, i) => (
            <div key={i} className="rounded-lg border border-surface-border bg-surface p-3">
              <p className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-surface-soft px-2 py-0.5 font-semibold uppercase tracking-wider text-ink-muted">{f.category}</span>{f.line ? <span className="text-ink-faint">line {f.line}</span> : null}</p>
              <p className="mt-1 text-ink">{f.message}</p>
              {f.suggestion && <p className="mt-1 text-ink-muted">{f.suggestion}</p>}
            </div>
          ))}
        </section>
      )}

      <p className="text-xs text-ink-faint">{STATUS_TEXT[o.status]}{o.durationMs ? ` in ${o.durationMs} ms` : ""}</p>
      {o.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0 break-words"><p className="font-medium">{o.error.type ?? "Error"}{o.error.line ? ` (line ${o.error.line})` : ""}</p><p className="font-mono text-xs">{o.error.message}</p></div>
        </div>
      )}
      {o.table && o.table.columns.length > 0 && (
        <div>
          <SampleTable columns={o.table.columns} rows={o.table.rows} max={100} caption={`${o.table.rows.length} row${o.table.rows.length === 1 ? "" : "s"}${o.table.truncated ? " (more rows exist; showing the first rows)" : ""}`} />
        </div>
      )}
      {o.stdout ? <div><p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Output</p><pre tabIndex={0} className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface-soft p-3 font-mono text-xs text-ink">{o.stdout}</pre></div> : null}
      {o.stderr ? <div><p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Errors</p><pre tabIndex={0} className="mt-1 max-h-48 overflow-auto rounded-lg bg-danger/5 p-3 font-mono text-xs text-danger">{o.stderr}</pre></div> : null}
    </div>
  );
}
