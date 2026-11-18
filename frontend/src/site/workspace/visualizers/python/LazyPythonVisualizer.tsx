import { Suspense, lazy } from "react";
import type { VisualizerProps } from "../../types";

const Inner = lazy(() => import("./PythonTraceVisualizer").then((m) => ({ default: m.PythonTraceVisualizer })));

/** The component the adapter module exports: loads the trace visualizer the first time it renders. */
export function Visualizer(props: VisualizerProps) {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-ink-muted">Loading the Python step viewer…</p>}>
      <Inner {...props} />
    </Suspense>
  );
}
