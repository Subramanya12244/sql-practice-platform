// @vitest-environment node
// Execution equivalence for Python: turning visual explanation on (the tracer from `buildTraceProgram`) must not change what the
// learner sees. Every program runs in real CPython twice:
//   Mode A  the plain program                      (`python -s -c <code>`)
//   Mode B  the same program under the tracer      (`python -s <buildTraceProgram(code)>`)
// and we compare stdout, stderr, the exit status, the exception (type and message), and the final value of every learner global.
// The globals dump is appended by THIS harness (the tracer is not edited): Mode A runs the code through an exec harness with the
// same namespace the tracer uses, then both dump `repr` of every non-dunder global.
//
// Mode A exit status maps onto the trace like this (the tracer always exits 0 and reports the failure inside the trace):
//   no error -> 0 | SystemExit(n) -> n, SystemExit("msg") -> 1, SystemExit() -> 0 | any other exception -> 1
//
// Tests marked `KNOWN DIFFERENCE` pin a real difference to what each mode prints today (they pass while it exists). When the
// product is fixed they fail on purpose: replace them with `await equivalent(program)`.
//
//   EQUIV_LESSONS=all   run every lesson that has Python (default: a sample of 60 spread over the common core and both paths)
//   EQUIV_DAYS=a126,e129 run only these lessons
//   DAILY_PYTHON=...    interpreter (default <repo>/.venv-daily/bin/python, then python3)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTraceProgram, parseTrace, type Trace } from "../site/lib/visual/pyTrace";
import { parseDay, type Curriculum, type DayExtras } from "../site/lib/daily";
import curriculumJson from "../site/content/daily/curriculum.json";

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;
const hasPandas = hasPython && spawnSync(PYTHON, ["-c", "import pandas, numpy"]).status === 0;
if (!hasPython) console.warn(`[equivalence] SKIPPED: no Python at ${PYTHON}`);
if (hasPython && !hasPandas) console.warn("[equivalence] pandas/numpy not importable in that interpreter: the data-program tests are SKIPPED");

// ── Harness ──────────────────────────────────────────────────────────────
const ENV = { ...process.env, PYTHONHASHSEED: "0", TZ: "UTC", LC_ALL: "C.UTF-8", MPLBACKEND: "Agg", PYTHONIOENCODING: "utf-8" };
const TRACE_CAP = 20000; // the tracer keeps at most this many characters of stdout (pyTrace.ts)

interface Ran { stdout: string; stderr: string; status: number | null }
/** At most 6 interpreters at once, across all tests in this file. */
let slots = 6;
const waiting: (() => void)[] = [];
const acquire = () => (slots > 0 ? (slots--, Promise.resolve()) : new Promise<void>((r) => waiting.push(r)));
const release = () => { const n = waiting.shift(); if (n) n(); else slots++; };
async function exec(args: string[], input: string, cwd: string, timeout = 60_000, extraEnv: Record<string, string> = {}): Promise<Ran> {
  await acquire();
  try {
    return await new Promise<Ran>((done) => {
      // Own process group, so a timeout also kills anything the program spawned (a grandchild would keep the pipes open forever).
      const child = spawn(PYTHON, args, { cwd, env: { ...ENV, ...extraEnv }, detached: true });
      let stdout = "", stderr = "", finished = false;
      const finish = (status: number | null) => { if (!finished) { finished = true; clearTimeout(timer); done({ stdout, stderr, status }); } };
      const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ } stderr += "\n[equivalence harness: killed after timeout]"; finish(null); }, timeout);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", finish);
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    });
  } finally { release(); }
}

/**
 * The same program text goes to both modes. A final `try/finally` is wrapped around it (by the Python `ast` module, so the
 * program's behaviour is unchanged) whose `finally` writes the in-flight exception and `repr` of every non-dunder global to the file
 * named by EQUIV_DUMP. It runs inside the learner's own namespace, so it needs nothing from the tracer's internals. Printing inside
 * a `repr` is swallowed, so the dump never changes the output.
 */
const DUMP_SNIPPET = `
import sys as __eq_sys, json as __eq_json, re as __eq_re, io as __eq_io, os as __eq_os
__eq_e = __eq_sys.exc_info()[1]
__eq_o, __eq_er = __eq_sys.stdout, __eq_sys.stderr
__eq_d = {}
__eq_g = globals()
__eq_sys.stdout = __eq_io.StringIO(); __eq_sys.stderr = __eq_io.StringIO()
try:
    for __eq_k in sorted(list(__eq_g)):
        if __eq_k.startswith("__"): continue
        __eq_v = __eq_g[__eq_k]
        # Set order is unspecified: CPython 3.13 can order the same literal differently when it is compiled a second time in one
        # process (the tracer reads the source before running it). Compare sets by their sorted elements, not by iteration order.
        try: __eq_r = (type(__eq_v).__name__ + "{" + ", ".join(sorted(repr(__eq_x) for __eq_x in __eq_v)) + "}") if isinstance(__eq_v, (set, frozenset)) else repr(__eq_v)
        except BaseException as __eq_x: __eq_r = "<repr failed " + type(__eq_x).__name__ + ">"
        __eq_r = __eq_re.sub(r"0x[0-9a-fA-F]+", "0xADDR", __eq_r).replace("<StreamHandler <stdout>", "<StreamHandler")
        __eq_d[__eq_k] = [type(__eq_v).__name__, __eq_r[:3000]]
finally:
    __eq_sys.stdout, __eq_sys.stderr = __eq_o, __eq_er
open(__eq_os.environ["EQUIV_DUMP"], "w").write(__eq_json.dumps({"err": None if __eq_e is None else [type(__eq_e).__name__, str(__eq_e)], "globals": __eq_d}))
`;
const TRANSFORM = `import ast, sys, json
src = sys.stdin.read()
try:
    tree = ast.parse(src)
except SyntaxError:
    print(json.dumps({"ok": False})); raise SystemExit
final = ast.parse(${JSON.stringify(DUMP_SNIPPET)}).body
future = [n for n in tree.body if isinstance(n, ast.ImportFrom) and n.module == "__future__"]
rest = [n for n in tree.body if n not in future] or [ast.Pass()]
mod = ast.Module(body=future + [ast.Try(body=rest, handlers=[], orelse=[], finalbody=final)], type_ignores=[])
ast.fix_missing_locations(mod)
print(json.dumps({"ok": True, "src": ast.unparse(mod)}))
`;

