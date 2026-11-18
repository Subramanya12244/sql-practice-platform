import { Suspense, lazy } from "react";
import type { VisualizerProps } from "../../types";
import type { SqlVisualizerProps } from "./SqlVisualizer";

const Inner = lazy(() => import("./SqlVisualizer").then((m) => ({ default: m.SqlVisualizer })));

/** The component the adapter module exports: loads the visualizer (cinema, plan, detail views) the first time it renders. */
export function Visualizer(props: VisualizerProps & Partial<Pick<SqlVisualizerProps, "hostPlayer">>) {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-ink-muted">Loading the query visualizer…</p>}>
      <Inner {...props} />
    </Suspense>
  );
}
