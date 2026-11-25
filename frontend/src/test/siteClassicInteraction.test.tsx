import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import northwind from "../../public/data/northwind.sql?raw";
import { execute, type SqlDb } from "../site/lib/sqlRunner";
import { visualize, type Stage, type Visualization } from "../site/lib/visualize";
import { traceRows, type RowTrace } from "../site/lib/visual/classic/rowTrace";
import { transitions } from "../site/lib/visual/classic/rowFlow";
import { usePlayback } from "../site/components/visual/Playback";
import { RowFlow } from "../site/components/visual/RowFlowClassic";
import { ClassicPlayer } from "../site/components/visual/classic/ClassicPlayer";
import { ClassicSql } from "../site/components/visual/classic/ClassicSql";
import { clauseRange, useClassicStep } from "../site/components/visual/classic/useClassicStep";

/**
 * Interaction, motion and accessibility of the SQL Practice visualizer's own pieces (ClassicPlayer, ClassicSql, the row board and
 * the one ClassicStep that feeds them), with a real PostgreSQL (PGlite) behind the data, plus fast cases on fixed stages.
 */
let pg: PGlite;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Blob.prototype.arrayBuffer ??= function arrayBuffer(this: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result as ArrayBuffer); fr.onerror = () => reject(fr.error); fr.readAsArrayBuffer(this); });
};
beforeAll(async () => {
  const dir = path.resolve(process.cwd(), "node_modules/@electric-sql/pglite/dist");
  const [pgliteWasmModule, initdbWasmModule, data] = await Promise.all([
    readFile(path.join(dir, "pglite.wasm")).then((b) => WebAssembly.compile(b)),
    readFile(path.join(dir, "initdb.wasm")).then((b) => WebAssembly.compile(b)),
    readFile(path.join(dir, "pglite.data")),
  ]);
  pg = await PGlite.create({ pgliteWasmModule, initdbWasmModule, fsBundle: new Blob([data]) });
  await pg.exec(northwind);
}, 90_000);
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const SQL = "SELECT c.country, COUNT(*) AS n FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 10 GROUP BY c.country HAVING COUNT(*) > 5 ORDER BY n DESC LIMIT 4";
const run = (sql: string) => execute(pg as unknown as SqlDb, sql);

/** What the host does: one playback, one ClassicStep, and every part reads that step. */
function Harness({ viz, trace, sql, reduced = false }: { viz: Visualization; trace?: RowTrace; sql: string; reduced?: boolean }) {
  const pb = usePlayback(viz.stages.length);
  const step = useClassicStep(viz, trace, pb)!;
  return (
    <div data-testid="harness">
      <ClassicSql sql={sql} step={step} />
      <ClassicPlayer pb={pb} labels={viz.stages.map((s) => s.clause.toUpperCase())} />
      <RowFlow stage={step.stage} prev={viz.stages[step.index - 1]} reduced={reduced} frame={step.frame} stageIndex={step.index} speed={pb.speed} />
    </div>
  );
}

let real: { viz: Visualization; trace: RowTrace } | undefined;
async function realData() {
  if (!real) { const viz = await visualize(SQL, run); real = { viz, trace: await traceRows(SQL, run, viz) }; }
  return real;
}

/** The step number each region shows right now. They must all be the same number. */
const regions = () => ({
  sql: screen.getByTestId("classic-sql").getAttribute("data-step-index"),
  board: screen.getByTestId("rowflow").getAttribute("data-step-index"),
  progress: screen.getByTestId("classic-progress").getAttribute("data-step-index"),
  now: String(Number(screen.getByTestId("classic-progress").getAttribute("aria-valuenow")) - 1),
});
/** The row cards of the animated board (the legend is a list too, so listitem alone is not enough). */
const cards = () => [...screen.getByTestId("rowflow-board").querySelectorAll<HTMLElement>("[data-card]")];
const settled = () => waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after"));
const expectInSync = (viz: Visualization, index: number) => {
  const r = regions();
  expect(r).toEqual({ sql: String(index), board: String(index), progress: String(index), now: String(index) });
  const range = clauseRange(viz, viz.stages[index]);
  expect(screen.getByTestId("classic-sql").getAttribute("data-range")).toBe(range ? `${range[0]},${range[1]}` : null);
  expect(screen.getByTestId("rowflow").getAttribute("data-kind")).toBeTruthy();
};