interface Outcome {
  stdout: string; stderr: string; exit: number | null; err: { type: string; msg: string } | null; globals: Record<string, [string, string]> | null;
  trace?: Trace;
  /** Real-stdout text after the trace line. Must be empty: all learner output belongs inside the trace. */
  trailing?: string;
  /** Last line of the plain run's stderr (its traceback's exception line). */
  rawErrLast?: string;
}
const norm = (s: string) => {
  const t = s.replaceAll("<string>", "<learner>");
  return t.includes("Traceback") ? t.split("\n").filter((l) => !/^ {4,}\S/.test(l)).join("\n") : t;
};
const clip300 = (s: string) => (s.length <= 300 ? s : s.slice(0, 299) + "…");

/** The program with the dump wrapped around it; `ok: false` when it does not parse (the SyntaxError cases run it as written). */
async function instrument(code: string, dir: string): Promise<{ ok: boolean; src: string }> {
  const r = await exec(["-s", "-c", TRANSFORM], code, dir);
  const j = JSON.parse(r.stdout || '{"ok":false}') as { ok: boolean; src?: string };
  return j.ok ? { ok: true, src: j.src! } : { ok: false, src: code };
}
const readDump = (file: string) => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { err: [string, string] | null; globals: NonNullable<Outcome["globals"]> }) : null);

/** Mode A: the plain program. */
async function modeA(src: string, stdin: string, dir: string): Promise<Outcome> {
  const dump = path.join(dir, "a_dump.json");
  const raw = await exec(["-s", "-c", src], stdin, dir, 60_000, { EQUIV_DUMP: dump });
  const d = readDump(dump);
  return { stdout: raw.stdout, stderr: raw.stderr, exit: raw.status, err: d?.err ? { type: d.err[0], msg: d.err[1] } : null, globals: d?.globals ?? null, rawErrLast: raw.stderr.trim().split("\n").pop() ?? "" };
}

/** Mode B: the same program under the tracer, run as a file so `input()` can read stdin. */
async function modeB(src: string, stdin: string, dir: string, maxSteps?: number): Promise<Outcome> {
  const tp = path.join(dir, "tracer.py"), dump = path.join(dir, "b_dump.json");
  writeFileSync(tp, buildTraceProgram(src, maxSteps));
  const r = await exec(["-s", tp], stdin, dir, 60_000, { EQUIV_DUMP: dump });
  // The trace is one line after the marker. Anything written to the real stdout after it is returned as `trailing`.
  const at = r.stdout.lastIndexOf("\u001eDFTRACE\u001e");
  const end = at < 0 ? -1 : r.stdout.indexOf("\n", at);
  const trailing = end < 0 ? "" : r.stdout.slice(end + 1);
  const trace = parseTrace(end < 0 ? r.stdout : r.stdout.slice(0, end + 1));
  if (!trace) throw new Error(`Mode B produced no trace (exit ${r.status}): stdout=${JSON.stringify(r.stdout.slice(0, 300))} stderr=${r.stderr.slice(-500)}`);
  const d = readDump(dump);
  return { stdout: trace.stdout, stderr: r.stderr, exit: r.status, err: trace.error ? { type: trace.error.type, msg: trace.error.msg } : null, globals: d?.globals ?? null, trace, trailing };
}

