/**
 * The shared contract of the SQL Practice visualizer upgrade (docs/SQL_VISUALIZER_UPGRADE_CONTRACT.md).
 * Owned by the coordinator. Agents consume these types and may not change them: ask the coordinator.
 *
 * One execution state, `ClassicStep`, is what every part of the visualizer renders from: the SQL highlight, the row board, the
 * intermediate tables, the explanation and the playback progress. It is derived once per playback index (see
 * components/visual/classic/useClassicStep.ts), so the five can never disagree.
 */
import type { Stage } from "../../visualize";
import type { FlowFrame } from "./rowFlow";

/** A table of real rows taken from the database. `rows` is a sample; `total` is the exact row count when it is known. */
export interface TableSnapshot {
  /** What the rows are, e.g. "products", "after WHERE", "removed by HAVING". */
  title: string;
  columns: string[];
  rows: unknown[][];
  total?: number;
  role: "input" | "output" | "removed" | "other";
}

export type TeachKind = "from" | "join" | "where" | "group" | "aggregate" | "having" | "select" | "distinct" | "window" | "order" | "limit" | "setop" | "subquery" | "cte";

/** What the learner is told at one step. Every number and value comes from real execution data (Stage, RowTrace), never from filler. */
export interface TeachCard {
  stageIndex: number;
  kind: TeachKind;
  /** Short name for the step rail: FROM, JOIN, WHERE, GROUP BY, SUM, HAVING, ORDER BY ... */
  label: string;
  /** One sentence naming the operation, using the learner's own clause text where there is one. */
  operation: string;
  what: string;
  changed: string;
  why: string;
  remember: string;
  inputs: TableSnapshot[];
  outputs: TableSnapshot[];
  rowsIn?: number;
  rowsOut?: number;
  /** Things the learner must not miss: NULL handling, a sample limit, an empty result, a stage that could not be run. */
  notes: string[];
  provenance: "executed" | "parsed";
}

/** The one state the whole visualizer renders from. */
export interface ClassicStep {
  index: number;
  count: number;
  stage: Stage;
  /** The active clause in the query text (offsets), for the SQL highlight. */
  range?: [number, number];
  /** The real rows moving at this step, when the trace has them. */
  frame?: FlowFrame;
  teach: TeachCard;
  /** 0..1, for the progress indicator. */
  progress: number;
  playing: boolean;
}
