// @vitest-environment node
// Error diagnosis for Python exercises. Every case runs the code in REAL CPython, feeds the real traceback (and, where noted, the real
// trace) to the diagnoser, and, when the diagnoser offers a patch, applies it and runs the patched code again.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { applyFix, closest, definedNames, diagnose, diagnoseAll, mutableDefaults, parseErrorText, sourceFindings, staticLoopFindings, functionsWithoutReturn } from "../site/lib/visual/pyDiagnose";
import { buildTraceProgram, parseTrace, type Trace } from "../site/lib/visual/pyTrace";

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;

const run = (code: string) => {
  const r = spawnSync(PYTHON, ["-I", "-"], { input: code, encoding: "utf8", timeout: 30_000 });
  return { ok: r.status === 0, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
};
const traceOf = (code: string): Trace => {
  const r = spawnSync(PYTHON, ["-I", "-"], { input: buildTraceProgram(code), encoding: "utf8", timeout: 60_000 });
  const t = parseTrace(r.stdout);
  if (!t) throw new Error(`no trace: ${r.stderr}`);
  return t;
};

interface Case { name: string; code: string; type: string; cls: string; category?: string; fix?: boolean; patchedOk?: boolean; mentions?: string }

const CASES: Case[] = [
  // Syntax and indentation
  { name: "missing colon", code: "x = 3\nif x > 1\n    print(x)\n", type: "SyntaxError", cls: "missing-colon", category: "syntax", fix: true },
  { name: "= in condition", code: "x = 3\nif x = 3:\n    print(x)\n", type: "SyntaxError", cls: "assign-in-condition", fix: true },
  { name: "print statement", code: "print \"hi\"\n", type: "SyntaxError", cls: "print-statement", fix: true },
  { name: "unterminated string", code: "msg = 'hello\nprint(msg)\n", type: "SyntaxError", cls: "unterminated-string" },
  { name: "unclosed bracket", code: "nums = [1, 2, 3\nprint(nums)\n", type: "SyntaxError", cls: "unclosed-bracket" },
  { name: "missing indent", code: "def f():\nreturn 1\n", type: "IndentationError", cls: "missing-indent", category: "syntax" },
  { name: "unexpected indent", code: "x = 1\n    y = 2\n", type: "IndentationError", cls: "unexpected-indent" },
  { name: "bad dedent", code: "if True:\n        x = 1\n    y = 2\n", type: "IndentationError", cls: "bad-dedent" },
  // Names
  { name: "misspelt name", code: "total = 5\nprint(totl)\n", type: "NameError", cls: "name-typo", fix: true },
  { name: "missing import", code: "print(math.sqrt(16))\n", type: "NameError", cls: "missing-import", fix: true },
  { name: "lowercase true", code: "ready = true\nprint(ready)\n", type: "NameError", cls: "name-typo", fix: true },
  { name: "used before definition", code: "print(value)\nvalue = 3\n", type: "NameError", cls: "used-before-definition" },
  { name: "scope", code: "def make():\n    inner = 3\nmake()\nprint(inner)\n", type: "NameError", cls: "scope" },
  { name: "unbound local", code: "count = 0\ndef inc():\n    count += 1\ninc()\n", type: "UnboundLocalError", cls: "unbound-local", category: "functions" },
  // Types and arguments
  { name: "str + int", code: "total = 5\nprint('Total: ' + total)\n", type: "TypeError", cls: "type-mismatch", category: "data types" },
  { name: "compare str and int", code: "age = '30'\nprint(age > 18)\n", type: "TypeError", cls: "type-mismatch" },
  { name: "too many arguments", code: "def add(a, b):\n    return a + b\nprint(add(1, 2, 3))\n", type: "TypeError", cls: "wrong-arguments", category: "functions", mentions: "def add(a, b)" },
  { name: "missing argument", code: "def add(a, b):\n    return a + b\nprint(add(1))\n", type: "TypeError", cls: "wrong-arguments", mentions: "b" },
  { name: "unexpected keyword", code: "def add(a, b):\n    return a + b\nprint(add(1, c=2))\n", type: "TypeError", cls: "wrong-arguments", mentions: "c=" },
  { name: "method without self", code: "class A:\n    def hi():\n        return 1\nprint(A().hi())\n", type: "TypeError", cls: "missing-self", fix: true },
  { name: "None subscript from sort()", code: "items = [3, 1, 2]\nordered = items.sort()\nprint(ordered[0])\n", type: "TypeError", cls: "unexpected-none", mentions: "returns None" },
  { name: "None from a function without return", code: "def double(x):\n    y = x * 2\nresult = double(4)\nprint(result + 1)\n", type: "TypeError", cls: "unexpected-none", category: "functions", mentions: "no return" },
  { name: "shadowed builtin", code: "sum = 0\nprint(sum([1, 2]))\n", type: "TypeError", cls: "shadowed-builtin" },
  { name: "float index", code: "items = [1, 2, 3, 4]\nprint(items[len(items) / 2])\n", type: "TypeError", cls: "bad-index-type", fix: true },
  { name: "float range", code: "n = 6\nfor i in range(n / 2):\n    print(i)\n", type: "TypeError", cls: "bad-index-type", fix: true },
  { name: "unhashable", code: "d = {}\nd[[1, 2]] = 3\n", type: "TypeError", cls: "unhashable", category: "collections" },
  { name: "int not subscriptable", code: "n = 5\nprint(n[0])\n", type: "TypeError", cls: "not-subscriptable" },
  { name: "int not iterable", code: "for d in 123:\n    print(d)\n", type: "TypeError", cls: "not-iterable" },
  { name: "str item assignment", code: "s = 'cat'\ns[0] = 'b'\n", type: "TypeError", cls: "immutable-assign" },
  // Values
  { name: "int('abc')", code: "n = int('abc')\n", type: "ValueError", cls: "bad-conversion", category: "data types" },
  { name: "int('3.5')", code: "n = int('3.5')\n", type: "ValueError", cls: "bad-conversion", mentions: "float(" },
  { name: "unpack too few", code: "a, b = [1]\n", type: "ValueError", cls: "unpack-count" },
  { name: "math domain", code: "import math\nprint(math.sqrt(-1))\n", type: "ValueError", cls: "math-domain" },
  { name: "remove missing", code: "items = [1, 2]\nitems.remove(5)\n", type: "ValueError", cls: "remove-missing" },
  { name: "max of empty", code: "print(max([]))\n", type: "ValueError", cls: "empty-sequence" },
  // Collections and off-by-one
  { name: "range(len + 1)", code: "items = [4, 5, 6]\nfor i in range(len(items) + 1):\n    print(items[i])\n", type: "IndexError", cls: "off-by-one-range", category: "control flow", fix: true },
  { name: "while <= len", code: "items = [4, 5]\ni = 0\nwhile i <= len(items):\n    print(items[i])\n    i += 1\n", type: "IndexError", cls: "wrong-loop-condition", fix: true },
  { name: "items[len(items)]", code: "items = [4, 5]\nprint(items[len(items)])\n", type: "IndexError", cls: "off-by-one" },
  { name: "index of empty list", code: "items = []\nprint(items[0])\n", type: "IndexError", cls: "index-out-of-range", category: "collections" },
  { name: "pop empty", code: "items = []\nitems.pop()\n", type: "IndexError", cls: "empty-pop" },
  { name: "dict counter", code: "counts = {}\nfor w in ['a', 'b', 'a']:\n    counts[w] += 1\nprint(counts)\n", type: "KeyError", cls: "key-missing-counter", fix: true },
  { name: "missing dict key", code: "user = {'name': 'Ana'}\nprint(user['age'])\n", type: "KeyError", cls: "key-missing", category: "collections" },
  // Attributes
  { name: "list.push", code: "items = []\nitems.push(3)\n", type: "AttributeError", cls: "attribute-typo", fix: true },
  { name: "str method typo", code: "name = 'ana'\nprint(name.uper())\n", type: "AttributeError", cls: "attribute-typo", fix: true },
  { name: "self attribute typo", code: "class Acct:\n    def __init__(self):\n        self.balance = 5\na = Acct()\nprint(a.balence)\n", type: "AttributeError", cls: "attribute-typo", fix: true },
  { name: "module attribute typo", code: "import math\nprint(math.sqr(4))\n", type: "AttributeError", cls: "attribute-typo", fix: true },
  { name: "str.append", code: "s = 'ab'\ns.append('c')\n", type: "AttributeError", cls: "wrong-type-method" },
  { name: "None attribute", code: "def find(x):\n    pass\nr = find(1)\nprint(r.name)\n", type: "AttributeError", cls: "unexpected-none" },
  // Runtime
  { name: "zero division", code: "count = 0\ntotal = 10\nprint(total / count)\n", type: "ZeroDivisionError", cls: "zero-division", category: "runtime errors" },
  { name: "average of empty", code: "nums = []\nprint(sum(nums) / len(nums))\n", type: "ZeroDivisionError", cls: "zero-division" },
  { name: "recursion", code: "def f(n):\n    return f(n + 1)\nf(0)\n", type: "RecursionError", cls: "recursion-limit", category: "algorithms" },
  { name: "dict changed size", code: "d = {1: 1, 2: 2}\nfor k in d:\n    d[k + 10] = 1\n", type: "RuntimeError", cls: "mutate-while-iterating", fix: true },
  { name: "assertion", code: "assert 1 + 1 == 3\n", type: "AssertionError", cls: "assertion", category: "unexpected output" },
  { name: "input with no stdin", code: "x = input()\n", type: "EOFError", cls: "no-input" },
  // Imports
  { name: "import typo", code: "import colections\n", type: "ModuleNotFoundError", cls: "module-typo", fix: true, patchedOk: true },
  { name: "numpy typo", code: "import numpyy as np\n", type: "ModuleNotFoundError", cls: "module-typo", fix: true, patchedOk: true },
  { name: "name typo in from-import", code: "from collections import counter\n", type: "ImportError", cls: "import-name-typo", fix: true, patchedOk: true },
  { name: "not available module", code: "import airflow\n", type: "ModuleNotFoundError", cls: "module-unavailable" },
];

describe.skipIf(!hasPython)("diagnosis from real CPython tracebacks", () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.type} -> ${c.cls}`, () => {
      const r = run(c.code);
      expect(r.ok, "the sample program should fail").toBe(false);
      const parsed = parseErrorText(r.stderr);
      expect(parsed?.type).toBe(c.type);
      const d = diagnose({ source: c.code, error: r.stderr })!;
      expect(d.errorType).toBe(c.type);
      expect(d.cls).toBe(c.cls);
      if (c.category) expect(d.category).toBe(c.category);
      // Every diagnosis carries the full explanation, with the failing line when Python names one.
      for (const k of ["rootCause", "why", "correctedApproach", "prevention"] as const) expect(d[k].length, k).toBeGreaterThan(10);
      if (d.line) {
        expect(d.codeLine).toBe(c.code.split("\n")[d.line - 1]);
        expect(d.relevantCode.some((x) => x.current && x.line === d.line)).toBe(true);
      }
      if (c.mentions) expect(`${d.rootCause} ${d.why} ${d.correctedApproach} ${d.evidence.join(" ")}`).toContain(c.mentions);
      if (c.fix) {
        expect(d.fix, "a certain rule must offer a patch").toBeDefined();
        expect(d.confidence).toBe("certain");
        const patched = applyFix(c.code, d.fix!);
        expect(patched).not.toBe(c.code);
        if (c.patchedOk === undefined) {
          const after = run(patched);
          expect(after.ok, `patched code should run:\n${patched}\n${after.stderr}`).toBe(true);
        }
      } else {
        expect(d.fix, "no patch unless the rule is certain and mechanical").toBeUndefined();
      }
    });
  }

  it("patches for imports only change the module name", () => {
    const d = diagnose({ source: "import colections\n", error: run("import colections\n").stderr })!;
    expect(applyFix("import colections\n", d.fix!)).toBe("import collections\n");
    const d2 = diagnose({ source: "from collections import counter\n", error: run("from collections import counter\n").stderr })!;
    expect(applyFix("from collections import counter\n", d2.fix!)).toBe("from collections import Counter\n");
    const d3 = diagnose({ source: "import numpyy as np\n", error: run("import numpyy as np\n").stderr })!;
    expect(applyFix("import numpyy as np\n", d3.fix!)).toBe("import numpy as np\n");
  });

  it("a Pyodide-style traceback with the runner's hint line is read the same way", () => {
    const text = `Traceback (most recent call last):\n  File "<exec>", line 3, in <module>\nNameError: name 'totl' is not defined\n\nHint: that name is used before it is defined. Check the spelling, or define it above.`;
    expect(parseErrorText(text)).toEqual({ type: "NameError", message: "name 'totl' is not defined", line: 3 });
    const d = diagnose({ source: "total = 1\nprint(total)\nprint(totl)\n", error: text })!;
    expect(d.cls).toBe("name-typo");
    expect(d.fix?.after).toBe("print(total)");
  });

  it("the runner's time-limit message becomes a loop diagnosis", () => {
    const code = "i = 0\nwhile i < 5:\n    print(i)\n";
    const d = diagnose({ source: code, error: "Stopped after 10s — check for an infinite loop." })!;
    expect(d.errorType).toBe("TimeoutError");
    expect(d.cls).toBe("wrong-loop-condition");
    expect(d.category).toBe("control flow");
    expect(d.evidence.join(" ")).toContain("Line 2");
    expect(d.fix).toBeUndefined();
  });

  it("never patches when it cannot be certain", () => {
    for (const code of ["def f(x):\n    return x[5]\nprint(f([1]))\n", "nums = [1, 2]\nprint(nums['a'])\n", "x = int('abc')\n"]) {
      const d = diagnose({ source: code, error: run(code).stderr })!;
      expect(d.fix).toBeUndefined();
    }
  });
});

describe.skipIf(!hasPython)("diagnosis with the real trace state before the exception", () => {
  it("ZeroDivisionError names the variable and the line that made it 0", () => {
    const code = "count = 0\nitems = [1, 2]\nfor x in items:\n    pass\nprint(10 / count)\n";
    const t = traceOf(code);
    const d = diagnose({ source: code, trace: t })!;
    expect(d.cls).toBe("zero-division");
    expect(d.stateBefore?.find((s) => s.name === "count")?.value).toBe("0");
    expect(d.evidence.join(" ")).toContain("`count` is 0");
  });
  it("ZeroDivisionError from an empty list says the list is empty", () => {
    const code = "nums = []\nprint(sum(nums) / len(nums))\n";
    const d = diagnose({ source: code, trace: traceOf(code) })!;
    expect(d.evidence.join(" ")).toContain("`nums` is empty");
  });
  it("ZeroDivisionError reports the line that set the divisor to 0", () => {
    const code = "def avg(total, n):\n    return total / n\nn = 5\nn = n - 5\nprint(avg(10, n))\n";
    const t = traceOf(code);
    const d = diagnose({ source: code, trace: t })!;
    expect(d.cls).toBe("zero-division");
    expect(d.line).toBe(2);
    expect(d.stateBefore?.map((s) => s.name)).toEqual(["total", "n"]);
  });
  it("IndexError states the real length and index", () => {
    const code = "items = [4, 5, 6]\ni = 3\nprint(items[i])\n";
    const d = diagnose({ source: code, trace: traceOf(code) })!;
    expect(d.cls).toBe("index-out-of-range");
    expect(d.evidence.join(" ")).toContain("`items` has 3 items (valid indexes 0 to 2, or -1 to -3), and the index `i` is 3");
  });
  it("KeyError lists the keys the dict really had, and a near miss", () => {
    const code = "row = {'Name': 'Ana', 'age': 3}\nprint(row['name'])\n";
    const d = diagnose({ source: code, trace: traceOf(code) })!;
    expect(d.cls).toBe("key-missing");
    expect(d.evidence.join(" ")).toContain("'Name'");
    expect(d.evidence.join(" ")).toContain("case, spaces or quotes differ");
  });
  it("unexpected None names the variable that was None", () => {
    const code = "def load():\n    data = [1]\nrows = load()\nprint(rows[0])\n";
    const d = diagnose({ source: code, trace: traceOf(code) })!;
    expect(d.cls).toBe("unexpected-none");
    expect(d.evidence.join(" ")).toContain("`rows` is None");
    expect(d.evidence.join(" ")).toContain("no return statement");
  });
  it("uses the tracer's own error when there is no traceback text", () => {
    const code = "x = [1]\nprint(x[3])\n";
    const t = traceOf(code);
    expect(t.error?.type).toBe("IndexError");
    expect(diagnose({ source: code, trace: t })?.cls).toBe("index-out-of-range");
  });
  it("a syntax error from the tracer is diagnosed with its line", () => {
    const code = "x = 3\nif x > 1\n    print(x)\n";
    const t = traceOf(code);
    const d = diagnose({ source: code, trace: t })!;
    expect(d.cls).toBe("missing-colon");
    expect(d.line).toBe(2);
  });
  it("RecursionError uses the trace's recursion note", () => {
    const code = "def f(n):\n    return f(n + 1)\nf(0)\n";
    const t = traceOf(code);
    const d = diagnose({ source: code, trace: t })!;
    expect(d.cls).toBe("recursion-limit");
    expect(d.evidence.join(" ")).toContain("`f` calling itself");
  });
});

describe.skipIf(!hasPython)("source-level findings: mutable default argument, missing return, wrong loop condition", () => {
  const code = "def add(x, items=[]):\n    items.append(x)\n    return items\nprint(add(1))\nprint(add(2))\n";
  it("finds a mutable default and its patch removes the bug", () => {
    expect(mutableDefaults(code)).toMatchObject([{ fn: "add", param: "items", value: "[]", line: 1 }]);
    const d = sourceFindings(code)[0];
    expect(d.cls).toBe("mutable-default");
    expect(d.category).toBe("functions");
    expect(d.fix?.after).toBe("def add(x, items=None):\n    if items is None:\n        items = []");
    expect(run(code).stdout).toBe("[1]\n[1, 2]\n"); // the bug, in real CPython
    const patched = applyFix(code, d.fix!);
    expect(run(patched).stdout).toBe("[1]\n[2]\n");
  });
  it("shows from the trace that two calls shared one list", () => {
    const d = sourceFindings(code, undefined, traceOf(code))[0];
    expect(d.evidence.join(" ")).toMatch(/same object \(#\d+\) in 2 different calls/);
  });
  it("finds {} and set() defaults, and leaves None defaults alone", () => {
    expect(mutableDefaults("def f(a={}, b=set(), c=None, d=0):\n    pass\n").map((m) => m.param)).toEqual(["a", "b"]);
    expect(mutableDefaults("def f(a=None):\n    pass\n")).toEqual([]);
  });
  it("gives no patch when the body starts with a docstring (the guard would go after it)", () => {
    const d = sourceFindings('def f(x, a=[]):\n    "doc"\n    a.append(x)\n    return a\n')[0];
    expect(d.cls).toBe("mutable-default");
    expect(d.fix).toBeUndefined();
  });
  it("a function with no return that the tests call is reported", () => {
    const src = "def double(x):\n    x * 2\n";
    expect(functionsWithoutReturn(src)).toEqual([{ name: "double", line: 1 }]);
    const f = sourceFindings(src, "assert double(2) == 4")[0];
    expect(f.cls).toBe("missing-return");
    expect(sourceFindings(src, "assert other(2) == 4")).toEqual([]);
  });
  it("diagnoseAll adds source findings to an assertion failure", () => {
    const src = "def add(x, items=[]):\n    items.append(x)\n    return items\n";
    const all = diagnoseAll({ source: src, error: "AssertionError: assert add(2) == [2]", tests: "assert add(1) == [1]\nassert add(2) == [2]" });
    expect(all.map((d) => d.cls)).toEqual(["assertion", "mutable-default"]);
  });
  it("finds while loops whose condition cannot change", () => {
    expect(staticLoopFindings("i = 0\nwhile i < 5:\n    print(i)\n")).toMatchObject([{ line: 2, vars: ["i"] }]);
    expect(staticLoopFindings("i = 0\nwhile i < 5:\n    i += 1\n")).toEqual([]);
    expect(staticLoopFindings("while True:\n    pass\n")).toHaveLength(1);
    expect(staticLoopFindings("while True:\n    break\n")).toEqual([]);
  });
});

describe("helpers", () => {
  it("closest picks one clear winner and refuses ties", () => {
    expect(closest("totl", ["total", "count"])?.word).toBe("total");
    expect(closest("cat", ["car", "cap"])).toBeNull();
    expect(closest("Counter", ["counter"])?.word).toBe("counter");
    expect(closest("zzzz", ["total"])).toBeNull();
  });
  it("definedNames sees assignments, params, imports, loops and classes", () => {
    const n = definedNames("import os as o\nfrom math import sqrt, pi\ndef f(a, b=1, *args):\n    c = 1\nfor i, j in []:\n    pass\nclass K:\n    pass\nwith open('x') as fh:\n    pass\n");
    for (const name of ["o", "sqrt", "pi", "f", "a", "b", "args", "c", "i", "j", "K", "fh"]) expect(n.has(name), name).toBe(true);
  });
  it("parseErrorText reads detected-at lines and refuses non-errors", () => {
    expect(parseErrorText("SyntaxError: unterminated string literal (detected at line 4)")).toMatchObject({ type: "SyntaxError", line: 4, message: "unterminated string literal" });
    expect(parseErrorText("all good")).toBeNull();
    expect(diagnose({ source: "x = 1" })).toBeNull();
  });
  it("an error of a kind with no special rule still gets the full explanation", () => {
    const d = diagnose({ source: "x = 1\n", error: "Traceback (most recent call last):\n  File \"<exec>\", line 1, in <module>\nUnicodeDecodeError: 'utf-8' codec can't decode byte 0xff" })!;
    expect(d.category).toBe("runtime errors");
    expect(d.confidence).toBe("likely");
    expect(d.correctedApproach).toBeTruthy();
  });
});
