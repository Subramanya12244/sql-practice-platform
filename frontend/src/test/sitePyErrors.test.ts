import { describe, expect, it } from "vitest";
import { cleanPyTraceback, friendlyPyError } from "../site/lib/pyErrors";

const RAW = `Traceback (most recent call last):
  File "/lib/python313.zip/_pyodide/_base.py", line 574, in eval_code_async
    await CodeRunner(
        optimize=optimize,
        ^^^^^^^^^^^^^^^^^^
    )
  File "<exec>", line 3, in <module>
    total = price / 0
ZeroDivisionError: division by zero`;

describe("python error cleanup", () => {
  it("drops runner frames and keeps the learner's frame and the exception", () => {
    const out = cleanPyTraceback(RAW);
    expect(out).not.toMatch(/optimize|_pyodide|CodeRunner/);
    expect(out).toContain('File "<exec>", line 3');
    expect(out).toContain("total = price / 0");
    expect(out).toContain("ZeroDivisionError: division by zero");
  });
  it("adds a hint for known exception types only", () => {
    expect(friendlyPyError(RAW)).toMatch(/Hint: guard the divisor/);
    expect(friendlyPyError("ValueError: nope")).toBe("ValueError: nope");
  });
  it("never returns empty for non-traceback text", () => {
    expect(friendlyPyError("Worker crashed: boom")).toBe("Worker crashed: boom");
  });
});

describe("isTypingTarget", () => {
  it("treats Monaco's edit-context div as a text field, not a page shortcut target", async () => {
    const { isTypingTarget } = await import("../site/components/SiteLayout");
    const wrap = document.createElement("div"); wrap.className = "monaco-editor";
    const ctx = document.createElement("div"); ctx.className = "native-edit-context"; wrap.appendChild(ctx);
    document.body.appendChild(wrap);
    expect(isTypingTarget(ctx)).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
  });
});
