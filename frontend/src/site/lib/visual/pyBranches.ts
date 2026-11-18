/**
 * Condition, branch and loop views for the Python trace. Pure TypeScript.
 *
 * Nothing here is invented. Two real inputs are combined:
 * 1. The SHAPE of the source (where each `if`, `elif`, `else`, `while` and `for` starts and where its body is), read by a
 *    conservative line reader (it follows brackets, strings and comments, and refuses what it cannot read).
 * 2. What the tracer RECORDED: the next executed line after a condition line says which way the condition went, and the
 *    tracer's exact line counts say how often each way was taken in the whole run.
 * A branch outcome is derived from the next executed event, never guessed. If that event was not recorded (a sampled gap), the
 * outcome is "unknown". Not covered: one-line compound statements (`if x: y`), `match`, conditional expressions (`a if c else b`),
 * `and`/`or` short-circuits and conditions inside comprehensions: Python reports no separate event for them.
 */
import { lineCounts, type LoopStat, type Trace, type TraceStep } from "./pyTrace";
import { gapBetween } from "./pyStepper";

export type ConstructKind = "if" | "elif" | "else" | "while" | "for";

export interface Construct {
  kind: ConstructKind;
  /** First line of the header, and the last line of a header that spans several lines. */
  line: number;
  headerEnd: number;
  indent: number;
  /** Condition text (`if`, `elif`, `while`), iterable text (`for`), empty for `else`. */
  cond: string;
  /** `for` only: the loop target text, for example `i` or `key, value`. */
  target?: string;
  bodyStart: number;
  bodyEnd: number;
  /** Line of the `if` that starts this if/elif/else chain, or of the loop for a loop's `else`. */
  chain: number;
  /** `else` that belongs to a `for` or `while` (runs when the loop was not left by `break`). */
  loopElse?: boolean;
  /** The first statement of the body is a bare constant (a docstring, `...`): Python emits no line event for it, so counts are not usable. */
  ambiguousBody: boolean;
}

export interface SourceMap {
  constructs: Construct[];
  /** Plain-language notes on what was not read. */
  notes: string[];
  /** False when the source has tab indentation or nothing could be read. Branch views are then off. */
  supported: boolean;
}

export interface Logical { start: number; end: number; indent: number; text: string }

/** Logical lines of the source: code only (comments removed), continuation lines joined, blank lines dropped. */
export function readLogicalLines(source: string): { lines: Logical[]; tabs: boolean } {
  const lines: Logical[] = [];
  let tabs = false;
  const src = source.replace(/\r\n?/g, "\n");
  let i = 0, line = 1;
  let text = "", start = 0, depth = 0, indent = 0, hasCode = false;
  const flush = (end: number) => {
    const t = text.trim();
    if (t) lines.push({ start, end, indent, text: t });
    text = ""; depth = 0; hasCode = false;
  };
  let atLineStart = true;
  while (i < src.length) {
    const ch = src[i];
    if (atLineStart && !hasCode) {
      // Read the indentation of a new logical line.
      let j = i, n = 0;
      while (src[j] === " " || src[j] === "\t") { if (src[j] === "\t") tabs = true; n += src[j] === "\t" ? 8 : 1; j++; }
      indent = n; start = line; i = j; atLineStart = false;
      if (j >= src.length) break;
      continue;
    }
    if (ch === "\n") {
      line++; atLineStart = true; i++;
      if (depth === 0 && !text.endsWith("\\")) { flush(line - 1); }
      else { text = text.endsWith("\\") ? text.slice(0, -1) + " " : text + " "; }
      continue;
    }
    if (ch === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === '"' || ch === "'") {
      const triple = src.startsWith(ch.repeat(3), i);
      const q = triple ? ch.repeat(3) : ch;
      let j = i + q.length;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src.startsWith(q, j)) break;
        if (!triple && src[j] === "\n") break;
        j++;
      }
      const end = Math.min(src.length, j + q.length);
      const chunk = src.slice(i, end);
      for (const c of chunk) if (c === "\n") line++;
      text += chunk.replace(/\n/g, " "); hasCode = true; i = end;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch !== " " && ch !== "\t") hasCode = true;
    text += ch; i++;
  }
  flush(line);
  return { lines, tabs };
}

