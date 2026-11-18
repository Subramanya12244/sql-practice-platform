// The Python trace visualizer, rendered from REAL traces (recorded in CPython, wrapped by the adapter's own model builder).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildTraceProgram, parseTrace, type TraceOptions } from "../site/lib/visual/pyTrace";
import { buildPythonVisualModel, type PythonVisualData } from "../site/workspace/adapters/python/model";
import { PythonTraceVisualizer } from "../site/workspace/visualizers/python/PythonTraceVisualizer";
import { Visualizer as LazyVisualizer } from "../site/workspace/visualizers/python/LazyPythonVisualizer";
import { resolveAdapter } from "../site/workspace/registry";
import type { VisualModel } from "../site/workspace/types";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
afterEach(cleanup);

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;

function modelOf(code: string, opts?: Partial<TraceOptions>): VisualModel {
  const r = spawnSync(PYTHON, ["-I", "-"], { input: buildTraceProgram(code, opts), encoding: "utf8", timeout: 60_000 });
  const t = parseTrace(r.stdout);
  const m = t && buildPythonVisualModel(code, t);
  if (!m) throw new Error(`no model: ${r.stderr}`);
  return m;
}
const dataOf = (m: VisualModel) => m.data as PythonVisualData;
const stepWhere = (m: VisualModel, f: (s: PythonVisualData["trace"]["steps"][number], i: number) => boolean) => dataOf(m).trace.steps.findIndex(f);
const view = (m: VisualModel, step: number, extra: { reducedMotion?: boolean; onStepChange?: (i: number) => void } = {}) =>
  render(<PythonTraceVisualizer model={m} step={step} onStepChange={extra.onStepChange ?? (() => {})} reducedMotion={extra.reducedMotion ?? false} />);

const CALLS = "def add(a, b):\n    total = a + b\n    return total\ndef twice(x):\n    y = add(x, x)\n    return y\nr = twice(3)\nprint(r)\n";

