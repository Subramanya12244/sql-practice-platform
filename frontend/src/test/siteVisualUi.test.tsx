import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trace } from "../site/lib/visual/pyTrace";
import { PlaybackBar, usePlayback } from "../site/components/visual/Playback";
import { PythonTimeMachine, TraceViewer } from "../site/components/visual/PythonTimeMachine";
import { ApiStudio } from "../site/components/visual/ApiStudio";
import { EtlPlayback } from "../site/components/visual/EtlPlayback";
import { ChartExplorer } from "../site/components/visual/ChartExplorer";
import { ExplainPanel } from "../site/components/visual/ExplainPanel";
import { LessonVisual } from "../site/components/visual/LessonVisual";
import { VisualHubPage } from "../site/pages/VisualPages";

vi.mock("../site/SiteApp", () => ({ usePage: () => ({ data: {}, params: {} }) }));
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(cleanup);

// A hand-built trace of:  a = [1]  /  b = a  /  b.append(2)   (what the tracer records, without needing Python in jsdom)
const code = "a = [1]\nb = a\nb.append(2)\nprint(b)\n";
const one = { k: "int" as const, r: "1" }, two = { k: "int" as const, r: "2" };
const L1 = { k: "list" as const, r: "[1]", id: 1, n: 1, items: [0] }, L2 = { k: "list" as const, r: "[1, 2]", id: 1, n: 2, items: [0, 1] };
const TRACE: Trace = {
  ok: true, truncated: false, stdout: "[1, 2]\n", stat: { loopDepth: 0, recursive: [], loops: 0 },
  vals: [one, two, L1, L2],
  steps: [
    { ev: "line", line: 1, out: 0, frames: [{ fn: "<module>", line: 1, vars: {} }] },
    { ev: "line", line: 2, out: 0, frames: [{ fn: "<module>", line: 2, vars: { a: 2 } }] },
    { ev: "line", line: 3, out: 0, frames: [{ fn: "<module>", line: 3, vars: { a: 2, b: 2 } }] },
    { ev: "line", line: 4, out: 0, frames: [{ fn: "<module>", line: 4, vars: { a: 3, b: 3 } }] },
    { ev: "return", line: 4, out: 7, frames: [{ fn: "<module>", line: 4, vars: { a: 3, b: 3 } }] },
  ],
};

function Harness({ n }: { n: number }) { const pb = usePlayback(n); return <PlaybackBar pb={pb} />; }

