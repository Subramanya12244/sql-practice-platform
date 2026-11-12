/**
 * Excel Lab engine. A small teaching formula engine: a real tokenizer, parser and evaluator for a documented SUBSET of
 * Excel formulas, plus a pivot table, conditional formatting and data-cleaning model.
 * It is a SIMULATION of Excel, not Excel: results follow Excel's documented rules for the functions below, but anything
 * outside the subset (see UNSUPPORTED) is not evaluated. Pure TypeScript, no React, no network, deterministic.
 */

// ── Values and errors ────────────────────────────────────────────────────
/** The first seven are Excel's names. #CIRC! and #SYNTAX! are lab-only: Excel shows a warning (and 0) for a circular
 *  reference and refuses to accept a formula with a syntax error, so a lab has to show something in the cell. */
export type ErrCode = "#DIV/0!" | "#N/A" | "#REF!" | "#NAME?" | "#VALUE!" | "#NUM!" | "#NULL!" | "#CIRC!" | "#SYNTAX!";
export interface XErr { error: ErrCode }
export type Val = number | string | boolean | null | XErr;
export type Matrix = Val[][];
type R = Val | Matrix;

export const isErr = (v: unknown): v is XErr => typeof v === "object" && v !== null && !Array.isArray(v) && "error" in (v as object);
export const xerr = (error: ErrCode): XErr => ({ error });

class XlErr extends Error { constructor(public code: ErrCode) { super(code); } }
const fail = (c: ErrCode): never => { throw new XlErr(c); };
const chk = (v: Val): Exclude<Val, XErr> => (isErr(v) ? fail(v.error) : v);

/** What a lab learner should know about each error. */
export const ERROR_HELP: Record<ErrCode, string> = {
  "#DIV/0!": "A number was divided by zero (or by an empty cell).",
  "#N/A": "A lookup found no match (Not Available).",
  "#REF!": "A reference points at a cell that does not exist, for example after copying a formula off the top or left edge of the sheet.",
  "#NAME?": "Excel does not know this function or name; check the spelling.",
  "#VALUE!": "A value has the wrong type, for example text where a number is needed.",
  "#NUM!": "A number is invalid for the operation (for example a negative square root).",
  "#NULL!": "An intersection of two ranges that do not overlap.",
  "#CIRC!": "Lab marker: a circular reference. Excel warns and shows 0; this lab shows the cycle instead.",
  "#SYNTAX!": "Lab marker: Excel would refuse to enter this formula (a syntax error).",
};

export const UNSUPPORTED = [
  "Dynamic arrays and spilling (FILTER, SORT, UNIQUE, a range returned into a cell)",
  "Whole-column and whole-row references (A:A, 1:1)",
  "Other sheets and workbooks (Sheet2!A1), defined names, Excel Tables and structured references",
  "LET, LAMBDA, array formulas ({=...}), implicit intersection",
  "Volatile functions (TODAY, NOW, RAND) because the lab is deterministic",
  "Number formats other than the common ones TEXT understands; time-of-day formatting",
  "Iterative calculation (circular references are reported, never iterated)",
  "Any function not in SUPPORTED_FUNCTIONS (this is a subset of Excel)",
];

// ── Addresses ────────────────────────────────────────────────────────────
export const MAX_COL = 16384, MAX_ROW = 1048576;
export const colName = (n: number): string => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
export const colNum = (s: string): number => [...s.toUpperCase()].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
export const addrOf = (col: number, row: number) => colName(col) + row;
export function parseAddr(a: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a.trim());
  if (!m) return null;
  const col = colNum(m[1]), row = Number(m[2]);
  return col >= 1 && col <= MAX_COL && row >= 1 && row <= MAX_ROW ? { col, row } : null;
}
export interface Ref { col: number; row: number; absCol: boolean; absRow: boolean }
export interface Rect { c1: number; r1: number; c2: number; r2: number }
const refAddr = (r: Ref) => addrOf(r.col, r.row);
const rectOf = (a: Ref, b: Ref): Rect => ({ c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row), c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row) });
/** "B2:D5" or "B2" to a rectangle. */
export function parseRange(s: string): Rect | null {
  const [a, b] = s.trim().toUpperCase().split(":");
  const p = parseAddr(a), q = parseAddr(b ?? a);
  return p && q ? { c1: Math.min(p.col, q.col), r1: Math.min(p.row, q.row), c2: Math.max(p.col, q.col), r2: Math.max(p.row, q.row) } : null;
}
export const rectAddrs = (r: Rect, cap = 5000): string[] => {
  const out: string[] = [];
  for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) { if (out.length >= cap) return out; out.push(addrOf(col, row)); }
  return out;
};
const inRect = (r: Rect, col: number, row: number) => col >= r.c1 && col <= r.c2 && row >= r.r1 && row <= r.r2;

// ── Tokenizer ────────────────────────────────────────────────────────────
type TokT = "num" | "str" | "ref" | "fn" | "name" | "bool" | "err" | "op" | "(" | ")" | ",";
interface Tok { t: TokT; v: string; s: number; e: number }
class SyntaxErr extends Error {}
const ERR_LITERALS = ["#DIV/0!", "#N/A", "#REF!", "#NAME?", "#VALUE!", "#NUM!", "#NULL!"] as const;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if (ch === '"') {
      let j = i + 1, s = "";
      for (;;) {
        if (j >= src.length) throw new SyntaxErr("Text in quotes is not closed");
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      out.push({ t: "str", v: s, s: i, e: j + 1 }); i = j + 1; continue;
    }
    if ((m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest))) { out.push({ t: "num", v: m[0], s: i, e: i + m[0].length }); i += m[0].length; continue; }
    if (ch === "#") {
      const lit = ERR_LITERALS.find((e) => rest.toUpperCase().startsWith(e));
      if (!lit) throw new SyntaxErr("Unknown error literal");
      out.push({ t: "err", v: lit, s: i, e: i + lit.length }); i += lit.length; continue;
    }
    // A cell reference: letters and digits, not followed by "(" or more identifier characters (so LOG10( is a function).
    if ((m = /^\$?[A-Za-z]{1,3}\$?\d+(?![A-Za-z0-9_.(])/.exec(rest))) { out.push({ t: "ref", v: m[0], s: i, e: i + m[0].length }); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest))) {
      const word = m[0], next = src[i + word.length];
      const t: TokT = next === "(" ? "fn" : /^(TRUE|FALSE)$/i.test(word) ? "bool" : "name";
      out.push({ t, v: word, s: i, e: i + word.length }); i += word.length; continue;
    }
    if ((m = /^(<>|<=|>=)/.exec(rest))) { out.push({ t: "op", v: m[0], s: i, e: i + 2 }); i += 2; continue; }
    if ("+-*/^&=<>%:".includes(ch)) { out.push({ t: "op", v: ch, s: i, e: i + 1 }); i++; continue; }
    if (ch === "(" || ch === ")" || ch === ",") { out.push({ t: ch, v: ch, s: i, e: i + 1 }); i++; continue; }
    if (ch === "!") throw new SyntaxErr("References to other sheets are not supported in this lab");
    if (ch === ";") throw new SyntaxErr("Use a comma between arguments");
    throw new SyntaxErr(`Unexpected character "${ch}"`);
  }
  return out;
}

function toRef(v: string): Ref | null {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(v)!;
  const col = colNum(m[2]), row = Number(m[4]);
  return col >= 1 && col <= MAX_COL && row >= 1 && row <= MAX_ROW ? { col, row, absCol: !!m[1], absRow: !!m[3] } : null;
}

// ── Parser ───────────────────────────────────────────────────────────────
interface Base { s: number; e: number }
export type Node = Base & (
  | { k: "num"; v: number } | { k: "str"; v: string } | { k: "bool"; v: boolean } | { k: "err"; v: ErrCode } | { k: "empty" }
  | { k: "ref"; r: Ref } | { k: "range"; a: Ref; b: Ref }
  | { k: "un"; op: string; x: Node } | { k: "pct"; x: Node } | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "call"; name: string; args: Node[] } | { k: "name"; name: string });

function parseTokens(src: string): Node {
  const toks = tokenize(src);
  let i = 0;
  const isOp = (...o: string[]) => toks[i]?.t === "op" && o.includes(toks[i].v);
  const bin = (sub: () => Node, ops: string[]): Node => {
    let l = sub();
    while (isOp(...ops)) { const op = toks[i++].v; const r = sub(); l = { k: "bin", op, l, r, s: l.s, e: r.e }; }
    return l;
  };
  const cmp = (): Node => bin(concat, ["=", "<>", "<=", ">=", "<", ">"]);
  const concat = (): Node => bin(add, ["&"]);
  const add = (): Node => bin(mul, ["+", "-"]);
  const mul = (): Node => bin(pow, ["*", "/"]);
  // Excel binds unary minus tighter than ^, so -2^2 is 4.
  const pow = (): Node => bin(unary, ["^"]);
  const unary = (): Node => {
    if (isOp("-", "+")) { const t = toks[i++]; const x = unary(); return { k: "un", op: t.v, x, s: t.s, e: x.e }; }
    return postfix();
  };
  const postfix = (): Node => { let x = primary(); while (isOp("%")) { const t = toks[i++]; x = { k: "pct", x, s: x.s, e: t.e }; } return x; };
  const primary = (): Node => {
    const t = toks[i];
    if (!t) throw new SyntaxErr("The formula ends too early");
    i++;
    switch (t.t) {
      case "num": return { k: "num", v: Number(t.v), s: t.s, e: t.e };
      case "str": return { k: "str", v: t.v, s: t.s, e: t.e };
      case "bool": return { k: "bool", v: t.v.toUpperCase() === "TRUE", s: t.s, e: t.e };
      case "err": return { k: "err", v: t.v as ErrCode, s: t.s, e: t.e };
      case "name": return { k: "name", name: t.v.toUpperCase(), s: t.s, e: t.e };
      case "ref": {
        const a = toRef(t.v);
        if (isOp(":") && toks[i + 1]?.t === "ref") {
          const t2 = toks[i + 1]; i += 2;
          const b = toRef(t2.v);
          return a && b ? { k: "range", a, b, s: t.s, e: t2.e } : { k: "err", v: "#REF!", s: t.s, e: t2.e };
        }
        if (isOp(":")) throw new SyntaxErr("Whole-column and whole-row references are not supported in this lab");
        return a ? { k: "ref", r: a, s: t.s, e: t.e } : { k: "err", v: "#REF!", s: t.s, e: t.e };
      }
      case "(": {
        const inner = cmp();
        const close = toks[i];
        if (close?.t !== ")") throw new SyntaxErr("A closing bracket is missing");
        i++;
        return { ...inner, s: t.s, e: close.e };
      }
      case "fn": {
        const name = t.v.toUpperCase();
        i++; // "("
        const args: Node[] = [];
        if (toks[i]?.t === ")") { i++; return { k: "call", name, args, s: t.s, e: toks[i - 1].e }; }
        for (;;) {
          const here = toks[i];
          if (!here) throw new SyntaxErr("A closing bracket is missing");
          if (here.t === "," || here.t === ")") args.push({ k: "empty", s: here.s, e: here.s });
          else args.push(cmp());
          const sep = toks[i];
          if (sep?.t === ",") { i++; continue; }
          if (sep?.t === ")") { i++; return { k: "call", name, args, s: t.s, e: sep.e }; }
          throw new SyntaxErr("Expected a comma or a closing bracket");
        }
      }
      default: throw new SyntaxErr(`Unexpected "${t.v}"`);
    }
  };
  const root = cmp();
  if (i < toks.length) throw new SyntaxErr(`Unexpected "${toks[i].v}"`);
  return root;
}

