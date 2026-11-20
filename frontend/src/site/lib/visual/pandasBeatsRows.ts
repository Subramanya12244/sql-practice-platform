/**
 * Pandas beats that move rows: boolean filter, query, dropna, drop (rows), drop_duplicates, sort_values / sort_index, groupby
 * (rows form groups) and merge / join (keys match). Every beat is built from one stage's own snapshots and row flow.
 * See pandasBeats.ts for the list of operations and for what is not covered.
 */
import type { CondInfo, CondLeaf, DataSnap, DataStage, StageAnalysis } from "./dataframe";
import { isTabular } from "./dataframe";
import type { DataBeat } from "./dataBeats";
import { clip, plural } from "./story";
import {
  beatsOf, callArgs, cmpCells, cellsOf, labelList, quoted, rowWord, sampledText, scalarText, shapeOf, stays, txt, uniqueLabels, valueAt, winOf,
  type FlowBoardData, type FlowCard, type FlowLane, type FlowPos, type FlowView, type Tone, type Win,
} from "./pandasBeatParts";

// ── Board helpers ────────────────────────────────────────────────────────

const base = (lane: number, row: number): FlowPos => ({ lane, row, tone: "normal", show: true });

function finish(lanes: FlowLane[], cards: FlowCard[], links?: FlowBoardData["links"]): FlowBoardData {
  const tones = new Set<Tone>();
  let rows = 1;
  for (const c of cards) for (const p of c.at) { if (p.show) tones.add(p.tone); rows = Math.max(rows, p.row + 1); }
  tones.delete("normal"); tones.delete("group");
  return { lanes, cards, links, legend: [...tones], rows };
}

/** A card for every drawn input row. `mids` are the phases that change a card without moving it; `final` is where it ends. */
function inputCards(inp: Win, mids: ((i: number) => Partial<FlowPos>)[], final: (i: number) => FlowPos, lane = 0): FlowCard[] {
  return inp.rows.map((row, i) => ({
    id: `r:${inp.index[i]}`, label: inp.index[i], cells: cellsOf(row), nan: row.map((c) => c === null),
    at: [base(lane, i), ...mids.map((m) => ({ ...base(lane, i), ...m(i) })), final(i)],
  }));
}

/** Columns of `cols` that a piece of source text names (df["a"], df['a'], df.a). */
export function mentioned(cols: string[], text: string): string[] {
  return cols.filter((c) => text.includes(`['${c}']`) || text.includes(`["${c}"]`) || new RegExp(`\\.${c.replace(/[^\w]/g, "\\$&")}(?![\\w(])`).test(text) || quoted(text).includes(c));
}

const lanesOf = (inp: Win, out: Win, n: number, nk: number, focus: string[], inName = "Input rows", outName = "Result"): FlowLane[] => [
  { label: inName, count: `${n.toLocaleString()}`, cols: inp.cols, focus },
  { label: outName, count: `${nk.toLocaleString()}`, cols: out.cols, focus, placeholder: "kept rows arrive here" },
];

// ── Row subsets: filter, query, dropna, drop, drop_duplicates ────────────

type SubsetKind = "filter" | "query" | "dropna" | "drop" | "dups";

function subsetCore(st: DataStage, an: StageAnalysis) {
  const inp = winOf(st.inputs[0]), out = winOf(st.output);
  const rf = st.rows;
  if (!inp || !out || !rf || rf.ident !== "index" || !rf.shownKept || rf.shownKept.length !== inp.rows.length) return null;
  if (!uniqueLabels(inp) || !uniqueLabels(out) || rf.added) return null;
  if (inp.cols.join("\u0001") !== out.cols.join("\u0001")) return null;
  if (an.rowsIn === null || an.rowsRetained === null || an.rowsRemoved === null) return null;
  return { inp, out, kept: rf.shownKept, n: an.rowsIn, nk: an.rowsRetained, nr: an.rowsRemoved };
}

interface Leafy { leaf: CondLeaf; left: (label: string) => string | null; right: (label: string) => string | null; mask: boolean[] }
const operand = (s: DataSnap | undefined, label: string): string | null => {
  if (!s) return null;
  if (isTabular(s)) { const v = valueAt(s, label); return v === undefined ? null : txt(v); }
  return scalarText(s.r);
};

/** The condition's parts, when every one of them agrees with the real mask row by row. Otherwise null (the picture then shows the mask only). */
function usableCond(cond: CondInfo | null | undefined, inp: Win, mask: boolean[]): { joiner: "&" | "|" | null; leaves: Leafy[] } | null {
  if (!cond || !cond.leaves.length) return null;
  const leaves: Leafy[] = [];
  for (const leaf of cond.leaves) {
    const w = winOf(leaf.mask);
    if (!w || w.index.join("\u0001") !== inp.index.join("\u0001")) return null;
    leaves.push({ leaf, left: (l) => operand(leaf.left, l), right: (l) => operand(leaf.right, l), mask: w.rows.map((r) => r[0] === "True") });
  }
  const combined = inp.index.map((_, i) => (cond.joiner === "|" ? leaves.some((l) => l.mask[i]) : leaves.every((l) => l.mask[i])));
  if (combined.some((v, i) => v !== mask[i])) return null;
  return { joiner: cond.joiner, leaves };
}

function condText(st: DataStage, args: ReturnType<typeof callArgs>, kind: SubsetKind): string {
  if (kind === "query") return clip(quoted(args.pos[0]).join(" ") || args.pos[0] || "the expression", 70);
  const m = /\[(.*)\]\s*$/.exec(st.code);
  return clip(m ? m[1] : st.code, 70);
}

