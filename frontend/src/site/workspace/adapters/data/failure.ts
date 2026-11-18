/**
 * Failure explanations for pandas and NumPy exercises (rule-based, from the REAL error text, the real final values the probe captured,
 * and the failing test's source). Categories: syntax, shapes, dtypes, columns, expected results, incorrect transformation, runtime.
 */
import type { FeedbackItem, ValidationOutcome } from "../../types";
import type { DataProbeResult, DataSnap } from "../../../lib/visual/dataframe";
import { parseBroadcastError, numpyShape } from "../../../lib/visual/broadcast";

export const DATA_CATEGORY = {
  syntax: "Syntax",
  shapes: "Shapes",
  dtypes: "Dtypes",
  columns: "Columns and labels",
  expected: "Expected result",
  transformation: "Incorrect transformation",
  runtime: "Runtime error",
} as const;

export interface FailureInput {
  code: string;
  error?: { type?: string; message: string; line?: number };
  /** The probe of the failing run, when there is one (finals, stages, the failing stage). */
  probe?: DataProbeResult | null;
  validation?: ValidationOutcome | null;
}

const shapeText = (s?: DataSnap | null) => (s?.shape ? (s.k === "nd" ? numpyShape(s.shape) : `(${s.shape.join(", ")})`) : null);
const fmtShape = (xs: number[]) => (xs.length === 1 ? `(${xs[0]},)` : `(${xs.join(", ")})`);

/** What a failing assert says about a named variable, compared with the value the learner's code really produced. */
export function compareWithExpectation(testSrc: string, finals: Record<string, DataSnap>): FeedbackItem | null {
  const shape = /assert\s+(\w+)\.shape\s*==\s*\(([^)]*)\)/.exec(testSrc);
  if (shape && finals[shape[1]]?.shape) {
    const want = shape[2].split(",").map((x) => x.trim()).filter(Boolean).map(Number);
    const have = finals[shape[1]].shape!;
    if (want.join() !== have.join()) {
      const rowsDiffer = want[0] !== have[0], colsDiffer = want.length > 1 && want[1] !== have[1];
      return {
        category: DATA_CATEGORY.shapes,
        message: `\`${shape[1]}\` has shape ${fmtShape(have)} but the exercise expects ${fmtShape(want)}.${rowsDiffer && !colsDiffer ? ` The row count is ${have[0] > want[0] ? "too high" : "too low"} by ${Math.abs(have[0] - want[0])}.` : ""}${colsDiffer && !rowsDiffer ? ` The column count is ${have[1] > want[1] ? "too high" : "too low"} by ${Math.abs(have[1] - want[1])}.` : ""}`,
        suggestion: rowsDiffer ? "Check the filter, join type or drop/dedupe step that decides which rows stay." : "Check which columns your last step adds or removes.",
      };
    }
  }
  const len = /assert\s+len\((\w+)\)\s*==\s*(\d+)/.exec(testSrc);
  if (len && finals[len[1]]?.shape) {
    const have = finals[len[1]].shape![0], want = Number(len[2]);
    if (have !== want) return { category: DATA_CATEGORY.shapes, message: `\`${len[1]}\` has ${have} row${have === 1 ? "" : "s"} but the exercise expects ${want}.`, suggestion: "Compare the row count after each step with the stage view." };
  }
  const dt = /assert\s+(\w+)\[['"]([^'"]+)['"]\]\.dtype\s*==\s*['"]?([\w.\[\]]+)['"]?/.exec(testSrc) ?? /assert\s+str\((\w+)\[['"]([^'"]+)['"]\]\.dtype\)\s*==\s*['"]([\w.\[\]]+)['"]/.exec(testSrc);
  if (dt && finals[dt[1]]?.colNames) {
    const i = finals[dt[1]].colNames!.indexOf(dt[2]);
    const have = i >= 0 ? finals[dt[1]].colDtypes?.[i] : undefined;
    if (have && have !== dt[3]) return { category: DATA_CATEGORY.dtypes, message: `Column \`${dt[2]}\` of \`${dt[1]}\` has dtype ${have} but the exercise expects ${dt[3]}.`, suggestion: "Convert with astype() or pd.to_numeric()/pd.to_datetime() before this step." };
  }
  const cols = /assert\s+(?:list\()?(\w+)\.columns\)?(?:\.tolist\(\))?\s*==\s*\[([^\]]*)\]/.exec(testSrc);
  if (cols && finals[cols[1]]?.colNames) {
    const want = cols[2].split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    const have = finals[cols[1]].colNames!;
    if (want.join("|") !== have.join("|")) return { category: DATA_CATEGORY.columns, message: `\`${cols[1]}\` has columns [${have.join(", ")}] but the exercise expects [${want.join(", ")}].`, suggestion: "Check column names, order, and which columns a merge or groupby keeps." };
  }
  const arrShape = /assert\s+(\w+)\.ndim\s*==\s*(\d+)/.exec(testSrc);
  if (arrShape && finals[arrShape[1]]?.ndim !== undefined && finals[arrShape[1]].ndim !== Number(arrShape[2])) return { category: DATA_CATEGORY.shapes, message: `\`${arrShape[1]}\` has ${finals[arrShape[1]].ndim} dimension(s) but the exercise expects ${arrShape[2]}.`, suggestion: "Check reshape(), indexing with an integer (drops an axis) and keepdims." };
  return null;
}

