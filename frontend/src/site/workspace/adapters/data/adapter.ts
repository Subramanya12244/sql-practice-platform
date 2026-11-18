/**
 * The pandas and NumPy ExecutionAdapters (one module, two domains). Nothing here is an engine of its own:
 *  - run: the EXISTING Pyodide worker (`runPython`), through the stage probe (lib/visual/dataProbeProgram.ts), which executes your code
 *    once, statement by statement, and records real DataFrames/arrays at every step. Plain output and errors are the program's own.
 *  - validate: the existing grading `runPythonTask` (lib/tasks.ts), or the Daily Learning output comparison for stdout exercises.
 *  - visualize: builds the stage model from the SAME run (no second execution, so a random program cannot differ from what is shown),
 *    with consistency checks of every derived number against the real result. Returns null when there is nothing real to show.
 *  - explainFailure: rule-based, from the real error text and the real final values.
 */
import type { Capability, Domain, ExecutionAdapter, ExerciseDef, FeedbackItem, RunContext, RunOutcome, TestResult, ValidationOutcome, VisualModel } from "../../types";
import { PY_TIMEOUT_MS, runPython, stopPython, type PyResult } from "../../../lib/pyRunner";
import { runPythonTask, type PythonTask } from "../../../lib/tasks";
import { buildDataModel, runDataProbe, type DataProbeResult, type DataRun } from "../../../lib/visual/dataframe";
import { explainDataFailure } from "./failure";

export type DataDomain = Extract<Domain, "pandas" | "numpy">;

const BASE: Capability[] = ["run", "submit", "reset", "stages", "beforeAfter"];
export const PANDAS_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(BASE);
/** NumPy adds the shape view (broadcasting, matmul, axes). */
export const NUMPY_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([...BASE, "shapes"]);

const COMMON_LIMITATIONS = [
  "Stages come from your top-level statements and from the steps of a method chain or operator expression. Operations inside loops, functions, with/try/if blocks run as one step: only the variables they changed are shown.",
  "Tables and arrays show their first rows and columns only (12 rows by 10 columns; 3-D arrays show 4 planes of 8 by 8; arrays with more than 3 dimensions show index 0 of the leading axes). Shapes, dtypes, missing counts and row counts are exact.",
  "Rows are followed from step to step by index label and verified by value. After a reset_index, a groupby, a merge or a pivot the rows are new, so only counts are shown, not which row became which.",
  "A MultiIndex is shown flattened as 'a | b'; there is no collapsible multi-level header.",
  "Tracked variables are compared by content up to 500,000 cells; larger objects are compared by identity only, so an in-place edit to a very large object may show no stage.",
  "Only pandas and NumPy objects are staged (not Polars, Dask, SciPy sparse matrices, masked arrays or np.matrix). Other libraries still run, they just have no stage view.",
  "Your code runs once in Pyodide (10 second limit; 25 seconds with the stage view) with the same sandbox as every Python exercise: no network. pd.read_csv works on io.StringIO text or files the exercise provides.",
  "The stage view runs the program as a normal module-level script: `__name__` is not defined, exactly as in the plain Python runner.",
];
export const PANDAS_LIMITATIONS: readonly string[] = [
  ...COMMON_LIMITATIONS,
  "Merge key matching covers merge, pd.merge and join on columns or the index (including different key names on each side). Cross joins and key arrays that are not column names are run but not analysed.",
  "Groups are shown for the first 6 groups, 5 rows each; the group count and sizes are exact.",
];
export const NUMPY_LIMITATIONS: readonly string[] = [
  ...COMMON_LIMITATIONS,
  "Broadcasting and matrix-multiplication tables are built for operators and ufuncs applied to arrays and scalars (a + b, a * 2, np.add, a @ b, np.matmul, np.dot on 1-D/2-D). np.where, np.einsum, np.tensordot and stacked/batched dot products run but are not tabulated.",
  "Element positions (which input cell an output cell came from) are shown for indexing, slicing, masks, .T, reshape, ravel, flatten, transpose, swapaxes and squeeze, up to 1,000,000 elements.",
  "Random numbers are reproducible only when the code seeds them (np.random.seed(n) or default_rng(n)); the view states the seed it finds in your code and warns when there is none.",
];