export type Parsed = { ok: true; node: Node; src: string } | { ok: false; message: string; src: string };
const parseCache = new Map<string, Parsed>();
/** Parse formula text WITHOUT the leading "=". Cached because the grid re-evaluates often. */
export function parseFormula(src: string): Parsed {
  const hit = parseCache.get(src);
  if (hit) return hit;
  let r: Parsed;
  try { r = { ok: true, node: parseTokens(src), src }; } catch (e) { if (e instanceof SyntaxErr) r = { ok: false, message: e.message, src }; else throw e; }
  if (parseCache.size > 500) parseCache.clear();
  parseCache.set(src, r);
  return r;
}

// ── Coercion and comparison ──────────────────────────────────────────────
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON3 = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Excel 1900 date system: serial 1 = 1900-01-01. (The famous fake 29 Feb 1900 is not modelled; serials from 61 are exact.) */
export function dateToSerial(y: number, m: number, d: number): number {
  const dt = new Date(0); dt.setUTCFullYear(y, m - 1, d);
  const days = Math.round(dt.getTime() / 864e5) + 25569;
  return days < 61 ? days - 1 : days;
}
export function serialToDate(s: number): Date { const f = Math.floor(s); return new Date(((f < 61 ? f + 1 : f) - 25569) * 864e5); }

/** Text that Excel would read as a date: ISO yyyy-mm-dd, US m/d/yyyy, or "5 Mar 2025". */
export function parseDateText(t: string): number | null {
  const s = t.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return validDate(+m[3], +m[1], +m[2]);
  m = /^(\d{1,2}) ([A-Za-z]{3,9}),? (\d{4})$/.exec(s);
  if (m) { const mi = MON3.indexOf(m[2].toLowerCase().slice(0, 3)); return mi >= 0 ? validDate(+m[3], mi + 1, +m[1]) : null; }
  return null;
}
function validDate(y: number, mo: number, d: number): number | null {
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(0); dt.setUTCFullYear(y, mo - 1, d);
  return dt.getUTCMonth() === mo - 1 ? dateToSerial(y, mo, d) : null;
}

/** Text to number as Excel's VALUE and arithmetic do: spaces, $, thousands commas, %, and date text. */
export function parseNumText(t: string): number | null {
  let s = t.trim();
  if (s === "") return null;
  const d = parseDateText(s);
  if (d !== null) return d;
  s = s.replace(/^([+-]?)\$/, "$1");
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?%?$/.test(s)) s = s.replace(/,/g, "");
  const pct = s.endsWith("%");
  if (pct) s = s.slice(0, -1);
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  return pct ? Number(s) / 100 : Number(s);
}

const num = (v: Val): number => {
  const x = chk(v);
  if (x === null) return 0;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number") return x;
  const n = parseNumText(x);
  return n === null ? fail("#VALUE!") : n;
};
/** General number text: up to 15 significant digits, like Excel. */
export const numStr = (n: number): string => (Number.isInteger(n) && Math.abs(n) < 1e15 ? String(n) : String(+n.toPrecision(15)));
const str = (v: Val): string => { const x = chk(v); return x === null ? "" : typeof x === "boolean" ? (x ? "TRUE" : "FALSE") : typeof x === "number" ? numStr(x) : x; };
const rank = (v: Exclude<Val, XErr>) => (typeof v === "number" ? 1 : typeof v === "string" ? 2 : typeof v === "boolean" ? 3 : 0);

/** Excel ordering: numbers < text < booleans; text compares without regard to case; a blank acts like 0, "" or FALSE. */
export function cmpVals(a0: Val, b0: Val): number {
  let a = chk(a0), b = chk(b0);
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === "number" ? 0 : typeof b === "string" ? "" : false;
  if (b === null) b = typeof a === "number" ? 0 : typeof a === "string" ? "" : false;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "string" && typeof b === "string") { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return Number(a) - Number(b);
}

const wildRe = (p: string) => new RegExp("^" + p.replace(/~([*?~])|[.+^${}()|[\]\\]|\*|\?/g, (m, esc) => (esc ? "\\" + esc : m === "*" ? ".*" : m === "?" ? "." : "\\" + m)) + "$", "i");

/** Criteria such as ">=3", "North", "<>x", "a*", or a plain number, as used by SUMIF, COUNTIF and friends. */
export function parseCriteria(c: Val): (v: Val) => boolean {
  const x = chk(c);
  const numEq = (n: number) => (v: Val) => (typeof v === "number" ? v === n : typeof v === "string" ? parseNumText(v) === n : false);
  if (typeof x === "number") return numEq(x);
  if (typeof x === "boolean") return (v) => v === x;
  const s = x ?? "";
  const m = /^(>=|<=|<>|>|<|=)?([\s\S]*)$/.exec(s)!;
  const op = m[1] ?? "=", operand = m[2];
  const n = operand.trim() === "" ? null : parseNumText(operand);
  if (n !== null && !/^[A-Za-z]/.test(operand)) {
    switch (op) {
      case "=": return numEq(n);
      case "<>": return (v) => !numEq(n)(v);
      case ">": return (v) => typeof v === "number" && v > n;
      case ">=": return (v) => typeof v === "number" && v >= n;
      case "<": return (v) => typeof v === "number" && v < n;
      default: return (v) => typeof v === "number" && v <= n;
    }
  }
  if (op === "=" || op === "<>") {
    const eq: (v: Val) => boolean = operand === ""
      ? (v) => v === null || v === ""
      : ((re) => (v: Val) => typeof v === "string" ? re.test(v) : typeof v === "number" ? re.test(numStr(v)) : false)(wildRe(operand));
    return op === "=" ? eq : (v) => !eq(v);
  }
  const lo = operand.toLowerCase();
  return (v) => {
    if (typeof v !== "string") return false;
    const t = v.toLowerCase();
    return op === ">" ? t > lo : op === ">=" ? t >= lo : op === "<" ? t < lo : t <= lo;
  };
}

