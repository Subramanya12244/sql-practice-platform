/**
 * Shared pieces of the pandas beats (pandasBeats.ts) and their pictures (components/visual/PandasBeatView.tsx): the view types a beat
 * carries, windows over the stage's snapshots, argument parsing, and the small checks that keep a picture honest.
 *
 * Everything here is pure and works only on what a stage already holds. A view holds copies of the real cells, labels and flags it
 * needs, so a picture is a function of its beat alone and nothing is looked up or computed while stepping.
 */
import type { Cell, DataSnap, DataStage } from "./dataframe";
import { isTabular } from "./dataframe";
import type { BeatView, DataBeat } from "./dataBeats";
import { pyShape } from "./broadcast";
import { storyProblems, type StepStory } from "./story";

/** What a row card or a cell looks like. Colour is never the only signal: every tone has a word and a glyph. */
export type Tone = "normal" | "kept" | "removed" | "matched" | "unmatched" | "dup" | "group" | "new" | "used" | "nan";
export const TONE_WORD: Record<Tone, string> = { normal: "row", kept: "kept", removed: "removed", matched: "matched", unmatched: "no match", dup: "duplicate", group: "grouped", new: "new", used: "used", nan: "missing" };
export const TONE_GLYPH: Record<Tone, string> = { normal: "", kept: "✓", removed: "✕", matched: "=", unmatched: "?", dup: "≡", group: "", new: "+", used: "", nan: "∅" };

/** Where one row card is at one phase of a board. */
export interface FlowPos {
  lane: number;
  row: number;
  tone: Tone;
  /** False: the card is not there yet (it fades in). */
  show: boolean;
  /** True: the card stays but is de-emphasized (a removed row). */
  fade?: boolean;
  verdict?: { value: boolean; text: string };
  badge?: string;
  /** Index into the group colours. */
  group?: number;
  /** Highlight the missing cells of the card. */
  flags?: boolean;
}
export interface FlowCard {
  id: string;
  label: string;
  cells: string[];
  /** Which cells are NaN. */
  nan?: boolean[];
  /** A header card (a group name) shows this text instead of cells. */
  head?: string;
  at: FlowPos[];
}
export interface FlowLane { label: string; count?: string; cols: string[]; focus: string[]; placeholder?: string }
export interface FlowBoardData {
  lanes: FlowLane[];
  cards: FlowCard[];
  /** Pairs of card ids drawn as a line between the two lanes, from this phase on (merge keys). */
  links?: { a: string; b: string; from: number; to?: number }[];
  /** Tones that occur, for the legend. */
  legend: Tone[];
  /** Rows the tallest lane needs at any phase. */
  rows: number;
}

export interface FlowView {
  owner: "pandas"; type: "flow";
  board: FlowBoardData;
  phase: number;
  /** The phase the cards travel from in this beat; null when nothing moves. Reduced motion draws that phase and `phase` as two static boards. */
  from: number | null;
  caption: string;
  result?: { snap: DataSnap; marks?: "merge"; keyCols?: string[] } | null;
  /** One line per row explaining its fate (result beats). */
  reasons?: string[];
  sampled?: string | null;
}

export interface GridData {
  cols: string[];
  dtypes: string[];
  index: string[];
  rows: Cell[][];
  colTone: Tone[];
  colTag: (string | null)[];
  /** Cell-level tone, row by column (null = none). */
  cellTone?: (Tone | null)[][];
  /** Text shown instead of a cell's value ("NaN → 46.5"), row by column (null = the value itself). */
  cellText?: (string | null)[][];
  /** Every column of the table when only some are drawn, so a chosen column is never lost. */
  all?: { name: string; tone: Tone }[] | null;
  shape: number[];
  more: boolean;
}
export interface GridView { owner: "pandas"; type: "grid"; grid: GridData; caption: string; sampled?: string | null }
/** The real DataFrameView of a snapshot (result beats). */
export interface TableView { owner: "pandas"; type: "table"; snap: DataSnap; before?: DataSnap | null; caption: string; marks?: "merge"; keyCols?: string[]; sampled?: string | null; reasons?: string[] }

export interface CalcPart { text: string; chip?: "true" | "false" | "value"; muted?: boolean }
export interface CalcRow { label: string; ident: string[]; parts: CalcPart[] }
export interface CalcView {
  owner: "pandas"; type: "calc";
  heads: { text: string; span: number }[];
  /** Number of identity columns (the label, then these). */
  identHeads: string[];
  rows: CalcRow[];
  caption: string;
  sampled?: string | null;
  /** Hide the result parts (the last part of each leaf) until this beat; the "operands" beat shows only the inputs. */
  hideResult?: boolean;
}

export interface GroupBlock {
  key: string;
  size: number;
  color: number;
  members: { label: string; cells: string[] }[];
  hidden: number;
  /** One line per aggregated column. */
  calcs: { col: string; fn: string; values: string[]; value: string; complete: boolean }[];
}
export interface GroupsView {
  owner: "pandas"; type: "groups";
  /** 0 the groups, 1 each group's calculation, 2 the result. */
  phase: 0 | 1 | 2;
  cols: string[];
  groups: GroupBlock[];
  moreGroups: number;
  fn: string;
  result?: DataSnap | null;
  caption: string;
  sampled?: string | null;
}

export type PandasView = FlowView | GridView | TableView | CalcView | GroupsView;

// ── Windows over snapshots ───────────────────────────────────────────────

export const txt = (c: Cell | undefined): string => (c === null || c === undefined ? "NaN" : c);

