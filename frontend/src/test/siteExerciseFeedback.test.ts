import { describe, expect, it } from "vitest";
import { firstDifference, sameOutput } from "../site/lib/daily";
import { friendlyPyError } from "../site/lib/pyErrors";
import { explainError } from "../site/lib/errorHelp";

describe("expected versus actual output", () => {
  it("finds the first differing line, after the same normalisation as the grader", () => {
    expect(firstDifference("a\nb\nc", "a\nb\nc")).toBeNull();
    expect(firstDifference("a\nb  \n\n", "a\nb")).toBeNull(); // trailing spaces and blank lines do not count
    expect(firstDifference("a\nb\nc", "a\nX\nc")).toEqual({ line: 2, expected: "b", actual: "X" });
  });
  it("reports a missing or an extra line", () => {
    expect(firstDifference("a\nb", "a")).toEqual({ line: 2, expected: "b", actual: null });
    expect(firstDifference("a", "a\nextra")).toEqual({ line: 2, expected: null, actual: "extra" });
  });
  it("agrees with sameOutput: no difference exactly when the output matches", () => {
    for (const [e, a] of [["1\n2", "1\n2"], ["1\n2", "1\n3"], ["x", ""], ["", ""], ["a\r\nb", "a\nb"]] as const) {
      expect(firstDifference(e, a) === null).toBe(sameOutput(e, a));
    }
  });
});

describe("error explanations", () => {
  it("adds a plain-language hint to a Python error and keeps the traceback", () => {
    const out = friendlyPyError("Traceback (most recent call last):\n  File \"<exec>\", line 1, in <module>\nNameError: name 'total' is not defined");
    expect(out).toContain("NameError: name 'total' is not defined");
    expect(out).toContain("Hint: that name is used before it is defined");
  });
  it("explains a SQL error and names the fix", () => {
    const h = explainError('column "o.customer_id" must appear in the GROUP BY clause or be used in an aggregate function');
    expect(h?.title).toBe("Column not grouped");
    expect(h?.fix).toContain("GROUP BY");
  });
  it("says nothing it does not know", () => {
    expect(explainError("something nobody has seen")).toBeNull();
  });
});
