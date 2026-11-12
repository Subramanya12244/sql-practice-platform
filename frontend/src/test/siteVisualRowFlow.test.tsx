import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ExecuteResult } from "../types";
import type { Stage } from "../site/lib/visualize";
import { RowFlow } from "../site/components/visual/RowFlow";
import { MotionToggle } from "../site/components/visual/MotionToggle";
import { useReducedMotion } from "../site/lib/visual/motion";

// A tiny stand-in for PGlite: answers every derived query with fixed rows and records the SQL it was asked.
const calls: string[] = [];
function answer(sql: string): ExecuteResult {
  calls.push(sql);
  if (/^EXPLAIN/i.test(sql)) return { success: false, columns: [], rows: [], message: "no plan in this test" };
  if (/COUNT\(\*\)/i.test(sql) && !/_r0/.test(sql)) return { success: true, columns: ["count"], rows: [[4]], row_count: 1 };
  if (/_r0/.test(sql)) {
    const ctid = /_c0/.test(sql);
    const rows = /IS NOT TRUE/.test(sql) ? [[{ id: 1, name: "ann" }, ...(ctid ? ["(0,1)"] : [])]]
      : [[{ id: 2, name: "bob" }, ...(ctid ? ["(0,2)"] : [])], [{ id: 3, name: "cy" }, ...(ctid ? ["(0,3)"] : [])]];
    return { success: true, columns: ctid ? ["_r0", "_c0"] : ["_r0"], rows, row_count: rows.length };
  }
  const rows = /IS NOT TRUE/.test(sql) ? [[1, "ann"]] : [[2, "bob"], [3, "cy"]];
  return { success: true, columns: ["id", "name"], rows, row_count: rows.length };
}
vi.mock("../site/lib/browserDb", () => ({ runQuery: async (sql: string) => answer(sql) }));
vi.mock("../site/lib/queryGraph", () => ({ buildGraphs: async () => ({ ok: false, reason: "not in this test" }) }));
vi.mock("../site/components/QueryDiagram", () => ({ default: () => null }));

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
function mockMatchMedia(reduce: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
}
beforeEach(() => { calls.length = 0; localStorage.clear(); mockMatchMedia(false); });
afterEach(cleanup);

const whereStage: Stage = {
  clause: "where", title: "WHERE", explanation: "", source: "executed", rowsIn: 30, rowsOut: 12,
  sample: { columns: ["id", "name"], rows: [[2, "bob"], [3, "cy"]] }, removed: { columns: ["id", "name"], rows: [[1, "ann"]] },
};
const fromStage: Stage = { clause: "from", title: "FROM", explanation: "", source: "executed", rowsOut: 30, sample: { columns: ["id", "name"], rows: [[1, "ann"]] } };

const styled = (root: HTMLElement) => [root, ...root.querySelectorAll<HTMLElement>("*")];
const hasMotion = (root: HTMLElement) => styled(root).some((el) => el.style.transition !== "" || el.style.animation !== "" || /\b(transition|animate)/.test(el.getAttribute("class") ?? ""));

describe("RowFlow reduced motion", () => {
  it("renders a static before and after view: no transition or animation anywhere, highlight classes kept", () => {
    const { container } = render(<RowFlow stage={whereStage} prev={fromStage} reduced stageIndex={1} />);
    expect(hasMotion(container)).toBe(false);
    expect(screen.getByTestId("rowflow-static")).toBeTruthy();
    expect(screen.getByLabelText("Before this stage")).toBeTruthy();
    expect(screen.getByLabelText("After this stage")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /replay/i })).toBeNull();
    const kept = container.querySelectorAll('[data-tone="kept"]');
    const removed = container.querySelectorAll('[data-tone="removed"]');
    expect(kept.length).toBe(2);
    expect(removed.length).toBe(1);
    expect(kept[0].firstElementChild!.className).toMatch(/bg-success-dim/);
    expect(removed[0].firstElementChild!.className).toMatch(/bg-danger-dim/);
    // before: every row sits in the one input lane; after: they are in the kept and removed lanes (different transforms)
    const before = within(screen.getByLabelText("Before this stage")).getAllByRole("listitem").map((e) => (e as HTMLElement).style.transform);
    const after = within(screen.getByLabelText("After this stage")).getAllByRole("listitem").map((e) => (e as HTMLElement).style.transform);
    expect(before.every((t) => t.startsWith("translate(0%"))).toBe(true);
    expect(after.some((t) => !t.startsWith("translate(0%"))).toBe(true);
  });
  it("describes the movement in words for screen readers and labels the identity and the sample", () => {
    render(<RowFlow stage={whereStage} prev={fromStage} reduced stageIndex={1} />);
    expect(screen.getByTestId("rowflow-live").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByTestId("rowflow-live").textContent).toMatch(/2 stay in the kept lane and 1 move to the removed lane/);
    expect(screen.getByTestId("rowflow-identity").textContent).toMatch(/Row identity: trace \(matched by content\)/);
    expect(screen.getByTestId("rowflow-limited").textContent).toMatch(/showing 3 of 30 rows/);
  });
});

