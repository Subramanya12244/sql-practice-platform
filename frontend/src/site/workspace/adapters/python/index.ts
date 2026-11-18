/**
 * Python adapter module (see docs/WORKSPACE_ARCHITECTURE.md "Adapter module convention"). Light on purpose: Pyodide loads only when code
 * runs, and the visualizer component loads when it first renders.
 */
import type { AdapterModule, ExecutionAdapter } from "../../types";
import { Visualizer } from "../../visualizers/python/LazyPythonVisualizer";
import { pythonAdapter } from "./adapter";

export { Visualizer };
export const adapter: ExecutionAdapter = pythonAdapter;
export const adapterModule: AdapterModule = {
  getAdapter: () => pythonAdapter,
  Visualizer,
};
export { createPythonAdapter, pythonAdapter, PYTHON_CAPABILITIES, PYTHON_LIMITATIONS, stdinOf, toRunOutcome } from "./adapter";
export type { PythonAdapter, PythonAdapterOptions } from "./adapter";
export { buildPythonVisualModel, isPythonVisualData, untraceableReason } from "./model";
export type { PythonVisualData } from "./model";
export { diagnosisToFeedback, explainPythonFailure, learnerLine, scrubTestFrames, taskFailureFeedback, PY_CATEGORY } from "./failure";
