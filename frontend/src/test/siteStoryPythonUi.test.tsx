// The Python story UI in jsdom, rendered from REAL CPython traces: code highlight, inspector row and story move together.
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildTraceProgram, parseTrace, type TraceOptions } from "../site/lib/visual/pyTrace";
import { buildPythonVisualModel, type PythonVisualData } from "../site/workspace/adapters/python/model";
import { TraceViewer } from "../site/components/visual/PythonTimeMachine";
import { PythonTraceVisualizer } from "../site/workspace/visualizers/python/PythonTraceVisualizer";
import { pyStepStory } from "../site/lib/visual/pyStory";
import { STORY_PARTS } from "../site/lib/visual/story";
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
const stepsOf = (m: VisualModel) => (m.data as PythonVisualData).trace.steps.length;
const dataOf = (m: VisualModel) => m.data as PythonVisualData;
const PRICES = "prices = [100, 200, 300]\ntotal = 0\nfor price in prices:\n    total += price\nprint(total)\n";
const CALLS = "def add(a, b):\n    total = a + b\n    return total\ndef twice(x):\n    y = add(x, x)\n    return y\nr = twice(3)\nprint(r)\n";

/** A host that owns the step, like the workspace player: Next, Previous, Reset and a jump. */
function Host({ model, reducedMotion = false, start = 0 }: { model: VisualModel; reducedMotion?: boolean; start?: number }) {
  const [step, setStep] = useState(start);
  return (
    <div>
      <button type="button" onClick={() => setStep((s) => Math.min(stepsOf(model) - 1, s + 1))}>host-next</button>
      <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))}>host-prev</button>
      <button type="button" onClick={() => setStep(0)}>host-reset</button>
      <button type="button" onClick={() => setStep(stepsOf(model) - 1)}>host-last</button>
      <PythonTraceVisualizer model={model} step={step} onStepChange={setStep} reducedMotion={reducedMotion} />
    </div>
  );
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const text = (id: string) => screen.getByTestId(id).textContent ?? "";
const nowLine = () => Number(/^\d+/.exec(document.querySelector("[data-mark='now']")!.textContent!)![0]);
const whatText = () => screen.getByTestId("step-story").querySelector("[data-story='what'] dd")!.textContent ?? "";
const row = (name: string) => within(screen.getByRole("table", { name: "Variable inspector" })).getAllByText(name).map((e) => e.closest("tr")!)[0];

