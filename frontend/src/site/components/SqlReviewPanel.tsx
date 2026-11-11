import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { runQuery } from "../lib/browserDb";
import { runReview, type Basis, type SqlReview } from "../lib/sqlReview";

const BASIS: Record<Basis, { label: string; hint: string; cls: string }> = {
  verified: { label: "Verified", hint: "Checked by running the queries", cls: "bg-success-dim text-success" },
  heuristic: { label: "Heuristic", hint: "A rule applied to the SQL text; it can be wrong", cls: "bg-warn-dim text-warn" },
  info: { label: "Good to know", hint: "An explanation, not a claim about your query", cls: "bg-surface-soft text-ink-muted" },
};

/** Opt-in review after a correct submit. It never changes the grade; it labels how each finding was obtained. */
export function SqlReviewPanel({ sql, referenceSql, sortRequired, dataset }: { sql: string; referenceSql: string; sortRequired: boolean; dataset: string }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; review?: SqlReview }>({ status: "idle" });
  useEffect(() => setState({ status: "idle" }), [sql]); // a new submit starts a fresh review

  async function go() {
    setState({ status: "loading" });
    try {
      const review = await runReview({ sql, referenceSql, sortRequired, graderCorrect: true }, (q) => runQuery(q, dataset));
      setState({ status: "ready", review });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <section aria-label="Solution review" className="border-t border-surface-border bg-surface px-4 py-3 text-sm">
      {state.status === "idle" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ink-muted">Want feedback on how you wrote it? Takes a few seconds and runs the query a few times.</p>
          <button type="button" onClick={() => void go()} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Review my solution
          </button>
        </div>
      )}
      {state.status === "loading" && <p role="status" className="flex items-center gap-2 text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reviewing: running your query and the reference a few times...</p>}
      {state.status === "error" && (
        <p role="alert" className="text-danger">The review could not run. Your result is unaffected. <button type="button" onClick={() => void go()} className="underline">Try again</button></p>
      )}
      {state.status === "ready" && state.review && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-ink">Solution review</h3>
            <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="What the labels mean">
              {(Object.keys(BASIS) as Basis[]).map((b) => <li key={b} title={BASIS[b].hint} className={`rounded-full px-2 py-0.5 font-medium ${BASIS[b].cls}`}>{BASIS[b].label}</li>)}
            </ul>
          </div>
          {state.review.concepts.length > 0 && (
            <p className="text-xs text-ink-muted">Concepts in your query: {state.review.concepts.map((c) => <span key={c} className="mr-1 rounded bg-surface-soft px-1.5 py-0.5 text-ink">{c}</span>)}</p>
          )}
          <ul className="space-y-2">
            {state.review.findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-surface-border p-2.5">
                <p className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BASIS[f.basis].cls}`}>{BASIS[f.basis].label}</span><span className="font-medium text-ink">{f.title}</span></p>
                <p className="mt-1 text-ink-muted">{f.text}</p>
              </li>
            ))}
          </ul>
          {state.review.alternative && (
            <details className="rounded-lg border border-surface-border p-2.5">
              <summary className="cursor-pointer font-medium text-ink">Another way to write it ({state.review.alternative.approaches.join(" + ") || "different structure"})</summary>
              <p className="mt-2 text-xs"><span className={`rounded-full px-2 py-0.5 font-semibold ${state.review.alternative.sameRows ? BASIS.verified.cls : BASIS.info.cls}`}>{state.review.alternative.sameRows ? "Verified: returns the same rows" : "Not compared"}</span></p>
              <pre tabIndex={0} className="mt-2 max-h-48 overflow-auto rounded bg-surface-soft p-2 font-mono text-xs text-ink">{state.review.alternative.sql}</pre>
              <p className="mt-2 text-ink-muted">{state.review.alternative.tradeoff}</p>
            </details>
          )}
          <details className="text-xs text-ink-faint">
            <summary className="cursor-pointer">What this review does not cover</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{state.review.notAssessed.map((t) => <li key={t}>{t}</li>)}</ul>
            {state.review.measuredOn && <p className="mt-1">Measured on: {state.review.measuredOn}</p>}
          </details>
        </div>
      )}
    </section>
  );
}