export interface DataAdapterOptions {
  /** The Pyodide runner. Default: the shared worker. Tests pass a real-CPython runner. */
  runner?: typeof runPython;
  /** Stops the interpreter when a run is aborted. Default: `stopPython`. */
  stop?: () => void;
}

export interface DataRunRaw { kind: "data-stages"; domain: DataDomain; probe: DataProbeResult; code: string }
export const isDataRunRaw = (x: unknown): x is DataRunRaw => !!x && typeof x === "object" && (x as { kind?: string }).kind === "data-stages";

const firstLine = (s: string) => s.trim().split("\n")[0].slice(0, 200);
const filesOf = (ex: ExerciseDef): Record<string, string> | undefined => (ex as ExerciseDef & { files?: Record<string, string> }).files;

function fromPyResult(r: PyResult): RunOutcome {
  const text = r.error ?? "The run failed.";
  if (r.phase === "timeout") return { status: "timeout", durationMs: r.ms, stdout: r.stdout, stderr: text, error: { type: "TimeoutError", message: text }, raw: r };
  if (r.phase === "stopped") return { status: "stopped", durationMs: r.ms, stdout: r.stdout, stderr: text, raw: r };
  const m = /^(\w+(?:Error|Exception)):\s*(.*)$/m.exec(text);
  return { status: "error", durationMs: r.ms, stdout: r.stdout, stderr: text, error: { type: m?.[1] ?? (r.phase === "load" ? "LoadError" : undefined), message: m ? `${m[1]}: ${m[2]}` : firstLine(text), line: r.errorLine }, raw: r };
}

function tableOf(p: DataProbeResult): RunOutcome["table"] {
  for (let i = p.stages.length - 1; i >= 0; i--) {
    const o = p.stages[i].output;
    if (o?.k === "df" && o.cols && o.rows) return { columns: o.cols, rows: o.rows, truncated: !!o.more };
    if (o?.k === "series" && o.rows) return { columns: [o.name ?? "value"], rows: o.rows, truncated: !!o.more };
  }
  return undefined;
}

/** Outcome of a run from a parsed probe: the program's own stdout and error, plus the real stages in `raw`. */
export function outcomeFromProbe(domain: DataDomain, code: string, probe: DataProbeResult, ms: number): RunOutcome {
  const raw: DataRunRaw = { kind: "data-stages", domain, probe, code };
  if (probe.ok) return { status: "ok", durationMs: ms, stdout: probe.stdout, table: tableOf(probe), raw };
  const e = probe.error!;
  return { status: "error", durationMs: ms, stdout: probe.stdout, stderr: `${e.type}: ${e.msg}`, error: { type: e.type, message: `${e.type}: ${e.msg}`, line: e.line ?? undefined }, table: tableOf(probe), raw };
}

export interface DataAdapter extends ExecutionAdapter {
  reset(ctx?: RunContext): Promise<void>;
}