describe.skipIf(!hasPython)("PythonTraceVisualizer: stepping controls", () => {
  const m = modelOf(CALLS);
  const callLine = stepWhere(m, (s) => s.ev === "line" && s.line === 7);
  it("step back and restart are disabled at the first step; into, over are enabled", () => {
    view(m, 0);
    expect(screen.getByRole("button", { name: "Step back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restart" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Step into" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Step out" })).toBeDisabled(); // main program: nothing to step out to
  });
  it("step over from the call line moves to the next top-level line; into goes inside", () => {
    const on = vi.fn();
    const { rerender } = view(m, callLine, { onStepChange: on });
    fireEvent.click(screen.getByRole("button", { name: "Step over" }));
    const to = on.mock.calls[0][0] as number;
    expect(dataOf(m).trace.steps[to]).toMatchObject({ line: 8 });
    // The host (the shared player) applies the step; the note then explains the move that led here.
    rerender(<PythonTraceVisualizer model={m} step={to} onStepChange={on} reducedMotion={false} />);
    expect(screen.getByTestId("step-note").textContent).toContain("Step over");
    rerender(<PythonTraceVisualizer model={m} step={callLine} onStepChange={on} reducedMotion={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Step into" }));
    expect(on.mock.calls[1][0]).toBe(callLine + 1);
  });
  it("step out inside a function lands in the caller", () => {
    const on = vi.fn();
    const inAdd = stepWhere(m, (s) => s.ev === "line" && s.line === 2);
    view(m, inAdd, { onStepChange: on });
    fireEvent.click(screen.getByRole("button", { name: "Step out" }));
    const to = on.mock.calls[0][0] as number;
    expect(dataOf(m).trace.steps[to].frames.length).toBe(2);
    expect(dataOf(m).trace.steps[to].line).toBe(6);
  });
  it("shows the previous, current and next line", () => {
    const { container } = view(m, stepWhere(m, (s) => s.ev === "line" && s.line === 2));
    const marks = [...container.querySelectorAll("[data-mark]")].map((li) => `${li.getAttribute("data-mark")}:${li.textContent?.match(/^\d+/)?.[0]}`);
    expect(marks).toEqual(expect.arrayContaining(["now:2", "prev:1", "next:3"]));
  });
  it("restart goes to step 0", () => {
    const on = vi.fn();
    view(m, 5, { onStepChange: on });
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(on).toHaveBeenCalledWith(0);
  });
});

describe.skipIf(!hasPython)("PythonTraceVisualizer: variables, call stack, return values", () => {
  const m = modelOf(CALLS);
  it("variable inspector shows name, value, type, scope and a changed flag", () => {
    const at = stepWhere(m, (s) => s.ev === "line" && s.line === 3 && s.frames.length === 3);
    view(m, at);
    const table = screen.getByRole("table", { name: "Variable inspector" });
    const row = (name: string) => within(table).getAllByText(name).map((el) => el.closest("tr")!)[0];
    const total = row("total");
    expect(total.textContent).toContain("6");
    expect(total.textContent).toContain("int");
    expect(total.textContent).toContain("add()");
    expect(total.getAttribute("data-changed")).toBe("new");
    expect(row("a").textContent).toContain("add()");
    expect(within(table).getByText("x").closest("tr")!.textContent).toContain("twice()");
  });
  it("a changed variable is flagged with its previous value", () => {
    const code = "n = 1\nn = n + 4\nprint(n)\n";
    const mm = modelOf(code);
    view(mm, stepWhere(mm, (s) => s.line === 3 && s.ev === "line"));
    const row = within(screen.getByRole("table", { name: "Variable inspector" })).getByText("n").closest("tr")!;
    expect(row.getAttribute("data-changed")).toBe("changed");
    expect(row.textContent).toContain("was 1");
    expect(row.textContent).toContain("global");
  });
  it("the call stack lists each frame with the arguments it was called with", () => {
    view(m, stepWhere(m, (s) => s.ev === "line" && s.line === 3 && s.frames.length === 3));
    const stack = screen.getByRole("list", { name: "Call stack, innermost first" });
    const items = within(stack).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("add(a=3, b=3)");
    expect(items[1]).toContain("twice(x=3)");
    expect(items[2]).toContain("main program");
  });
  it("a return step shows the returned value", () => {
    view(m, stepWhere(m, (s) => s.ev === "return" && s.frames.length === 3));
    expect(screen.getByTestId("return-value").textContent).toContain("Returns 6");
  });
  it("a call step names the function and its arguments", () => {
    view(m, stepWhere(m, (s) => s.ev === "call" && s.frames.length === 3));
    expect(screen.getByText(/Entering/).textContent).toContain("a = 3, b = 3");
  });
  it("lists and dicts are drawn through the shared value view", () => {
    const mm = modelOf("xs = [1, 2]\nd = {'k': 5}\nprint(len(xs))\n");
    view(mm, stepWhere(mm, (s) => s.line === 3 && s.ev === "line"));
    expect(screen.getByRole("list", { name: "list with 2 items" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "dict with 1 items" })).toBeInTheDocument();
  });
});

describe.skipIf(!hasPython)("PythonTraceVisualizer: conditions, branches and loops", () => {
  const code = "total = 0\nfor i in range(3):\n    if i % 2 == 0:\n        total += i\nprint(total)\n";
  const m = modelOf(code);
  it("a condition line shows its operands, result and the evidence for it", () => {
    const ifs = dataOf(m).trace.steps.map((s, i) => (s.line === 3 ? i : -1)).filter((i) => i >= 0);
    view(m, ifs[0]);
    const card = screen.getByTestId("branch-card");
    expect(card.getAttribute("data-outcome")).toBe("true");
    expect(card.textContent).toContain("i % 2 == 0");
    expect(card.textContent).toContain("i = 0");
    expect(card.textContent).toContain("next executed line is 4");
    cleanup();
    view(m, ifs[1]);
    expect(screen.getByTestId("branch-card").getAttribute("data-outcome")).toBe("false");
  });
  it("the loop panel shows the iteration, the loop variable and the whole-run total", () => {
    const body = stepWhere(m, (s) => s.line === 4 && s.ev === "line");
    view(m, body);
    expect(screen.getByTestId("loop-card").textContent).toContain("Iteration 1 of 3 in the whole run");
    expect(screen.getByTestId("loop-card").textContent).toContain("i = 0");
  });
  it("the statement after a loop says how it ended", () => {
    view(m, stepWhere(m, (s) => s.line === 5 && s.ev === "line"));
    expect(screen.getByTestId("loop-exit").textContent).toContain("ran out of items");
  });
  it("exact branch counts are available for the whole run", () => {
    view(m, 0);
    fireEvent.click(screen.getByText("Branch and loop counts for the whole run"));
    const table = screen.getByRole("table", { name: "Branch and loop counts" });
    const ifRow = within(table).getByText("if i % 2 == 0").closest("tr")!;
    expect(ifRow.textContent).toContain("3");
    expect(ifRow.textContent).toContain("2");
  });
  it("a line that is neither says so", () => {
    view(m, 0);
    expect(screen.getByText("The marked line is not a condition or inside a loop.")).toBeInTheDocument();
  });
});

describe.skipIf(!hasPython)("PythonTraceVisualizer: sampled traces", () => {
  const m = modelOf("t = 0\nfor i in range(300):\n    t += i\nprint(t)\n", { loopHead: 3, loopTail: 3 });
  const g = dataOf(m).trace.gaps![0];
  it("stepping across a gap is disabled, with a notice and an explicit jump", () => {
    const on = vi.fn();
    view(m, g.after, { onStepChange: on });
    expect(screen.getByRole("button", { name: "Step into" })).toBeDisabled();
    expect(screen.getByTestId("gap-block").textContent).toContain("Stepping is disabled across a gap");
    expect(screen.getByTestId("sampled-notice").textContent).toContain("sampled");
    fireEvent.click(screen.getByRole("button", { name: /Jump to step/ }));
    expect(on).toHaveBeenCalledWith(g.before);
    expect(screen.getByRole("button", { name: /Jump to step/ }).textContent).toContain("not a step");
  });
  it("away from a gap, the buttons work and no gap block shows", () => {
    view(m, 0);
    expect(screen.getByRole("button", { name: "Step into" })).toBeEnabled();
    expect(screen.queryByTestId("gap-block")).toBeNull();
  });
  it("inside a sampled loop the iteration comes from the tracer and the total is exact", () => {
    view(m, g.before);
    expect(screen.getByTestId("loop-card").textContent).toMatch(/of 300 in the whole run/);
  });
});

describe.skipIf(!hasPython)("PythonTraceVisualizer: error diagnosis with before and after", () => {
  it("shows every part of the explanation and a before/after for a certain fix", () => {
    const m = modelOf("total = 5\nprint(totl)\n");
    const d = dataOf(m);
    view(m, d.trace.steps.length - 1);
    expect(screen.getByRole("alert").textContent).toContain("NameError");
    const card = screen.getByTestId("diagnosis");
    expect(card.hasAttribute("open")).toBe(true);
    for (const t of ["Error type", "Message", "Line", "Root cause", "Why", "Corrected approach", "How to prevent it"]) expect(within(card).getByText(t)).toBeInTheDocument();
    expect(card.textContent).toContain("print(totl)");
    const ba = within(card).getByLabelText("Before and after");
    expect(ba.textContent).toContain("print(totl)");
    expect(ba.textContent).toContain("print(total)");
    expect(within(card).getByLabelText("Relevant code")).toBeInTheDocument();
  });
  it("no before/after when the fix is not certain; the approach is still given", () => {
    const m = modelOf("d = {'a': 1}\nprint(d['b'])\n");
    view(m, dataOf(m).trace.steps.length - 1);
    const card = screen.getByTestId("diagnosis");
    expect(within(card).queryByLabelText("Before and after")).toBeNull();
    expect(card.textContent).toContain("Corrected approach");
    expect(card.textContent).toContain("holds 1 key");
  });
  it("a program without an error shows no diagnosis", () => {
    const m = modelOf("x = 1\n");
    view(m, 0);
    expect(screen.queryByTestId("diagnosis")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe.skipIf(!hasPython)("PythonTraceVisualizer: motion and fallbacks", () => {
  const m = modelOf(CALLS);
  it("reduced motion: no transition classes and no smooth scrolling", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = view(m, 3, { reducedMotion: true });
    expect(screen.getByTestId("python-visualizer").getAttribute("data-reduced-motion")).toBe("true");
    expect(container.innerHTML).not.toContain("transition-colors");
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    cleanup();
    scroll.mockClear();
    const normal = view(m, 3, { reducedMotion: false });
    expect(normal.container.innerHTML).toContain("transition-colors");
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });
  it("an out-of-range step is clamped, not a crash", () => {
    view(m, 9999);
    expect(screen.getByTestId("step-position")).toBeInTheDocument();
    cleanup();
    view(m, -4);
    expect(screen.getByTestId("step-position")).toBeInTheDocument();
  });
  it("a model that is not a Python trace shows a message instead of crashing", () => {
    render(<PythonTraceVisualizer model={{ provenance: "executed", data: { nope: 1 } }} step={0} onStepChange={() => {}} reducedMotion={false} />);
    expect(screen.getByRole("status").textContent).toContain("no recorded steps");
  });
  it("the lazy wrapper loads the viewer", async () => {
    render(<LazyVisualizer model={m} step={0} onStepChange={() => {}} reducedMotion={false} />);
    await waitFor(() => expect(screen.getByTestId("python-visualizer")).toBeInTheDocument());
  });
});

describe("registry", () => {
  it("resolves the Python adapter module with its visualizer", async () => {
    const r = await resolveAdapter("python");
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.adapter.domain).toBe("python");
    expect(r.adapter.capabilities.has("trace")).toBe(true);
    expect(r.Visualizer).toBeDefined();
  });
});
