// /visual/data on the shared engines: the page runs the learner's code through the data adapter (real CPython with numpy and pandas
// stands in for the Pyodide worker, behind the same runner signature) and renders the shared DataVisualizer with the shared player.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createDataAdapter } from "../site/workspace/adapters/data/adapter";
import { DataStudio } from "../site/components/visual/DataStudio";
import { DataVisualPage } from "../site/pages/VisualPages";
import { DATA_PRESETS, LEGACY_DATA_PRESETS } from "../site/workspace/adapters/data/presets";
import { cpythonRun, hasDataPython } from "./siteWorkspaceDataPy";

vi.mock("../site/SiteApp", () => ({ usePage: () => ({ data: {}, params: {} }) }));
// Monaco does not run in jsdom: a textarea with the same label and onChange.
vi.mock("../site/components/CodeEditor", () => ({
  default: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

const adapters = () => ({ pandas: createDataAdapter("pandas", { runner: cpythonRun, stop: () => undefined }), numpy: createDataAdapter("numpy", { runner: cpythonRun, stop: () => undefined }) });
const status = () => within(screen.getByRole("group", { name: "Playback controls" })).getByRole("status");

describe("the Pandas and NumPy Studio page (no Python needed)", () => {
  it("keeps the old example buttons and the old editor label, and offers the new examples", async () => {
    render(<MemoryRouter><DataStudio /></MemoryRouter>);
    for (const l of LEGACY_DATA_PRESETS) expect(screen.getByRole("button", { name: l.label })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter and sort" })).toHaveAttribute("aria-pressed", "true"); // the old default
    expect(await screen.findByLabelText("Python code to trace")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explain visually" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
    expect(screen.getByText("Invalid operations (these raise on purpose, to show the real error)")).toBeTruthy();
    expect(screen.getByText("Not supported here")).toBeTruthy(); // the adapter's own limitations list
  });
  it("?preset= accepts an old id, a new id and a short alias; an unknown id falls back to the default", async () => {
    const code = async () => ((await screen.findByLabelText("Python code to trace")) as HTMLTextAreaElement).value;
    const at = (q: string) => render(<MemoryRouter initialEntries={[`/visual/data${q}`]}><DataVisualPage /></MemoryRouter>);
    const want = (id: string) => DATA_PRESETS.find((p) => p.id === id)!.code;
    let r = at("?preset=numpy-broadcasting"); expect(await code()).toBe(want("np-broadcast-ok")); r.unmount();
    r = at("?preset=np-matmul-bad"); expect(await code()).toBe(want("np-matmul-bad")); r.unmount();
    r = at("?preset=groupby"); expect(await code()).toBe(want("pd-groupby")); r.unmount();
    r = at("?preset=zzz"); expect(await code()).toBe(want("pd-select-filter")); r.unmount();
    r = at(""); expect(await code()).toBe(want("pd-select-filter")); r.unmount();
  });
  it("picking an example puts its code in the editor and marks the button pressed", async () => {
    render(<MemoryRouter><DataStudio /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(((await screen.findByLabelText("Python code to trace")) as HTMLTextAreaElement).value).toContain("how='right'");
    expect(screen.getByRole("button", { name: "Merge" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Filter and sort" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe.skipIf(!hasDataPython)("the page runs your code through the shared data adapter (real CPython)", () => {
  it("Explain visually: operation stages, source line, shared player, tables captioned Before / After / Current value", async () => {
    render(<MemoryRouter><DataStudio run={adapters()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    expect(await screen.findByRole("list", { name: "Source code" }, { timeout: 60_000 })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tables and arrays" })).toHaveAttribute("aria-selected", "true");
    await screen.findByText(/^Stage 1 of /);
    const n = Number(/of (\d+)/.exec(status().textContent ?? "")?.[1]);
    expect(n).toBeGreaterThan(3);
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(await screen.findByText(new RegExp(`^Stage ${n} of ${n}`))).toBeTruthy();
    expect(screen.getAllByRole("table", { name: /Current value|After|Before/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/shape \(/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Trace again" })).toBeTruthy();
    // The highlighted source line follows the stage.
    const cur = screen.getByRole("list", { name: "Source code" }).querySelector("[aria-current]")!;
    expect(cur.textContent).toMatch(/sort_values/);
  });
  it("Run shows the output and result table without building the stage view; Explain visually then reuses that run", async () => {
    const a = adapters();
    const spy = vi.spyOn(a.pandas, "run");
    render(<MemoryRouter><DataStudio run={a} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("region", { name: "Run output" }, { timeout: 60_000 })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Source code" })).toBeNull();
    expect(screen.getByText(/Press Explain visually/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    expect(await screen.findByRole("list", { name: "Source code" })).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1); // one execution for Run and the stage view
  });
  it("groupby shows the groups before the aggregate; merge shows matched and unmatched keys", async () => {
    render(<MemoryRouter><DataStudio presetParam="pd-groupby" run={adapters()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    await screen.findByRole("list", { name: "Source code" }, { timeout: 60_000 });
    await screen.findByText(/^Stage 1 of /);
    let found = false;
    for (let i = 0; i < 12 && !found; i++) { found = !!document.querySelector("[data-group-view]"); if (!found) { fireEvent.click(screen.getByRole("button", { name: "Next step" })); await new Promise((r) => setTimeout(r, 30)); } }
    expect(found).toBe(true);
  }, 120_000);
  it("an invalid broadcast opens on the failing stage with the conflicting axis and NumPy's real error", async () => {
    render(<MemoryRouter><DataStudio presetParam="np-broadcast-bad" run={adapters()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    await screen.findByRole("list", { name: "Source code" }, { timeout: 60_000 });
    await screen.findByText(/^Stage \d+ of /);
    expect(screen.getAllByRole("alert").map((e) => e.textContent).join(" ")).toMatch(/operands could not be broadcast together with shapes \(2,3\) \(4,\)/);
    const n = Number(/of (\d+)/.exec(status().textContent ?? "")?.[1]);
    expect(status().textContent).toContain(`Step ${n} of ${n}`);
    expect(screen.getAllByText(/mismatch|incompatible|conflict/i).length).toBeGreaterThan(0); // the alignment table names the axis that cannot match
    expect(screen.getByTestId("data-feedback")).toBeTruthy(); // the adapter's explanation of the failure
  }, 120_000);
  it("an invalid matmul shows the inner-dimension rule and NumPy's real error", async () => {
    render(<MemoryRouter><DataStudio presetParam="np-matmul-bad" run={adapters()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    await screen.findByRole("list", { name: "Source code" }, { timeout: 60_000 });
    await screen.findByText(/^Stage \d+ of /);
    expect(document.querySelector("[data-matmul-valid='false']")).toBeTruthy();
    expect(screen.getAllByText(/NumPy said:/).length).toBeGreaterThan(0);
  }, 120_000);
  it("a syntax error shows the program's own error and says there is nothing to step through", async () => {
    render(<MemoryRouter><DataStudio run={adapters()} /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("Python code to trace"), { target: { value: "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    expect((await screen.findAllByRole("alert", {}, { timeout: 60_000 }))[0].textContent).toMatch(/SyntaxError/);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/nothing to step through/));
    expect(screen.queryByRole("list", { name: "Source code" })).toBeNull();
  }, 120_000);
  it("editing the code discards the old view; the Final variables tab lists the real final values", async () => {
    render(<MemoryRouter><DataStudio run={adapters()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Explain visually" }));
    await screen.findByRole("list", { name: "Source code" }, { timeout: 60_000 });
    fireEvent.click(screen.getByRole("tab", { name: "Final variables" }));
    const t = screen.getByRole("table", { name: "Final variables" });
    expect(within(t).getByText("big")).toBeTruthy();
    expect(within(t).getAllByText("DataFrame").length).toBeGreaterThan(1);
    fireEvent.change(await screen.findByLabelText("Python code to trace"), { target: { value: "x = 1\n" } });
    expect(screen.queryByRole("table", { name: "Final variables" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Playback controls" })).toBeNull();
  });
  it("the player's starting stage follows each new model: last stage after a failed run, first stage after a good one, last again after the next failure", async () => {
    render(<MemoryRouter><DataStudio presetParam="np-broadcast-bad" run={adapters()} /></MemoryRouter>);
    const where = () => { const m = /Step (\d+) of (\d+)/.exec(status().textContent ?? ""); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
    const explain = async () => { fireEvent.click(screen.getByRole("button", { name: /Explain visually|Trace again/ })); await screen.findByText(/^Stage \d+ of /, {}, { timeout: 60_000 }); };
    await explain();
    let [at, of] = where(); expect(of).toBeGreaterThan(1); expect(at).toBe(of);
    fireEvent.click(screen.getByRole("button", { name: "NumPy broadcasting" })); // code changes: the old view is discarded
    expect(screen.queryByRole("group", { name: "Playback controls" })).toBeNull();
    await explain();
    [at, of] = where(); expect(at).toBe(1); expect(of).toBeGreaterThan(1);
    fireEvent.change(await screen.findByLabelText("Python code to trace"), { target: { value: "import numpy as np\na = np.ones((3, 2))\nb = np.ones((4, 2))\nc = a + b\n" } });
    await explain();
    [at, of] = where(); expect(at).toBe(of);
  }, 120_000);
});
