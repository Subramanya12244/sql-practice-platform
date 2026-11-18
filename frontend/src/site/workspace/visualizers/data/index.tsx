import { DataStageViewer } from "./DataStageViewer";
import { PandasVisualizer } from "./PandasVisualizer";
import { NumpyVisualizer } from "./NumpyVisualizer";
import type { DataModelData } from "../../../lib/visual/dataframe";
import type { VisualizerProps } from "../../types";

export { PandasVisualizer, NumpyVisualizer, DataStageViewer };

/** The module's single Visualizer: picks the pandas or NumPy wrapper from the model the adapter built. */
export function DataVisualizer(p: VisualizerProps) {
  const domain = (p.model.data as DataModelData | undefined)?.domain;
  return domain === "numpy" ? <NumpyVisualizer {...p} /> : <PandasVisualizer {...p} />;
}