/** Plain-language explanation of why a run or a grading failed. At least one item for any failure. */
export function explainDataFailure(input: FailureInput): FeedbackItem[] {
  const out: FeedbackItem[] = [];
  const { error, probe, validation } = input;
  const line = error?.line;
  const failing = probe?.stages.find((s) => s.error);
  const stageNote = failing ? ` It happened at ${failing.code.length > 70 ? `${failing.code.slice(0, 69)}…` : failing.code}${failing.inputs[0]?.shape ? ` on an input of shape ${shapeText(failing.inputs[0])}` : ""}.` : "";

  if (error) {
    const msg = error.message, type = error.type ?? "";
    if (type === "SyntaxError" || type === "IndentationError") out.push({ category: DATA_CATEGORY.syntax, message: `Python cannot read this code: ${msg.split("\n")[0]}`, line, suggestion: "Check brackets, quotes, colons and indentation on or just above that line." });
    else if (parseBroadcastError(msg)) {
      const shapes = parseBroadcastError(msg)!;
      out.push({ category: DATA_CATEGORY.shapes, message: `NumPy cannot line these shapes up: ${shapes.map(numpyShape).join(" and ")}. Aligned from the right, a pair of sizes must be equal or one must be 1.${stageNote}`, line, suggestion: "Reshape one array (a[:, None] or reshape(-1, 1) adds an axis of size 1) or check which axis you meant." });
    } else if (/matmul|not aligned/.test(msg)) {
      out.push({ category: DATA_CATEGORY.shapes, message: `The inner dimensions of the matrix product differ: for (m, n) @ (n, p) the two n must be equal. NumPy said: ${msg.split("\n")[0]}`, line, suggestion: "Transpose one operand (.T) or check which axis is the inner one." });
    } else if (type === "KeyError") {
      const have = [...(failing?.inputs ?? []), ...Object.values(probe?.finals ?? {})].find((s) => s.k === "df")?.colNames;
      out.push({ category: DATA_CATEGORY.columns, message: `There is no column or label ${msg}.${have ? ` Columns available: ${have.slice(0, 12).join(", ")}.` : ""}${stageNote}`, line, suggestion: "Check spelling and case, and whether an earlier step renamed, dropped or moved the column into the index." });
    } else if (type === "AttributeError" && /has no attribute/.test(msg)) {
      out.push({ category: DATA_CATEGORY.transformation, message: `${msg}${stageNote}`, line, suggestion: "The value is not the type you expect at this step (for example a groupby object, a Series instead of a DataFrame, or None from an in-place call)." });
    } else if (type === "ValueError" && /merge|key|dtype|object and int|incompatible/i.test(msg)) {
      out.push({ category: DATA_CATEGORY.dtypes, message: `${msg.split("\n")[0]}${stageNote}`, line, suggestion: "Make the key columns the same dtype before merging (astype or pd.to_numeric)." });
    } else if (type === "TypeError" || (type === "ValueError" && /convert|could not|invalid literal/.test(msg))) {
      out.push({ category: DATA_CATEGORY.dtypes, message: `${type}: ${msg.split("\n")[0]}${stageNote}`, line, suggestion: "Check the dtypes of the values involved (df.dtypes, arr.dtype); text where numbers are expected is the usual cause." });
    } else {
      out.push({ category: DATA_CATEGORY.runtime, message: `${type ? `${type}: ` : ""}${msg.split("\n")[0]}${stageNote}`, line, suggestion: "Step through the stages to see the last step that worked." });
    }
  }

  if (validation && !validation.passed) {
    for (const t of validation.tests.filter((x) => !x.passed && !x.hidden).slice(0, 3)) {
      const cmp = compareWithExpectation(t.name, probe?.finals ?? {});
      if (cmp) out.push(cmp);
      else if (/AssertionError|assert/.test(`${t.name} ${t.detail ?? ""}`)) {
        const kind = /\.shape|len\(/.test(t.name) ? DATA_CATEGORY.shapes : /dtype/.test(t.name) ? DATA_CATEGORY.dtypes : /columns/.test(t.name) ? DATA_CATEGORY.columns : DATA_CATEGORY.expected;
        out.push({ category: kind, message: `A check failed: ${t.name}${t.detail ? ` (${t.detail})` : ""}. Your values differ from the expected result.`, suggestion: "Print the variable and compare it with the stage view after each step to find the first step that goes wrong." });
      }
    }
    if (!out.length && validation.tests.some((t) => t.hidden && !t.passed)) out.push({ category: DATA_CATEGORY.transformation, message: "The visible checks pass but a hidden check fails. Think about edge cases: missing values, duplicates, an empty result, unmatched keys.", suggestion: "Try your code on a tiny table that contains those cases." });
    if (!out.length) out.push({ category: DATA_CATEGORY.transformation, message: "The result does not match what the exercise expects.", suggestion: "Compare shape, dtypes and the first rows after each step." });
  }
  return out;
}
