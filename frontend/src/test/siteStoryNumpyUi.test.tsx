// The NumPy beat pictures rendered from REAL stage data (CPython + numpy run the probe): picture, story and step counter move together,
// reduced motion shows the same data statically, and the live region is the "what" card.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DataVisualizer } from "../site/workspace/visualizers/data";
import { NumpyBeatView } from "../site/components/visual/NumpyBeatView";
import { buildDataModel, runDataProbe, type DataModelData } from "../site/lib/visual/dataframe";
import { buildDataBeats } from "../site/lib/visual/dataBeats";
import { numpyBeats } from "../site/lib/visual/numpyBeats";
import type { VisualModel } from "../site/workspace/types";
import { cpythonRun, hasDataPython } from "./siteWorkspaceDataPy";

const HEAD = "import numpy as np\n";
async function modelOf(code: string): Promise<{ vm: VisualModel; data: DataModelData; beats: ReturnType<typeof buildDataBeats> }> {
  const r = await runDataProbe(code, { run: cpythonRun });
  const data = buildDataModel("numpy", r.probe!, code);
  const beats = buildDataBeats(data);
  return { vm: { provenance: "executed", data, steps: beats.length }, data, beats };
}
function Host({ vm, reduced = true, start = 0 }: { vm: VisualModel; reduced?: boolean; start?: number }) {
  const [step, setStep] = useState(start);
  return <DataVisualizer model={vm} step={step} onStepChange={setStep} reducedMotion={reduced} />;
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next step" }));
const prev = () => fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
const picture = () => screen.getByTestId("np-picture");
const what = () => document.querySelector("[data-story='what'] dd")!.textContent;
const brief = `${HEAD}a = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nresult = a + b\n`;

describe.skipIf(!hasDataPython)("the brief's example, beat by beat", () => {
  it("picture, story and step counter agree at every one of the six beats, and the live region is the 'what' card", async () => {
    const { vm, beats } = await modelOf(brief);
    const first = beats.findIndex((b) => b.stage === 2);
    render(<Host vm={vm} start={first} />);
    const types = ["arrays", "shapes", "align", "expand", "compute", "result"];
    for (let k = 0; k < 6; k++) {
      const beat = beats[first + k];
      expect(picture().getAttribute("data-np-view")).toBe(types[k]);
      expect(screen.getByTestId("beat-picture").getAttribute("data-beat-type")).toBe(types[k]);
      expect(what()).toBe(beat.story.what);
      expect(screen.getByTestId("step-story").getAttribute("data-step-key")).toBe(beat.id);
      expect(within(screen.getByTestId("step-story")).getByText(`Step ${first + k + 1} of ${beats.length}`)).toBeTruthy(); // the story's own counter
      expect(screen.getAllByText(`Step ${first + k + 1} of ${beats.length}`).length).toBeGreaterThanOrEqual(2); // and the player's
      expect(screen.getByText(new RegExp(`part ${k + 1} of 6: ${beat.title}`))).toBeTruthy();
      // exactly one live region lives in the story, and it is the "what" sentence
      const live = screen.getByTestId("step-story").querySelectorAll("[aria-live]");
      expect(live).toHaveLength(1);
      expect(live[0].closest("[data-story]")!.getAttribute("data-story")).toBe("what");
      expect(live[0].textContent).toBe(beat.story.what);
      if (k < 5) next();
    }
  });
  it("each picture shows the real data of its beat", async () => {
    const { vm, beats } = await modelOf(brief);
    const first = beats.findIndex((b) => b.stage === 2);
    const { container } = render(<Host vm={vm} start={first} />);
    // 1 arrays: the real cells with positions
    expect([...picture().querySelectorAll("[data-np-operand='A'] td")].map((c) => c.textContent)).toEqual(["1", "2", "3"]);
    expect([...picture().querySelectorAll("[data-np-operand='B'] td")].map((c) => c.textContent)).toEqual(["10", "20", "30"]);
    expect(picture().querySelector("[data-np-operand='A'] td")!.getAttribute("title")).toBe("A[0, 0] = 1");
    next();
    // 2 shapes
    expect([...picture().querySelectorAll("[data-np-shape-text]")].map((e) => e.textContent)).toEqual(["(3, 1)", "(3,)"]);
    next();
    // 3 alignment: right to left, B padded to (1, 3)
    const align = picture().querySelector("table")!;
    expect([...align.querySelectorAll("thead th[data-np-axis]")].map((t) => t.getAttribute("data-np-axis"))).toEqual(["-2", "-1"]);
    expect(within(align).getByText("(3,)")).toBeTruthy();
    expect(align.querySelectorAll("td[data-status='missing']")).toHaveLength(1);
    expect(align.querySelectorAll("td[data-status='stretch']")).toHaveLength(1); // A's size-1 last axis
    next();
    // 4 stretch: 3 originals + 6 repeats in each operand
    expect(container.querySelectorAll("[data-np-expanded='A'] td[data-tone='repeat']")).toHaveLength(6);
    expect(container.querySelectorAll("[data-np-expanded='B'] td[data-tone='repeat']")).toHaveLength(6);
    expect(container.querySelectorAll("[data-np-expanded='A'] td")).toHaveLength(9);
    next();
    // 5 calculation: nine formulas, the first is 1 + 10 = 11
    const calc = [...picture().querySelectorAll("[data-np-calc]")];
    expect(calc).toHaveLength(9);
    expect(calc[0].querySelector("[data-np-formula]")!.textContent).toBe("1 + 10");
    expect(calc[0].textContent).toContain("= 11");
    expect(calc.map((c) => c.getAttribute("data-np-calc"))).toEqual(["0,0", "0,1", "0,2", "1,0", "1,1", "1,2", "2,0", "2,1", "2,2"]);
    next();
    // 6 the real result and its shape
    expect([...picture().querySelectorAll("tbody td")].map((c) => c.textContent)).toEqual(["11", "21", "31", "12", "22", "32", "13", "23", "33"]);
    expect(picture().querySelector("[data-np-result-shape]")!.textContent).toBe("(3, 3)");
  });
  it("Previous and Restart return exactly the same picture and story", async () => {
    const { vm, beats } = await modelOf(brief);
    const first = beats.findIndex((b) => b.stage === 2);
    render(<Host vm={vm} start={first} />);
    const snap = () => `${picture().outerHTML}|${screen.getByTestId("step-story").outerHTML}`;
    const seen: string[] = [snap()];
    for (let k = 0; k < 5; k++) { next(); seen.push(snap()); }
    for (let k = 4; k >= 0; k--) { prev(); expect(snap()).toBe(seen[k]); }
    for (let k = 0; k < 3; k++) next();
    fireEvent.click(screen.getByRole("button", { name: "Restart" })); // back to the very first step of the program
    expect(within(screen.getByTestId("step-story")).getByText(`Step 1 of ${beats.length}`)).toBeTruthy();
    for (let k = 0; k < first; k++) next();
    expect(snap()).toBe(seen[0]);
  });
});

describe.skipIf(!hasDataPython)("reduced motion", () => {
  it("shows the same information with no animation at all; full motion animates with a capped stagger", async () => {
    const { vm, beats } = await modelOf(brief);
    const first = beats.findIndex((b) => b.stage === 2);
    const text: string[] = [];
    for (const reduced of [true, false]) {
      render(<Host vm={vm} reduced={reduced} start={first + 4} />); // the calculation
      const p = picture();
      expect(p.getAttribute("data-motion")).toBe(reduced ? "reduced" : "full");
      const animated = [...p.querySelectorAll<HTMLElement>("[style]")].filter((e) => /animation/.test(e.getAttribute("style") ?? ""));
      if (reduced) expect(animated).toHaveLength(0);
      else {
        expect(animated.length).toBe(9);
        const delays = animated.map((e) => parseInt(e.style.animationDelay, 10));
        expect(Math.max(...delays)).toBeLessThanOrEqual(150); // 5 steps of 30 ms: the stagger stops growing
        expect(animated.every((e) => e.style.animationName === "df-pop")).toBe(true);
        expect(animated.every((e) => e.style.animationIterationCount === "")).toBe(true); // nothing loops
      }
      text.push(p.textContent!);
      cleanup();
    }
    expect(text[0]).toBe(text[1]);
  });
  it("the alignment pairs and the stretch beat keep their text and states in reduced motion", async () => {
    const { vm, beats } = await modelOf(brief);
    const first = beats.findIndex((b) => b.stage === 2);
    render(<Host vm={vm} reduced start={first + 2} />);
    expect(picture().querySelectorAll("td[data-status]").length).toBeGreaterThan(0);
    expect(picture().textContent).toContain("checked 1st");
    expect(picture().textContent).toContain("added");
    next();
    expect(picture().querySelectorAll("td[data-tone='repeat']").length).toBe(12);
    expect([...picture().querySelectorAll("td[data-tone='repeat']")].every((c) => c.textContent!.includes("copy"))).toBe(true);
  });
  it("the sources never loop an animation or use 'transition: all'", () => {
    for (const f of ["NumpyBeatView.tsx", "NumpyParts.tsx"]) {
      const src = readFileSync(path.resolve(__dirname, "../site/components/visual", f), "utf8");
      expect(src, f).not.toMatch(/transition-all|transition:\s*all|infinite|animate-pulse|animate-spin/);
    }
  });
});

describe.skipIf(!hasDataPython)("failing stages", () => {
  it("an invalid broadcast opens with its beats: the conflicting axis is marked and NumPy's real error is shown", async () => {
    const { vm, beats } = await modelOf(`${HEAD}a = np.ones((3, 2))\nb = np.ones((4, 2))\nresult = a + b\n`);
    const first = beats.findIndex((b) => b.stage === 2);
    render(<Host vm={vm} start={first + 2} />);
    expect(picture().getAttribute("data-np-view")).toBe("align");
    expect(picture().querySelector("[data-np-valid='false']")).toBeTruthy();
    const bad = picture().querySelectorAll("td[data-status='incompatible']");
    expect(bad).toHaveLength(2);
    expect([...bad].map((c) => c.textContent!.match(/\d/)![0])).toEqual(["3", "4"]);
    expect(picture().textContent).toContain("axis -2");
    next();
    expect(screen.getByTestId("np-error").textContent).toContain("ValueError: operands could not be broadcast together with shapes (3,2) (4,2)");
    expect(screen.getByTestId("np-error").textContent).toContain("axis -2: A has 3, B has 4");
    expect(document.querySelector("[data-np-calc]")).toBeNull();
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled(); // it is the last beat: the failing stage
  });
  it("a calculation that disagrees with the recorded result is a visible consistency failure, not a formula", async () => {
    const { data, beats } = await modelOf(brief);
    const i = data.stages.length - 1;
    const st = JSON.parse(JSON.stringify(data.stages[i]));
    st.output.data[0][0] = "12";
    const bad = numpyBeats(st, data.analyses[i], i)!.find((b) => b.view.type === "compute")!;
    render(<>{NumpyBeatView({ beat: bad, stage: st, analysis: data.analyses[i], reducedMotion: true })}</>);
    expect(screen.getByTestId("np-consistency-failed").textContent).toContain("Consistency check failed");
    expect(screen.getByTestId("np-consistency-failed").textContent).toContain("12");
    expect(document.querySelector("[data-np-calc]")).toBeNull();
    expect(beats.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasDataPython)("matmul, reductions, indexing and reshape pictures", () => {
  it("matmul: the row of A, the column of B and the products are drawn for each output cell; the sample is labelled", async () => {
    const { vm, beats } = await modelOf(`${HEAD}a = np.arange(6).reshape(2, 3)\nb = np.arange(6).reshape(3, 2)\nr = a @ b\n`);
    const first = beats.findIndex((b) => b.view.type === "mm-rule");
    render(<Host vm={vm} start={first + 1} />); // the beat after the rule: output cell [0, 0]
    const cell = picture().querySelector("[data-np-mm-cell]")!;
    expect(cell.getAttribute("data-np-mm-cell")).toBe("0,0");
    expect([...picture().querySelectorAll("[data-np-grid='A'] td[data-tone='g0']")].map((c) => c.textContent)).toEqual(["0", "1", "2"]); // row 0 of A
    expect([...picture().querySelectorAll("[data-np-grid='B'] td[data-tone='g1']")].map((c) => c.textContent)).toEqual(["0", "2", "4"]); // column 0 of B
    expect([...picture().querySelectorAll("[data-np-term]")].map((t) => t.textContent)).toEqual(["0 × 0 = 0", "1 × 2 = 2", "2 × 4 = 8"]);
    expect(picture().querySelector("[data-np-sum]")!.textContent).toBe("10");
    expect(picture().querySelector("[data-np-sample]")!.getAttribute("data-np-sample")).toBe("all");
    next();
    expect(picture().querySelector("[data-np-mm-cell]")!.getAttribute("data-np-mm-cell")).toBe("0,1");
    expect(picture().querySelector("[data-np-grid='result'] td[data-tone='done']")!.textContent).toBe("10"); // the finished cell stays
    expect(picture().querySelector("[data-np-sum]")!.textContent).toBe("13");
    cleanup();
    const big = await modelOf(`${HEAD}a = np.arange(16).reshape(4, 4)\nb = a @ a\n`);
    const f2 = big.beats.findIndex((b) => b.view.type === "mm-cell");
    render(<Host vm={big.vm} start={f2} />);
    expect(picture().querySelector("[data-np-sample]")!.getAttribute("data-np-sample")).toBe("sampled");
    expect(picture().querySelector("[data-np-sample]")!.textContent).toMatch(/Sampled: this walks through 6 of the 16 output cells/);
  });
  it("axis reduction: cells are coloured by the output element they feed, then each group lists its values", async () => {
    const { vm, beats } = await modelOf(`${HEAD}a = np.arange(6).reshape(2, 3)\nr = a.sum(axis=0)\n`);
    const first = beats.findIndex((b) => b.view.type === "axis");
    render(<Host vm={vm} start={first} />);
    expect(picture().querySelector("[data-np-direction]")!.textContent).toContain("axis 0 collapses");
    const tones = [...picture().querySelectorAll("[data-np-grid='input'] tbody td")].map((c) => c.getAttribute("data-tone"));
    expect(tones).toEqual(["g0", "g1", "g2", "g0", "g1", "g2"]); // each column is one group
    expect([...picture().querySelectorAll("[data-np-group]")].map((g) => g.textContent)).toEqual(["1 → result[0]", "2 → result[1]", "3 → result[2]"]);
    next();
    const lanes = [...picture().querySelectorAll("[data-np-lane]")];
    expect(lanes.map((l) => l.querySelector("[data-np-lane-result]")!.textContent)).toEqual(["3", "5", "7"]);
    expect(lanes[1].textContent).toContain("1");
    expect(lanes[1].textContent).toContain("4");
  });
  it("indexing: the picked cells are highlighted with their positions; the result cells name where they came from", async () => {
    const { vm, beats } = await modelOf(`${HEAD}a = np.arange(12).reshape(3, 4)\nb = a[1:, ::2]\n`);
    const first = beats.findIndex((b) => b.view.type === "select");
    render(<Host vm={vm} start={first} />);
    const picked = [...picture().querySelectorAll("td[data-tone='sel']")].map((c) => c.getAttribute("data-pos"));
    expect(picked).toEqual(["1,0", "1,2", "2,0", "2,2"]);
    expect(picture().querySelector("[data-np-picked]")!.textContent).toContain("[1, 0], [1, 2], [2, 0], [2, 2]");
    next();
    expect([...picture().querySelectorAll("tbody td")].map((c) => c.textContent)).toEqual(["←[1, 0]4", "←[1, 2]6", "←[2, 0]8", "←[2, 2]10"]);
    expect(picture().querySelector("[data-np-memory]")!.getAttribute("data-np-memory")).toBe("view");
  });
  it("reshape and transpose: every output cell shows its source position", async () => {
    const { vm, beats } = await modelOf(`${HEAD}b = np.arange(6).reshape(2, 3)\nc = b.T\n`);
    const first = beats.findIndex((b) => b.view.type === "move" && (b.view as { mode?: string }).mode === "swap");
    render(<Host vm={vm} start={first} />);
    const after = [...picture().querySelectorAll("[data-np-grid='after'] tbody td")].map((c) => c.textContent);
    expect(after).toEqual(["←[0, 0]0", "←[1, 0]3", "←[0, 1]1", "←[1, 1]4", "←[0, 2]2", "←[1, 2]5"]);
    const before = [...picture().querySelectorAll("[data-np-grid='before'] tbody td")].map((c) => c.textContent);
    expect(before).toEqual(["→[0, 0]0", "→[1, 0]1", "→[2, 0]2", "→[0, 1]3", "→[1, 1]4", "→[2, 1]5"]);
  });
  it("a windowed array says so in the picture", async () => {
    const { vm, beats } = await modelOf(`${HEAD}a = np.arange(14 * 12).reshape(14, 12)\nb = np.arange(12)\nr = a + b\n`);
    const first = beats.findIndex((b) => b.view.type === "arrays" && b.stage === 3);
    render(<Host vm={vm} start={first} />);
    expect(picture().querySelector("[data-np-window]")!.textContent).toContain("the first 10 × 10 cells of the real (14, 12) array");
  });
});
