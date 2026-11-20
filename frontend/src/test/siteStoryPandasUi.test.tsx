/**
 * The pandas pictures in the shared visualizer (jsdom), from real stage data: the picture and the story change together on every
 * step, kept / removed rows are marked in classes and words, Previous restores exactly the same state, and reduced motion draws the
 * same data as static before / after boards with no transition or entrance animation.
 */
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DataVisualizer } from "../site/workspace/visualizers/data";
import { buildDataModel, runDataProbe, type DataModelData } from "../site/lib/visual/dataframe";
import { buildDataBeats } from "../site/lib/visual/dataBeats";
import type { VisualModel } from "../site/workspace/types";
import { cpythonRun, hasDataPython } from "./siteWorkspaceDataPy";

async function modelOf(code: string): Promise<VisualModel> {
  const r = await runDataProbe(code, { run: cpythonRun });
  const data = buildDataModel("pandas", r.probe!, code);
  return { provenance: "executed", data, steps: buildDataBeats(data).length };
}
function Host({ vm, reduced = false, start = 0 }: { vm: VisualModel; reduced?: boolean; start?: number }) {
  const [step, setStep] = useState(start);
  return <DataVisualizer model={vm} step={step} onStepChange={setStep} reducedMotion={reduced} />;
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next step" }));
const prev = () => fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
const what = () => document.querySelector("[data-story='what'] dd")!.textContent!;
const picture = () => screen.getByTestId("beat-picture");
/** The cards a viewer can see (a card that has not arrived yet is in the board but hidden from everyone). */
const cards = () => [...picture().querySelectorAll<HTMLElement>("[data-card]:not([aria-hidden])")];
/** innerHTML with attributes in a fixed order, so only a real difference in the picture counts. */
const norm = (el: Element): string => {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("*")]) { const at = [...e.attributes].map((a) => [a.name, a.value] as const).sort(); for (const [n] of at) e.removeAttribute(n); for (const [n, v] of at) e.setAttribute(n, v); }
  return c.innerHTML;
};

const BRIEF = "import pandas as pd\ndf = pd.DataFrame({'name': ['A', 'B', 'C', 'D'], 'salary': [30000, 60000, 45000, 80000]})\nresult = df[df['salary'] > 50000]\n";

