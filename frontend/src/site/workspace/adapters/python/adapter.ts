/**
 * The Python ExecutionAdapter. It wraps what already exists and adds no engine of its own:
 *  - run: the existing Pyodide worker (`runPython` in lib/pyRunner.ts), one fresh namespace per run.
 *  - validate: the existing grading (`runPythonTask` in lib/tasks.ts, the same function PythonWorkspace uses, with the same counting
 *    harness and hidden tests), or the Daily Learning output comparison (`sameOutput`, `firstDifference` in lib/daily.ts) for stdout exercises.
 *  - visualize: the existing tracer (`traceRun` in lib/visual/pyTrace.ts). Stepping, branch and loop views are computed from that
 *    recorded trace (lib/visual/pyStepper.ts, pyBranches.ts).
 *  - explainFailure: the rule-based diagnoser (lib/visual/pyDiagnose.ts) on the real traceback and source.
 */
import type { Capability, ExecutionAdapter, ExerciseDef, FeedbackItem, RunContext, RunOutcome, TestResult, ValidationOutcome, VisualModel } from "../../types";
import { PY_TIMEOUT_MS, runPython, stopPython, type PyResult } from "../../../lib/pyRunner";
import { runPythonTask, type PythonTask } from "../../../lib/tasks";
import { traceRun } from "../../../lib/visual/pyTrace";
import { parseErrorText } from "../../../lib/visual/pyDiagnose";
import { explainPythonFailure, taskFailureFeedback } from "./failure";
import { PYTHON_LIMITATIONS } from "./limitations";
import { buildPythonVisualModel, untraceableReason } from "./model";

/** Only what is true: the workspace shows a control for each of these. */
export const PYTHON_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(["run", "submit", "reset", "trace", "stepBack", "variables", "callStack"]);

export { PYTHON_LIMITATIONS };

export interface PythonAdapterOptions {
  /** The Pyodide runner. Default: the shared worker. Tests pass a real-CPython runner. */
  runner?: typeof runPython;
  /** The tracer. Default: `traceRun` bound to the same runner. */
  tracer?: typeof traceRun;
  /** Stops the interpreter when a run is aborted. Default: `stopPython`. */
  stop?: () => void;
}

export interface PythonAdapter extends ExecutionAdapter {
  /** Each run already starts from a fresh namespace; this only stops a run that is still going. */
  reset(ctx?: RunContext): Promise<void>;
}

/** The stdin an exercise provides (Daily Learning style: one text, a newline added at the end). */
export function stdinOf(ex: ExerciseDef): string {
  const v = ex.validation;
  const s = v.kind === "python-tests" || v.kind === "python-stdout" ? v.stdin : undefined;
  return s ? (s.endsWith("\n") ? s : `${s}\n`) : "";
}

const firstLine = (s: string) => s.trim().split("\n")[0].slice(0, 160);

export function toRunOutcome(r: PyResult): RunOutcome {
  if (r.ok) return { status: "ok", durationMs: r.ms, stdout: r.stdout, raw: r };
  const text = r.error ?? "The run failed.";
  if (r.phase === "timeout") return { status: "timeout", durationMs: r.ms, stdout: r.stdout, stderr: text, error: { type: "TimeoutError", message: text }, raw: r };
  if (r.phase === "stopped") return { status: "stopped", durationMs: r.ms, stdout: r.stdout, stderr: text, raw: r };
  if (r.phase === "load") return { status: "error", durationMs: r.ms, stdout: r.stdout, stderr: text, error: { type: "LoadError", message: text }, raw: r };
  const p = parseErrorText(text);
  return { status: "error", durationMs: r.ms, stdout: r.stdout, stderr: text, error: { type: p?.type, message: p?.message ?? firstLine(text), line: r.errorLine ?? p?.line }, raw: r };
}