const NAN_RULE = (kw: Record<string, string>): string => {
  if (kw.thresh) return `fewer than ${kw.thresh} non-missing values`;
  const sub = kw.subset ? ` among ${labelList(quoted(kw.subset), 3)}` : "";
  return `${/all/.test(kw.how ?? "") ? "every value" : "any value"}${sub} is missing`;
};

function subsetBeats(st: DataStage, an: StageAnalysis, index: number, kind: SubsetKind, op: string): DataBeat[] | null {
  const core = subsetCore(st, an);
  if (!core) return null;
  const { inp, out, kept, n, nk, nr } = core;
  const args = callArgs(st, op);
  const rows = inp.index;
  const keptL = rows.filter((_, i) => kept[i]), dropL = rows.filter((_, i) => !kept[i]);
  const sample = sampledText(inp, out);
  const shapeIn = shapeOf(an.inShape), shapeOut = shapeOf(an.outShape);
  const nc = inp.ncols;
  const colsTxt = inp.cols.length === inp.ncols ? labelList(inp.cols, 4) : `${inp.cols.length} shown`;

  // The per-kind details: what decides a row, and the words for it.
  let mask: boolean[] | null = null;
  let leaves: ReturnType<typeof usableCond> = null;
  let cond = "";
  let nanFlags = false;
  let dupBadge: ((i: number) => string | undefined) | null = null;
  let rule = "";
  let focus: string[] = [];
  if (kind === "filter") {
    const mk = winOf(st.argSnaps[0]);
    if (!mk || st.argSnaps[0].dtype !== "bool" || mk.index.join("\u0001") !== rows.join("\u0001")) return null;
    mask = mk.rows.map((r) => r[0] === "True");
    if (mask.some((v, i) => v !== kept[i])) return null;
    leaves = usableCond(st.cond, inp, mask);
    cond = condText(st, args, kind);
    focus = mentioned(inp.cols, cond);
    rule = `keep the rows where the condition is True`;
  } else if (kind === "query") {
    cond = condText(st, args, kind);
    focus = mentioned(inp.cols, cond).length ? mentioned(inp.cols, cond) : inp.cols.filter((c) => new RegExp(`\\b${c.replace(/[^\w]/g, "\\$&")}\\b`).test(cond));
    rule = `keep the rows that satisfy ${cond}`;
  } else if (kind === "dropna") {
    if (args.kw.axis || args.pos.length > 0) return null;
    if (inp.cols.length < inp.ncols) return null;
    const subset = args.kw.subset ? quoted(args.kw.subset).filter((c) => inp.cols.includes(c)) : inp.cols;
    if (args.kw.subset && subset.length !== quoted(args.kw.subset).length) return null;
    const idx = subset.map((c) => inp.cols.indexOf(c));
    // The rule must predict the real result for every drawn row, or the picture would claim something pandas did not do.
    const predicted = inp.rows.map((r) => {
      const missing = idx.filter((j) => r[j] === null).length;
      if (args.kw.thresh) return idx.length - missing >= Number(args.kw.thresh);
      return /all/.test(args.kw.how ?? "") ? missing < idx.length : missing === 0;
    });
    if (predicted.some((v, i) => v !== kept[i])) return null;
    nanFlags = true;
    rule = `drop a row when ${NAN_RULE(args.kw)}`;
    focus = inp.cols.filter((_, j) => inp.rows.some((r) => r[j] === null));
  } else if (kind === "drop") {
    if (an.colsRemoved.length || nr === 0) return null;
    rule = `drop the rows whose labels are listed in ${clip(args.kw.index ?? args.kw.labels ?? args.pos[0] ?? "the call", 40)}`;
  } else {
    if (args.kw.keep && !/first/.test(args.kw.keep) && inp.more) return null;
    if (args.pos.length > 0 && !args.kw.subset) return null;
    const subset = args.kw.subset ? quoted(args.kw.subset).filter((c) => inp.cols.includes(c)) : inp.cols;
    if (args.kw.subset && (!subset.length || subset.length !== quoted(args.kw.subset).length)) return null;
    if (!args.kw.subset && inp.cols.length < inp.ncols) return null;
    const idx = subset.map((c) => inp.cols.indexOf(c));
    const keyOf = (r: (string | null)[]) => JSON.stringify(idx.map((j) => r[j]));
    const keep = /last/.test(args.kw.keep ?? "") ? "last" : /False/.test(args.kw.keep ?? "") ? "none" : "first";
    const keys = inp.rows.map(keyOf);
    const first = new Map<string, number>(), lastAt = new Map<string, number>(), count = new Map<string, number>();
    keys.forEach((k, i) => { if (!first.has(k)) first.set(k, i); lastAt.set(k, i); count.set(k, (count.get(k) ?? 0) + 1); });
    const predicted = keys.map((k, i) => (keep === "first" ? first.get(k) === i : keep === "last" ? lastAt.get(k) === i : count.get(k) === 1));
    if (predicted.some((v, i) => v !== kept[i])) return null;
    const complete = !inp.more;
    dupBadge = (i) => {
      const k = keys[i], c = count.get(k) ?? 1;
      if (c === 1) return complete ? "unique" : undefined;
      const survivor = keep === "last" ? lastAt.get(k)! : first.get(k)!;
      if (keep === "none") return `repeated ${complete ? `${c}×` : ""}`.trim();
      return survivor === i ? "original" : `copy of ${rows[survivor]}`;
    };
    focus = subset;
    rule = `a row is a duplicate when ${subset.length === inp.cols.length ? "all its values" : `its ${labelList(subset, 3)}`} equal${subset.length === 1 && inp.cols.length !== 1 ? "s" : ""} an earlier row's${keep === "first" ? "" : ` (keeping the ${keep === "last" ? "last" : "none"})`}`;
  }

  const verdictText = (k: boolean) => (kind === "filter" ? (k ? "True" : "False") : kind === "query" ? (k ? "match" : "no match") : k ? "keep" : "drop");
  const classify = (i: number): Partial<FlowPos> => ({ tone: kept[i] ? "kept" : "removed", verdict: kind === "dups" ? undefined : { value: kept[i], text: verdictText(kept[i]) }, badge: kind === "dups" ? dupBadge?.(i) : undefined, flags: nanFlags || undefined });
  let rank = 0;
  const ranks = kept.map((k) => (k ? rank++ : -1));
  const final = (i: number): FlowPos => (kept[i] ? { lane: 1, row: ranks[i], tone: "kept", show: true, flags: nanFlags || undefined, badge: kind === "dups" ? dupBadge?.(i) : undefined } : { lane: 0, row: i, tone: kind === "dups" ? "dup" : "removed", show: true, fade: true, flags: nanFlags || undefined, badge: kind === "dups" ? dupBadge?.(i) : undefined });
  const mids: ((i: number) => Partial<FlowPos>)[] = kind === "dropna" ? [() => ({ flags: true, tone: "normal" }), classify] : kind === "dups" ? [(i) => ({ badge: dupBadge?.(i), tone: kept[i] ? "normal" : "dup" })] : [classify];
  const board = finish(lanesOf(inp, out, n, nk, focus), inputCards(inp, mids, final));
  const flow = (phase: number, from: number | null, caption: string, extra: Partial<FlowView> = {}): FlowView => ({ owner: "pandas", type: "flow", board, phase, from, caption, sampled: sample, ...extra });
  const fin = mids.length + 1;

  const listSampled = inp.rows.length < n ? " (of the rows drawn)" : "";
  const keptTxt = keptL.length ? rowWord(keptL) : "no drawn row";
  const countLine = `${plural(nk, "row")} kept and ${plural(nr, "row")} removed, out of ${n.toLocaleString()}`;
  const resultCaption = `Result: ${plural(nk, "row")}`;

  // The row-by-row reason, from the real condition operands where the probe recorded them.
  const reasonOf = (i: number): string => {
    const label = rows[i];
    if (kind === "filter") {
      if (leaves) {
        const parts = leaves.leaves.map((l) => { const a = l.left(label), b = l.right(label); return a !== null && b !== null && l.leaf.op ? `${a} ${l.leaf.op} ${b} is ${l.mask[i] ? "True" : "False"}` : `${clip(l.leaf.text, 40)} is ${l.mask[i] ? "True" : "False"}`; });
        return parts.join(leaves.leaves.length > 1 ? (leaves.joiner === "|" ? " or " : " and ") : "");
      }
      return `the condition is ${kept[i] ? "True" : "False"}`;
    }
    if (kind === "dropna") return kept[i] ? "no missing value" : `has a missing value in ${labelList(inp.cols.filter((_, j) => inp.rows[i][j] === null), 3) || "a column"}`;
    if (kind === "dups") return dupBadge?.(i) ?? (kept[i] ? "kept" : "duplicate");
    if (kind === "query") return kept[i] ? "satisfies the query" : "does not satisfy the query";
    return kept[i] ? "its label is not listed" : "its label is listed";
  };
  const reasonLines = rows.slice(0, 12).map((l, i) => `Row ${l}: ${reasonOf(i)} → ${kept[i] ? "kept" : "removed"}`);
  const firstKept = kept.indexOf(true), firstDrop = kept.indexOf(false);
  const whyResult = [firstKept >= 0 ? `Row ${rows[firstKept]} kept: ${reasonOf(firstKept)}.` : "", firstDrop >= 0 ? `Row ${rows[firstDrop]} removed: ${reasonOf(firstDrop)}.` : ""].filter(Boolean).join(" ");

  const input = { title: "Input rows", story: {
    what: `The input has ${plural(n, "row")} and ${plural(nc, "column")} (${colsTxt}). ${kind === "filter" ? `The filter ${cond} decides` : kind === "query" ? `The query ${cond} decides` : kind === "dropna" ? "dropna() decides" : kind === "dups" ? "drop_duplicates() decides" : "drop() decides"} which of them stay.`,
    changed: `Nothing yet: all ${n.toLocaleString()} rows are still here, shape ${shapeIn}.`,
    why: kind === "dups" ? "To find repeats, every row has to be compared with the rows before it, so we start from the whole table." : "A row operation looks at each row on its own, so it starts from the whole table.",
    remember: "Dropping or filtering rows never edits the values in the rows that stay.",
  }, view: flow(0, null, `Input DataFrame: ${plural(n, "row")}`) };

  const result = { title: "Result", story: {
    what: `The result is a new DataFrame with ${plural(nk, "row")}: ${keptL.length ? `${keptTxt}${listSampled}` : "none of the drawn rows"}.`,
    changed: `${countLine}. Shape ${shapeIn} → ${shapeOut}.`,
    why: kind === "filter" || kind === "dropna" || kind === "dups" ? (whyResult || `The rule was: ${rule}.`) : `The rule was: ${rule}.`,
    remember: kind === "dups" ? "The first copy of each row stays unless you pass keep='last' or keep=False." : kind === "dropna" ? "Count the missing values first: dropna can remove more rows than you expect." : "The result keeps the original index labels. Assign it, or the original stays unchanged.",
  }, view: { ...flow(fin, null, resultCaption, { result: { snap: st.output! }, reasons: reasonLines }) } };

  const move = { title: kind === "dups" ? "Remove duplicates" : kind === "drop" ? "Drop rows" : "Filter rows", story: {
    what: kind === "dups" ? "The duplicate rows fade out and the first copies move into the result." : kind === "drop" ? "The listed rows fade out and the other rows move into the result." : `The rows that fail fade out and the kept rows move into the result.`,
    changed: `${plural(n, "row")} → ${plural(nk, "row")}; shape ${shapeIn} → ${shapeOut}. Kept rows keep their labels (${labelList(out.index, 4)}).`,
    why: "Rows are chosen by label: each kept row arrives unchanged, and the others do not appear in the result at all.",
    remember: "The result keeps the original index labels; use reset_index(drop=True) to number the rows 0, 1, 2 again.",
  }, view: flow(fin, fin - 1, `Filtering: ${plural(nk, "row")} move into the result`) };

  if (kind === "filter") {
    const trueL = keptL, falseL = dropL;
    const ex = (i: number) => (i >= 0 ? `Row ${rows[i]}: ${reasonOf(i)}.` : "");
    const evalTitle = { title: "Condition", story: {
      what: `Evaluates ${cond} once for every row.`,
      changed: `${plural(nk, "row")} ${stays(nk, "gives", "give")} True and ${plural(nr, "row")} ${stays(nr, "gives", "give")} False${n > inp.rows.length ? ` (drawn: True for ${labelList(trueL, 3) || "none"}; False for ${labelList(falseL, 3) || "none"})` : `: True for ${labelList(trueL, 4) || "none"}; False for ${labelList(falseL, 4) || "none"}`}.`,
      why: [ex(firstKept), ex(firstDrop)].filter(Boolean).join(" ") || "The condition gives one True or False per row.",
      remember: "A comparison on a column gives one True/False per row, not a single answer.",
    }, view: calcCondition(inp, mask!, leaves, cond, sample) };
    const classifyBeat = { title: "Classify rows", story: {
      what: "Each row is marked: True means keep it, False means drop it.",
      changed: `Keep: ${trueL.length ? rowWord(trueL) : "none"}. Drop: ${falseL.length ? rowWord(falseL) : "none"}${n > inp.rows.length ? ` (drawn rows; exact totals ${nk} kept, ${nr} dropped)` : ""}.`,
      why: "Only rows where the mask is True survive; there is no in-between.",
      remember: "The mask has exactly one value per row, matched to the rows by index label.",
    }, view: flow(1, null, "Rows classified by the condition") };
    return beatsOf(index, [input, evalTitle, classifyBeat, move, result]);
  }
  if (kind === "dropna") {
    const naPer = (st.inputs[0].na ?? []).map((c, j) => (c ? `${inp.cols[j]} ${c}` : "")).filter(Boolean);
    const withNaN = rows.filter((_, i) => inp.rows[i].some((c) => c === null));
    return beatsOf(index, [
      { ...input, story: { ...input.story, what: `The input has ${plural(n, "row")} and ${plural(nc, "column")} (${colsTxt}). dropna() will remove rows that have missing values.` } },
      { title: "Mark missing values", story: {
        what: "Finds the missing values (NaN) in the table and marks them.",
        changed: `${plural(an.missingBefore ?? 0, "missing cell")}${naPer.length ? ` (${labelList(naPer, 4)})` : ""}. ${withNaN.length ? `They sit in ${rowWord(withNaN)}.` : "No drawn row has one."}`,
        why: "NaN means a value is absent. It stays in the table until you remove or fill it.",
        remember: "Count the missing values first (df.isna().sum()) to know what dropna will do.",
      }, view: flow(1, null, "Missing cells are marked") },
      { title: "Apply the rule", story: {
        what: `Applies the rule: ${rule}. Rows are marked keep or drop.`,
        changed: `Keep: ${keptL.length ? rowWord(keptL) : "none"}. Drop: ${dropL.length ? rowWord(dropL) : "none"} (exact: ${nk} kept, ${nr} dropped).`,
        why: "By default dropna removes a row as soon as any of its values is missing, even if the rest is complete.",
        remember: "Use subset=[...] to look at some columns only, or how='all' to drop only empty rows.",
      }, view: flow(2, null, "Rows classified by the rule") },
      { ...move, view: flow(3, 2, `Dropping: ${plural(nk, "row")} move into the result`) },
      { ...result, view: { ...(result.view as FlowView), phase: 3 } },
    ]);
  }
  if (kind === "dups") {
    const copies = rows.filter((_, i) => !kept[i]);
    const eg = (() => { const i = kept.indexOf(false); return i >= 0 ? `${dupBadge?.(i) ?? "a copy"}: ${rows[i]}` : ""; })();
    return beatsOf(index, [
      input,
      { title: "Compare rows", story: {
        what: "Compares every row with the rows before it to find repeats.",
        changed: copies.length ? `${plural(nr, "duplicate row")} found${eg ? ` (${eg})` : ""}. Drawn copies: ${labelList(copies, 4)}.` : `No duplicates among the ${plural(inp.rows.length, "drawn row")}.`,
        why: `${rule.charAt(0).toUpperCase()}${rule.slice(1)}.`,
        remember: "Duplicates are judged on the columns you give, all of them by default.",
      }, view: flow(1, null, "Duplicates marked against the row they repeat") },
      { ...move, view: flow(2, 1, `Removing duplicates: ${plural(nk, "row")} move into the result`) },
      { ...result, view: { ...(result.view as FlowView), phase: 2 } },
    ]);
  }
  // query and drop: no per-row operand values, so the verdict is the real kept/removed.
  return beatsOf(index, [
    input,
    { title: "Classify rows", story: {
      what: kind === "query" ? `Evaluates ${cond} and marks each row as a match or not.` : "Marks the rows named in the call to be dropped.",
      changed: `Keep: ${keptL.length ? rowWord(keptL) : "none"}. Drop: ${dropL.length ? rowWord(dropL) : "none"} (exact: ${nk} kept, ${nr} dropped).`,
      why: kind === "query" ? "query() evaluates a text expression against the columns and keeps the rows where it is True." : "drop() removes rows by their index labels, whatever their values are.",
      remember: kind === "query" ? "A column name with spaces needs backticks inside query()." : "drop() matches labels, not positions.",
    }, view: flow(1, null, "Rows classified") },
    { ...move, view: flow(2, 1, `${plural(nk, "row")} move into the result`) },
    { ...result, view: { ...(result.view as FlowView), phase: 2 } },
  ]);
}