describe.skipIf(!hasDataPython)("pandas filter beats in the visualizer", () => {
  it("the picture and the story change together on each of the five steps", async () => {
    const vm = await modelOf(BRIEF);
    expect(vm.steps).toBe(6);
    render(<Host vm={vm} start={1} />);
    const seen: string[] = [];
    // 1 input: four rows, no verdict yet
    expect(screen.getAllByText(/Step 2 of 6/).length).toBeGreaterThan(0);
    expect(picture().getAttribute("data-beat-type")).toBe("flow");
    expect(cards().map((c) => c.getAttribute("data-card"))).toEqual(["0", "1", "2", "3"]);
    expect(cards().every((c) => c.getAttribute("data-tone") === "normal")).toBe(true);
    expect(picture().querySelector("[data-testid='flow-verdict']")).toBeNull();
    expect(what()).toContain("The input has 4 rows");
    seen.push(what());
    // 2 condition per row: the verdict chips
    next();
    expect(picture().getAttribute("data-beat-type")).toBe("calc");
    const rows = [...picture().querySelectorAll("[data-testid='calc-row']")];
    expect(rows.map((r) => r.getAttribute("data-verdict"))).toEqual(["false", "true", "false", "true"]);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("30000 > 50000"), expect.stringContaining("60000 > 50000"), expect.stringContaining("45000 > 50000"), expect.stringContaining("80000 > 50000")]);
    expect(what()).toContain("Evaluates df['salary'] > 50000 once for every row");
    seen.push(what());
    // 3 classification: kept / removed tones with verdict words, rows have not moved
    next();
    expect(cards().map((c) => c.getAttribute("data-tone"))).toEqual(["removed", "kept", "removed", "kept"]);
    expect(cards().map((c) => c.getAttribute("data-lane"))).toEqual(["0", "0", "0", "0"]);
    expect([...picture().querySelectorAll("[data-testid='flow-verdict']")].map((v) => v.textContent)).toEqual(["✕ False", "✓ True", "✕ False", "✓ True"]);
    seen.push(what());
    // 4 filtering: kept rows are in the result lane, removed rows stay and are de-emphasized
    next();
    expect(cards().map((c) => `${c.getAttribute("data-card")}:${c.getAttribute("data-lane")}:${c.getAttribute("data-faded") ?? ""}`)).toEqual(["0:0:true", "1:1:", "2:0:true", "3:1:"]);
    expect(within(within(picture()).getByRole("list", { name: "Legend" })).getByText(/removed/)).toBeTruthy(); // the legend says it in words
    seen.push(what());
    // 5 result: the real DataFrame and the reasons
    next();
    expect(screen.getByRole("table", { name: /Result: 2 rows/ })).toBeTruthy();
    expect(within(screen.getByRole("table", { name: /Result: 2 rows/ })).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByTestId("flow-reasons").textContent).toContain("Row 0: 30000 > 50000 is False → removed");
    seen.push(what());
    expect(new Set(seen).size).toBe(5);
    expect(screen.getByRole("button", { name: "Next step" })).toHaveProperty("disabled", true);
  });
  it("Previous restores exactly the picture and the story of the step before", async () => {
    const vm = await modelOf(BRIEF);
    render(<Host vm={vm} start={1} />);
    const snap = () => `${what()}\n${norm(picture())}`;
    const states = [snap()];
    for (let i = 0; i < 4; i++) { next(); states.push(snap()); }
    for (let i = 3; i >= 0; i--) { prev(); expect(snap()).toBe(states[i]); }
    // and Next again gives the same state as the first time: nothing is re-run or accumulated
    for (let i = 1; i <= 4; i++) { next(); expect(snap()).toBe(states[i]); }
  });
  it("the live region is the 'what' card; the picture has none and holds all the data a screen reader needs", async () => {
    const vm = await modelOf(BRIEF);
    render(<Host vm={vm} start={3} />);
    const live = document.querySelector("[data-story='what'] dd")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(picture().querySelector("[aria-live]")).toBeNull();
    expect(screen.getAllByText(what())).toHaveLength(1);
    expect(cards()[1].getAttribute("aria-label")).toContain("1: B, 60000 (kept, ✓ True)".replace("✓ ", ""));
    // the full stage is still one click away, collapsed
    expect(screen.getByTestId("stage-details").hasAttribute("open")).toBe(false);
  });
  it("reduced motion: the same data as two static boards, no transition, no entrance animation", async () => {
    const vm = await modelOf(BRIEF);
    const { unmount } = render(<Host vm={vm} start={4} reduced />);
    // the step in which rows move is two boards: before and after
    const statics = screen.getByTestId("flow-static");
    const boards = within(statics).getAllByTestId("flow-board");
    expect(boards).toHaveLength(2);
    const tones = (b: HTMLElement) => [...b.querySelectorAll<HTMLElement>("[data-card]")].map((c) => `${c.getAttribute("data-card")}:${c.getAttribute("data-lane")}:${c.getAttribute("data-tone")}`);
    expect(tones(boards[0])).toEqual(["0:0:removed", "1:0:kept", "2:0:removed", "3:0:kept"]);
    expect(tones(boards[1])).toEqual(["0:0:removed", "1:1:kept", "2:0:removed", "3:1:kept"]);
    for (const c of statics.querySelectorAll<HTMLElement>("[data-card]")) expect(c.style.transition).toBe("");
    unmount();
    // the condition step: chips are there, without the entrance animation class
    render(<Host vm={vm} start={2} reduced />);
    expect(picture().querySelectorAll("[data-testid='calc-true']")).toHaveLength(2);
    expect(picture().querySelector(".df-cell")).toBeNull();
    // with motion, the same step animates the chips in and the board cards transition by transform and opacity only
  });
  it("with motion on, cards carry CSS transitions on transform, opacity and colour only (never 'all')", async () => {
    const vm = await modelOf(BRIEF);
    render(<Host vm={vm} start={4} />);
    for (const c of cards()) {
      expect(c.style.transition).toMatch(/^transform \d+ms .*, opacity \d+ms/);
      expect(c.style.transition).not.toMatch(/\ball\b/);
    }
    expect(picture().innerHTML).not.toMatch(/transition: all|transition-all/);
    expect(picture().querySelectorAll("[data-card]").length).toBe(4); // one card per real row: nothing is duplicated or invented
  });
});

