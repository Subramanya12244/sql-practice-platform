import { Suspense, lazy } from "react";
import type { VisualizerProps } from "../../types";

const Inner = lazy(() => import("./index").then((m) => ({ default: m.DataVisualizer })));

/** Loads the pandas/NumPy visual code (tables, arrays, broadcasting) only when a visualization is first shown. */
export function Visualizer(props: VisualizerProps) {
  return <Suspense fallback={<p className="text-xs text-ink-faint" role="status">Loading the visual…</p>}><Inner {...props} /></Suspense>;
}