/** The condition beat of a filter: one line per row with the real operands and the True/False verdict chip. */
function calcCondition(inp: Win, mask: boolean[], leaves: ReturnType<typeof usableCond>, cond: string, sample: string | null): import("./pandasBeatParts").CalcView {
  const used = leaves ? new Set(leaves.leaves.flatMap((l) => mentioned(inp.cols, l.leaf.text))) : new Set<string>();
  const identCol = inp.cols.findIndex((c) => !used.has(c));
  const ident = (i: number) => (identCol >= 0 ? [txt(inp.rows[i][identCol])] : []);
  const chip = (v: boolean) => ({ text: v ? "True" : "False", chip: (v ? "true" : "false") as "true" | "false" });
  // A leaf shows its operands only when every drawn row has them; otherwise it shows its verdict alone, the same way in every row.
  const hasOps = (l: Leafy) => !!l.leaf.op && inp.index.every((x) => l.left(x) !== null && l.right(x) !== null);
  const rows = inp.index.map((label, i) => {
    const parts: import("./pandasBeatParts").CalcPart[] = [];
    if (leaves) {
      leaves.leaves.forEach((l) => {
        if (hasOps(l)) parts.push({ text: `${l.left(label)} ${l.leaf.op} ${l.right(label)}` });
        parts.push(chip(l.mask[i]));
      });
      if (leaves.leaves.length > 1) parts.push({ text: leaves.leaves.map((l) => (l.mask[i] ? "True" : "False")).join(` ${leaves.joiner} `) }, chip(mask[i]));
    } else parts.push(chip(mask[i]));
    return { label, ident: ident(i), parts };
  });
  const heads: { text: string; span: number }[] = leaves ? leaves.leaves.map((l) => ({ text: clip(l.leaf.text, 36), span: hasOps(l) ? 2 : 1 })) : [{ text: clip(cond, 36), span: 1 }];
  if (leaves && leaves.leaves.length > 1) heads.push({ text: `combined (${leaves.joiner})`, span: 2 });
  return { owner: "pandas", type: "calc", heads, identHeads: identCol >= 0 ? [inp.cols[identCol]] : [], rows, caption: `The condition ${clip(cond, 50)} for every row`, sampled: sample };
}