// ── Number and date formatting (TEXT) ────────────────────────────────────
const roundHalfUp = (x: number, d: number) => { const f = 10 ** d; return (Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON))) / f; };
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The formats TEXT understands: 0, 0.00, #,##0.00, 0%, $#,##0, 000, yyyy-mm-dd, dd/mm/yyyy, mmm, mmmm, ddd, dddd, d-mmm-yy. */
export function formatText(v: Val, fmt: string): string {
  const x = chk(v);
  if (fmt === "" || fmt.toLowerCase() === "general") return str(x);
  if (fmt === "@") return str(x);
  const isDate = /[ymd]/i.test(fmt.replace(/"[^"]*"/g, "")) && !/[0#]/.test(fmt.replace(/"[^"]*"/g, ""));
  if (isDate) {
    const n = typeof x === "string" ? parseNumText(x) : x === null ? 0 : typeof x === "boolean" ? fail("#VALUE!") : x;
    if (n === null) return fail("#VALUE!");
    if (n < 0) return fail("#NUM!");
    const dt = serialToDate(n), Y = dt.getUTCFullYear(), M = dt.getUTCMonth(), D = dt.getUTCDate(), W = dt.getUTCDay();
    const p2 = (k: number) => String(k).padStart(2, "0");
    return fmt.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, (t) => {
      switch (t.toLowerCase()) {
        case "yyyy": return String(Y);
        case "yy": return p2(Y % 100);
        case "mmmm": return MONTHS[M][0].toUpperCase() + MONTHS[M].slice(1);
        case "mmm": return MONTHS[M][0].toUpperCase() + MONTHS[M].slice(1, 3);
        case "mm": return p2(M + 1);
        case "m": return String(M + 1);
        case "dddd": return DAYS[W];
        case "ddd": return DAYS[W].slice(0, 3);
        case "dd": return p2(D);
        default: return String(D);
      }
    });
  }
  const n0 = typeof x === "string" ? parseNumText(x) : x === null ? 0 : typeof x === "boolean" ? fail("#VALUE!") : x;
  if (n0 === null) return str(x);
  const sections = fmt.split(";");
  const f = n0 < 0 && sections.length > 1 ? sections[1] : sections[0];
  const m = /[#0,]+(\.[0#]+)?/.exec(f);
  if (!m) return f.replace(/"/g, "");
  let n = n0;
  if (f.includes("%")) n *= 100;
  const dec = (m[1] ?? "").length ? m[1].length - 1 : 0;
  const intPat = m[0].split(".")[0];
  const minInt = (intPat.match(/0/g) ?? []).length;
  const neg = n < 0 && !(sections.length > 1);
  const abs = roundHalfUp(Math.abs(n), dec);
  const fixed = abs.toFixed(dec);
  let [ip, fp] = fixed.split(".");
  if (ip.length < minInt) ip = ip.padStart(minInt, "0");
  if (intPat.includes(",")) ip = group(ip);
  const body = ip + (fp ? "." + fp : "");
  const pre = f.slice(0, m.index).replace(/["\\]/g, ""), post = f.slice(m.index + m[0].length).replace(/["\\]/g, "");
  return (neg ? "-" : "") + pre + body + post;
}

/** General display for a grid cell. */
export function showVal(v: Val): string {
  if (isErr(v)) return v.error;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return numStr(+v.toPrecision(10));
  return v;
}

// ── Evaluation context ───────────────────────────────────────────────────
export interface LookupProbe { i: number; value: Val; verdict: "equal" | "differs" | "le" | "gt" | "candidate" | "skip" }
export interface LookupTrace {
  fn: string; text: string; lookupValue: Val; keys: Val[]; orientation: "column" | "row";
  mode: "exact" | "approximate" | "approximate-descending" | "next-smaller" | "next-larger" | "wildcard";
  probes: LookupProbe[]; matchIndex: number; result: Val; note: string;
}
export interface TraceStep { text: string; value: string; kind: "ref" | "range" | "call" | "op" | "unary" | "percent" | "name"; note?: string }
interface Ctx { get(addr: string): Val; src: string; trace?: TraceStep[]; lookups?: LookupTrace[] }

const nodeText = (n: Node, c: Ctx) => c.src.slice(n.s, n.e);
function describeR(v: R): string {
  if (Array.isArray(v)) return `${v.length}\u00d7${v[0]?.length ?? 0} range`;
  if (isErr(v)) return v.error;
  return typeof v === "string" ? `"${v}"` : v === null ? "(empty)" : showVal(v);
}

function ev(n: Node, c: Ctx): R {
  let v: R;
  try { v = raw(n, c); } catch (e) { if (e instanceof XlErr) v = xerr(e.code); else throw e; }
  if (c.trace && n.k !== "num" && n.k !== "str" && n.k !== "bool" && n.k !== "err" && n.k !== "empty") {
    const text = nodeText(n, c);
    const kind: TraceStep["kind"] = n.k === "bin" ? "op" : n.k === "un" ? "unary" : n.k === "pct" ? "percent" : n.k;
    let note: string | undefined;
    if (n.k === "call" && (n.name === "IF" || n.name === "IFS" || n.name === "IFERROR")) note = "Only the branch that is needed is evaluated.";
    if (n.k === "name") note = "Defined names are not supported in this lab.";
    if (n.k === "ref" && c.get(refAddr(n.r)) === null) note = "Empty cell: counts as 0 in arithmetic and as empty text in &.";
    c.trace.push({ text, value: describeR(v), kind, note });
  }
  return v;
}
/** A scalar value (a 1x1 range collapses; a bigger range in scalar position is a #VALUE! because arrays are not supported). */
const sraw = (n: Node, c: Ctx): Val => {
  const v = ev(n, c);
  if (Array.isArray(v)) return v.length === 1 && v[0].length === 1 ? v[0][0] : xerr("#VALUE!");
  return v;
};
const S = (n: Node, c: Ctx): Exclude<Val, XErr> => chk(sraw(n, c));
const M = (n: Node, c: Ctx): Matrix => { const v = ev(n, c); if (Array.isArray(v)) return v; return [[chk(v)]]; };
const flat = (m: Matrix): Val[] => m.flat();

function raw(n: Node, c: Ctx): R {
  switch (n.k) {
    case "num": return n.v;
    case "str": return n.v;
    case "bool": return n.v;
    case "err": return xerr(n.v);
    case "empty": return null;
    case "name": return xerr("#NAME?");
    case "ref": return c.get(refAddr(n.r));
    case "range": {
      const r = rectOf(n.a, n.b), out: Matrix = [];
      if ((r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) > 200000) fail("#VALUE!");
      for (let row = r.r1; row <= r.r2; row++) { const line: Val[] = []; for (let col = r.c1; col <= r.c2; col++) line.push(c.get(addrOf(col, row))); out.push(line); }
      return out;
    }
    case "un": { const x = num(S(n.x, c)); return n.op === "-" ? -x : x; }
    case "pct": return num(S(n.x, c)) / 100;
    case "bin": return binary(n, c);
    case "call": {
      const f = FUNCS[n.name];
      if (!f) return xerr("#NAME?");
      return f(n.args, c, n);
    }
  }
}

function binary(n: Extract<Node, { k: "bin" }>, c: Ctx): Val {
  const l = S(n.l, c), r = S(n.r, c);
  switch (n.op) {
    case "+": return num(l) + num(r);
    case "-": return num(l) - num(r);
    case "*": return num(l) * num(r);
    case "/": { const d = num(r); return d === 0 ? fail("#DIV/0!") : num(l) / d; }
    case "^": { const x = num(l) ** num(r); return Number.isFinite(x) ? x : fail("#NUM!"); }
    case "&": return str(l) + str(r);
    case "=": return cmpVals(l, r) === 0;
    case "<>": return cmpVals(l, r) !== 0;
    case "<": return cmpVals(l, r) < 0;
    case ">": return cmpVals(l, r) > 0;
    case "<=": return cmpVals(l, r) <= 0;
    default: return cmpVals(l, r) >= 0;
  }
}

// ── Functions ────────────────────────────────────────────────────────────
type Fn = (a: Node[], c: Ctx, n: Extract<Node, { k: "call" }>) => R;
const FUNCS: Record<string, Fn> = {};
const argc = (a: Node[], min: number, max = min) => { if (a.length < min || a.length > max) fail("#SYNTAX!"); };
const def = (names: string, f: Fn) => { for (const nm of names.split(" ")) FUNCS[nm] = f; };
const truthy = (v: Exclude<Val, XErr>): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === null) return false;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return fail("#VALUE!");
};

/** Numbers for SUM-like functions: in ranges and references only numbers count (text and booleans are skipped); direct arguments are coerced. */
function numbersOf(a: Node[], c: Ctx): number[] {
  const out: number[] = [];
  for (const n of a) {
    if (n.k === "range" || n.k === "ref") { for (const v of flat(M(n, c))) { chk(v); if (typeof v === "number") out.push(v); } }
    else { const v = ev(n, c); if (Array.isArray(v)) { for (const x of flat(v)) { chk(x); if (typeof x === "number") out.push(x); } } else if (n.k === "empty") continue; else out.push(num(v)); }
  }
  return out;
}
def("SUM", (a, c) => numbersOf(a, c).reduce((x, y) => x + y, 0));
def("AVERAGE", (a, c) => { const x = numbersOf(a, c); return x.length ? x.reduce((p, q) => p + q, 0) / x.length : fail("#DIV/0!"); });
def("MIN", (a, c) => { const x = numbersOf(a, c); return x.length ? Math.min(...x) : 0; });
def("MAX", (a, c) => { const x = numbersOf(a, c); return x.length ? Math.max(...x) : 0; });
def("MEDIAN", (a, c) => { const x = numbersOf(a, c).sort((p, q) => p - q); if (!x.length) return fail("#NUM!"); const h = x.length >> 1; return x.length % 2 ? x[h] : (x[h - 1] + x[h]) / 2; });
def("COUNT", (a, c) => {
  let k = 0;
  for (const n of a) {
    if (n.k === "range" || n.k === "ref") k += flat(M(n, c)).filter((v) => typeof v === "number").length;
    else { const v = sraw(n, c); if (typeof v === "number" || (typeof v === "string" && parseNumText(v) !== null) || typeof v === "boolean") k++; }
  }
  return k;
});
const allVals = (a: Node[], c: Ctx): Val[] => a.flatMap((n) => (n.k === "empty" ? [] : flat(M2(n, c))));
/** Like M but errors stay as values (COUNTA counts them). */
const M2 = (n: Node, c: Ctx): Matrix => { const v = ev(n, c); return Array.isArray(v) ? v : [[v]]; };
def("COUNTA", (a, c) => allVals(a, c).filter((v) => v !== null).length);
def("COUNTBLANK", (a, c) => allVals(a, c).filter((v) => v === null || v === "").length);
def("ABS", (a, c) => { argc(a, 1); return Math.abs(num(S(a[0], c))); });
def("INT", (a, c) => { argc(a, 1); return Math.floor(num(S(a[0], c))); });
def("SQRT", (a, c) => { argc(a, 1); const x = num(S(a[0], c)); return x < 0 ? fail("#NUM!") : Math.sqrt(x); });
def("POWER", (a, c) => { argc(a, 2); const x = num(S(a[0], c)) ** num(S(a[1], c)); return Number.isFinite(x) ? x : fail("#NUM!"); });
def("MOD", (a, c) => { argc(a, 2); const x = num(S(a[0], c)), d = num(S(a[1], c)); return d === 0 ? fail("#DIV/0!") : x - d * Math.floor(x / d); });
def("ROUND", (a, c) => { argc(a, 2); return roundHalfUp(num(S(a[0], c)), Math.trunc(num(S(a[1], c)))); });
def("ROUNDUP", (a, c) => { argc(a, 2); const x = num(S(a[0], c)), f = 10 ** Math.trunc(num(S(a[1], c))); return (Math.sign(x) * Math.ceil(Math.abs(x) * f - 1e-9)) / f; });
def("ROUNDDOWN", (a, c) => { argc(a, 2); const x = num(S(a[0], c)), f = 10 ** Math.trunc(num(S(a[1], c))); return (Math.sign(x) * Math.floor(Math.abs(x) * f + 1e-9)) / f; });

