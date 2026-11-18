/**
 * Rule-based Python error diagnosis. Pure TypeScript, no AI service, nothing generated.
 *
 * Input: the real traceback or stderr text, the learner's source and, when available, the trace state before the exception.
 * Output: error type, message, line, the code on that line, root cause, why it happened, a corrected approach, how to
 * prevent it, and (only when the rule is certain) a before/after snippet that `applyFix` can apply to the source.
 *
 * Honesty rules:
 * - A patch (`fix`) is produced only when the rule is mechanical and certain: a misspelt name next to a defined one, a missing
 *   colon, a mutable default argument, `range(len(x) + 1)` indexing `x[i]`, and similar. Everything else gives approach text.
 * - Evidence from the trace (variable values, lengths, the line where a value became 0) is quoted only when it was recorded.
 * - Messages are read from the last line of the traceback, so the rules do not depend on one CPython version's wording
 *   except where noted in the rule.
 */
import type { PyVal, Trace } from "./pyTrace";
import { readLogicalLines, type Logical } from "./pyBranches";

export type DiagCategory = "syntax" | "data types" | "control flow" | "functions" | "collections" | "algorithms" | "runtime errors" | "unexpected output";
export type Confidence = "certain" | "likely" | "possible";

export interface Fix {
  kind: "replace" | "insert";
  /** 1-based line replaced, or the line the new text is inserted before. */
  line: number;
  /** The text replaced (empty for an insert). May hold several lines. */
  before: string;
  after: string;
}

export interface Diagnosis {
  errorType: string;
  message: string;
  line?: number;
  codeLine?: string;
  /** Lines around the failing one (for display). */
  relevantCode: { line: number; text: string; current: boolean }[];
  category: DiagCategory;
  /** Stable rule id, for example "name-typo", "mutable-default", "off-by-one-range". */
  cls: string;
  confidence: Confidence;
  rootCause: string;
  why: string;
  correctedApproach: string;
  prevention: string;
  /** Present only when the rule is certain. */
  fix?: Fix;
  /** What real data the diagnosis relied on. */
  evidence: string[];
  /** Variables of the failing frame just before the exception (from the trace). */
  stateBefore?: { name: string; value: string; type?: string }[];
}

export interface ParsedError { type: string; message: string; line?: number }

export interface DiagnoseInput {
  source: string;
  /** Traceback or stderr text as the runner returned it (a trailing "Hint:" paragraph is ignored). */
  error?: string;
  errorType?: string;
  message?: string;
  line?: number;
  trace?: Trace | null;
  /** The tests that were run (used to know which function the learner's code is called through). */
  tests?: string;
}

// ── Reading the error text ─────────────────────────────────────────────────

const TYPE_LINE = /^([A-Za-z_][\w.]*(?:Error|Exception|Exit|Iteration|Interrupt|Warning)|StopIteration|KeyboardInterrupt|GeneratorExit)\b:?\s?(.*)$/;
const FILE_LINE = /File "([^"]*)", line (\d+)/;

/** Pull type, message and line out of a Python traceback (or of a runner message such as the time-limit notice). */
export function parseErrorText(raw: string): ParsedError | null {
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  if (lines.some((l) => /^(Stopped after \d+s|Timed out|Execution timed out)/i.test(l.trim()))) {
    return { type: "Timeout", message: lines.find((l) => l.trim())?.trim() ?? "Stopped", line: undefined };
  }
  let idx = -1;
  for (let k = lines.length - 1; k >= 0; k--) {
    if (/^Hint:/.test(lines[k]) || !lines[k].trim()) continue;
    if (TYPE_LINE.test(lines[k])) { idx = k; break; }
    if (/^\s/.test(lines[k]) || /^File /.test(lines[k]) || /^Traceback/.test(lines[k])) continue;
  }
  if (idx < 0) return null;
  const m = lines[idx].match(TYPE_LINE)!;
  let type = m[1].replace(/^builtins\./, "");
  if (type.includes(".")) type = type.split(".").pop() as string;
  let message = m[2];
  // A message that continues on the next unindented lines is rare; keep only the first line.
  let line: number | undefined;
  const isLearnerFile = (f: string) => /^<(exec|learner|string|stdin)>$/.test(f) || (/\.py$/.test(f) && !/(\/lib\/python|site-packages|\/usr\/lib)/.test(f));
  for (let k = idx - 1; k >= 0; k--) {
    const f = lines[k].match(FILE_LINE);
    if (f && isLearnerFile(f[1])) { line = Number(f[2]); break; }
  }
  const detected = message.match(/\(detected at line (\d+)\)/);
  if (line === undefined && detected) line = Number(detected[1]);
  message = message.replace(/\s*\(detected at line \d+\)/, "");
  return { type, message, line };
}

// ── Small helpers ─────────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

/** The one candidate clearly closest to `name`, or null when there is none or two are equally close. */
export function closest(name: string, candidates: Iterable<string>, maxDist?: number): { word: string; dist: number } | null {
  const limit = maxDist ?? (name.length >= 6 ? 2 : 1);
  let best: { word: string; dist: number } | null = null, tie = false;
  for (const c of new Set(candidates)) {
    if (c === name) continue;
    let d = levenshtein(name.toLowerCase(), c.toLowerCase());
    if (name.toLowerCase() === c.toLowerCase()) d = 0.5; // only the case differs
    if (d > limit) continue;
    if (!best || d < best.dist) { best = { word: c, dist: d }; tie = false; }
    else if (d === best.dist) tie = true;
  }
  return best && !tie ? best : null;
}

const BUILTINS = ["abs", "all", "any", "bool", "dict", "dir", "divmod", "enumerate", "filter", "float", "format", "frozenset", "getattr", "hasattr", "id", "input", "int", "isinstance", "iter", "len", "list", "map", "max", "min", "next", "object", "open", "ord", "pow", "print", "range", "repr", "reversed", "round", "set", "slice", "sorted", "str", "sum", "super", "tuple", "type", "zip", "chr", "hash", "hex", "bin", "callable", "complex", "bytes", "True", "False", "None"];
const STD_MODULES = ["math", "json", "re", "random", "datetime", "collections", "itertools", "functools", "statistics", "string", "csv", "copy", "time", "decimal", "fractions", "heapq", "bisect", "operator", "typing", "dataclasses", "enum", "io", "os", "sys", "textwrap", "pathlib", "hashlib", "uuid", "itertools", "abc", "array", "queue", "unittest", "logging", "contextlib", "sqlite3", "zlib", "base64", "struct", "secrets"];
const PYODIDE_PACKAGES = ["numpy", "pandas"];
const NOT_IN_SANDBOX = ["requests", "flask", "django", "tensorflow", "torch", "boto3", "psycopg2", "selenium", "bs4", "fastapi", "pyspark", "airflow", "kafka", "redis", "pymongo"];

const MEMBERS: Record<string, string[]> = {
  list: ["append", "clear", "copy", "count", "extend", "index", "insert", "pop", "remove", "reverse", "sort"],
  str: ["capitalize", "casefold", "center", "count", "encode", "endswith", "expandtabs", "find", "format", "format_map", "index", "isalnum", "isalpha", "isascii", "isdecimal", "isdigit", "isidentifier", "islower", "isnumeric", "isprintable", "isspace", "istitle", "isupper", "join", "ljust", "lower", "lstrip", "maketrans", "partition", "removeprefix", "removesuffix", "replace", "rfind", "rindex", "rjust", "rpartition", "rsplit", "rstrip", "split", "splitlines", "startswith", "strip", "swapcase", "title", "translate", "upper", "zfill"],
  dict: ["clear", "copy", "fromkeys", "get", "items", "keys", "pop", "popitem", "setdefault", "update", "values"],
  set: ["add", "clear", "copy", "difference", "difference_update", "discard", "intersection", "intersection_update", "isdisjoint", "issubset", "issuperset", "pop", "remove", "symmetric_difference", "symmetric_difference_update", "union", "update"],
  tuple: ["count", "index"],
};
/** Names other languages use for the real method. A swap is offered only for these exact, well-known pairs. */
const ALIASES: Record<string, Record<string, string>> = {
  list: { push: "append", add: "append", put: "append" },
  str: { trim: "strip", lowercase: "lower", uppercase: "upper", toLowerCase: "lower", toUpperCase: "upper" },
};
const MODULE_MEMBERS: Record<string, string[]> = {
  math: ["ceil", "comb", "cos", "degrees", "e", "exp", "fabs", "factorial", "floor", "gcd", "hypot", "inf", "isclose", "isqrt", "lcm", "log", "log10", "log2", "pi", "pow", "radians", "sin", "sqrt", "tan", "tau", "trunc"],
  random: ["choice", "choices", "randint", "random", "randrange", "sample", "seed", "shuffle", "uniform"],
  json: ["dump", "dumps", "load", "loads", "JSONDecodeError"],
  collections: ["Counter", "OrderedDict", "defaultdict", "deque", "namedtuple", "ChainMap"],
  itertools: ["accumulate", "chain", "combinations", "count", "cycle", "groupby", "islice", "permutations", "product", "repeat", "zip_longest"],
  functools: ["lru_cache", "partial", "reduce", "wraps", "cache"],
  datetime: ["date", "datetime", "time", "timedelta", "timezone"],
  statistics: ["mean", "median", "mode", "stdev", "variance"],
};

