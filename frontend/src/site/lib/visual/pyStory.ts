/**
 * The four-part story (what / changed / why / remember) and a small drawing "scene" for one recorded Python step. Pure
 * TypeScript: `pyStepStory(trace, i, ctx)` depends on nothing but its arguments, so Next, Previous, jump and Reset land on the
 * same story for the same step, and nothing is run again.
 *
 * BEFORE AND AFTER (the definition everything below follows)
 * Python's tracer records "line" events: recorded step `i` is the state BEFORE its line runs. What that line DID is the difference
 * to the NEXT recorded step in the same frame:
 *   next(i)  = the first recorded step k > i whose call depth is <= the depth of step i. Steps in between are deeper: calls the
 *              line made (they are reported as calls, with their real arguments and return value).
 *   adjacent = no sampled gap, no unrecorded event and no synthetic "end" step lies between i and k (`gapBetween`), and the
 *              frame is still the same activation (depth(k) == depth(i)).
 *   effect   = for every frame of the stack, the variables whose recorded value differs between step i and step k, and the text
 *              written to stdout between the two (the recorded `out` offsets).
 * When the next step is not adjacent (sampled gap, tracing stopped, last step) the effect is UNKNOWN and the story says so: it never
 * describes a change or a calculation it cannot see.
 *
 * CALCULATIONS (`0 + 100 = 100`)
 * A formula is produced only when (1) the statement is `name op= operand` or `name = operand (op operand)*` where every operand is
 * a variable name or a number or string literal, with operators of one precedence level; (2) every variable operand resolves to a
 * recorded value in the frame before the line ran; (3) the arithmetic done here on those recorded values equals the recorded value
 * of the target at next(i), type included. If any check fails the story says "total went from 0 to 100" and no formula.
 *
 * Nothing here records, runs or estimates a step. Every number or value in a story is read from the trace.
 */
import type { PyVal, Trace } from "./pyTrace";
import { analyzeSource, branchAtStep, loopsAtStep, readLogicalLines, type Logical, type SourceMap } from "./pyBranches";
import { gapBetween } from "./pyStepper";
import { clip, plural, STORY_MAX, type StepStory } from "./story";
import type { Diagnosis } from "./pyDiagnose";

// ── Types ────────────────────────────────────────────────────────────────

export interface PyStoryContext {
  code: string;
  /** Shape of the source (from the adapter's model). Read from `code` when absent. */
  source?: SourceMap;
  /** Diagnoses of the exception that ended the run. */
  diagnoses?: Diagnosis[];
}

export interface VarDelta {
  name: string;
  /** Function name of the frame ("<module>" for the main program). */
  scope: string;
  /** 1-based call depth of that frame. */
  depth: number;
  kind: "new" | "changed" | "removed";
  before?: string;
  after?: string;
  type?: string;
  /** How the new value reads in a sentence: `0 (int)`, `a list of 3 items, [100, 200, 300]`. */
  described?: string;
  /** Same object before and after (a list or dict changed in place). */
  inPlace: boolean;
  isFunction: boolean;
}

export interface CallRecord {
  fn: string;
  callStep: number;
  returnStep: number | null;
  args: { name: string; value: string }[];
  returned?: string;
  raised?: string;
}

export type EffectStatus = "ok" | "raised" | "left" | "sampled" | "last" | "none";

export interface LineEffect {
  /** The next recorded step in the same frame (see the header), or null. */
  next: number | null;
  status: EffectStatus;
  /** Event type of the next step. */
  nextEvent?: string;
  deltas: VarDelta[];
  calls: CallRecord[];
  /** Text written to stdout by this line (only when the effect is known). */
  output?: string;
  /** Exception raised by this line, when the next step is an exception. */
  exception?: { type: string; msg: string };
}

export interface SceneCalc {
  /** Source text of the right-hand side. */
  expression: string;
  operands: { text: string; value: string; name?: string; scope?: string }[];
  symbols: string[];
  result: string;
  target: string;
  /** Value of the target before the line (undefined when it did not exist). */
  before?: string;
  /** `0 + 100 = 100`, from recorded values. */
  formula: string;
}

export interface SceneLoop {
  kind: "for" | "while";
  line: number;
  /** `for price in prices` / `while n > 0` */
  header: string;
  /** `for` only: the iterable's source text (`prices`, `range(5)`). */
  iterable?: string;
  atHeader: boolean;
  /** At the header: how many times the header has run (the check that is about to take an item). In the body: the iteration that is running. */
  iteration?: number;
  /** Whole-run iteration count from the tracer (exact unless tracing stopped). */
  iterations?: number;
  iterationsExact: boolean;
  /** Loop variables with their real values for this iteration. */
  vars: { name: string; value: string }[];
  /** The list being iterated, when it is a plain variable with a recorded list or tuple. */
  list?: { name: string; type: string; length?: number; items: string[]; more: boolean };
  /** Index in `list` of the current item. Only set when `list.items[index]` equals the recorded loop variable. */
  index?: number;
  state: "taking" | "running" | "finished" | "unknown";
  nextLine?: number;
  operands: { name: string; value: string }[];
  /** Number of loops that enclose this one. */
  outer: number;
}

export interface SceneBranch {
  kind: "if" | "elif" | "while";
  line: number;
  condition: string;
  outcome: "true" | "false" | "unknown";
  operands: { name: string; value: string }[];
  /** Which way execution went, read from the next executed line. */
  took: "body" | "elif" | "else" | "skipped" | "unknown";
  nextLine?: number;
  label: string;
}

export interface SceneCall {
  fn: string;
  params: { name: string; value: string; arg?: string; verified: boolean }[];
  callerLine?: number;
  callSite?: string;
  /** Call stack (function names, outermost first) before and after the call. */
  stackBefore: string[];
  stackAfter: string[];
}

export interface SceneReturn {
  fn: string;
  value?: string;
  /** Local variables of the frame that is popped. */
  locals: string[];
  toLine?: number;
  callerLine?: number;
  assignedTo?: string;
  stackAfter: string[];
  yields: boolean;
}

export interface SceneOutput {
  total: string;
  /** New text since the previous recorded step of this frame, when known. */
  added?: string;
  /** How the printed text came about, when it could be checked against recorded values. */
  explained?: string;
}

export interface SceneError {
  type: string;
  message: string;
  line: number;
  codeLine: string;
  /** "uncaught" ends the program, "caught" continues in a handler, "propagates" moves to the caller. */
  fate: "uncaught" | "caught" | "propagates" | "unknown";
  diagnosis?: Diagnosis;
  /** Variables of the failing frame at that step. */
  values: { name: string; value: string }[];
}

export type SceneKind = "statement" | "loop" | "branch" | "call" | "return" | "yield" | "exception" | "finish" | "end";

export interface PyScene {
  kind: SceneKind;
  step: number;
  line: number;
  /** Source text of the statement for this step (all lines of a multi-line statement, joined). */
  statement: string;
  fn: string;
  depth: number;
  /** "global" at depth 1, otherwise "local to f()". */
  scope: string;
  stack: string[];
  effect: LineEffect;
  /** Variable changes of this line, functions left out. */
  changes: VarDelta[];
  calc?: SceneCalc;
  loop?: SceneLoop;
  branch?: SceneBranch;
  call?: SceneCall;
  ret?: SceneReturn;
  output?: SceneOutput;
  error?: SceneError;
  /** The step after this one was not recorded: no change or calculation is claimed. */
  sampled: boolean;
  /** A sampled gap or a stop in tracing lies right before this step. */
  sampledBefore: boolean;
}

export interface PyStoryResult { story: StepStory; scene: PyScene }

// ── Helpers ──────────────────────────────────────────────────────────────

