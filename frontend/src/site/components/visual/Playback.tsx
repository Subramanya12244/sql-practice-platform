import { useEffect, useReducer, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { PROVENANCE_LABEL, SPEEDS, frameDelay, initialPlayback, keyAction, playbackReducer, type Provenance, type Speed } from "../../lib/visual/playback";

/** Player state for `count` frames. Auto-advance runs on a timer; reduced motion never auto-plays by itself. */
export function usePlayback(count: number) {
  const [s, dispatch] = useReducer(playbackReducer, count, initialPlayback);
  useEffect(() => { dispatch({ type: "count", count }); }, [count]);
  useEffect(() => {
    if (!s.playing) return;
    const t = window.setTimeout(() => dispatch({ type: "tick" }), frameDelay(s.speed));
    return () => window.clearTimeout(t);
  }, [s.playing, s.index, s.speed]);
  return { ...s, dispatch };
}

export function ProvenanceBadge({ p }: { p: Provenance }) {
  const b = PROVENANCE_LABEL[p];
  return <span title={b.title} className="rounded-full bg-surface-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{b.label}</span>;
}

const btn = "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg border border-surface-border px-2 text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-40 focus-visible:outline-2";

/** Play, pause, step, restart, speed and a scrubber. Keyboard: Space, arrows, Home, End (when the bar has focus). */
export function PlaybackBar({ pb, labels }: { pb: ReturnType<typeof usePlayback>; labels?: string[] }) {
  const { index, count, playing, speed, dispatch } = pb;
  return (
    <div role="group" aria-label="Playback controls" tabIndex={0} className="space-y-2 rounded-xl border border-surface-border bg-surface-raised p-2"
      onKeyDown={(e) => { const a = keyAction(e.key); if (a && (e.target as HTMLElement).tagName !== "SELECT") { e.preventDefault(); dispatch(a); } }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={btn} onClick={() => dispatch({ type: "restart" })} disabled={count === 0} aria-label="Restart"><RotateCcw className="h-3.5 w-3.5" aria-hidden /></button>
        <button type="button" className={btn} onClick={() => dispatch({ type: "prev" })} disabled={index === 0} aria-label="Previous step"><ChevronLeft className="h-3.5 w-3.5" aria-hidden /></button>
        <button type="button" className={`${btn} bg-accent text-white hover:text-white`} onClick={() => dispatch({ type: "toggle" })} disabled={count === 0} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}{playing ? "Pause" : "Play"}
        </button>
        <button type="button" className={btn} onClick={() => dispatch({ type: "next" })} disabled={index >= count - 1} aria-label="Next step"><ChevronRight className="h-3.5 w-3.5" aria-hidden /></button>
        <label className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint">Speed
          <select aria-label="Playback speed" value={speed} onChange={(e) => dispatch({ type: "speed", speed: Number(e.target.value) as Speed })} className="rounded-md border border-surface-border bg-surface px-1 py-0.5 text-xs text-ink">
            {SPEEDS.map((v) => <option key={v} value={v}>{v}x</option>)}
          </select>
        </label>
        <span role="status" aria-live="polite" className="text-xs tabular-nums text-ink-muted">Step {count ? index + 1 : 0} of {count}</span>
      </div>
      <input type="range" min={0} max={Math.max(0, count - 1)} value={index} onChange={(e) => dispatch({ type: "seek", index: Number(e.target.value) })} disabled={count < 2}
        aria-label="Timeline" aria-valuetext={labels?.[index] ?? `Step ${index + 1} of ${count}`} className="w-full accent-[var(--color-accent,#6366f1)]" />
    </div>
  );
}

/**
 * Common layout: workspace (code, statement) on the left, visual on the right, timeline and controls underneath.
 * Stacks on small screens. Used by every visualizer so they feel like one tool.
 */
export function VisualShell({ left, right, bottom }: { left: ReactNode; right: ReactNode; bottom: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">{left}</div>
        <div className="min-w-0 space-y-3">{right}</div>
      </div>
      {bottom}
    </div>
  );
}