// Logical
def("IF", (a, c) => {
  argc(a, 2, 3);
  const t = truthy(S(a[0], c));
  if (t) return ev(a[1], c);
  return a.length === 3 ? ev(a[2], c) : false;
});
def("IFS", (a, c) => {
  if (a.length < 2 || a.length % 2) fail("#SYNTAX!");
  for (let i = 0; i < a.length; i += 2) if (truthy(S(a[i], c))) return ev(a[i + 1], c);
  return fail("#N/A");
});
def("IFERROR", (a, c) => { argc(a, 2); const v = sraw(a[0], c); return isErr(v) ? ev(a[1], c) : v; });
def("AND", (a, c) => { if (!a.length) fail("#SYNTAX!"); const vs = logicals(a, c); return vs.every(Boolean); });
def("OR", (a, c) => { if (!a.length) fail("#SYNTAX!"); const vs = logicals(a, c); return vs.some(Boolean); });
def("NOT", (a, c) => { argc(a, 1); return !truthy(S(a[0], c)); });
function logicals(a: Node[], c: Ctx): boolean[] {
  const out: boolean[] = [];
  for (const n of a) {
    if (n.k === "range" || n.k === "ref") { for (const v of flat(M(n, c))) { chk(v); if (typeof v === "boolean") out.push(v); else if (typeof v === "number") out.push(v !== 0); } }
    else out.push(truthy(S(n, c)));
  }
  if (!out.length) fail("#VALUE!");
  return out;
}
def("ISNUMBER", (a, c) => { argc(a, 1); return typeof sraw(a[0], c) === "number"; });
def("ISTEXT", (a, c) => { argc(a, 1); return typeof sraw(a[0], c) === "string"; });
def("ISBLANK", (a, c) => { argc(a, 1); return sraw(a[0], c) === null; });
def("ISERROR", (a, c) => { argc(a, 1); return isErr(sraw(a[0], c)); });
def("ISNA", (a, c) => { argc(a, 1); const v = sraw(a[0], c); return isErr(v) && v.error === "#N/A"; });
def("NA", () => xerr("#N/A"));

// Text
const intArg = (n: Node | undefined, c: Ctx, d: number) => (n === undefined || n.k === "empty" ? d : Math.trunc(num(S(n, c))));
def("LEFT", (a, c) => { argc(a, 1, 2); const n = intArg(a[1], c, 1); return n < 0 ? fail("#VALUE!") : str(S(a[0], c)).slice(0, n); });
def("RIGHT", (a, c) => { argc(a, 1, 2); const n = intArg(a[1], c, 1); const s = str(S(a[0], c)); return n < 0 ? fail("#VALUE!") : n === 0 ? "" : s.slice(-n); });
def("MID", (a, c) => { argc(a, 3); const s = str(S(a[0], c)), st = intArg(a[1], c, 1), n = intArg(a[2], c, 0); return st < 1 || n < 0 ? fail("#VALUE!") : s.substr(st - 1, n); });
def("LEN", (a, c) => { argc(a, 1); return str(S(a[0], c)).length; });
def("TRIM", (a, c) => { argc(a, 1); return str(S(a[0], c)).replace(/ +/g, " ").replace(/^ | $/g, ""); });
def("UPPER", (a, c) => { argc(a, 1); return str(S(a[0], c)).toUpperCase(); });
def("LOWER", (a, c) => { argc(a, 1); return str(S(a[0], c)).toLowerCase(); });
export const properCase = (s: string) => s.toLowerCase().replace(/(^|[^A-Za-z])([a-z])/g, (_, p, ch) => p + ch.toUpperCase());
def("PROPER", (a, c) => { argc(a, 1); return properCase(str(S(a[0], c))); });
def("CONCAT", (a, c) => a.flatMap((n) => (n.k === "empty" ? [] : flat(M(n, c)))).map(str).join(""));
def("CONCATENATE", (a, c) => a.map((n) => str(S(n, c))).join(""));
def("TEXTJOIN", (a, c) => {
  if (a.length < 3) fail("#SYNTAX!");
  const d = str(S(a[0], c)), skip = truthy(S(a[1], c));
  const parts = a.slice(2).flatMap((n) => flat(M(n, c))).map(str);
  return (skip ? parts.filter((p) => p !== "") : parts).join(d);
});
def("SUBSTITUTE", (a, c) => {
  argc(a, 3, 4);
  const t = str(S(a[0], c)), o = str(S(a[1], c)), nw = str(S(a[2], c));
  if (o === "") return t;
  if (a.length === 4) {
    const k = Math.trunc(num(S(a[3], c)));
    if (k < 1) return fail("#VALUE!");
    let at = -1;
    for (let i = 0; i < k; i++) { at = t.indexOf(o, at + 1); if (at < 0) return t; }
    return t.slice(0, at) + nw + t.slice(at + o.length);
  }
  return t.split(o).join(nw);
});
def("VALUE", (a, c) => { argc(a, 1); const v = S(a[0], c); if (typeof v === "number") return v; const n = parseNumText(str(v)); return n === null ? fail("#VALUE!") : n; });
def("EXACT", (a, c) => { argc(a, 2); return str(S(a[0], c)) === str(S(a[1], c)); });
const findIn = (a: Node[], c: Ctx, ci: boolean): number => {
  argc(a, 2, 3);
  let f = str(S(a[0], c)), t = str(S(a[1], c));
  const st = intArg(a[2], c, 1);
  if (ci) { f = f.toLowerCase(); t = t.toLowerCase(); }
  if (st < 1 || st > t.length + 1) return fail("#VALUE!");
  const at = t.indexOf(f, st - 1);
  return at < 0 ? fail("#VALUE!") : at + 1;
};
def("FIND", (a, c) => findIn(a, c, false));
def("SEARCH", (a, c) => findIn(a, c, true));
def("TEXT", (a, c) => { argc(a, 2); return formatText(S(a[0], c), str(S(a[1], c))); });

// Dates
const serialOf = (v: Exclude<Val, XErr>): number => {
  const n = typeof v === "string" ? parseNumText(v) : num(v);
  if (n === null) return fail("#VALUE!");
  return n < 0 ? fail("#NUM!") : n;
};
def("DATE", (a, c) => {
  argc(a, 3);
  let y = Math.trunc(num(S(a[0], c)));
  const m = Math.trunc(num(S(a[1], c))), d = Math.trunc(num(S(a[2], c)));
  if (y < 0 || y >= 10000) return fail("#NUM!");
  if (y < 1900) y += 1900;
  return dateToSerial(y, m, d);
});
def("YEAR", (a, c) => { argc(a, 1); return serialToDate(serialOf(S(a[0], c))).getUTCFullYear(); });
def("MONTH", (a, c) => { argc(a, 1); return serialToDate(serialOf(S(a[0], c))).getUTCMonth() + 1; });
def("DAY", (a, c) => { argc(a, 1); return serialToDate(serialOf(S(a[0], c))).getUTCDate(); });
def("EOMONTH", (a, c) => {
  argc(a, 2);
  const dt = serialToDate(serialOf(S(a[0], c))), k = Math.trunc(num(S(a[1], c)));
  return dateToSerial(dt.getUTCFullYear(), dt.getUTCMonth() + 1 + k + 1, 0);
});

// ── Conditional aggregates ───────────────────────────────────────────────
function matching(pairs: Node[], c: Ctx): { idx: number[]; shape: [number, number] } {
  if (pairs.length < 2 || pairs.length % 2) fail("#SYNTAX!");
  let shape: [number, number] | null = null;
  let keep: boolean[] | null = null;
  for (let i = 0; i < pairs.length; i += 2) {
    const m = M(pairs[i], c);
    const sh: [number, number] = [m.length, m[0]?.length ?? 0];
    if (shape && (shape[0] !== sh[0] || shape[1] !== sh[1])) fail("#VALUE!");
    shape = sh;
    const test = parseCriteria(S(pairs[i + 1], c));
    const f = flat(m).map((v) => !isErr(v) && test(v));
    keep = keep ? keep.map((k, j) => k && f[j]) : f;
  }
  return { idx: keep!.flatMap((k, i) => (k ? [i] : [])), shape: shape! };
}
const valuesAt = (n: Node, c: Ctx, idx: number[], shape: [number, number]): number[] => {
  const m = M(n, c);
  if (m.length !== shape[0] || (m[0]?.length ?? 0) !== shape[1]) fail("#VALUE!");
  const f = flat(m);
  return idx.map((i) => f[i]).filter((v): v is number => typeof v === "number" || (chk(v), false));
};
def("COUNTIF", (a, c) => { argc(a, 2); return matching(a, c).idx.length; });
def("COUNTIFS", (a, c) => matching(a, c).idx.length);
/** SUMIF(range, criteria, [sum_range]) and AVERAGEIF share this: sum_range defaults to range. */
const ifOne = (avg: boolean): Fn => (a, c) => {
  argc(a, 2, 3);
  const { idx, shape } = matching(a.slice(0, 2), c);
  const vals = valuesAt(a[2] ?? a[0], c, idx, shape);
  const s = vals.reduce((p, q) => p + q, 0);
  return avg ? (vals.length ? s / vals.length : fail("#DIV/0!")) : s;
};
def("SUMIF", ifOne(false));
def("AVERAGEIF", ifOne(true));
def("SUMIFS", (a, c) => { const { idx, shape } = matching(a.slice(1), c); return valuesAt(a[0], c, idx, shape).reduce((p, q) => p + q, 0); });
def("AVERAGEIFS", (a, c) => { const { idx, shape } = matching(a.slice(1), c); const v = valuesAt(a[0], c, idx, shape); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : fail("#DIV/0!"); });

