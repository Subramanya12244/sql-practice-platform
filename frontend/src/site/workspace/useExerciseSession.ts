/**
 * Session state for one exercise: code, run, submit, reset, hints and visual step state. Abortable.
 *
 * Rules that the tests pin:
 *  - Nothing is recorded on open. `run` records only through the optional `recordRun` (never solved). Only a graded `submit`
 *    calls `recordAttempt`. A hint calls `recordHint`; level 5 also calls `recordReveal`.
 *  - A result that arrives after `stop`, `reset`, a newer run, or unmount is discarded (and never recorded).
 *  - Reset restores the starter code and clears results and visuals. The hint level is kept: help already used is a fact.
 *  - Level 5 (the solution) opens only on request, after the earlier available levels, or any time after a pass.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayback } from "../components/visual/Playback";
import { useReducedMotion } from "../lib/visual/motion";
import { canOpen, nextLevel } from "./hints";
import type { Capability, ExecutionAdapter, ExerciseDef, FeedbackItem, HintLevel, ProgressPort, RunOutcome, ValidationOutcome, VisualModel } from "./types";

export const VISUAL_CAPS: readonly Capability[] = ["stages", "trace", "beforeAfter", "shapes", "plan", "compare"];
/** Capabilities that produce an ordered list of steps; only these get Play, Step, Restart and Speed. */
export const STEP_CAPS: readonly Capability[] = ["stages", "trace", "beforeAfter", "shapes"];

export type Phase = "idle" | "running" | "submitting" | "visualizing";
export type VisualState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; model: VisualModel }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export interface SessionOptions {
  exercise: ExerciseDef;
  adapter: ExecutionAdapter | null;
  progress?: ProgressPort | null;
  initialCode?: string;
  onCodeChange?(code: string): void;
}

const has = (a: ExecutionAdapter | null, c: Capability) => !!a && a.capabilities.has(c);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Text the progress port classifies a failure from: the first thing the learner would read. */
export function failureText(outcome: RunOutcome | null, validation: ValidationOutcome | null, feedback: FeedbackItem[]): string {
  const failedTest = validation?.tests.find((t) => !t.passed && !t.hidden);
  return [outcome?.error ? `${outcome.error.type ?? ""}${outcome.error.type ? ": " : ""}${outcome.error.message}` : "", feedback[0]?.message, failedTest?.detail, outcome?.stderr]
    .filter(Boolean).join("\n").slice(0, 600);
}