describe("one step feeds the SQL highlight, the board and the progress bar", () => {
  it("stays in sync through the buttons, the timeline, the keyboard and the timer", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} reduced />);
    const n = viz.stages.length;
    expect(n).toBeGreaterThan(4);
    expectInSync(viz, 0);
    // every committed change of the page, whatever caused it, shows one step number everywhere
    const seen: string[] = [];
    const mo = new MutationObserver(() => { const r = regions(); seen.push(JSON.stringify(r)); expect(new Set(Object.values(r)).size).toBe(1); });
    mo.observe(screen.getByTestId("harness"), { attributes: true, subtree: true, childList: true });
    fireEvent.click(screen.getByRole("button", { name: "Next step" })); expectInSync(viz, 1);
    fireEvent.click(screen.getByRole("button", { name: "Next step" })); expectInSync(viz, 2);
    fireEvent.click(screen.getByRole("button", { name: "Previous step" })); expectInSync(viz, 1);
    fireEvent.change(screen.getByRole("slider", { name: "Timeline" }), { target: { value: String(n - 1) } }); expectInSync(viz, n - 1);
    const group = screen.getByRole("group", { name: "Playback controls" });
    fireEvent.keyDown(group, { key: "Home" }); expectInSync(viz, 0);
    fireEvent.keyDown(group, { key: "ArrowRight" }); expectInSync(viz, 1);
    fireEvent.keyDown(group, { key: "End" }); expectInSync(viz, n - 1);
    fireEvent.keyDown(group, { key: "ArrowLeft" }); expectInSync(viz, n - 2);
    fireEvent.click(screen.getByRole("button", { name: "Restart" })); expectInSync(viz, 0);
    // the playback timer (4x so the test is fast): it walks 0 -> n-1 and every step it shows is in sync
    fireEvent.change(screen.getByRole("combobox", { name: "Playback speed" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(regions().sql).toBe(String(n - 1)), { timeout: 8000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeTruthy());
    mo.disconnect();
    expectInSync(viz, n - 1);
    expect(new Set(seen.map((s) => JSON.parse(s).sql)).size).toBeGreaterThan(2); // the timer really passed several steps
  }, 30_000);

  it("marks the clause of the step in the query text and labels the progress with the step", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} reduced />);
    for (let i = 0; i < viz.stages.length; i++) {
      const range = clauseRange(viz, viz.stages[i])!;
      const mark = screen.getByTestId("classic-sql").querySelector("mark")!;
      expect(mark.textContent).toBe(SQL.slice(range[0], range[1]));
      expect(screen.getByTestId("classic-progress").getAttribute("aria-valuetext")).toContain(`Step ${i + 1} of ${viz.stages.length}`);
      expect(screen.getByTestId("classic-progress").getAttribute("aria-valuetext")).toContain(viz.stages[i].clause.toUpperCase());
      expect(screen.getByTestId("classic-live").textContent).toContain(`Step ${i + 1} of ${viz.stages.length}`);
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }
  });

  it("uses one polite live region for the step change in the player", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} />);
    const player = screen.getByRole("group", { name: "Playback controls" });
    const live = player.querySelectorAll('[aria-live="polite"]');
    expect(live).toHaveLength(1);
    expect(within(player).getByRole("status")).toBe(live[0]);
  });
});