// ── Lookups ──────────────────────────────────────────────────────────────
type LookMode = LookupTrace["mode"];
const sameKind = (a: Val, b: Val) => a !== null && b !== null && !isErr(a) && !isErr(b) && rank(a) === rank(b);
function eqKey(k: Val, x: Val, wild: boolean): boolean {
  if (isErr(k) || k === null) return false;
  if (typeof x === "string" && typeof k === "string") return wild ? wildRe(x).test(k) : k.toLowerCase() === x.toLowerCase();
  return sameKind(k, x) && cmpVals(k, x) === 0;
}
/** The matching algorithms, returning the probes so the lab can show how the search walked the keys. */
export function lookupCore(x: Val, keys: Val[], mode: LookMode, fromEnd = false): { index: number; probes: LookupProbe[] } {
  const probes: LookupProbe[] = [];
  const order = keys.map((_, i) => i); if (fromEnd) order.reverse();
  if (mode === "exact" || mode === "wildcard") {
    for (const i of order) {
      const hit = eqKey(keys[i], x, mode === "wildcard");
      probes.push({ i, value: keys[i], verdict: hit ? "equal" : "differs" });
      if (hit) return { index: i, probes };
    }
    return { index: -1, probes };
  }
  if (mode === "approximate" || mode === "approximate-descending") {
    // Excel's approximate match is a binary search: it needs sorted keys, and gives wrong answers on unsorted ones.
    let lo = 0, hi = keys.length - 1, best = -1;
    const asc = mode === "approximate";
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, k = keys[mid];
      if (!sameKind(k, x)) { probes.push({ i: mid, value: k, verdict: "skip" }); hi = mid - 1; continue; }
      const d = cmpVals(k, x);
      if (asc ? d <= 0 : d >= 0) { best = mid; probes.push({ i: mid, value: k, verdict: d === 0 ? "equal" : "le" }); lo = mid + 1; }
      else { probes.push({ i: mid, value: k, verdict: "gt" }); hi = mid - 1; }
    }
    return { index: best, probes };
  }
  // next-smaller / next-larger: exact first, else the closest key on that side (a full scan).
  let best = -1;
  for (const i of order) {
    const k = keys[i];
    if (!sameKind(k, x)) { probes.push({ i, value: k, verdict: "skip" }); continue; }
    const d = cmpVals(k, x);
    if (d === 0) { probes.push({ i, value: k, verdict: "equal" }); return { index: i, probes }; }
    const ok = mode === "next-smaller" ? d < 0 : d > 0;
    if (ok && (best < 0 || (mode === "next-smaller" ? cmpVals(k, keys[best]) > 0 : cmpVals(k, keys[best]) < 0))) { best = i; probes.push({ i, value: k, verdict: "candidate" }); }
    else probes.push({ i, value: k, verdict: "differs" });
  }
  return { index: best, probes };
}
const orient = (m: Matrix): "column" | "row" => (m.length === 1 && (m[0]?.length ?? 0) > 1 ? "row" : "column");
const vector = (m: Matrix): Val[] => (orient(m) === "row" ? m[0] : m.map((r) => r[0]));
const record = (c: Ctx, n: Node, fn: string, x: Val, keys: Val[], o: "column" | "row", mode: LookMode, index: number, probes: LookupProbe[], result: Val, note: string) => {
  c.lookups?.push({ fn, text: nodeText(n, c), lookupValue: x, keys, orientation: o, mode, probes, matchIndex: index, result, note });
};

function vlh(horizontal: boolean): Fn {
  return (a, c, n) => {
    argc(a, 3, 4);
    const x = S(a[0], c), t = M(a[1], c), idx = Math.trunc(num(S(a[2], c)));
    const approx = a.length === 4 && a[3].k !== "empty" ? truthy(S(a[3], c)) : true;
    const grid = horizontal ? t : t[0].map((_, j) => t.map((r) => r[j])); // work on a table whose first row holds the keys
    if (idx < 1) return fail("#VALUE!");
    if (idx > grid.length) return fail("#REF!");
    const keys = grid[0];
    const mode: LookMode = approx ? "approximate" : "wildcard";
    const { index, probes } = lookupCore(x, keys, mode);
    const out = index < 0 ? xerr("#N/A") : grid[idx - 1][index];
    record(c, n, n.name, x, keys, horizontal ? "row" : "column", approx ? "approximate" : "exact", index, probes, out,
      index < 0 ? (approx ? "No key is less than or equal to the lookup value, so the result is #N/A." : "No key equals the lookup value, so the result is #N/A.") : `Matched position ${index + 1}; returned column ${idx} of that row.`);
    return out;
  };
}
def("VLOOKUP", vlh(false));
def("HLOOKUP", vlh(true));
def("MATCH", (a, c, n) => {
  argc(a, 2, 3);
  const x = S(a[0], c), m = M(a[1], c);
  if (m.length > 1 && (m[0]?.length ?? 0) > 1) return fail("#N/A");
  const t = a.length === 3 && a[2].k !== "empty" ? Math.trunc(num(S(a[2], c))) : 1;
  const keys = vector(m);
  const mode: LookMode = t === 0 ? "wildcard" : t > 0 ? "approximate" : "approximate-descending";
  const { index, probes } = lookupCore(x, keys, mode);
  const out = index < 0 ? xerr("#N/A") : index + 1;
  record(c, n, "MATCH", x, keys, orient(m), t === 0 ? "exact" : mode, index, probes, out, index < 0 ? "No match: #N/A." : `Position ${index + 1} in the lookup range.`);
  return out;
});
def("INDEX", (a, c) => {
  argc(a, 2, 3);
  const m = M(a[0], c);
  let r = intArg(a[1], c, 0), col = a.length === 3 ? intArg(a[2], c, 0) : 0;
  if (a.length === 2 && m.length === 1) { col = r; r = 1; }
  else if (a.length === 2 && (m[0]?.length ?? 0) === 1) col = 1;
  if (r < 0 || col < 0) return fail("#VALUE!");
  if (r === 0 || col === 0) return fail("#VALUE!"); // returning a whole row or column would need arrays
  if (r > m.length || col > (m[0]?.length ?? 0)) return fail("#REF!");
  return m[r - 1][col - 1];
});
def("XLOOKUP", (a, c, n) => {
  argc(a, 3, 6);
  const x = S(a[0], c), look = M(a[1], c), ret = M(a[2], c);
  const notFound = a.length >= 4 && a[3].k !== "empty" ? a[3] : null;
  const mm = a.length >= 5 && a[4].k !== "empty" ? Math.trunc(num(S(a[4], c))) : 0;
  const sm = a.length === 6 ? Math.trunc(num(S(a[5], c))) : 1;
  if (![0, -1, 1, 2].includes(mm) || ![1, -1].includes(sm)) return fail("#VALUE!");
  if (look.length > 1 && (look[0]?.length ?? 0) > 1) return fail("#VALUE!");
  const o = orient(look), keys = vector(look);
  const mode: LookMode = mm === 0 ? "exact" : mm === -1 ? "next-smaller" : mm === 1 ? "next-larger" : "wildcard";
  const { index, probes } = lookupCore(x, keys, mode === "exact" ? "exact" : mode, sm === -1);
  // XLOOKUP's exact match has no wildcards unless match_mode is 2, unlike VLOOKUP's exact match.
  let idx = index, pr = probes;
  if (mode === "exact") { const r = lookupExactNoWildcard(x, keys, sm === -1); idx = r.index; pr = r.probes; }
  let out: Val;
  let note: string;
  if (idx < 0) { out = notFound ? sraw(notFound, c) : xerr("#N/A"); note = notFound ? "No match: the if_not_found argument is returned instead of #N/A." : "No match: #N/A."; }
  else {
    const rv = o === "row" ? ret[0] : ret.map((r) => r[0]);
    if ((o === "row" ? ret.length : ret[0]?.length ?? 0) > 1) return fail("#VALUE!"); // a multi-column return would spill
    out = rv?.[idx] ?? xerr("#REF!");
    note = `Matched position ${idx + 1}; returned the value at the same position of the return range.`;
  }
  record(c, n, "XLOOKUP", x, keys, o, mode, idx, pr, out, note);
  return out;
});
function lookupExactNoWildcard(x: Val, keys: Val[], fromEnd: boolean) {
  const probes: LookupProbe[] = [];
  const order = keys.map((_, i) => i); if (fromEnd) order.reverse();
  for (const i of order) { const hit = eqKey(keys[i], x, false); probes.push({ i, value: keys[i], verdict: hit ? "equal" : "differs" }); if (hit) return { index: i, probes }; }
  return { index: -1, probes };
}

export const SUPPORTED_FUNCTIONS = Object.keys(FUNCS).sort();

// ── Sheets and the engine ────────────────────────────────────────────────
/** Raw cell inputs keyed by address ("B2"): "=B1*2" is a formula, a leading ' forces text, anything else is a literal. */
export type Cells = Record<string, string>;
export const isFormula = (raw: string | undefined): boolean => !!raw && raw.length > 1 && raw[0] === "=";