const MAXV = 36;
const val = (t: Trace, idx?: number) => (idx === undefined ? "" : clip(t.vals[idx]?.r ?? "", MAXV));
const tidy = (s: string) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > STORY_MAX ? clip(one, STORY_MAX) : one;
};
const stackLabel = (names: string[]) => names.map((n) => (n === "<module>" ? "main program" : `${n}()`)).join(" → ");
const fnName = (fn: string) => (fn === "<module>" ? "the main program" : `${fn}()`);
const CONTAINERS = new Set(["list", "tuple", "set", "frozenset", "deque", "dict"]);

function describeVal(v?: PyVal): string {
  if (!v) return "";
  const r = clip(v.r, 40);
  const ty = v.t ?? v.k;
  if (CONTAINERS.has(v.k)) return `a ${ty}${v.n !== undefined ? ` of ${v.k === "dict" ? plural(v.n, "entry", "entries") : plural(v.n, "item")}` : ""}, ${r}`;
  if (v.k === "func") return "a function";
  if (v.k === "class") return "a class";
  return `${r} (${ty})`;
}

let cachedCode = "";
let cachedLines: Logical[] = [];
function logicalLines(code: string): Logical[] {
  if (code !== cachedCode) { cachedLines = readLogicalLines(code).lines; cachedCode = code; }
  return cachedLines;
}
let cachedSrcCode = "";
let cachedSrc: SourceMap | null = null;
function sourceMap(ctx: PyStoryContext): SourceMap {
  if (ctx.source) return ctx.source;
  if (cachedSrc && cachedSrcCode === ctx.code) return cachedSrc;
  cachedSrc = analyzeSource(ctx.code); cachedSrcCode = ctx.code;
  return cachedSrc;
}

/** The statement a physical line belongs to (a multi-line statement is returned whole, comments removed). */
export function statementAt(code: string, line: number): string {
  const l = logicalLines(code).find((x) => line >= x.start && line <= x.end);
  return l ? l.text : (code.split("\n")[line - 1] ?? "").trim();
}

const depthOf = (t: Trace, i: number) => t.steps[i]?.frames.length ?? 0;

/** A variable as the line reads it: the running function first, then the main program's globals. */
function resolve(t: Trace, i: number, name: string): { idx: number; scope: string } | null {
  const s = t.steps[i];
  if (!s) return null;
  const top = s.frames[s.frames.length - 1];
  if (top && name in top.vars) return { idx: top.vars[name], scope: top.fn };
  const g = s.frames[0];
  if (s.frames.length > 1 && g && name in g.vars) return { idx: g.vars[name], scope: g.fn };
  return null;
}

// ── Recorded arithmetic ──────────────────────────────────────────────────

type Num = { k: "int"; v: bigint } | { k: "float"; v: number } | { k: "str"; v: string };
const INT = /^-?\d+$/;
const FLOAT = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function parseVal(v: PyVal | undefined): Num | null {
  if (!v) return null;
  if (v.k === "int" && INT.test(v.r)) return { k: "int", v: BigInt(v.r) };
  if (v.k === "float" && FLOAT.test(v.r)) return { k: "float", v: Number(v.r) };
  if (v.k === "str" && v.r.length >= 2 && (v.r[0] === "'" || v.r[0] === '"') && v.r[0] === v.r[v.r.length - 1] && !v.r.includes("\\")) {
    const inner = v.r.slice(1, -1);
    if (v.n === undefined || v.n === inner.length) return { k: "str", v: inner };
  }
  return null;
}

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const safeInt = (n: bigint) => n <= SAFE && n >= -SAFE;
const asNumber = (n: Num): number | null => (n.k === "float" ? n.v : n.k === "int" && safeInt(n.v) ? Number(n.v) : null);

function binop(a: Num, op: string, b: Num): Num | null {
  if (a.k === "str" || b.k === "str") {
    if (a.k === "str" && b.k === "str" && op === "+") return { k: "str", v: a.v + b.v };
    if (op === "*" && a.k === "str" && b.k === "int" && b.v >= 0n && b.v <= 200n && a.v.length * Number(b.v) <= 400) return { k: "str", v: a.v.repeat(Number(b.v)) };
    return null;
  }
  if (a.k === "int" && b.k === "int") {
    const x = a.v, y = b.v;
    switch (op) {
      case "+": return { k: "int", v: x + y };
      case "-": return { k: "int", v: x - y };
      case "*": return { k: "int", v: x * y };
      case "//": {
        if (y === 0n) return null;
        let q = x / y;
        if (x % y !== 0n && (x < 0n) !== (y < 0n)) q -= 1n;
        return { k: "int", v: q };
      }
      case "%": {
        if (y === 0n) return null;
        let r = x % y;
        if (r !== 0n && (r < 0n) !== (y < 0n)) r += y;
        return { k: "int", v: r };
      }
      case "**": return y >= 0n && y <= 64n && (x < 1000000n && x > -1000000n) ? { k: "int", v: x ** y } : null;
      case "/": {
        const p = asNumber(a), q = asNumber(b);
        return p === null || q === null || q === 0 ? null : { k: "float", v: p / q };
      }
      default: return null;
    }
  }
  const p = asNumber(a), q = asNumber(b);
  if (p === null || q === null) return null;
  switch (op) {
    case "+": return { k: "float", v: p + q };
    case "-": return { k: "float", v: p - q };
    case "*": return { k: "float", v: p * q };
    case "/": return q === 0 ? null : { k: "float", v: p / q };
    case "//": return q === 0 ? null : { k: "float", v: Math.floor(p / q) };
    case "%": return q === 0 ? null : { k: "float", v: ((p % q) + q) % q };
    case "**": return { k: "float", v: p ** q };
    default: return null;
  }
}

const sameNum = (a: Num, b: Num) => a.k === b.k && (a.k === "int" ? a.v === (b as typeof a).v : a.v === (b as typeof a).v);

interface Parsed { operands: { text: string; kind: "name" | "number" | "string" }[]; ops: string[] }
const OPERAND = /\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|'[^'\\\n]*'|"[^"\\\n]*")/y;
const OPERATOR = /\s*(\*\*|\/\/|[+\-*/%])/y;
const KEYWORDS = new Set(["and", "or", "not", "in", "is", "if", "else", "lambda", "None", "True", "False", "for", "await", "yield"]);

