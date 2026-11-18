/**
 * Step over / into / out / back on a RECORDED Python trace. Pure TypeScript.
 *
 * This is a replay of what the tracer recorded, not a live debugger. Every rule uses only the recorded call depth
 * (`step.frames.length`) of recorded steps:
 * - into: the next recorded event.
 * - over: the next recorded event at depth <= the current depth (calls made by this line run, but are not stopped in).
 * - out: the next recorded event at depth < the current depth (the rest of this function runs, then we are in the caller).
 * - back: the previous recorded event (possible because the whole trace is recorded).
 * When the tracer sampled the run, a gap sits between two recorded steps. A move that would cross a gap is refused: the
 * skipped events do not exist in the trace, so which step is "next" is unknown. The result says so and offers an explicit
 * jump (labelled as a jump, not a step) to the first step after the gap.
 */
import type { Trace, TraceGap } from "./pyTrace";

export type StepMode = "into" | "over" | "out" | "back";

export type BlockReason = "gap" | "start" | "end" | "top-level" | "not-recorded";

export interface StepMove {
  mode: StepMode;
  from: number;
  /** Target step index, or null when the move is not available. */
  to: number | null;
  blocked?: { reason: BlockReason; gap?: TraceGap; /** Recorded step after the gap, reachable only by an explicit jump. */ jumpTo?: number };
  /** One sentence for the learner: what the move did or why it is unavailable. */
  explanation: string;
}

export const STEP_RULES: Record<StepMode, string> = {
  into: "Step into: the next recorded event.",
  over: "Step over: the next recorded event at the same or a shallower call depth, so a function called on this line runs without stopping inside it.",
  out: "Step out: the next recorded event at a shallower call depth, which is the caller once this function returns or raises.",
  back: "Step back: the previous recorded event. Possible because the whole trace is recorded.",
};

const depth = (t: Trace, i: number) => t.steps[i]?.frames.length ?? 0;

/** A gap between recorded steps `a` and `b` (a < b), including a break in event numbers with no gap record (hand-built traces). */
export function gapBetween(t: Trace, a: number, b: number): TraceGap | "unrecorded" | null {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (const g of t.gaps ?? []) if (g.after >= lo && g.before <= hi && g.before > g.after) return g;
  for (let k = lo; k < hi; k++) {
    const s = t.steps[k], n = t.steps[k + 1];
    if (s && n && s.seq !== undefined && n.seq !== undefined && n.seq !== s.seq + 1) return "unrecorded";
  }
  // The synthetic "end" step stands for the program's final state after tracing stopped, not for the next event.
  for (let k = lo + 1; k <= hi; k++) if (t.steps[k]?.ev === "end" && k > lo) return "unrecorded";
  return null;
}

function refuse(mode: StepMode, from: number, to: number, g: TraceGap | "unrecorded"): StepMove {
  const gap = g === "unrecorded" ? undefined : g;
  return {
    mode, from, to: null,
    blocked: { reason: g === "unrecorded" ? "not-recorded" : "gap", gap, jumpTo: to },
    explanation: `${mode === "back" ? "Step back" : `Step ${mode}`} is disabled here: the tracer sampled this stretch of the run, so the steps in between were not recorded and the real next step is unknown. You can jump to recorded step ${to + 1}, but that is a jump, not a step.`,
  };
}

export function move(t: Trace, from: number, mode: StepMode): StepMove {
  const n = t.steps.length;
  if (from < 0 || from >= n) return { mode, from, to: null, blocked: { reason: "not-recorded" }, explanation: "There is no recorded step here." };
  const d = depth(t, from);
  let to = -1;
  if (mode === "back") {
    if (from === 0) return { mode, from, to: null, blocked: { reason: "start" }, explanation: "This is the first recorded step." };
    to = from - 1;
  } else if (mode === "into") {
    if (from >= n - 1) return { mode, from, to: null, blocked: { reason: "end" }, explanation: "This is the last recorded step." };
    to = from + 1;
  } else {
    if (mode === "out" && d <= 1) return { mode, from, to: null, blocked: { reason: "top-level" }, explanation: "Already in the main program: there is no caller to step out to." };
    const stop = mode === "over" ? (x: number) => x <= d : (x: number) => x < d;
    for (let k = from + 1; k < n; k++) if (stop(depth(t, k))) { to = k; break; }
    if (to < 0) {
      // No qualifying event was recorded. Either the program ended (or raised) first, or a gap hides it.
      const g = t.gaps?.find((x) => x.after >= from);
      if (g) return refuse(mode, from, g.before, g);
      return { mode, from, to: null, blocked: { reason: "end" }, explanation: mode === "out" ? "This function does not return to its caller in the recorded trace (the program ended or raised first)." : "No later step at this depth was recorded: the program ended here." };
    }
  }
  const g = gapBetween(t, from, to);
  if (g) return refuse(mode, from, to, g);
  const dest = t.steps[to];
  const dd = depth(t, to);
  const where = dd > d ? `into a deeper call (depth ${dd})` : dd < d ? `back out to depth ${dd}` : `at depth ${dd}`;
  return { mode, from, to, explanation: `${STEP_RULES[mode]} Moved from step ${from + 1} to step ${to + 1} (${dest.ev} at line ${dest.line}, ${where}).` };
}

export const stepInto = (t: Trace, i: number) => move(t, i, "into");
export const stepOver = (t: Trace, i: number) => move(t, i, "over");
export const stepOut = (t: Trace, i: number) => move(t, i, "out");
export const stepBack = (t: Trace, i: number) => move(t, i, "back");

/** Availability of every move at step `i`, for enabling and disabling buttons. */
export function availableMoves(t: Trace, i: number): Record<StepMode, StepMove> {
  return { into: stepInto(t, i), over: stepOver(t, i), out: stepOut(t, i), back: stepBack(t, i) };
}
