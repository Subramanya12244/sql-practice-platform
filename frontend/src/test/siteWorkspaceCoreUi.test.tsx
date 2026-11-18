import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ExerciseWorkspace } from "../site/workspace/ExerciseWorkspace";
import { EmbeddedExercise } from "../site/workspace/EmbeddedExercise";
import { registerAdapter, resetRegistry } from "../site/workspace/registry";
import { createFakeAdapter, FakeVisualizer } from "../site/workspace/fake/fakeAdapter";
import { storeProgressPort } from "../site/workspace/progressPort";
import { getProgress, resetProgress } from "../site/lib/progress";
import { writeMotionPref } from "../site/lib/visual/motion";
import type { Capability, ExerciseDef, ProgressPort, VisualizerProps } from "../site/workspace/types";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;

const SOLUTION = "SELECT answer_marker_zq FROM t;";
const EX: ExerciseDef = {
  id: "py:demo-core", domain: "python", source: { kind: "authored", id: "demo-core" }, title: "Demo exercise", difficulty: "Easy", topic: "basics",
  statement: "Return the **answer**.", objectives: ["Practise"], concepts: ["variables"], starterCode: "# start here\n",
  validation: { kind: "python-stdout", expected: "1" },
  hints: [
    { level: 1, title: "Concept", body: "HINT-ONE concept text" },
    { level: 2, title: "Approach", body: "HINT-TWO approach text" },
    { level: 3, title: "Partial structure", body: "HINT-THREE structure text" },
    { level: 4, title: "Detailed", body: "HINT-FOUR detail text" },
  ],
  solution: { code: SOLUTION, explanation: "EXPLANATION-TEXT why it works" },
};

const view = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const port = (): ProgressPort & { [K in "recordAttempt" | "recordHint" | "recordReveal" | "recordRun"]: ReturnType<typeof vi.fn> } =>
  ({ recordAttempt: vi.fn(), recordHint: vi.fn(), recordReveal: vi.fn(), recordRun: vi.fn() });
const editor = () => screen.getByLabelText(/code for Demo exercise/i) as HTMLTextAreaElement;
const type = (code: string) => fireEvent.change(editor(), { target: { value: code } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** The Explanation pane is open by default except in compact hosts; open it either way. */
const openExplanation = () => { const b = screen.queryByRole("button", { name: "Expand Explanation" }); if (b) fireEvent.click(b); };
const adapterWith = (caps: Capability[], o = {}) => createFakeAdapter({ capabilities: caps, ...o });

beforeEach(() => { localStorage.clear(); resetRegistry(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("capability-gated controls", () => {
  it("shows only Run and Reset for a run-only adapter: no Submit, no Visualize, no step controls", async () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run"])} layout="stack" editor="plain" progress={null} />);
    expect(screen.getByRole("button", { name: /^Run/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reset/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Visualize/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Visualization" }));
    expect(screen.getByText(/no step-by-step visualization/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Playback controls" })).toBeNull();
  });

  it("hides Submit when the adapter has no validate or the exercise is not graded", () => {
    const noValidate = adapterWith(["run", "submit"]);
    delete (noValidate as { validate?: unknown }).validate;
    const { unmount } = view(<ExerciseWorkspace exercise={EX} adapter={noValidate} layout="stack" editor="plain" progress={null} />);
    expect(screen.queryByRole("button", { name: /Submit/ })).toBeNull();
    unmount();
    view(<ExerciseWorkspace exercise={{ ...EX, validation: { kind: "none" } }} adapter={adapterWith(["run", "submit"])} layout="stack" editor="plain" progress={null} />);
    expect(screen.queryByRole("button", { name: /Submit/ })).toBeNull();
    expect(screen.getByText(/not graded/i)).toBeInTheDocument();
  });

  it("a plan-only adapter (no trace, no stages) visualizes but has no Play, Step, Restart or Speed", async () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "submit", "plan"])} Visualizer={FakeVisualizer} layout="stack" editor="plain" progress={null} />);
    type("a = 1\nb = 2\n");
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    click(/^Visualize/);
    await screen.findByTestId("fake-visual");
    expect(screen.getByText("Conceptual model")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Playback controls" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.queryByLabelText("Playback speed")).toBeNull();
  });

  it("a trace adapter gets the shared player; stepping moves the visualizer's step", async () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "trace"])} Visualizer={FakeVisualizer} layout="stack" editor="plain" progress={null} />);
    type("a = 1\nb = 2\nc = 3\n");
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    click(/^Visualize/);
    await screen.findByTestId("fake-visual");
    const bar = screen.getByRole("group", { name: "Playback controls" });
    expect(within(bar).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(within(bar).getByLabelText("Playback speed")).toBeInTheDocument();
    expect(screen.getByTestId("fake-visual")).toHaveTextContent("step 1: a = 1");
    fireEvent.click(within(bar).getByRole("button", { name: "Next step" }));
    expect(screen.getByTestId("fake-visual")).toHaveTextContent("step 2: b = 2");
    fireEvent.click(within(bar).getByRole("button", { name: "Restart" }));
    expect(screen.getByTestId("fake-visual")).toHaveTextContent("step 1: a = 1");
  });

  it("says so honestly when the engine cannot build a view (visualize returned null) and lists its limitations", async () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "stages"], { noVisual: true, limitations: ["No recursion."] })} Visualizer={FakeVisualizer} layout="stack" editor="plain" progress={null} />);
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    click(/^Visualize/);
    await screen.findByText(/cannot build an accurate step view/i);
    expect(screen.queryByTestId("fake-visual")).toBeNull();
    expect(screen.getByText("Not supported here")).toBeInTheDocument();
    expect(screen.getByText("No recursion.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Playback controls" })).toBeNull();
  });

  it("passes the reduced-motion preference to the visualizer", async () => {
    const seen: VisualizerProps[] = [];
    const Spy = (p: VisualizerProps) => { seen.push(p); return <div data-testid="spy" />; };
    writeMotionPref("reduce");
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "stages"])} Visualizer={Spy} layout="stack" editor="plain" progress={null} />);
    type("a = 1\n");
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    click(/^Visualize/);
    await screen.findByTestId("spy");
    expect(seen.at(-1)?.reducedMotion).toBe(true);
    act(() => writeMotionPref("full"));
    await waitFor(() => expect(seen.at(-1)?.reducedMotion).toBe(false));
    act(() => writeMotionPref("system"));
  });

  it("a crashing visualizer is contained: the editor and results stay", async () => {
    const Boom = () => { throw new Error("viz exploded"); };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "stages"])} Visualizer={Boom} layout="stack" editor="plain" progress={null} />);
    type("a = 1\n");
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    click(/^Visualize/);
    await screen.findByText(/stopped working: viz exploded/);
    expect(editor().value).toBe("a = 1\n");
    err.mockRestore();
  });
});

