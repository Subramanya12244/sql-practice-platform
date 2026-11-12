import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { HELP, PLAYBACK_CONTROLS, type HelpId } from "../../lib/visual/helpContent";

/**
 * Contextual Help for one visual module. Reads its content from lib/visual/helpContent.ts. Collapsed by default; includes the
 * shared playback controls and an optional guided walkthrough (one card at a time).
 */
export function VisualHelp({ id, className = "" }: { id: HelpId; className?: string }) {
  const h = HELP[id];
  const [tour, setTour] = useState<number | null>(null);
  const steps = h.walkthrough ?? [];
  return (
    <details className={`rounded-xl border border-surface-border bg-surface-soft/40 text-sm ${className}`} aria-label={`Help: ${h.title}`}>
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 font-medium text-accent"><HelpCircle className="h-4 w-4" aria-hidden /> Help: how {h.title} works</summary>
      <div className="space-y-3 px-3 pb-3 text-ink-muted">
        <p><strong className="text-ink">What it does.</strong> {h.what}</p>
        <div><p className="font-semibold text-ink">How to use it</p><ol className="list-decimal pl-5">{h.how.map((s) => <li key={s}>{s}</li>)}</ol></div>
        <div><p className="font-semibold text-ink">Controls</p>
          <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">{[...(h.controls ?? []), ...PLAYBACK_CONTROLS].map((c) => <div key={c.name} className="contents"><dt className="font-medium text-ink">{c.name}</dt><dd>{c.does}</dd></div>)}</dl></div>
        <div><p className="font-semibold text-ink">How to read what you see</p><ul className="list-disc pl-5">{h.reading.map((s) => <li key={s}>{s}</li>)}</ul></div>
        <div><p className="font-semibold text-ink">Common mistakes</p><ul className="list-disc pl-5">{h.mistakes.map((s) => <li key={s}>{s}</li>)}</ul></div>
        <p><strong className="text-ink">Example.</strong> {h.example}</p>
        {steps.length > 0 && (
          <div className="rounded-lg border border-surface-border bg-surface p-2">
            {tour === null ? <button type="button" onClick={() => setTour(0)} className="font-semibold text-accent hover:underline">Take the guided walkthrough ({steps.length} steps)</button> : (
              <div role="group" aria-label="Guided walkthrough">
                <p className="text-xs text-ink-faint">Step {tour + 1} of {steps.length}</p>
                <p className="font-semibold text-ink">{steps[tour].title}</p><p>{steps[tour].body}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={tour === 0} onClick={() => setTour(tour - 1)} className="rounded-lg border border-surface-border px-2 py-1 text-xs disabled:opacity-40">Back</button>
                  <button type="button" onClick={() => setTour(tour + 1 < steps.length ? tour + 1 : null)} className="rounded-lg border border-surface-border px-2 py-1 text-xs">{tour + 1 < steps.length ? "Next" : "Finish"}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