describe("controls and keyboard", () => {
  it("has the named buttons, the progress bar attributes and the speed list", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} reduced />);
    const group = screen.getByRole("group", { name: "Playback controls" });
    for (const name of ["Restart", "Previous step", "Play", "Next step"]) expect(within(group).getByRole("button", { name })).toBeTruthy();
    const bar = screen.getByTestId("classic-progress");
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe(String(viz.stages.length));
    expect(screen.getByRole("button", { name: "Previous step" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(screen.getByRole("button", { name: "Previous step" })).toHaveProperty("disabled", false);
    const speed = screen.getByRole("combobox", { name: "Playback speed" }) as HTMLSelectElement;
    expect([...speed.options].map((o) => o.value)).toEqual(["0.5", "1", "2", "4"]);
  });

  it("Space plays and pauses, arrows step, Home restarts and End jumps to the last step", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} reduced />);
    const group = screen.getByRole("group", { name: "Playback controls" });
    const key = (k: string) => fireEvent.keyDown(group, { key: k });
    key(" "); expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    key(" "); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    key("ArrowRight"); key("ArrowRight"); expect(regions().now).toBe("2");
    key("ArrowLeft"); expect(regions().now).toBe("1");
    key("End"); expect(regions().now).toBe(String(viz.stages.length - 1));
    key("ArrowRight"); expect(regions().now).toBe(String(viz.stages.length - 1)); // no step past the end
    key("Home"); expect(regions().now).toBe("0");
    key("ArrowLeft"); expect(regions().now).toBe("0");
    // a key with a modifier is the browser's (Alt+Left is Back), and a focused list keeps its own arrows
    fireEvent.keyDown(group, { key: "ArrowRight", altKey: true }); expect(regions().now).toBe("0");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Playback speed" }), { key: "ArrowRight" }); expect(regions().now).toBe("0");
  });

  it("changes the playback speed and the row movement duration follows it", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} />);
    const ms = () => cards()[0].style.transition.match(/transform (\d+)ms/)![1];
    const slow = ms();
    fireEvent.change(screen.getByRole("combobox", { name: "Playback speed" }), { target: { value: "4" } });
    expect((screen.getByRole("combobox", { name: "Playback speed" }) as HTMLSelectElement).value).toBe("4");
    expect(Number(ms())).toBeLessThan(Number(slow));
    expect(cards()[0].style.transition).toContain("var(--ease-out)");
  });

  it("Restart returns every region to the first step and stops playing", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} reduced />);
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expectInSync(viz, 0);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });
});