describe("hint ladder gating", () => {
  it("keeps every hint and the solution out of the page until asked, one level at a time", () => {
    const p = port();
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "submit"])} layout="stack" editor="plain" progress={p} />);
    openExplanation();
    expect(document.body.textContent).not.toMatch(/HINT-|answer_marker_zq|EXPLANATION-TEXT/);
    for (const [n, text] of [[1, "HINT-ONE"], [2, "HINT-TWO"], [3, "HINT-THREE"], [4, "HINT-FOUR"]] as const) {
      expect(document.body.textContent).not.toContain(text);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`Show level ${n}`) }));
      expect(document.body.textContent).toContain(text);
      expect(document.body.textContent).not.toContain("answer_marker_zq");
    }
    expect(p.recordHint.mock.calls.map((c) => c[1])).toEqual([1, 2, 3, 4]);
    expect(p.recordReveal).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show the full solution" })).toBeInTheDocument();
  });

  it("asks for confirmation before the solution and records the reveal only then", () => {
    const p = port();
    const noHints = { ...EX, hints: [] };
    view(<ExerciseWorkspace exercise={noHints} adapter={adapterWith(["run", "submit"])} layout="stack" editor="plain" progress={p} />);
    openExplanation();
    click("Show the full solution");
    expect(screen.getByRole("alertdialog", { name: /full solution/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("answer_marker_zq");
    expect(p.recordHint).not.toHaveBeenCalled();
    click("Keep trying");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    click("Show the full solution");
    click("Yes, show the solution");
    expect(document.body.textContent).toContain("answer_marker_zq");
    expect(screen.getByText("EXPLANATION-TEXT why it works")).toBeInTheDocument();
    expect(p.recordHint).toHaveBeenCalledWith(noHints, 5);
    expect(p.recordReveal).toHaveBeenCalledTimes(1);
  });

  it("skips levels the exercise does not have", () => {
    view(<ExerciseWorkspace exercise={{ ...EX, hints: [EX.hints[0], EX.hints[3]] }} adapter={adapterWith(["run"])} layout="stack" editor="plain" progress={null} />);
    openExplanation();
    click(/Show level 1/);
    expect(screen.getByRole("button", { name: /Show level 4/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show level 2/ })).toBeNull();
  });

  it("opening the workspace and a hint marks nothing solved in the real stores", () => {
    resetProgress();
    const ex: ExerciseDef = { ...EX, id: "sql:q-test", domain: "sql", source: { kind: "sql-question", slug: "q-test", number: 9001 }, topic: "aggregations" };
    view(<ExerciseWorkspace exercise={ex} adapter={createFakeAdapter({ domain: "sql" })} layout="stack" editor="plain" progress={storeProgressPort} />);
    openExplanation();
    click(/Show level 1/);
    click(/Show level 2/);
    const q = getProgress().questions[9001];
    expect(q?.solvedAt).toBeUndefined();
    expect(q?.hintLevel).toBe(2);
    expect(getProgress().lessons?.["sql:q-test"]).toBeUndefined();
  });
});

describe("run, submit and progress", () => {
  it("run never calls recordAttempt; submit does, with the code and the failure text", async () => {
    const p = port();
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "submit"])} layout="stack" editor="plain" progress={p} />);
    type("not the answer");
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    expect(p.recordAttempt).not.toHaveBeenCalled();
    expect(p.recordRun).toHaveBeenCalledWith(EX, true, undefined);
    click(/^Submit/);
    expect(await screen.findByText(/Not yet/)).toBeInTheDocument();
    expect(p.recordAttempt).toHaveBeenCalledTimes(1);
    expect(p.recordAttempt.mock.calls[0][1]).toBe(false);
    expect(p.recordAttempt.mock.calls[0][3]).toBe("not the answer");
    expect(screen.getByRole("region", { name: "Feedback" })).toHaveTextContent("does not match the reference");
    expect(screen.getByText("Hidden test")).toBeInTheDocument();
  });

  it("a pass records once, shows the explanation, and the reference solution stays behind a click", async () => {
    const p = port();
    const onPassed = vi.fn();
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "submit"])} layout="stack" editor="plain" progress={p} onPassed={onPassed} />);
    type(SOLUTION);
    click(/^Submit/);
    expect(await screen.findByText(/Correct. All checks passed./)).toBeInTheDocument();
    expect(p.recordAttempt).toHaveBeenCalledWith(EX, true, undefined, SOLUTION);
    await waitFor(() => expect(onPassed).toHaveBeenCalledTimes(1));
    openExplanation();
    expect(screen.getByText("EXPLANATION-TEXT why it works")).toBeInTheDocument();
    const panel = () => screen.getByTestId("workspace-explanation").textContent;
    expect(panel()).not.toContain("answer_marker_zq"); // (the learner's own editor holds it; the help panel must not)
    click("Compare with the reference solution");
    expect(panel()).toContain("answer_marker_zq");
    expect(p.recordHint).not.toHaveBeenCalled(); // help after a pass earns nothing and costs nothing
    expect(p.recordReveal).not.toHaveBeenCalled();
  });

  it("a real-store pass for a SQL exercise marks it solved (and only then)", async () => {
    resetProgress();
    const ex: ExerciseDef = { ...EX, id: "sql:q-test2", domain: "sql", source: { kind: "sql-question", slug: "q-test2", number: 9002 }, topic: "aggregations" };
    view(<ExerciseWorkspace exercise={ex} adapter={createFakeAdapter({ domain: "sql" })} layout="stack" editor="plain" progress={storeProgressPort} />);
    type("wrong");
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    expect(getProgress().questions[9002]).toBeUndefined();
    click(/^Submit/);
    await screen.findByText(/Not yet/);
    expect(getProgress().questions[9002]).toMatchObject({ attempts: 1, solvedAt: undefined });
    type(SOLUTION);
    click(/^Submit/);
    await screen.findByText(/Correct/);
    expect(getProgress().questions[9002].solvedAt).toBeTruthy();
    expect(getProgress().questions[9002].attempts).toBe(2);
  });

  it("a run error shows structured feedback and is not an attempt", async () => {
    const p = port();
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "submit"], { failWithError: "boom here" })} layout="stack" editor="plain" progress={p} />);
    click(/^Run/);
    expect(await screen.findByRole("alert")).toHaveTextContent("FakeError (line 1)");
    expect(screen.getByRole("region", { name: "Feedback" })).toHaveTextContent("runtime");
    expect(p.recordAttempt).not.toHaveBeenCalled();
    expect(p.recordRun).toHaveBeenCalledWith(EX, false, expect.stringContaining("boom here"));
  });

  it("a grader crash is shown but never recorded as a wrong answer", async () => {
    const p = port();
    const a = adapterWith(["run", "submit"]);
    a.validate = async () => { throw new Error("worker died"); };
    view(<ExerciseWorkspace exercise={EX} adapter={a} layout="stack" editor="plain" progress={p} />);
    click(/^Submit/);
    expect(await screen.findByText(/checker could not finish: worker died/)).toBeInTheDocument();
    expect(p.recordAttempt).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter in the editor runs the code", async () => {
    const a = adapterWith(["run"]);
    view(<ExerciseWorkspace exercise={EX} adapter={a} layout="stack" editor="plain" progress={null} />);
    fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
    await screen.findByText(/Ran without errors/);
    expect(a.calls.run).toHaveLength(1);
  });
});

