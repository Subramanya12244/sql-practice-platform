/**
 * Beats: the steps a learner moves through in the Pandas and NumPy visualizers.
 *
 * The data probe records one *stage* per operation (see dataframe.ts). A stage is often several ideas at once: a boolean filter
 * evaluates a condition, classifies each row, drops some and returns the rest. A beat is one of those ideas, shown on its own, so the
 * learner can watch the computation unfold, pause on any part of it and read what it means.
 *
 *   stage 3  df[df["salary"] > 50000]   ->  beat 1 input, 2 condition per row, 3 kept / removed, 4 filtered rows move, 5 result
 *
 * Beats are built only from the data the stage already holds (snapshots, masks, shapes, row marks, merge and group information).
 * They never run code and never invent a value: when the stage lacks what a beat would need, that beat is not produced, and the
 * stage falls back to one generic beat. `model.steps` equals the number of beats, so the workspace player, the code highlight, the
 * story and the picture all use the same index.
 *
 *   pandasBeats (pandasBeats.ts) and numpyBeats (numpyBeats.ts) return the beats of a stage, or null to use the generic one.
 */
import type { DataModelData, DataStage, StageAnalysis } from "./dataframe";
import { numpyShape, pyShape } from "./broadcast";
import { clip, plural, STORY_MAX, type StepStory } from "./story";
import { numpyBeats } from "./numpyBeats";
import { pandasBeats } from "./pandasBeats";

/** What a beat draws. `owner` picks the renderer; `type` is the owner's own name for the picture. */
export interface BeatView { owner: "generic" | "pandas" | "numpy"; type: string; [k: string]: unknown }

export interface DataBeat {
  /** Stable within a run: "<stage>.<beat>". */
  id: string;
  stage: number;
  /** 0-based position inside the stage, and how many beats the stage has. */
  beat: number;
  of: number;
  /** Short name for the timeline and the step heading: "Condition", "Filter", "Align shapes". */
  title: string;
  story: StepStory;
  view: BeatView;
}

export type BeatBuilder = (st: DataStage, an: StageAnalysis, index: number) => DataBeat[] | null;

const shapeText = (s: number[] | null, domain: StageAnalysis["domain"]) => (s ? (domain === "numpy" ? numpyShape(s) : pyShape(s)) : null);

/** Why the common operations behave as they do. Used only when a domain builder has no beats of its own for the stage. */
const WHY: Record<string, string> = {
  "[]": "Square brackets pick columns by name, rows by a True/False condition, or cells by position, depending on what is inside them.",
  sort_values: "Sorting reorders rows by a column's values. The row labels travel with their rows, so each row keeps its identity.",
  groupby: "groupby splits the rows into one bucket per distinct key. Nothing is added up until an aggregation is applied.",
  merge: "merge matches rows from two tables whose key columns are equal, the same idea as a SQL join.",
  dropna: "dropna removes rows that contain a missing value (NaN), so only complete rows remain.",
  fillna: "fillna replaces missing values with a chosen value; every other cell stays as it was.",
  drop_duplicates: "drop_duplicates keeps the first row of each repeated combination of values and removes the later copies.",
  rename: "rename changes labels only. The data in the cells is untouched.",
  assign: "assign returns a new table with an extra or replaced column, computed from the existing ones row by row.",
  reshape: "reshape gives the same elements, in the same order, a new shape. The total number of elements must stay the same.",
  T: "Transposing swaps the axes: rows become columns and columns become rows.",
  sum: "A reduction collapses the values along an axis into one number per lane.",
  mean: "A reduction collapses the values along an axis into one number per lane.",
  "+": "Arithmetic on arrays works element by element, and NumPy stretches size-1 dimensions to make the shapes fit.",
  ">": "A comparison is evaluated for every element and gives True or False for each one.",
  "@": "Matrix multiplication takes a row of the first matrix and a column of the second, multiplies them pairwise and adds them up.",
};

const REMEMBER: Record<string, string> = {
  "[]": "Check what is inside the brackets: a name selects a column, a True/False column filters rows.",
  sort_values: "Sorting never changes values, only the order. Assign the result or use inplace to keep it.",
  groupby: "groupby alone computes nothing. The aggregation after it does the arithmetic.",
  merge: "Rows with no matching key disappear in an inner merge. Use how='left' to keep every left row.",
  dropna: "Count the missing values first: dropna can remove more rows than you expect.",
  fillna: "Fill with a value that fits the column's meaning, not just any number.",
  drop_duplicates: "Duplicates are judged on the columns you give, all of them by default.",
  rename: "rename returns a new table unless you assign it back.",
  assign: "A new column is computed from existing columns without a loop.",
  reshape: "Shape changes never change the order of the elements, only how they are grouped.",
  T: "A transpose of an (r, c) array is (c, r).",
  sum: "axis=0 collapses the rows, axis=1 collapses the columns.",
  mean: "axis=0 collapses the rows, axis=1 collapses the columns.",
  "+": "Right-align two shapes: each pair of dimensions must be equal or one of them must be 1.",
  ">": "Comparisons give a mask. Use the mask to select the matching elements.",
  "@": "For (m, n) @ (n, p) the inner n must match, and the result is (m, p).",
};

