import { CheckCircle2, XCircle } from "lucide-react";
import type { AttemptHistoryItem } from "../types";

export function AttemptHistory({ attempts }: { attempts: AttemptHistoryItem[] }) {
  if (attempts.length === 0) {
    return <p className="text-sm text-ink-faint">No attempts yet. Submit a solution to track history.</p>;
  }

  return (
    <ul className="space-y-3">
      {[...attempts].reverse().map((a) => (
        <li key={a.attempt_number} className="rounded border border-surface-border bg-surface p-2">
          <div className="mb-1 flex items-center gap-2 text-sm">
            <span className="font-medium text-ink">Attempt {a.attempt_number}</span>
            {a.is_correct ? (
              <span className="flex items-center gap-1 text-accent">
                <CheckCircle2 className="h-3.5 w-3.5" /> Correct
              </span>
            ) : (
              <span className="flex items-center gap-1 text-danger">
                <XCircle className="h-3.5 w-3.5" /> Incorrect
              </span>
            )}
            <span className="text-xs text-ink-faint">
              {a.execution_time_ms != null ? `${a.execution_time_ms} ms` : "—"}
            </span>
          </div>
          <pre className="max-h-32 overflow-auto rounded bg-surface-overlay p-2 font-mono text-[11px] text-ink-muted">
            {a.sql}
          </pre>
        </li>
      ))}
    </ul>
  );
}