export function parseLiteral(raw: string): Val {
  if (raw === "") return null;
  if (raw[0] === "'") return raw.slice(1);
  const t = raw.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return Number(t);
  if (/^\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  const e = ERR_LITERALS.find((x) => x === t.toUpperCase());
  if (e) return xerr(e);
  return raw;
}

export interface Engine { get(addr: string): Val; circular: Set<string> }
/** Memoised evaluation with circular-reference detection: a cell met again while it is being evaluated marks the whole cycle. */
export function createEngine(cells: Cells): Engine {
  const memo = new Map<string, Val>(), stack: string[] = [], circular = new Set<string>();
  const get = (a: string): Val => {
    const addr = a.toUpperCase();
    if (memo.has(addr)) return memo.get(addr)!;
    const rawText = cells[addr];
    if (rawText === undefined || rawText === "") return null;
    if (!isFormula(rawText)) { const v = parseLiteral(rawText); memo.set(addr, v); return v; }
    const at = stack.indexOf(addr);
    if (at >= 0) { for (const s of stack.slice(at)) circular.add(s); return xerr("#CIRC!"); }
    stack.push(addr);
    let v = evalFormulaText(rawText.slice(1), { get, src: rawText.slice(1) });
    stack.pop();
    if (circular.has(addr)) v = xerr("#CIRC!");
    memo.set(addr, v);
    return v;
  };
  return { get, circular };
}

function evalFormulaText(src: string, ctx: Ctx): Val {
  const p = parseFormula(src);
  if (!p.ok) return xerr("#SYNTAX!");
  const v = ev(p.node, { ...ctx, src });
  if (Array.isArray(v)) return v.length === 1 && v[0].length === 1 ? v[0][0] : xerr("#VALUE!");
  return v;
}

export function evaluateAll(cells: Cells): { values: Record<string, Val>; circular: Set<string> } {
  const eng = createEngine(cells), values: Record<string, Val> = {};
  for (const a of Object.keys(cells)) values[a] = eng.get(a);
  return { values, circular: eng.circular };
}
/** Evaluate a one-off formula (with or without "=") against a sheet. */
export function evaluateFormula(formula: string, cells: Cells = {}): Val {
  const src = formula.startsWith("=") ? formula.slice(1) : formula;
  return evalFormulaText(src, { get: createEngine(cells).get, src });
}

export interface CellTrace { formula: string; steps: TraceStep[]; result: Val; lookups: LookupTrace[]; syntaxError?: string }
/** Step-by-step evaluation of one cell's formula: every sub-expression with its value, innermost first. */
export function traceCell(cells: Cells, addr: string): CellTrace | null {
  const rawText = cells[addr.toUpperCase()];
  if (!isFormula(rawText)) return null;
  const src = rawText.slice(1), eng = createEngine(cells);
  const p = parseFormula(src);
  if (!p.ok) return { formula: rawText, steps: [], result: xerr("#SYNTAX!"), lookups: [], syntaxError: p.message };
  const steps: TraceStep[] = [], lookups: LookupTrace[] = [];
  const v = ev(p.node, { get: eng.get, src, trace: steps, lookups });
  const result = Array.isArray(v) ? (v.length === 1 && v[0].length === 1 ? v[0][0] : xerr("#VALUE!")) : v;
  return { formula: rawText, steps, result: eng.circular.has(addr.toUpperCase()) ? xerr("#CIRC!") : result, lookups };
}

// ── Precedents, dependents, recalculation order ──────────────────────────
function collectRects(n: Node, out: Rect[]) {
  switch (n.k) {
    case "ref": out.push({ c1: n.r.col, r1: n.r.row, c2: n.r.col, r2: n.r.row }); break;
    case "range": out.push(rectOf(n.a, n.b)); break;
    case "un": case "pct": collectRects(n.x, out); break;
    case "bin": collectRects(n.l, out); collectRects(n.r, out); break;
    case "call": n.args.forEach((x) => collectRects(x, out)); break;
  }
}
export function formulaRects(formula: string): Rect[] {
  const p = parseFormula(formula.startsWith("=") ? formula.slice(1) : formula);
  const out: Rect[] = [];
  if (p.ok) collectRects(p.node, out);
  return out;
}
/** Cells a formula reads (ranges expanded). */
export function precedents(cells: Cells, addr: string): string[] {
  const raw = cells[addr.toUpperCase()];
  if (!isFormula(raw)) return [];
  return [...new Set(formulaRects(raw).flatMap((r) => rectAddrs(r)))];
}
/** Formula cells whose formula reads `addr` directly. */
export function directDependents(cells: Cells, addr: string): string[] {
  const p = parseAddr(addr);
  if (!p) return [];
  return Object.keys(cells).filter((k) => isFormula(cells[k]) && formulaRects(cells[k]).some((r) => inRect(r, p.col, p.row)));
}
/** If `addr` changes, which cells recalculate and in what order (Kahn's algorithm over the affected cells; cycles are reported separately). */
export function recalcOrder(cells: Cells, addr: string): { order: string[]; levels: string[][]; cyclic: string[] } {
  const start = addr.toUpperCase();
  const affected = new Set<string>(), queue = [start];
  while (queue.length) for (const d of directDependents(cells, queue.shift()!)) if (!affected.has(d)) { affected.add(d); queue.push(d); }
  const deps = new Map<string, Set<string>>();
  for (const a of affected) deps.set(a, new Set(precedents(cells, a).filter((p) => affected.has(p) && p !== a)));
  const levels: string[][] = [], done = new Set<string>();
  let left = [...affected];
  while (left.length) {
    const ready = left.filter((a) => [...deps.get(a)!].every((d) => done.has(d)) && !(precedents(cells, a).includes(a))).sort(cellSort);
    if (!ready.length) break;
    levels.push(ready); ready.forEach((a) => done.add(a));
    left = left.filter((a) => !done.has(a));
  }
  return { order: levels.flat(), levels, cyclic: left.sort(cellSort) };
}
const cellSort = (x: string, y: string) => { const a = parseAddr(x)!, b = parseAddr(y)!; return a.row - b.row || a.col - b.col; };

// ── Copying formulas: relative and absolute references ───────────────────
/** What Excel does when a formula is copied `dRow` rows and `dCol` columns: relative parts move, $-anchored parts stay. */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (!isFormula(formula)) return formula;
  const src = formula.slice(1);
  let toks: Tok[];
  try { toks = tokenize(src); } catch { return formula; }
  type Edit = { s: number; e: number; text: string };
  const edits: Edit[] = [];
  const shift = (t: Tok): string | null => {
    const r = toRef(t.v);
    if (!r) return null;
    const col = r.absCol ? r.col : r.col + dCol, row = r.absRow ? r.row : r.row + dRow;
    if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
    return (r.absCol ? "$" : "") + colName(col) + (r.absRow ? "$" : "") + row;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "ref") continue;
    if (toks[i + 1]?.v === ":" && toks[i + 2]?.t === "ref") {
      const a = shift(t), b = shift(toks[i + 2]);
      edits.push(a && b ? { s: t.s, e: toks[i + 2].e, text: `${a}:${b}` } : { s: t.s, e: toks[i + 2].e, text: "#REF!" });
      i += 2;
    } else { const a = shift(t); edits.push({ s: t.s, e: t.e, text: a ?? "#REF!" }); }
  }
  let out = src;
  for (const ed of edits.reverse()) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
  return "=" + out;
}
/** Copy the formula (or value) in `from` to `to`, shifting relative references by the distance between them. */
export function copyCell(cells: Cells, from: string, to: string): Cells {
  const a = parseAddr(from), b = parseAddr(to);
  if (!a || !b) return cells;
  const raw = cells[from.toUpperCase()] ?? "";
  return { ...cells, [to.toUpperCase()]: shiftFormula(raw, b.row - a.row, b.col - a.col) };
}

// ── Grid bounds ──────────────────────────────────────────────────────────
export function bounds(cells: Cells, minCols = 6, minRows = 8): { cols: number; rows: number } {
  let cols = minCols, rows = minRows;
  for (const k of Object.keys(cells)) { const p = parseAddr(k); if (p && cells[k] !== "") { cols = Math.max(cols, p.col + 1); rows = Math.max(rows, p.row + 1); } }
  return { cols: Math.min(cols, 14), rows: Math.min(rows, 30) };
}

// ── Pivot table simulator ────────────────────────────────────────────────
export interface SalesRow { Date: string; Month: string; Year: string; Region: string; Product: string; Rep: string; Qty: number; Amount: number }
const SALES_RAW: [string, string, string, string, number, number][] = [
  ["2025-01-05", "North", "Pen", "Ana", 3, 30], ["2025-01-12", "South", "Pen", "Ben", 1, 10], ["2025-01-20", "East", "Book", "Chen", 2, 40],
  ["2025-01-28", "North", "Book", "Ana", 5, 100], ["2025-02-03", "South", "Book", "Ben", 1, 20], ["2025-02-09", "North", "Pen", "Dia", 4, 40],
  ["2025-02-14", "East", "Pen", "Chen", 2, 20], ["2025-02-21", "East", "Bag", "Chen", 1, 45], ["2025-02-26", "South", "Bag", "Ben", 2, 90],
  ["2025-03-02", "North", "Pen", "Ana", 6, 60], ["2025-03-11", "North", "Bag", "Dia", 1, 45], ["2025-03-15", "South", "Book", "Eli", 3, 60],
  ["2025-03-19", "East", "Book", "Chen", 4, 80], ["2025-03-24", "South", "Pen", "Eli", 2, 20], ["2025-03-28", "East", "Pen", "Fay", 5, 50],
  ["2026-01-09", "North", "Book", "Ana", 6, 90], ["2026-01-17", "East", "Bag", "Fay", 2, 90], ["2026-01-30", "South", "Pen", "Eli", 3, 30],
];
export const SALES: SalesRow[] = SALES_RAW.map(([Date, Region, Product, Rep, Qty, Amount]) => ({ Date, Month: Date.slice(0, 7), Year: Date.slice(0, 4), Region, Product, Rep, Qty, Amount }));
export const PIVOT_FIELDS = ["Region", "Product", "Rep", "Month", "Year"] as const;
export type PivotField = (typeof PIVOT_FIELDS)[number];
export const PIVOT_VALUE_FIELDS = ["Amount", "Qty"] as const;
export type Agg = "sum" | "count" | "average" | "min" | "max";
export const AGGS: Agg[] = ["sum", "count", "average", "min", "max"];

export interface PivotSpec { rows: PivotField | null; cols: PivotField | null; value: (typeof PIVOT_VALUE_FIELDS)[number]; agg: Agg; filters: Partial<Record<PivotField, string[]>> }
export interface PivotCell { value: number | null; source: number[] }
export interface PivotResult {
  rowKeys: string[]; colKeys: string[];
  cell: (r: string, c: string) => PivotCell;
  rowTotal: (r: string) => PivotCell; colTotal: (c: string) => PivotCell; grand: PivotCell;
  filtered: number[];
}
const aggregate = (xs: number[], agg: Agg): number | null => {
  if (!xs.length) return null;
  switch (agg) {
    case "sum": return xs.reduce((a, b) => a + b, 0);
    case "count": return xs.length;
    case "average": return xs.reduce((a, b) => a + b, 0) / xs.length;
    case "min": return Math.min(...xs);
    default: return Math.max(...xs);
  }
};
/** Values of a field present in the data, sorted, for filter checkboxes. */
export const fieldValues = (rows: SalesRow[], f: PivotField): string[] => [...new Set(rows.map((r) => r[f]))].sort();

