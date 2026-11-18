import { DataStageViewer } from "./DataStageViewer";
import type { VisualizerProps } from "../../types";

/** pandas stages: DataFrames before and after each operation. Renders a `DataModelData` built by the data adapter. */
export const PandasVisualizer = (p: VisualizerProps) => <DataStageViewer {...p} />;
