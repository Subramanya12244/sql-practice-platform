/**
 * Python failure explanations for the workspace: a `Diagnosis` (lib/visual/pyDiagnose.ts) becomes a `FeedbackItem`, and a line
 * number read from a traceback is only trusted when it points into the learner's code.
 */
import type { FeedbackItem } from "../../types";
import { diagnoseAll, parseErrorText, type Diagnosis, type DiagCategory } from "../../../lib/visual/pyDiagnose";

/** Categories shown to the learner (the contract lists: syntax, types, control flow, functions, collections, algorithm, runtime, output). */
export const PY_CATEGORY: Record<DiagCategory, string> = {
  syntax: "syntax", "data types": "data types", "control flow": "control flow", functions: "functions", collections: "collections",
  algorithms: "algorithms", "runtime errors": "runtime errors", "unexpected output": "unexpected output",
};

export function diagnosisToFeedback(d: Diagnosis): FeedbackItem {
  const fix = d.fix ? ` Suggested change (line ${d.fix.line}): ${d.fix.kind === "insert" ? `add ${"`" + d.fix.after + "`"}` : `replace ${"`" + d.fix.before.trim() + "`"} with ${"`" + d.fix.after.trim().split("\n").join(" / ") + "`"}`}.` : "";
  return {
    category: PY_CATEGORY[d.category],
    message: `${d.errorType}${d.message && d.errorType !== "MutableDefaultArgument" && d.errorType !== "NoReturn" ? `: ${d.message}` : ""}. ${d.rootCause} ${d.why}`,
    line: d.line,
    suggestion: `${d.correctedApproach}${fix} To prevent it: ${d.prevention}`,
  };
}

/** Lines (1-based, inclusive) of every `def name` body in `source`, for matching a frame name to the learner's code. */
function defRanges(source: string, name: string): [number, number][] {
  const lines = source.split("\n");
  const re = new RegExp(`^(\\s*)(?:async\\s+)?def\\s+${name.replace(/[^\w]/g, "")}\\b`);
  const out: [number, number][] = [];
  lines.forEach((l, k) => {
    const m = re.exec(l);
    if (!m) return;
    let end = k;
    for (let j = k + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if ((/^\s*/.exec(lines[j])?.[0].length ?? 0) <= m[1].length) break;
      end = j;
    }
    out.push([k + 1, end + 1]);
  });
  return out;
}

const FRAME = /File "<exec>", line (\d+)(?:, in (\S+))?/;

/** Whether frame line `k` of the traceback is the learner's own code (see `learnerLine`), and the line number it names. */
function learnerFrame(src: string[], source: string, lines: string[], k: number, errorText: string, tests?: string): number | undefined {
  const m = lines[k].match(FRAME);
  if (!m) return undefined;
  const n = Number(m[1]);
  const next = lines[k + 1];
  const shown = next !== undefined && /^\s{4}\S/.test(next) ? next.trim() : undefined;
  if (shown) return (src[n - 1] ?? "").trim() === shown ? n : undefined;
  const fn = m[2];
  if (fn && !fn.startsWith("<") && !(tests && new RegExp(`\\bdef\\s+${fn.replace(/[^\w]/g, "")}\\b`).test(tests)) && defRanges(source, fn).some(([a, b]) => n >= a && n <= b)) return n;
  // A SyntaxError in the learner's code is reported by the compiler before any test runs.
  if (!fn && /^(Syntax|Indentation|Tab)Error/m.test(errorText) && !/AssertionError/.test(errorText)) return n;
  return undefined;
}

/**
 * The line of the learner's code that a traceback names. The tests run in the same worker namespace, so their frames are also
 * called "<exec>". Two ways to know a frame is the learner's, both checked against real output:
 *  - CPython prints the source text under a frame: the line is accepted only when that text is the learner's own line.
 *  - Pyodide (verified in a real browser) prints NO source text for `<exec>` frames. Then a frame is accepted only when its
 *    function name is a `def` in the learner's source (and not in the tests) and the line lies inside that def's body.
 * The innermost accepted frame wins. In a plain run the worker already says which line it is (`plainRunLine`).
 */
export function learnerLine(source: string, errorText: string | undefined, plainRunLine?: number, tests?: string): number | undefined {
  if (plainRunLine) return plainRunLine;
  if (!errorText) return undefined;
  const lines = errorText.split("\n");
  const src = source.split("\n");
  for (let k = lines.length - 1; k >= 0; k--) {
    const n = learnerFrame(src, source, lines, k, errorText, tests);
    if (n !== undefined) return n;
  }
  return undefined;
}

/**
 * A traceback from a test run with the frames that are not the learner's renamed to "<tests>", so a diagnosis never takes the line
 * of an `assert` in the tests (or of the grading harness) for a line of the learner's code.
 */
export function scrubTestFrames(source: string, errorText: string, tests: string): string {
  const lines = errorText.split("\n");
  const src = source.split("\n");
  return lines.map((l, k) => (FRAME.test(l) && learnerFrame(src, source, lines, k, errorText, tests) === undefined ? l.replace('File "<exec>"', 'File "<tests>"') : l)).join("\n");
}

export interface FailureInput { code: string; errorText?: string; errorType?: string; line?: number; tests?: string; stdoutMismatch?: string }

/** Every diagnosis for a failed run or check, as feedback. Empty when there is nothing to say. */
export function explainPythonFailure(i: FailureInput): FeedbackItem[] {
  // In a test run the tracebacks also hold the tests' own frames; only learner frames may supply a line.
  const errorText = i.tests && i.errorText && i.line === undefined ? scrubTestFrames(i.code, i.errorText, i.tests) : i.errorText;
  const all = diagnoseAll({ source: i.code, error: errorText, errorType: i.errorType, line: i.line, tests: i.tests });
  const out = all.map(diagnosisToFeedback);
  if (i.stdoutMismatch && !all.some((d) => d.errorType !== "MutableDefaultArgument" && d.errorType !== "NoReturn")) {
    out.unshift({ category: "unexpected output", message: i.stdoutMismatch, suggestion: "Print your values with the exact format the exercise shows, and compare your output with the expected output line by line. Trace the lines that build the output to see where a value differs." });
  }
  return out;
}

/**
 * Feedback for a failed graded check (the result of `runPythonTask`). One function for the workspace adapter and for the Python
 * practice page, so both explain the same failure the same way. `phase` is the worker phase of the failing run ("code" when the
 * learner's own code raised before any test ran).
 */
export function taskFailureFeedback(i: { code: string; tests: string; message: string; output?: string; phase?: string }): FeedbackItem[] {
  const errorText = i.output ?? i.message;
  const feedback = explainPythonFailure({
    code: i.code, errorText, tests: i.tests,
    line: learnerLine(i.code, errorText, i.phase === "code" ? parseErrorText(errorText)?.line : undefined, i.tests),
  });
  if (/hidden test/.test(i.message)) feedback.unshift({ category: "unexpected output", message: i.message, suggestion: "Try empty input, one item, duplicates, negative numbers, None and very large values by hand, and trace the lines that handle each case." });
  return feedback;
}
