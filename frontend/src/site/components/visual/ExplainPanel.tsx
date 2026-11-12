import { useState } from "react";
import { Eye, Lightbulb } from "lucide-react";
import { LEVELS, commonMistake, explainLevel, type ExplainContext, type Level } from "../../lib/visual/explain";

/**
 * The common "Explain visually" actions for an exercise. Levels unlock one at a time and the full solution only appears when
 * the learner presses its own button. Explanations come from the learner's real code and run; nothing here is graded and
 * nothing is stored.
 */
export function ExplainPanel({ ctx, onVisualize, similar }: { ctx: ExplainContext; onVisualize?: () => void; similar?: { label: string; href: string } }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [mistake, setMistake] = useState(false);
  const idx = level ? LEVELS.findIndex((l) => l.id === level) : -1;
  const shown = LEVELS.slice(0, idx + 1).map((l) => explainLevel(l.id, ctx));
  const next = LEVELS[idx + 1];
  return (
    <section aria-label="Explain visually" className="space-y-2 rounded-xl border border-surface-border bg-surface-soft/50 p-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => { setLevel((l) => l ?? "concept"); onVisualize?.(); }} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"><Eye className="h-3.5 w-3.5" aria-hidden /> Explain visually</button>
        <button type="button" onClick={() => setLevel("detailed")} className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink">Why did this output happen?</button>
        <button type="button" onClick={() => setMistake((v) => !v)} aria-pressed={mistake} className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink">Show the common mistake</button>
        {similar && <a href={similar.href} className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-accent hover:underline">Another similar challenge: {similar.label}</a>}
      </div>
      {mistake && <p className="rounded-lg border border-warn/40 bg-warn-dim p-2 text-xs text-ink"><Lightbulb className="mr-1 inline h-3.5 w-3.5" aria-hidden />{commonMistake(ctx)}</p>}
      {shown.length > 0 && (
        <ol className="space-y-2" aria-label="Explanation steps">
          {shown.map((s) => (
            <li key={s.level} className="rounded-lg border border-surface-border bg-surface p-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{s.label}</p>
              {s.level === "solution" ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ink">{s.lines.join("\n")}</pre> : <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            </li>
          ))}
        </ol>
      )}
      {next && level && (
        <button type="button" onClick={() => setLevel(next.id)} className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink">
          {next.id === "solution" ? "I am ready to see the full solution explanation" : `Next: ${next.label}`}
        </button>
      )}
    </section>
  );
}