export function createDataAdapter(domain: DataDomain, opts: DataAdapterOptions = {}): DataAdapter {
  const runner = opts.runner ?? runPython;
  const stop = opts.stop ?? stopPython;

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

  const adapter: DataAdapter = {
    domain,
    capabilities: domain === "numpy" ? NUMPY_CAPABILITIES : PANDAS_CAPABILITIES,
    visualizeOnError: true,
    limitations: [...(domain === "numpy" ? NUMPY_LIMITATIONS : PANDAS_LIMITATIONS)],

    async run(code, ctx) {
      if (!code.trim()) return { status: "error", durationMs: 0, error: { type: "EMPTY", message: "Write some code first." } };
      return guarded(ctx.signal, async () => {
        const t0 = Date.now();
        const files = filesOf(ctx.exercise);
        const r: DataRun = await runDataProbe(code, { run: runner, files });
        if (r.probe && !r.probe.syntax) return outcomeFromProbe(domain, code, r.probe, r.result.ms || Date.now() - t0);
        // A syntax error or a run that died before the probe finished: the plain runner gives the program's own message.
        const plain = r.probe?.syntax ? await runner(code, undefined, PY_TIMEOUT_MS, "", files) : r.result;
        return fromPyResult(plain);
      }, stopped());
    },

    async validate(code, outcome, ctx): Promise<ValidationOutcome> {
      const v = ctx.exercise.validation;
      const ex = ctx.exercise;
      const probe = isDataRunRaw(outcome.raw) ? outcome.raw.probe : null;
      const fail = (validation: ValidationOutcome | null) => explainDataFailure({ code, error: outcome.error, probe, validation });
      if (v.kind === "none" || v.kind === "sql-result") {
        const ok = outcome.status === "ok";
        return { passed: ok, tests: [{ name: "Your code runs", passed: ok, detail: ok ? undefined : outcome.error?.message }], feedback: ok ? [] : fail(null) };
      }
      if (v.kind === "python-stdout") {
        if (outcome.status !== "ok") return { passed: false, tests: [{ name: "Your code runs", passed: false, detail: outcome.error?.message }], feedback: fail(null) };
        const { sameOutput, firstDifference } = await import("../../../lib/daily");
        const same = sameOutput(outcome.stdout ?? "", v.expected);
        const diff = same ? null : firstDifference(v.expected, outcome.stdout ?? "");
        const detail = diff ? `Line ${diff.line}: expected ${diff.expected === null ? "no more output" : JSON.stringify(diff.expected)}, your output has ${diff.actual === null ? "no such line" : JSON.stringify(diff.actual)}.` : undefined;
        return { passed: same, tests: [{ name: "Output matches the expected output", passed: same, detail }], feedback: same ? [] : [{ category: "Expected result", message: `Your output differs from the expected output. ${detail ?? ""}`.trim(), suggestion: "Print the same shape and values the exercise shows; check .head(), index and rounding." }] };
      }
      // python-tests: the same grading function the Python workspace uses.
      const task: PythonTask = { id: ex.id, title: ex.title, type: "python", instructions: "", starter: ex.starterCode, solution: ex.solution?.code ?? "", tests: v.tests, hidden: v.hidden };
      const files = filesOf(ex);
      let phase: string | undefined;
      const res = await guarded(ctx.signal, () => runPythonTask(task, code, (c, t) => runner(c, t, PY_TIMEOUT_MS, v.stdin ?? "", files).then((r) => { phase = r.phase; return r; }), { count: true }), null);
      if (!res) return { passed: false, tests: [{ name: "Tests", passed: false, detail: "Stopped." }] };
      const tests: TestResult[] = [];
      const vis = res.counts?.visible, hid = res.counts?.hidden;
      if (vis) {
        tests.push({ name: "Visible tests", passed: vis.total > 0 ? vis.passed === vis.total : res.ok, detail: `${vis.passed} of ${vis.total} passed` });
        for (const f of vis.failures.slice(0, 5)) tests.push({ name: f.test.trim().split("\n")[0].slice(0, 160) || "A test", passed: false, detail: f.error });
      }
      if (hid) tests.push({ name: "Hidden edge-case tests", passed: hid.passed === hid.total, hidden: true, detail: `${hid.passed} of ${hid.total} passed (the tests are not shown)` });
      if (!tests.length) tests.push({ name: res.ok ? "All tests" : phase === "code" ? "Your code runs" : "Tests", passed: res.ok, detail: res.ok ? undefined : res.message });
      if (res.ok) return { passed: true, tests, feedback: [] };
      const result: ValidationOutcome = { passed: false, tests };
      result.feedback = fail(result);
      return result;
    },

    async visualize(code, outcome, ctx): Promise<VisualModel | null> {
      let probe: DataProbeResult | null = null;
      if (isDataRunRaw(outcome.raw) && outcome.raw.code === code) probe = outcome.raw.probe;
      else {
        if (outcome.status === "timeout" || outcome.status === "stopped") return null;
        const r = await guarded(ctx.signal, () => runDataProbe(code, { run: runner, files: filesOf(ctx.exercise) }), null);
        probe = r?.probe && !r.probe.syntax ? r.probe : null;
      }
      if (!probe || probe.stages.length === 0) return null;
      const data = buildDataModel(domain, probe, code);
      const notes = [...data.notes];
      if (!data.consistent) notes.push("A derived number did not match the real result; the values shown are still the real ones.");
      return { provenance: "executed", data, steps: probe.stages.length, notes };
    },

    explainFailure(code, outcome, validation): FeedbackItem[] {
      const probe = isDataRunRaw(outcome.raw) ? outcome.raw.probe : null;
      return explainDataFailure({ code, error: outcome.error, probe, validation });
    },

    async reset() { stop(); },
  };
  return adapter;
}

export const pandasAdapter: DataAdapter = createDataAdapter("pandas");
export const numpyAdapter: DataAdapter = createDataAdapter("numpy");