describe.skipIf(!hasPython)("Python story UI: code, inspector and story move together", () => {
  const m = modelOf(PRICES);
  const t = dataOf(m).trace;
  const ctx = { code: PRICES, source: dataOf(m).source, diagnoses: dataOf(m).diagnoses };

  it("on every step the highlighted line, the inspector value and the story agree with the trace", () => {
    render(<Host model={m} />);
    for (let i = 0; i < t.steps.length; i++) {
      const s = t.steps[i];
      const expected = pyStepStory(t, i, ctx);
      expect(nowLine()).toBe(s.line);
      expect(whatText()).toBe(expected.story.what);
      expect(text("step-story")).toContain(`Step ${i + 1} of ${t.steps.length}`);
      for (const { key } of STORY_PARTS) expect(screen.getByTestId("step-story").querySelector(`[data-story='${key}']`)!.textContent).toContain(expected.story[key]);
      // the inspector row of `total` shows the recorded value of this step
      const frame = s.frames[s.frames.length - 1];
      if ("total" in frame.vars) expect(row("total").textContent).toContain(t.vals[frame.vars.total].r);
      expect(text("py-statement-code")).toBe(expected.scene.statement || "(end of the program)");
      if (i < t.steps.length - 1) click("host-next");
    }
  });

  it("shows 0 + 100 = 100, then 100 + 200 = 300, then 300 + 300 = 600 as the line runs", () => {
    render(<Host model={m} start={3} />);
    expect(screen.getByTestId("py-calc").textContent).toBe("0 + 100 = 100");
    expect(screen.getByTestId("py-calc").getAttribute("data-formula")).toBe("0 + 100 = 100");
    expect(text("py-calc-names")).toContain("total, price");
    const change = screen.getByTestId("py-var-change");
    expect(change.getAttribute("data-name")).toBe("total");
    expect(change.textContent).toContain("0");
    expect(change.textContent).toContain("→");
    expect(change.textContent).toContain("100");
    // the inspector flags the row before it changes, and after it
    expect(within(row("total")).getByTestId("chip-next").textContent).toContain("0 → 100");
    click("host-next"); // header, total is now 100
    expect(within(row("total")).getByTestId("chip-changed").textContent).toBe("was 0 → 100");
    click("host-next");
    expect(screen.getByTestId("py-calc").textContent).toBe("100 + 200 = 300");
    click("host-next"); click("host-next");
    expect(screen.getByTestId("py-calc").textContent).toBe("300 + 300 = 600");
  });

  it("the list has its current element highlighted at each header and body step", () => {
    render(<Host model={m} start={2} />);
    const current = () => [...screen.getByTestId("py-list").querySelectorAll("li[data-state='current']")].map((li) => li.textContent);
    const seen: string[][] = [];
    for (let i = 2; i < 8; i++) { seen.push(current()); click("host-next"); }
    expect(seen.map((x) => x.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(seen.map((x) => x[0]?.replace(/now|done/g, ""))).toEqual(["0100", "0100", "1200", "1200", "2300", "2300"]);
    expect(current()).toEqual([]); // step 9: the loop header that finds no items left
    expect(screen.getByTestId("py-loop").getAttribute("data-state")).toBe("finished");
    expect([...screen.getByTestId("py-list").querySelectorAll("li")].every((li) => li.getAttribute("data-state") === "done")).toBe(true);
  });

  it("the output step shows 600 in the output strip and in the story", () => {
    render(<Host model={m} start={9} />);
    expect(text("py-output-new")).toBe("600");
    expect(whatText()).toContain("print(total)");
    expect(text("step-story")).toContain("0 → 100 → 300 → 600");
  });

  it("Previous restores exactly what Next showed, and Reset returns to step 1", () => {
    render(<Host model={m} start={4} />);
    const snap = () => `${nowLine()}|${text("step-story")}|${text("py-statement")}|${row("total").textContent}`;
    const at4 = snap();
    click("host-next"); click("host-next");
    expect(snap()).not.toBe(at4);
    click("host-prev"); click("host-prev");
    expect(snap()).toBe(at4);
    click("host-last");
    click("host-reset");
    expect(nowLine()).toBe(1);
    expect(text("step-story")).toContain("Step 1 of 11");
    click("host-next"); click("host-next"); click("host-next"); click("host-next");
    click("host-reset"); click("host-next"); click("host-next"); click("host-next"); click("host-next");
    expect(snap()).toBe(at4);
  });

  it("the live region is the 'what' card and the only one in the story", () => {
    render(<Host model={m} start={3} />);
    const live = screen.getByTestId("step-story").querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0].closest("[data-story]")!.getAttribute("data-story")).toBe("what");
    expect(live[0].textContent).toBe(whatText());
    click("host-next");
    expect(screen.getByTestId("step-story").querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(screen.getByTestId("step-story").querySelector("[aria-live]")!.textContent).toBe(pyStepStory(t, 4, ctx).story.what);
  });

  it("the story comes first, before the code and the variable table", () => {
    const { container } = render(<Host model={m} start={3} />);
    const box = container.querySelector("[data-testid='python-visualizer']")!;
    const order = [...box.querySelectorAll("[data-testid='py-statement'], [data-testid='step-story'], [aria-label='Source code'], [aria-label='Variable inspector']")].map((e) => e.getAttribute("data-testid") ?? e.getAttribute("aria-label"));
    expect(order).toEqual(["py-statement", "step-story", "Source code", "Variable inspector"]);
  });
});

describe.skipIf(!hasPython)("Python story UI: reduced motion", () => {
  const m = modelOf(PRICES);
  it("shows the same text and values with and without motion; reduced renders no animation class", () => {
    const grab = (reduced: boolean) => {
      const out: string[] = [];
      const { container, unmount } = render(<Host model={m} reducedMotion={reduced} />);
      for (let i = 0; i < stepsOf(m); i++) {
        const box = screen.getByTestId("py-story-block");
        out.push(box.textContent! + "|" + text("py-statement") + "|" + screen.getByRole("table", { name: "Variable inspector" }).textContent);
        if (i === 3) {
          if (reduced) {
            // `df-step` belongs to the shared StoryPanel (the site's own reduced-motion CSS silences it); every class this task adds is absent.
            expect(container.innerHTML.replace(/df-step/g, "")).not.toMatch(/df-cell|transition-|scale-110|opacity-60|animation/);
            expect(screen.getByTestId("python-visualizer").getAttribute("data-reduced-motion")).toBe("true");
          } else {
            expect(container.innerHTML).toMatch(/df-cell/);
          }
        }
        if (i < stepsOf(m) - 1) click("host-next");
      }
      unmount();
      return out;
    };
    expect(grab(true)).toEqual(grab(false).map((s) => s));
  });
  it("without motion the change is a static before and after pair, with the list item still marked", () => {
    render(<Host model={m} reducedMotion start={3} />);
    const change = screen.getByTestId("py-var-change");
    expect(change.querySelector("[title='Value before this line']")!.textContent).toBe("0");
    expect(change.querySelector("[title='Value after this line']")!.textContent).toBe("100");
    expect(document.querySelector("[data-testid='py-list'] li[data-state='current']")!.textContent).toContain("now");
  });
});

describe.skipIf(!hasPython)("Python story UI: calls, errors, sampling", () => {
  it("a call step draws arguments flowing into parameters and the new frame; a return step the value", () => {
    const m = modelOf(CALLS);
    const t = dataOf(m).trace;
    const c = t.steps.findIndex((s) => s.ev === "call" && s.frames.length === 3);
    const { unmount } = render(<Host model={m} start={c} />);
    const params = screen.getAllByTestId("py-param").map((e) => e.textContent);
    expect(params).toEqual(["x→a = 3", "x→b = 3"]);
    expect(within(screen.getByTestId("py-stack")).getAllByRole("listitem")).toHaveLength(3);
    expect(text("py-stack")).toContain("add() (new)");
    unmount();
    const r = t.steps.findIndex((s) => s.ev === "return" && s.frames.length === 3);
    render(<Host model={m} start={r} />);
    expect(text("py-return-value")).toBe("return 6");
    expect(text("py-return")).toContain("a, b, total");
  });
  it("the calling line shows the call and its returned value", () => {
    const m = modelOf(CALLS);
    const t = dataOf(m).trace;
    render(<Host model={m} start={t.steps.findIndex((s) => s.ev === "line" && s.line === 5)} />);
    expect(text("py-line-call")).toContain("add(a=3, b=3)");
    expect(text("py-line-call")).toContain("returned 6");
  });
  it("a condition draws its outcome and the executed line it was read from", () => {
    const m = modelOf("x = 7\nif x > 10:\n    k = 1\nelif x > 5:\n    k = 2\nprint(k)\n");
    const t = dataOf(m).trace;
    render(<Host model={m} start={t.steps.findIndex((s) => s.line === 2)} />);
    expect(screen.getByTestId("py-branch").getAttribute("data-outcome")).toBe("false");
    expect(text("py-outcome")).toBe("False");
    expect(text("py-branch-label")).toContain("next executed line: 4");
  });
  it("an exception step is drawn as an error with the diagnosis kept below", () => {
    const m = modelOf("a = [1]\nprint(a[3])\n");
    const t = dataOf(m).trace;
    render(<Host model={m} start={t.steps.findIndex((s) => s.ev === "exception")} />);
    expect(text("py-error")).toContain("IndexError");
    expect(text("py-error")).toContain("print(a[3])");
    expect(screen.getByTestId("diagnosis")).toBeTruthy();
    expect(whatText()).toContain("IndexError");
  });
  it("a sampled stretch says so in the strip and the story, and shows no calculation", () => {
    const m = modelOf("t = 0\nfor i in range(5000):\n    t += i\nprint(t)\n");
    const d = dataOf(m);
    const g = d.trace.gaps![0].after;
    render(<Host model={m} start={g} />);
    expect(screen.getByTestId("py-sampled")).toBeTruthy();
    expect(screen.queryByTestId("py-calc")).toBeNull();
    expect(screen.getByTestId("step-story").textContent).toMatch(/sampled/);
  });
});

describe.skipIf(!hasPython)("Python story UI: the Code Time Machine (/visual/python) shows the same story", () => {
  it("TraceViewer renders the picture and the four answers and moves them with Next", () => {
    const m = modelOf(PRICES);
    const t = dataOf(m).trace;
    render(<TraceViewer code={PRICES} trace={t} />);
    expect(text("step-story")).toContain(`Step 1 of ${t.steps.length}`);
    expect(whatText()).toContain("prices = [100, 200, 300]");
    for (let k = 0; k < 3; k++) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByTestId("py-calc").textContent).toBe("0 + 100 = 100");
    expect(whatText()).toContain("Iteration 1 of 3");
  });
});