/** Totals are computed from the SOURCE rows of each row/column (as Excel does), so an average grand total is the average of all rows, not an average of averages. */
export function pivot(rows: SalesRow[], spec: PivotSpec): PivotResult {
  const filtered = rows.map((_, i) => i).filter((i) => (Object.entries(spec.filters) as [PivotField, string[]][]).every(([f, allowed]) => !allowed || allowed.includes(rows[i][f])));
  const keyOf = (i: number, f: PivotField | null) => (f ? rows[i][f] : "");
  const rowKeys = [...new Set(filtered.map((i) => keyOf(i, spec.rows)))].sort();
  const colKeys = [...new Set(filtered.map((i) => keyOf(i, spec.cols)))].sort();
  const mk = (src: number[]): PivotCell => ({ value: aggregate(src.map((i) => rows[i][spec.value]), spec.agg), source: src });
  return {
    rowKeys, colKeys, filtered,
    cell: (r, c) => mk(filtered.filter((i) => keyOf(i, spec.rows) === r && keyOf(i, spec.cols) === c)),
    rowTotal: (r) => mk(filtered.filter((i) => keyOf(i, spec.rows) === r)),
    colTotal: (c) => mk(filtered.filter((i) => keyOf(i, spec.cols) === c)),
    grand: mk(filtered),
  };
}

// ── Conditional formatting ───────────────────────────────────────────────
export type CfRule =
  | { kind: "gt"; value: number } | { kind: "lt"; value: number } | { kind: "between"; lo: number; hi: number }
  | { kind: "contains"; text: string } | { kind: "top"; n: number; bottom?: boolean } | { kind: "duplicates" } | { kind: "scale" };
