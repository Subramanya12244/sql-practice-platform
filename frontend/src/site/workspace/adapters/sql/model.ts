/**
 * Builds the SQL VisualModel from the existing query visualizer engine: `visualize()` (stages with exact counts), `traceRows()` (real
 * rows with identity for the animations), the parsed structure, and PostgreSQL's plan, plus
 * `buildExtras()` for detail the stage view does not draw. Returns null when the engine cannot stage the query accurately.
 */
import type { ExecuteResult } from "../../../../types";
import { analyze, type Structure } from "../../../lib/sqlAst";
import { traceRows, type RowTrace } from "../../../lib/visual/rowTrace";
import { visualize, SAMPLE, type Run, type Visualization } from "../../../lib/visualize";
import { parsePlan, type PlanNode } from "../../../components/PlanTree";
import type { VisualModel } from "../../types";
import { buildExtras, emptyExtras, type SqlExtras } from "./extras";
import { isSingleQuery } from "./safety";

export interface SqlPlanData { node: PlanNode | null; error?: string }

/** `VisualModel.data` of the SQL adapter. */
export interface SqlVisualData {
  version: 1;
  /** The statement that was visualized (trimmed, no trailing semicolon). */
  sql: string;
  dataset: string;
  viz: Visualization;
  trace?: RowTrace;
  structure: Structure | null;
  /** `EXPLAIN (FORMAT JSON)`: the planner's choice with its estimates. Measured actuals come only from EXPLAIN ANALYZE, on request. */
  plan: SqlPlanData;
  extras: SqlExtras;
  /** Number of logical stages (equals `VisualModel.steps`). */
  stepCount: number;
}

/** Why a query was not visualized (for the adapter's notes); null when it can be. */
export function whyNotVisualizable(sql: string): string | null {
  if (!sql.trim()) return "There is no query to visualize.";
  if (!isSingleQuery(sql)) return "Only one SELECT (or WITH ... SELECT, or UNION / INTERSECT / EXCEPT) statement can be visualized.";
  return null;
}

export async function buildSqlVisualModel(sql: string, run: Run, dataset: string): Promise<VisualModel | null> {
  const body = sql.trim().replace(/;\s*$/, "");
  if (whyNotVisualizable(body)) return null;
  const counted: Run = run;
  const viz = await visualize(body, counted);
  if (viz.unsupported || !viz.stages.length) return null;
  // The learner's own query failed: there is nothing real to stage. (The run itself reports the error.)
  if (!viz.final) return null;

  const volatile = Boolean(viz.volatile?.length);
  const [structure, plan] = await Promise.all([
    analyze(body).catch(() => null),
    (async (): Promise<SqlPlanData> => {
      const ex: ExecuteResult = await run(`EXPLAIN (FORMAT JSON) ${body}`);
      return ex.success ? { node: parsePlan(ex.rows[0]?.[0]) } : { node: null, error: ex.message ?? "EXPLAIN failed" };
    })(),
  ]);
  let trace: RowTrace | undefined;
  try { trace = await traceRows(body, run, viz); } catch { trace = undefined; }
  let extras = emptyExtras();
  try { extras = await buildExtras({ body, parsed: viz.parsed, structure, run, volatile }); } catch (e) { extras.notes.push(e instanceof Error ? e.message : String(e)); }

  const stepCount = viz.stages.length;
  const notes = [
    "Logical order: how SQL defines the result, one clause at a time. PostgreSQL may run the query differently (see Plan); the result is the same.",
    `Counts are exact. Boards draw a sample of at most ${SAMPLE} rows per stage.`,
    ...(volatile ? [`The query uses ${viz.volatile!.join(", ")}, which return different values on each run, so only the explanation is shown, not row data.`] : []),
    ...(trace?.notes ?? []),
    ...extras.notes,
  ];
  const data: SqlVisualData = { version: 1, sql: body, dataset, viz, trace, structure, plan, extras, stepCount };
  return { provenance: volatile ? "parsed" : "executed", data, steps: stepCount, notes };
}

export const isSqlVisualData = (d: unknown): d is SqlVisualData =>
  !!d && typeof d === "object" && (d as SqlVisualData).version === 1 && typeof (d as SqlVisualData).sql === "string" && !!(d as SqlVisualData).viz;