// ── Sort ─────────────────────────────────────────────────────────────────

function sortBeats(st: DataStage, an: StageAnalysis, index: number, op: string): DataBeat[] | null {
  const inp = winOf(st.inputs[0]), out = winOf(st.output);
  const rf = st.rows;
  if (!inp || !out || !rf || rf.ident !== "index" || !uniqueLabels(inp) || !uniqueLabels(out) || rf.added || an.rowsIn === null) return null;
  const n = an.rowsIn;
  const args = callArgs(st, op);
  const byIndex = op === "sort_index";
  const keys = byIndex ? [] : inp.kind === "series" ? [inp.cols[0]] : quoted(args.kw.by ?? args.pos[0]).filter((c) => inp.cols.includes(c));
  const asc = /False/.test(args.kw.ascending ?? "") ? (/True/.test(args.kw.ascending ?? "") ? null : false) : true;
  // The direction is only stated when the real output really is in that order.
  const keyCol = keys.length ? out.cols.indexOf(keys[0]) : -1;
  const vals = keyCol >= 0 ? out.rows.map((r) => r[keyCol]) : byIndex ? out.index.map((l) => l as string | null) : [];
  let dirOk = false;
  if (asc !== null && vals.length) {
    const non = vals.filter((v) => v !== null);
    dirOk = non.every((v, i) => i === 0 || (asc ? cmpCells(non[i - 1], v) <= 0 : cmpCells(non[i - 1], v) >= 0));
  }
  const dir = dirOk ? (asc ? "from smallest to largest" : "from largest to smallest") : "";
  const keyName = byIndex ? "the index labels" : keys.length ? labelList(keys, 3) : "the sort key";
  const sample = sampledText(inp, out);
  const rows = inp.index;
  const pos = rows.map((l) => out.index.indexOf(l));
  const finalOf = (i: number): FlowPos => (pos[i] >= 0 ? { lane: 1, row: pos[i], tone: "normal", show: true } : { lane: 0, row: i, tone: "normal", show: true, fade: true, badge: "sorted beyond the drawn rows" });
  const cards = inputCards(inp, [(i) => ({ badge: pos[i] >= 0 ? `→ #${pos[i] + 1}` : "→ later" })], finalOf);
  out.index.forEach((l, j) => {
    if (rows.includes(l)) return;
    cards.push({ id: `r:${l}`, label: l, cells: cellsOf(out.rows[j]), nan: out.rows[j].map((c) => c === null), at: [{ ...base(1, j), show: false }, { ...base(1, j), show: false }, { ...base(1, j), badge: "from beyond the drawn rows" }] });
  });
  const board = finish([
    { label: "Current order", count: n.toLocaleString(), cols: inp.cols, focus: keys },
    { label: "Sorted order", count: n.toLocaleString(), cols: out.cols, focus: keys, placeholder: "rows land here in the new order" },
  ], cards);
  const flow = (phase: number, from: number | null, caption: string, extra: Partial<FlowView> = {}): FlowView => ({ owner: "pandas", type: "flow", board, phase, from, caption, sampled: sample, ...extra });
  const before = rows.filter((l) => out.index.includes(l)), after = out.index.filter((l) => rows.includes(l));
  const reordered = rf.reordered !== false && before.join("\u0001") !== after.join("\u0001");
  const moves = rows.map((l, i) => (pos[i] >= 0 ? `row ${l} → #${pos[i] + 1}` : "")).filter(Boolean);
  const keyOfRow = (j: number) => (keyCol >= 0 ? `${keys[0]}=${txt(out.rows[j][keyCol])}` : `label ${out.index[j]}`);
  const sh = shapeOf(an.inShape);
  return beatsOf(index, [
    { title: "Current order", story: {
      what: `The table has ${plural(n, "row")} in this order: ${labelList(rows, 6)}.`,
      changed: `Nothing yet: the order is still ${labelList(rows, 6)}; shape ${sh}.`,
      why: "Rows sit in the order they were created. Sorting is the only thing that changes that order.",
      remember: "The index labels are not positions: they stay with their rows when the order changes.",
    }, view: flow(0, null, `Input DataFrame: ${plural(n, "row")}`) },
    { title: "Read the sort key", story: {
      what: `Reads ${keyName} of every row and ranks the rows${dir ? ` ${dir}` : ""}.`,
      changed: `New positions: ${labelList(moves, 4) || "none drawn"}.`,
      why: byIndex ? "sort_index orders rows by their labels, not by any column." : `sort_values orders the whole row by the values in ${keyName}${keys.length > 1 ? ", breaking ties with the next key" : ""}.`,
      remember: "Missing values (NaN) go last unless you pass na_position='first'.",
    }, view: flow(1, null, "Each row's new position") },
    { title: "Reorder rows", story: {
      what: "The rows move to their new positions. Every row travels with its label and all its values.",
      changed: reordered ? `New order: ${labelList(after, 6)} (was ${labelList(before, 6)}). Shape stays ${sh}.` : `The order did not change: the rows were already sorted. Shape stays ${sh}.`,
      why: "Sorting changes only the order: the same rows, the same values, the same labels.",
      remember: "Sorting returns a new DataFrame. Assign it, or use inplace=True.",
    }, view: flow(2, 1, "Rows move into the sorted order") },
    { title: "Result", story: {
      what: `The sorted DataFrame starts with ${keyOfRow(0)} and ${n > out.rows.length ? `its first ${out.rows.length} rows are drawn` : `ends with ${keyOfRow(out.rows.length - 1)}`}.`,
      changed: `Same ${plural(n, "row")}, new order: ${labelList(out.index, 6)}${n > out.rows.length ? ", …" : ""}.`,
      why: dir ? `The values of ${keyName} now run ${dir}.` : `The rows are in the order of ${keyName}.`,
      remember: "To number the rows 0, 1, 2 again after sorting, use reset_index(drop=True).",
    }, view: flow(2, null, "Result: sorted rows", { result: { snap: st.output! } }) },
  ]);
}

