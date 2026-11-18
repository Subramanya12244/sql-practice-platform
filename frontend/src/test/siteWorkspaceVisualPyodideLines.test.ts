import { describe, expect, it } from "vitest";
import { learnerLine, scrubTestFrames, taskFailureFeedback, explainPythonFailure } from "../site/workspace/adapters/python/failure";

// Tracebacks captured from REAL Pyodide 0.29 in Chromium (scratch script, 2026-11-18): the runner names every frame File "<exec>",
// the tests' frames too, and Pyodide prints NO source text under any frame. The strings below are verbatim.
const CODE = "def total(xs):\n    return sum(xs) / len(xs)\n";
const TESTS = "assert total([]) == 0\n";
const RUNTIME = 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\n  File "<exec>", line 2, in total\nZeroDivisionError: division by zero\n\nHint: guard the divisor so it is never 0.';
const RUNTIME_COUNTING = 'Traceback (most recent call last):\n  File "<exec>", line 25, in <module>\n  File "<exec>", line 10, in <module>\n  File "<exec>", line 2, in total\nZeroDivisionError: division by zero\n\nHint: guard the divisor so it is never 0.';
const ASSERT = 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nAssertionError';
const SYNTAX = 'Traceback (most recent call last):\n  File "<exec>", line 1\n    def total(xs)\n                 ^\nSyntaxError: expected \':\'\n\nHint: check for a missing colon, an unclosed bracket or quote, or a typo near the marked line.';

describe("learnerLine on Pyodide's source-less tracebacks", () => {
  it("takes the line of a frame inside a function the learner defined", () => {
    expect(learnerLine(CODE, RUNTIME, undefined, TESTS)).toBe(2);
    expect(learnerLine(CODE, RUNTIME_COUNTING, undefined, TESTS)).toBe(2);
  });
  it("never takes a line from the tests' own frames (an assert at line 1 of the tests is not line 1 of the code)", () => {
    expect(learnerLine(CODE, ASSERT, undefined, TESTS)).toBeUndefined();
    expect(learnerLine("x = 1\nprint(x)\n", 'Traceback (most recent call last):\n  File "<exec>", line 2, in <module>\nAssertionError', undefined, "assert x == 2\n\nassert x == 3\n")).toBeUndefined();
  });
  it("rejects a frame whose function the tests define, or whose line is outside the function's body", () => {
    expect(learnerLine(CODE, RUNTIME, undefined, "def total(x):\n    return 0\nassert total([]) == 0\n")).toBeUndefined();
    expect(learnerLine(CODE, RUNTIME.replace("line 2, in total", "line 9, in total"), undefined, TESTS)).toBeUndefined();
  });
  it("still reads a compile-time SyntaxError (the source line is printed) and the worker's own plain-run line", () => {
    expect(learnerLine("def total(xs)\n    return 1\n", SYNTAX.replace("def total(xs)\n", "def total(xs)\n"), undefined, TESTS)).toBe(1);
    expect(learnerLine(CODE, RUNTIME, 7, TESTS)).toBe(7);
  });
  it("picks the innermost learner frame when learner functions call each other", () => {
    const code = "def a(x):\n    return b(x)\n\ndef b(x):\n    return 1 / x\n";
    const tb = 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\n  File "<exec>", line 2, in a\n  File "<exec>", line 5, in b\nZeroDivisionError: division by zero';
    expect(learnerLine(code, tb, undefined, "assert a(0) == 1\n")).toBe(5);
  });
});

describe("test-run diagnoses never point at the tests", () => {
  it("scrubTestFrames renames only the frames that are not the learner's", () => {
    const s = scrubTestFrames(CODE, RUNTIME_COUNTING, TESTS);
    expect(s).toContain('File "<tests>", line 25');
    expect(s).toContain('File "<tests>", line 10');
    expect(s).toContain('File "<exec>", line 2, in total');
  });
  it("a runtime error inside the learner's function is diagnosed on that line", () => {
    const fb = taskFailureFeedback({ code: CODE, tests: TESTS, message: "A test raised: Hint: guard the divisor so it is never 0.", output: RUNTIME, phase: "tests" });
    expect(fb[0].line).toBe(2);
    expect(fb[0].category).toBe("runtime errors");
  });
  it("a failed assert has no learner line, so the diagnosis does not name one", () => {
    const fb = taskFailureFeedback({ code: "x = 1\nprint(x)\n", tests: "assert x == 2\n", message: "A test failed.", output: 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nAssertionError', phase: "tests" });
    for (const f of fb) { expect(f.line).toBeUndefined(); expect(f.message).not.toMatch(/line 1\b/); }
  });
  it("without tests (a plain Run) the traceback is used as the worker gave it", () => {
    const fb = explainPythonFailure({ code: "xs = [1]\nprint(xs[3])\n", errorText: 'Traceback (most recent call last):\n  File "<exec>", line 2, in <module>\nIndexError: list index out of range', line: 2 });
    expect(fb[0].line).toBe(2);
  });
});
