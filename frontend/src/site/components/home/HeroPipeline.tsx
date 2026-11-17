import { Link } from "react-router-dom";
import { BarChart3, Code2, Database, FileInput, Layers } from "lucide-react";
import type { ComponentType } from "react";

/**
 * The hero's visual: one dataset travelling through the stages of the work DataForge teaches. Every row opens the real
 * place to practise that stage. The line between rows is a CSS animation (stopped under reduced motion by the global rule).
 */
const STAGES: { icon: ComponentType<{ className?: string }>; label: string; line: string; to: string }[] = [
  { icon: FileInput, label: "Source", line: "CSV, JSON and database tables", to: "/etl-builder" },
  { icon: Database, label: "SQL", line: "Join, filter, group and window", to: "/questions" },
  { icon: Code2, label: "Python", line: "Clean, validate and transform", to: "/practice/python" },
  { icon: Layers, label: "Warehouse", line: "Model facts and dimensions, load", to: "/data-engineering" },
  { icon: BarChart3, label: "Insight", line: "Chart the answer to the question", to: "/visual/charts" },
];

export function HeroPipeline() {
  return (
    <div className="rounded-card border border-surface-border bg-surface-raised/80 p-4 shadow-soft backdrop-blur sm:p-5" data-testid="hero-pipeline">
      <div className="flex items-center justify-between gap-3">
        <p className="text-label uppercase text-ink-faint">From raw data to a decision</p>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden /> runs in your browser</span>
      </div>
      <ol className="mt-4" aria-label="Data pipeline stages">
        {STAGES.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.label} className="relative flex gap-3 pb-1">
              <div className="flex flex-col items-center">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent-dim text-accent"><Icon className="h-4 w-4" aria-hidden /></span>
                {i < STAGES.length - 1 && <span className="flow-line-v my-1 w-0.5 flex-1" aria-hidden />}
              </div>
              <Link to={s.to} className="group -mt-0.5 mb-3 block min-w-0 flex-1 rounded-lg px-2 py-1.5 transition-colors duration-fast hover:bg-hover/5">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-display text-h3 text-ink group-hover:text-accent">{s.label}</span>
                </span>
                <span className="block text-sm text-ink-muted">{s.line}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