describe("abort and reset", () => {
  it("Stop aborts the run, shows Stopped, and records nothing", async () => {
    const p = port();
    const a = adapterWith(["run", "submit"], { delayMs: 60_000 });
    view(<ExerciseWorkspace exercise={EX} adapter={a} layout="stack" editor="plain" progress={p} />);
    click(/^Run/);
    expect(await screen.findAllByText("Running your code.")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: /^Run/ })).toBeDisabled();
    click(/^Stop/);
    expect(await screen.findByText("Stopped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Run/ })).toBeEnabled();
    expect(p.recordRun).not.toHaveBeenCalled();
    expect(p.recordAttempt).not.toHaveBeenCalled();
  });

  it("passes an AbortSignal that is aborted by Stop, by a newer run, and on unmount", async () => {
    const signals: AbortSignal[] = [];
    const a = adapterWith(["run"], { delayMs: 60_000 });
    const real = a.run.bind(a);
    a.run = (code, ctx) => { signals.push(ctx.signal!); return real(code, ctx); };
    const { unmount } = view(<ExerciseWorkspace exercise={EX} adapter={a} layout="stack" editor="plain" progress={null} />);
    click(/^Run/);
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it("a result that arrives after Reset is discarded", async () => {
    const a = createFakeAdapter({ capabilities: ["run"] });
    let release!: () => void;
    a.run = () => new Promise((res) => { release = () => res({ status: "ok", durationMs: 1, stdout: "LATE-OUTPUT" }); });
    view(<ExerciseWorkspace exercise={EX} adapter={a} layout="stack" editor="plain" progress={null} />);
    click(/^Run/);
    await screen.findAllByText("Running your code.");
    click(/Reset/);
    await act(async () => { release(); });
    expect(document.body.textContent).not.toContain("LATE-OUTPUT");
    expect(screen.getByTestId("results-empty")).toBeInTheDocument();
  });

  it("Reset restores the starter code and clears results and feedback, but keeps the hint level", async () => {
    const p = port();
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "submit"])} layout="stack" editor="plain" progress={p} />);
    type("changed code");
    click(/^Submit/);
    await screen.findByText(/Not yet/);
    openExplanation();
    click(/Show level 1/);
    click(/Reset/);
    expect(editor().value).toBe(EX.starterCode);
    expect(screen.getByTestId("results-empty")).toBeInTheDocument();
    expect(screen.queryByText(/Not yet/)).toBeNull();
    expect(screen.getByText("HINT-ONE concept text")).toBeInTheDocument();
    expect(screen.getByText(/highest opened: 1\/5/)).toBeInTheDocument();
  });

  it("changing the exercise starts clean", async () => {
    const a = adapterWith(["run"]);
    const { rerender } = view(<ExerciseWorkspace exercise={EX} adapter={a} layout="stack" editor="plain" progress={null} />);
    type("mine");
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    rerender(<MemoryRouter><ExerciseWorkspace exercise={{ ...EX, id: "py:other", title: "Demo exercise", starterCode: "# other\n" }} adapter={a} layout="stack" editor="plain" progress={null} /></MemoryRouter>);
    await waitFor(() => expect(editor().value).toBe("# other\n"));
    expect(screen.getByTestId("results-empty")).toBeInTheDocument();
  });
});