describe("playback controls in the UI", () => {
  it("steps, plays, restarts and reports the position; the keyboard works", () => {
    render(<Harness n={3} />);
    const status = () => screen.getByRole("status").textContent;
    expect(status()).toBe("Step 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(status()).toBe("Step 2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(status()).toBe("Step 1 of 3");
    const group = screen.getByRole("group", { name: "Playback controls" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "End" });
    expect(status()).toBe("Step 3 of 3");
    fireEvent.keyDown(group, { key: "Home" });
    expect(status()).toBe("Step 1 of 3");
    fireEvent.change(screen.getByLabelText("Timeline"), { target: { value: "2" } });
    expect(status()).toBe("Step 3 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(status()).toBe("Step 1 of 3");
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
  });
  it("plays on a timer and shows Pause while playing", () => {
    vi.useFakeTimers();
    render(<Harness n={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    vi.advanceTimersByTime(1500);
    vi.useRealTimers();
  });
  it("speed is selectable", () => {
    render(<Harness n={3} />);
    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "2" } });
    expect((screen.getByLabelText("Playback speed") as HTMLSelectElement).value).toBe("2");
  });
});

describe("Python Code Time Machine view", () => {
  it("highlights the current line, shows variables, aliasing in the memory model, and output at the end", () => {
    render(<TraceViewer code={code} trace={TRACE} />);
    const src = screen.getByRole("list", { name: "Source code" });
    expect(within(src).getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/About to run line 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getAllByText("a").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Memory model" }));
    expect(screen.getByLabelText("Memory model")).toBeInTheDocument();
    expect(screen.getByText(/shared by a and b/)).toBeInTheDocument();
    expect(screen.getByText(/does not show how CPython really lays out memory/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText("The program finished. These are the final values.")).toBeInTheDocument();
    expect(screen.getByLabelText("Program output").textContent).toContain("[1, 2]");
  });
  it("labels the memory view conceptual and the variables view executed", () => {
    render(<TraceViewer code={code} trace={TRACE} />);
    expect(screen.getByText("Executed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Memory model" }));
    expect(screen.getByText("Conceptual model")).toBeInTheDocument();
  });
  it("shows cost notes separating measured counts from estimates", () => {
    render(<TraceViewer code={code} trace={TRACE} />);
    expect(screen.getByText("Cost of this run")).toBeInTheDocument();
    expect(screen.getByText(/not timings/)).toBeInTheDocument();
  });
  it("runs through the injected runner and shows a clear error when no trace came back", async () => {
    const run = vi.fn().mockResolvedValue({ trace: null, result: { ok: false, stdout: "", error: "Traceback\nboom", phase: "timeout", ms: 1 } });
    render(<PythonTimeMachine code="while True: pass" run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be recorded.*took too long/);
    expect(run).toHaveBeenCalledWith("while True: pass", "");
  });
  it("plays a returned trace", async () => {
    const run = vi.fn().mockResolvedValue({ trace: TRACE, result: { ok: true, stdout: "", ms: 1 } });
    render(<PythonTimeMachine code={code} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    expect(await screen.findByRole("list", { name: "Source code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trace again" })).toBeInTheDocument();
  });
});

describe("API, ETL and chart studios render and respond", () => {
  it("API studio: switching scenario changes the frames; settings are clamped; backoff schedule is shown", () => {
    render(<ApiStudio />);
    expect(screen.getByRole("tab", { name: "429 Too Many Requests" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Backoff schedule/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "404 Not Found" }));
    expect(screen.getByText(/Fetch order 999/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Max retries"), { target: { value: "99" } });
    expect((screen.getByLabelText("Max retries") as HTMLInputElement).value).toBe("6");
    expect(screen.getAllByText(/Simulated/).length).toBeGreaterThan(0);
  });
  it("ETL: injecting a failure and stepping to it", () => {
    render(<EtlPlayback />);
    fireEvent.change(screen.getByLabelText("Inject a failure"), { target: { value: "extract-always-fails" } });
    expect(screen.getByText(/Run result:/).textContent).toContain("failed");
    fireEvent.click(screen.getByRole("tab", { name: "Change data capture" }));
    fireEvent.click(screen.getByLabelText(/Replay the same change feed/));
    expect(screen.getByText(/identical after the replay/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
    expect(screen.getAllByText(/skipped/).length).toBeGreaterThan(0);
  });
  it("Charts: advice reacts to the chart type and the zero baseline", () => {
    render(<ChartExplorer />);
    const advice = () => screen.getByRole("list", { name: "Chart advice" }).textContent;
    expect(advice()).toContain("Fits");
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "pie" } });
    fireEvent.change(screen.getByLabelText("Dimension (group by)"), { target: { value: "month" } });
    expect(advice()).toMatch(/slices/);
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "bar" } });
    fireEvent.click(screen.getByLabelText("Start the axis at zero"));
    expect(advice()).toMatch(/does not start at zero/);
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "heatmap" } });
    expect(screen.getByRole("table", { name: "Heatmap" })).toBeInTheDocument();
  });
});

describe("Explain visually panel", () => {
  const ctx = { lang: "python" as const, code: "print(1)", solution: "print(2)", hints: ["Think about the output"], expected: "2\n", run: { ok: true, text: "1\n" } };
  it("reveals levels one at a time and never shows the solution until asked", () => {
    render(<ExplainPanel ctx={ctx} />);
    fireEvent.click(screen.getByRole("button", { name: /Explain visually/ }));
    expect(screen.queryByText("print(2)")).toBeNull();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: /^Next:/ }));
    expect(screen.queryByText("print(2)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /ready to see the full solution/ }));
    expect(screen.getByText("print(2)")).toBeInTheDocument();
  });
  it("answers why the output happened from the real run, and shows the common mistake", () => {
    render(<ExplainPanel ctx={ctx} similar={{ label: "Next one", href: "/practice/python/x" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Why did this output happen?" }));
    expect(screen.getByText(/Line 1 differs/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the common mistake" }));
    expect(screen.getByText(/Compare your output/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Another similar challenge/ })).toHaveAttribute("href", "/practice/python/x");
  });
});

describe("lesson integration is opt-in and isolated", () => {
  it("LessonVisual traces nothing until opened", () => {
    render(<MemoryRouter><LessonVisual lang="python" code="print(1)" /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Explain visually" })).toBeNull();
    const d = screen.getByText("Watch it run").closest("details")!;
    d.open = true;
    fireEvent(d, new Event("toggle"));
    expect(screen.getByRole("button", { name: "Explain visually" })).toBeInTheDocument();
  });
  it("SQL blocks link to the Query Cinema instead of running anything", async () => {
    render(<MemoryRouter><LessonVisual lang="sql" code="select 1" /></MemoryRouter>);
    const d = screen.getByText("Watch it run").closest("details")!;
    d.open = true;
    fireEvent(d, new Event("toggle"));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open it in the Query Cinema" })).toHaveAttribute("href", "/query-visualizer"));
  });
  it("hub page lists every visual tool", () => {
    render(<MemoryRouter><VisualHubPage /></MemoryRouter>);
    for (const name of ["SQL Query Cinema", "Python Code Time Machine", "Pandas and NumPy Studio", "API Request Studio", "ETL Pipeline Playback", "Data Visualization Explorer"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  });
});
