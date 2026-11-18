// The Code Time Machine's TraceViewer (used by /visual/python, "Watch it run" and "Explain your solution") now shows the Python
// adapter's engines: step over/into/out/back (pyStepper), the branch and loop view (pyBranches), the error diagnosis (pyDiagnose)
// and the adapter's own limitations list. Rendered from REAL traces recorded in CPython.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildTraceProgram, parseTrace, type Trace, type TraceOptions } from "../site/lib/visual/pyTrace";
import { TraceViewer } from "../site/components/visual/PythonTimeMachine";
import { PYTHON_LIMITATIONS } from "../site/workspace/adapters/python/limitations";
import { pythonAdapter } from "../site/workspace/adapters/python/adapter";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
afterEach(cleanup);

const venvPython = path.resolve(__dirname, "../../../.venv-daily/bin/python");
const PYTHON = process.env.DAILY_PYTHON ?? (existsSync(venvPython) ? venvPython : "python3");
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;
function trace(code: string, opts?: Partial<TraceOptions>): Trace {
  const r = spawnSync(PYTHON, ["-I", "-"], { input: buildTraceProgram(code, opts), encoding: "utf8", timeout: 60_000 });
  const t = parseTrace(r.stdout);
  if (!t) throw new Error(`no trace: ${r.stderr}`);
  return t;
}
const pos = () => screen.getByTestId("step-position").textContent ?? "";

const CALLS = "def add(a, b):\n    total = a + b\n    return total\ndef twice(x):\n    y = add(x, x)\n    return y\nr = twice(3)\nprint(r)\n";

describe("the limitations list is the adapter's own", () => {
  it("the adapter exposes the same array the viewer shows, and it names each unsupported feature", () => {
    expect(pythonAdapter.limitations).toEqual([...PYTHON_LIMITATIONS]);
    const all = PYTHON_LIMITATIONS.join(" ");
    for (const re of [/not a full CPython debugger/, /Threads, multiprocessing and asyncio are not traced/, /single file/, /Stepping is disabled across a gap/, /executes your code once more/]) expect(all).toMatch(re);
  });
});

describe.skipIf(!hasPython)("TraceViewer: engines shared with the workspace's Python visualizer", () => {
  it("step into, over, out and back follow the recorded call depth and the player follows", () => {
    const t = trace(CALLS);
    render(<TraceViewer code={CALLS} trace={t} />);
    const at = () => Number(/Step (\d+) of/.exec(within(screen.getByRole("group", { name: "Playback controls" })).getByRole("status").textContent ?? "")?.[1]) - 1;
    // walk to the call on line 7
    let guard = 0;
    while (t.steps[at()].line !== 7 && guard++ < 50) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(t.steps[at()].line).toBe(7);
    fireEvent.click(screen.getByRole("button", { name: "Step over" }));
    expect(t.steps[at()]).toMatchObject({ line: 8 }); // over the whole call to twice()
    const after = at();
    fireEvent.click(screen.getByRole("button", { name: "Step back" }));
    expect(at()).toBe(after - 1); // back is the previous recorded step (the return from twice)
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    let n = 0;
    while (t.steps[at()].line !== 7 && n++ < 50) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Step into" }));
    expect(t.steps[at()].frames.length).toBe(2); // inside twice()
    fireEvent.click(screen.getByRole("button", { name: "Step out" }));
    expect(t.steps[at()].frames.length).toBe(1);
    expect(screen.getByTestId("step-note").textContent).toMatch(/\S/); // the move says what it did
    expect(pos()).toMatch(/depth|Step|step/);
  });
  it("shows the branch and loop view for a loop and an if, and the exact loop counts", () => {
    const code = "t = 0\nfor n in [3, 1, 4]:\n    if n > 2:\n        t += n\nprint(t)\n";
    const t = trace(code);
    render(<TraceViewer code={code} trace={t} />);
    const details = screen.getByTestId("branch-details") as HTMLDetailsElement;
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(t.steps[2].line).toBe(3); // the if inside the loop
    expect(within(details).getByTestId("loop-card").textContent).toMatch(/for n in/);
    expect(within(details).getByTestId("branch-card").textContent).toMatch(/if n > 2/);
    expect(within(details).getByTestId("branch-card").getAttribute("data-outcome")).toBe("true"); // 3 > 2, read from the next executed line
    expect(within(details).getByText(/Branch and loop counts for the whole run/)).toBeTruthy();
  });
  it("a program that fails shows the diagnosis (type, line, root cause) next to the alert, and the nested-call state", () => {
    const code = "def first(xs):\n    return xs[3]\n\ndef run():\n    return first([1, 2])\n\nrun()\n";
    const t = trace(code);
    render(<TraceViewer code={code} trace={t} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Jump to a recorded step" })).getByRole("button", { name: "Exception" }));
    expect(screen.getByText(/Stopped by/).textContent).toMatch(/IndexError/);
    const d = screen.getByTestId("diagnosis");
    expect(d.textContent).toMatch(/IndexError/);
    expect(d.textContent).toMatch(/line 2/);
    expect(within(screen.getByLabelText("Call stack")).getAllByRole("listitem").length).toBe(3); // the main program, run() and first(): the state at the exception
  });
  it("a sampled long loop disables stepping across its gap and offers a labelled jump, not a step", () => {
    const code = "t = 0\nfor i in range(300):\n    t += i\nprint(t)\n";
    const t = trace(code, { loopHead: 3, loopTail: 3, checkpointEvery: 50 } as Partial<TraceOptions>);
    expect(t.gaps?.length ?? 0).toBeGreaterThan(0);
    render(<TraceViewer code={code} trace={t} />);
    // go to the last recorded step before the first gap
    const g = t.gaps![0];
    fireEvent.change(screen.getByRole("slider", { name: "Timeline" }), { target: { value: String(g.before) } });
    expect(screen.getByTestId("gap-block").textContent).toMatch(/Stepping is disabled across a gap/);
    expect(screen.getByRole("button", { name: /Jump to step \d+ \(not a step\)/ })).toBeTruthy();
    const over = screen.getByRole("button", { name: "Step over" }) as HTMLButtonElement;
    const into = screen.getByRole("button", { name: "Step into" }) as HTMLButtonElement;
    expect(over.disabled || into.disabled).toBe(true);
    expect(screen.getByRole("note", { name: "This trace is sampled" })).toBeTruthy();
  });
  it("lists what is not supported, from the adapter", () => {
    const t = trace("x = 1\n");
    render(<TraceViewer code={"x = 1\n"} trace={t} />);
    const box = screen.getByTestId("trace-limitations");
    for (const l of PYTHON_LIMITATIONS) expect(box.textContent).toContain(l);
  });
});
