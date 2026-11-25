/**
 * The four answers for the current step: What is happening? What changed? Why did it happen? What should I remember?
 * Text comes from the teaching card; the fallbacks in stepCopy.ts only fill the two conceptual answers when the card has none.
 */
import { memo } from "react";
import type { TeachCard } from "../../../lib/visual/classic/contract";
import { rememberFallback, whyFallback } from "./stepCopy";

function changedText(c: TeachCard): string {
  if (c.changed) return c.changed;
  if (c.rowsIn !== undefined && c.rowsOut !== undefined) return `${c.rowsIn.toLocaleString()} ${c.rowsIn === 1 ? "row" : "rows"} in, ${c.rowsOut.toLocaleString()} ${c.rowsOut === 1 ? "row" : "rows"} out.`;
  return "This step does not report a row count.";
}

function ExplainBase({ card, index }: { card: TeachCard; index: number }) {
  const items: [string, string][] = [
    ["What is happening?", card.what],
    ["What changed?", changedText(card)],
    ["Why did it happen?", card.why || whyFallback(card.kind)],
    ["What should I remember?", card.remember || rememberFallback(card.kind)],
  ];
  return (
    <section data-testid="classic-explain" data-step-index={index} aria-label="Explanation of this step" className="vizc-explain min-w-0">
      <h3 className="text-sm font-semibold text-ink">{card.operation}</h3>
      <dl className="vizc-answers mt-2">
        {items.map(([q, a], i) => (
          <div key={q} className="vizc-answer">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{q}</dt>
            <dd className={`mt-0.5 leading-snug text-ink ${i === 0 ? "vizc-lead font-medium" : "text-sm"}`}>{a}</dd>
          </div>
        ))}
      </dl>
      {card.notes.length > 0 && (
        <div className="mt-3" data-testid="classic-notes">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Notes</p>
          <ul className="mt-0.5 space-y-1 border-l-2 border-warn/60 pl-2 text-xs text-ink-muted">
            {card.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

export const ClassicExplain = memo(ExplainBase);
