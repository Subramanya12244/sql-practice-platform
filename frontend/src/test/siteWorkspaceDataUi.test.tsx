// The pandas / NumPy visual components, rendered from REAL stage data (CPython with numpy and pandas runs the probe).
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DataFrameView } from "../site/components/visual/DataFrameView";
import { ArrayView } from "../site/components/visual/ArrayView";
import { BroadcastView } from "../site/components/visual/BroadcastView";
import { DataVisualizer, NumpyVisualizer, PandasVisualizer } from "../site/workspace/visualizers/data";
import { Visualizer as LazyVisualizer } from "../site/workspace/visualizers/data/LazyDataVisualizer";
import { alignShapes } from "../site/lib/visual/broadcast";
import { buildDataModel, runDataProbe, type DataModelData, type DataProbeResult, type DataStage } from "../site/lib/visual/dataframe";
import type { VisualModel } from "../site/workspace/types";
import { cpythonRun, hasDataPython } from "./siteWorkspaceDataPy";

async function modelOf(domain: "pandas" | "numpy", code: string): Promise<{ vm: VisualModel; p: DataProbeResult }> {
  const r = await runDataProbe(code, { run: cpythonRun });
  const p = r.probe!;
  const data = buildDataModel(domain, p, code);
  return { vm: { provenance: "executed", data, steps: p.stages.length }, p };
}
const stage = (p: DataProbeResult, op: string, n = 0): DataStage => p.stages.filter((s) => s.op === op)[n];

function Host({ vm, reduced = false, start = 0, spy }: { vm: VisualModel; reduced?: boolean; start?: number; spy?: (n: number) => void }) {
  const [step, setStep] = useState(start);
  return <DataVisualizer model={vm} step={step} onStepChange={(n) => { spy?.(n); setStep(n); }} reducedMotion={reduced} />;
}

describe.skipIf(!hasDataPython)("DataFrameView", () => {
  it("highlights changed cells and new columns against the before snapshot, and states the real shape", async () => {
    const { p } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2, 3]})\ndf.loc[1, 'a'] = 99\ndf['b'] = df['a'] * 2\n");
    const changes = p.stages.filter((s) => s.kind === "change");
    const edit = changes[0];
    const { container, unmount } = render(<DataFrameView snap={edit.output!} before={edit.inputs[0]} caption="After" />);
    expect(screen.getByRole("table", { name: "After" })).toBeTruthy();
    const changed = container.querySelectorAll("td[data-changed='true']");
    expect(changed).toHaveLength(1);
    expect(changed[0].textContent).toBe("99");
    expect(changed[0].getAttribute("title")).toContain("before: 2");
    expect(screen.getByText(/shape \(3, 1\)/)).toBeTruthy();
    unmount();
    const add = changes[1];
    render(<DataFrameView snap={add.output!} before={add.inputs[0]} />);
    expect(screen.getByRole("columnheader", { name: /b.*new/ })).toBeTruthy();
  });

  it("says when only part of a big table is drawn, with the real size", async () => {
    const { p } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({f'c{i}': range(30) for i in range(14)})\n");
    render(<DataFrameView snap={p.stages[0].output!} />);
    expect(screen.getByText(/shape \(30, 14\)/)).toBeTruthy();
    expect(screen.getByText(/showing the first 12 of 30 rows and 10 of 14 columns/)).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(13);
  });

  it("marks rows with words, not only colour (kept/removed, matched/no match)", async () => {
    const { p } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'a': [1, 5, 2, 8]})\nb = df[df['a'] > 3]\n");
    const sel = stage(p, "[]");
    render(<DataFrameView snap={sel.inputs[0]} rowMarks={[{ label: "kept", tone: "none" }, { label: "removed", tone: "bad" }, null, null]} markHeader="Row" />);
    expect(screen.getByText("removed")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Row" })).toBeTruthy();
  });

  it("shows missing values as NaN with the count under the column", async () => {
    const { p } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'a': [1.0, None]})\n");
    render(<DataFrameView snap={p.stages[0].output!} />);
    expect(screen.getByText("NaN")).toBeTruthy();
    expect(screen.getAllByText(/1 missing/).length).toBeGreaterThan(0);
  });

  it("reduced motion removes the colour transition", async () => {
    const { p } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'a': [1]})\n");
    const a = render(<DataFrameView snap={p.stages[0].output!} reducedMotion />);
    expect(a.container.innerHTML).not.toContain("transition-colors");
    a.unmount();
    const b = render(<DataFrameView snap={p.stages[0].output!} />);
    expect(b.container.innerHTML).toContain("transition-colors");
    expect(b.container.querySelector(".overflow-x-auto")).toBeTruthy(); // scrolls inside its box on a phone
  });
});