async function modeBoth(p: { code: string; stdin?: string }, maxSteps?: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "equiv-"));
  try {
    const { ok, src } = await instrument(p.code, dir);
    const [a, b] = await Promise.all([modeA(src, p.stdin ?? "", dir), modeB(src, p.stdin ?? "", dir, maxSteps)]);
    return { a, b, parsed: ok };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Exit status a learner would see for Mode B, derived from what the trace reports. */
function effectiveExit(err: Outcome["err"]): number {
  if (!err) return 0;
  if (err.type === "SystemExit") {
    if (err.msg === "" || err.msg === "None") return 0;
    return /^-?\d+$/.test(err.msg) ? Number(err.msg) & 0xff : 1;
  }
  return 1;
}

interface Program { name: string; code: string; stdin?: string }

const both = (p: Program, maxSteps?: number) => modeBoth(p, maxSteps);

/** Run both modes and assert every learner-visible outcome matches. Returns both for extra checks. */
async function equivalent(p: Program, maxSteps?: number) {
  const { a, b, parsed } = await both(p, maxSteps);
  const expectedStdout = a.stdout.length > TRACE_CAP ? a.stdout.slice(0, TRACE_CAP) : a.stdout;
  expect(b.stdout, `${p.name}: stdout`).toBe(expectedStdout);
  expect(b.exit, `${p.name}: the tracer process itself ends cleanly`).toBe(0);
  expect(b.trailing, `${p.name}: nothing reaches the real stdout outside the trace`).toBe("");
  const aErr = norm(a.stderr), bErr = norm(b.stderr);
  if (!parsed) {
    // A program that does not parse: both report the SyntaxError, the plain run through its traceback.
    expect(b.err?.type, `${p.name}: exception type`).toBe("SyntaxError");
    expect(a.rawErrLast, `${p.name}: plain run's message`).toContain(b.err!.msg);
    expect(effectiveExit(b.err), `${p.name}: exit status`).toBe(a.exit);
    return { a, b };
  }
  expect(effectiveExit(b.err), `${p.name}: exit status`).toBe(a.exit);
  expect(b.err?.type ?? null, `${p.name}: exception type`).toBe(a.err?.type ?? null);
  expect(b.err ? b.err.msg : null, `${p.name}: exception message`).toBe(a.err ? clip300(a.err.msg) : null);
  // stderr: everything the program itself wrote must be identical; the plain run additionally ends with the traceback of an uncaught error.
  if (a.err) {
    expect(aErr.startsWith(bErr), `${p.name}: stderr written before the failure\nA: ${aErr}\nB: ${bErr}`).toBe(true);
    expect(a.rawErrLast!.includes(a.err.type) || a.err.type === "SystemExit", `${p.name}: traceback names ${a.err.type}: ${a.rawErrLast}`).toBe(true);
  } else expect(bErr, `${p.name}: stderr`).toBe(aErr);
  expect(a.globals, `${p.name}: the dump ran in the plain run`).not.toBeNull();
  expect(b.globals, `${p.name}: the dump ran under the tracer`).not.toBeNull();
  expect(b.globals, `${p.name}: final value of every learner global`).toEqual(a.globals);
  return { a, b };
}

// ── Corpus ───────────────────────────────────────────────────────────────
const P = (name: string, code: string, stdin?: string): Program => ({ name, code: code.replace(/^\n/, ""), stdin });

const CORPUS: Program[] = [
  P("loops: for/while/break/continue/else", `
total = 0
for i in range(10):
    if i % 2: continue
    total += i
n = 0
while True:
    n += 3
    if n > 20: break
else:
    print("never")
for j in range(3):
    pass
else:
    print("for-else ran", j)
print(total, n)
`),
  P("nested loops and comprehensions", `
grid = [[r * c for c in range(4)] for r in range(4)]
flat = [x for row in grid for x in row if x]
pairs = {(a, b) for a in range(3) for b in range(3) if a < b}
lookup = {k: v for k, v in zip("abc", range(3))}
print(grid, flat, sorted(pairs), lookup)
`),
  P("recursion: fib, factorial, hanoi", `
def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
def fact(n): return 1 if n <= 1 else n * fact(n - 1)
moves = []
def hanoi(n, a, b, c):
    if n:
        hanoi(n - 1, a, c, b); moves.append((a, c)); hanoi(n - 1, b, a, c)
hanoi(4, "A", "B", "C")
print(fib(14), fact(15), len(moves), moves[:3])
`),
  P("deep recursion that still fits (depth 900)", `
def depth(n): return 0 if n == 0 else 1 + depth(n - 1)
print(depth(900))
`),
  P("RecursionError raised and caught", `
def forever(n): return forever(n + 1)
try:
    forever(0)
except RecursionError as e:
    print("caught", type(e).__name__)
`),
  P("generators: lazy, send, yield from, close", `
def counter(limit):
    i = 0
    while i < limit:
        got = yield i
        if got: i = got
        else: i += 1
def chain():
    yield from counter(3)
    yield from "ab"
g = counter(10)
print(next(g), g.send(5), next(g))
g.close()
print(list(chain()))
squares = (x * x for x in range(5))
print(next(squares), sum(squares))
`),
  P("classes: inheritance, dunders, property, slots, dataclass", `
from dataclasses import dataclass
class Shape:
    count = 0
    def __init__(self, name): self.name = name; Shape.count += 1
    def area(self): raise NotImplementedError
    def __repr__(self): return f"{type(self).__name__}({self.name!r})"
class Sq(Shape):
    def __init__(self, s): super().__init__("sq"); self._s = s
    @property
    def side(self): return self._s
    def area(self): return self._s ** 2
    def __eq__(self, o): return isinstance(o, Sq) and o._s == self._s
    def __hash__(self): return hash(self._s)
class Pt:
    __slots__ = ("x", "y")
    def __init__(self, x, y): self.x, self.y = x, y
@dataclass
class Rec:
    a: int
    b: str = "z"
s = Sq(3); t = Sq(3); p = Pt(1, 2); r = Rec(1)
print(s, s.side, s.area(), s == t, len({s, t}), Shape.count, p.x + p.y, r)
`),
  P("closures and late binding", `
def make():
    n = 0
    def inc():
        nonlocal n
        n += 1
        return n
    return inc
c = make(); c(); c()
fs = [lambda: i for i in range(3)]
gs = [lambda i=i: i for i in range(3)]
print(c(), [f() for f in fs], [g() for g in gs])
`),
  P("mutation and aliasing", `
a = [1, 2, 3]
b = a
b.append(4)
c = a[:]
c.append(5)
def add(x, bucket=[]):
    bucket.append(x); return bucket
add(1); add(2)
import copy
outer = [[1], [2]]
sh = outer.copy(); dp = copy.deepcopy(outer)
outer[0].append(9)
d = {"k": [1]}; e = dict(d); e["k"].append(2)
print(a is b, a is c, a, c, add(3), sh, dp, d)
`),
  P("exceptions caught, else/finally order, chaining", `
class AppError(Exception): pass
def risky(x):
    try:
        return 10 / x
    except ZeroDivisionError as e:
        raise AppError("bad divisor") from e
    finally:
        print("finally", x)
for v in (2, 0):
    try:
        print(risky(v))
    except AppError as e:
        print("caught", e, type(e.__cause__).__name__)
    else:
        print("no error")
try:
    {}["missing"]
except KeyError as e:
    print("KeyError", e)
`),
  P("uncaught ValueError after output", `
print("before")
x = int("not a number")
print("after")
`),
  P("uncaught KeyError inside a function", `
def lookup(d, k): return d[k]
print("start")
lookup({"a": 1}, "b")
`),
  P("uncaught custom exception with a long message", `
class Boom(Exception): pass
print("x")
raise Boom("long " * 100)
`),
  P("SyntaxError", `print("a"\nx = 1\n`),
  P("IndentationError", `if True:\nprint("no indent")\n`),
  P("NameError", `print(undefined_name)\n`),
  P("input() until EOF", `
total = 0
while True:
    try:
        line = input("n? ")
    except EOFError:
        break
    total += int(line)
print("total", total)
`, "1\n2\n3\n"),
  P("input() with too little stdin (EOFError uncaught)", `
name = input()
age = input()
print(name, age)
`, "only one line\n"),
  P("sys.stdin.read and readline", `
import sys
first = sys.stdin.readline().strip()
rest = sys.stdin.read().split()
print(first, rest)
`, "head\na b\nc\n"),
  P("sys.exit(0)", `
import sys
print("bye")
sys.exit(0)
print("never")
`),
  P("sys.exit(3)", `
import sys
print("code")
sys.exit(3)
`),
  P("sys.exit('message')", `
import sys
print("out")
sys.exit("fatal: stop")
`),
  P("sys.exit() with no argument and a finally block", `
import sys
try:
    sys.exit()
finally:
    print("cleanup")
`),
  P("raise SystemExit(2)", `raise SystemExit(2)\n`),
  P("output to stderr and stdout interleaved", `
import sys
print("out 1")
print("err 1", file=sys.stderr)
sys.stderr.write("err 2\\n")
print("out 2")
`),
  P("warnings go to stderr", `
import warnings
warnings.warn("careful", UserWarning)
print("done")
`),
  P("logging to stderr", `
import logging
logging.basicConfig(format="%(levelname)s:%(message)s")
logging.warning("w")
logging.error("e")
print("ok")
`),
  P("stderr written, then an uncaught exception", `
import sys
print("note", file=sys.stderr)
print("o")
1 / 0
`),
  P("large stdout (70k characters over many lines)", `
for i in range(7000):
    print("line", i)
`),
  P("one very long line (30k characters)", `print("x" * 30000)\n`),
  P("print end, sep, flush, file=sys.stdout", `
import sys
print("a", "b", sep="-", end="|")
print("c", end="", flush=True)
print(1, 2, 3, sep="", file=sys.stdout)
sys.stdout.write("w\\n"); sys.stdout.flush()
print(*[1, 2], sep="\\n")
`),
  P("trace budget exceeded: 100000-iteration loop", `
s = 0
for i in range(100000):
    s += i % 7
print(s)
`),
  P("trace budget exceeded inside a function, then an exception", `
def work(n):
    t = 0
    for i in range(n): t += i
    return t
print(work(5000))
print(1 / (work(10) - 45))
`),
  P("string, bytes, numbers formatting", `
print(f"{3.14159:.2f} {1_000_000:,} {255:#x} {'x':>5}|", 7 // 2, -7 // 2, 7 % -3, 2 ** -1, round(2.5), round(3.5), 0.1 + 0.2)
print("é".encode(), b"ab".decode(), "ß".upper(), repr("a'b"), 10**30, float("inf"), int("12") + 1)
`),
  P("sets and dict ordering with fixed hash seed", `
words = {"pear", "fig", "apple", "kiwi"}
print(sorted(words), len(words))
d = {}
for w in ["b", "a", "c"]: d[w] = len(d)
del d["a"]; d["a"] = 9
print(d, list(d), list(d.values()))
`),
  P("itertools, functools, collections", `
import itertools, functools, collections
print(list(itertools.islice(itertools.count(5), 3)), functools.reduce(lambda a, b: a * b, range(1, 6)))
c = collections.Counter("mississippi"); dq = collections.deque([1, 2, 3], maxlen=3); dq.append(4)
print(c.most_common(2), dq, collections.OrderedDict(a=1))
`),
  P("global and nonlocal scoping, del, exec of a string", `
counter = 0
def bump():
    global counter
    counter += 1
bump(); bump()
tmp = 5
del tmp
ns = {}
exec("z = 6", ns)
print(counter, "tmp" in globals(), ns["z"])
`),
  P("seeded random", `
import random
random.seed(1234)
print([random.randint(0, 99) for _ in range(5)], random.random(), random.choice("abcdef"))
xs = list(range(8)); random.shuffle(xs); print(xs)
`),
  P("context manager and file write/read in cwd", `
with open("note.txt", "w") as f:
    f.write("hello\\nworld\\n")
with open("note.txt") as f:
    lines = f.read().splitlines()
print(lines)
`),
  P("traceback printed by the program itself (file labels normalised)", `
import traceback
def f(): raise ValueError("boom")
try:
    f()
except ValueError:
    traceback.print_exc()
    print(traceback.format_exc().splitlines()[-1])
`),
  P("ExceptionGroup and except*", `
try:
    raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
except* ValueError as e:
    print("value", e.exceptions)
except* TypeError as e:
    print("type", e.exceptions)
`),
  P("a program that defines but never runs main", `
def main():
    print("hello")
if __name__ == "__main__":
    main()
`),
  P("empty program", ``),
];

// ── Tests: corpus ────────────────────────────────────────────────────────
describe.skipIf(!hasPython)("equivalence (Python): Mode A vs Mode B on a hand-written corpus", () => {
  for (const p of CORPUS) {
    it(p.name, async () => { await equivalent(p); }, 120_000);
  }
  // Exit statuses must be what the harness claims, or the mapping above proves nothing.
  it("the harness sees the exit statuses it is meant to compare", async () => {
    const codes: Record<string, number | null> = {};
    for (const name of ["sys.exit(3)", "sys.exit('message')", "uncaught ValueError after output", "sys.exit(0)", "raise SystemExit(2)"]) {
      const p = CORPUS.find((c) => c.name === name)!;
      const { a, b } = await equivalent(p);
      codes[name] = a.exit;
      expect(effectiveExit(b.err)).toBe(a.exit);
    }
    expect(codes).toEqual({ "sys.exit(3)": 3, "sys.exit('message')": 1, "uncaught ValueError after output": 1, "sys.exit(0)": 0, "raise SystemExit(2)": 2 });
  });
  it("large outputs: the trace keeps the first 20000 characters, and nothing printed before the cap differs", async () => {
    const { a, b } = await equivalent(CORPUS.find((c) => c.name.startsWith("large stdout"))!);
    expect(a.stdout.length).toBeGreaterThan(TRACE_CAP);
    expect(b.stdout).toBe(a.stdout.slice(0, TRACE_CAP));
  });
  it("a tiny trace budget (3 steps) changes nothing the learner sees; the trace says it was cut", async () => {
    for (const name of ["recursion: fib, factorial, hanoi", "uncaught KeyError inside a function", "generators: lazy, send, yield from, close", "sys.exit(3)", "mutation and aliasing", "input() until EOF"]) {
      const prog = CORPUS.find((c) => c.name === name)!;
      const { b } = await equivalent(prog, 3);
      const full = await equivalent(prog); // default budget
      expect(b.trace!.steps.length, name).toBeLessThan(Math.max(full.b.trace!.steps.length, 6));
      expect(b.trace!.truncated, name).toBe(true);
    }
  }, 120_000); // 12 real CPython runs: the 5 s default timed out when the whole suite ran at once
  it("the default budget on a 100000-iteration loop truncates the trace but the program still runs to the end", async () => {
    const { a, b } = await equivalent(CORPUS.find((c) => c.name.startsWith("trace budget exceeded: 100000"))!);
    expect(b.trace!.truncated).toBe(true);
    expect(b.stdout).toBe(a.stdout);
  });
  it("a large budget on deep recursion (depth 900) still matches", async () => {
    // The tracer adds its own frames while recording; a large budget must not push a program that fits into RecursionError.
    await equivalent(CORPUS.find((c) => c.name.startsWith("deep recursion"))!, 100_000);
  }, 180_000);
  it("recording is deterministic: the same program traced twice gives the same trace", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "equiv-"));
    try {
      const p = CORPUS.find((c) => c.name === "mutation and aliasing")!;
      const [x, y] = [await modeB(p.code, "", dir), await modeB(p.code, "", dir)];
      expect(JSON.stringify(y.trace)).toBe(JSON.stringify(x.trace));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── Tests: probes for side effects of recording ──────────────────────────
// The tracer reads values while the learner's program is paused. These programs make that reading observable.
describe.skipIf(!hasPython)("equivalence (Python): does recording touch the learner's objects?", () => {
  it("user-defined __repr__ with no side effects is fine (a dataclass-like object, a container of them)", async () => {
    await equivalent(P("pure repr", `
class Item:
    def __init__(self, n): self.n = n
    def __repr__(self): return f"Item({self.n})"
items = [Item(i) for i in range(3)]
by = {i.n: i for i in items}
last = items[-1]
print(items, by, last)
`));
  });
  it("tracing does not call a learner's property getters or run __getattr__ for ordinary objects", async () => {
    await equivalent(P("property not called", `
class Acct:
    def __init__(self): self._b = 1; self.reads = 0
    @property
    def balance(self):
        self.reads += 1
        return self._b
a = Acct()
x = 1
y = 2
print(a.reads)
a.balance
print(a.reads)
`));
  });
  // Each KNOWN DIFFERENCE below is pinned to what both modes really print today. The strict contract is "Mode B prints exactly
  // what Mode A prints"; when the product is fixed these assertions fail, and they should become `expect(b.stdout).toBe(a.stdout)`.
  // FIXED in pyTrace.ts (it no longer calls the learner's __repr__); kept as strict equivalence so it cannot come back.
  it("a __repr__ that counts is never called by the tracer", async () => {
    await equivalent(P("repr with side effect", `
class Noisy:
    calls = 0
    def __repr__(self):
        Noisy.calls += 1
        return "Noisy"
n = Noisy()
x = 1
y = 2
print("repr calls so far:", Noisy.calls)
`));
  });
  it("a __repr__ that prints adds nothing to the learner's output", async () => {
    await equivalent(P("repr that prints", `
class Loud:
    def __repr__(self):
        print("repr called")
        return "Loud"
v = Loud()
print("done")
`));
  });
  it("a dict subclass with a side-effecting items() is left alone", async () => {
    await equivalent(P("chatty dict subclass", `
log = []
class D(dict):
    def items(self):
        log.append("items"); return super().items()
    def __len__(self):
        log.append("len"); return super().__len__()
d = D(a=1)
x = 1
y = 2
print(log)
`));
  });
  // FIXED in pyTrace.ts (object.__getattribute__ skips the learner's __getattr__): strict now.
  it("a class whose __getattr__ logs is not asked for __dict__ by the tracer (slots objects)", async () => {
    await equivalent(P("chatty __getattr__", `
log = []
class G:
    __slots__ = ("a",)
    def __init__(self): self.a = 1
    def __getattr__(self, n):
        log.append("getattr " + n); raise AttributeError(n)
g = G()
x = 1
y = 2
print(log)
`));
  });
  // FIXED in pyTrace.ts (it no longer keeps references to what it records, and runs finalizers inside the capture): strict now.
  it("an object with __del__ is freed at `del`, and the message is part of the program's output", async () => {
    const { a } = await equivalent(P("del frees immediately", `
class R:
    def __del__(self): print("freed")
r = R()
del r
print("after del")
`));
    expect(a.stdout).toBe("freed\nafter del\n");
  });
  it("an object that is still alive at the end prints its __del__ message inside the trace (a plain run prints it at exit)", async () => {
    await equivalent(P("del at exit", `
class R:
    def __init__(self, n): self.n = n
    def __del__(self): print("freed", self.n)
keep = R(1)
print("end of program")
`));
  });
  it("a weakref to a deleted object is dead under the tracer too", async () => {
    const { a } = await equivalent(P("weakref dies", `
import weakref
class Node: pass
n = Node()
w = weakref.ref(n)
del n
print("dead" if w() is None else "alive")
`));
    expect(a.stdout).toBe("dead\n");
  });
  it("sys.getrefcount is the same under the tracer", async () => {
    await equivalent(P("refcount", `
import sys
class Box: pass
b = Box()
print(sys.getrefcount(b))
`));
  });
  it("sys.stdout attributes a program may use behave the same: encoding, errors, writelines, fileno, isatty, flush", async () => {
    for (const expr of ["sys.stdout.encoding", "sys.stdout.errors", "sys.stdout.writelines(['a\\n'])", "sys.stdout.isatty()", "sys.stdout.writable()", "sys.stdout.flush()"]) {
      await equivalent(P(`stdout: ${expr}`, `import sys\ntry:\n    r = ${expr}\n    print("ok", r)\nexcept Exception as e:\n    print(type(e).__name__)\n`));
    }
  });
  // FIXED in pyTrace.ts (the capture object has name, mode, reconfigure and buffer): strict now.
  it("the rest of sys.stdout's file API (buffer, reconfigure, name, mode) behaves the same under the tracer", async () => {
    for (const expr of ["sys.stdout.buffer.write(b\"\")", "sys.stdout.reconfigure(line_buffering=True)", "sys.stdout.name", "sys.stdout.mode"]) {
      await equivalent(P(`stdout: ${expr}`, `import sys\ntry:\n    r = ${expr}\n    print("ok")\nexcept Exception as e:\n    print(type(e).__name__)\n`));
    }
  });
  it("INHERENT: a global that holds sys.stdout holds the tracer's capture object", async () => {
    // Not a defect to fix, but a learner can see it: the trace needs the output, so sys.stdout is replaced while recording.
    const { a, b } = await both(P("holds stdout", `import sys\nout = sys.stdout\nprint(type(out).__name__)\n`));
    expect(a.stdout).toBe("TextIOWrapper\n");
    expect(b.stdout).toBe("_Tee\n");
  });
  // FIXED in pyTrace.ts (function replacers): `$$`, `$&`, `$'` and "$`" in learner source are no longer expanded.
  it("learner source containing `$$`, `$&`, `$'` and a backtick pattern runs identically under the tracer", async () => {
    await equivalent(P("dollar patterns", `print("price: $$5, match: $&, after: $', before: $\`")\n`));
  });
  it("redirecting stdout inside the program works the same (contextlib.redirect_stdout, io.StringIO)", async () => {
    await equivalent(P("redirect_stdout", `
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("captured")
print("shown", repr(buf.getvalue()))
`));
  });
  it("a program that reassigns sys.stdout and never restores it", async () => {
    await equivalent(P("stdout reassigned", `
import sys, io
def quiet():
    real = sys.stdout
    sys.stdout = io.StringIO()
    print("lost")
    sys.stdout = real
quiet()
print("kept")
`));
  });
});

// ── Tests: the real curriculum ───────────────────────────────────────────
const curriculum = curriculumJson as unknown as Curriculum;
const mdFiles = import.meta.glob<string>("../site/content/daily/days/*.md", { eager: true, query: "?raw", import: "default" });
const jsonFiles = import.meta.glob<DayExtras>("../site/content/daily/days/*.json", { eager: true, import: "default" });
const slug = (p: string) => p.split("/").pop()!.replace(/\.(md|json)$/, "");
const mdBy = Object.fromEntries(Object.entries(mdFiles).map(([p, v]) => [slug(p), v]));
const jsonBy = Object.fromEntries(Object.entries(jsonFiles).map(([p, v]) => [slug(p), v]));

/** Python programs of one lesson: its browser-runnable examples and the solutions of its Python exercises. */
function lessonPrograms(id: string): Program[] {
  const content = parseDay(mdBy[id], jsonBy[id]);
  const out: Program[] = [];
  for (const b of content.examples) if (b.kind === "example" && b.lang === "python" && b.browser) out.push({ name: `${id} example ${b.id}`, code: b.code, stdin: b.stdin ? `${b.stdin}\n` : "" });
  for (const e of [...content.guided, ...content.independent]) if (e.kind === "python") out.push({ name: `${id} solution ${e.id}`, code: e.solution, stdin: e.stdin ? `${e.stdin}\n` : "" });
  return out;
}

const withPython = curriculum.days.filter((d) => mdBy[d.id] && jsonBy[d.id]).map((d) => ({ d, programs: lessonPrograms(d.id) })).filter((x) => x.programs.length > 0);
/** Evenly spaced picks inside each path, so early, middle and late lessons are all covered. */
function sample(list: typeof withPython, n: number) {
  if (n >= list.length) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}
const ALL = process.env.EQUIV_LESSONS === "all";
const ONLY = process.env.EQUIV_DAYS?.split(",").map((x) => x.trim()).filter(Boolean);
const chosen = ONLY ? withPython.filter((x) => ONLY.includes(x.d.id)) : ALL ? withPython : (["common", "analyst", "engineer"] as const).flatMap((path) => sample(withPython.filter((x) => x.d.path === path), 20));
const dollarHits: string[] = [];
const PER_LESSON = ALL ? 99 : 6;

describe.skipIf(!hasPython)(`equivalence (Python): curriculum sample (${chosen.length} lessons, ${chosen.reduce((n, c) => n + Math.min(PER_LESSON, c.programs.length), 0)} programs)`, () => {
  it("the sample covers the common core and both paths", () => {
    expect(new Set(chosen.map((c) => c.d.path))).toEqual(new Set(["common", "analyst", "engineer"]));
    if (!ALL && !ONLY) expect(chosen.length).toBe(60);
  });
  // Lessons whose code contains `$$`, `$&`, `$'` or "$`" (e120 has one) broke buildTraceProgram before its fix: they stay in the sample.
  const DOLLAR = /\$[$&`']/;
  for (const { d, programs } of chosen) {
    it(`${d.id} ${d.title}`, async () => {
      for (const p of programs.slice(0, PER_LESSON)) {
        if (DOLLAR.test(p.code)) dollarHits.push(p.name); // these used to break the tracer (String.replace patterns); now checked like any other
        await equivalent(p);
      }
    }, 300_000);
  }
});

// ── Tests: pandas and NumPy ──────────────────────────────────────────────
const DATA: Program[] = [
  P("pandas: filter, sort, head", `
import pandas as pd
df = pd.DataFrame({"city": ["Oslo", "Lyon", "Rome", "Oslo", "Kyiv"], "sales": [10, 25, 7, 31, 18], "ok": [True, False, True, True, False]})
big = df[df["sales"] > 9].sort_values("sales", ascending=False).head(3)
print(big.to_string()); print(big.dtypes.to_string()); print(len(df), df.shape)
`),
  P("pandas: groupby, agg, reset_index", `
import pandas as pd
df = pd.DataFrame({"k": list("aabbcc"), "v": [1, 2, 3, 4, 5, 6], "w": [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]})
g = df.groupby("k").agg(total=("v", "sum"), mean_w=("w", "mean")).reset_index()
print(g.to_string()); print(g.dtypes.to_string())
`),
  P("pandas: merge (inner, left) and indicator", `
import pandas as pd
a = pd.DataFrame({"id": [1, 2, 3], "x": ["p", "q", "r"]})
b = pd.DataFrame({"id": [2, 3, 4], "y": [20.0, 30.0, 40.0]})
inner = a.merge(b, on="id"); left = a.merge(b, on="id", how="left", indicator=True)
print(inner.to_string()); print(left.to_string()); print(left.dtypes.to_string())
`),
  P("pandas: pivot_table and melt", `
import pandas as pd
df = pd.DataFrame({"r": ["N", "N", "S", "S"], "q": ["Q1", "Q2", "Q1", "Q2"], "amt": [1, 2, 3, 4]})
pv = df.pivot_table(index="r", columns="q", values="amt", aggfunc="sum")
mt = pv.reset_index().melt(id_vars="r", var_name="quarter", value_name="amount")
print(pv.to_string()); print(mt.to_string()); print(mt.dtypes.to_string())
`),
  P("pandas: dtype conversion, missing values, fillna", `
import pandas as pd, numpy as np
s = pd.Series(["1", "2", None, "4"])
n = pd.to_numeric(s, errors="coerce")
df = pd.DataFrame({"a": n, "b": ["x", None, "z", "w"], "d": pd.to_datetime(["2024-01-01", None, "2024-03-01", "2024-04-01"])})
filled = df.fillna({"a": 0, "b": "?"})
print(df.dtypes.to_string()); print(filled.to_string()); print(df.isna().sum().to_string()); print(df["a"].astype("Int64").to_string())
`),
  P("pandas: duplicates, concat, in-place mutation, aliasing", `
import pandas as pd
a = pd.DataFrame({"k": [1, 1, 2], "v": [5, 5, 6]})
b = a
b["w"] = b["v"] * 2
c = a.copy(); c.loc[0, "v"] = 99
d = pd.concat([a, c], ignore_index=True).drop_duplicates()
a.drop(columns=["w"], inplace=True)
print(a.to_string()); print(c.to_string()); print(d.to_string()); print(a is b)
`),
  P("pandas: chained assignment warning goes to stderr identically", `
import pandas as pd
df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
sub = df[df["a"] > 1]
sub["c"] = 1
print(df.columns.tolist(), sub.columns.tolist())
`),
  P("pandas: operation that raises (KeyError on a missing column)", `
import pandas as pd
df = pd.DataFrame({"a": [1, 2]})
print(df.shape)
print(df["missing"])
`),
  P("pandas: operation that raises (merge validate)", `
import pandas as pd
a = pd.DataFrame({"k": [1, 1], "x": [1, 2]})
b = pd.DataFrame({"k": [1, 1], "y": [3, 4]})
a.merge(b, on="k", validate="one_to_one")
`),
  P("pandas: apply, string methods, cut, value_counts", `
import pandas as pd
df = pd.DataFrame({"name": ["ann smith", "bo li", "cy ng"], "age": [23, 41, 67]})
df["first"] = df["name"].str.split().str[0].str.title()
df["band"] = pd.cut(df["age"], [0, 30, 60, 100], labels=["young", "mid", "senior"])
print(df.to_string()); print(df["band"].value_counts().to_string()); print(df.dtypes.to_string())
`),
  P("numpy: broadcasting, reshape, masks", `
import numpy as np
a = np.arange(12).reshape(3, 4)
row = np.array([10, 20, 30, 40]); col = np.array([[1], [2], [3]])
print(a + row); print(a * col); print(a[a % 2 == 0]); print(a.T.shape, a.reshape(-1, 6).shape, a.sum(axis=0), a.mean(axis=1))
print(a.dtype, (a > 5).dtype, a.astype(float).dtype)
`),
  P("numpy: views vs copies (aliasing)", `
import numpy as np
a = np.arange(6)
view = a[::2]; view[0] = 99
cp = a.copy(); cp[1] = -1
b = a.reshape(2, 3); b[0, 0] = 7
print(a, view, cp, b, np.shares_memory(a, view), np.shares_memory(a, cp))
`),
  P("numpy: seeded random", `
import numpy as np
rng = np.random.default_rng(42)
x = rng.normal(size=5).round(4); y = rng.integers(0, 10, size=5)
np.random.seed(7)
z = np.random.rand(3).round(4)
print(x, y, z, x.dtype, y.dtype)
`),
  P("numpy: operation that raises (bad reshape)", `
import numpy as np
a = np.arange(10)
print(a.size)
b = a.reshape(3, 4)
`),
  P("numpy: operation that raises (shape mismatch broadcast)", `
import numpy as np
a = np.ones((3, 2)); b = np.ones((4,))
print(a.shape)
print(a + b)
`),
  P("numpy: integer overflow wraps and nan arithmetic with warnings", `
import numpy as np
a = np.array([250, 5], dtype=np.uint8)
print(a + np.uint8(10))
with np.errstate(all="ignore"):
    print(np.array([1.0, 0.0]) / np.array([0.0, 0.0]))
print(np.nanmean(np.array([1.0, np.nan, 3.0])))
`),
  P("pandas + numpy: arrays and Series together, sys.exit afterwards", `
import numpy as np, pandas as pd, sys
s = pd.Series(np.linspace(0, 1, 5), index=list("abcde"))
print((s * 2).round(2).to_string()); print(s.idxmax(), s.dtype)
sys.exit(4)
`),
];

describe.skipIf(!hasPandas)("equivalence (pandas and NumPy): Mode A vs Mode B", () => {
  for (const p of DATA) it(p.name, async () => { await equivalent(p); }, 180_000);
  it("dtypes, results and the exception are compared, not just printed text (spot-check one program end to end)", async () => {
    const { a, b } = await equivalent(DATA.find((d) => d.name.startsWith("pandas: dtype conversion"))!);
    expect(a.globals!.n![0]).toBe("Series");
    expect(b.globals!.n).toEqual(a.globals!.n);
    expect(b.stdout).toContain("<NA>");
  });
  it("KNOWN DIFFERENCE check is not needed for data frames: serialising a DataFrame leaves it unchanged (copy-on-write state, columns, dtypes)", async () => {
    const { b } = await equivalent(P("df untouched", `
import pandas as pd
df = pd.DataFrame({"a": [1, 2, 3], "b": [1.5, None, 2.5]})
view = df[["a"]]
x = 1
y = 2
print(df._is_copy is None, view._is_copy is not None)
print(df.dtypes.astype(str).tolist(), df["a"].is_monotonic_increasing)
`));
    expect(b.stdout).toContain("True True");
  });
});