export function createPythonAdapter(opts: PythonAdapterOptions = {}): PythonAdapter {
  const runner = opts.runner ?? runPython;
  const tracer = opts.tracer ?? traceRun;
  const stop = opts.stop ?? stopPython;

  /** Run `fn`, and stop the interpreter if the workspace aborts, so a runaway program cannot hold up the next run. */
  async function guarded<T>(signal: AbortSignal | undefined, work: () => Promise<T>, onAbort: T): Promise<T> {
    if (signal?.aborted) return onAbort;
    let off: (() => void) | undefined;
    const aborted = new Promise<T>((resolve) => {
      const f = () => { stop(); resolve(onAbort); };
      signal?.addEventListener("abort", f, { once: true });
      off = () => signal?.removeEventListener("abort", f);
    });
    try { return await Promise.race([work(), aborted]); } finally { off?.(); }
  }

  const stopped = (): RunOutcome => ({ status: "stopped", durationMs: 0, error: { type: "STOPPED", message: "Stopped." } });

  const adapter: PythonAdapter = {
    domain: "python",
    capabilities: PYTHON_CAPABILITIES,
    visualizeOnError: true,
    limitations: [...PYTHON_LIMITATIONS],

    async run(code, ctx) {
      if (!code.trim()) return { status: "error", durationMs: 0, error: { type: "EMPTY", message: "Write some code first." } };
      return guarded(ctx.signal, async () => toRunOutcome(await runner(code, undefined, PY_TIMEOUT_MS, stdinOf(ctx.exercise))), stopped());
    },

    async validate(code, outcome, ctx): Promise<ValidationOutcome> {
      const v = ctx.exercise.validation;
      const ex = ctx.exercise;
      if (v.kind === "none" || v.kind === "sql-result") {
        const ok = outcome.status === "ok";
        return { passed: ok, tests: [{ name: "Your code runs", passed: ok, detail: ok ? undefined : outcome.error?.message }], feedback: ok ? [] : adapter.explainFailure!(code, outcome, null, ctx) };
      }
      if (v.kind === "python-stdout") {
        if (outcome.status !== "ok") return { passed: false, tests: [{ name: "Your code runs", passed: false, detail: outcome.error?.message }], feedback: adapter.explainFailure!(code, outcome, null, ctx) };
        const { sameOutput, firstDifference } = await import("../../../lib/daily"); // loaded here so the curriculum data is not part of this adapter's first chunk
        const same = sameOutput(outcome.stdout ?? "", v.expected);
        const diff = same ? null : firstDifference(v.expected, outcome.stdout ?? "");
        const detail = diff ? `Line ${diff.line}: expected ${diff.expected === null ? "no more output" : JSON.stringify(diff.expected)}, your output has ${diff.actual === null ? "no such line" : JSON.stringify(diff.actual)}.` : undefined;
        const tests: TestResult[] = [{ name: "Output matches the expected output", passed: same, detail }];
        return { passed: same, tests, feedback: same ? [] : explainPythonFailure({ code, stdoutMismatch: detail ? `Your output differs from the expected output. ${detail}` : "Your output differs from the expected output." }) };
      }
      // python-tests: the same grading function the Python workspace uses.
      const stdin = stdinOf(ex);
      const task: PythonTask = { id: ex.id, title: ex.title, type: "python", instructions: "", starter: ex.starterCode, solution: ex.solution?.code ?? "", tests: v.tests, hidden: v.hidden };
      let phase: string | undefined;
      const res = await guarded(ctx.signal, () => runPythonTask(task, code, (c, t) => runner(c, t, PY_TIMEOUT_MS, stdin).then((r) => { phase = r.phase; return r; }), { count: true }), null);
      if (!res) return { passed: false, tests: [{ name: "Tests", passed: false, detail: "Stopped." }] };
      const tests: TestResult[] = [];
      const vis = res.counts?.visible, hid = res.counts?.hidden;
      if (vis) {
        tests.push({ name: "Visible tests", passed: vis.total > 0 ? vis.passed === vis.total : res.ok, detail: `${vis.passed} of ${vis.total} passed` });
        for (const f of vis.failures.slice(0, 5)) tests.push({ name: firstLine(f.test) || "A test", passed: false, detail: f.error });
      }
      if (hid) tests.push({ name: "Hidden edge-case tests", passed: hid.passed === hid.total, hidden: true, detail: `${hid.passed} of ${hid.total} passed (the tests are not shown)` });
      if (!tests.length) tests.push({ name: res.ok ? "All tests" : phase === "code" ? "Your code runs" : "Tests", passed: res.ok, detail: res.ok ? undefined : res.message });
      if (res.ok) return { passed: true, tests, feedback: [] };
      const feedback = taskFailureFeedback({ code, tests: v.tests, message: res.message, output: res.output, phase });
      return { passed: false, tests, feedback };
    },

    async visualize(code, _outcome, ctx): Promise<VisualModel | null> {
      if (!code.trim() || untraceableReason(code)) return null;
      const stdin = stdinOf(ctx.exercise);
      const v = ctx.exercise.validation;
      const out = await guarded(ctx.signal, () => tracer(code, stdin, runner), null);
      if (!out?.trace) return null;
      return buildPythonVisualModel(code, out.trace, { stdinProvided: stdin !== "", tests: v.kind === "python-tests" ? v.tests : undefined });
    },

    explainFailure(code, outcome, validation, ctx): FeedbackItem[] {
      const v = ctx.exercise.validation;
      const tests = v.kind === "python-tests" ? v.tests : undefined;
      if (outcome.status === "stopped") return [];
      if (outcome.status !== "ok") {
        return explainPythonFailure({ code, errorText: outcome.stderr, errorType: outcome.error?.type === "STOPPED" || outcome.error?.type === "EMPTY" || outcome.error?.type === "LoadError" ? undefined : outcome.error?.type, line: outcome.error?.line, tests });
      }
      const failed = validation?.tests.find((t) => !t.passed);
      if (!failed) return [];
      if (failed.detail && /Error\b/.test(failed.detail)) return explainPythonFailure({ code, errorText: failed.detail, tests });
      return explainPythonFailure({ code, tests, stdoutMismatch: failed.detail ?? "A check did not pass." });
    },

    async reset() { stop(); },
  };
  return adapter;
}

export const pythonAdapter: PythonAdapter = createPythonAdapter();