// ── GroupBy: rows form groups ────────────────────────────────────────────

export const GROUP_WORD = (i: number) => `group ${i + 1}`;

function groupbyBeats(st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null {
  const inp = winOf(st.inputs[0]), out = st.output;
  if (!inp || st.inputs[0].k !== "df" || out?.k !== "group" || !out.groups || out.ngroups == null || out.srcRows == null || !uniqueLabels(inp)) return null;
  const groups = out.groups;
  const owner = new Map<string, number>();
  groups.forEach((g, gi) => { for (const l of winOf(g.snap)?.index ?? []) if (!owner.has(l)) owner.set(l, gi); });
  const complete = !inp.more && groups.length === out.ngroups && groups.every((g) => g.size <= (winOf(g.snap)?.rows.length ?? 0));
  const by = out.by ?? [];
  const keyName = by.length ? labelList(by, 3) : "the key";
  const rows = inp.index;
  const lost = out.inGroups != null ? out.srcRows - out.inGroups : 0;
  const sample = sampledText(inp) ?? (groups.length < out.ngroups ? `Sampled: ${groups.length} of ${out.ngroups} groups are drawn. The numbers in the text are exact.` : null);
  // Layout of the groups lane: a header, then the members that are drawn (in input order).
  let row = 0;
  const lane1 = new Map<number, { head: number; members: Map<string, number> }>();
  groups.forEach((_g, gi) => {
    const head = row++;
    const members = new Map<string, number>();
    rows.forEach((l) => { if (owner.get(l) === gi) members.set(l, row++); });
    lane1.set(gi, { head, members });
  });
  const cards: FlowCard[] = inputCards(inp, [(i) => {
    const gi = owner.get(rows[i]);
    return gi !== undefined ? { tone: "group", group: gi, badge: groups[gi].key } : complete ? { tone: "removed", badge: "no key" } : {};
  }], (i) => {
    const gi = owner.get(rows[i]);
    if (gi !== undefined) return { lane: 1, row: lane1.get(gi)!.members.get(rows[i])!, tone: "group", show: true, group: gi };
    return { lane: 0, row: i, tone: complete ? "removed" : "normal", show: true, fade: true, badge: complete ? "no key" : undefined };
  });
  groups.forEach((g, gi) => {
    const l = lane1.get(gi)!;
    cards.push({ id: `g:${gi}`, label: g.key, cells: [], head: `${keyName} = ${g.key} · ${plural(g.size, "row")}`, at: [{ ...base(1, l.head), show: false }, { ...base(1, l.head), show: false }, { ...base(1, l.head), tone: "group", group: gi }] });
  });
  const board = finish([
    { label: "Input rows", count: out.srcRows.toLocaleString(), cols: inp.cols, focus: by },
    { label: "Groups", count: `${out.ngroups}`, cols: inp.cols, focus: by, placeholder: "groups form here" },
  ], cards);
  const flow = (phase: number, from: number | null, caption: string): FlowView => ({ owner: "pandas", type: "flow", board, phase, from, caption, sampled: sample });
  const sizes = groups.map((g) => `${g.key} (${plural(g.size, "row")})`);
  const sh = shapeOf(an.inShape);
  const missing = lost > 0 ? ` ${plural(lost, "row")} with a missing key ${lost === 1 ? "is" : "are"} left out.` : "";
  return beatsOf(index, [
    { title: "Input rows", story: {
      what: `The table has ${plural(out.srcRows, "row")}. groupby(${by.map((b) => `'${b}'`).join(", ") || "…"}) will sort them into groups by ${keyName}.`,
      changed: `Nothing yet: ${plural(out.srcRows, "row")}, shape ${sh}, all still in one table.`,
      why: "Grouping starts from the whole table and looks at the key of every row.",
      remember: "groupby does not copy or change the rows; it only decides which group each belongs to.",
    }, view: flow(0, null, `Input DataFrame: ${plural(out.srcRows, "row")}`) },
    { title: "Find the groups", story: {
      what: `Reads ${keyName} of every row. Rows with the same key get the same colour.`,
      changed: `${plural(out.ngroups, "distinct key")}: ${labelList(sizes, 5)}.${missing}`,
      why: "Rows with equal keys belong to one group, wherever they sit in the table.",
      remember: "Rows whose key is missing (NaN) are left out of every group by default.",
    }, view: flow(1, null, "Rows coloured by their key") },
    { title: "Rows move into groups", story: {
      what: "The rows move into their groups. Nothing is added up yet.",
      changed: `${plural(out.srcRows, "row")} → ${plural(out.ngroups, "group")}; each row is in exactly one group (${labelList(sizes, 4)}).${missing}`,
      why: "A GroupBy object holds one small table per key. The calculation happens in the next step.",
      remember: "groupby alone computes nothing. The aggregation after it does the arithmetic.",
    }, view: flow(2, 1, "Rows gathered into groups") },
  ]);
}

// ── Merge / join ─────────────────────────────────────────────────────────

function mergeBeats(st: DataStage, an: StageAnalysis, index: number): DataBeat[] | null {
  const m = st.merge;
  if (!m || m.skipped || m.leftShown === undefined || m.rightShown === undefined || !m.leftKeys || !m.rightKeys) return null;
  const leftSnap = st.inputs[0], rightSnap = st.inputs[1] ?? st.argSnaps[0];
  const L = winOf(leftSnap), R = winOf(rightSnap), O = winOf(st.output);
  if (!L || !R || !O || L.kind !== "df" || R.kind !== "df" || !uniqueLabels(L) || !uniqueLabels(R)) return null;
  if (L.rows.length !== m.leftShown.length || R.rows.length !== m.rightShown.length) return null;
  const how = m.how;
  // The key of a row: the key columns' cells, or the index label when the merge is on the index.
  const keyFn = (w: Win, names: string[]): ((i: number) => string) | null => {
    if (names.every((c) => w.cols.includes(c))) { const idx = names.map((c) => w.cols.indexOf(c)); return (i) => idx.map((j) => txt(w.rows[i][j])).join(" | "); }
    if (m.viaJoin) return (i) => w.index[i];
    return null;
  };
  const kl = keyFn(L, m.leftKeys), kr = keyFn(R, m.rightKeys);
  const leftKeysOf = kl ? L.rows.map((_, i) => kl(i)) : null, rightKeysOf = kr ? R.rows.map((_, i) => kr(i)) : null;
  const sameKeyCols = m.leftKeys.join() === m.rightKeys.join();
  // Lines only when the drawn keys agree with the real matched / unmatched flags, so a line never contradicts the real result.
  let links: FlowBoardData["links"];
  if (leftKeysOf && rightKeysOf) {
    const rightSet = new Set(rightKeysOf), leftSet = new Set(leftKeysOf);
    const agreeL = L.more || R.more ? true : leftKeysOf.every((k, i) => rightSet.has(k) === (m.leftShown![i] === "matched"));
    const agreeR = L.more || R.more ? true : rightKeysOf.every((k, i) => leftSet.has(k) === (m.rightShown![i] === "matched"));
    if (agreeL && agreeR) {
      links = [];
      leftKeysOf.forEach((k, i) => rightKeysOf.forEach((k2, j) => { if (k === k2) links!.push({ a: `L:${L.index[i]}`, b: `R:${R.index[j]}`, from: 1 }); }));
    }
  }
  // What `how` keeps, per side: unmatched rows survive only on the preserved side(s).
  const keepsLeftOnly = how === "left" || how === "outer", keepsRightOnly = how === "right" || how === "outer";
  const keyFocusL = m.leftKeys.filter((c) => L.cols.includes(c)), keyFocusR = m.rightKeys.filter((c) => R.cols.includes(c));
  const card = (side: "L" | "R", w: Win, flags: ("matched" | "unmatched")[], lane: number, keepsUnmatched: boolean): FlowCard[] => w.rows.map((r, i) => {
    const matched = flags[i] === "matched";
    const matchPos: Partial<FlowPos> = { tone: matched ? "matched" : "unmatched", badge: matched ? undefined : "no match" };
    return {
      id: `${side}:${w.index[i]}`, label: w.index[i], cells: cellsOf(r), nan: r.map((c) => c === null),
      at: [base(lane, i), { ...base(lane, i), ...matchPos }, { ...base(lane, i), ...matchPos, fade: !matched && !keepsUnmatched, tone: !matched && !keepsUnmatched ? "removed" : (matchPos.tone as Tone) }],
    };
  });
  const board = finish([
    { label: "Left table", count: m.leftRows?.toLocaleString(), cols: L.cols, focus: keyFocusL },
    { label: "Right table", count: m.rightRows?.toLocaleString(), cols: R.cols, focus: keyFocusR },
  ], [...card("L", L, m.leftShown, 0, keepsLeftOnly), ...card("R", R, m.rightShown, 1, keepsRightOnly)], links);
  const sample = sampledText(L, R);
  const flow = (phase: number, caption: string, extra: Partial<FlowView> = {}): FlowView => ({ owner: "pandas", type: "flow", board, phase, from: null, caption, sampled: sample, ...extra });
  const keyTxt = sameKeyCols ? labelList(m.leftKeys, 3) : `${labelList(m.leftKeys, 3)} (left) = ${labelList(m.rightKeys, 3)} (right)`;
  const matched = m.matchedKeys ?? [];
  const matchedTxt = matched.length ? labelList(matched.map((k) => `${k.key} (${k.left}×${k.right})`), 4) : "none";
  const multiplied = matched.filter((k) => (k.left ?? 1) * (k.right ?? 1) > 1);
  const lu = m.leftUnmatchedRows ?? 0, ru = m.rightUnmatchedRows ?? 0, out = m.outRows ?? O.nrows;
  const oc = m.originCounts ?? {};
  const howWord = how === "inner" ? "Only rows with a match on both sides survive." : how === "left" ? "Every left row survives; right rows without a match are dropped." : how === "right" ? "Every right row survives; left rows without a match are dropped." : "Every row from both sides survives.";
  const fillWord = how === "left" ? "Left rows with no match get NaN in the right table's columns." : how === "right" ? "Right rows with no match get NaN in the left table's columns." : how === "outer" ? "Rows with no match get NaN in the other table's columns." : "No NaN is added: unmatched rows are simply gone.";
  return beatsOf(index, [
    { title: "Two tables", story: {
      what: `Two tables will be combined on ${keyTxt}: the left has ${plural(m.leftRows ?? L.nrows, "row")}, the right has ${plural(m.rightRows ?? R.nrows, "row")}.`,
      changed: `Nothing yet. Left shape ${shapeOf([L.nrows, L.ncols])}, right shape ${shapeOf([R.nrows, R.ncols])}.`,
      why: "A merge needs a key: a column (or the index) whose values identify the same thing in both tables.",
      remember: "Check that the key columns mean the same thing and have the same type on both sides.",
    }, view: flow(0, "The left and the right table; key columns highlighted") },
    { title: "Match the keys", story: {
      what: `Compares the key values of every left row with those of the right table. Equal keys match.`,
      changed: `${plural(m.matchedKeyCount ?? 0, "key")} appear on both sides: ${matchedTxt}. ${plural(lu, "left row")} and ${plural(ru, "right row")} have no match.`,
      why: "Equal key values pair up. Keys that exist on one side only have nothing to pair with.",
      remember: "Rows with no match disappear in an inner merge. Use how='left' to keep every left row.",
    }, view: flow(1, "Matching keys are linked; rows without a match are marked") },
    { title: `Keep rows (${how})`, story: {
      what: `how='${how}' decides which rows survive. ${howWord}`,
      changed: `${plural(lu, "left-only row")} ${keepsLeftOnly ? stays(lu) : stays(lu, "is dropped", "are dropped")}; ${plural(ru, "right-only row")} ${keepsRightOnly ? stays(ru) : stays(ru, "is dropped", "are dropped")}.${multiplied.length ? ` Repeated keys multiply: ${labelList(multiplied.map((k) => `${k.key}: ${k.left}×${k.right} = ${(k.left ?? 1) * (k.right ?? 1)} rows`), 3)}.` : ""}`,
      why: `${fillWord} A key that appears a times on the left and b times on the right gives a×b rows.`,
      remember: "Duplicate keys multiply rows. Compare row counts before and after a merge.",
    }, view: flow(2, `how='${how}': which unmatched rows stay`) },
    { title: "Result", story: {
      what: `The merged DataFrame has ${plural(out, "row")} and ${plural(O.ncols, "column")}.`,
      changed: `${Object.keys(oc).length ? `${labelList(Object.entries(oc).map(([k, v]) => `${v} ${k.replace("_", " ")}`), 3)}. ` : ""}Rows ${m.leftRows ?? L.nrows} + ${m.rightRows ?? R.nrows} → ${out}; shape ${shapeOf(an.outShape)}.`,
      why: m.pairRows !== undefined ? `Matched keys make ${plural(m.pairRows, "row")}${keepsLeftOnly || keepsRightOnly ? `, unmatched rows add ${plural(out - m.pairRows, "row")}` : ""}, so ${out} in total.` : `The result has one row per matched pair${keepsLeftOnly || keepsRightOnly ? " plus the preserved unmatched rows" : ""}.`,
      remember: "Pass indicator=True to see which side each row came from.",
    }, view: { owner: "pandas", type: "table", snap: st.output!, caption: `Result: merged, ${plural(out, "row")}`, marks: "merge", keyCols: m.leftKeys, sampled: sampledText(O) } },
  ]);
}

export { subsetBeats, sortBeats, groupbyBeats, mergeBeats };
