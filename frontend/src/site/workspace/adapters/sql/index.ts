/**
 * SQL adapter module (see docs/WORKSPACE_ARCHITECTURE.md "Adapter module convention"). Light on purpose: PGlite loads only when a
 * query runs, and the visualizer component loads when it first renders.
 */
import type { AdapterModule, ExecutionAdapter } from "../../types";
import { Visualizer } from "../../visualizers/sql/LazySqlVisualizer";
import { sqlAdapter } from "./adapter";

export { Visualizer };
export const adapter: ExecutionAdapter = sqlAdapter;
export const adapterModule: AdapterModule = {
  getAdapter: () => sqlAdapter,
  Visualizer,
};
export { createSqlAdapter, sqlAdapter, submitDetail, SQL_CAPABILITIES, SQL_LIMITATIONS, datasetOf, isGraded } from "./adapter";
export type { SqlAdapter, SqlAdapterOptions } from "./adapter";
export { browserBackend, createDbBackend, SqlBackendContext } from "./backend";
export type { SqlBackend } from "./backend";
export { buildSqlVisualModel, isSqlVisualData, whyNotVisualizable } from "./model";
export type { SqlVisualData } from "./model";
export { checkReadOnly, isSingleQuery, READ_ONLY_PREFIX } from "./safety";
export { checkSqlPolicy, checkSqlPolicyLexical, derivePolicy, isDeniedFunction, NORTHWIND_TABLES } from "./policy";
export type { PolicyOption, PolicySpec, PolicyVerdict, DerivedPolicy } from "./policy";
export { policyOf } from "./adapter";
export { classifyError, classifyMismatch, sqlFacts, CATEGORY } from "./failure";
export type { SqlExtras } from "./extras";