const lineAt = (src: string, n?: number) => (n ? src.split("\n")[n - 1] : undefined);
const indentOf = (s: string) => s.length - s.trimStart().length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names the source defines (assignments, parameters, functions, classes, imports, loop and `as` targets). */
export function definedNames(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (n: string, line: number) => { if (/^[A-Za-z_]\w*$/.test(n) && !out.has(n)) out.set(n, line); };
  const { lines } = readLogicalLines(source);
  for (const l of lines) {
    const t = l.text;
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(?:async\s+)?def\s+(\w+)\s*\(([\s\S]*)\)\s*(?:->[^:]+)?:/))) {
      add(m[1], l.start);
      for (const p of splitTop(m[2])) add(p.replace(/^\*+/, "").split(/[:=\s]/)[0], l.start);
    } else if ((m = t.match(/^class\s+(\w+)/))) add(m[1], l.start);
    else if ((m = t.match(/^import\s+(.+)$/))) for (const part of m[1].split(",")) { const a = part.trim().split(/\s+as\s+/); add((a[1] ?? a[0]).split(".")[0].trim(), l.start); }
    else if ((m = t.match(/^from\s+\S+\s+import\s+(.+)$/))) for (const part of m[1].replace(/[()]/g, "").split(",")) { const a = part.trim().split(/\s+as\s+/); add((a[1] ?? a[0]).trim(), l.start); }
    for (const f of t.matchAll(/\bfor\s+([\w\s,()]+?)\s+in\b/g)) for (const n of f[1].split(/[\s,()]+/)) add(n, l.start);
    for (const f of t.matchAll(/\bas\s+(\w+)/g)) add(f[1], l.start);
    for (const f of t.matchAll(/(?:^|;)\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?(?:[-+*/%@&|^]|\/\/|\*\*|>>|<<)?=(?!=)/g)) for (const n of f[1].split(",")) add(n.trim(), l.start);
    for (const f of t.matchAll(/\b([A-Za-z_]\w*)\s*:=/g)) add(f[1], l.start);
  }
  return out;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let d = 0, cur = "", q = "";
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ""; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if ("([{".includes(ch)) d++;
    if (")]}".includes(ch)) d--;
    if (ch === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Apply a certain fix to the source (used by the tests to prove the patch really removes the error). */
export function applyFix(source: string, fix: Fix): string {
  const lines = source.split("\n");
  if (fix.kind === "insert") lines.splice(fix.line - 1, 0, ...fix.after.split("\n"));
  else lines.splice(fix.line - 1, fix.before.split("\n").length, ...fix.after.split("\n"));
  return lines.join("\n");
}

function relevant(source: string, line?: number): Diagnosis["relevantCode"] {
  if (!line) return [];
  const lines = source.split("\n");
  const out: Diagnosis["relevantCode"] = [];
  for (let n = Math.max(1, line - 2); n <= Math.min(lines.length, line + 2); n++) out.push({ line: n, text: lines[n - 1], current: n === line });
  return out;
}

// ── Trace evidence ────────────────────────────────────────────────────────

function failingFrameVars(trace?: Trace | null): { vars: Record<string, PyVal>; step: number } | null {
  if (!trace || !trace.steps.length) return null;
  let i = trace.exceptionStep ?? -1;
  if (i < 0) for (let k = trace.steps.length - 1; k >= 0; k--) if (trace.steps[k].ev === "exception") { i = k; break; }
  if (i < 0) return null;
  const f = trace.steps[i].frames[trace.steps[i].frames.length - 1];
  const vars: Record<string, PyVal> = {};
  for (const [n, idx] of Object.entries(f.vars)) { const v = trace.vals[idx]; if (v && v.k !== "func" && v.k !== "class") vars[n] = v; }
  return { vars, step: i };
}

const stateOf = (vars: Record<string, PyVal>) => Object.entries(vars).slice(0, 10).map(([name, v]) => ({ name, value: v.r, type: v.t ?? v.k }));

// ── Rule context ──────────────────────────────────────────────────────────

interface Ctx {
  source: string; type: string; message: string; line?: number; code: string; trace?: Trace | null;
  vars: Record<string, PyVal>; hasState: boolean; tests?: string;
  names: Map<string, number>;
}
type Partial_ = Omit<Diagnosis, "errorType" | "message" | "line" | "codeLine" | "relevantCode" | "stateBefore" | "evidence"> & { evidence?: string[] };

const wordIn = (code: string, w: string) => new RegExp(`(?<![\\w.])${esc(w)}(?!\\w)`).test(code);
const replaceWord = (code: string, from: string, to: string) => code.replace(new RegExp(`(?<![\\w.])${esc(from)}(?!\\w)`), to);
const count = (code: string, w: string) => (code.match(new RegExp(`(?<![\\w.])${esc(w)}(?!\\w)`, "g")) ?? []).length;
const tick = (s: string) => "`" + s + "`";

// ── Syntax and indentation ────────────────────────────────────────────────

function syntaxRule(c: Ctx): Partial_ {
  const msg = c.message, code = c.code;
  const base = { category: "syntax" as const, confidence: "certain" as const };
  let m: RegExpMatchArray | null;
  if (/expected ':'/.test(msg) && /^\s*(if|elif|else|while|for|def|class|try|except|finally|with|async)\b/.test(code)) {
    const hash = code.search(/\s+#/);
    const head = hash >= 0 ? code.slice(0, hash) : code;
    const tail = hash >= 0 ? code.slice(hash) : "";
    if (!head.trimEnd().endsWith(":")) {
      return { ...base, cls: "missing-colon", rootCause: `The statement on line ${c.line} starts a block but does not end with a colon.`, why: "In Python a line that opens a block (if, for, while, def, class, try, with) must end with ':'. Python reached the end of the line while still expecting it.", correctedApproach: "Add ':' at the end of the line, before any comment, then indent the block under it.", prevention: "Type the colon as soon as you write if, for, while or def. Most editors indent the next line automatically after a colon, which is a quick check.", fix: { kind: "replace", line: c.line!, before: code, after: `${head.trimEnd()}:${tail}` } };
    }
  }
  if (/Maybe you meant '==' or ':=' instead of '='/.test(msg)) {
    const m2 = code.match(/^(\s*(?:if|elif|while)\s+)([^=!<>:]+?)\s=\s([^=].*?)(\s*:\s*(?:#.*)?)$/);
    return { ...base, cls: "assign-in-condition", rootCause: `A single '=' was used inside a condition on line ${c.line}.`, why: "'=' stores a value in a name. A condition needs '==' to compare two values.", correctedApproach: "Use '==' to test equality in if, elif and while conditions.", prevention: "Read '=' as 'set to' and '==' as 'is equal to'. A condition always asks a question, so it needs '=='.", fix: m2 ? { kind: "replace", line: c.line!, before: code, after: `${m2[1]}${m2[2]} == ${m2[3]}${m2[4]}` } : undefined };
  }
  if ((m = msg.match(/Missing parentheses in call to 'print'/))) {
    const pm = code.match(/^(\s*)print\s+(.+?)\s*$/);
    return { ...base, cls: "print-statement", rootCause: `print is used as a statement on line ${c.line}, the way Python 2 did.`, why: "In Python 3 print is a function, so its arguments go inside parentheses.", correctedApproach: "Write print(...) with the value inside the parentheses.", prevention: "Always call functions with parentheses in Python 3.", fix: pm && !pm[2].endsWith(",") && !pm[2].startsWith(">>") ? { kind: "replace", line: c.line!, before: code, after: `${pm[1]}print(${pm[2]})` } : undefined };
  }
  if (/unterminated string literal/.test(msg)) return { ...base, cls: "unterminated-string", rootCause: `A string starting on line ${c.line} is never closed on that line.`, why: "A quote opens a string and the same kind of quote must close it on the same line (use triple quotes for text over several lines).", correctedApproach: "Find the opening quote on this line and add the matching closing quote. If the text itself contains a quote, use the other quote type or escape it with a backslash.", prevention: "Type both quotes together and then fill in the text. Syntax colouring in the editor turns the rest of the line into string colour when a quote is open." };
  if ((m = msg.match(/'([(\[{])' was never closed/))) return { ...base, cls: "unclosed-bracket", rootCause: `The ${m[1]} opened on line ${c.line} is never closed.`, why: "Every ( [ { needs its matching ) ] }. Python keeps reading lines as part of the same expression until it finds the closing one, so the error is often reported at a later line.", correctedApproach: `Add the matching closing bracket for the ${m[1]} on line ${c.line}, and check the lines below it for a missing comma or a bracket of the wrong kind.`, prevention: "Type the closing bracket at the same time as the opening one, then write the content between them." };
  if (/unmatched '[)\]}]'/.test(msg)) return { ...base, cls: "unmatched-bracket", rootCause: `A closing bracket on line ${c.line} has no matching opening bracket.`, why: "There is one more ) ] } than ( [ { before this point, or the brackets are of different kinds.", correctedApproach: "Remove the extra closing bracket, or add the missing opening bracket earlier on the line.", prevention: "Count brackets when you edit a long expression; split it over several lines with one operation per line." };
  if (/Perhaps you forgot a comma/.test(msg)) return { ...base, cls: "missing-comma", confidence: "likely", rootCause: `Two values are next to each other on line ${c.line} with no comma between them.`, why: "Items in a list, tuple, dict or argument list must be separated by commas.", correctedApproach: "Put a comma between each pair of items inside the brackets on this line (and on the line above if the brackets span lines).", prevention: "When a list or call spans several lines, end every item line with a comma." };
  if (/'return' outside function/.test(msg)) return { ...base, cls: "return-outside-function", rootCause: `return is used outside a function on line ${c.line}.`, why: "return sends a value back to the caller of a function. At the top level there is no caller.", correctedApproach: "Put the code inside a def block (check the indentation), or use print() to show a value at the top level.", prevention: "Keep the code that uses return indented inside its def." };
  if (/'(break|continue)' outside loop/.test(msg)) return { ...base, cls: "break-outside-loop", rootCause: `${msg.match(/'(break|continue)'/)?.[1] ?? "break/continue"} is used outside a loop on line ${c.line}.`, why: "break and continue only make sense inside a for or while loop.", correctedApproach: "Move the statement inside the loop body, or use return inside a function, or restructure with if/else.", prevention: "Check that break and continue are indented under the loop they belong to." };
  if (/cannot assign to/.test(msg)) return { ...base, cls: "invalid-assignment", rootCause: `The left side of '=' on line ${c.line} is not a name Python can assign to.`, why: "You can assign to a variable, a list item, a dict key or an attribute. A literal, a function call or an expression cannot be on the left of '='.", correctedApproach: "Put the name on the left and the value on the right. If you meant to compare, use '=='.", prevention: "Left of '=' is the name that receives the value; the right side is what is computed." };
  if (/positional argument follows keyword argument/.test(msg)) return { ...base, cls: "argument-order", rootCause: `A positional argument follows a keyword argument in the call on line ${c.line}.`, why: "In a call, all plain arguments must come before any name=value arguments.", correctedApproach: "Reorder the call so positional arguments come first, or pass every argument by keyword.", prevention: "Write calls as f(a, b, key=value)." };
  if (/expected 'except' or 'finally' block/.test(msg)) return { ...base, cls: "try-without-except", rootCause: `A try block on or before line ${c.line} has no except or finally.`, why: "try must be followed by at least one except or finally block.", correctedApproach: "Add an except block (for example except ValueError:) at the same indentation as try.", prevention: "Write try and except together, then fill in the bodies." };
  if (/invalid decimal literal|leading zeros in decimal/.test(msg)) return { ...base, cls: "invalid-number", rootCause: `A number on line ${c.line} has letters or a leading zero in it.`, why: "A name cannot start with a digit, and an integer cannot have leading zeros.", correctedApproach: "Rename the variable so it starts with a letter or underscore, or remove the leading zeros.", prevention: "Start names with a letter or underscore." };
  if (/f-string/.test(msg)) return { ...base, cls: "fstring", rootCause: `An f-string on line ${c.line} is not valid.`, why: "Inside an f-string the braces must hold a complete expression and the quotes inside must differ from the quotes around it.", correctedApproach: "Check each { } holds a valid expression, close every brace, and use a different quote type inside than outside.", prevention: "Keep expressions in f-strings short; compute a value first and put the name in the braces." };
  return { ...base, confidence: "likely", cls: "invalid-syntax", rootCause: `Python could not read line ${c.line}${code ? `: ${code.trim()}` : ""}.`, why: msg ? `Python reports: ${msg}. The caret in the traceback shows where it stopped understanding, which is often just after the real mistake (a missing colon, comma, quote or bracket on this or the line above).` : "The line does not follow Python's grammar.", correctedApproach: "Read the marked line and the one above it. Look for a missing colon, comma, closing bracket or quote, a misspelt keyword, or '=' where '==' is meant.", prevention: "Run the code often while writing, so a mistake is only a few lines away." };
}

function indentationRule(c: Ctx): Partial_ {
  const msg = c.message;
  const base = { category: "syntax" as const, confidence: "certain" as const };
  let m: RegExpMatchArray | null;
  if ((m = msg.match(/expected an indented block after '?([\w ]+?)'? (?:statement|definition) on line (\d+)/)) || /expected an indented block/.test(msg)) {
    const opener = m ? Number(m[2]) : undefined;
    return { ...base, cls: "missing-indent", rootCause: `The block opened${opener ? ` on line ${opener}` : ""} has no indented line under it.`, why: "After a line ending in ':' Python needs at least one statement indented further than that line. That indentation is how Python knows what belongs to the block.", correctedApproach: `Indent the statement(s) under line ${opener ?? c.line} by 4 spaces. If the block should do nothing yet, put the word pass on its own indented line.`, prevention: "Let the editor indent after a colon, and always use 4 spaces (never tabs mixed with spaces)." };
  }
  if (/unindent does not match any outer indentation level/.test(msg)) return { ...base, cls: "bad-dedent", rootCause: `Line ${c.line} is indented to a level that no enclosing block uses.`, why: "When a line moves back to the left, it must line up exactly with an earlier line of an enclosing block.", correctedApproach: "Make this line start in the same column as the statement of the block it should belong to (all blocks use multiples of 4 spaces).", prevention: "Use 4 spaces for every level, and let the editor convert Tab to spaces." };
  if (/unexpected indent/.test(msg)) return { ...base, cls: "unexpected-indent", rootCause: `Line ${c.line} is indented more than the line before it, but no block was opened.`, why: "Indentation only increases right after a line ending in ':'. Extra spaces anywhere else are an error.", correctedApproach: "Remove the extra leading spaces so the line lines up with the statement above, or add the missing line that opens a block (ending in ':').", prevention: "Never add spaces at the start of a line unless the line above ends in ':'." };
  if (/inconsistent use of tabs|TabError/.test(msg) || c.type === "TabError") return { ...base, cls: "tabs-spaces", rootCause: "Tabs and spaces are both used to indent.", why: "Python cannot tell how wide a tab is compared with spaces, so mixed indentation is ambiguous.", correctedApproach: "Replace every tab at the start of a line with 4 spaces.", prevention: "Use spaces only." };
  return { ...base, confidence: "likely", cls: "indentation", rootCause: `The indentation on line ${c.line} is not valid.`, why: msg || "Indentation decides which block a line belongs to.", correctedApproach: "Check the marked line lines up with the block it belongs to, using 4 spaces per level.", prevention: "Use 4 spaces per level, never tabs." };
}

// ── Name errors ───────────────────────────────────────────────────────────

function nameRule(c: Ctx): Partial_ {
  const base = { category: "runtime errors" as const };
  const um = c.message.match(/(?:cannot access local variable|local variable) '(\w+)'/);
  if (c.type === "UnboundLocalError" || um) {
    const name = um?.[1] ?? "";
    return { ...base, category: "functions", confidence: "certain", cls: "unbound-local", rootCause: `${tick(name)} is read on line ${c.line} before it has a value inside this function.`, why: `Because ${tick(name)} is assigned somewhere in this function, Python treats it as a local variable of the function everywhere in it. Reading it before the assignment runs fails, even if a variable with the same name exists outside.`, correctedApproach: `Give ${tick(name)} a value before it is read (for example pass it in as a parameter or set it at the top of the function). Only use 'global ${name}' if you really need to change the outside variable.`, prevention: "Pass values into functions as parameters and return results, instead of relying on outside variables." };
  }
  const name = c.message.match(/name '([^']+)' is not defined/)?.[1];
  if (!name) return { ...base, confidence: "likely", cls: "name-error", rootCause: c.message, why: "A name was used that Python does not know.", correctedApproach: "Check the spelling and that the name is defined before this line.", prevention: "Define every name before you use it." };
  const evidence: string[] = [];
  const LITERALS: Record<string, string> = { true: "True", false: "False", none: "None", null: "None" };
  if (LITERALS[name] && !c.names.has(name)) {
    return { ...base, confidence: "certain", cls: "name-typo", rootCause: `${tick(name)} is not a Python name. The constant is spelled ${tick(LITERALS[name])}.`, why: "True, False and None start with a capital letter in Python. Other spellings are treated as ordinary variable names that were never defined.", correctedApproach: `Write ${LITERALS[name]} with a capital first letter.`, prevention: "Python's three constants True, False and None are always capitalised.", fix: c.line ? { kind: "replace", line: c.line, before: c.code, after: replaceWord(c.code, name, LITERALS[name]) } : undefined };
  }
  if (STD_MODULES.includes(name) && !c.names.has(name)) {
    return { ...base, confidence: "certain", cls: "missing-import", rootCause: `${tick(name)} is a standard module but it was never imported.`, why: "A module's name only exists in your program after an import statement.", correctedApproach: `Add ${tick(`import ${name}`)} at the top of the file.`, prevention: "Put imports at the top of the file as soon as you use a module.", fix: { kind: "insert", line: 1, before: "", after: `import ${name}` } };
  }
  const cand = closest(name, [...c.names.keys(), ...BUILTINS]);
  if (cand && c.line && count(c.code, name) === 1) {
    evidence.push(`${tick(cand.word)} is ${c.names.has(cand.word) ? `defined on line ${c.names.get(cand.word)}` : "a Python built-in"}.`);
    return { ...base, confidence: "certain", cls: "name-typo", rootCause: `${tick(name)} on line ${c.line} is not defined, and it is one letter away from ${tick(cand.word)}.`, why: "Python names are spelled and capitalised exactly. A name that differs by even one letter is a different (undefined) name.", correctedApproach: `Use the exact spelling ${tick(cand.word)}.`, prevention: "Copy a name instead of retyping it, or let the editor auto-complete it.", evidence, fix: { kind: "replace", line: c.line, before: c.code, after: replaceWord(c.code, name, cand.word) } };
  }
  const defLine = c.names.get(name);
  if (defLine !== undefined && c.line && defLine > c.line) {
    return { ...base, confidence: "certain", cls: "used-before-definition", rootCause: `${tick(name)} is used on line ${c.line} but only defined on line ${defLine}.`, why: "Python runs a file from top to bottom. A name only exists after the line that defines it has run.", correctedApproach: `Move the definition of ${tick(name)} above the line that uses it (for a function, define it before the code that calls it).`, prevention: "Define functions and variables before the code that uses them; put calls at the bottom.", evidence: [`${tick(name)} is first defined on line ${defLine}.`] };
  }
  const inner = definedInsideFunctionOnly(c.source, name);
  if (inner) return { ...base, category: "functions", confidence: "likely", cls: "scope", rootCause: `${tick(name)} is created inside ${tick(inner.fn + "()")} (line ${inner.line}) and is not visible outside it.`, why: "A variable made inside a function exists only while that function runs. Code outside the function (or in another function) cannot see it.", correctedApproach: `Return ${tick(name)} from the function and store the result where you need it, or pass it as a parameter.`, prevention: "Use return to hand values out of a function.", evidence: [`${tick(name)} is assigned inside ${tick(inner.fn + "()")}.`] };
  return { ...base, confidence: "likely", cls: "undefined-name", rootCause: `${tick(name)} on line ${c.line} was never defined or imported.`, why: "Python looks for the name in the current function, then the file, then the built-ins, and finds nothing.", correctedApproach: `Check the spelling of ${tick(name)}, define it (name = value) before this line, or import it if it comes from a module.`, prevention: "Define every name before using it, and import what you need at the top." };
}

function definedInsideFunctionOnly(source: string, name: string): { fn: string; line: number } | null {
  const { lines } = readLogicalLines(source);
  let fn: { name: string; indent: number } | null = null;
  let found: { fn: string; line: number } | null = null;
  for (const l of lines) {
    if (fn && l.indent <= fn.indent) fn = null;
    const d = l.text.match(/^(?:async\s+)?def\s+(\w+)/);
    if (d) { fn = { name: d[1], indent: l.indent }; continue; }
    if (new RegExp(`^${esc(name)}\\s*(?::[^=]+)?=(?!=)`).test(l.text)) {
      if (!fn) return null; // a module-level assignment exists
      found ??= { fn: fn.name, line: l.start };
    }
  }
  return found;
}

// ── Type errors ───────────────────────────────────────────────────────────

function findDef(source: string, name: string): { line: number; text: string; params: string; indent: number; inClass: boolean; decorated: boolean } | null {
  const { lines } = readLogicalLines(source);
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const m = l.text.match(new RegExp(`^(?:async\\s+)?def\\s+${esc(name)}\\s*\\(([\\s\\S]*)\\)\\s*(?:->[^:]+)?:$`));
    if (!m) continue;
    let inClass = false;
    for (let j = k - 1; j >= 0; j--) if (lines[j].indent < l.indent) { inClass = /^class\b/.test(lines[j].text); break; }
    const prev = lines[k - 1];
    return { line: l.start, text: l.text, params: m[1], indent: l.indent, inClass, decorated: !!prev && prev.indent === l.indent && prev.text.startsWith("@") };
  }
  return null;
}

/** A function whose body contains no return or yield. */
export function functionsWithoutReturn(source: string): { name: string; line: number }[] {
  const { lines } = readLogicalLines(source);
  const out: { name: string; line: number }[] = [];
  for (let k = 0; k < lines.length; k++) {
    const m = lines[k].text.match(/^(?:async\s+)?def\s+(\w+)/);
    if (!m) continue;
    let hasValue = false, body = 0, raisesOnly = false;
    for (let j = k + 1; j < lines.length && lines[j].indent > lines[k].indent; j++) {
      body++;
      if (/^(return|yield)\b|\byield\b/.test(lines[j].text)) hasValue = true;
      if (/^raise\b/.test(lines[j].text)) raisesOnly = true;
    }
    if (!hasValue && body > 0 && !raisesOnly) out.push({ name: m[1], line: lines[k].start });
  }
  return out;
}

function typeRule(c: Ctx): Partial_ {
  const msg = c.message, code = c.code;
  let m: RegExpMatchArray | null;
  const fnArgs = msg.match(/^([\w.]+)\(\) (takes|missing|got)/);
  if (fnArgs || /positional argument|unexpected keyword argument|keyword argument/.test(msg)) {
    const name = (fnArgs?.[1] ?? "").split(".").pop() ?? "";
    const def = name ? findDef(c.source, name) : null;
    const ev = def ? [`${tick(name)} is defined on line ${def.line} as ${tick(def.text.replace(/:$/, ""))}.`] : [];
    const base = { category: "functions" as const, confidence: "certain" as const, evidence: ev };
    if (def && def.inClass && !def.decorated && def.params.trim() === "" && /takes 0 positional arguments but 1 was given/.test(msg)) {
      return { ...base, cls: "missing-self", rootCause: `The method ${tick(name)} (line ${def.line}) has no parameters, but Python passes the object as the first argument.`, why: "When you call obj.method(), Python passes obj as the first argument automatically. A method must have a first parameter (named self by convention) to receive it.", correctedApproach: `Add self as the first parameter of ${tick(name)}.`, prevention: "Every method in a class takes self first (unless it is marked @staticmethod).", fix: (() => { const phys = lineAt(c.source, def.line) ?? ""; return def.text.includes("\n") || !/\(\s*\)/.test(phys) ? undefined : { kind: "replace" as const, line: def.line, before: phys, after: phys.replace(/\(\s*\)/, "(self)") }; })() };
    }
    if ((m = msg.match(/got an unexpected keyword argument '(\w+)'/))) return { ...base, cls: "wrong-arguments", rootCause: `The call passes ${tick(m[1] + "=")} but ${tick(name)} has no parameter with that name${def ? ` (its parameters: ${def.params.trim() || "none"})` : ""}.`, why: "A keyword argument must match one of the parameter names in the function's def line exactly.", correctedApproach: `Use one of the real parameter names${def ? ` (${def.params.trim() || "none"})` : ""}, or add the parameter to the def line if the function should accept it.`, prevention: "Look at the def line when you write a call. Calling with the same names in the same order avoids this." };
    if ((m = msg.match(/missing (\d+) required (?:positional|keyword-only) arguments?: (.+)$/))) return { ...base, cls: "wrong-arguments", rootCause: `The call to ${tick(name)} leaves out ${m[1]} required argument${m[1] === "1" ? "" : "s"}: ${m[2]}.`, why: `${tick(name)} needs a value for every parameter that has no default${def ? ` (${def.params.trim()})` : ""}.`, correctedApproach: "Pass a value for each missing argument, or give the parameter a default value in the def line if it is optional.", prevention: "Count the parameters in the def line and the arguments in the call." };
    if ((m = msg.match(/takes (?:from )?(\d+)(?: to \d+)? positional arguments? but (\d+) (?:was|were) given/))) return { ...base, cls: "wrong-arguments", rootCause: `${tick(name)} accepts ${m[1]} argument${m[1] === "1" ? "" : "s"} but the call gives ${m[2]}.`, why: `The number of values in the call must match the parameters in the def line${def ? ` (${def.params.trim() || "none"})` : ""}.`, correctedApproach: `Pass exactly ${m[1]} argument${m[1] === "1" ? "" : "s"}, or change the def line to accept ${m[2]}.${def && def.inClass ? " Inside a class, self counts as one parameter and is passed automatically." : ""}`, prevention: "Check the number of arguments against the def line whenever you change either." };
    return { ...base, cls: "wrong-arguments", rootCause: msg, why: "The arguments in the call do not match the parameters of the function.", correctedApproach: "Compare the call with the def line: the same number of values, in the same order, with matching keyword names.", prevention: "Read the def line when you write a call." };
  }
  if (/'NoneType'|NoneType/.test(msg)) return noneRule(c);
  if ((m = msg.match(/can only concatenate (\w+) \(not "(\w+)"\) to (\w+)|unsupported operand type\(s\) for ([^:]+): '(\w+)' and '(\w+)'|must be (\w+), not (\w+)/))) {
    const [a, b] = m[1] ? [m[3], m[2]] : m[4] ? [m[5], m[6]] : [m[7], m[8]];
    const op = m[4] ?? "+";
    const stateNote = c.hasState ? Object.entries(c.vars).filter(([n]) => wordIn(code, n)).map(([n, v]) => `${n} is a ${v.t ?? v.k} (${v.r})`) : [];
    return { category: "data types", confidence: "certain", cls: "type-mismatch", rootCause: `Line ${c.line} uses ${tick(op.trim())} on a ${a} and a ${b}, which Python does not combine.`, why: `Python does not guess how to mix types: ${a} ${op.trim() === "+" ? "+" : op.trim()} ${b} has no meaning, so it stops instead of converting silently.`, correctedApproach: a === "str" || b === "str" ? "Convert the number to text with str(...) (or use an f-string such as f\"Total: {total}\"), or convert the text to a number with int(...) or float(...) if you meant arithmetic. Decide which one you mean." : "Convert one of the values so both have the same type (int(...), float(...) or str(...)), depending on what you want to compute.", prevention: "Remember that input() and text read from files are strings. Convert to int or float once, when the value comes in.", evidence: stateNote };
  }
  if ((m = msg.match(/'(<|>|<=|>=)' not supported between instances of '(\w+)' and '(\w+)'/))) return { category: "data types", confidence: "certain", cls: "type-mismatch", rootCause: `Line ${c.line} compares a ${m[2]} with a ${m[3]} using ${tick(m[1])}.`, why: "Ordering comparisons only work between values of comparable types (number with number, text with text).", correctedApproach: "Convert both sides to the same type first (for example int(text)), and check that none of the values is None.", prevention: "Convert values to numbers where they enter the program.", evidence: [] };
  if ((m = msg.match(/'(\w+)' object is not (subscriptable|iterable|callable)/))) {
    const [, t, what] = m;
    if (what === "callable") {
      const shadow = [...BUILTINS, "list", "dict", "str", "sum", "max", "min", "len", "input", "id", "type", "set", "range"].find((b) => new RegExp(`^\\s*${b}\\s*=(?!=)`, "m").test(c.source) && wordIn(code, b));
      return { category: "data types", confidence: shadow ? "certain" : "likely", cls: shadow ? "shadowed-builtin" : "not-callable", rootCause: shadow ? `${tick(shadow)} was assigned a value earlier in the file, so it no longer means the built-in function; line ${c.line} then calls it.` : `Line ${c.line} calls (uses parentheses after) a ${t} value, which is not a function.`, why: shadow ? `After ${tick(shadow + " = ...")} the name ${tick(shadow)} refers to a ${t}, and a ${t} cannot be called.` : "Parentheses after a name mean 'call this'. Only functions (and classes) can be called.", correctedApproach: shadow ? `Rename your variable so it does not reuse the built-in name ${tick(shadow)} (for example ${tick(shadow + "_value")}).` : "Remove the parentheses if you wanted the value, or add the missing operator (such as * or +) between two parenthesised parts.", prevention: "Never use a built-in name (list, dict, sum, max, min, str, id, type) as a variable name.", evidence: [] };
    }
    if (what === "subscriptable") return { category: "data types", confidence: "certain", cls: "not-subscriptable", rootCause: `Line ${c.line} uses [ ] on a ${t} value, which has no items to look up.`, why: `Square brackets read an item from a list, tuple, dict or string. A ${t} is not one of those.`, correctedApproach: `Check which variable on line ${c.line} holds a ${t} and why it is not the list or dict you expected (a function that returned a number instead of a list, or a variable overwritten earlier).`, prevention: "Print or trace the variable before indexing it to confirm its type.", evidence: [] };
    return { category: "data types", confidence: "certain", cls: "not-iterable", rootCause: `Line ${c.line} loops over (or unpacks) a ${t} value.`, why: `for loops and unpacking need something with items: list, tuple, dict, set or string. A ${t} is a single value.`, correctedApproach: t === "int" ? "To repeat n times use for i in range(n). To loop over digits convert with str(n)." : "Loop over a collection, not a single value; check the variable really holds the collection you expect.", prevention: "Use range(n) when you need a count, and check types before looping.", evidence: [] };
  }
  if ((m = msg.match(/'(\w+)' object does not support item assignment/))) return { category: "data types", confidence: "certain", cls: "immutable-assign", rootCause: `Line ${c.line} assigns to an item of a ${m[1]}, which cannot be changed in place.`, why: m[1] === "str" ? "Strings are immutable: characters cannot be replaced one by one." : "Tuples are immutable: their items cannot be replaced.", correctedApproach: m[1] === "str" ? "Build a new string (use slicing, replace(), or turn the text into a list with list(text), change it, then ''.join(...))." : "Convert to a list with list(t), change it, then back with tuple(...) if needed; or build a new tuple.", prevention: "Use a list when you need to change items; use str methods to build new text.", evidence: [] };
  if ((m = msg.match(/(list|tuple|string) (?:indices|index) must be integers(?: or slices)?, not (\w+)/))) {
    const slash = code.match(/\[([^\]]*?)\s\/\s([^\]]*?)\]/);
    return { category: "data types", confidence: slash ? "certain" : "likely", cls: "bad-index-type", rootCause: `The index on line ${c.line} is a ${m[2]}, but a ${m[1]} must be indexed with an integer.`, why: m[2] === "float" ? "A float such as 2.0 is not an integer position, even when it looks whole. The '/' operator always returns a float." : m[2] === "str" ? "Text cannot be an index of a list or string; that is what dictionaries are for." : "Positions are whole numbers.", correctedApproach: m[2] === "float" ? "Use // (integer division) or int(...) to get a whole number for the index." : "Convert the index with int(...), or use a dict if you wanted to look up by name.", prevention: "Use // when a division result will be used as a position or a count.", evidence: [], fix: slash && c.line ? { kind: "replace", line: c.line, before: code, after: code.replace(/(\[[^\]]*?)\s\/\s([^\]]*?\])/, "$1 // $2") } : undefined };
  }
  if ((m = msg.match(/'float' object cannot be interpreted as an integer/))) {
    const r = code.match(/range\(([^()]*?)\s\/\s([^()]*?)\)/);
    return { category: "data types", confidence: r ? "certain" : "likely", cls: "bad-index-type", rootCause: `A float was passed where a whole number is required on line ${c.line}.`, why: "range() and similar functions need integers. '/' always produces a float, even for 4 / 2 (which is 2.0).", correctedApproach: "Use // (floor division) or wrap the value in int(...).", prevention: "Use // when the result must be a whole number.", evidence: [], fix: r && c.line ? { kind: "replace", line: c.line, before: code, after: code.replace(/(range\([^()]*?)\s\/\s([^()]*?\))/, "$1 // $2") } : undefined };
  }
  if ((m = msg.match(/unhashable type: '(\w+)'/))) return { category: "collections", confidence: "certain", cls: "unhashable", rootCause: `Line ${c.line} uses a ${m[1]} as a dictionary key or set item.`, why: `Dict keys and set items must not change, so Python only accepts immutable values. A ${m[1]} can be changed, so it is rejected.`, correctedApproach: `Use a tuple instead (tuple(your_${m[1]})), or use one of its items as the key.`, prevention: "Use strings, numbers or tuples as dict keys.", evidence: [] };
  if ((m = msg.match(/object of type '(\w+)' has no len\(\)/))) return { category: "data types", confidence: "certain", cls: "no-len", rootCause: `len() was called on a ${m[1]} on line ${c.line}.`, why: "len() counts the items of a list, string, dict, set or tuple. A single number (or None) has no length.", correctedApproach: m[1] === "int" ? "If you want the number of digits, use len(str(n)). Otherwise check why the variable is a number instead of a collection." : "Check why the variable is not the collection you expected.", prevention: "Check types when a function returns different kinds of values.", evidence: [] };
  if (/can't multiply sequence by non-int/.test(msg)) return { category: "data types", confidence: "certain", cls: "type-mismatch", rootCause: `A text or list was multiplied by a non-integer on line ${c.line}.`, why: "'abc' * 3 repeats the text, which only makes sense for a whole number of repeats. Multiplying text by a text or float is not defined.", correctedApproach: "Convert the number of repeats with int(...), or convert the text to a number with float(...) if you meant arithmetic.", prevention: "Convert input text to numbers before arithmetic.", evidence: [] };
  return { category: "data types", confidence: "likely", cls: "type-error", rootCause: `Line ${c.line}: ${msg}`, why: "An operation received a value of a type it does not support.", correctedApproach: "Check the types of the values on this line (print them or look at the variable panel) and convert where needed.", prevention: "Convert values to the type you need where they enter the program.", evidence: [] };
}

