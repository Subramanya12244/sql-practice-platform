import type { ComponentType } from "react";
import { Eye } from "lucide-react";
import { PlaybackBar, ProvenanceBadge } from "../../components/visual/Playback";
import { MotionToggle } from "../../components/visual/MotionToggle";
import type { ExerciseSession } from "../useExerciseSession";
import type { ExecutionAdapter, ExerciseDef, VisualizerProps } from "../types";
import { btnSecondary, PanelBoundary } from "./chrome";

/**
 * Hosts an adapter's visualizer. The visualizer never runs by itself: it is built from the learner's real run when they ask, sits in a
 * height-limited box so it cannot push the editor away, and the player controls appear only when the adapter can step and the model has steps.
 */
export function VisualizationPanel({ exercise: ex, adapter, Visualizer, session: s }: {
  exercise: ExerciseDef; adapter: ExecutionAdapter | null; Visualizer?: ComponentType<VisualizerProps>; session: ExerciseSession;
}) {
  const limits = adapter?.limitations?.length ? (
    <details className="text-xs text-ink-muted">
      <summary className="cursor-pointer font-medium text-ink">Not supported here</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{adapter.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </details>
  ) : null;

  if (!s.canVisualize) {
    return (
      <div className="space-y-2 text-sm" data-testid="workspace-visual">
        <p className="text-ink-muted">{ex.visualization?.enabled === false ? ex.visualization.note ?? "This exercise has no visualization." : "This exercise has no step-by-step visualization. The Results panel shows what your code produced."}</p>
        {limits}
      </div>
    );
  }
  const v = s.visual;
  const model = v.status === "ready" ? v.model : null;
  // A standalone visualizer (the SQL Query Cinema) draws its own player, badge, notes and layout: the panel adds none of them.
  const standalone = !!(Visualizer as { standalone?: boolean } | undefined)?.standalone;
  return (
    <div className="space-y-3 text-sm" data-testid="workspace-visual">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} onClick={() => void s.visualize()} disabled={s.busy}><Eye className="h-4 w-4" aria-hidden />{model ? "Rebuild from my code" : "Visualize my run"}</button>
        {!standalone && <MotionToggle className="ml-auto" />}
      </div>
      {ex.visualization?.note && <p className="text-xs text-ink-muted">{ex.visualization.note}</p>}
      {v.status === "idle" && <p className="text-ink-muted">Run your code, then press Visualize to see it step by step. The view is built from your own run, never from a canned example.</p>}
      {v.status === "loading" && <p role="status" className="text-ink-muted">Building the view from your run...</p>}
      {(v.status === "unavailable" || v.status === "error") && <p role="status" className="rounded-lg bg-surface-soft p-3 text-ink-muted">{v.status === "error" ? `The view could not be built: ${v.message}` : v.message}</p>}
      {model && (
        <>
          <div className="flex flex-wrap items-center gap-2">{!standalone && <ProvenanceBadge p={model.provenance} />}{s.stale && <span className="text-xs text-ink-faint">Built from an earlier version of your code.</span>}</div>
          {!standalone && model.notes?.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-muted">{model.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
          {Visualizer ? (
            <PanelBoundary label="The visualization">
              <div className={standalone ? "min-w-0" : "max-h-[60vh] overflow-auto rounded-lg border border-surface-border bg-surface p-2"} data-testid="visualizer-box">
                <Visualizer model={model} step={s.pb.index} onStepChange={(i) => s.pb.dispatch({ type: "seek", index: i })} reducedMotion={s.reducedMotion} hostPlayer={s.steppable && !standalone} />
              </div>
            </PanelBoundary>
          ) : <p className="text-ink-muted">This engine built the steps but has no viewer for them yet.</p>}
          {s.steppable && !standalone && <PlaybackBar pb={s.pb} />}
        </>
      )}
      {limits}
    </div>
  );
}