describe.skipIf(!hasDataPython)("ArrayView", () => {
  it("draws axes, marks selected elements and tells where each result element came from", async () => {
    const { p } = await modelOf("numpy", "import numpy as np\na = np.arange(12).reshape(3, 4)\ncol = a[:, 1]\n");
    const s = stage(p, "[]");
    const input = render(<ArrayView snap={s.inputs[0]} name="a" selected={s.pos!.sel} />);
    expect(input.container.querySelectorAll("td[data-selected='true']")).toHaveLength(3);
    expect(screen.getAllByText(/\(selected\)/)).toHaveLength(3);
    expect(screen.getByText(/axis 0/)).toBeTruthy();
    expect(screen.getByText(/shape \(3,4\)/)).toBeTruthy();
    input.unmount();
    const out = render(<ArrayView snap={s.output!} name="col" origin={{ src: s.pos!.src, inShape: s.inputs[0].shape! }} />);
    const cells = [...out.container.querySelectorAll("td")];
    expect(cells.map((c) => c.getAttribute("title"))).toEqual(["col[0] · 1 · from input [0, 1]", "col[1] · 5 · from input [1, 1]", "col[2] · 9 · from input [2, 1]"]);
  });
  it("colours reduction groups and highlights changed cells", async () => {
    const { p } = await modelOf("numpy", "import numpy as np\nx = np.arange(6).reshape(2, 3)\ns = x.sum(axis=0)\nx[0, 0] = 50\n");
    const s = stage(p, "sum");
    const r = render(<ArrayView snap={s.inputs[0]} reduce={{ axis: [0], keepdims: false }} />);
    const groups = [...r.container.querySelectorAll("td[data-group]")].map((c) => c.getAttribute("data-group"));
    expect(groups).toEqual(["0", "1", "2", "0", "1", "2"]); // cell [i, j] feeds output element j
    r.unmount();
    const ch = p.stages.find((x) => x.kind === "change")!;
    const c = render(<ArrayView snap={ch.output!} before={ch.inputs[0]} />);
    expect(c.container.querySelectorAll("td[data-changed='true']")).toHaveLength(1);
  });
  it("3-D arrays are drawn as labelled planes; truncation is stated with the real shape", async () => {
    const { p } = await modelOf("numpy", "import numpy as np\na = np.arange(24).reshape(2, 3, 4)\nb = np.arange(400).reshape(20, 20)\n");
    const a = render(<ArrayView snap={stage(p, "reshape", 0).output!} name="a" />);
    expect(a.container.querySelectorAll("table")).toHaveLength(2);
    expect(screen.getByText("a[0, :, :]")).toBeTruthy();
    a.unmount();
    render(<ArrayView snap={stage(p, "reshape", 1).output!} />);
    expect(screen.getByText(/showing 10 x 10 of \(20,20\)/)).toBeTruthy();
  });
});