function noneRule(c: Ctx): Partial_ {
  const code = c.code;
  const ev: string[] = [];
  const noneVars = Object.entries(c.vars).filter(([n, v]) => v.k === "none" && wordIn(code, n)).map(([n]) => n);
  if (noneVars.length) ev.push(`In the trace, ${noneVars.map(tick).join(" and ")} ${noneVars.length === 1 ? "is" : "are"} None just before this line.`);
  const noRet = functionsWithoutReturn(c.source);
  const useLine = c.line;
  // Find the line that assigned the None: a call to a function without return, or an in-place method, earlier in the source.
  let origin: { line: number; text: string; why: string } | null = null;
  const lines = c.source.split("\n");
  for (let n = 1; n <= lines.length && !origin; n++) {
    const t = lines[n - 1];
    const ip = t.match(/^\s*(\w+)\s*=\s*([\w.]+)\.(sort|append|extend|reverse|insert|remove|clear|update)\(/);
    if (ip && (noneVars.includes(ip[1]) || (!noneVars.length && wordIn(code, ip[1])))) origin = { line: n, text: t.trim(), why: `${tick(ip[2] + "." + ip[3] + "()")} changes the object in place and returns None, so ${tick(ip[1])} became None.` };
    const fc = t.match(/^\s*(\w+)\s*=\s*(\w+)\(/);
    if (!origin && fc && noRet.some((f) => f.name === fc[2]) && (noneVars.includes(fc[1]) || (!noneVars.length && wordIn(code, fc[1])))) origin = { line: n, text: t.trim(), why: `${tick(fc[2] + "()")} has no return statement, so it returns None, and ${tick(fc[1])} received that None.` };
  }
  if (origin) ev.push(`Line ${origin.line}: ${tick(origin.text)}. ${origin.why}`);
  return {
    category: origin && /no return statement/.test(origin.why) ? "functions" : "data types", confidence: origin || noneVars.length ? "certain" : "likely", cls: "unexpected-none",
    rootCause: origin ? `A value that is None reached line ${useLine}. ${origin.why}` : `A value that is None reached line ${useLine}, where an operation needs a real value.`,
    why: "None means 'no value'. Functions that do not return anything, in-place methods (sort, append, reverse...), dict.get() on a missing key and failed searches all give None. Using None like a list, string or number then fails.",
    correctedApproach: origin ? (/in place/.test(origin.why) ? "Call the method on its own line (items.sort()) and keep using the same variable, or use the version that returns a new value (sorted(items))." : "Add a return statement to the function so it hands the result back.") : "Find where the variable got its value, make sure that function returns a result on every path, and check for None before using it (if value is not None:).",
    prevention: "Know which calls return None: sort, append, reverse, print and any function without return. Never assign their result.", evidence: ev,
  };
}

// ── Value errors ──────────────────────────────────────────────────────────

function valueRule(c: Ctx): Partial_ {
  const msg = c.message;
  let m: RegExpMatchArray | null;
  const base = { category: "data types" as const, confidence: "certain" as const, evidence: [] as string[] };
  if ((m = msg.match(/invalid literal for (int|float)\(\)(?: with base \d+)?: (.+)$/)) || (m = msg.match(/could not convert string to (float|int): (.+)$/))) {
    const fn = m[1], lit = m[2];
    const raw = lit.slice(1, -1);
    const why = raw === "" ? "The text is empty: there is nothing to convert." : /^-?\d+\.\d+$/.test(raw) && fn === "int" ? "int() only accepts whole numbers; '3.5' has a decimal point." : /\s/.test(raw.trim()) || /\\n/.test(raw) ? "The text has spaces or a newline inside it." : "The text is not a number (it has letters or symbols).";
    return { ...base, cls: "bad-conversion", rootCause: `${tick(fn + "(" + lit + ")")} on line ${c.line} was given text that is not a valid ${fn}.`, why, correctedApproach: raw === "" ? "Check for an empty value before converting (if text:), or use a default." : /^-?\d+\.\d+$/.test(raw) && fn === "int" ? "Convert with float(...) first, then int(...) if you need a whole number." : "Validate or clean the text first (strip() spaces), and wrap the conversion in try/except ValueError if the data may be bad.", prevention: "Never assume input text is a number; convert in one place and handle ValueError." };
  }
  if ((m = msg.match(/not enough values to unpack \(expected (\d+), got (\d+)\)/))) return { ...base, cls: "unpack-count", category: "collections", rootCause: `Line ${c.line} unpacks into ${m[1]} names but the value has only ${m[2]} item${m[2] === "1" ? "" : "s"}.`, why: "Unpacking (a, b = value) needs exactly as many names as items.", correctedApproach: `Make the number of names equal the number of items (${m[2]}), or check the length first. Printing the value shows what it really holds.`, prevention: "Check len(value) when the shape of the data is not guaranteed." };
  if ((m = msg.match(/too many values to unpack \(expected (\d+)(?:, got (\d+))?\)/))) return { ...base, cls: "unpack-count", category: "collections", rootCause: `Line ${c.line} unpacks into ${m[1]} names but the value has ${m[2] ?? "more"} items.`, why: "Unpacking needs exactly as many names as items.", correctedApproach: `Add names for the extra items, or use a starred name (first, *rest = value), or select the items you need by index.`, prevention: "Know the length of what you unpack." };
  if (/math domain error|expected a (?:non)?(?:negative|positive) input/.test(msg)) return { ...base, cls: "math-domain", rootCause: `A math function on line ${c.line} was given a number outside its domain.`, why: "For example math.sqrt of a negative number, or math.log of 0 or a negative number, has no real result.", correctedApproach: "Check the value before the call (if x >= 0:), or use abs()/max(x, 0) if that is what you mean.", prevention: "Guard math functions against values outside their domain." };
  if (/(list\.remove|remove)\(x\): x not in list|x not in list/.test(msg)) return { ...base, category: "collections", cls: "remove-missing", rootCause: `remove() on line ${c.line} was asked to remove a value that is not in the list.`, why: "list.remove(value) raises ValueError when the value is not found (it never ignores a missing value).", correctedApproach: "Check first with if value in items: items.remove(value), or use a set and discard(value).", prevention: "Test membership before removing." };
  if (/arg is an empty sequence|iterable argument is empty/.test(msg)) return { ...base, category: "collections", cls: "empty-sequence", rootCause: `max() or min() on line ${c.line} was given an empty collection.`, why: "There is no largest or smallest item in nothing.", correctedApproach: "Check if items: first, or pass a default: max(items, default=0).", prevention: "Think about empty input for every function that takes a collection." };
  if (/substring not found/.test(msg)) return { ...base, cls: "substring-missing", rootCause: `index() on line ${c.line} looked for text that is not in the string.`, why: "str.index raises ValueError when the text is missing; str.find returns -1 instead.", correctedApproach: "Use text.find(sub) and check for -1, or check sub in text first.", prevention: "Use find() or in when the text might not be there." };
  if (/time data .* does not match format/.test(msg)) return { ...base, cls: "date-format", rootCause: `A date string on line ${c.line} does not match the format given.`, why: "The format codes (%Y, %m, %d...) must describe the text exactly, including separators.", correctedApproach: "Compare the date text with the format string character by character.", prevention: "Print the text you are parsing before choosing a format." };
  return { ...base, confidence: "likely", cls: "value-error", rootCause: `Line ${c.line}: ${msg}`, why: "A function received a value of the right type but an unacceptable value.", correctedApproach: "Print the value just before this line to see what it really is, then validate it first.", prevention: "Validate values where they enter the program." };
}

// ── Collections ───────────────────────────────────────────────────────────

function indexRule(c: Ctx): Partial_ {
  const code = c.code, msg = c.message;
  const base = { category: "collections" as const };
  const ev: string[] = [];
  // Off-by-one in a loop header: for i in range(len(x) + 1) ... x[i]
  const lines = c.source.split("\n");
  if (c.line) {
    for (let n = c.line - 1; n >= 1; n--) {
      const h = lines[n - 1];
      if (!h.trim() || indentOf(h) >= indentOf(code)) continue;
      const f = h.match(/^(\s*)for\s+(\w+)\s+in\s+range\(\s*(0\s*,\s*)?len\((\w+)\)\s*\+\s*1\s*\)\s*:/);
      if (f && new RegExp(`(?<![\\w.])${esc(f[4])}\\[\\s*${esc(f[2])}\\s*\\]`).test(code)) {
        ev.push(`Line ${n}: ${tick(h.trim())}`);
        return { ...base, category: "control flow", confidence: "certain", cls: "off-by-one-range", rootCause: `The loop on line ${n} counts ${tick(f[2])} up to len(${f[4]}), but the last valid index of ${tick(f[4])} is len(${f[4]}) - 1.`, why: `range(len(x) + 1) produces one number too many. On the last pass the index equals the length, and ${tick(f[4] + "[" + f[2] + "]")} on line ${c.line} reads past the end.`, correctedApproach: `Use ${tick(`range(len(${f[4]}))`)}. range(n) already stops at n - 1.`, prevention: "range(len(x)) visits every valid index exactly once. Adding or subtracting 1 should always be a deliberate decision.", evidence: ev, fix: { kind: "replace", line: n, before: h, after: h.replace(/range\(\s*(0\s*,\s*)?len\((\w+)\)\s*\+\s*1\s*\)/, (_m, z: string | undefined, nme: string) => `range(${z ?? ""}len(${nme}))`) } };
      }
      const w = h.match(/^(\s*)while\s+(\w+)\s*<=\s*len\((\w+)\)\s*:/);
      if (w && new RegExp(`(?<![\\w.])${esc(w[3])}\\[\\s*${esc(w[2])}\\s*\\]`).test(code)) {
        ev.push(`Line ${n}: ${tick(h.trim())}`);
        return { ...base, category: "control flow", confidence: "certain", cls: "wrong-loop-condition", rootCause: `The condition on line ${n} (${tick(w[2] + " <= len(" + w[3] + ")")}) lets ${tick(w[2])} reach len(${w[3]}), which is one past the last index.`, why: `Indexes of ${tick(w[3])} run from 0 to len(${w[3]}) - 1, so ${tick(w[3] + "[" + w[2] + "]")} on line ${c.line} fails once ${tick(w[2])} equals the length.`, correctedApproach: `Use ${tick(`${w[2]} < len(${w[3]})`)} so the loop stops before the index leaves the list.`, prevention: "When indexing, the loop condition must be strictly less than the length.", evidence: ev, fix: { kind: "replace", line: n, before: h, after: h.replace(`${w[2]} <= len(`, `${w[2]} < len(`) } };
      }
    }
  }
  // Real lengths from the trace.
  if (c.hasState) {
    for (const m of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)\[([^\]\[]+)\]/g)) {
      const v = c.vars[m[1]];
      if (!v || v.n === undefined) continue;
      const idxExpr = m[2].trim();
      const iv = /^-?\d+$/.test(idxExpr) ? Number(idxExpr) : (() => { const x = c.vars[idxExpr]; return x && x.k === "int" ? Number(x.r) : undefined; })();
      if (iv === undefined) { ev.push(`${tick(m[1])} has ${v.n} item${v.n === 1 ? "" : "s"}${v.n ? ` (valid indexes 0 to ${v.n - 1})` : ""}.`); continue; }
      if (iv >= v.n || iv < -v.n) {
        ev.push(`${tick(m[1])} has ${v.n} item${v.n === 1 ? "" : "s"}${v.n ? ` (valid indexes 0 to ${v.n - 1}, or -1 to -${v.n})` : ""}, and the index ${tick(idxExpr)} is ${iv}.`);
        break;
      }
    }
  }
  if (/pop from empty list/.test(msg)) return { ...base, confidence: "certain", cls: "empty-pop", rootCause: `pop() on line ${c.line} was called on an empty list.`, why: "There is no last item to remove from a list with nothing in it.", correctedApproach: "Check if items: before items.pop(), or stop the loop when the list is empty.", prevention: "Handle the empty case for every pop, [0] and [-1].", evidence: ev };
  const empty = c.hasState && Object.entries(c.vars).some(([n, v]) => v.n === 0 && wordIn(code, n));
  const lenIdx = code.match(/(\w+)\[\s*len\(\s*\1\s*\)\s*\]/);
  if (lenIdx) return { ...base, category: "control flow", confidence: "certain", cls: "off-by-one", rootCause: `Line ${c.line} reads ${tick(lenIdx[0])}: the index len(${lenIdx[1]}) is always one past the last item.`, why: `A list with n items has indexes 0 to n - 1. Index n does not exist.`, correctedApproach: `For the last item use ${tick(lenIdx[1] + "[-1]")} (or ${tick(`${lenIdx[1]}[len(${lenIdx[1]}) - 1]`)}). To add an item use append().`, prevention: "The last index is length minus one. Use [-1] for the last item.", evidence: ev };
  return { ...base, confidence: empty || ev.length ? "certain" : "likely", cls: "index-out-of-range", rootCause: empty ? `Line ${c.line} indexes a collection that is empty.` : `The index used on line ${c.line} is outside the collection.`, why: "A list or string with n items has valid indexes 0 to n - 1 (or -1 to -n). Anything else raises IndexError.", correctedApproach: "Check the length before indexing (if len(items) > i:), handle the empty case, and check the loop bounds that produce the index (off-by-one).", prevention: "Think about empty input and the last element for every index you write.", evidence: ev };
}