describe("responsive layout", () => {
  it("renders all five tabs on a phone and shows one section at a time; arrow keys move between tabs", () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run", "submit"])} layout="tabs" editor="plain" progress={null} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Problem", "Editor", "Visualization", "Results", "Explanation"]);
    expect(screen.getByRole("tab", { name: "Problem" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("workspace-problem")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-editor")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
    expect(screen.getByTestId("workspace-editor")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Visualization" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("workspace-visual")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Explanation" }));
    expect(screen.getByTestId("workspace-explanation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
    expect(screen.getByTestId("results-empty")).toBeInTheDocument();
  });

  it("jumps to Results after Run on a phone, and keeps the code while tabs change", async () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run"])} layout="tabs" editor="plain" progress={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
    type("x = 5");
    click(/^Run/);
    await screen.findByText(/Ran without errors/);
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
    expect(editor().value).toBe("x = 5");
  });

  it("splits into collapsible panes on desktop: collapse hides the body, expand brings it back", () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run"])} layout="split" editor="plain" progress={null} />);
    for (const t of ["Problem", "Explanation", "Editor", "Results"]) expect(screen.getByRole("button", { name: `Collapse ${t}` })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Expand Visualization" })).toHaveAttribute("aria-expanded", "false"); // closed by default: it never crowds the editor
    expect(screen.getByTestId("workspace-problem")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Problem" }));
    expect(screen.queryByTestId("workspace-problem")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Problem" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Editor" }));
    expect(screen.queryByTestId("workspace-editor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Editor" }));
    expect(screen.getByTestId("workspace-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Problem" }));
    expect(screen.getByTestId("workspace-problem")).toBeInTheDocument();
  });

  it("can hide the whole problem column to give the editor the full width, and has a resize handle", () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run"])} layout="split" editor="plain" progress={null} />);
    expect(screen.getByRole("separator", { name: /Resize problem and editor/ })).toBeInTheDocument();
    click("Hide problem and help column");
    expect(screen.queryByTestId("workspace-problem")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.getByTestId("workspace-editor")).toBeInTheDocument();
    click("Show problem and help column");
    expect(screen.getByTestId("workspace-problem")).toBeInTheDocument();
  });

  it("panes are real buttons, reachable and operable from the keyboard", () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run"])} layout="stack" editor="plain" progress={null} />);
    const b = screen.getByRole("button", { name: "Expand Visualization" });
    b.focus();
    expect(document.activeElement).toBe(b);
    expect(b.tagName).toBe("BUTTON");
    fireEvent.click(b); // Enter and Space on a button dispatch click
    expect(screen.getByRole("button", { name: "Collapse Visualization" })).toBeInTheDocument();
  });

  it("auto layout is tabs where the screen is narrow (the default here)", () => {
    view(<ExerciseWorkspace exercise={EX} adapter={adapterWith(["run"])} editor="plain" progress={null} />);
    expect(screen.getByTestId("exercise-workspace")).toHaveAttribute("data-layout", "tabs");
  });
});

