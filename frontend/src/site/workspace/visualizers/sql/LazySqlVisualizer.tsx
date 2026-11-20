import { Suspense, lazy } from "react";
import type { VisualizerProps } from "../../types";

const Inner = lazy(() => import("./ClassicSqlVisualizer").then((m) => ({ default: m.ClassicSqlVisualizer })));

/**
 * The component the adapter module exports: loads the original Query Cinema view the first time it renders. `standalone` tells the
 * workspace panel that this visualizer draws its own player, badge and notes (see ClassicSqlVisualizer).
 */
export function Visualizer(props: VisualizerProps) {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-ink-muted">Loading the query visualizer…</p>}>
      <Inner {...props} />
    </Suspense>
  );
}
Visualizer.standalone = true as const;
