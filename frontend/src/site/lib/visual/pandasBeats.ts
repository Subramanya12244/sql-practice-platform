/**
 * Beats for pandas stages: each operation below becomes a short sequence in which a learner watches the DataFrame transform.
 *
 * Operations with a dedicated sequence (the beats, in order):
 *   df[<bool mask>]            5  input rows, condition per row (operands and True/False), classify, filter (rows move), result
 *   df.query("...")            4  input rows, classify, filter, result
 *   df.dropna()                5  input rows, mark NaN cells, apply the rule, drop (rows move), result
 *   df.drop(<labels>)          4  input rows, classify, drop, result
 *   df.drop_duplicates()       4  input rows, compare (which row repeats which), remove, result
 *   df.sort_values / sort_index 4  current order, read the key, reorder (rows move), result
 *   df[["a","b"]], df["a"]     3  all columns, pick columns, result
 *   df.drop(columns=...)       3  all columns, mark columns, result
 *   a + b, df["x"] > 5         3  operands, row by row, result   (Series operands and scalars)
 *   df["c"] = expr, assign     3  before, calculate each row (operands next to the new values), after
 *   df.fillna / ffill / bfill / interpolate   3  find the gaps, apply the fill rule (NaN → value), result
 *   df.isna / isnull / notna / notnull        3  input values, test every cell, result
 *   df.groupby(key)            3  input rows, find the groups (colours), rows move into groups
 *   <groups>.sum() / mean() / count() / min() / max() / median() / size() / ...   3  the groups, the calculation per group, result
 *   df.merge / df.join / pd.merge  4  two tables, match the keys, keep rows by `how`, result
 * An in-place call (df.dropna(inplace=True), df.sort_values(..., inplace=True)) is recognised from its statement and uses the same beats.
 *
 * Operations without a dedicated sequence use the generic beat (one step with a real four-part story from the stage's analysis):
 * head / tail / sample, rename, reset_index / set_index, astype, pivot / melt / stack, apply / map, string and date accessors, rolling,
 * concat, a column selection on a GroupBy, a boolean mask stored in a variable and later used (the mask itself is a calculation beat,
 * the later filter shows the mask only), `.loc` with labels or slices, and any stage whose data a beat needs is missing.
 *
 * A beat is built only from what the stage holds (input / argument / output snapshots, the mask, the condition's parts, row flow,
 * group snapshots, merge information) and refuses to exist when a check against the real result fails: that stage then falls back to
 * the generic beat. Values in the stories are copied from the snapshots or are exact counts from the analysis; nothing is estimated.
 */
import type { DataBeat, BeatBuilder } from "./dataBeats";
import { isTabular, type DataStage, type StageAnalysis } from "./dataframe";
import { opOf } from "./pandasBeatParts";
import { groupbyBeats, mergeBeats, sortBeats, subsetBeats } from "./pandasBeatsRows";
import { aggBeats, assignBeats, calcBeats, fillBeats, isnaBeats, selectBeats } from "./pandasBeatsCols";

const AGG = new Set(["sum", "mean", "count", "size", "min", "max", "median", "std", "var", "nunique", "first", "last", "prod", "agg", "aggregate"]);

function route(st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null {
  const op = opOf(st);
  const mask = st.argSnaps[0];
  if (st.merge && !st.merge.skipped) return mergeBeats(st, an, index);
  if (st.kind === "binop" || st.kind === "compare") return calcBeats(st, an, index);
  if (st.inputs[0]?.k === "group") return AGG.has(op) ? aggBeats(st, an, index, op) : null;
  if (op === "groupby") return groupbyBeats(st, an, index);
  if (op === "[]") {
    if (isTabular(mask) && mask.dtype === "bool") return subsetBeats(st, an, index, "filter", op);
    return selectBeats(st, an, index, "select");
  }
  switch (op) {
    case "query": return subsetBeats(st, an, index, "query", op);
    case "dropna": return subsetBeats(st, an, index, "dropna", op);
    case "drop_duplicates": return subsetBeats(st, an, index, "dups", op);
    case "drop": return an.colsRemoved.length ? selectBeats(st, an, index, "drop") : subsetBeats(st, an, index, "drop", op);
    case "sort_values": case "sort_index": return sortBeats(st, an, index, op);
    case "fillna": case "ffill": case "bfill": case "interpolate": return fillBeats(st, an, index, op);
    case "isna": case "isnull": case "notna": case "notnull": return isnaBeats(st, an, index, op);
    case "assign": return assignBeats(st, an, index);
    default: break;
  }
  // `df["c"] = ...` is recorded as an in-place change of the DataFrame.
  if (st.kind === "change" && st.op === "in-place") return assignBeats(st, an, index);
  return null;
}

/** Beats for pandas stages. Returns null for operations without a dedicated sequence (they use the generic beat). */
export const pandasBeats: BeatBuilder = (st, an, index) => {
  if (st.error || !st.output || an.domain !== "pandas") return null;
  return route(st, an, index);
};