describe("row inspection", () => {
  const whereStage: Stage = {
    clause: "where", title: "WHERE", explanation: "", source: "executed", rowsIn: 30, rowsOut: 12,
    sample: { columns: ["id", "name"], rows: [[2, "bob"], [3, "cy"]] }, removed: { columns: ["id", "name"], rows: [[1, "ann"]] },
  };
  const fromStage: Stage = { clause: "from", title: "FROM", explanation: "", source: "executed", rowsOut: 30, sample: { columns: ["id", "name"], rows: [[1, "ann"]] } };

  it("makes the board one tab stop, moves with the arrows, inspects with Enter and closes with Escape", async () => {
    render(<RowFlow stage={whereStage} prev={fromStage} reduced={false} stageIndex={1} />);
    await settled();
    const rows = cards();
    expect(rows.length).toBe(3);
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(rows.filter((r) => r.tabIndex === -1)).toHaveLength(2);
    expect(screen.queryByTestId("classic-inspect")).toBeNull();
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    expect(rows.filter((r) => r.tabIndex === 0)).toEqual([rows[1]]); // roving: the focused row is the tab stop
    fireEvent.keyDown(rows[1], { key: "End" }); expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2], { key: "Home" }); expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: "Enter" });
    const panel = screen.getByTestId("classic-inspect");
    expect(panel.textContent).toMatch(/id/);
    expect(panel.textContent).toMatch(/name/);
    expect(panel.textContent).toMatch(/bob/);
    expect(panel.textContent).toMatch(/kept by WHERE/);
    expect(rows[0].getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(rows[0], { key: "Escape" });
    expect(screen.queryByTestId("classic-inspect")).toBeNull();
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: " " });
    expect(screen.getByTestId("classic-inspect")).toBeTruthy();
    fireEvent.click(rows[2]); // a click works too, and shows that row
    expect(screen.getByTestId("classic-inspect").textContent).toMatch(/ann/);
    expect(screen.getByTestId("classic-inspect").textContent).toMatch(/removed by WHERE/);
    fireEvent.click(screen.getByRole("button", { name: "Close row details" }));
    expect(screen.queryByTestId("classic-inspect")).toBeNull();
  });

  it("keeps the aria-labels of the rows and closes the inspector when the step changes", async () => {
    const { rerender } = render(<RowFlow stage={whereStage} prev={fromStage} reduced={false} stageIndex={1} />);
    await settled();
    expect(cards()[0].getAttribute("aria-label")).toMatch(/bob.*\(kept/);
    expect(cards()[2].getAttribute("aria-label")).toMatch(/ann.*\(removed/);
    fireEvent.click(cards()[0]);
    expect(screen.getByTestId("classic-inspect")).toBeTruthy();
    rerender(<RowFlow stage={fromStage} reduced={false} stageIndex={0} />);
    expect(screen.queryByTestId("classic-inspect")).toBeNull();
  });

  it("works in the static reduced view too, with one tab stop", () => {
    render(<RowFlow stage={whereStage} prev={fromStage} reduced stageIndex={1} />);
    const after = within(screen.getByLabelText("After this stage")).getAllByRole("listitem");
    const before = within(screen.getByLabelText("Before this stage")).getAllByRole("listitem");
    expect(after.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(before.some((r) => r.tabIndex >= 0)).toBe(false);
    fireEvent.keyDown(after[0], { key: "Enter" });
    expect(screen.getByTestId("classic-inspect").textContent).toMatch(/bob/);
  });

  it("inspects real rows of every kind of stage with their values (join, group, sort)", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} reduced />);
    const seen = new Set<string>();
    for (let i = 0; i < viz.stages.length; i++) {
      const board = screen.getByTestId("rowflow");
      const here = [...board.querySelectorAll<HTMLElement>('[data-testid="rowflow-board"] [data-card]')];
      if (here.length) {
        fireEvent.click(here[here.length - 1]);
        const text = screen.getByTestId("classic-inspect").textContent ?? "";
        expect(text.length).toBeGreaterThan(10);
        seen.add(board.getAttribute("data-kind")!);
      }
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe("transitions that explain real rows", () => {
  it("JOIN: matched left and right rows are linked by a coloured curve and the joined rows appear", async () => {
    const { viz, trace } = await realData();
    const at = viz.stages.findIndex((s) => trace.frames[viz.stages.indexOf(s)]?.kind === "join");
    expect(at).toBeGreaterThanOrEqual(0);
    const f = trace.frames[at]!;
    const matched = transitions(f!).matched;
    expect(matched.length).toBeGreaterThan(0);
    render(<RowFlow stage={viz.stages[at]} prev={viz.stages[at - 1]} reduced={false} frame={f} stageIndex={at} />);
    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    expect(screen.queryByTestId("rowflow-links")).toBeTruthy();
    expect([...document.querySelectorAll<SVGElement>("[data-link]")].every((p) => p.style.opacity === "0")).toBe(true); // not yet joined
    fireEvent.click(screen.getByRole("button", { name: "After" }));
    const links = [...document.querySelectorAll<SVGElement>("[data-link]")];
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(matched.length);
    expect(links.every((p) => p.style.opacity === "1" && /\bcx-g\d\b/.test(p.getAttribute("class") ?? ""))).toBe(true);
    // a left row that matches several right rows shares its colour with them
    const colours = new Set(links.map((p) => p.getAttribute("class")!.match(/cx-g\d/)![0]));
    expect(colours.size).toBeGreaterThan(0);
    // selecting a row highlights its links and dims the others
    const left = document.querySelector<HTMLElement>('[data-card^="L:"]')!;
    fireEvent.click(left);
    const own = links.filter((p) => p.getAttribute("data-link")!.startsWith(`${left.dataset.card}>`));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((p) => p.style.opacity === "1" && p.getAttribute("stroke-width") === "3")).toBe(true);
    if (own.length < links.length) expect(links.some((p) => p.style.opacity === "0.25")).toBe(true);
  });

  it("GROUP BY: rows carry the colour of their group and the legend names the groups when few", async () => {
    const { viz, trace } = await realData();
    const at = viz.stages.findIndex((_s, i) => trace.frames[i]?.kind === "group");
    expect(at).toBeGreaterThanOrEqual(0);
    render(<RowFlow stage={viz.stages[at]} prev={viz.stages[at - 1]} reduced frame={trace.frames[at]} stageIndex={at} />);
    const after = within(screen.getByLabelText("After this stage"));
    const coloured = after.getAllByRole("listitem").filter((c) => c.querySelector(".cx-has-g"));
    expect(coloured.length).toBeGreaterThan(1);
    // the legend names the groups when there are few enough to tell apart by colour (6 hues), and is left out beyond that
    const groups = new Set(trace.frames[at]!.board!.cards.map((c) => c.group).filter((g) => g !== undefined)).size;
    expect(screen.getByRole("list", { name: "Legend" }).querySelectorAll(".cx-dot").length).toBe(groups > 0 && groups <= 6 ? groups : 0);
  });

  it("ORDER BY: rows that move show how far (up or down) and the badge shows the positions", async () => {
    const { viz, trace } = await realData();
    const at = viz.stages.findIndex((_s, i) => trace.frames[i]?.kind === "sort");
    expect(at).toBeGreaterThanOrEqual(0);
    const moved = transitions(trace.frames[at]!).moved;
    render(<RowFlow stage={viz.stages[at]} prev={viz.stages[at - 1]} reduced frame={trace.frames[at]} stageIndex={at} />);
    const after = within(screen.getByLabelText("After this stage")).getAllByRole("listitem");
    const chips = after.filter((c) => /[▲▼]\d/.test(c.textContent ?? ""));
    expect(chips.length).toBe(moved.length);
  });

  it("WHERE: kept rows go to the Kept lane, removed rows to the Removed lane, and each says which", async () => {
    const { viz, trace } = await realData();
    const at = viz.stages.findIndex((_s, i) => trace.frames[i]?.kind === "filter");
    expect(at).toBeGreaterThanOrEqual(0);
    render(<RowFlow stage={viz.stages[at]} prev={viz.stages[at - 1]} reduced frame={trace.frames[at]} stageIndex={at} />);
    const after = within(screen.getByLabelText("After this stage")).getAllByRole("listitem");
    const tones = new Set(after.map((c) => c.getAttribute("data-tone")));
    expect(tones.has("kept")).toBe(true);
    for (const c of after) expect(c.getAttribute("aria-label")).toMatch(/\((kept|removed)/);
    const lanes = new Set(after.map((c) => c.style.transform.split(",")[0]));
    expect(lanes.size).toBeGreaterThanOrEqual(tones.has("removed") ? 2 : 1);
  });
});

describe("a step is played once", () => {
  const stage = (clause: Stage["clause"], rows: unknown[][]): Stage => ({ clause, title: clause, explanation: "", source: "executed", rowsOut: rows.length, sample: { columns: ["id", "name"], rows } });
  const a = stage("from", [[1, "ann"], [2, "bob"]]);
  const b: Stage = { ...stage("where", [[2, "bob"]]), removed: { columns: ["id", "name"], rows: [[1, "ann"]] }, rowsIn: 2 };

  it("starts a new step at 'before' in the same render, finishes it once, and never replays the same step", async () => {
    const { rerender } = render(<RowFlow stage={b} prev={a} reduced={false} stageIndex={1} />);
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("before");
    await waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after"));
    const board = screen.getByTestId("rowflow-board");
    // same step, new props that do not change the step (speed, an equal stage): nothing restarts, the board node is the same
    rerender(<RowFlow stage={{ ...b }} prev={a} reduced={false} stageIndex={1} speed={2} />);
    expect(screen.getByTestId("rowflow-board")).toBe(board);
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after");
    // another step: the board is replaced and starts at "before" in that very render (no flash of the final state)
    rerender(<RowFlow stage={a} reduced={false} stageIndex={0} speed={2} />);
    expect(screen.getByTestId("rowflow-board")).not.toBe(board);
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("before");
    expect(cards().every((c) => c.style.transform.startsWith("translate(-70%") || c.style.transform.startsWith("translate(0%"))).toBe(true);
    await waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after"));
    // back to the step it left: it plays again from "before"
    rerender(<RowFlow stage={b} prev={a} reduced={false} stageIndex={1} speed={2} />);
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("before");
  });

  it("forgets Before and After when the step changes, and Replay starts over from before", async () => {
    const { rerender } = render(<RowFlow stage={b} prev={a} reduced={false} stageIndex={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("before");
    rerender(<RowFlow stage={a} reduced={false} stageIndex={0} />);
    expect(screen.getByRole("button", { name: "Before" }).getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after"));
    const board = screen.getByTestId("rowflow-board");
    fireEvent.click(screen.getByRole("button", { name: /Replay/ }));
    expect(screen.getByTestId("rowflow-board")).not.toBe(board);
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("before");
    await waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after"));
  });

  it("does not replay when pressing Play or Pause on a step", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} />);
    await waitFor(() => expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after"));
    const board = screen.getByTestId("rowflow-board");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByTestId("rowflow-board")).toBe(board);
    expect(screen.getByTestId("rowflow").getAttribute("data-phase")).toBe("after");
  });
});

describe("reduced motion and the motion rules", () => {
  const motionClasses = (root: HTMLElement) => [root, ...root.querySelectorAll<HTMLElement>("*")].filter((el) => el.style.transition !== "" || el.style.animation !== "" || /(^|[\s:-])(transition|animate)/.test(el.getAttribute("class") ?? ""));

  it("shows the same information with no transition or animation class for every stage of a real query", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} reduced />);
    for (let i = 0; i < viz.stages.length; i++) {
      const row = screen.getByTestId("rowflow");
      expect(row.getAttribute("data-reduced")).toBe("true");
      expect(motionClasses(row)).toEqual([]);
      expect(row.querySelector('[data-testid="rowflow-static"]')).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Replay" })).toBeNull();
      expect(row.getAttribute("data-phase")).toBe("static");
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }
  });

  it("shows the join links in the static After view without any transition", async () => {
    const { viz, trace } = await realData();
    const at = viz.stages.findIndex((_s, i) => trace.frames[i]?.kind === "join");
    const { container } = render(<RowFlow stage={viz.stages[at]} prev={viz.stages[at - 1]} reduced frame={trace.frames[at]} stageIndex={at} />);
    expect(container.querySelectorAll("[data-link]").length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText("Before this stage")).queryByTestId("rowflow-links")).toBeNull();
    expect(motionClasses(container)).toEqual([]);
  });

  it("animates only transform and opacity, with the easing token", async () => {
    const { viz, trace } = await realData();
    render(<Harness viz={viz} trace={trace} sql={SQL} />);
    for (const el of document.querySelectorAll<HTMLElement>("[data-card], [data-link]")) {
      const t = el.style.transition;
      if (!t) continue;
      for (const part of t.split(/,(?![^(]*\))/)) expect(part.trim()).toMatch(/^(transform|opacity) /);
      expect(t).toContain("var(--ease-out)");
    }
    expect(document.querySelector(".cx-fill")).toBeTruthy();
  });

  it("has no `transition: all` and no infinite animation in the CSS or the components", async () => {
    const files = [
      "src/site/classic-motion.css",
      "src/site/components/visual/RowFlowClassic.tsx",
      "src/site/components/visual/classic/ClassicPlayer.tsx",
      "src/site/components/visual/classic/ClassicSql.tsx",
      "src/site/components/visual/classic/useClassicStep.ts",
    ];
    for (const f of files) {
      const text = await readFile(path.resolve(process.cwd(), f), "utf8");
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, f).not.toMatch(/transition\s*:\s*all\b/);
      expect(code, f).not.toMatch(/transition-all|transitionProperty\s*:\s*["']?all/);
      expect(code, f).not.toMatch(/\binfinite\b/);
      expect(code, f).not.toMatch(/animate-(spin|pulse|bounce|ping)/);
      expect(code, f).not.toMatch(/will-change\s*:\s*all/);
    }
    const css = (await readFile(path.resolve(process.cwd(), "src/site/classic-motion.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    // every duration and easing in the CSS is a site token
    for (const m of css.matchAll(/(?:transition|animation)\s*:([^;}]*)/g)) if (!/^\s*none/.test(m[1])) { expect(m[1]).toMatch(/var\(--motion-/); expect(m[1]).toMatch(/var\(--ease-/); }
    // reduced motion switches the CSS motion off, both for the OS setting and for the in-page switch
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/\[data-reduced="true"\]/);
  });

  it("scrolls the SQL box and not the page, and never marks outside the text", () => {
    const sql = "SELECT a\nFROM t\nWHERE a > 1";
    const { rerender } = render(<ClassicSql sql={sql} range={[16, 27]} clause="where" stepIndex={1} />);
    const box = screen.getByTestId("classic-sql");
    expect(box.getAttribute("data-range")).toBe("16,27");
    expect(box.getAttribute("data-step-index")).toBe("1");
    expect(box.querySelector("mark")!.textContent).toBe("WHERE a > 1");
    expect(box.querySelector("mark")!.getAttribute("data-clause")).toBe("where");
    expect(box.textContent).toBe(sql); // the text is the query, line breaks included
    expect(box.getAttribute("class")).toContain("cx-sql");
    rerender(<ClassicSql sql={sql} range={[16, 999]} clause="where" stepIndex={1} />);
    expect(screen.getByTestId("classic-sql").getAttribute("data-range")).toBe(`16,${sql.length}`);
    rerender(<ClassicSql sql={sql} stepIndex={0} />);
    expect(screen.getByTestId("classic-sql").querySelector("mark")).toBeNull();
    expect(screen.getByTestId("classic-sql").hasAttribute("data-range")).toBe(false);
  });
});

describe("keyboard at the visualizer root and the refining state", () => {
  function Root({ viz, trace }: { viz: Visualization; trace?: RowTrace }) {
    const pb = usePlayback(viz.stages.length);
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div>
        <textarea aria-label="outside" />
        <div ref={ref} data-testid="root">
          <ClassicPlayer pb={pb} keyRoot={ref} />
          <button type="button">some button</button>
          <input aria-label="field" />
          <p data-testid="idx">{pb.index}</p>
        </div>
        <span data-testid="x">{trace ? 1 : 0}</span>
      </div>
    );
  }
  it("steps with the keys anywhere inside the root once, ignores fields and other page areas", async () => {
    const { viz } = await realData();
    render(<Root viz={viz} />);
    const idx = () => screen.getByTestId("idx").textContent;
    const root = screen.getByTestId("root");
    fireEvent.keyDown(root, { key: "ArrowRight" }); expect(idx()).toBe("1"); // no bar focus needed, and not stepped twice
    fireEvent.keyDown(screen.getByRole("button", { name: "some button" }), { key: "ArrowRight" }); expect(idx()).toBe("2");
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" }); expect(idx()).toBe(String(viz.stages.length - 1));
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "Home" }); expect(idx()).toBe(String(viz.stages.length - 1));
    fireEvent.keyDown(screen.getByLabelText("outside"), { key: "Home" }); expect(idx()).toBe(String(viz.stages.length - 1));
    fireEvent.keyDown(document.body, { key: "Home" }); expect(idx()).toBe(String(viz.stages.length - 1));
    fireEvent.keyDown(root, { key: "Home" }); expect(idx()).toBe("0");
  });
  it("shows a looking-up state while refining and leaves it when told", async () => {
    const { viz } = await realData();
    const st = viz.stages[1];
    const { rerender } = render(<RowFlow stage={st} prev={viz.stages[0]} reduced stageIndex={1} refining />);
    expect(screen.getByTestId("rowflow").getAttribute("data-refining")).toBe("true");
    expect(screen.getByTestId("rowflow-refining").textContent).toMatch(/looking up real row ids/);
    rerender(<RowFlow stage={st} prev={viz.stages[0]} reduced stageIndex={1} refining={false} />);
    expect(screen.queryByTestId("rowflow-refining")).toBeNull();
    expect(screen.getByTestId("rowflow").getAttribute("data-refining")).toBe("false");
  });
});

describe("an empty board", () => {
  it("says so with the real counts when a filter removes every row", () => {
    const from: Stage = { clause: "from", title: "FROM", explanation: "", source: "executed", rowsOut: 30, sample: { columns: ["id"], rows: [[1]] } };
    const none: Stage = { clause: "where", title: "WHERE", explanation: "", source: "executed", rowsIn: 30, rowsOut: 0, sample: { columns: ["id"], rows: [] }, removed: { columns: ["id"], rows: [] } };
    for (const reduced of [true, false]) {
      const { unmount } = render(<RowFlow stage={none} prev={from} reduced={reduced} stageIndex={1} />);
      const empty = screen.queryByTestId("rowflow-empty");
      if (empty) { expect(empty.textContent).toMatch(/No rows to draw/); expect(empty.textContent).toMatch(/30/); expect(screen.queryByTestId("rowflow-board")).toBeNull(); }
      expect(screen.getByTestId("rowflow-live").textContent).toMatch(/WHERE/);
      unmount();
    }
  });
});