export interface CfResult { matches: Set<string>; scale: Record<string, number>; note: string }
/** Which cells of `range` a rule formats. Numeric rules look only at numbers; contains and duplicates compare text without regard to case. */
export function applyCf(cells: Cells, rangeText: string, rule: CfRule): CfResult {
  const rect = parseRange(rangeText);
  const out: CfResult = { matches: new Set(), scale: {}, note: "" };
  if (!rect) { out.note = "Enter a range such as C2:C13."; return out; }
  const eng = createEngine(cells);
  const items = rectAddrs(rect).map((a) => ({ a, v: eng.get(a) }));
  const nums = items.filter((x): x is { a: string; v: number } => typeof x.v === "number");
  switch (rule.kind) {
    case "gt": nums.filter((x) => x.v > rule.value).forEach((x) => out.matches.add(x.a)); break;
    case "lt": nums.filter((x) => x.v < rule.value).forEach((x) => out.matches.add(x.a)); break;
    case "between": nums.filter((x) => x.v >= Math.min(rule.lo, rule.hi) && x.v <= Math.max(rule.lo, rule.hi)).forEach((x) => out.matches.add(x.a)); break;
    case "contains": { const t = rule.text.toLowerCase(); if (t) items.filter((x) => typeof x.v === "string" && x.v.toLowerCase().includes(t)).forEach((x) => out.matches.add(x.a)); break; }
    case "top": {
      // Ties at the cut-off are all included, as Excel does.
      const sorted = [...nums].sort((p, q) => (rule.bottom ? p.v - q.v : q.v - p.v));
      const n = Math.max(0, Math.min(rule.n, sorted.length));
      if (n) { const cut = sorted[n - 1].v; sorted.filter((x) => (rule.bottom ? x.v <= cut : x.v >= cut)).forEach((x) => out.matches.add(x.a)); }
      break;
    }
    case "duplicates": {
      const key = (v: Val) => (typeof v === "string" ? "s:" + v.toLowerCase() : typeof v === "number" ? "n:" + v : null);
      const counts = new Map<string, number>();
      for (const x of items) { const k = key(x.v); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
      items.forEach((x) => { const k = key(x.v); if (k && counts.get(k)! > 1) out.matches.add(x.a); });
      break;
    }
    case "scale": {
      if (!nums.length) break;
      const lo = Math.min(...nums.map((x) => x.v)), hi = Math.max(...nums.map((x) => x.v));
      nums.forEach((x) => { out.scale[x.a] = hi === lo ? 0.5 : (x.v - lo) / (hi - lo); out.matches.add(x.a); });
      break;
    }
  }
  out.note = `${out.matches.size} of ${items.length} cell${items.length === 1 ? "" : "s"} in ${rangeText.toUpperCase()} formatted.`;
  return out;
}

// ── Data cleaning ────────────────────────────────────────────────────────
export type CleanCell = string | number;
export interface CleanTable { cols: string[]; rows: CleanCell[][] }
export const MESSY: CleanTable = {
  cols: ["Name", "City", "Amount", "Joined", "Full name"],
  rows: [
    ["  ada   lovelace ", "london ", "1,200", "2025-03-05", "Lovelace, Ada"],
    ["GRACE  HOPPER", "NEW YORK", "  45 ", "5 Mar 2025", "Hopper, Grace"],
    ["alan turing", "Manchester", "310", "03/17/2025", "Turing, Alan"],
    ["Ada Lovelace", "London", "1,200", "2025-03-05", "Lovelace, Ada"],
    [" grace hopper", "new york", "45", "2025-03-05", "Hopper, Grace"],
    ["margaret  hamilton", "boston", "$980", "2025-04-01", "Hamilton, Margaret"],
  ],
};
export type CleanOp =
  | { kind: "trim"; col: string } | { kind: "proper"; col: string } | { kind: "upper"; col: string } | { kind: "lower"; col: string }
  | { kind: "value"; col: string } | { kind: "date"; col: string } | { kind: "split"; col: string; delim: string } | { kind: "dedupe"; cols: string[] };
export const trimText = (s: string) => s.replace(/ +/g, " ").replace(/^ | $/g, "");

export function cleanOpLabel(op: CleanOp): string {
  switch (op.kind) {
    case "trim": return `TRIM ${op.col}`; case "proper": return `PROPER ${op.col}`; case "upper": return `UPPER ${op.col}`; case "lower": return `LOWER ${op.col}`;
    case "value": return `VALUE ${op.col}`; case "date": return `Date text to date ${op.col}`;
    case "split": return `Text to columns on "${op.delim}" (${op.col})`; default: return `Remove duplicates (${op.cols.join(", ")})`;
  }
}
/** The worksheet formula the operation replaces, for the "same thing in Excel" note. */
export function cleanOpFormula(op: CleanOp): string {
  switch (op.kind) {
    case "trim": return "=TRIM(A2)"; case "proper": return "=PROPER(A2)"; case "upper": return "=UPPER(A2)"; case "lower": return "=LOWER(A2)";
    case "value": return "=VALUE(A2)"; case "date": return "=DATEVALUE(A2) (or VALUE(A2)) formatted as a date";
    case "split": return `=TEXTBEFORE(A2,"${op.delim}") and TEXTAFTER(A2,"${op.delim}"), or Data > Text to Columns`;
    default: return "Data > Remove Duplicates (compares the chosen columns, ignoring case)";
  }
}
/** Apply one operation; returns a new table and never mutates the input. */
export function applyCleanOp(t: CleanTable, op: CleanOp): CleanTable {
  if (op.kind === "dedupe") {
    const idx = op.cols.map((c) => t.cols.indexOf(c)).filter((i) => i >= 0);
    const seen = new Set<string>();
    return { cols: t.cols, rows: t.rows.filter((r) => { const k = idx.map((i) => String(r[i]).toLowerCase()).join("\u0001"); if (seen.has(k)) return false; seen.add(k); return true; }) };
  }
  const ci = t.cols.indexOf(op.col);
  if (ci < 0) return t;
  if (op.kind === "split") {
    const parts = t.rows.map((r) => String(r[ci]).split(op.delim).map(trimText));
    const width = Math.max(1, ...parts.map((p) => p.length));
    const names = Array.from({ length: width }, (_, k) => `${op.col} ${k + 1}`);
    return { cols: [...t.cols.slice(0, ci + 1), ...names, ...t.cols.slice(ci + 1)], rows: t.rows.map((r, ri) => [...r.slice(0, ci + 1), ...names.map((_, k) => parts[ri][k] ?? ""), ...r.slice(ci + 1)]) };
  }
  const f = (v: CleanCell): CleanCell => {
    if (typeof v !== "string") return v;
    switch (op.kind) {
      case "trim": return trimText(v);
      case "proper": return properCase(v);
      case "upper": return v.toUpperCase();
      case "lower": return v.toLowerCase();
      case "value": { const n = parseNumText(v); return n === null ? v : n; }
      default: { const n = parseDateText(v); return n === null ? v : n; }
    }
  };
  return { cols: t.cols, rows: t.rows.map((r) => r.map((v, i) => (i === ci ? f(v) : v))) };
}
export const applyCleanOps = (ops: CleanOp[], base: CleanTable = MESSY) => ops.reduce(applyCleanOp, base);
/** Cells that differ between two tables of the same shape, as "row,col" keys (shape changes: everything is new). */
export function changedCells(a: CleanTable, b: CleanTable): Set<string> {
  const out = new Set<string>();
  if (a.cols.length !== b.cols.length) { b.rows.forEach((r, i) => r.forEach((_, j) => out.add(`${i},${j}`))); return out; }
  b.rows.forEach((r, i) => r.forEach((v, j) => { if (a.rows[i]?.[j] !== v) out.add(`${i},${j}`); }));
  return out;
}
/** Quality issues in a table, so "Before" and "After" can be compared by count. */
export function qualityIssues(t: CleanTable): { spaces: number; caseMix: number; textNumbers: number; textDates: number; duplicates: number } {
  let spaces = 0, caseMix = 0, textNumbers = 0, textDates = 0;
  for (const r of t.rows) for (const v of r) {
    if (typeof v !== "string") continue;
    if (v !== trimText(v)) spaces++;
    if (/[A-Za-z]/.test(v) && v !== properCase(v) && !/[,@]/.test(v) && trimText(v) !== "" && (v === v.toLowerCase() || v === v.toUpperCase())) caseMix++;
    if (parseDateText(v) !== null) textDates++; else if (parseNumText(v) !== null) textNumbers++;
  }
  const seen = new Set<string>(); let duplicates = 0;
  for (const r of t.rows) { const k = r.map((v) => trimText(String(v)).toLowerCase()).join("\u0001"); if (seen.has(k)) duplicates++; else seen.add(k); }
  return { spaces, caseMix, textNumbers, textDates, duplicates };
}

// ── Presets ──────────────────────────────────────────────────────────────
export type ExcelTab = "grid" | "pivot" | "format" | "clean";
export interface Book { cells: Cells; formats?: Record<string, string>; select: string; hint: string }
export const PRESETS: { id: string; label: string; tab: ExcelTab; blurb: string }[] = [
  { id: "formulas", label: "Formulas and references", tab: "grid", blurb: "Arithmetic, IF, SUM, relative and absolute references, errors." },
  { id: "lookups", label: "Lookups", tab: "grid", blurb: "VLOOKUP, XLOOKUP and INDEX/MATCH, exact and approximate." },
  { id: "sumifs", label: "SUMIFS and COUNTIFS", tab: "grid", blurb: "Conditional aggregation with one or more criteria." },
  { id: "pivot", label: "PivotTable", tab: "pivot", blurb: "Rows, columns, values, aggregation and filters on sample sales." },
  { id: "conditional-format", label: "Conditional formatting", tab: "format", blurb: "Highlight rules: greater than, between, top N, duplicates, colour scale." },
  { id: "cleaning", label: "Data cleaning", tab: "clean", blurb: "TRIM, PROPER, VALUE, text to columns and remove duplicates on a messy table." },
  { id: "text-formulas", label: "Text formulas", tab: "grid", blurb: "LEFT, MID, RIGHT, TRIM, PROPER, TEXTJOIN, SUBSTITUTE." },
  { id: "dates", label: "Date formulas", tab: "grid", blurb: "DATE, YEAR, MONTH, DAY, EOMONTH, TEXT and date arithmetic." },
];
export const presetById = (id: string | undefined) => PRESETS.find((p) => p.id === id);

const DATE_FMT = "yyyy-mm-dd";
export const BOOKS: Record<string, Book> = {
  formulas: {
    select: "D2", hint: "Select D2, then F2: F2 uses $H$1, an absolute reference that stays put when copied. Try copying F2 to F3.",
    cells: {
      A1: "Item", B1: "Qty", C1: "Unit price", D1: "Line total", E1: "Size", F1: "Incl. tax", G1: "Tax rate", H1: "0.2",
      A2: "Pen", B2: "10", C2: "1.5", D2: "=B2*C2", E2: '=IF(D2>=20,"Big","Small")', F2: "=D2*(1+$H$1)",
      A3: "Book", B3: "3", C3: "12", D3: "=B3*C3", E3: '=IF(D3>=20,"Big","Small")', F3: "=D3*(1+$H$1)",
      A4: "Bag", B4: "1", C4: "45", D4: "=B4*C4", E4: '=IF(D4>=20,"Big","Small")', F4: "=D4*(1+$H$1)",
      A5: "Cap", B5: "0", C5: "9.99", D5: "=B5*C5", E5: '=IF(D5>=20,"Big","Small")', F5: "=D5*(1+$H$1)",
      A6: "Total", B6: "=SUM(B2:B5)", D6: "=SUM(D2:D5)", F6: "=SUM(F2:F5)",
      A7: "Average price", C7: "=AVERAGE(C2:C5)",
      A8: "Price per unit", D8: "=D6/B5", E8: '=IFERROR(D6/B5,"no qty")',
    },
  },
  lookups: {
    select: "F2", hint: "Select F3: P150 is not in the table, so the exact lookup gives #N/A while XLOOKUP returns its fallback text.",
    cells: {
      A1: "Code", B1: "Product", C1: "Price",
      A2: "P100", B2: "Pen", C2: "1.5", A3: "P200", B3: "Book", C3: "12", A4: "P300", B4: "Bag", C4: "45", A5: "P400", B5: "Cap", C5: "9.99", A6: "P500", B6: "Mug", C6: "6.25",
      E1: "Order code", F1: "VLOOKUP exact", G1: "XLOOKUP", H1: "INDEX/MATCH",
      E2: "P300", F2: "=VLOOKUP(E2,$A$2:$C$6,3,FALSE)", G2: '=XLOOKUP(E2,$A$2:$A$6,$C$2:$C$6,"not listed")', H2: "=INDEX($C$2:$C$6,MATCH(E2,$A$2:$A$6,0))",
      E3: "P150", F3: "=VLOOKUP(E3,$A$2:$C$6,3,FALSE)", G3: '=XLOOKUP(E3,$A$2:$A$6,$C$2:$C$6,"not listed")', H3: "=INDEX($C$2:$C$6,MATCH(E3,$A$2:$A$6,0))",
      E4: "P500", F4: "=VLOOKUP(E4,$A$2:$C$6,3,FALSE)", G4: '=XLOOKUP(E4,$A$2:$A$6,$C$2:$C$6,"not listed")', H4: "=INDEX($C$2:$C$6,MATCH(E4,$A$2:$A$6,0))",
      A8: "Score from", B8: "Grade", A9: "0", B9: "F", A10: "50", B10: "D", A11: "60", B11: "C", A12: "70", B12: "B", A13: "85", B13: "A",
      E7: "Score", F7: "Grade (approximate)", E8: "67", F8: "=VLOOKUP(E8,$A$9:$B$13,2,TRUE)", E9: "95", F9: "=VLOOKUP(E9,$A$9:$B$13,2,TRUE)", E10: "-5", F10: "=VLOOKUP(E10,$A$9:$B$13,2,TRUE)",
    },
  },
  sumifs: {
    select: "G2", hint: "G2 is SUMIFS with two criteria; every criteria range must have the same size as the sum range.",
    cells: {
      A1: "Region", B1: "Product", C1: "Qty", D1: "Amount",
      A2: "North", B2: "Pen", C2: "3", D2: "30", A3: "South", B3: "Pen", C3: "1", D3: "10", A4: "North", B4: "Book", C4: "2", D4: "40", A5: "East", B5: "Book", C5: "5", D5: "100",
      A6: "South", B6: "Book", C6: "1", D6: "20", A7: "North", B7: "Pen", C7: "4", D7: "40", A8: "East", B8: "Pen", C8: "2", D8: "20",
      F1: "Measure", G1: "Result", I1: "Region to sum",
      F2: "North with Qty >= 3", G2: '=SUMIFS(D2:D8,A2:A8,"North",C2:C8,">=3")',
      F3: "Pen rows with Amount >= 20", G3: '=COUNTIFS(B2:B8,"Pen",D2:D8,">=20")',
      F4: "Average of Book", G4: '=AVERAGEIFS(D2:D8,B2:B8,"Book")',
      F5: "SUMIF East", G5: '=SUMIF(A2:A8,"East",D2:D8)',
      F6: "COUNTIF not North", G6: '=COUNTIF(A2:A8,"<>North")',
      F7: "Region from cell I2", G7: "=SUMIFS(D2:D8,A2:A8,I2)", I2: "South",
    },
  },
  "text-formulas": {
    select: "B2", hint: "Select B2: TRIM runs first (innermost), then PROPER. Step through the evaluation.",
    cells: {
      A1: "Raw", B1: "PROPER(TRIM)", C1: "First name", D1: "Last name",
      A2: "  ada   lovelace ", B2: "=PROPER(TRIM(A2))", C2: '=LEFT(B2,FIND(" ",B2)-1)', D2: '=MID(B2,FIND(" ",B2)+1,20)',
      A3: "GRACE  HOPPER", B3: "=PROPER(TRIM(A3))", C3: '=LEFT(B3,FIND(" ",B3)-1)', D3: '=MID(B3,FIND(" ",B3)+1,20)',
      A5: "DF-2024-0137", B5: "=LEFT(A5,2)", C5: "=VALUE(MID(A5,4,4))", D5: "=RIGHT(A5,4)",
      A7: "apple", A8: "banana", A9: "cherry",
      B7: '=TEXTJOIN(", ",TRUE,A7:A9)', C7: '=CONCAT(A7,"-",A8)', D7: '=SUBSTITUTE(A7,"p","P")', E7: "=LEN(A7)", F7: "=UPPER(A7)&LOWER(\"X\")",
    },
  },
  dates: {
    select: "B2", hint: "Dates are serial numbers: A2 shows 2024-02-10 because of its format, but it stores 45332.",
    formats: { A2: DATE_FMT, A3: DATE_FMT, A4: DATE_FMT, F2: DATE_FMT, G2: DATE_FMT, F3: DATE_FMT, G3: DATE_FMT },
    cells: {
      A1: "Date", B1: "Year", C1: "Month", D1: "Day", E1: "TEXT", F1: "Month start", G1: "Month end",
      A2: "=DATE(2024,2,10)", B2: "=YEAR(A2)", C2: "=MONTH(A2)", D2: "=DAY(A2)", E2: '=TEXT(A2,"dddd, d mmmm yyyy")', F2: "=DATE(YEAR(A2),MONTH(A2),1)", G2: "=EOMONTH(A2,0)",
      A3: "=DATE(2025,1,31)", B3: "=YEAR(A3)", C3: "=MONTH(A3)", D3: "=DAY(A3)", E3: '=TEXT(A3,"dd/mm/yyyy")', F3: "=DATE(YEAR(A3),MONTH(A3),1)", G3: "=EOMONTH(A3,0)",
      A4: "=DATE(2025,12,5)", A6: "Days between A3 and A4", B6: "=A4-A3", A7: "Overflow DATE(2025,14,1)", B7: "=DATE(2025,14,1)",
    },
    },
  "conditional-format": {
    select: "C2", hint: "Pick a rule and a range. Ties at the Top N cut-off are all highlighted.",
    cells: {
      A1: "Rep", B1: "Product", C1: "Sales",
      A2: "Ana", B2: "Pen", C2: "30", A3: "Ben", B3: "Book", C3: "100", A4: "Chen", B4: "Pen", C4: "20", A5: "Ana", B5: "Bag", C5: "45", A6: "Dia", B6: "Pen", C6: "20",
      A7: "Eli", B7: "Book", C7: "90", A8: "Fay", B8: "Bag", C8: "45", A9: "Ben", B9: "Pen", C9: "10", A10: "Chen", B10: "Book", C10: "60", A11: "Dia", B11: "Bag", C11: "75",
    },
  },
  pivot: { select: "A1", hint: "Click a pivot cell to see the source rows behind it.", cells: {} },
  cleaning: { select: "A1", hint: "Apply operations in order and compare before and after.", cells: {} },
};
export const bookFor = (id: string | undefined): Book => BOOKS[presetById(id)?.id ?? "formulas"];
