// PythonWorkspace keeps its grading and gains the Python adapter's "Why it failed" reading. The runner is mocked with output captured
// from real Pyodide (tracebacks name every frame <exec>, with no source text).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PyResult } from "../site/lib/pyRunner";

const calls: { code: string; tests?: string }[] = [];
let next: (code: string, tests?: string) => PyResult = () => ({ ok: true, stdout: "", ms: 1 });
vi.mock("../site/lib/pyRunner", () => ({
  PY_TIMEOUT_MS: 10000, isPythonWarmed: () => true, stopPython: () => undefined, resetPython: () => undefined,
  runPython: (code: string, tests?: string) => { calls.push({ code, tests }); return Promise.resolve(next(code, tests)); },
}));
vi.mock("../site/components/CodeEditor", () => ({
  default: ({ value, onChange, errorLine, label }: { value: string; onChange: (v: string) => void; errorLine?: number | null; label: string }) => <textarea aria-label={label} data-error-line={errorLine ?? ""} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
import { PythonWorkspace } from "../site/components/PythonWorkspace";

const TASK = { id: "t", title: "Average", type: "python" as const, instructions: "", starter: "def total(xs):\n    return sum(xs) / len(xs)\n", solution: "", tests: "assert total([2, 4]) == 3\nassert total([]) == 0\n" };
const mount = (cb: { onCheckResult?: (r: unknown) => void; onRunResult?: (r: unknown) => void } = {}) =>
  render(<MemoryRouter><PythonWorkspace slug="t-avg" title="Average" task={TASK} defaultFiles={[{ name: "solution.py", content: TASK.starter }, { name: "main.py", content: "print(total([1]))\n" }]} {...cb} /></MemoryRouter>);

beforeEach(() => { calls.length = 0; localStorage.clear(); });

describe("PythonWorkspace: failure help from the Python adapter", () => {
  it("a failed check explains a runtime error inside the learner's function and marks that line (Pyodide traceback, no source text)", async () => {
    next = (_c, tests) => tests
      ? { ok: false, phase: "tests", stdout: "", ms: 3, error: 'Traceback (most recent call last):\n  File "<exec>", line 2, in <module>\n  File "<exec>", line 2, in total\nZeroDivisionError: division by zero\n\nHint: guard the divisor so it is never 0.' }
      : { ok: true, stdout: "", ms: 1 };
    const onCheck = vi.fn();
    mount({ onCheckResult: onCheck });
    fireEvent.click(await screen.findByRole("button", { name: /Check Tests/ }));
    const help = await screen.findByTestId("py-failure-help");
    expect(help.textContent).toMatch(/ZeroDivisionError/);
    expect(help.textContent).toMatch(/line 2/);
    expect(document.querySelector("textarea[data-error-line='2']")).toBeTruthy();
    // grading and progress callback are unchanged: one callback, a failed result
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect((onCheck.mock.calls[0][0] as { ok: boolean }).ok).toBe(false);
  });
  it("a failed assert names no line of the learner's code", async () => {
    next = (_c, tests) => tests
      ? { ok: false, phase: "tests", stdout: "", ms: 3, error: 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nAssertionError' }
      : { ok: true, stdout: "", ms: 1 };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Check Tests/ }));
    await screen.findByText(/Tests Incomplete/);
    expect(document.querySelector("textarea[data-error-line='1']")).toBeNull();
    const help = screen.queryByTestId("py-failure-help");
    if (help) expect(help.textContent).not.toMatch(/line 1\b/);
  });
  it("a passing check shows no failure help", async () => {
    next = () => ({ ok: true, stdout: "", ms: 2 });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Check Tests/ }));
    await screen.findByText(/All Tests Passed/);
    expect(screen.queryByTestId("py-failure-help")).toBeNull();
  });
  it("a failed Run explains the error from the file's own code, and a stop explains nothing", async () => {
    next = () => ({ ok: false, phase: "code", stdout: "", ms: 2, errorLine: 1, error: 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nNameError: name \'total\' is not defined' });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Run Script/ }));
    expect((await screen.findByTestId("py-failure-help")).textContent).toMatch(/NameError/);
    next = () => ({ ok: false, phase: "stopped", stdout: "", ms: 2, error: "Stopped." });
    fireEvent.click(screen.getByRole("button", { name: /Run Script/ }));
    await screen.findByText(/Stopped\./);
    expect(screen.queryByTestId("py-failure-help")).toBeNull();
  });
});
