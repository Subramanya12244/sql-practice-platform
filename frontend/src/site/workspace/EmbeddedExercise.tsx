/**
 * Host component for pages that are not an exercise page (Daily Learning lessons, Learn hub topics). Give it an id or a finished
 * ExerciseDef. Compact mode stacks the panes, starts with help closed, and waits for "Open the exercise" before loading content or
 * an engine, so a lesson with many exercises stays light. Full mode is the whole split-pane workspace.
 *
 * Needs a Router above it (the statement renderer uses it), like every other page component.
 */
import { useEffect, useState } from "react";
import { ExerciseWorkspace, type ExerciseWorkspaceProps } from "./ExerciseWorkspace";
import { loadExerciseById } from "./sources";
import { btnPrimary } from "./panels/chrome";
import type { ExerciseDef } from "./types";

export interface EmbeddedExerciseProps extends Omit<ExerciseWorkspaceProps, "exercise" | "compact"> {
  exerciseId?: string;
  exercise?: ExerciseDef;
  mode?: "compact" | "full";
  /** Compact mode waits for a click by default. Set false to load immediately. */
  defer?: boolean;
  /** Replaces the loader (tests, previews). */
  load?: (id: string) => Promise<ExerciseDef | null>;
}

type Loaded = { status: "idle" } | { status: "loading" } | { status: "missing" } | { status: "ready"; exercise: ExerciseDef };

export function EmbeddedExercise({ exerciseId, exercise, mode = "compact", defer, load = loadExerciseById, ...rest }: EmbeddedExerciseProps) {
  const compact = mode === "compact";
  const [opened, setOpened] = useState(!(defer ?? compact));
  const [state, setState] = useState<Loaded>(exercise ? { status: "ready", exercise } : { status: "idle" });

  useEffect(() => {
    if (exercise) { setState({ status: "ready", exercise }); return; }
    if (!opened || !exerciseId) return;
    let alive = true;
    setState({ status: "loading" });
    void load(exerciseId).then((e) => { if (alive) setState(e ? { status: "ready", exercise: e } : { status: "missing" }); });
    return () => { alive = false; };
  }, [exercise, exerciseId, opened, load]);

  if (!exercise && !exerciseId) return <p role="status" className="text-sm text-ink-muted">No exercise was given.</p>;
  if (!opened && state.status !== "ready") {
    return (
      <div className="rounded-xl border border-surface-border bg-surface-raised p-4 text-sm" data-testid="embedded-closed">
        <p className="text-ink-muted">Practice this in the exercise workspace: write code, run it, check it, and open help one level at a time.</p>
        <button type="button" className={`${btnPrimary} mt-2`} onClick={() => setOpened(true)}>Open the exercise</button>
      </div>
    );
  }
  if (state.status === "loading" || state.status === "idle") return <p role="status" className="text-sm text-ink-muted">Loading the exercise...</p>;
  if (state.status === "missing") return <p role="status" className="rounded-lg border border-surface-border bg-surface-soft p-3 text-sm text-ink-muted">This exercise could not be found ({exerciseId}).</p>;
  return <ExerciseWorkspace {...rest} exercise={state.exercise} compact={compact} />;
}