/** The "what changed" line: only measured numbers. */
function changedLine(st: DataStage, an: StageAnalysis, what = ""): string {
  const parts: string[] = [];
  const a = shapeText(an.inShape, an.domain), b = shapeText(an.outShape, an.domain);
  if (a && b) parts.push(a === b ? `Shape stays ${b}` : `Shape ${a} → ${b}`);
  else if (b) parts.push(`Result shape ${b}`);
  if (an.rowsExact && an.rowsRetained !== null && an.rowsRemoved !== null && an.rowsIn !== null) parts.push(`${plural(an.rowsRetained, "row")} kept, ${plural(an.rowsRemoved, "row")} removed`);
  else if (an.rowsIn !== null && an.rowsOut !== null && an.rowsIn !== an.rowsOut) parts.push(`rows ${an.rowsIn.toLocaleString()} → ${an.rowsOut.toLocaleString()}`);
  if (an.colsAdded.length) parts.push(`added ${clip(an.colsAdded.join(", "), 40)}`);
  if (an.colsRemoved.length) parts.push(`removed ${clip(an.colsRemoved.join(", "), 40)}`);
  if (an.dtypeChanges.length) parts.push(`dtype ${an.dtypeChanges.slice(0, 2).map((d) => `${d.name}: ${d.before} → ${d.after}`).join(", ")}`);
  if (an.missingBefore !== null && an.missingAfter !== null && an.missingBefore !== an.missingAfter) parts.push(`missing cells ${an.missingBefore} → ${an.missingAfter}`);
  if (st.error) parts.unshift(`It raised ${st.error.type}`);
  // Numbers the "what" sentence already states are not repeated in this card (unless nothing else would be left).
  const fresh = parts.filter((p) => !what.includes(p));
  const shown = fresh.length ? fresh : parts;
  return shown.length ? `${shown.join("; ")}.` : st.unchanged ? "Nothing changed: the data is exactly as it was." : "The result is a new value; the input was not changed.";
}

/** A story for any stage, from its own analysis. Domain builders write sharper ones for the operations they know. */
export function genericDataStory(st: DataStage, an: StageAnalysis): StepStory {
  const full = (an.explanation || "").trim();
  // The analysis explanation is built from measured numbers and is one or two sentences: use all of it when it is short enough.
  const what = full && full.length <= STORY_MAX ? full : full.split(/(?<=\.)\s/)[0]?.trim() || `Runs ${clip(st.code || st.expr, 80)}.`;
  const why = WHY[st.op] ?? (an.domain === "numpy" ? "Every NumPy step returns a new array (or a view of the same memory); your variable only changes when you assign it." : "Every pandas step returns a new object; your variable only changes when you assign the result back.");
  const remember = REMEMBER[st.op] ?? (an.domain === "numpy" ? "Print the shape after each step: most NumPy surprises are shape surprises." : "Look at the shape and dtypes after each step to catch surprises early.");
  return { what, changed: changedLine(st, an, what), why, remember };
}

export function genericBeat(st: DataStage, an: StageAnalysis, index: number): DataBeat {
  return { id: `${index}.0`, stage: index, beat: 0, of: 1, title: an.title, story: genericDataStory(st, an), view: { owner: "generic", type: "stage" } };
}

/** All beats of a run, in order. Every stage yields at least one. */
export function buildDataBeats(data: Pick<DataModelData, "stages" | "analyses">): DataBeat[] {
  const out: DataBeat[] = [];
  data.stages.forEach((st, i) => {
    const an = data.analyses[i];
    let beats: DataBeat[] | null = null;
    try { beats = (an.domain === "numpy" ? numpyBeats : pandasBeats)(st, an, i); } catch { beats = null; }
    if (!beats || beats.length === 0) beats = [genericBeat(st, an, i)];
    beats.forEach((b, k) => out.push({ ...b, id: `${i}.${k}`, stage: i, beat: k, of: beats!.length }));
  });
  return out;
}

/** The beat for a player step, clamped. */
export const beatAt = (beats: DataBeat[], step: number): DataBeat | undefined => beats[Math.min(Math.max(0, step), Math.max(0, beats.length - 1))];