/** The drawn part of a DataFrame or Series: columns, row labels and cells as recorded. */
export interface Win {
  kind: "df" | "series";
  cols: string[];
  dtypes: string[];
  index: string[];
  rows: Cell[][];
  /** Exact totals. */
  nrows: number;
  ncols: number;
  more: boolean;
  allCols: string[];
}
export function winOf(s: DataSnap | null | undefined): Win | null {
  if (!isTabular(s) || !s.rows || !s.shape) return null;
  const index = s.index ?? s.rows.map((_, i) => String(i));
  if (index.length !== s.rows.length) return null;
  if (s.k === "df") {
    if (!s.cols) return null;
    return { kind: "df", cols: s.cols, dtypes: s.dtypes ?? s.cols.map(() => ""), index, rows: s.rows, nrows: s.shape[0], ncols: s.shape[1] ?? s.cols.length, more: !!s.more, allCols: s.colNames ?? s.cols };
  }
  const name = s.name ?? "value";
  return { kind: "series", cols: [name], dtypes: [s.dtype ?? ""], index, rows: s.rows, nrows: s.shape[0], ncols: 1, more: !!s.more, allCols: [name] };
}
export const uniqueLabels = (w: Win) => new Set(w.index).size === w.index.length;
export const cellsOf = (row: Cell[]) => row.map(txt);

/** Value of a tabular snapshot (one column) at a row label. Undefined when the label is not drawn. */
export function valueAt(s: DataSnap, label: string, col = 0): Cell | undefined {
  const w = winOf(s);
  if (!w) return undefined;
  const i = w.index.indexOf(label);
  return i < 0 ? undefined : w.rows[i][col];
}

/** "0, 2" / "0, 1, 2, 3 and 5 more". */
export function labelList(labels: string[], max = 4): string {
  if (labels.length <= max) return labels.join(", ");
  return `${labels.slice(0, max).join(", ")} and ${labels.length - max} more`;
}
export const rowWord = (labels: string[]) => `${labels.length === 1 ? "row" : "rows"} ${labelList(labels)}`;

/** "first 12 of 40 rows" text for a sampled picture, or null when everything is drawn. */
export function sampledText(w: Win | null, extra?: Win | null): string | null {
  const parts: string[] = [];
  for (const x of [w, extra]) {
    if (!x) continue;
    const r = x.rows.length < x.nrows ? `the first ${x.rows.length} of ${x.nrows.toLocaleString()} rows` : "";
    const c = x.cols.length < x.ncols ? `${x.cols.length} of ${x.ncols} columns` : "";
    if (r || c) parts.push([r, c].filter(Boolean).join(" and "));
  }
  return parts.length ? `Sampled: the picture draws ${[...new Set(parts)].join("; ")}. The numbers in the text are exact.` : null;
}

// ── Argument text ────────────────────────────────────────────────────────

/** Split "a, b=[1, 2], c='x,y'" at the top-level commas. */
export function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = ""; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export interface Args { pos: string[]; kw: Record<string, string> }
/** The arguments of the call `.op(...)` this stage ran: the recorded values when there are any, else the source text. */
export function callArgs(st: DataStage, op: string): Args {
  if (st.argsRepr || st.kwargsRepr) return { pos: [...(st.argsRepr ?? [])], kw: { ...(st.kwargsRepr ?? {}) } };
  const src = st.code;
  const at = src.lastIndexOf(`.${op}(`);
  if (at < 0) return { pos: [], kw: {} };
  let depth = 0, quote = "", end = -1;
  for (let i = at + op.length + 1; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  const inner = end < 0 ? "" : src.slice(at + op.length + 2, end);
  const args: Args = { pos: [], kw: {} };
  for (const a of splitTop(inner)) {
    const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/.exec(a);
    if (m) args.kw[m[1]] = m[2]; else args.pos.push(a);
  }
  return args;
}
/** Strings quoted in an argument ("'a'", "['a', 'b']"), in order. */
export const quoted = (t: string | undefined): string[] => (t ? [...t.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]) : []);

/** The method the stage ran, including an in-place call such as `df.dropna(inplace=True)` recorded as a change. */
export function opOf(st: DataStage): string {
  if (st.kind !== "change") return st.op;
  const m = /\.(dropna|fillna|drop_duplicates|sort_values|sort_index|drop|ffill|bfill)\s*\(/.exec(st.stmt);
  return m && /inplace\s*=\s*True/.test(st.stmt) ? m[1] : st.op;
}

/** Compare two table cells the way pandas orders them: numbers by value, text by code point, missing last. */
export function cmpCells(a: Cell, b: Cell): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const x = Number(a), y = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && !Number.isNaN(x) && !Number.isNaN(y)) return x < y ? -1 : x > y ? 1 : 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Beat assembly ────────────────────────────────────────────────────────

export interface Spec { title: string; story: StepStory; view: PandasView }
/** The beats of one stage. Null when any story would not pass the story guard: a broken sentence is never shown. */
export function beatsOf(index: number, specs: Spec[]): DataBeat[] | null {
  for (const s of specs) if (storyProblems(s.story, { allowNaN: true }).length) return null;
  return specs.map((s, k) => ({ id: `${index}.${k}`, stage: index, beat: k, of: specs.length, title: s.title, story: s.story, view: s.view as unknown as BeatView }));
}

export const shapeOf = (s: number[] | null | undefined) => (s ? pyShape(s) : "?");
export const tail = (xs: string[], n = 1) => xs.slice(0, n);

/** A recorded scalar as a learner would write it: numpy 2 reprs such as `np.float64(53750.0)` become `53750.0`. */
export const scalarText = (r: string): string => /^np\.(?:float|int|uint|bool_?|str_)\d*\((.*)\)$/.exec(r)?.[1] ?? r;
/** "1 row stays" / "2 rows stay". */
export const stays = (n: number, one = "stays", many = "stay") => (n === 1 ? one : many);