/** `a + b * c` is refused; `a + b - c` and `a * b` are read. Only operands that are names or literals. */
export function parseSimpleExpr(text: string): Parsed | null {
  const operands: Parsed["operands"] = [], ops: string[] = [];
  let pos = 0;
  const t = text.trim();
  for (;;) {
    OPERAND.lastIndex = pos;
    const m = OPERAND.exec(t);
    if (!m) return null;
    const tx = m[1];
    const kind = /^[A-Za-z_]/.test(tx) ? "name" : /^['"]/.test(tx) ? "string" : "number";
    if (kind === "name" && KEYWORDS.has(tx)) return null;
    operands.push({ text: tx, kind });
    pos = OPERAND.lastIndex;
    if (t.slice(pos).trim() === "") break;
    OPERATOR.lastIndex = pos;
    const o = OPERATOR.exec(t);
    if (!o) return null;
    ops.push(o[1]);
    pos = OPERATOR.lastIndex;
    if (operands.length > 6) return null;
  }
  if (!ops.length) return null;
  const add = ops.every((o) => o === "+" || o === "-");
  const mul = ops.every((o) => o === "*" || o === "/" || o === "//" || o === "%");
  if (!(add || mul || (ops.length === 1 && ops[0] === "**"))) return null;
  return { operands, ops };
}

interface Evaluated { operands: SceneCalc["operands"]; symbols: string[]; result: Num }
/** Evaluate a simple expression with recorded values only (name -> value via `lookup`). Null when anything is not recorded or not simple. */
function evalSimple(t: Trace, p: Parsed, lookup: (name: string) => { idx: number; scope: string } | null, scopeOfStep: string): Evaluated | null {
  const operands: SceneCalc["operands"] = [];
  const nums: Num[] = [];
  for (const o of p.operands) {
    if (o.kind === "name") {
      const r = lookup(o.text);
      if (!r) return null;
      const v = t.vals[r.idx];
      const n = parseVal(v);
      if (!n) return null;
      operands.push({ text: o.text, value: val(t, r.idx), name: o.text, scope: r.scope === scopeOfStep ? undefined : r.scope });
      nums.push(n);
    } else if (o.kind === "number") {
      const n: Num = INT.test(o.text) ? { k: "int", v: BigInt(o.text) } : { k: "float", v: Number(o.text) };
      operands.push({ text: o.text, value: o.text });
      nums.push(n);
    } else {
      operands.push({ text: o.text, value: o.text });
      nums.push({ k: "str", v: o.text.slice(1, -1) });
    }
  }
  let acc = nums[0];
  for (let k = 0; k < p.ops.length; k++) {
    const r = binop(acc, p.ops[k], nums[k + 1]);
    if (!r) return null;
    acc = r;
  }
  return { operands, symbols: p.ops, result: acc };
}

// ── What a line did ──────────────────────────────────────────────────────

/** The effect of the line at step `i` (see the header for the exact definition). Never claims anything it cannot see. */
export function lineEffect(t: Trace, i: number): LineEffect {
  const s = t.steps[i];
  const none: LineEffect = { next: null, status: "none", deltas: [], calls: [] };
  if (!s || s.ev !== "line") return none;
  const d = s.frames.length;
  let k = -1;
  for (let x = i + 1; x < t.steps.length; x++) if (t.steps[x].frames.length <= d) { k = x; break; }
  if (k < 0) return { ...none, status: t.gaps?.some((g) => g.after >= i) || t.detached ? "sampled" : "last" };
  if (gapBetween(t, i, k)) return { ...none, next: k, status: "sampled" };
  const n = t.steps[k];
  if (n.frames.length < d) return { ...none, next: k, status: "left", nextEvent: n.ev };

  const deltas: VarDelta[] = [];
  for (let f = 0; f < d; f++) {
    const a = s.frames[f], b = n.frames[f];
    if (!a || !b || a.fn !== b.fn) continue;
    const mk = (name: string, kind: VarDelta["kind"], bi?: number, ai?: number): VarDelta => {
      const bv = bi !== undefined ? t.vals[bi] : undefined, av = ai !== undefined ? t.vals[ai] : undefined;
      const ref = av ?? bv;
      return {
        name, scope: a.fn, depth: f + 1, kind,
        before: bi !== undefined ? val(t, bi) : undefined, after: ai !== undefined ? val(t, ai) : undefined,
        type: ref ? (ref.t ?? ref.k) : undefined, described: av ? describeVal(av) : undefined,
        inPlace: !!(bv && av && bv.id !== undefined && bv.id === av.id),
        isFunction: ref?.k === "func" || ref?.k === "class",
      };
    };
    for (const [name, idx] of Object.entries(b.vars)) {
      if (!(name in a.vars)) deltas.push(mk(name, "new", undefined, idx));
      else if (a.vars[name] !== idx) deltas.push(mk(name, "changed", a.vars[name], idx));
    }
    for (const name of Object.keys(a.vars)) if (!(name in b.vars)) deltas.push(mk(name, "removed", a.vars[name]));
  }

  const calls: CallRecord[] = [];
  for (let x = i + 1; x < k; x++) {
    const c = t.steps[x];
    if (c.ev !== "call" || c.frames.length !== d + 1) continue;
    const fr = c.frames[d];
    let r: number | null = null;
    for (let y = x + 1; y < k; y++) {
      const e = t.steps[y];
      if (e.frames.length === d + 1 && (e.ev === "return" || e.ev === "yield" || e.ev === "exception")) { r = y; break; }
    }
    const rs = r !== null ? t.steps[r] : undefined;
    calls.push({
      fn: fr.fn, callStep: x, returnStep: r,
      args: Object.entries(fr.vars).map(([name, idx]) => ({ name, value: val(t, idx) })),
      returned: rs && rs.ev !== "exception" && rs.ret !== undefined ? val(t, rs.ret) : undefined,
      raised: rs?.ev === "exception" ? rs.exc?.type : undefined,
    });
  }
  const out = t.stdout.slice(s.out, n.out);
  return {
    next: k, status: n.ev === "exception" ? "raised" : "ok", nextEvent: n.ev, deltas, calls,
    output: out || undefined,
    exception: n.ev === "exception" && n.exc ? { type: n.exc.type, msg: n.exc.msg } : undefined,
  };
}

// ── Statements ───────────────────────────────────────────────────────────

const AUG = /^([A-Za-z_]\w*)\s*(\*\*|\/\/|[+\-*/%])=\s*([\s\S]+)$/;
const ASSIGN = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/;
const PRINT = /^print\s*\(([\s\S]*)\)\s*$/;
const RETURN = /^return\b\s*([\s\S]*)$/;
const DEF = /^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/;
/** "adds price to total", from the operator and the two source texts. */
const opPhrase = (op: string, target: string, rhs: string): string => {
  switch (op) {
    case "+": return `adds ${rhs} to ${target}`;
    case "-": return `subtracts ${rhs} from ${target}`;
    case "*": return `multiplies ${target} by ${rhs}`;
    case "/": return `divides ${target} by ${rhs}`;
    case "//": return `floor-divides ${target} by ${rhs}`;
    case "%": return `takes ${target} modulo ${rhs}`;
    default: return `raises ${target} to the power ${rhs}`;
  }
};

/** Verified calculation for a statement, or null. See "CALCULATIONS" in the header. */
function calcFor(t: Trace, i: number, stmt: string, eff: LineEffect): SceneCalc | null {
  if (eff.status !== "ok" || eff.next === null) return null;
  const k = eff.next, d = depthOf(t, i);
  const scopeNow = t.steps[i].frames[d - 1].fn;
  let target: string, parsed: Parsed | null, rhsText: string;
  const aug = AUG.exec(stmt);
  if (aug) {
    target = aug[1]; rhsText = aug[3];
    const rhs = parseOperandOnly(aug[3]);
    if (!rhs) return null;
    parsed = { operands: [{ text: target, kind: "name" }, rhs], ops: [aug[2]] };
  } else {
    const asg = ASSIGN.exec(stmt);
    if (!asg) return null;
    target = asg[1]; rhsText = asg[2];
    parsed = parseSimpleExpr(asg[2]);
  }
  if (!parsed) return null;
  // The target lives in the running function, or (declared global) in the main program.
  const fr = t.steps[k].frames;
  const homeFrame = target in fr[d - 1].vars ? d - 1 : d > 1 && target in fr[0].vars ? 0 : -1;
  if (homeFrame < 0) return null;
  const afterIdx = fr[homeFrame].vars[target];
  const after = parseVal(t.vals[afterIdx]);
  if (!after) return null;
  const ev = evalSimple(t, parsed, (name) => resolve(t, i, name), scopeNow);
  if (!ev || !sameNum(ev.result, after)) return null;
  const beforeIdx = t.steps[i].frames[homeFrame]?.vars[target];
  const before = beforeIdx !== undefined ? val(t, beforeIdx) : undefined;
  const result = val(t, afterIdx);
  const parts: string[] = [];
  ev.operands.forEach((o, n) => { parts.push(o.value); if (n < ev.symbols.length) parts.push(ev.symbols[n]); });
  return { expression: rhsText, operands: ev.operands, symbols: ev.symbols, result, target, before, formula: `${parts.join(" ")} = ${result}` };
}

function parseOperandOnly(text: string): { text: string; kind: "name" | "number" | "string" } | null {
  const p = parseSimpleExpr(`0 + ${text.trim()}`);
  if (!p || p.operands.length !== 2 || p.ops[0] !== "+") return null;
  return p.operands[1];
}

/** Top-level arguments of the first call `fn(...)` in a statement. */
export function callArguments(stmt: string, fn: string): { positional: string[]; named: Record<string, string>; unsupported: boolean } | null {
  const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?<![\\w])${esc}\\s*\\(`).exec(stmt);
  if (!m) return null;
  let depth = 1, pos = m.index + m[0].length, cur = "", quote = "";
  const args: string[] = [];
  for (; pos < stmt.length; pos++) {
    const ch = stmt[pos];
    if (quote) { cur += ch; if (ch === "\\") { cur += stmt[++pos] ?? ""; } else if (ch === quote) quote = ""; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) { depth--; if (depth === 0) { args.push(cur); break; } }
    if (ch === "," && depth === 1) { args.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (depth !== 0) return null;
  const positional: string[] = [], named: Record<string, string> = {};
  let unsupported = false;
  for (const a of args.map((x) => x.trim()).filter(Boolean)) {
    if (a.startsWith("*")) { unsupported = true; continue; }
    const kw = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/.exec(a);
    if (kw) named[kw[1]] = kw[2]; else positional.push(a);
  }
  return { positional, named, unsupported };
}

function valueText(n: Num): string { return n.k === "str" ? n.v : String(n.v); }

// ── Value history ("how did total get to 600") ────────────────────────────

function history(t: Trace, i: number, name: string): { values: string[]; lines: number[]; first: number } | null {
  if (t.gaps?.length || t.detached) return null;
  const d = depthOf(t, i);
  let start = 0;
  for (let k = i; k >= 0; k--) if (t.steps[k].ev === "call" && depthOf(t, k) === d) { start = k; break; }
  const values: string[] = [], lines: number[] = [];
  let prevIdx: number | undefined, prevLine = 0, first = 0;
  for (let k = start; k <= i; k++) {
    if (depthOf(t, k) !== d) continue;
    const idx = t.steps[k].frames[d - 1].vars[name];
    if (idx !== undefined && idx !== prevIdx) {
      if (prevIdx === undefined) first = prevLine || t.steps[k].line; else lines.push(prevLine);
      values.push(val(t, idx));
    }
    prevIdx = idx; prevLine = t.steps[k].line;
  }
  return values.length >= 1 ? { values, lines, first } : null;
}

function chain(values: string[]): string {
  if (values.length <= 6) return values.join(" → ");
  return `${values.slice(0, 2).join(" → ")} → … → ${values.slice(-2).join(" → ")}`;
}

const uniq = (xs: number[]) => [...new Set(xs)];
const lineWord = (ls: number[]) => (ls.length === 1 ? `line ${ls[0]}` : `lines ${ls.join(", ")}`);

// ── Loops and branches ───────────────────────────────────────────────────

function itemList(t: Trace, i: number, iterable: string): SceneLoop["list"] | undefined {
  const name = iterable.trim();
  if (!/^[A-Za-z_]\w*$/.test(name)) return undefined;
  const r = resolve(t, i, name);
  const v = r ? t.vals[r.idx] : undefined;
  if (!v || !v.items || (v.k !== "list" && v.k !== "tuple" && v.k !== "deque")) return undefined;
  return { name, type: v.t ?? v.k, length: v.n, items: v.items.map((x) => t.vals[x]?.r ?? ""), more: !!v.more };
}

function buildLoop(t: Trace, map: SourceMap, i: number): SceneLoop | null {
  if (!map.supported) return null;
  const views = loopsAtStep(t, map, i);
  const lv = views[0];
  if (!lv) return null;
  const c = lv.construct;
  const header = c.kind === "for" ? `for ${c.target} in ${c.cond}` : `while ${c.cond}`;
  const br = lv.atHeader ? branchAtStep(t, map, i) : null;
  const d = depthOf(t, i);
  // The first body step of this iteration: the loop variables are assigned there, and nowhere earlier.
  let firstBody = i;
  if (!lv.atHeader) {
    for (let k = i; k >= 0; k--) {
      if (depthOf(t, k) < d) break;
      if (depthOf(t, k) === d && t.steps[k].ev === "line" && t.steps[k].line >= c.line && t.steps[k].line <= c.headerEnd) {
        for (let n = k + 1; n <= i; n++) if (depthOf(t, n) === d) { firstBody = n; break; }
        break;
      }
    }
  }
  let vars = lv.loopVars;
  let nextLine: number | undefined;
  let state: SceneLoop["state"] = lv.atHeader ? "unknown" : "running";
  if (lv.atHeader && br) {
    nextLine = br.nextLine;
    state = br.outcome === "true" ? "taking" : br.outcome === "false" ? "finished" : "unknown";
    if (c.kind === "for" && br.outcome === "true" && br.nextLine !== undefined) {
      const nx = lineEffect(t, i).next;
      if (nx !== null && c.target) {
        const fr = t.steps[nx].frames[t.steps[nx].frames.length - 1];
        vars = c.target.split(/[\s,()]+/).filter((x) => /^[A-Za-z_]\w*$/.test(x)).flatMap((name) => (name in fr.vars ? [{ name, value: val(t, fr.vars[name]) }] : []));
      }
    } else if (br.outcome !== "true") {
      vars = lv.loopVars; // the variable keeps the last item
    }
  } else if (!lv.atHeader && firstBody !== i) {
    const fr = t.steps[firstBody].frames[t.steps[firstBody].frames.length - 1];
    if (c.kind === "for" && c.target) vars = c.target.split(/[\s,()]+/).filter((x) => /^[A-Za-z_]\w*$/.test(x)).flatMap((name) => (name in fr.vars ? [{ name, value: val(t, fr.vars[name]) }] : []));
  }
  const list = c.kind === "for" ? itemList(t, i, c.cond) : undefined;
  let index: number | undefined;
  if (list && lv.iteration !== undefined && state !== "finished" && state !== "unknown" && vars.length === 1) {
    const idx = lv.iteration - 1;
    // Highlight only when the item at that position really is the loop variable's recorded value.
    if (idx >= 0 && idx < list.items.length && clipEq(list.items[idx], vars[0].value)) index = idx;
  }
  const stat = lv.stat;
  const exact = !!stat && !stat.approx && !t.detached && (t.counts ? t.counts.exact : true);
  return {
    kind: c.kind as "for" | "while", line: c.line, header, iterable: c.kind === "for" ? c.cond : undefined, atHeader: lv.atHeader,
    iteration: lv.iteration, iterations: stat && exact ? stat.iterations : undefined, iterationsExact: exact,
    vars, list, index, state, nextLine,
    operands: br ? br.operands.map((o) => ({ name: o.name, value: clip(o.value, MAXV) })) : [],
    outer: views.length - 1,
  };
}

const clipEq = (full: string, shown: string) => clip(full, MAXV) === shown;

function buildBranch(t: Trace, map: SourceMap, i: number): SceneBranch | null {
  const b = branchAtStep(t, map, i);
  if (!b || b.kind === "for") return null;
  const operands = b.operands.map((o) => ({ name: o.name, value: clip(o.value, MAXV) }));
  const base = { kind: b.kind, line: b.line, condition: clip(b.text, 60), outcome: b.outcome, operands, nextLine: b.nextLine } as const;
  if (b.kind === "while") return { ...base, kind: "while", took: b.outcome === "true" ? "body" : b.outcome === "false" ? "skipped" : "unknown", label: b.outcome === "true" ? "True: the body runs" : b.outcome === "false" ? "False: the loop ends" : "not known" };
  if (b.outcome === "unknown") return { ...base, took: "unknown", label: "not known" };
  if (b.outcome === "true") return { ...base, took: "body", label: `True: the ${b.kind} branch runs` };
  // False: what ran next? Another test of the same chain (elif), the else body, or nothing.
  const c = map.constructs.find((x) => x.kind === b.kind && x.line === b.line);
  const next = b.nextLine;
  const sibling = c && next !== undefined ? map.constructs.find((x) => x.chain === c.chain && x.line !== c.line && x.kind === "elif" && next >= x.line && next <= x.headerEnd) : undefined;
  const els = c && next !== undefined ? map.constructs.find((x) => x.chain === c.chain && x.kind === "else" && !x.loopElse && next >= x.bodyStart && next <= x.bodyEnd) : undefined;
  if (sibling) return { ...base, took: "elif", label: `False: skips this branch and tests the next condition (line ${sibling.line})` };
  if (els) return { ...base, took: "else", label: `False: the else branch runs (line ${els.bodyStart})` };
  return { ...base, took: "skipped", label: "False: the branch is skipped" };
}

// ── The story ────────────────────────────────────────────────────────────

function deltaPhrase(d: VarDelta, top: string): string {
  const where = d.scope === top ? "" : d.scope === "<module>" ? " (global)" : ` (in ${d.scope}())`;
  if (d.kind === "new") return `${d.name} is created${where}: ${d.described ?? d.after}`;
  if (d.kind === "removed") return `${d.name} is removed${where}`;
  if (d.inPlace) return `${d.name}${where} changed in place: ${d.before} → ${d.after}`;
  return `${d.name}${where} went from ${d.before} to ${d.after}`;
}

function changesText(changes: VarDelta[], top: string): string {
  if (!changes.length) return "";
  const first = changes.slice(0, 3).map((d) => deltaPhrase(d, top));
  return `${first.join("; ")}${changes.length > 3 ? `; and ${changes.length - 3} more` : ""}`;
}

const shown = (s: string) => (s.endsWith("\n") ? `\`${clip(s.slice(0, -1), 40)}\` and a new line` : `\`${clip(s, 40)}\``);

/** One story and one scene for recorded step `i`. Pure: the result depends only on the arguments. */
export function pyStepStory(t: Trace, i: number, ctx: PyStoryContext): PyStoryResult {
  const r = buildStory(t, i, ctx);
  return { scene: r.scene, story: fitStory(r.story) };
}

function buildStory(t: Trace, i0: number, ctx: PyStoryContext): PyStoryResult {
  const i = Math.min(Math.max(0, i0), Math.max(0, t.steps.length - 1));
  const s = t.steps[i];
  if (!s) {
    const empty: PyScene = { kind: "statement", step: 0, line: 0, statement: "", fn: "", depth: 0, scope: "", stack: [], effect: { next: null, status: "none", deltas: [], calls: [] }, changes: [], sampled: false, sampledBefore: false };
    return { story: { what: "There is no recorded step here.", changed: "Nothing was recorded, so nothing changed.", why: "The tracer records the lines that run.", remember: "Run the code first, then visualize it." }, scene: empty };
  }
  const map = sourceMap(ctx);
  const d = s.frames.length;
  const frame = s.frames[d - 1];
  const stmt = statementAt(ctx.code, s.line);
  const stmtShown = clip(stmt, 60);
  const stack = s.frames.map((f) => f.fn);
  const sampledBefore = !!t.gaps?.some((g) => g.before === i);
  const scopeLabel = d === 1 ? "global" : `local to ${frame.fn}()`;
  const eff = lineEffect(t, i);
  const changes = eff.deltas.filter((x) => !x.isFunction);
  const loop = s.ev === "line" ? buildLoop(t, map, i) : null;
  const base: PyScene = {
    kind: "statement", step: i, line: s.line, statement: stmt, fn: frame.fn, depth: d, scope: scopeLabel, stack,
    effect: eff, changes, sampled: s.ev === "line" && eff.status === "sampled", sampledBefore,
    loop: loop ?? undefined,
  };
  const sampledNote = "The tracer sampled this stretch, so the steps after this one were not recorded. What this line did is not shown, and no calculation is claimed.";

  switch (s.ev) {
    case "call": return callStory(t, i, base, ctx);
    case "return": return returnStory(t, i, base);
    case "yield": return returnStory(t, i, base, true);
    case "exception": return exceptionStory(t, i, base, ctx);
    case "end": {
      const vars = Object.entries(frame.vars).filter(([, v]) => t.vals[v]?.k !== "func" && t.vals[v]?.k !== "class").slice(0, 4).map(([n, v]) => `${n} = ${val(t, v)}`);
      return { scene: { ...base, kind: "end", output: { total: t.stdout.slice(0, s.out) } }, story: {
        what: `Tracing stopped earlier${t.detached ? ` (after ${t.detached.atEvent.toLocaleString("en-US")} events)` : ""}; the program then ran to its end without being traced.`,
        changed: `These are the final values${vars.length ? `: ${vars.join(", ")}` : ""}. The steps in between were not recorded, so no step-by-step change is shown.`,
        why: "The tracer has a step and time budget so long programs stay fast; the program itself still ran to completion.",
        remember: "A sampled trace keeps exact counts but not every step.",
      } };
    }
    default: break;
  }

  // ── a "line" event ──
  const brStep = map.supported ? branchAtStep(t, map, i) : null;
  const loopPrefix = loop && !loop.atHeader ? `${loop.iteration !== undefined ? `Iteration ${loop.iteration}${loop.iterations !== undefined ? ` of ${loop.iterations}` : ""}: ` : ""}` : "";

  // Loop header
  if (brStep && (brStep.kind === "for" || brStep.kind === "while") && loop) {
    const check = loop.iteration;
    const scene: PyScene = { ...base, kind: "loop" };
    const head = `\`${clip(loop.header, 50)}\``;
    if (loop.kind === "for") {
      const itemTxt = loop.vars.map((v) => `${v.name} = ${v.value}`).join(", ");
      const total = loop.iterations !== undefined ? ` of ${loop.iterations}` : "";
      const pos = loop.index !== undefined && loop.list ? ` (item ${loop.index} of ${loop.list.length ?? loop.list.items.length}${loop.list.more ? " or more" : ""} in ${loop.list.name})` : loop.list && loop.state === "taking" ? ` (from ${loop.list.name})` : "";
      if (loop.state === "taking") return { scene, story: {
        what: `${check !== undefined ? `Loop check ${check}: ` : ""}${head} takes the next item from ${clip(loop.iterable ?? "the iterable", 40)}.`,
        changed: `${itemTxt || "The loop variable"}${pos}. ${check !== undefined ? `Iteration ${check}${total} begins` : "An iteration begins"}; the body runs next (line ${loop.nextLine ?? "?"}).`,
        why: "A for loop gives the loop variable the next item on every pass, then runs the body. The picture marks the item it just took.",
        remember: "The loop variable is reassigned at the top of every iteration.",
      } };
      if (loop.state === "finished") return { scene, story: {
        what: `${check !== undefined ? `Loop check ${check}: ` : ""}${head} finds no items left.`,
        changed: `${loop.vars.length ? `${loop.vars.map((v) => `${v.name} stays ${v.value}`).join(", ")} (the last item). ` : ""}The loop ends${check !== undefined ? ` after ${check - 1} iteration${check - 1 === 1 ? "" : "s"}` : ""}; execution continues at line ${loop.nextLine ?? "?"}.`,
        why: "When the iterable has no more items the loop stops without running the body again.",
        remember: "After a for loop the variable still holds the last item.",
      } };
      return { scene, story: {
        what: `${check !== undefined ? `Loop check ${check}: ` : ""}${head} asks for the next item.`,
        changed: "Not shown: the steps after this one were not recorded (sampled trace), so whether it took another item is unknown.",
        why: "A sampled trace keeps some steps and exact counts, not every pass of a long loop.",
        remember: "Where the trace has a gap, the story does not guess.",
      } };
    }
    // while
    const ops = loop.operands.map((o) => `${o.name} = ${o.value}`).join(", ");
    const cond = `\`${clip(brStep.text, 50)}\``;
    if (brStep.outcome === "unknown") return { scene, story: {
      what: `${check !== undefined ? `Check ${check}: ` : ""}Python evaluates ${cond}.`,
      changed: `${ops ? `${ops}. ` : ""}Not shown: the result is not known because the next step was not recorded.`,
      why: "A while loop re-checks its condition before every pass.",
      remember: "Without the next recorded line, the outcome of a condition is unknown.",
    } };
    return { scene, story: {
      what: `${check !== undefined ? `Check ${check}: ` : ""}Python evaluates ${cond}${ops ? ` with ${ops}` : ""}.`,
      changed: brStep.outcome === "true" ? `The condition is True, so the body runs (line ${brStep.nextLine ?? "?"}).` : `The condition is False, so the loop ends and execution continues at line ${brStep.nextLine ?? "?"}.`,
      why: "A while loop checks its condition before every pass and stops the first time it is False. The outcome is read from the line that ran next.",
      remember: "Something in the body must change the condition, or the loop never ends.",
    } };
  }

  // if / elif
  if (brStep && (brStep.kind === "if" || brStep.kind === "elif")) {
    const br = buildBranch(t, map, i);
    if (br) {
      const scene: PyScene = { ...base, kind: "branch", branch: br };
      const ops = br.operands.map((o) => `${o.name} = ${o.value}`).join(", ");
      const cond = `\`${br.kind} ${clip(br.condition, 50)}\``;
      const what = `${loopPrefix}Python evaluates ${cond}${ops ? ` with ${ops}` : ""}.`;
      if (br.outcome === "unknown") return { scene, story: { what, changed: `Not shown: ${brStep.evidence}`, why: "A condition's outcome is read from the line that ran next.", remember: "Without the next recorded line, a condition's outcome is unknown." } };
      return { scene, story: {
        what,
        changed: br.outcome === "true" ? `The condition is True, so the ${br.kind} branch runs next (line ${br.nextLine ?? "?"}).` : br.took === "elif" ? `The condition is False. Python skips this branch and tests the next condition (line ${br.nextLine ?? "?"}).` : br.took === "else" ? `The condition is False, so the else branch runs next (line ${br.nextLine ?? "?"}).` : `The condition is False, so the branch is skipped and execution goes on at line ${br.nextLine ?? "?"}.`,
        why: "Python runs the first branch of an if / elif / else chain whose condition is True, and skips the rest. Which line ran next is the proof of which way it went.",
        remember: "Only one branch of a chain runs.",
      } };
    }
  }

  // Plain statement
  const scene: PyScene = { ...base };
  const aug = AUG.exec(stmt), asg = aug ? null : ASSIGN.exec(stmt);
  const calc = calcFor(t, i, stmt, eff);
  if (calc) scene.calc = calc;
  const top = frame.fn;
  const callsTxt = eff.calls.length ? eff.calls.slice(0, 2).map((c) => `${c.fn}(${c.args.map((a) => `${a.name}=${a.value}`).join(", ")})${c.returned !== undefined ? ` returned ${c.returned}` : c.raised ? ` raised ${c.raised}` : ""}`).join("; ") : "";
  const pm = PRINT.exec(stmt);
  const rm = RETURN.exec(stmt);
  const dm = DEF.exec(stmt);

  // Output
  if (eff.status === "ok" && eff.output !== undefined) {
    const outAll = t.stdout.slice(0, t.steps[eff.next!].out);
    scene.output = { total: outAll, added: eff.output };
  } else if (s.out > 0) scene.output = { total: t.stdout.slice(0, s.out) };

  let what: string;
  if (dm) what = `${loopPrefix}Runs \`${stmtShown}\`: it creates the ${dm[1] === "def" ? "function" : "class"} ${dm[2]}; its body does not run yet.`;
  else if (aug) what = `${loopPrefix}Runs \`${stmtShown}\`: it ${opPhrase(aug[2], aug[1], clip(aug[3], 30))} and stores the result back in ${aug[1]}.`;
  else if (asg) what = `${loopPrefix}Runs \`${stmtShown}\`: the right side is evaluated first, then the name ${asg[1]} is bound to the result.`;
  else if (pm) what = `${loopPrefix}Runs \`${stmtShown}\`: it writes its values to the output.`;
  else if (rm) what = `${loopPrefix}Runs \`${stmtShown}\`${rm[1] ? `: it ends ${fnName(top)} and hands the value back to the caller` : `: it ends ${fnName(top)}`}.`;
  else what = `${loopPrefix}Runs line ${s.line}: \`${stmtShown}\`.`;
  if (eff.calls.length && !pm) what += ` It calls ${eff.calls[0].fn}().`;

  let changed: string, why: string, remember: string;
  const onlyChanges = changesText(changes, top);

  if (eff.status !== "ok") {
    if (eff.status === "raised") {
      changed = `It does not finish: ${eff.exception?.type ?? "an exception"} is raised${eff.exception?.msg ? ` ("${clip(eff.exception.msg, 60)}")` : ""}. ${onlyChanges ? `${onlyChanges}.` : "Nothing it was going to store is stored."}`;
      why = "An exception stops the line before it can store a result, then Python looks for a handler.";
      remember = "A line that raises leaves its target variable as it was.";
    } else if (eff.status === "last" || eff.status === "left") {
      changed = eff.status === "last" ? "This is the last recorded step, so what the line did is not shown." : "The function ended without a recorded next line, so what this line did is not shown.";
      why = "A line's effect is the difference to the next recorded step in the same function.";
      remember = "No next step, no claimed change.";
    } else {
      changed = `Not shown. ${sampledNote}`;
      why = "A line's effect is read from the next recorded step; where the trace has a gap there is no next step to compare with.";
      remember = "Sampled traces keep exact counts but not every step. Nothing is estimated.";
    }
    return { scene, story: { what, changed, why, remember } };
  }

  if (pm && eff.output !== undefined) {
    const o = eff.output;
    const args = splitArgs(pm[1]);
    let explained: string | undefined;
    if (args && args.length) {
      const resolved = args.map((a) => argValue(t, i, a));
      if (resolved.every((x) => x !== null)) {
        const text = `${resolved.map((x) => x!.text).join(" ")}\n`;
        if (text === o) {
          const names = args.filter((a) => /^[A-Za-z_]\w*$/.test(a));
          const parts = resolved.map((x, n) => (x!.how ? `${args[n]} is ${x!.value}` : null)).filter(Boolean);
          const h = names.length === 1 ? history(t, i, names[0]) : null;
          const wrote = clip(o.replace(/\n$/, ""), 40);
          explained = `${parts.length ? `${parts.join(" and ")}, so print wrote ${wrote}.` : `print wrote ${wrote}${args.some((a) => /^['"]/.test(a)) ? " (a string prints without its quotes)" : ""}.`}${h && h.values.length > 1 ? ` ${names[0]} got there on ${lineWord(uniq(h.lines))}: ${chain(h.values)}.` : ""}`;
        }
      }
    }
    if (scene.output) scene.output.explained = explained;
    changed = `The output gains ${shown(o)}. All output so far: ${clip(scene.output?.total.replace(/\n$/, "") ?? "", 60)}.`;
    why = explained ?? "print writes the text of its values; it does not change any variable.";
    remember = "print shows a value; the variable keeps it.";
    return { scene, story: { what, changed, why, remember } };
  }

  if (calc) {
    const isNew = calc.before === undefined;
    const home = changes.find((x) => x.name === calc.target);
    const tname = home && home.scope !== top ? `${calc.target} (${home.scope === "<module>" ? "global" : `in ${home.scope}()`})` : calc.target;
    changed = `${calc.formula}. ${isNew ? `${tname} is created with ${calc.result}.` : `${tname} went from ${calc.before} to ${calc.result}.`}`;
    why = aug
      ? `\`${aug[1]} ${aug[2]}= ${clip(aug[3], 20)}\` is shorthand for \`${aug[1]} = ${aug[1]} ${aug[2]} ${clip(aug[3], 20)}\`: it reads the value ${aug[1]} holds now, calculates, and stores the result back.`
      : "Python evaluates the right side with the values the names hold right now, then binds the target to the result.";
    remember = aug ? "Augmented assignment reads, calculates, then rebinds the name." : "The right side is worked out first, then the name is bound.";
    return { scene, story: { what, changed, why, remember } };
  }

  if (dm) {
    changed = `${dm[2]} is now a ${dm[1] === "def" ? "function" : "class"} in ${d === 1 ? "the global scope" : fnName(top)}. Nothing is called yet.`;
    why = "def stores the function's code under a name. It only runs when something calls it.";
    remember = "Defining a function is not calling it.";
    return { scene, story: { what, changed, why, remember } };
  }
  if (rm) {
    const nxt = eff.next !== null ? t.steps[eff.next] : undefined;
    const rv = nxt && nxt.ev === "return" && nxt.ret !== undefined ? val(t, nxt.ret) : undefined;
    changed = rv !== undefined ? `The value ${rv} will be handed to the caller and ${fnName(top)} ends.` : `${fnName(top)} ends.`;
    why = "return ends the function and sends one value back to the line that called it; the function's local variables are discarded.";
    remember = "A function without return gives back None.";
    return { scene, story: { what, changed, why, remember } };
  }
  if (changes.length) {
    changed = `${callsTxt ? `${callsTxt}. ` : ""}${onlyChanges}.`;
    const inPlace = changes.some((x) => x.inPlace);
    const globalWrite = changes.some((x) => x.scope !== top);
    why = globalWrite ? "A function normally changes only its own variables. This line wrote to a variable of an outer scope, which Python allows only when it was declared global (or nonlocal), or when it changes the object in place."
      : inPlace ? "A method such as append changes the same object in place, so every name that points at it sees the change."
        : asg && changes.some((x) => x.kind === "new") ? "An assignment binds a name to a value. This name is new, so it now appears in the Variables list."
          : asg ? "Assigning to an existing name re-points it at the new value; the old value is not edited." : "The line's effect is the difference between the variables before it and the next recorded step.";
    remember = inPlace ? "Lists and dicts change in place." : changes.some((x) => x.kind === "new") ? "A variable exists from the moment it is assigned." : "A new value for a name replaces the old one.";
    return { scene, story: { what, changed, why, remember } };
  }
  changed = callsTxt ? `${callsTxt}. No variable changed.` : "No variable changed.";
  why = eff.calls.length ? "The called function ran and returned, but the result was not stored in a variable." : "This line evaluates something without storing a result, so the Variables list stays the same.";
  remember = "Only assignments, loops and some methods change variables.";
  return { scene, story: { what, changed, why, remember } };
}

function splitArgs(inner: string): string[] | null {
  const out: string[] = [];
  let depth = 0, cur = "", quote = "";
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k];
    if (quote) { cur += ch; if (ch === "\\") cur += inner[++k] ?? ""; else if (ch === quote) quote = ""; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (quote || depth !== 0) return null;
  if (cur.trim()) out.push(cur.trim());
  if (out.some((a) => /^\*|^[A-Za-z_]\w*\s*=(?!=)/.test(a))) return null;
  return out;
}

/** A print argument as the text print writes for it, from recorded values only (a name, a literal or a simple expression). */
function argValue(t: Trace, i: number, a: string): { text: string; value: string; how: boolean } | null {
  if (/^[A-Za-z_]\w*$/.test(a)) {
    const r = resolve(t, i, a);
    if (!r) return null;
    const v = t.vals[r.idx];
    const n = parseVal(v);
    if (n) return { text: valueText(n), value: val(t, r.idx), how: true };
    if (v && (v.k === "bool" || v.k === "none" || CONTAINERS.has(v.k)) && v.r.length < 200) return { text: v.r, value: val(t, r.idx), how: true };
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(a)) return { text: a, value: a, how: false };
  if (/^'[^'\\\n]*'$|^"[^"\\\n]*"$/.test(a)) return { text: a.slice(1, -1), value: a, how: false };
  const p = parseSimpleExpr(a);
  if (!p) return null;
  const e = evalSimple(t, p, (name) => resolve(t, i, name), t.steps[i].frames[t.steps[i].frames.length - 1].fn);
  if (!e) return null;
  return { text: valueText(e.result), value: `${e.operands.map((o, n) => `${o.value}${n < e.symbols.length ? ` ${e.symbols[n]} ` : ""}`).join("")}`, how: true };
}

// ── Call, return, exception ──────────────────────────────────────────────

/** Does `arg` (source text of an argument) evaluate, from recorded values at step `j`, to the value index `want` that the parameter holds? */
function argMatches(t: Trace, j: number, arg: string, want: number): boolean {
  if (/^[A-Za-z_]\w*$/.test(arg)) { const r = resolve(t, j, arg); return !!r && r.idx === want; }
  const wn = parseVal(t.vals[want]);
  if (!wn) return false;
  if (/^-?\d+(\.\d+)?$/.test(arg)) return sameNum(INT.test(arg) ? { k: "int", v: BigInt(arg) } : { k: "float", v: Number(arg) }, wn);
  if (/^'[^'\\\n]*'$|^"[^"\\\n]*"$/.test(arg)) return sameNum({ k: "str", v: arg.slice(1, -1) }, wn);
  const p = parseSimpleExpr(arg);
  const e = p ? evalSimple(t, p, (name) => resolve(t, j, name), t.steps[j].frames[t.steps[j].frames.length - 1].fn) : null;
  return !!e && sameNum(e.result, wn);
}

function callStory(t: Trace, i: number, base: PyScene, ctx: PyStoryContext): PyStoryResult {
  const s = t.steps[i];
  const d = s.frames.length;
  const fr = s.frames[d - 1];
  // The caller's line that made this call: the last recorded step of the caller before the call event.
  let j = -1;
  for (let k = i - 1; k >= 0; k--) { if (depthOf(t, k) === d - 1) { j = k; break; } if (depthOf(t, k) < d - 1) break; }
  const callerOk = j >= 0 && t.steps[j].ev === "line" && !gapBetween(t, j, i);
  const site = callerOk ? statementAt(ctx.code, t.steps[j].line) : undefined;
  const short = fr.fn.split(".").pop() ?? fr.fn;
  const ca = site ? callArguments(site, short) : null;
  const params = Object.entries(fr.vars).filter(([, idx]) => t.vals[idx]?.k !== "func" && t.vals[idx]?.k !== "class");
  const offset = params.length && (params[0][0] === "self" || params[0][0] === "cls") ? 1 : 0;
  const mapped: SceneCall["params"] = params.map(([name, idx], n) => {
    let arg: string | undefined;
    if (ca && !ca.unsupported) arg = n >= offset && n - offset < ca.positional.length ? ca.positional[n - offset] : ca.named[name];
    return { name, value: val(t, idx), arg: arg ? clip(arg, 30) : undefined, verified: !!(arg && callerOk && argMatches(t, j, arg, idx)) };
  });
  const scene: PyScene = {
    ...base, kind: "call", effect: { next: null, status: "none", deltas: [], calls: [] }, changes: [],
    call: { fn: fr.fn, params: mapped, callerLine: callerOk ? t.steps[j].line : undefined, callSite: site ? clip(site, 60) : undefined, stackBefore: s.frames.slice(0, -1).map((f) => f.fn), stackAfter: s.frames.map((f) => f.fn) },
  };
  return { scene, story: callText(scene) };
}

function callText(scene: PyScene): StepStory {
  const c = scene.call!;
  const flow = c.params.length ? c.params.map((p) => (p.arg && p.arg !== p.value ? `${p.arg} → ${p.name} = ${p.value}` : `${p.name} = ${p.value}`)).join(", ") : "no arguments";
  const label = fnName(c.fn);
  return {
    what: `Calling ${label}${c.callSite ? ` from \`${c.callSite}\`` : ""}: Python pushes a new frame on the call stack.`,
    changed: `The arguments flow into the parameters: ${flow}. The stack grows from depth ${c.stackBefore.length} to ${c.stackAfter.length}: ${stackLabel(c.stackAfter)}.`,
    why: "Every call gets its own frame with its own local variables, so a parameter is a new name that starts out holding the argument's value.",
    remember: "Changing a parameter inside a function does not rebind the caller's variable.",
  };
}

function returnStory(t: Trace, i: number, base: PyScene, yields = false): PyStoryResult {
  const s = t.steps[i];
  const d = s.frames.length;
  const fr = s.frames[d - 1];
  const retVal = s.ret !== undefined ? val(t, s.ret) : undefined;
  const locals = Object.entries(fr.vars).filter(([, idx]) => t.vals[idx]?.k !== "func" && t.vals[idx]?.k !== "class").map(([n]) => n);
  const stackAfter = s.frames.slice(0, -1).map((f) => f.fn);
  const outAll = t.stdout.slice(0, s.out);
  if (d === 1 && !yields) {
    const vars = Object.entries(fr.vars).filter(([, idx]) => t.vals[idx]?.k !== "func" && t.vals[idx]?.k !== "class").slice(0, 4).map(([n, idx]) => `${n} = ${val(t, idx)}`);
    const scene: PyScene = { ...base, kind: "finish", output: { total: outAll }, effect: { next: null, status: "none", deltas: [], calls: [] }, changes: [] };
    const outText = outAll ? `Output: ${clip(outAll.replace(/\n$/, ""), 80)}.` : "Nothing was printed.";
    if (t.error) return { scene, story: {
      what: `The program ends: ${t.error.type} was not handled${t.error.line ? ` (raised on line ${t.error.line})` : ""}.`,
      changed: `${vars.length ? `Values at the end: ${vars.join(", ")}. ` : ""}${outText} Lines after the failing one never ran.`,
      why: "An exception that nothing catches travels up the call stack and ends the program. Whatever was printed before it still appears.",
      remember: "Work done before the error is kept; the rest of the program is skipped.",
    } };
    return { scene, story: {
      what: "The program finishes: there are no more lines to run.",
      changed: `${vars.length ? `Final values: ${vars.join(", ")}. ` : ""}${outText}`,
      why: "When the last line has run, the main program returns and the call stack is empty. The output is everything print wrote, in order.",
      remember: "Variables show the final state; the output is what the program chose to print.",
    } };
  }
  // The caller: the call line before the call event, and the next line it runs afterwards.
  let c = -1;
  for (let k = i - 1; k >= 0; k--) { if (depthOf(t, k) < d) break; if (t.steps[k].ev === "call" && depthOf(t, k) === d) { c = k; break; } }
  let j = -1;
  if (c > 0) for (let k = c - 1; k >= 0; k--) { if (depthOf(t, k) === d - 1) { j = k; break; } if (depthOf(t, k) < d - 1) break; }
  let n = -1;
  for (let k = i + 1; k < t.steps.length; k++) if (depthOf(t, k) <= d - 1) { n = k; break; }
  const callerLine = j >= 0 && t.steps[j].ev === "line" ? t.steps[j].line : undefined;
  const toLine = n >= 0 && !gapBetween(t, i, n) && t.steps[n].ev === "line" ? t.steps[n].line : undefined;
  const ret: SceneReturn = { fn: fr.fn, value: retVal, locals, toLine, callerLine, stackAfter, yields };
  const scene: PyScene = { ...base, kind: yields ? "yield" : "return", ret, effect: { next: null, status: "none", deltas: [], calls: [] }, changes: [], output: outAll ? { total: outAll } : undefined };
  const fnLabel = fnName(fr.fn);
  const cap = fnLabel[0].toUpperCase() + fnLabel.slice(1);
  if (yields) return { scene, story: {
    what: `${cap} yields ${retVal ?? "a value"} and pauses.`,
    changed: `The caller receives ${retVal ?? "the value"}. ${fnLabel}'s local variables (${locals.slice(0, 4).join(", ") || "none"}) are kept until the next value is asked for.`,
    why: "yield hands a value out without ending the function: its frame is suspended, not popped.",
    remember: "A generator remembers where it stopped.",
  } };
  return { scene, story: {
    what: `${cap} returns ${retVal ?? "None"}: its frame is popped from the call stack.`,
    changed: `${retVal ?? "None"} goes back to the caller${callerLine ? ` (line ${callerLine})` : ""}. The locals ${locals.slice(0, 4).join(", ") || "(none)"} are discarded; the stack shrinks from depth ${d} to ${d - 1}${stackAfter.length ? `: ${stackLabel(stackAfter)}` : ""}.`,
    why: "return ends the function and sends one value back to the line that called it. The function's local variables only existed inside that frame.",
    remember: "Locals disappear when the function returns; only the return value comes back.",
  } };
}

function exceptionStory(t: Trace, i: number, base: PyScene, ctx: PyStoryContext): PyStoryResult {
  const s = t.steps[i];
  const d = s.frames.length;
  const fr = s.frames[d - 1];
  const type = s.exc?.type ?? t.error?.type ?? "Exception";
  const msg = s.exc?.msg ?? t.error?.msg ?? "";
  const codeLine = (ctx.code.split("\n")[s.line - 1] ?? "").trim();
  // What happens next is read from the recorded steps after the exception: a line in the same frame is a handler; the frame's own
  // "return" event means it is being left, and the step after that shows whether the caller handles it or it keeps travelling.
  const nx = t.steps[i + 1];
  let fate: SceneError["fate"] = "unknown";
  let handlerLine: number | undefined, inCaller = false;
  if (!nx) fate = "uncaught";
  else if (gapBetween(t, i, i + 1)) fate = "unknown";
  else if (nx.ev === "line" && nx.frames.length === d) { fate = "caught"; handlerLine = nx.line; }
  else if (nx.ev === "return" && nx.frames.length === d) {
    const n2 = t.steps[i + 2];
    if (d === 1) fate = "uncaught";
    else if (n2 && !gapBetween(t, i + 1, i + 2)) {
      if (n2.ev === "exception" && n2.frames.length === d - 1) fate = "propagates";
      else if (n2.ev === "line" && n2.frames.length === d - 1) { fate = "caught"; handlerLine = n2.line; inCaller = true; }
    }
  }
  const diag = ctx.diagnoses?.find((x) => x.errorType === type) ?? ctx.diagnoses?.[0];
  const values = Object.entries(fr.vars).filter(([, idx]) => t.vals[idx]?.k !== "func" && t.vals[idx]?.k !== "class").slice(0, 6).map(([name, idx]) => ({ name, value: val(t, idx) }));
  const error: SceneError = { type, message: msg, line: s.line, codeLine, fate, diagnosis: diag, values };
  const scene: PyScene = { ...base, kind: "exception", error, effect: { next: null, status: "none", deltas: [], calls: [] }, changes: [], output: s.out > 0 ? { total: t.stdout.slice(0, s.out) } : undefined };
  const vtxt = values.length ? values.slice(0, 4).map((v) => `${v.name} = ${v.value}`).join(", ") : "";
  const fateText = fate === "caught" ? `${inCaller ? "A handler in the caller" : "A handler"} catches it: execution continues at line ${handlerLine}.` : fate === "propagates" ? "Nothing in this function handles it, so the function ends and the exception moves up to the caller." : fate === "uncaught" ? "Nothing handles it, so the program ends here." : "";
  return { scene, story: {
    what: `${type}${msg ? ` ("${clip(msg, 60)}")` : ""} is raised in ${fnName(fr.fn)} at line ${s.line}${codeLine ? `: \`${clip(codeLine, 50)}\`` : ""}.`,
    changed: `${fateText}${vtxt ? ` Values held when it failed: ${vtxt}.` : ""}`.trim() || "No value was stored by the failing line.",
    why: diag ? clip(`${diag.rootCause} ${diag.why}`, 260) : "The line asked Python to do something it cannot do with these values, so Python stops the normal flow and raises an exception.",
    remember: diag ? clip(diag.correctedApproach || diag.prevention, 260) : "Read the error type and the line, then check the values on that line.",
  } };
}

/** Every story is passed through this so a long statement or value can never break the four-part contract. */
export function fitStory(s: StepStory): StepStory {
  return { what: tidy(s.what), changed: tidy(s.changed), why: tidy(s.why), remember: tidy(s.remember) };
}