export function useExerciseSession({ exercise, adapter, progress = null, initialCode, onCodeChange }: SessionOptions) {
  const [code, setCodeState] = useState(initialCode ?? exercise.starterCode);
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [ranCode, setRanCode] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationOutcome | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [solved, setSolved] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [visual, setVisual] = useState<VisualState>({ status: "idle" });
  const [hintLevel, setHintLevel] = useState(0);
  const reducedMotion = useReducedMotion();

  const codeRef = useRef(code);
  codeRef.current = code;
  const latest = useRef({ exercise, adapter, progress, outcome, ranCode, solved, hintLevel });
  latest.current = { exercise, adapter, progress, outcome, ranCode, solved, hintLevel };
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  const begin = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const id = ++seq.current;
    return { signal: c.signal, live: () => seq.current === id && !c.signal.aborted };
  }, []);

  // The exercise changed (another id): start from its starter and forget everything about the old one.
  const exId = exercise.id;
  const firstId = useRef(exId);
  useEffect(() => {
    if (firstId.current === exId) return;
    firstId.current = exId;
    seq.current++;
    ctrl.current?.abort();
    setCodeState(initialCode ?? exercise.starterCode);
    setPhase("idle"); setOutcome(null); setRanCode(null); setValidation(null); setFeedback([]); setSolved(false); setAttempts(0); setInternalError(null);
    setVisual({ status: "idle" }); setHintLevel(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exId]);
  useEffect(() => () => { seq.current++; ctrl.current?.abort(); }, []);

  const setCode = useCallback((next: string) => { setCodeState(next); onCodeChange?.(next); }, [onCodeChange]);

  const canRun = has(adapter, "run");
  const canSubmit = has(adapter, "submit") && !!adapter?.validate && exercise.validation.kind !== "none";
  const canVisualize = !!adapter?.visualize && exercise.visualization?.enabled !== false && VISUAL_CAPS.some((c) => has(adapter, c));
  const stepCapable = STEP_CAPS.some((c) => has(adapter, c));
  const model = visual.status === "ready" ? visual.model : null;
  const steppable = canVisualize && stepCapable && (model?.steps ?? 0) > 0;
  const pb = usePlayback(steppable ? model?.steps ?? 0 : 0);
  const restart = pb.dispatch;
  useEffect(() => { restart({ type: "restart" }); }, [model, restart]);

  const stale = ranCode !== null && ranCode !== code;
  const busy = phase !== "idle";

  /** Run without grading. Returns the outcome, or null when it was discarded (stopped, reset, superseded). */
  const runInternal = useCallback(async (src: string, guard: { signal: AbortSignal; live: () => boolean }): Promise<RunOutcome | null> => {
    const { adapter: a, exercise: ex } = latest.current;
    if (!a) return null;
    let out: RunOutcome;
    try {
      out = await a.run(src, { exercise: ex, signal: guard.signal });
    } catch (e) {
      if (!guard.live()) return null;
      out = { status: "error", durationMs: 0, error: { message: errText(e) } };
    }
    if (!guard.live()) return null;
    setOutcome(out);
    setRanCode(src);
    return out;
  }, []);

  const run = useCallback(async () => {
    const { adapter: a, exercise: ex, progress: port } = latest.current;
    if (!a || !has(a, "run")) return;
    const g = begin();
    setPhase("running"); setInternalError(null); setValidation(null); setFeedback([]); setVisual({ status: "idle" });
    const src = codeRef.current;
    const out = await runInternal(src, g);
    if (!out || !g.live()) return;
    if (out.status !== "ok") setFeedback(a.explainFailure?.(src, out, null, { exercise: ex }) ?? []);
    port?.recordRun?.(ex, out.status === "ok", out.status === "ok" ? undefined : failureText(out, null, []));
    setPhase("idle");
  }, [begin, runInternal]);

  const submit = useCallback(async () => {
    const { adapter: a, exercise: ex, progress: port } = latest.current;
    if (!a?.validate || !has(a, "submit") || ex.validation.kind === "none") return;
    const g = begin();
    setPhase("submitting"); setInternalError(null); setVisual({ status: "idle" });
    const src = codeRef.current;
    const prev = latest.current;
    let out = prev.ranCode === src && prev.outcome && prev.outcome.status !== "stopped" ? prev.outcome : null;
    if (!out) out = await runInternal(src, g);
    if (!out || !g.live()) return;
    let v: ValidationOutcome;
    try {
      v = await a.validate(src, out, { exercise: ex, signal: g.signal });
    } catch (e) {
      // The grader itself failed: that is not a wrong answer, so it is shown but never recorded.
      if (g.live()) { setInternalError(`The checker could not finish: ${errText(e)}`); setPhase("idle"); }
      return;
    }
    if (!g.live()) return;
    const fb = v.passed ? v.feedback ?? [] : v.feedback?.length ? v.feedback : a.explainFailure?.(src, out, v, { exercise: ex }) ?? [];
    setValidation(v);
    setFeedback(fb);
    setAttempts((n) => n + 1);
    if (v.passed) setSolved(true);
    port?.recordAttempt(ex, v.passed, v.passed ? undefined : failureText(out, v, fb), src);
    setPhase("idle");
  }, [begin, runInternal]);

  const stop = useCallback(() => {
    if (!busy) return;
    seq.current++;
    ctrl.current?.abort();
    setPhase("idle");
    setOutcome({ status: "stopped", durationMs: 0 });
    setRanCode(codeRef.current);
  }, [busy]);

  const reset = useCallback(() => {
    seq.current++;
    ctrl.current?.abort();
    const start = latest.current.exercise.starterCode;
    const { adapter: ra, exercise: rex } = latest.current;
    void ra?.reset?.({ exercise: rex }).catch(() => undefined);
    setCodeState(start);
    onCodeChange?.(start);
    setPhase("idle"); setOutcome(null); setRanCode(null); setValidation(null); setFeedback([]); setInternalError(null); setVisual({ status: "idle" });
  }, [onCodeChange]);

  const visualize = useCallback(async () => {
    const { adapter: a, exercise: ex } = latest.current;
    if (!a?.visualize) return;
    const g = begin();
    setPhase("visualizing"); setVisual({ status: "loading" });
    const src = codeRef.current;
    const cur = latest.current;
    let out = cur.ranCode === src && cur.outcome && cur.outcome.status !== "stopped" ? cur.outcome : null;
    if (!out) out = await runInternal(src, g);
    if (!out || !g.live()) return;
    if (out.status !== "ok" && !(a.visualizeOnError && out.status === "error")) { setVisual({ status: "unavailable", message: "Run the code without errors first: the steps are built from a real run." }); setPhase("idle"); return; }
    try {
      const m = await a.visualize(src, out, { exercise: ex, signal: g.signal });
      if (!g.live()) return;
      setVisual(m ? { status: "ready", model: m } : { status: "unavailable", message: a.limitations?.length ? "This engine cannot build an accurate step view for this code. See what is not supported below." : "This engine cannot build an accurate step view for this code." });
    } catch (e) {
      if (g.live()) setVisual({ status: "error", message: errText(e) });
    }
    if (g.live()) setPhase("idle");
  }, [begin, runInternal]);

  const canOpenLevel = useCallback((level: number) => {
    const ex = latest.current.exercise;
    return canOpen(ex, hintLevel, level) || (level === 5 && latest.current.solved && !!ex.solution?.code?.trim() && hintLevel < 5);
  }, [hintLevel]);

  /** Open one help level. Only the next available level, or the solution after a pass. Returns whether it opened. */
  const openHint = useCallback((level: HintLevel): boolean => {
    const { exercise: ex, progress: port, solved: done, hintLevel: cur } = latest.current;
    const ok = canOpen(ex, cur, level) || (level === 5 && done && !!ex.solution?.code?.trim() && cur < 5);
    if (!ok) return false;
    setHintLevel(level);
    if (!done) { port?.recordHint(ex, level); if (level === 5) port?.recordReveal(ex); } // help after a pass changes nothing that was earned
    return true;
  }, []);

  const next = useMemo(() => nextLevel(exercise, hintLevel), [exercise, hintLevel]);

  return {
    code, setCode, phase, busy, outcome, ranCode, stale, validation, feedback, internalError, solved, attempts,
    canRun, canSubmit, canVisualize, steppable, reducedMotion,
    run, submit, stop, reset,
    visual, visualize, pb,
    hintLevel, nextHintLevel: next, canOpenLevel, openHint,
    solutionVisible: hintLevel >= 5 && !!exercise.solution,
    explanationVisible: solved || hintLevel >= 5,
  };
}
export type ExerciseSession = ReturnType<typeof useExerciseSession>;