describe("BroadcastView", () => {
  it("valid: every axis is labelled with a word and the verdict is announced", () => {
    render(<BroadcastView table={alignShapes([[2, 3], [3]])} names={["a", "b"]} />);
    expect(screen.getByRole("table", { name: /Broadcasting/ })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Valid.");
    expect(screen.getByRole("status").textContent).toContain("result has shape (2,3)");
    expect(screen.getAllByText("missing, counts as 1")).toHaveLength(1);
    expect(screen.getAllByText("equal").length).toBeGreaterThan(0);
  });
  it("invalid: names the conflicting axis and sizes, shows NumPy's real error", () => {
    const t = alignShapes([[2, 3], [4]]);
    const { container } = render(<BroadcastView table={t} names={["a", "b"]} errorText="operands could not be broadcast together with shapes (2,3) (4,) " check={{ ok: true, checks: [{ name: "x", ok: true, detail: "NumPy quotes (2,3) (4,)." }] }} />);
    expect(container.querySelector("[data-broadcast-valid='false']")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Not valid.");
    expect(screen.getAllByText("incompatible")).toHaveLength(2);
    expect(screen.getByText(/Axis -1: a has 3, b has 4/)).toBeTruthy();
    expect(screen.getByText(/ValueError: operands could not be broadcast together/)).toBeTruthy();
    expect(screen.getByText(/Checked against the real run/)).toBeTruthy();
  });
});

describe.skipIf(!hasDataPython)("DataVisualizer steps through real stages", () => {
  it("shows stage 1, moves with the shared player, reports the step and explains each stage", async () => {
    const { vm } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2, 3, 4]})\nsmall = df[df['a'] > 2]\n");
    const spy = vi.fn();
    render(<Host vm={vm} spy={spy} />);
    expect(screen.getByText(/Stage 1 of 2/)).toBeTruthy();
    expect(screen.getByText("Executed")).toBeTruthy();
    expect(screen.getByText(/Creates a DataFrame of shape \(4, 1\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(spy).toHaveBeenCalledWith(1);
    expect(screen.getByText(/Stage 2 of 2/)).toBeTruthy();
    expect(screen.getByText(/2 rows kept, 2 rows removed/)).toBeTruthy();
    expect(screen.getByText("Input shape").nextSibling!.textContent).toBe("(4, 1)");
    expect(screen.getByText("Output shape").nextSibling!.textContent).toBe("(2, 1)");
    expect(screen.getAllByText("removed")).toHaveLength(2);
    expect(document.querySelector("[data-consistency='ok']")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(screen.getByText(/Stage 1 of 2/)).toBeTruthy();
  });
  it("a controlled step set from outside is respected", async () => {
    const { vm } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2]})\nb = df.sort_values('a', ascending=False)\n");
    render(<Host vm={vm} start={1} />);
    expect(screen.getByText(/Stage 2 of 2/)).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Timeline" })).toHaveProperty("value", "1");
  });
  it("merge: both tables with matched/no match words, the output with its origin, and the unmatched keys", async () => {
    const { vm } = await modelOf("pandas", "import pandas as pd\nu = pd.DataFrame({'id': [1, 2, 3]})\no = pd.DataFrame({'uid': [1, 3, 9]})\nr = u.merge(o, left_on='id', right_on='uid', how='outer')\n");
    render(<Host vm={vm} start={2} />);
    expect(screen.getByText("Left table")).toBeTruthy();
    expect(screen.getByText("Right table")).toBeTruthy();
    expect(screen.getAllByText("no match")).toHaveLength(2);
    expect(screen.getByText("left only")).toBeTruthy();
    expect(screen.getByText("right only")).toBeTruthy();
    expect(screen.getByText("Left only").nextSibling!.textContent).toContain("keys 2");
    expect(screen.getByText("Right only").nextSibling!.textContent).toContain("keys 9");
    expect(screen.getByText(/outer merge on id \(left\) = uid \(right\)/)).toBeTruthy();
  });
  it("groupby: the groups are shown before the aggregation", async () => {
    const { vm } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'k': ['a', 'b', 'a'], 'v': [1, 2, 3]})\nt = df.groupby('k')['v'].sum()\n");
    render(<Host vm={vm} start={1} />);
    expect(screen.getByText(/2 groups by k from 3 rows/)).toBeTruthy();
    expect(screen.getByText(/group a/)).toBeTruthy();
    expect(screen.getByText(/Nothing is aggregated yet/)).toBeTruthy();
  });
  it("numpy: broadcasting stage shows the table, the result array and a passed consistency check", async () => {
    const { vm } = await modelOf("numpy", "import numpy as np\na = np.arange(6).reshape(2, 3)\nb = np.array([10, 20, 30])\nc = a + b\n");
    render(<Host vm={vm} start={3} />);
    expect(screen.getByRole("table", { name: /Broadcasting/ })).toBeTruthy();
    expect(screen.getAllByText(/Shapes \(2,3\) and \(3,\) are compatible/).length).toBeGreaterThan(0);
    expect(screen.getByText("Output shape").nextSibling!.textContent).toBe("(2,3)");
    expect(document.querySelector("[data-consistency='ok']")).toBeTruthy();
  });
  it("numpy: invalid broadcast and invalid matmul show the real error and which dimensions conflict", async () => {
    const bad = await modelOf("numpy", "import numpy as np\na = np.ones((2, 3))\nb = np.ones(4)\nc = a + b\n");
    const r1 = render(<Host vm={bad.vm} start={2} />);
    expect(screen.getAllByRole("alert").some((x) => x.textContent!.includes("ValueError: operands could not be broadcast"))).toBe(true);
    expect(screen.getByText(/Axis -1: operand 1 has 3, operand 2 has 4/)).toBeTruthy();
    expect(document.querySelector("[data-consistency='ok']")).toBeTruthy();
    r1.unmount();
    const mm = await modelOf("numpy", "import numpy as np\na = np.ones((2, 3))\nc = a @ np.ones((2, 3))\n");
    render(<Host vm={mm.vm} start={1} />);
    expect(screen.getByText("(2,3) @ (2,3) -> error")).toBeTruthy();
    expect(screen.getAllByText(/Inner dimensions differ/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/size 2 is different from 3/).length).toBeGreaterThan(0);
  });
  it("numpy: matmul (m,n)@(n,p) -> (m,p)", async () => {
    const { vm } = await modelOf("numpy", "import numpy as np\na = np.ones((2, 3))\nb = np.ones((3, 4))\nc = a @ b\n");
    render(<Host vm={vm} start={2} />);
    expect(screen.getByText("(2,3) @ (3,4) -> (2,4)")).toBeTruthy();
    expect(screen.getAllByText(/Inner dimensions match \(3 = 3\)/).length).toBeGreaterThan(0);
  });
  it("states the seed, warns about an unseeded program, lists what is not staged, and shows program output", async () => {
    const seeded = await modelOf("numpy", "import numpy as np\nnp.random.seed(42)\nr = np.random.rand(2)\nprint('hi')\nfor i in range(2):\n    r[i] = 0\n");
    const a = render(<Host vm={seeded.vm} />);
    expect(screen.getByText(/seeded with 42/)).toBeTruthy();
    expect(screen.getByText(/A loop \(line 5\) ran as one step/)).toBeTruthy();
    expect(screen.getByText("Program output")).toBeTruthy();
    a.unmount();
    const loose = await modelOf("numpy", "import numpy as np\nr = np.random.rand(2)\n");
    render(<Host vm={loose.vm} />);
    expect(screen.getByRole("note").textContent).toContain("without a seed");
  });
  it("reduced motion is passed down to the tables", async () => {
    const { vm } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'a': [1]})\n");
    const { container } = render(<Host vm={vm} reduced />);
    const tables = [...container.querySelectorAll("table")].map((x) => x.outerHTML).join("");
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).not.toContain("transition-colors");
  });
  it("no stages: says so; the wrappers render the same view; the lazy module loads", async () => {
    const empty = buildDataModel("pandas", { v: 1, ok: true, error: null, stdout: "", stages: [], dropped: 0, plain: 1, notes: [], libs: {}, finals: {} }, "x = 1");
    const vm: VisualModel = { provenance: "executed", data: empty };
    const a = render(<PandasVisualizer model={vm} step={0} onStepChange={() => {}} reducedMotion={false} />);
    expect(screen.getByText(/created no DataFrame, Series or array/)).toBeTruthy();
    a.unmount();
    const { vm: real } = await modelOf("numpy", "import numpy as np\na = np.arange(3)\n");
    const b = render(<NumpyVisualizer model={real} step={0} onStepChange={() => {}} reducedMotion={false} />);
    expect(b.container.querySelector("[data-data-visualizer='numpy']")).toBeTruthy();
    b.unmount();
    render(<LazyVisualizer model={real} step={0} onStepChange={() => {}} reducedMotion={false} />);
    expect(await screen.findByText(/Stage 1 of 1/)).toBeTruthy();
  });
  it("the player has a keyboard: arrow keys step", async () => {
    const { vm } = await modelOf("pandas", "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2]})\nb = df.head(1)\n");
    render(<Host vm={vm} />);
    const bar = screen.getByRole("group", { name: "Playback controls" });
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(screen.getByText(/Stage 2 of 2/)).toBeTruthy();
    expect(within(bar).getByRole("slider", { name: "Timeline" })).toBeTruthy();
  });
});