describe("a missing adapter", () => {
  it("shows an honest not-available state, still lets the learner read and open hints, and offers no Run", async () => {
    registerAdapter("numpy", async () => ({}));
    view(<ExerciseWorkspace exercise={{ ...EX, domain: "numpy" }} layout="stack" editor="plain" progress={null} />);
    expect(await screen.findByTestId("adapter-missing")).toHaveTextContent(/NumPy practice is not available here/);
    expect(screen.queryByRole("button", { name: /^Run/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Submit/ })).toBeNull();
    expect(screen.getByTestId("workspace-problem")).toBeInTheDocument();
    openExplanation();
    click(/Show level 1/);
    expect(screen.getByText("HINT-ONE concept text")).toBeInTheDocument();
  });

  it("uses the registered adapter when there is one", async () => {
    registerAdapter("python", { getAdapter: () => createFakeAdapter({ capabilities: ["run"] }) });
    view(<ExerciseWorkspace exercise={EX} layout="stack" editor="plain" progress={null} />);
    await screen.findByLabelText(/code for Demo exercise/i);
    expect(screen.getByRole("button", { name: /^Run/ })).toBeInTheDocument();
  });
});

describe("EmbeddedExercise", () => {
  it("compact mode waits for a click before loading anything", async () => {
    const load = vi.fn(async () => EX);
    view(<EmbeddedExercise exerciseId="py:demo-core" load={load} adapter={adapterWith(["run"])} layout="stack" editor="plain" progress={null} />);
    expect(screen.getByTestId("embedded-closed")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    click("Open the exercise");
    expect(await screen.findByTestId("exercise-workspace")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("py:demo-core");
    expect(screen.getByRole("button", { name: "Expand Explanation" })).toBeInTheDocument(); // help starts closed in compact mode
  });

  it("full mode with a finished ExerciseDef renders at once", () => {
    view(<EmbeddedExercise exercise={EX} mode="full" adapter={adapterWith(["run"])} layout="split" editor="plain" progress={null} />);
    expect(screen.getByTestId("exercise-workspace")).toHaveAttribute("data-layout", "split");
    expect(screen.getByRole("button", { name: "Collapse Explanation" })).toBeInTheDocument();
  });

  it("says plainly when an id cannot be found", async () => {
    view(<EmbeddedExercise exerciseId="py:gone" defer={false} load={async () => null} progress={null} />);
    expect(await screen.findByText(/could not be found \(py:gone\)/)).toBeInTheDocument();
  });
});