describe("RowFlow with motion", () => {
  it("moves rows with transitions, starts from the before positions and ends at the after positions", async () => {
    const { container } = render(<RowFlow stage={whereStage} prev={fromStage} reduced={false} stageIndex={1} speed={2} />);
    const cards = () => [...container.querySelectorAll<HTMLElement>("[data-card]")];
    expect(cards().every((c) => c.style.transition.includes("transform"))).toBe(true);
    expect(cards().every((c) => c.style.transform.startsWith("translate(0%"))).toBe(true);
    await waitFor(() => expect(cards().some((c) => !c.style.transform.startsWith("translate(0%"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    expect(cards().every((c) => c.style.transform.startsWith("translate(0%"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "After" }));
    expect(cards().some((c) => !c.style.transform.startsWith("translate(0%"))).toBe(true);
  });
  it("shows the right frame when stepping forward and back", () => {
    const groupStage: Stage = { clause: "group by", title: "G", explanation: "", source: "executed", rowsIn: 12, rowsOut: 2, sample: { columns: ["country", "rows_in_group"], rows: [["DE", 7], ["FR", 5]] } };
    const { rerender } = render(<RowFlow stage={whereStage} prev={fromStage} reduced={false} stageIndex={1} />);
    expect(screen.getByTestId("rowflow-live").textContent).toMatch(/^WHERE/);
    rerender(<RowFlow stage={groupStage} prev={whereStage} reduced={false} stageIndex={2} />);
    expect(screen.getByTestId("rowflow-live").textContent).toMatch(/^GROUP BY country/);
    rerender(<RowFlow stage={whereStage} prev={fromStage} reduced={false} stageIndex={1} />);
    expect(screen.getByTestId("rowflow-live").textContent).toMatch(/^WHERE/);
    expect(screen.getByTestId("rowflow-live").textContent).not.toMatch(/GROUP BY/);
  });
  it("draws a set-operation stage from its SetOpData", () => {
    const mk = (rows: unknown[][]) => ({ columns: ["n"], rows });
    const setStage: Stage = { clause: "union", title: "UNION", explanation: "", source: "executed", setOp: { op: "union", all: false, left: mk([[1], [2]]), right: mk([[2], [3]]), compat: { ok: true, notes: [] }, rule: "", result: mk([[1], [2], [3]]) } };
    render(<RowFlow stage={setStage} reduced stageIndex={0} />);
    expect(screen.getByTestId("rowflow-live").textContent).toMatch(/^UNION: .* into 3 result rows/);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
  it("renders nothing for a stage with no data", () => {
    const { container } = render(<RowFlow stage={{ clause: "where", title: "w", explanation: "", source: "parsed" }} reduced={false} />);
    expect(container.querySelector('[data-kind="filter"]')).toBeNull();
  });
});

function Harness() {
  const reduced = useReducedMotion();
  return <><MotionToggle /><RowFlow stage={whereStage} prev={fromStage} reduced={reduced} stageIndex={1} /></>;
}

describe("MotionToggle", () => {
  it("is visible and switches the row view between animated and static", async () => {
    render(<Harness />);
    expect(screen.getByTestId("rowflow").getAttribute("data-reduced")).toBe("false");
    const sel = screen.getByLabelText("Animations");
    await act(async () => { fireEvent.change(sel, { target: { value: "reduce" } }); });
    expect(screen.getByTestId("rowflow").getAttribute("data-reduced")).toBe("true");
    expect(screen.getByTestId("rowflow-static")).toBeTruthy();
    await act(async () => { fireEvent.change(sel, { target: { value: "full" } }); });
    expect(screen.getByTestId("rowflow").getAttribute("data-reduced")).toBe("false");
  });
  it("follows the system setting by default", async () => {
    mockMatchMedia(true);
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-reduced")).toBe("true"));
    expect((screen.getByLabelText("Animations") as HTMLSelectElement).value).toBe("system");
  });
});

describe("VizView with row animation", () => {
  const SQL = "SELECT id, name FROM people WHERE id > 1";
  async function mount(pref: "reduce" | "full") {
    calls.length = 0;
    localStorage.setItem("sqlp.visual.reduceMotion", pref);
    const { VizView } = await import("../site/components/VizView");
    const view = render(<MemoryRouter><VizView sql={SQL} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Final result/)).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId("rowflow-identity").textContent).toMatch(/real \(ctid\)/), { timeout: 5000 });
    const final = screen.getByText(/Final result/).parentElement!.querySelector("table")!.textContent;
    const sqls = [...calls];
    view.unmount();
    return { final, sqls };
  }
  it("runs the learner's query exactly once and returns the same result with animation on or off", async () => {
    const off = await mount("reduce");
    const on = await mount("full");
    expect(on.final).toBe(off.final);
    expect(on.final).toContain("bob");
    expect(on.sqls.filter((q) => q === SQL)).toHaveLength(1);
    expect(off.sqls.filter((q) => q === SQL)).toHaveLength(1);
    expect(on.sqls).toEqual(off.sqls); // the motion setting changes nothing about what is executed
    expect(on.sqls.some((q) => /ctid/.test(q))).toBe(true); // row identities were fetched by derived SELECTs
    expect(on.sqls.every((q) => /^\s*(SELECT|WITH|EXPLAIN)\b/i.test(q))).toBe(true);
  });
  it("uses the reduced view when asked and the animated board otherwise", async () => {
    localStorage.setItem("sqlp.visual.reduceMotion", "reduce");
    const { VizView } = await import("../site/components/VizView");
    const { container } = render(<MemoryRouter><VizView sql={SQL} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Final result/)).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    await waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-kind")).toBe("filter"));
    expect(screen.getByTestId("rowflow-static")).toBeTruthy();
    expect(hasMotion(screen.getByTestId("rowflow"))).toBe(false);
    void container;
  });
});