describe("consistency failures are visible, never hidden", () => {
  it("a stage whose derived number disagrees says so on screen", () => {
    const nd = (shape: number[], data: unknown) => ({ k: "nd" as const, r: "ndarray", shape, ndim: shape.length, dtype: "float64", n: shape.reduce((a, b) => a * b, 1), data, shown: shape });
    const st: DataStage = { i: 0, kind: "binop", op: "+", code: "a + b", expr: "a + b", line: 1, stmt: "c = a + b", stmtLine: 1, argSnaps: [], inputs: [nd([2, 3], [["1", "2", "3"], ["4", "5", "6"]]), nd([3], ["1", "1", "1"])], output: nd([3, 2], [["1", "2"], ["3", "4"], ["5", "6"]]) };
    const data = buildDataModel("numpy", { v: 1, ok: true, error: null, stdout: "", stages: [st], dropped: 0, plain: 0, notes: [], libs: {}, finals: {} }, "c = a + b");
    expect(data.consistent).toBe(false);
    render(<DataVisualizer model={{ provenance: "executed", data: data as DataModelData }} step={0} onStepChange={() => {}} reducedMotion={false} />);
    expect(document.querySelector("[data-consistency='failed']")).toBeTruthy();
    expect(screen.getAllByRole("alert").some((x) => /disagreed with the real result/.test(x.textContent ?? ""))).toBe(true);
  });
});
