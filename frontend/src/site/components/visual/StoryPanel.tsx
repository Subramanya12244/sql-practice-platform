import { STORY_PARTS, type StepStory } from "../../lib/visual/story";

/**
 * The four answers for the current step. It is the same panel in every domain, so a learner who knows how to read the Python
 * steps already knows how to read the Pandas and NumPy ones. It only draws: the text comes from a `StepStory` built from the
 * engine's recorded data. `stepKey` restarts the short entrance animation when the step changes (never when it only re-renders);
 * with `reduced` (the visualizer's reduced-motion setting, which includes the in-page switch) the entrance class is left off, and the
 * text is identical either way. The live region announces the
 * "what" sentence to screen readers when the step changes (it is the `dd` of the first card, not a hidden duplicate).
 */
export function StoryPanel({ story, stepKey, step, total, heading, reduced = false }: { story: StepStory; stepKey: string | number; step?: number; total?: number; heading?: string; reduced?: boolean }) {
  return (
    <section aria-label="What this step teaches" data-testid="step-story" data-step-key={String(stepKey)} className="space-y-2">
      {(heading || (step !== undefined && total !== undefined)) && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-faint">
          {step !== undefined && total !== undefined && <span className="font-semibold uppercase tracking-wider">Step {step} of {total}</span>}
          {heading && <span className="min-w-0 break-words font-mono text-ink-muted">{heading}</span>}
        </p>
      )}
      <dl className="grid gap-2 sm:grid-cols-2">
        {STORY_PARTS.map(({ key, title }) => (
          <div key={key} data-story={key} className={`rounded-lg border p-2.5 ${key === "remember" ? "border-accent/30 bg-accent-dim" : "border-surface-border bg-surface-soft/60"}`}>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{title}</dt>
            {/* The "what" sentence is the live region: it stays mounted, so a screen reader announces each change. Only the text inside is re-keyed to replay the entrance. */}
            <dd className="mt-1 text-xs leading-relaxed text-ink" {...(key === "what" ? { "aria-live": "polite" as const, "aria-atomic": true } : {})}>
              <span key={String(stepKey)} className={reduced ? "block" : "df-step block"}>{story[key]}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
