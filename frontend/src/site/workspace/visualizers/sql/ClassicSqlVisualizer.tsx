/**
 * The SQL visualizer the exercise workspace shows: the same `VizView` the question page and /query-visualizer use (logical stages
 * with the shared playback bar, row movement, structure and execution plan tabs).
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