function keyRule(c: Ctx): Partial_ {
  const code = c.code, key = c.message.trim();
  const base = { category: "collections" as const };
  const ev: string[] = [];
  const dictsOnLine = Object.entries(c.vars).filter(([n, v]) => v.k === "dict" && wordIn(code, n));
  for (const [n, v] of dictsOnLine) {
    const keys = (v.items ?? []).filter((_, i) => i % 2 === 0).map((i) => c.trace?.vals[i]?.r ?? "");
    ev.push(`${tick(n)} holds ${v.n} key${v.n === 1 ? "" : "s"}: ${keys.slice(0, 8).join(", ")}${v.more ? ", ..." : ""}.`);
    const norm = (s: string) => s.replace(/^['"]|['"]$/g, "").trim().toLowerCase();
    const near = keys.find((k) => norm(k) === norm(key) && k !== key);
    if (near) ev.push(`The key ${tick(near)} exists, but the code looked for ${tick(key)} (case, spaces or quotes differ).`);
  }
  const inc = code.match(/^(\s*)(\w+)\[(.+?)\]\s*([+-])=\s*(\d+)\s*$/);
  if (inc) {
    return { ...base, confidence: "certain", cls: "key-missing-counter", rootCause: `Line ${c.line} updates ${tick(inc[2] + "[" + inc[3] + "]")} but that key has not been added yet.`, why: "Reading a missing key from a dict raises KeyError. An update like += reads the current value first, so the very first time a key is seen there is nothing to read.", correctedApproach: `Start from a default: ${tick(`${inc[2]}[${inc[3]}] = ${inc[2]}.get(${inc[3]}, 0) ${inc[4]} ${inc[5]}`)}. (collections.defaultdict(int) or Counter do the same.)`, prevention: "When counting or grouping, give missing keys a starting value with .get(key, 0), setdefault or defaultdict.", evidence: ev, fix: c.line ? { kind: "replace", line: c.line, before: code, after: `${inc[1]}${inc[2]}[${inc[3]}] = ${inc[2]}.get(${inc[3]}, 0) ${inc[4]} ${inc[5]}` } : undefined };
  }
  return { ...base, confidence: ev.length ? "certain" : "likely", cls: "key-missing", rootCause: `The key ${tick(key)} used on line ${c.line} is not in the dictionary.`, why: "dict[key] raises KeyError when the key is absent. Keys must match exactly: 'Name' and 'name', '1' and 1, and 'a ' and 'a' are all different keys.", correctedApproach: "Check the key spelling, case and type. Use .get(key) (returns None) or .get(key, default) when the key may be absent, or test key in d first. When counting, start from a default.", prevention: "Treat missing keys as normal for real data: use .get() with a default.", evidence: ev };
}

// ── Attribute errors ──────────────────────────────────────────────────────

function attrRule(c: Ctx): Partial_ {
  const code = c.code;
  let m: RegExpMatchArray | null;
  if (/'NoneType' object has no attribute/.test(c.message)) return noneRule(c);
  if ((m = c.message.match(/module '(\w+)' has no attribute '(\w+)'/))) {
    const [, mod, attr] = m;
    const near = MODULE_MEMBERS[mod] ? closest(attr, MODULE_MEMBERS[mod], 2) : null;
    return { category: "runtime errors", confidence: near ? "certain" : "likely", cls: near ? "attribute-typo" : "module-attribute", rootCause: `The module ${tick(mod)} has no ${tick(attr)}${near ? `; the closest real name is ${tick(near.word)}` : ""}.`, why: "Module members are spelled and capitalised exactly. Also check that the file is not named like the module (a file called random.py hides the real one).", correctedApproach: near ? `Use ${tick(mod + "." + near.word)}.` : `Check the module's documentation for the right name, and the spelling of ${tick(attr)}.`, prevention: "Use the editor's autocomplete after the dot to see real names.", evidence: [], fix: near && c.line && code.includes(`${mod}.${attr}`) ? { kind: "replace", line: c.line, before: code, after: code.replace(`${mod}.${attr}`, `${mod}.${near.word}`) } : undefined };
  }
  if ((m = c.message.match(/'(\w+)' object has no attribute '(\w+)'/))) {
    const [, t, attr] = m;
    const table = MEMBERS[t];
    if (table) {
      const alias = ALIASES[t]?.[attr];
      const near = alias ? { word: alias, dist: 0 } : closest(attr, table, 2);
      const ev = [`The real ${t} methods are: ${table.join(", ")}.`];
      if (t === "str" && attr === "append") return { category: "data types", confidence: "certain", cls: "wrong-type-method", rootCause: `${tick("." + attr + "()")} was called on a string on line ${c.line}, but strings have no append.`, why: "Strings cannot be changed in place; a list can grow with append.", correctedApproach: "Build the result in a list (parts.append(...)) and join it at the end with ''.join(parts), or concatenate with +.", prevention: "Know whether a variable is a str or a list; the trace's variable panel shows its type.", evidence: ev };
      return { category: "data types", confidence: near ? "certain" : "likely", cls: near ? "attribute-typo" : "wrong-type-method", rootCause: `A ${t} has no ${tick(attr)}${near ? `; ${alias ? `the method with that meaning is ${tick(near.word)}` : `the closest real method is ${tick(near.word)}`}` : ""} (line ${c.line}).`, why: `The object on this line really is a ${t}, and ${t} has a fixed set of methods. ${alias ? "Other languages use a different name for the same operation." : "A misspelt method name is a different (missing) name."}`, correctedApproach: near ? `Use ${tick("." + near.word + "()")}.` : `Check what you want to do with the ${t} and pick a method from its real list, or check that the variable is the type you expect.`, prevention: "Use autocomplete after the dot, or check dir(value) in a quick test.", evidence: ev, fix: near && c.line && new RegExp(`\\.${esc(attr)}\\(`).test(code) && (code.match(new RegExp(`\\.${esc(attr)}\\(`, "g")) ?? []).length === 1 ? { kind: "replace", line: c.line, before: code, after: code.replace(new RegExp(`\\.${esc(attr)}\\(`), `.${near.word}(`) } : undefined };
    }
    const own = new Set<string>();
    for (const a of c.source.matchAll(/\bself\.(\w+)\s*(?::[^=\n]+)?=(?!=)/g)) own.add(a[1]);
    for (const a of c.source.matchAll(/^\s*def\s+(\w+)\s*\(\s*self/gm)) own.add(a[1]);
    const near = closest(attr, own, 1);
    const ev = own.size ? [`${tick(t)} sets or defines: ${[...own].join(", ")}.`] : [];
    return { category: "data types", confidence: near ? "certain" : "likely", cls: near ? "attribute-typo" : "missing-attribute", rootCause: `The ${tick(t)} object has no attribute ${tick(attr)}${near ? `; ${tick(near.word)} is one letter away` : ""} (line ${c.line}).`, why: "An object only has the attributes its class sets (usually in __init__ with self.name = ...) and the methods it defines. A different spelling is a different attribute.", correctedApproach: near ? `Use ${tick("." + near.word)}.` : `Assign ${tick("self." + attr)} in __init__ (or the method that should create it), or use the attribute name the class really has.`, prevention: "Set every attribute in __init__ and keep the spelling identical everywhere.", evidence: ev, fix: near && c.line && (code.match(new RegExp(`\\.${esc(attr)}(?!\\w)`, "g")) ?? []).length === 1 ? { kind: "replace", line: c.line, before: code, after: code.replace(new RegExp(`\\.${esc(attr)}(?!\\w)`), `.${near.word}`) } : undefined };
  }
  return { category: "data types", confidence: "likely", cls: "attribute-error", rootCause: `Line ${c.line}: ${c.message}`, why: "The object does not have that attribute or method.", correctedApproach: "Check the object's type and spelling of the attribute.", prevention: "Use autocomplete after the dot." };
}

// ── Runtime errors ────────────────────────────────────────────────────────

function zeroRule(c: Ctx): Partial_ {
  const code = c.code;
  const ev: string[] = [];
  const divisors: string[] = [];
  for (const m of code.matchAll(/(?:\/\/|\/|%)\s*(\(?[A-Za-z_]\w*(?:\([^()]*\))?\)?|\d+(?:\.\d+)?)/g)) divisors.push(m[1].replace(/^\(|\)$/g, ""));
  for (const d of divisors) {
    if (/^0+(\.0*)?$/.test(d)) { ev.push(`The line divides by the literal ${d}.`); continue; }
    const lenM = d.match(/^len\((\w+)\)$/);
    if (lenM) { const v = c.vars[lenM[1]]; if (v && v.n === 0) ev.push(`${tick(lenM[1])} is empty, so len(${lenM[1]}) is 0.`); continue; }
    const v = c.vars[d];
    if (v && /^-?0(\.0*)?$/.test(v.r)) {
      ev.push(`${tick(d)} is ${v.r} just before this line.`);
      const origin = whereBecameZero(c.trace, d);
      if (origin) ev.push(`${tick(d)} became ${v.r} through line ${origin}.`);
    }
  }
  return { category: "runtime errors", confidence: ev.length ? "certain" : "likely", cls: "zero-division", rootCause: `The number dividing on line ${c.line} is 0${divisors.length ? ` (${divisors.map(tick).join(", ")})` : ""}.`, why: "Dividing by zero has no result, so Python raises ZeroDivisionError. It often comes from an empty list (len is 0), a counter that never increased, or a value read from data that is 0.", correctedApproach: "Guard the division: if denominator != 0: ... else: handle the case (return 0, None, or a message). For averages, check the list is not empty first.", prevention: "For every / and %, ask 'can the right side be 0?' and handle that case on purpose.", evidence: ev };
}

function whereBecameZero(trace: Trace | null | undefined, name: string): number | null {
  if (!trace) return null;
  const end = trace.exceptionStep ?? trace.steps.length - 1;
  const fn = trace.steps[end]?.frames[trace.steps[end].frames.length - 1]?.fn;
  const depth = trace.steps[end]?.frames.length;
  const val = (k: number) => { const f = trace.steps[k].frames[trace.steps[k].frames.length - 1]; const idx = f.vars[name]; return idx === undefined ? undefined : trace.vals[idx]?.r; };
  const isZero = (r?: string) => r !== undefined && /^-?0(\.0*)?$/.test(r);
  let k = end;
  while (k > 0 && trace.steps[k].frames.length === depth && trace.steps[k].frames[depth! - 1]?.fn === fn && isZero(val(k))) k--;
  if (k === end) return null;
  const next = k + 1;
  const prev = trace.steps[k];
  if (!prev || prev.ev !== "line" || prev.frames.length !== depth) return null;
  if (trace.gaps?.some((g) => g.after >= k && g.before <= next)) return null;
  return isZero(val(next)) ? prev.line : null;
}

function importRule(c: Ctx): Partial_ {
  const msg = c.message;
  let m: RegExpMatchArray | null;
  const base = { category: "runtime errors" as const };
  if (/disabled in this sandbox/.test(msg)) return { ...base, confidence: "certain", cls: "module-blocked", rootCause: msg, why: "The browser sandbox blocks modules that reach the network or the browser itself.", correctedApproach: "Work on data that is already in the program (lists, dicts, text). These exercises need only the standard library, plus numpy and pandas where the exercise says so.", prevention: "Do not rely on network access in exercises." };
  if ((m = msg.match(/No module named '([\w.]+)'/))) {
    const full = m[1], top = full.split(".")[0];
    const cands = [...STD_MODULES, ...PYODIDE_PACKAGES];
    const near = closest(top, cands, top.length >= 6 ? 2 : 1);
    if (NOT_IN_SANDBOX.includes(top)) return { ...base, confidence: "certain", cls: "module-unavailable", rootCause: `${tick(top)} is not available in this browser sandbox.`, why: "Python runs inside your browser with the standard library and a few bundled packages (such as numpy and pandas). Other third-party packages cannot be installed, and there is no network access.", correctedApproach: "Solve it with the standard library (for example csv, json, collections), or numpy/pandas where the exercise allows.", prevention: "Check the exercise statement for the allowed modules before importing." };
    if (near && c.line && /^\s*(import|from)\s/.test(c.code)) return { ...base, confidence: "certain", cls: "module-typo", rootCause: `There is no module ${tick(top)}; the closest real module is ${tick(near.word)}.`, why: "Module names are spelled exactly, and a misspelt name does not exist.", correctedApproach: `Write ${tick(near.word)}.`, prevention: "Copy module names from the documentation.", fix: { kind: "replace", line: c.line, before: c.code, after: c.code.replace(new RegExp(`(?<![\\w.])${esc(top)}(?!\\w)`), near.word) } };
    return { ...base, confidence: "likely", cls: "module-missing", rootCause: `Python cannot find a module named ${tick(full)}.`, why: "Either the name is misspelt, the module is not part of the standard library, or the package is not installed in this sandbox.", correctedApproach: "Check the spelling against the standard library list. In this sandbox only the standard library and bundled packages such as numpy and pandas can be imported.", prevention: "Check the exercise statement for the allowed modules." };
  }
  if ((m = msg.match(/cannot import name '(\w+)' from '([\w.]+)'/))) {
    const [, nm, mod] = m;
    const members = MODULE_MEMBERS[mod];
    const near = members ? closest(nm, members, 2) : null;
    return { ...base, confidence: near ? "certain" : "likely", cls: near ? "import-name-typo" : "import-name-missing", rootCause: `${tick(mod)} has no ${tick(nm)}${near ? `; the closest real name is ${tick(near.word)}` : ""}.`, why: "Names are spelled and capitalised exactly (collections.Counter, not collections.counter).", correctedApproach: near ? `Import ${tick(near.word)}.` : "Check the module's documentation for the exact name, or whether the file is named like the module.", prevention: "Copy import lines from the documentation.", fix: near && c.line && /^\s*from\s/.test(c.code) ? { kind: "replace", line: c.line, before: c.code, after: c.code.replace(new RegExp(`(?<![\\w.])${esc(nm)}(?!\\w)`), near.word) } : undefined };
  }
  return { ...base, confidence: "likely", cls: "import-error", rootCause: msg, why: "An import failed.", correctedApproach: "Check the module and names in the import line.", prevention: "Import only what the exercise allows." };
}

function recursionRule(c: Ctx): Partial_ {
  const ev: string[] = [];
  const t = c.trace;
  if (t?.stat.recursive.length) ev.push(`The trace shows ${t.stat.recursive.map(tick).join(", ")} calling itself${t.counts ? `; the deepest call stack was ${Math.max(0, t.counts.maxDepth - 1)}` : ""}.`);
  return { category: "algorithms", confidence: "certain", cls: "recursion-limit", rootCause: `A function kept calling itself until Python's recursion limit${c.line ? ` (the last call is on line ${c.line})` : ""}.`, why: "Every call adds a frame to the call stack. A recursive function needs a base case that returns without calling itself, and each call must move closer to that base case. Otherwise the calls never end.", correctedApproach: "Add or fix the base case (for example if n <= 1: return 1) and make sure the argument changes towards it (n - 1, a shorter list, a smaller range). For very deep problems use a loop.", prevention: "Write the base case first, then the recursive case, and check that the argument shrinks.", evidence: ev };
}

function timeoutRule(c: Ctx): Partial_ {
  const ev: string[] = [];
  const stat = staticLoopFindings(c.source);
  for (const s of stat) ev.push(`Line ${s.line}: ${tick(s.text)}: ${s.reason}`);
  const t = c.trace;
  if (t?.loops) for (const l of t.loops) if (l.iterations > 1000) ev.push(`The trace counted ${l.iterations.toLocaleString("en-US")} iterations of the loop on line ${l.line}${t.detached ? " before tracing stopped" : ""}.`);
  return { category: "control flow", confidence: stat.length ? "certain" : "likely", cls: "wrong-loop-condition", rootCause: stat.length ? `The loop on line ${stat[0].line} can never end: ${stat[0].reason}` : "The program ran longer than the time limit.", why: "A while loop runs until its condition becomes False. If nothing in the loop changes what the condition looks at (and there is no break or return), the condition stays True forever. A nested loop over a large input can also be too slow.", correctedApproach: stat.length ? `Change the loop so the value in the condition moves towards ending (for example ${tick(stat[0].vars[0] ? stat[0].vars[0] + " += 1" : "update the variable")} inside the loop), or add a break when the work is done.` : "Check every while loop: something inside it must change so its condition eventually becomes False. For slow code, avoid scanning a list inside a loop (use a set or dict lookup).", prevention: "Before running a while loop, say what changes on each pass and when it becomes False.", evidence: ev };
}

/** `while` loops whose condition never changes in the body, with no way out. Conservative: names in the condition only. */
export function staticLoopFindings(source: string): { line: number; text: string; reason: string; vars: string[] }[] {
  const { lines } = readLogicalLines(source);
  const out: { line: number; text: string; reason: string; vars: string[] }[] = [];
  for (let k = 0; k < lines.length; k++) {
    const m = lines[k].text.match(/^while\s+([\s\S]*?):$/);
    if (!m) continue;
    const body: Logical[] = [];
    for (let j = k + 1; j < lines.length && lines[j].indent > lines[k].indent; j++) body.push(lines[j]);
    const bodyText = body.map((b) => b.text).join("\n");
    if (/\b(break|return|raise|yield)\b|\bexit\(|\bsys\.exit|\binput\(|\bnext\(|\.pop\(|\.popleft\(|\.readline\(|\bread\(/.test(bodyText)) continue;
    const cond = m[1].replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
    if (/^(True|1)$/.test(cond.trim())) { out.push({ line: lines[k].start, text: lines[k].text, reason: "its condition is always True and the body has no break or return.", vars: [] }); continue; }
    const names = [...new Set([...cond.matchAll(/(?<![\w.])([A-Za-z_]\w*)(?!\s*\()/g)].map((x) => x[1]).filter((n) => !["and", "or", "not", "in", "is", "True", "False", "None", "len"].includes(n)))];
    if (!names.length || /\(/.test(cond.replace(/len\(/g, ""))) continue;
    const changed = names.some((n) => new RegExp(`(?<![\\w.])${esc(n)}\\s*(?:[-+*/%@&|^]|//|\\*\\*|>>|<<)?=(?!=)|(?<![\\w.])${esc(n)}\\s*(?:,|\\[|\\.)|\\b(?:for|as)\\s+${esc(n)}\\b|\\b${esc(n)}\\.\\w+\\(`).test(bodyText));
    if (!changed) out.push({ line: lines[k].start, text: lines[k].text, reason: `nothing in the body changes ${names.map(tick).join(" or ")}, so the condition cannot become False.`, vars: names });
  }
  return out;
}

/** A mutable value used as a default argument. */
export function mutableDefaults(source: string): { fn: string; param: string; line: number; text: string; value: string; fix?: Fix }[] {
  const { lines } = readLogicalLines(source);
  const out: ReturnType<typeof mutableDefaults> = [];
  const src = source.split("\n");
  for (let k = 0; k < lines.length; k++) {
    const m = lines[k].text.match(/^(?:async\s+)?def\s+(\w+)\s*\(([\s\S]*)\)\s*(?:->[^:]+)?:$/);
    if (!m) continue;
    for (const p of splitTop(m[2])) {
      const pm = p.match(/^\*{0,2}(\w+)\s*(?::\s*[^=]+?)?\s*=\s*(\[\s*\]|\{\s*\}|set\(\s*\)|list\(\s*\)|dict\(\s*\)|\[.*\]|\{.*\})$/s);
      if (!pm || p.startsWith("*")) continue;
      const physical = lines[k].start === lines[k].end;
      const first = lines[k + 1];
      let fix: Fix | undefined;
      if (physical && first && first.indent > lines[k].indent && !/^["']/.test(first.text)) {
        const original = src[lines[k].start - 1];
        const after = original.replace(new RegExp(`(\\b${esc(pm[1])}\\s*(?::\\s*[^=,)]+?)?\\s*=\\s*)${esc(pm[2])}`), "$1None");
        if (after !== original) {
          const pad = " ".repeat(first.indent);
          const empty = pm[2].startsWith("[") ? "[]" : pm[2].startsWith("{") ? (pm[2] === "{}" ? "{}" : pm[2]) : pm[2];
          fix = { kind: "replace", line: lines[k].start, before: original, after: `${after}\n${pad}if ${pm[1]} is None:\n${pad}    ${pm[1]} = ${empty}` };
        }
      }
      out.push({ fn: m[1], param: pm[1], line: lines[k].start, text: lines[k].text, value: pm[2], fix });
    }
  }
  return out;
}

function mutableDefaultDiagnosis(source: string, trace?: Trace | null): Diagnosis[] {
  return mutableDefaults(source).map((d) => {
    const ev = [`Line ${d.line}: ${tick(d.text)}`];
    if (trace) {
      const calls = trace.steps.filter((s) => s.ev === "call" && s.frames[s.frames.length - 1]?.fn === d.fn);
      const ids = calls.map((s) => { const idx = s.frames[s.frames.length - 1].vars[d.param]; return idx === undefined ? undefined : trace.vals[idx]?.id; });
      const shared = ids.filter((x, i) => x !== undefined && ids.indexOf(x) !== i);
      if (shared.length) ev.push(`The trace shows ${tick(d.param)} is the same object (#${shared[0]}) in ${calls.length} different calls of ${tick(d.fn + "()")}.`);
    }
    return {
      errorType: "MutableDefaultArgument", message: `${d.param}=${d.value} in def ${d.fn}`, line: d.line, codeLine: src1(source, d.line), relevantCode: relevant(source, d.line),
      category: "functions" as const, cls: "mutable-default", confidence: "certain" as const,
      rootCause: `The default ${tick(d.value)} for ${tick(d.param)} (line ${d.line}) is created once, when the function is defined, and then shared by every call that does not pass its own value.`,
      why: "A default value is evaluated a single time. If it is a list, dict or set that the function changes, the changes stay for the next call, so results depend on earlier calls.",
      correctedApproach: `Use ${tick(d.param + "=None")} and create the empty value inside the function: ${tick(`if ${d.param} is None: ${d.param} = ${d.value}`)}.`,
      prevention: "Never use [], {} or set() as a default value. Use None and create the value inside the function.", evidence: ev, fix: d.fix,
    };
  });
}

const src1 = (source: string, line?: number) => lineAt(source, line);

function genericRuntime(c: Ctx): Partial_ {
  const t = c.type, msg = c.message;
  const base = { category: "runtime errors" as const };
  if (t === "AssertionError") return { category: "unexpected output", confidence: "certain", cls: "assertion", rootCause: msg ? `A check failed: ${msg}.` : "A check (assert) failed: your result is not the expected one.", why: "The test compared what your code returned with the expected value, and they were not equal. The type, the order and the exact value all count.", correctedApproach: "Run the function with the failing input yourself and print the result. Compare it with the expected value (type, order, rounding) and trace the lines that build it.", prevention: "Work an example by hand first, including an empty input and the largest and smallest values.", evidence: [] };
  if (t === "NotImplementedError") return { ...base, confidence: "certain", cls: "not-implemented", rootCause: "The starter code still contains raise NotImplementedError.", why: "That line is a placeholder that stops the program until you replace it.", correctedApproach: "Replace the raise line with your implementation, ending in a return statement.", prevention: "Replace every placeholder before running the check.", evidence: [] };
  if (t === "EOFError") return { ...base, confidence: "certain", cls: "no-input", rootCause: `input() on line ${c.line} had nothing to read.`, why: "The program asked for input, but no input text was provided (nobody is typing in this sandbox).", correctedApproach: "Type the input lines into the stdin box before running, or put the value in a variable instead of calling input().", prevention: "In exercises, read values from the function arguments rather than from input().", evidence: [] };
  if (t === "RuntimeError" && /dictionary changed size during iteration/.test(msg)) {
    const f = c.code.match(/^(\s*for\s+[\w, ()]+\s+in\s+)(\w+)(\.(?:items|keys|values)\(\))?(\s*:.*)$/);
    return { ...base, confidence: "certain", cls: "mutate-while-iterating", rootCause: `The dictionary being looped over on line ${c.line} was changed inside the loop.`, why: "A dict cannot grow or shrink while it is being iterated, because the loop would lose its place.", correctedApproach: "Loop over a copy: for key in list(d): ... and change d inside the loop. Or build a new dict.", prevention: "Never add or remove items of a collection while looping over it.", evidence: [], fix: f && c.line ? { kind: "replace", line: c.line, before: c.code, after: `${f[1]}list(${f[2]}${f[3] ?? ""})${f[4]}` } : undefined };
  }
  if (t === "StopIteration") return { ...base, confidence: "certain", cls: "stop-iteration", rootCause: `next() on line ${c.line} ran out of items.`, why: "An iterator or generator that has no more values raises StopIteration when asked for another.", correctedApproach: "Use a for loop, or next(it, default) to get a default when it is exhausted.", prevention: "Prefer for loops over manual next().", evidence: [] };
  if (t === "FileNotFoundError") return { ...base, confidence: "certain", cls: "file-missing", rootCause: `The file opened on line ${c.line} does not exist in the sandbox.`, why: "The sandbox has its own in-memory files, not your computer's. A file exists only if the program (or the workspace) created it.", correctedApproach: "Create the file first (open(name, 'w')), or check the exact name and folder.", prevention: "Check file names exactly, and write the file before reading it.", evidence: [] };
  if (t === "OverflowError" || t === "MemoryError") return { ...base, confidence: "likely", cls: "resource", rootCause: msg || t, why: "The program asked for a number or a structure that is too big.", correctedApproach: "Process the data one item at a time and avoid building very large lists.", prevention: "Estimate the size of what you build.", evidence: [] };
  return { ...base, confidence: "likely", cls: "runtime-error", rootCause: `Line ${c.line}: ${t}: ${msg}`, why: `Python raised ${t} while running this line.`, correctedApproach: "Read the last line of the traceback, look at the marked line, and print the values it uses just before it.", prevention: "Run small pieces of code often.", evidence: [] };
}

// ── Entry points ──────────────────────────────────────────────────────────

function dispatch(c: Ctx): Partial_ {
  switch (c.type) {
    case "SyntaxError": return syntaxRule(c);
    case "IndentationError": case "TabError": return indentationRule(c);
    case "NameError": case "UnboundLocalError": return nameRule(c);
    case "TypeError": return typeRule(c);
    case "ValueError": return valueRule(c);
    case "IndexError": return indexRule(c);
    case "KeyError": return keyRule(c);
    case "AttributeError": return attrRule(c);
    case "ZeroDivisionError": return zeroRule(c);
    case "ImportError": case "ModuleNotFoundError": return importRule(c);
    case "RecursionError": return recursionRule(c);
    case "Timeout": case "TimeoutError": return timeoutRule(c);
    default: return genericRuntime(c);
  }
}

/** Diagnose one failure. Returns null when there is nothing to diagnose (no error text, type or trace error). */
export function diagnose(input: DiagnoseInput): Diagnosis | null {
  const parsed = input.error ? parseErrorText(input.error) : null;
  const te = input.trace?.error;
  const type = input.errorType ?? parsed?.type ?? te?.type;
  if (!type) return null;
  const message = input.message ?? parsed?.message ?? te?.msg ?? "";
  const line = input.line ?? parsed?.line ?? te?.line;
  const fv = failingFrameVars(input.trace);
  const code = lineAt(input.source, line) ?? "";
  const ctx: Ctx = { source: input.source, type, message, line, code, trace: input.trace, vars: fv?.vars ?? {}, hasState: !!fv, tests: input.tests, names: definedNames(input.source) };
  const p = dispatch(ctx);
  const { evidence = [], ...rest } = p;
  // When the traceback does not name a line in the learner's code (the error was raised in the tests), say so instead of printing "undefined".
  const clean = (s: string) => (line === undefined ? s.replace(/ on line undefined/g, " in your code").replace(/ ?\(line undefined\)/g, "").replace(/line undefined/g, "the failing line") : s);
  return {
    errorType: type === "Timeout" ? "TimeoutError" : type, message, line, codeLine: code || undefined, relevantCode: relevant(input.source, line),
    ...rest, rootCause: clean(rest.rootCause), why: clean(rest.why), correctedApproach: clean(rest.correctedApproach), evidence: evidence.map(clean), stateBefore: fv ? stateOf(fv.vars) : undefined,
  };
}

/** Source-only findings that explain wrong results or later failures: mutable defaults, functions that never return a value. */
export function sourceFindings(source: string, tests?: string, trace?: Trace | null): Diagnosis[] {
  const out = mutableDefaultDiagnosis(source, trace);
  const noRet = functionsWithoutReturn(source).filter((f) => !tests || new RegExp(`(?<![\\w.])${esc(f.name)}\\s*\\(`).test(tests));
  if (tests) for (const f of noRet) {
    out.push({
      errorType: "NoReturn", message: `${f.name}() has no return statement`, line: f.line, codeLine: src1(source, f.line), relevantCode: relevant(source, f.line),
      category: "functions", cls: "missing-return", confidence: "certain",
      rootCause: `${tick(f.name + "()")} (line ${f.line}) never executes a return statement with a value, so every call gives None.`,
      why: "A function that does not return anything hands back None. The test compares that None with the expected result.",
      correctedApproach: "Add return <result> at the end of the function (and on every path through it).", prevention: "End every function that computes a value with return. print() shows a value but does not return it.",
      evidence: [`${tick(f.name)} appears in the tests and its body has no return or yield.`],
    });
  }
  return out;
}

/** The main diagnosis followed by source-only findings that are not the same rule. */
export function diagnoseAll(input: DiagnoseInput): Diagnosis[] {
  const main = diagnose(input);
  const extra = sourceFindings(input.source, input.tests, input.trace).filter((d) => !main || d.cls !== main.cls || d.line !== main.line);
  return main ? [main, ...extra] : extra;
}