describe.skipIf(!hasDataPython)("other pandas pictures", () => {
  it("merge: both tables, the key links, the result with its origin; groupby: coloured groups then the aggregate", async () => {
    const vm = await modelOf("import pandas as pd\na = pd.DataFrame({'id': [1, 2, 3], 'x': list('pqr')})\nb = pd.DataFrame({'id': [2, 3, 4], 'y': [10, 20, 40]})\nm = a.merge(b, on='id', how='outer')\n");
    const first = buildDataBeats(vm.data as DataModelData).findIndex((x) => x.view.type === "flow");
    render(<Host vm={vm} start={first + 1} />);
    expect(within(picture()).getByText("Left table")).toBeTruthy();
    expect(within(picture()).getByText("Right table")).toBeTruthy();
    const links = [...picture().querySelectorAll("[data-link='on']")];
    expect(links).toHaveLength(2);
    expect(cards().map((c) => `${c.getAttribute("data-card")}:${c.getAttribute("data-tone")}`)).toEqual(["0:unmatched", "1:matched", "2:matched", "0:matched", "1:matched", "2:unmatched"]);
    next();
    next();
    expect(screen.getByRole("table", { name: /Result: merged, 4 rows/ })).toBeTruthy();
    expect(within(picture()).getByText("left only")).toBeTruthy();
    expect(within(picture()).getByText("right only")).toBeTruthy();
  });
  it("groupby then sum: groups form with a colour each, then each group's calculation and result", async () => {
    const vm = await modelOf("import pandas as pd\ndf = pd.DataFrame({'k': list('abab'), 'v': [1, 2, 3, 4]})\nt = df.groupby('k')['v'].sum()\n");
    const beats = buildDataBeats(vm.data as DataModelData);
    const g = beats.findIndex((b) => b.stage === 1);
    const first = render(<Host vm={vm} start={g + 1} />);
    expect(cards().map((c) => c.getAttribute("data-group"))).toEqual(["0", "1", "0", "1"]);
    expect(cards().map((c) => c.getAttribute("data-tone"))).toEqual(["group", "group", "group", "group"]);
    next();
    // the rows travel into the groups lane under a header each: a's rows (0, 2) first, then b's (1, 3)
    const y = (c: HTMLElement) => Number(/translate\([^,]*, (\d+)px\)/.exec(c.style.transform)![1]);
    const lane1 = cards().filter((c) => c.getAttribute("data-lane") === "1").sort((a, b) => y(a) - y(b));
    expect(lane1.map((c) => c.getAttribute("data-card"))).toEqual(["a", "0", "2", "b", "1", "3"]);
    // the aggregation stage is the stage after the (generic) column selection
    const s = beats.findIndex((b) => b.stage === 3);
    first.unmount();
    render(<Host vm={vm} start={s + 1} />);
    const calcs = [...document.querySelectorAll("[data-testid='group-calc']")];
    expect(calcs.map((c) => c.textContent)).toEqual(["sum(1, 3) = 4", "sum(2, 4) = 6"]);
    expect(calcs.every((c) => c.getAttribute("aria-hidden") === "false" || !c.hasAttribute("aria-hidden"))).toBe(true);
    next();
    expect(screen.getAllByRole("table", { name: /Result: one row per group/ }).length).toBeGreaterThan(0);
  });
  it("select, calculate and fill pictures mark columns and cells with words as well as colour", async () => {
    const vm = await modelOf("import pandas as pd\nimport numpy as np\ndf = pd.DataFrame({'a': [1.0, np.nan], 'b': [3.0, 4.0]})\nc = df[['a']]\nf = df.fillna(0)\n");
    const beats = buildDataBeats(vm.data as DataModelData);
    const sel = beats.findIndex((b) => b.stage === 1);
    const first = render(<Host vm={vm} start={sel + 1} />);
    expect(screen.getAllByTestId("col-tag").map((t) => t.textContent!.trim())).toEqual(["✓ selected", "✕ left out"]);
    const fill = beats.findIndex((b) => b.stage === 2);
    first.unmount();
    render(<Host vm={vm} start={fill + 1} />);
    expect(document.querySelectorAll("td[data-tone='new']").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NaN → 0.0").length).toBeGreaterThan(0);
  });
  it("sampled input: the picture says it draws the first 12 rows and the lane count stays exact", async () => {
    const vm = await modelOf("import pandas as pd\ndf = pd.DataFrame({'v': list(range(30))})\nr = df[df['v'] > 10]\n");
    render(<Host vm={vm} start={1} />);
    expect(screen.getByTestId("pandas-sampled").textContent).toContain("the first 12 of 30 rows");
    expect(cards()).toHaveLength(12);
    expect(screen.getAllByTestId("lane-count").map((x) => x.textContent)).toEqual(["30", "19"]);
  });
});
