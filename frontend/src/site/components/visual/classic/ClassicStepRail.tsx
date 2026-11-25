/**
 * The labelled step rail: FROM → JOIN → WHERE → GROUP BY → ... one button per step, built from the teaching cards' labels.
 * Clicking a step seeks the playback (the host passes `onSeek`); the rail keeps no state of its own.
 */
import { memo } from "react";

function RailBase({ labels, titles, index, onSeek }: { labels: string[]; titles: string[]; index: number; onSeek: (i: number) => void }) {
  return (
    <ol className="vizc-rail" aria-label="Stages" data-testid="classic-step-rail" data-step-index={index}>
      {labels.map((label, i) => (
        <li key={i} className="vizc-rail-item">
          <button type="button" onClick={() => onSeek(i)} aria-current={i === index ? "step" : undefined} title={titles[i]} data-state={i < index ? "done" : i === index ? "active" : "todo"}
            className={`vizc-step rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${i === index ? "bg-accent text-white" : i < index ? "bg-accent-dim text-ink" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>
            {label}
          </button>
          {i < labels.length - 1 && <span className="vizc-rail-arrow text-ink-faint" aria-hidden>→</span>}
        </li>
      ))}
    </ol>
  );
}

export const ClassicStepRail = memo(RailBase);
