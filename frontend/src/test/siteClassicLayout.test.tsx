import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ExecuteResult } from "../types";
import type { Visualization } from "../site/lib/visualize";
import { ClassicTable } from "../site/components/visual/classic/ClassicTable";

/**
 * Layout contract of the SQL Practice visualizer host (VizViewClassic): distinct loading / empty / ready states, a compact step bar that
 * drives the same playback as the full player, tables that scroll sideways on purpose and say so, and an explanation that sits with the
 * board. The database is a fixed stub: these tests are about the host's structure, not about SQL.
 */
const gate: { wait: Promise<void> | null; viz: ((v: Visualization) => Visualization) | null } = { wait: null, viz: null };
function answer(sql: string): ExecuteResult {
  if (/^EXPLAIN/i.test(sql)) return { success: false, columns: [], rows: [], message: "no plan in this test" };
  if (/COUNT\(\*\)/i.test(sql)) return { success: true, columns: ["count"], rows: [[3]], row_count: 1 };
  const rows = [[1, "ann"], [2, "bob"], [3, "cy"]];
  return { success: true, columns: ["id", "name"], rows, row_count: rows.length };
}
vi.mock("../site/lib/browserDb", () => ({ runQuery: async (sql: string) => { if (gate.wait) await gate.wait; return answer(sql); } }));
vi.mock("../site/lib/queryGraph", () => ({ buildGraphs: async () => ({ ok: false, reason: "not in this test" }) }));
vi.mock("../site/components/QueryDiagram", () => ({ default: () => null }));
vi.mock("../site/lib/visualize", async (orig) => {
  const actual = await orig<typeof import("../site/lib/visualize")>();
  return { ...actual, visualize: async (...a: Parameters<typeof actual.visualize>) => { const v = await actual.visualize(...a); return gate.viz ? gate.viz(v) : v; } };
});
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

