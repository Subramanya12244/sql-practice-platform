/**
 * The SQL visualizer the exercise workspace shows: the original one, unchanged. It is the same `VizView` the question page and
 * /query-visualizer use (the animated Query Cinema with its rail of stages, rows moving between them, its own player, the logical
 * stages, structure and execution plan tabs). The workspace-specific wrapper (`SqlVisualizer`, with its extra detail panels and the
 * host-driven player) is still in this folder and still tested, but is no longer what the learner sees.
 *
 * It is `standalone`: it draws its own player, badge and notes, so the workspace panel adds none of its own and does not put it in
 * the height-limited box. Like the question page, it runs its own read-only EXPLAIN and row-trace queries for the statement the
 * learner ran (always rolled back); it never changes data.
 */
import { VizView } from "../../../components/VizView";
import { isSqlVisualData } from "../../adapters/sql/model";
import type { VisualizerProps } from "../../types";

export function ClassicSqlVisualizer({ model }: VisualizerProps) {
  if (!isSqlVisualData(model.data)) {
    return <p role="status" className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-ink-muted">This visualization has no SQL data to draw.</p>;
  }
  const { sql, dataset } = model.data;
  return <VizView key={`${dataset}:${sql}`} sql={sql} dataset={dataset} />;
}
