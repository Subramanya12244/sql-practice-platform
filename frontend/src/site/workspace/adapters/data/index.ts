/**
 * Data adapter module: serves the `pandas` and `numpy` domains (see docs/WORKSPACE_ARCHITECTURE.md). Light on purpose: Pyodide loads only
 * when code runs and the visualizer loads when it first renders.
 */
import type { AdapterModule, Domain, ExecutionAdapter } from "../../types";
import { Visualizer } from "../../visualizers/data/LazyDataVisualizer";
import { numpyAdapter, pandasAdapter } from "./adapter";

export { Visualizer };
export const adapterModule: AdapterModule = {
  getAdapter(domain: Domain): ExecutionAdapter {
    if (domain === "numpy") return numpyAdapter;
    if (domain === "pandas") return pandasAdapter;
    throw new Error(`The data module serves pandas and numpy, not ${domain}.`);
  },
  Visualizer,
};
export { createDataAdapter, pandasAdapter, numpyAdapter, outcomeFromProbe, isDataRunRaw, PANDAS_CAPABILITIES, NUMPY_CAPABILITIES, PANDAS_LIMITATIONS, NUMPY_LIMITATIONS } from "./adapter";
export type { DataAdapter, DataAdapterOptions, DataDomain, DataRunRaw } from "./adapter";
export { explainDataFailure, compareWithExpectation, DATA_CATEGORY } from "./failure";
