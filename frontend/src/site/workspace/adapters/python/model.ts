/** The visual model the Python adapter hands to its visualizer: the real trace plus what was read from the source. */
import type { VisualModel } from "../../types";
import { diagnoseAll, type Diagnosis } from "../../../lib/visual/pyDiagnose";
import { analyzeSource, type SourceMap } from "../../../lib/visual/pyBranches";
import type { Trace } from "../../../lib/visual/pyTrace";

export interface PythonVisualData {
  code: string;
  trace: Trace;
  source: SourceMap;
  /** Diagnoses of the exception that ended the run (empty when the program finished normally). */
  diagnoses: Diagnosis[];
}

export const isPythonVisualData = (x: unknown): x is PythonVisualData =>
  !!x && typeof x === "object" && "trace" in x && "source" in x && Array.isArray((x as PythonVisualData).trace?.steps);

const n = (x: number) => x.toLocaleString("en-US");

/** Why this code cannot be traced accurately, or null when it can. Based on how the tracer really works (sys.settrace, one thread, the learner's own file). */
export function untraceableReason(code: string): string | null {
  if (/^\s*(?:import\s+(?:[\w.]+\s*,\s*)*(?:threading|multiprocessing|asyncio|concurrent(?:\.futures)?)\b|from\s+(?:threading|multiprocessing|asyncio|concurrent(?:\.futures)?)\b)/m.test(code))
    return "This code uses threads, processes or asyncio. The tracer follows one thread of plain Python, so the steps would be incomplete and misleading.";
  if (/^\s*async\s+def\b|\bawait\s/m.test(code)) return "This code uses async functions. The tracer does not follow coroutines, so no step view is built.";
  return null;
}

export function buildPythonVisualModel(code: string, trace: Trace, opts: { stdinProvided?: boolean; tests?: string } = {}): VisualModel | null {
  if (!trace.steps.length) return null;
  const source = analyzeSource(code);
  const diagnoses = trace.error ? diagnoseAll({ source: code, trace, tests: opts.tests }) : [];
  const notes = ["A supported-subset line tracer built on Python's sys.settrace. It follows your own code line by line; it is not a full CPython debugger."];
  if (trace.truncated) {
    const c = trace.counts;
    notes.push(`The trace is sampled${trace.detached ? " and stopped early" : ""}: ${c ? `${n(c.events)} events ran` : "the program ran"} and ${n(trace.steps.length)} steps are recorded. Stepping is disabled across a gap; line, call and loop counts stay ${trace.detached ? "lower bounds" : "exact"}.`);
  }
  if (trace.error) notes.push(`The program stopped with ${trace.error.type}. The steps end at the exception, and the values are what the program held just before it failed.`);
  if (!source.supported) notes.push(...source.notes);
  if (opts.stdinProvided) notes.push("The input given to this exercise was used as stdin for the traced run.");
  return { provenance: "executed", data: { code, trace, source, diagnoses } satisfies PythonVisualData, steps: trace.steps.length, notes };
}
