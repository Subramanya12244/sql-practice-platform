import { DataStageViewer } from "./DataStageViewer";
import type { VisualizerProps } from "../../types";

/** NumPy stages: arrays with shape, axes, element positions, broadcasting and matmul checks. Renders a `DataModelData`. */
export const NumpyVisualizer = (p: VisualizerProps) => <DataStageViewer {...p} />;
