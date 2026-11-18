/**
 * An in-memory adapter for tests and demos. It runs nothing real: "run" echoes the code, "validate" compares the code with the exercise's
 * reference solution, and "visualize" returns one step per code line labelled `conceptual`. It exists to exercise the workspace (capability
 * gating, abort, reset, hints, progress) without Pyodide or PGlite. Never register it as a production adapter.
 */
import type { ComponentType } from "react";
import type { Capability, Domain, ExecutionAdapter, FeedbackItem, RunOutcome, ValidationOutcome, VisualModel, VisualizerProps } from "../types";

export interface FakeOptions {
  domain?: Domain;
  capabilities?: Capability[];
  /** Milliseconds a run takes; with a delay the run honours AbortSignal and resolves `stopped`. */
  delayMs?: number;
  /** Decide whether the code passes. Default: the code contains the reference solution (whitespace-insensitive). */
  passWhen?(code: string, solution: string | undefined): boolean;
  failWithError?: string;
  limitations?: string[];
  /** Return null from visualize (the engine cannot do it accurately). */
  noVisual?: boolean;
  calls?: { run: string[]; validate: string[]; visualize: string[] };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function createFakeAdapter(o: FakeOptions = {}): ExecutionAdapter & { calls: NonNullable<FakeOptions["calls"]> } {
  const calls = o.calls ?? { run: [], validate: [], visualize: [] };
  const caps = new Set<Capability>(o.capabilities ?? ["run", "submit", "reset"]);
  const wait = (ms: number, signal?: AbortSignal) => new Promise<boolean>((resolve) => {
    if (ms <= 0) return resolve(!signal?.aborted);
    const t = setTimeout(() => resolve(!signal?.aborted), ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(false); }, { once: true });
  });
  return {
    domain: o.domain ?? "python",
    capabilities: caps,
    calls,
    limitations: o.limitations,
    async run(code, ctx): Promise<RunOutcome> {
      calls.run.push(code);
      const ok = await wait(o.delayMs ?? 0, ctx.signal);
      if (!ok) return { status: "stopped", durationMs: 0 };
      if (o.failWithError) return { status: "error", durationMs: 1, error: { type: "FakeError", message: o.failWithError, line: 1 } };
      const lines = code.split("\n").filter((l) => l.trim());
      return { status: "ok", durationMs: 1, stdout: `ran ${lines.length} line(s)`, table: { columns: ["line", "text"], rows: lines.map((t, i) => [i + 1, t]) } };
    },
    async validate(code, outcome, ctx): Promise<ValidationOutcome> {
      calls.validate.push(code);
      const sol = ctx.exercise.solution?.code;
      const passed = outcome.status === "ok" && (o.passWhen ? o.passWhen(code, sol) : !!sol && squash(code).includes(squash(sol)));
      return { passed, tests: [{ name: "reference check", passed, detail: passed ? undefined : "does not match the reference" }, { name: "edge cases", passed, hidden: true }] };
    },
    async visualize(code, outcome, ctx): Promise<VisualModel | null> {
      calls.visualize.push(code);
      if (o.noVisual) return null;
      const lines = code.split("\n").filter((l) => l.trim());
      void outcome; void ctx;
      return { provenance: "conceptual", data: { lines }, steps: lines.length, notes: ["Fake adapter: one step per line."] };
    },
    explainFailure(_code, outcome, validation): FeedbackItem[] {
      if (outcome.status !== "ok") return [{ category: "runtime", message: outcome.error?.message ?? "The run failed.", suggestion: "Read the message and check the marked line." }];
      return validation && !validation.passed ? [{ category: "output", message: "The result does not match the reference.", suggestion: "Compare with the expected output." }] : [];
    },
  };
}

export const FakeVisualizer: ComponentType<VisualizerProps> = ({ model, step }) => {
  const lines = (model.data as { lines: string[] }).lines;
  return <pre data-testid="fake-visual" aria-label="Fake visual">{`step ${step + 1}: ${lines[step] ?? ""}`}</pre>;
};
