/**
 * The single execution state of the SQL Practice visualizer. OWNER: Agent 4 (animation, interaction and accessibility).
 *
 * `useClassicStep` turns the playback index into ONE `ClassicStep`. The SQL highlight, the row board, the intermediate tables, the
 * explanation and the progress indicator all read that object, so a step change (button, step rail, keyboard or the playback timer)
 * changes all of them in the same render. Nothing else may keep its own copy of the step.
 */
import { useMemo } from "react";
import type { Stage, Visualization } from "../../../lib/visualize";
import type { RowTrace } from "../../../lib/visual/classic/rowTrace";
import type { ClassicStep } from "../../../lib/visual/classic/contract";
import { buildTeach } from "../../../lib/visual/classic/teach";
import { baseFrame } from "../../../lib/visual/classic/rowFlow";

export function clauseRange(v: Visualization, stage: Stage): [number, number] | undefined {
  if (stage.range) return stage.range;
  const key = stage.clause === "distinct" || stage.clause === "window" ? "select" : stage.clause === "limit" ? (v.parsed.ranges.limit ? "limit" : "offset") : stage.clause;
  return v.parsed.ranges[key as keyof typeof v.parsed.ranges];
}

/** The step a playback index points at, kept inside 0..count-1. */
export const clampStep = (index: number, count: number) => Math.min(Math.max(0, Math.trunc(index) || 0), Math.max(0, count - 1));

type StepBase = Omit<ClassicStep, "playing">;

/**
 * Everything the screen shows for the playback index `pb.index`, derived once so the highlight, the board, the tables, the text and
 * the progress agree. The expensive part (the teaching card and the row frame) depends on the index and the data only, so pressing
 * Play or Pause does not rebuild it; the board's frame is the same object for as long as the step does not change, which is what
 * lets the row animation tell "same step" from "new step".
 */
export function useClassicStep(viz: Visualization | null, trace: RowTrace | undefined, pb: { index: number; count: number; playing: boolean }): ClassicStep | null {
  const count = viz?.stages.length ?? 0;
  const index = clampStep(pb.index, count);
  const base = useMemo<StepBase | null>(() => {
    if (!viz || !viz.stages.length) return null;
    const stage = viz.stages[index];
    return {
      index, count: viz.stages.length, stage, range: clauseRange(viz, stage),
      frame: trace?.frames[index] ?? baseFrame(stage, viz.stages[index - 1], index),
      teach: buildTeach(viz, trace, index),
      progress: viz.stages.length > 1 ? index / (viz.stages.length - 1) : 1,
    };
  }, [viz, trace, index]);
  return useMemo(() => (base ? { ...base, playing: pb.playing } : null), [base, pb.playing]);
}