const HEADER = /^(if|elif|while)\b\s*([\s\S]*?)\s*:$/;
const FOR = /^(?:async\s+)?for\b\s+([\s\S]+?)\s+in\s+([\s\S]+?)\s*:$/;
const ELSE = /^else\s*:$/;
const OTHER_COMPOUND = /^(try|except|finally|with|async\s+with|def|async\s+def|class|match|case)\b/;
const INLINE = /^(if|elif|while|for|else)\b[^]*:\s*\S/;
const CONSTANT_STMT = /^(["']|\d|\.\.\.$)/;

/** Read the shape of `source`. Never throws. */
export function analyzeSource(source: string): SourceMap {
  const { lines, tabs } = readLogicalLines(source);
  const notes: string[] = [];
  if (tabs) return { constructs: [], supported: false, notes: ["The source indents with tab characters, so the branch and loop view is off (spaces only are read)."] };
  const constructs: Construct[] = [];
  const lastAt = new Map<number, { kind: string; chain: number }>();
  let inline = 0;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    for (const key of [...lastAt.keys()]) if (key > l.indent) lastAt.delete(key);
    let kind: ConstructKind | null = null, cond = "", target: string | undefined;
    let m: RegExpMatchArray | null;
    if ((m = l.text.match(HEADER))) { kind = m[1] as ConstructKind; cond = m[2]; }
    else if ((m = l.text.match(FOR))) { kind = "for"; target = m[1]; cond = m[2]; }
    else if (ELSE.test(l.text)) kind = "else";
    else if (INLINE.test(l.text) && /^(if|elif|while|for|else)\b/.test(l.text)) { inline++; lastAt.set(l.indent, { kind: "other", chain: l.start }); continue; }
    if (!kind) {
      lastAt.set(l.indent, { kind: OTHER_COMPOUND.test(l.text) ? "other" : "stmt", chain: l.start });
      continue;
    }
    // Body: the following logical lines indented deeper than the header.
    let b = k + 1;
    while (b < lines.length && lines[b].indent > l.indent) b++;
    if (b === k + 1) { lastAt.set(l.indent, { kind: "other", chain: l.start }); continue; }
    const first = lines[k + 1], lastBody = lines[b - 1];
    let chain = l.start, loopElse = false;
    if (kind === "else") {
      const prev = lastAt.get(l.indent);
      if (!prev || (prev.kind !== "if" && prev.kind !== "elif" && prev.kind !== "for" && prev.kind !== "while")) { lastAt.set(l.indent, { kind: "other", chain: l.start }); continue; }
      chain = prev.chain; loopElse = prev.kind === "for" || prev.kind === "while";
    } else if (kind === "elif") {
      const prev = lastAt.get(l.indent);
      if (!prev || (prev.kind !== "if" && prev.kind !== "elif")) { lastAt.set(l.indent, { kind: "other", chain: l.start }); continue; }
      chain = prev.chain;
    }
    constructs.push({ kind, line: l.start, headerEnd: l.end, indent: l.indent, cond, target, bodyStart: first.start, bodyEnd: lastBody.end, chain, loopElse, ambiguousBody: CONSTANT_STMT.test(first.text) });
    lastAt.set(l.indent, { kind: kind === "else" ? "else" : kind, chain });
  }
  if (inline) notes.push(`${inline} one-line compound statement${inline === 1 ? "" : "s"} (such as "if x: y") ${inline === 1 ? "is" : "are"} not analysed.`);
  notes.push("Conditional expressions (a if c else b), and/or short-circuits, match statements and conditions inside comprehensions are not shown as branches: Python records no separate step for them.");
  return { constructs, notes, supported: true };
}

const depthOf = (t: Trace, i: number) => t.steps[i]?.frames.length ?? 0;
const inHeader = (c: Construct, line: number) => line >= c.line && line <= c.headerEnd;
const inBody = (c: Construct, line: number) => line >= c.bodyStart && line <= c.bodyEnd;

const WORDS = new Set(["and", "or", "not", "in", "is", "if", "else", "True", "False", "None", "for", "lambda", "len", "range", "int", "str", "float", "sum", "min", "max", "abs", "any", "all", "isinstance", "enumerate", "sorted", "list", "dict", "set", "tuple", "type", "print"]);

/** The real values of the names a condition mentions, in the frame of step `i` (the values BEFORE the condition runs). */
export function operandsAt(t: Trace, i: number, text: string): { name: string; value: string; type?: string }[] {
  const frame = t.steps[i]?.frames[t.steps[i].frames.length - 1];
  if (!frame) return [];
  const seen = new Set<string>();
  const out: { name: string; value: string; type?: string }[] = [];
  const stripped = text.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
  for (const m of stripped.matchAll(/(?<![\w.])([A-Za-z_]\w*)(?!\s*\()/g)) {
    const name = m[1];
    if (WORDS.has(name) || seen.has(name)) continue;
    seen.add(name);
    const idx = frame.vars[name];
    if (idx === undefined) continue;
    const v = t.vals[idx];
    if (v) out.push({ name, value: v.r, type: v.t ?? v.k });
  }
  return out;
}

export type BranchOutcome = "true" | "false" | "unknown";

export interface BranchView {
  kind: "if" | "elif" | "while" | "for";
  line: number;
  /** Condition text (for `for`: `target in iterable`). */
  text: string;
  outcome: BranchOutcome;
  /** The executed line that followed, which is what the outcome was read from. */
  nextLine?: number;
  /** For a `for` loop that took the next item: the loop variable's real value at the first body step. */
  item?: { name: string; value: string };
  operands: { name: string; value: string; type?: string }[];
  /** Plain sentence. */
  summary: string;
  /** Why the outcome is what it is: always names the recorded evidence, or says why it is unknown. */
  evidence: string;
}

function nextAtDepth(t: Trace, i: number, c: Construct): { k: number } | { reason: "sampled" | "end" } {
  const d = depthOf(t, i);
  for (let k = i + 1; k < t.steps.length; k++) {
    const s = t.steps[k];
    if (s.frames.length > d) continue; // a call made by the condition
    if (s.frames.length === d && s.ev === "line" && inHeader(c, s.line)) continue; // later line of a multi-line condition
    return { k };
  }
  return t.gaps?.some((g) => g.after >= i) || t.detached ? { reason: "sampled" } : { reason: "end" };
}

/** What the condition on step `i` evaluated to, read from the next executed event in the same frame. Null when step `i` is not a condition line. */
export function branchAtStep(t: Trace, map: SourceMap, i: number): BranchView | null {
  const s: TraceStep | undefined = t.steps[i];
  if (!s || s.ev !== "line" || !map.supported) return null;
  const c = map.constructs.find((x) => x.kind !== "else" && inHeader(x, s.line));
  if (!c || c.kind === "else") return null;
  const kind = c.kind;
  const text = kind === "for" ? `${c.target} in ${c.cond}` : c.cond;
  const operands = operandsAt(t, i, c.cond);
  const base = { kind, line: c.line, text, operands } as const;
  const nxt = nextAtDepth(t, i, c);
  if (!("k" in nxt)) {
    const sampled = nxt.reason === "sampled";
    return { ...base, outcome: "unknown", summary: "The outcome of this condition is not known.", evidence: sampled ? "The steps after this one were not recorded (the trace is sampled or tracing stopped)." : "The program ended right after this line; no later event shows which way it went." };
  }
  const n = t.steps[nxt.k];
  if (gapBetween(t, i, nxt.k)) {
    return { ...base, outcome: "unknown", summary: "The outcome of this condition is not known.", evidence: "A sampled gap follows this step, so the next executed line was not recorded." };
  }
  if (n.ev === "exception") {
    return { ...base, outcome: "unknown", summary: `Evaluating the condition raised ${n.exc?.type ?? "an exception"}.`, evidence: `The next recorded event is an exception at line ${n.line}.` };
  }
  const took = n.ev === "line" && n.frames.length === s.frames.length && inBody(c, n.line);
  const evidence = took ? `The next executed line is ${n.line}, the first line of the body (line ${c.bodyStart}).` : `The next executed event is ${n.ev === "line" ? `line ${n.line}` : n.ev}, outside the body (lines ${c.bodyStart} to ${c.bodyEnd}).`;
  if (kind === "for") {
    if (took) {
      const name = c.target && /^[A-Za-z_]\w*$/.test(c.target.trim()) ? c.target.trim() : undefined;
      const idx = name ? n.frames[n.frames.length - 1].vars[name] : undefined;
      const item = name && idx !== undefined ? { name, value: t.vals[idx]?.r ?? "" } : undefined;
      return { ...base, outcome: "true", nextLine: n.line, item, summary: `The loop takes the next item${item ? `: ${item.name} = ${item.value}` : ""}, and the body runs.`, evidence };
    }
    return { ...base, outcome: "false", nextLine: n.line, summary: "There are no items left (or the iterable was empty). The loop ends.", evidence };
  }
  if (kind === "while") {
    return took
      ? { ...base, outcome: "true", nextLine: n.line, summary: "The condition is True, so the body runs again.", evidence }
      : { ...base, outcome: "false", nextLine: n.line, summary: "The condition is False, so the loop ends.", evidence };
  }
  return took
    ? { ...base, outcome: "true", nextLine: n.line, summary: `The condition is True: the ${kind} branch runs (line ${c.bodyStart}).`, evidence }
    : { ...base, outcome: "false", nextLine: n.line, summary: `The condition is False: the ${kind} branch is skipped.`, evidence };
}

export interface LoopView {
  construct: Construct;
  atHeader: boolean;
  /** Current iteration: at a body step it is the iteration running; at the header it is the check number (the last check, which ends the loop, is one more than the iterations that ran). */
  iteration?: number;
  iterationSource?: "tracer" | "events";
  /** Exact whole-run numbers from the tracer for this loop (every entry, recorded or not). */
  stat?: LoopStat;
  /** Loop variable names and their real values at this step (`for` only). */
  loopVars: { name: string; value: string }[];
}

/** Count header events since the loop was entered in the same frame (only valid when no steps were skipped). */
function iterationFromEvents(t: Trace, i: number, c: Construct): number | undefined {
  if (t.gaps?.length || t.detached) return undefined;
  const d = depthOf(t, i);
  let n = 0;
  for (let k = i; k >= 0; k--) {
    const s = t.steps[k];
    if (s.frames.length < d) break;
    if (s.frames.length > d) continue;
    if (s.ev === "call" || (s.ev === "return" && k !== i)) break;
    if (s.ev === "line") {
      if (s.line === c.line) n++;
      else if (!inHeader(c, s.line) && !inBody(c, s.line)) break;
    }
  }
  return n || undefined;
}

/** Loops around step `i`, innermost first, with the current iteration and the real numbers for the whole run. */
export function loopsAtStep(t: Trace, map: SourceMap, i: number): LoopView[] {
  const s = t.steps[i];
  if (!s || !map.supported) return [];
  const loops = map.constructs.filter((c) => (c.kind === "for" || c.kind === "while") && s.line >= c.line && s.line <= c.bodyEnd);
  loops.sort((a, b) => b.line - a.line);
  return loops.map((c) => {
    const atHeader = inHeader(c, s.line);
    let iteration: number | undefined, iterationSource: LoopView["iterationSource"];
    if (s.loop && s.loop[0] === c.line) { iteration = s.loop[1]; iterationSource = "tracer"; }
    else { iteration = iterationFromEvents(t, i, c); if (iteration !== undefined) iterationSource = "events"; }
    const frame = s.frames[s.frames.length - 1];
    const loopVars: LoopView["loopVars"] = [];
    if (c.kind === "for" && c.target) {
      for (const name of c.target.split(/[\s,()]+/).filter((x) => /^[A-Za-z_]\w*$/.test(x))) {
        const idx = frame.vars[name];
        if (idx !== undefined) loopVars.push({ name, value: t.vals[idx]?.r ?? "" });
      }
    }
    return { construct: c, atHeader, iteration, iterationSource, stat: t.loops?.find((l) => l.line === c.line), loopVars };
  });
}

export interface LoopExit { construct: Construct; how: "finished" | "break" | "left-early" }

/** Loops that ended just before step `i` (the previous event in the same frame was inside the loop, this one is outside). */
export function loopExitsAtStep(t: Trace, map: SourceMap, source: string, i: number): LoopExit[] {
  const s = t.steps[i];
  if (!s || !map.supported || s.ev === "call") return [];
  const d = depthOf(t, i);
  let j = i - 1;
  while (j >= 0 && depthOf(t, j) > d) j--;
  if (j < 0 || depthOf(t, j) !== d || gapBetween(t, j, i)) return [];
  const p = t.steps[j];
  if (p.ev !== "line") return [];
  const lines = source.split("\n");
  const out: LoopExit[] = [];
  for (const c of map.constructs) {
    if (c.kind !== "for" && c.kind !== "while") continue;
    const inside = (ln: number) => ln >= c.line && ln <= c.bodyEnd;
    if (!inside(p.line) || (s.ev === "line" && inside(s.line))) continue;
    const text = (lines[p.line - 1] ?? "").replace(/#.*$/, "");
    const how: LoopExit["how"] = inHeader(c, p.line) ? "finished" : /(^|[\s:;])break\s*$/.test(text.trim()) ? "break" : "left-early";
    out.push({ construct: c, how });
  }
  return out.sort((a, b) => b.construct.line - a.construct.line);
}

export interface BranchStat {
  construct: Construct;
  /** How many times the condition line ran, and how many times it went each way. Exact when `exact`. Null when counts cannot be read from lines. */
  evaluations: number;
  taken: number;
  notTaken: number;
  exact: boolean;
  /** Loops only: checks that ended the loop normally, and entries that ended another way (break, return, exception). */
  finishedNormally?: number;
  leftEarly?: number;
}

/** Whole-run branch and loop counts from the tracer's exact line counts. Constructs whose counts cannot be trusted from lines are left out. */
export function branchStats(t: Trace, map: SourceMap): BranchStat[] {
  if (!map.supported) return [];
  const counts = lineCounts(t);
  const exact = t.counts ? t.counts.exact : !t.truncated;
  const out: BranchStat[] = [];
  for (const c of map.constructs) {
    if (c.ambiguousBody) continue;
    const body = counts[c.bodyStart] ?? 0;
    if (c.kind === "else") {
      out.push({ construct: c, evaluations: body, taken: body, notTaken: 0, exact });
      continue;
    }
    if (c.headerEnd !== c.line) continue; // a multi-line header runs more than one line event
    const evals = counts[c.line] ?? 0;
    const st: BranchStat = { construct: c, evaluations: evals, taken: body, notTaken: Math.max(0, evals - body), exact };
    if (c.kind === "for" || c.kind === "while") {
      const loop = t.loops?.find((l) => l.line === c.line);
      st.finishedNormally = st.notTaken;
      if (loop && !loop.approx) st.leftEarly = Math.max(0, loop.entries - st.notTaken);
    }
    out.push(st);
  }
  return out;
}