beforeEach(() => {
  gate.wait = null; gate.viz = null; localStorage.clear();
  localStorage.setItem("sqlp.visual.reduceMotion", "reduce");
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const SQL = "SELECT id, name FROM people WHERE id > 1 ORDER BY name";
async function mount(sql = SQL) {
  const { VizViewClassic } = await import("../site/components/VizViewClassic");
  return render(<MemoryRouter><VizViewClassic sql={sql} /></MemoryRouter>);
}
const ready = () => waitFor(() => expect(screen.getByTestId("classic-progress").getAttribute("aria-valuemax")).toBe(screen.getByTestId("classic-viz").getAttribute("data-step-count")), { timeout: 15_000 });

describe("loading, empty and ready are three different states", () => {
  it("while the query is being visualized: a role=status 'Visualizing' message, no player and no zero-step progress bar", async () => {
    let open!: () => void;
    gate.wait = new Promise<void>((r) => { open = r; });
    await mount();
    const s = screen.getByRole("status");
    expect(s.textContent).toMatch(/Visualizing/);
    expect(s.getAttribute("data-testid")).toBe("classic-loading");
    expect(screen.queryByRole("group", { name: "Playback controls" })).toBeNull();
    expect(screen.queryByTestId("classic-progress")).toBeNull();
    expect(screen.queryByTestId("classic-no-steps")).toBeNull();
    gate.wait = null; open();
    await ready();
    expect(screen.queryByTestId("classic-loading")).toBeNull();
  });

  it("no stages: a distinct empty message and no player (never a zero-step player)", async () => {
    gate.viz = (v) => ({ ...v, stages: [], final: undefined });
    await mount();
    const empty = await screen.findByTestId("classic-no-steps", {}, { timeout: 15_000 });
    expect(empty.getAttribute("role")).toBe("status");
    expect(empty.textContent).toMatch(/no steps/i);
    expect(screen.queryByTestId("classic-loading")).toBeNull();
    expect(screen.queryByRole("group", { name: "Playback controls" })).toBeNull();
    expect(screen.queryByTestId("classic-progress")).toBeNull();
    expect(screen.queryByTestId("classic-step-rail")).toBeNull();
    expect(screen.getByRole("tab", { name: "Structure" })).toBeTruthy(); // the other tabs are still there
  });

  it("ready: the player gets the real step count from the step state (aria-valuemax equals data-step-count, never 0)", async () => {
    await mount();
    await ready();
    const n = Number(screen.getByTestId("classic-viz").getAttribute("data-step-count"));
    expect(n).toBeGreaterThan(1);
    expect(screen.getByTestId("classic-progress").getAttribute("aria-valuemax")).toBe(String(n));
    expect(screen.getByRole("group", { name: "Playback controls" })).toBeTruthy();
    expect(screen.queryByTestId("classic-loading")).toBeNull();
    expect(screen.queryByTestId("classic-no-steps")).toBeNull();
  });

  it("changing the query shows the loading state again until the new stages are in", async () => {
    const { VizViewClassic } = await import("../site/components/VizViewClassic");
    const view = render(<MemoryRouter><VizViewClassic sql={SQL} /></MemoryRouter>);
    await ready();
    let open!: () => void;
    gate.wait = new Promise<void>((r) => { open = r; });
    view.rerender(<MemoryRouter><VizViewClassic sql="SELECT id FROM people" /></MemoryRouter>);
    expect(screen.getByTestId("classic-loading").textContent).toMatch(/Visualizing/);
    expect(screen.queryByTestId("classic-progress")).toBeNull();
    gate.wait = null; open();
    await ready();
  });
});

describe("the compact step bar", () => {
  /** Pretend the player has scrolled out of view (jsdom has no layout). */
  function scrollPast() {
    const rect = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect;
    screen.getByTestId("classic-player").parentElement!.getBoundingClientRect = rect(-300, -150);
    screen.getByTestId("classic-viz").getBoundingClientRect = rect(-900, 1200);
    act(() => { document.dispatchEvent(new Event("scroll")); });
  }

  it("is in the page but hidden while the full player is in view, so the two sets of controls never both show", async () => {
    await mount();
    await ready();
    const bar = screen.getByTestId("classic-step-bar");
    expect(bar.hidden).toBe(true);
    expect(screen.queryByRole("toolbar", { name: "Step bar" })).toBeNull(); // hidden = not in the accessibility tree
    expect(screen.getByRole("button", { name: "Next step" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Step bar: forward" })).toBeNull();
  });

  it("appears once the player scrolled out of view and its buttons step and play the SAME playback", async () => {
    await mount();
    await ready();
    scrollPast();
    const bar = await screen.findByRole("toolbar", { name: "Step bar" });
    expect(bar.textContent).toMatch(/Step 1 of \d+/);
    const index = () => screen.getByTestId("classic-viz").getAttribute("data-step-index");
    const progress = () => screen.getByTestId("classic-progress");
    expect(index()).toBe("0");
    fireEvent.click(within(bar).getByRole("button", { name: "Step bar: forward" }));
    await waitFor(() => expect(index()).toBe("1"));
    expect(progress().getAttribute("aria-valuenow")).toBe("2");
    expect(progress().getAttribute("data-step-index")).toBe("1");
    expect(screen.getByTestId("classic-step-rail").getAttribute("data-step-index")).toBe("1");
    expect(bar.getAttribute("data-step-index")).toBe("1");
    expect(bar.textContent).toMatch(/Step 2 of \d+/);
    fireEvent.click(within(bar).getByRole("button", { name: "Step bar: back" }));
    await waitFor(() => expect(index()).toBe("0"));
    expect(within(bar).getByRole("button", { name: "Step bar: back" })).toHaveProperty("disabled", true);
    // play / stop go through the same playback: the full player's own button flips too
    fireEvent.click(within(bar).getByRole("button", { name: "Step bar: auto-run" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy());
    fireEvent.click(within(bar).getByRole("button", { name: "Step bar: stop" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeTruthy());
  });

  it("goes away again when the player is back in view", async () => {
    await mount();
    await ready();
    scrollPast();
    await screen.findByRole("toolbar", { name: "Step bar" });
    screen.getByTestId("classic-player").parentElement!.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 1, width: 1, height: 100, x: 0, y: 100, toJSON() {} }) as DOMRect;
    act(() => { document.dispatchEvent(new Event("scroll")); });
    await waitFor(() => expect(screen.getByTestId("classic-step-bar").hidden).toBe(true));
  });
});

describe("the explanation and the tables sit with the board", () => {
  it("reading order: board, then the explanation (What is happening? first), then the labelled tables area; all inside classic-viz", async () => {
    await mount();
    await ready();
    const root = screen.getByTestId("classic-viz");
    const board = screen.getByTestId("rowflow");
    const explain = screen.getByTestId("classic-explain");
    const tables = screen.getByTestId("classic-tables");
    expect(root.contains(explain) && root.contains(tables)).toBe(true);
    expect(board.compareDocumentPosition(explain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(explain.compareDocumentPosition(tables) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(explain.querySelector("dt")!.textContent).toBe("What is happening?");
    expect(within(tables).getByRole("heading", { name: /rows at this step/i })).toBeTruthy();
  });

  it("layout follows the width of the visualizer (container queries on .vizc), not the window", async () => {
    const css = await readFile(path.resolve(process.cwd(), "src/site/classic-ui.css"), "utf8");
    expect(css).toMatch(/\.vizc\s*\{[^}]*container:\s*vizc\s*\/\s*inline-size/);
    expect(css).toMatch(/@container vizc \(min-width/);
    expect(css).not.toMatch(/@media[^{]*(min|max)-width/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/animation:/);
  });
});

describe("tables: columns stay readable and the sideways scroll is intentional and visible", () => {
  const wide = { title: "output of SELECT", columns: ["product_id", "value of od.unit_price * od.quantity * (1 - od.discount)", "total"], rows: [[1, "Chai", 18.5], [2, "A very long product name that does not fit", 20]] };

  it("renders a keyboard-reachable scroll region with an aria-label, header titles and a sticky first column", () => {
    render(<ClassicTable table={{ ...wide, role: "output" }} />);
    const region = screen.getByRole("region", { name: /output of SELECT/ });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.getAttribute("aria-label")).toMatch(/scrolls sideways/);
    expect(region.className).toMatch(/vizc-scroll/);
    for (const c of wide.columns) {
      const th = screen.getByRole("columnheader", { name: c });
      expect(th.getAttribute("title")).toBe(c);
      expect(th.className).toMatch(/vizc-th/); // wraps: never cut with an ellipsis
      expect(th.className).not.toMatch(/\btruncate\b/);
    }
    expect(screen.getAllByRole("columnheader")[0].className).toMatch(/vizc-col-first/);
    expect(region.querySelector("tbody td")!.className).toMatch(/vizc-col-first/);
    // long values are truncated, but only with the full value in a title
    const cell = screen.getByText("A very long product name that does not fit");
    expect(cell.getAttribute("title")).toBe("A very long product name that does not fit");
  });

  it("says so when there are more columns than fit, and stops saying so at the right edge", () => {
    const widths = { scrollWidth: 800, clientWidth: 300 };
    const sw = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => widths.scrollWidth);
    const cw = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => widths.clientWidth);
    try {
      const { container } = render(<ClassicTable table={{ ...wide, role: "output" }} />);
      const region = screen.getByRole("region", { name: /output of SELECT/ });
      const wrap = container.querySelector(".vizc-scrollwrap")!;
      expect(wrap.getAttribute("data-more-right")).toBe("true");
      expect(screen.getByTestId("classic-scroll-hint").textContent).toMatch(/scroll sideways/i);
      region.scrollLeft = 500; // the very end
      fireEvent.scroll(region);
      expect(wrap.getAttribute("data-more-right")).toBe("false");
      expect(wrap.getAttribute("data-more-left")).toBe("true");
      expect(screen.queryByTestId("classic-scroll-hint")).toBeNull();
    } finally { sw.mockRestore(); cw.mockRestore(); }
  });

  it("a table that fits shows no scroll hint", () => {
    render(<ClassicTable table={{ title: "small", columns: ["a"], rows: [[1]] }} />);
    expect(screen.queryByTestId("classic-scroll-hint")).toBeNull();
  });
});

describe("the step bar's scroll handler cannot feed back into itself", () => {
  it("a burst of scroll and resize events runs once per animation frame, writes only when the value changed, and stops after unmount", async () => {
    const { Profiler } = await import("react");
    const { ClassicStepBar } = await import("../site/components/visual/classic/ClassicStepBar");
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { frames.push(cb); return frames.length; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const pb = { index: 1, count: 4, playing: false, speed: 1, dispatch: () => undefined } as unknown as Parameters<typeof ClassicStepBar>[0]["pb"];
    const rect = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect;
    const player = document.createElement("div");
    const host = document.createElement("div");
    player.getBoundingClientRect = rect(-300, -100);
    host.getBoundingClientRect = rect(-800, 900);
    let commits = 0;
    const view = render(<Profiler id="bar" onRender={() => { commits += 1; }}><ClassicStepBar pb={pb} watch={{ current: player }} root={{ current: host }} /></Profiler>);
    const bar = screen.getByTestId("classic-step-bar");
    let writes = 0;
    let transform = bar.style.transform;
    Object.defineProperty(bar.style, "transform", { get: () => transform, set: (v: string) => { writes += 1; transform = v; }, configurable: true });
    const runFrames = () => { const todo = frames.splice(0); act(() => { todo.forEach((f) => f(0)); }); return todo.length; };
    runFrames(); // the first placement (queued by the mount effect, which runs place() directly)
    commits = 0; writes = 0; raf.mockClear();
    for (let i = 0; i < 200; i++) { document.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("resize")); }
    expect(raf).toHaveBeenCalledTimes(1); // 400 events, one queued frame
    expect(runFrames()).toBe(1);
    for (let i = 0; i < 5; i++) { document.dispatchEvent(new Event("scroll")); runFrames(); }
    // the same geometry every time: the bar became visible once (one commit) and its transform was written at most once, then never again
    expect(commits).toBeLessThanOrEqual(1);
    expect(writes).toBeLessThanOrEqual(1);
    expect(bar.hidden).toBe(false);
    // only the transform is ever written; nothing that changes the page's layout
    expect(Object.keys(bar.style).filter((k) => /^\d+$/.test(k)).map((k) => (bar.style as unknown as Record<string, string>)[k])).not.toContain("top");
    const removed = vi.spyOn(document, "removeEventListener");
    view.unmount();
    expect(removed).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    raf.mockClear();
    document.dispatchEvent(new Event("scroll"));
    expect(raf).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
