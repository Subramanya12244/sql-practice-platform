import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GraphDiagram, GraphExplorer } from "../site/components/visual/GraphExplorer";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
beforeEach(() => { try { localStorage.removeItem("sqlp.visual.reduceMotion"); } catch { /* ignore */ } });
afterEach(() => { cleanup(); vi.useRealTimers(); try { localStorage.removeItem("sqlp.visual.reduceMotion"); } catch { /* ignore */ } });

const stepText = () => screen.getByTestId("graph-step-text").textContent ?? "";
const status = () => screen.getByRole("status").textContent;
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next step" }));
const prev = () => fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
const algoSelect = () => screen.getByLabelText("Algorithm") as HTMLSelectElement;
const queueItems = () => within(screen.getByTestId("graph-frontier")).queryAllByRole("listitem").map((li) => li.textContent?.replace(/^(front|top|min)/, ""));
const stateOf = (id: string) => document.querySelector(`[data-node="${id}"]`)?.getAttribute("data-state");

describe("Graph Explorer", () => {
  it("draws an accessible graph and starts at step 1 with the executed label", () => {
    render(<GraphExplorer />);
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toMatch(/undirected, 7 nodes and 6 edges/);
    expect(svg.querySelectorAll("[data-node]")).toHaveLength(7);
    expect(svg.querySelectorAll("[data-edge]")).toHaveLength(6);
    expect(screen.getByText("Executed")).toBeTruthy();
    expect(status()).toMatch(/^Step 1 of \d+$/);
    expect(stepText()).toMatch(/Mark A visited/);
    expect(queueItems()).toEqual(["A"]);
    expect(stateOf("A")).toBe("current");
    expect(stateOf("G")).toBe("unvisited");
  });

  it("steps forward and backward, and the queue and the text follow the real BFS", () => {
    render(<GraphExplorer />);
    const seen: string[] = [stepText()];
    const queues: (string | undefined)[][] = [queueItems()];
    for (let i = 0; i < 4; i++) { next(); seen.push(stepText()); queues.push(queueItems()); }
    expect(seen[1]).toMatch(/Take A from the front/);
    expect(queues[1]).toEqual([]);
    expect(seen[3]).toMatch(/B is new/);
    expect(queues[3]).toEqual(["B"]);
    expect(new Set(seen).size).toBe(5);
    // Back to the beginning restores exactly what was shown before.
    for (let i = 3; i >= 0; i--) { prev(); expect(stepText()).toBe(seen[i]); expect(queueItems()).toEqual(queues[i]); }
    expect((screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("highlights exactly one pseudo-code line and moves it as steps change", () => {
    render(<GraphExplorer />);
    const active = () => document.querySelectorAll('[aria-label="Pseudo-code"] li[aria-current="step"]');
    expect(active()).toHaveLength(1);
    const first = active()[0].textContent;
    next(); next();
    expect(active()).toHaveLength(1);
    expect(active()[0].textContent).not.toBe(first);
  });

  it("ends with the result panel filled in and visited nodes marked by a tick as well as colour", () => {
    render(<GraphExplorer />);
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(within(screen.getByTestId("graph-result")).getByText("BFS visit order")).toBeTruthy();
    expect(screen.getByTestId("graph-result").textContent).toContain("A, B, C, D, E, F, G");
    expect(stateOf("G")).toBe("visited");
    expect(document.querySelector('[data-node="G"]')!.textContent).toContain("✓");
    expect(screen.getByTestId("graph-visited").textContent).toContain("A");
  });

  it("plays automatically, pauses on request, and restarts", () => {
    vi.useFakeTimers();
    render(<GraphExplorer />);
    const start = status();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => { vi.advanceTimersByTime(1400 * 3 + 50); });
    const advanced = status();
    expect(advanced).not.toBe(start);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => { vi.advanceTimersByTime(1400 * 5); });
    expect(status()).toBe(advanced);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(status()).toBe(start);
  });

  it("keeps the step description in a polite live region, with a longer text alternative for screen readers", () => {
    render(<GraphExplorer />);
    const live = screen.getByTestId("graph-step-text");
    expect(live.getAttribute("aria-live")).toBe("polite");
    next(); next();
    const sr = live.querySelector(".sr-only")!.textContent!;
    expect(sr).toMatch(/Current node: A\./);
    expect(sr).toMatch(/Visited:/);
    expect(sr).toMatch(/Waiting:/);
    expect(sr).toMatch(/Queue \(front to back\)/);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(live.querySelector("p:last-of-type")!.textContent!);
  });

  it("works from the keyboard on the playback group", () => {
    render(<GraphExplorer />);
    const group = screen.getByRole("group", { name: "Playback controls" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(status()).toMatch(/^Step 3 of/);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(status()).toMatch(/^Step 2 of/);
    fireEvent.keyDown(group, { key: "Home" });
    expect(status()).toMatch(/^Step 1 of/);
  });

  it("starts on the preset named by the lesson link and shows the stack for DFS", () => {
    render(<GraphExplorer preset="dag" />);
    expect(algoSelect().value).toBe("topo");
    expect((screen.getByLabelText("Example graph") as HTMLSelectElement).value).toBe("dag");
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/directed, 6 nodes/);
    fireEvent.change(algoSelect(), { target: { value: "dfs" } });
    expect(screen.getByTestId("graph-frontier").getAttribute("data-kind")).toBe("stack");
    expect(within(screen.getByTestId("graph-frontier")).getByText(/Stack \(top on the right\)/)).toBeTruthy();
    fireEvent.change(algoSelect(), { target: { value: "dfs-recursive" } });
    expect(screen.getByTestId("graph-frontier").getAttribute("data-kind")).toBe("call");
    fireEvent.change(algoSelect(), { target: { value: "topo" } });
    expect(screen.getByTestId("graph-table").textContent).toContain("In-degree");
  });

  it("draws arrowheads only for directed graphs and toggles when the switch changes", () => {
    render(<GraphExplorer />);
    expect(document.querySelectorAll("[data-edge] path[marker-end]")).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(/Directed edges/));
    expect(document.querySelectorAll("[data-edge] path[marker-end]")).toHaveLength(6);
  });

  it("refuses Dijkstra on negative weights, explains why, and the button switches to Bellman-Ford", () => {
    render(<GraphExplorer preset="negative" />);
    const alert = screen.getByTestId("graph-blocked");
    expect(alert.textContent).toMatch(/weight -3/);
    expect(alert.textContent).toMatch(/first time it leaves the priority queue/);
    expect(screen.queryByTestId("graph-step-text")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Run Bellman-Ford instead" }));
    expect(algoSelect().value).toBe("bellman-ford");
    expect(screen.queryByTestId("graph-blocked")).toBeNull();
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(screen.getByTestId("graph-result").textContent).toContain("A > C > B > D (cost 1)");
  });

  it("reports a negative cycle with the cycle highlighted", () => {
    render(<GraphExplorer preset="negative-cycle" />);
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(screen.getByTestId("graph-result").textContent).toMatch(/Negative cycle detected/);
    const ringed = [...document.querySelectorAll('[data-node][data-highlight="true"]')].map((n) => n.getAttribute("data-node")).sort();
    expect(ringed).toEqual(["B", "C"]);
  });

  it("topological sort on an undirected graph is refused with an offer to make it directed", () => {
    render(<GraphExplorer />);
    fireEvent.change(algoSelect(), { target: { value: "topo" } });
    const alert = screen.getByTestId("graph-blocked");
    expect(alert.textContent).toMatch(/only make sense for a directed graph/);
    fireEvent.click(within(alert).getByRole("button", { name: "Make the graph directed" }));
    expect((screen.getByLabelText(/Directed edges/) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("graph-blocked")).toBeNull();
  });

  it("shows the cycle and its closing edge for cycle detection", () => {
    render(<GraphExplorer preset="cycle" />);
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(screen.getByTestId("graph-result").textContent).toContain("Cycle: A > B > C > A");
    expect(document.querySelectorAll('[data-edge][data-highlight="true"]')).toHaveLength(3);
    expect(stepText()).toMatch(/Cycle found/);
  });

  it("validates the edge editor: shows clear errors, keeps the page alive, and recovers when fixed", () => {
    render(<GraphExplorer />);
    const box = screen.getByLabelText("Edges, one per line") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "A-B\nB-C:abc\nthis is wrong" } });
    const errors = screen.getByTestId("graph-errors");
    expect(errors.textContent).toMatch(/Line 2: the weight "abc" is not a number/);
    expect(errors.textContent).toMatch(/Line 3: "this is wrong" is not an edge/);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.change(box, { target: { value: "A-B\nB-C\nC-A" } });
    expect(screen.queryByTestId("graph-errors")).toBeNull();
    expect(screen.getByRole("img").querySelectorAll("[data-node]")).toHaveLength(3);
    expect((screen.getByLabelText("Example graph") as HTMLSelectElement).value).toBe("custom");
  });

  it("rejects more than 12 nodes in the editor", () => {
    render(<GraphExplorer />);
    const box = screen.getByLabelText("Edges, one per line");
    fireEvent.change(box, { target: { value: Array.from({ length: 13 }, (_, i) => `N${i}-N${i + 1}`).join("\n") } });
    expect(screen.getByTestId("graph-errors").textContent).toMatch(/limit is 12/);
  });

  it("recomputes for a custom graph and a different start node", () => {
    render(<GraphExplorer />);
    fireEvent.change(screen.getByLabelText("Edges, one per line"), { target: { value: "X-Y\nY-Z\nW" } });
    fireEvent.change(screen.getByLabelText("Start node"), { target: { value: "Y" } });
    expect(stepText()).toMatch(/Mark Y visited/);
    fireEvent.keyDown(screen.getByRole("group", { name: "Playback controls" }), { key: "End" });
    expect(screen.getByTestId("graph-result").textContent).toMatch(/Not reachable from Y: W/);
  });

  it("honours reduced motion: no transition classes and a flag on the drawing", () => {
    expect(render(<GraphExplorer />).container.querySelector("svg")!.getAttribute("data-reduced")).toBe("false");
    expect(document.querySelector('[data-node="B"] circle')!.getAttribute("class")).toContain("transition");
    cleanup();
    localStorage.setItem("sqlp.visual.reduceMotion", "reduce");
    render(<GraphExplorer />);
    expect(screen.getByRole("img").getAttribute("data-reduced")).toBe("true");
    expect(document.querySelector('[data-node="B"] circle')!.getAttribute("class")).not.toContain("transition");
    expect(document.querySelector("svg path")!.getAttribute("class")).not.toContain("transition");
  });
});

describe("GraphDiagram (reusable)", () => {
  const nodes = [{ id: "a", x: 50, y: 50, label: "10" }, { id: "b", x: 200, y: 50 }, { id: "c", x: 120, y: 150 }];
  it("draws nodes, labels, weights and arrows, and highlights the requested nodes and edges", () => {
    const { container } = render(<GraphDiagram nodes={nodes} edges={[{ from: "a", to: "b", w: 7 }, { from: "b", to: "a" }, { from: "b", to: "c" }]} directed highlight={["c"]} highlightEdges={[2]} label="Linked structure" />);
    expect(screen.getByRole("img", { name: "Linked structure" })).toBeTruthy();
    expect(container.querySelectorAll("[data-node]")).toHaveLength(3);
    expect(container.querySelector('[data-node="a"]')!.textContent).toContain("10");
    expect(container.querySelectorAll("path[marker-end]")).toHaveLength(3);
    expect(container.textContent).toContain("7");
    expect(container.querySelector('[data-node="c"]')!.getAttribute("data-highlight")).toBe("true");
    expect(container.querySelector('[data-node="a"]')!.getAttribute("data-highlight")).toBeNull();
    expect(container.querySelector('[data-edge="2"]')!.getAttribute("data-highlight")).toBe("true");
    // the two opposite edges are bent apart rather than drawn on top of each other
    expect(container.querySelector('[data-edge="0"] path')!.getAttribute("d")).toContain("Q");
    expect(container.querySelector('[data-edge="2"] path')!.getAttribute("d")).not.toContain("Q");
  });
  it("shows state by shape and mark, not only colour, and ignores edges to unknown nodes", () => {
    const { container } = render(<GraphDiagram nodes={nodes} edges={[{ from: "a", to: "zzz" }]} states={{ a: "visited", b: "frontier", c: "current" }} badges={{ a: "d=0" }} />);
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(0);
    expect(container.querySelector('[data-node="a"]')!.textContent).toContain("✓");
    expect(container.querySelector('[data-node="b"] circle[stroke-dasharray]')).not.toBeNull();
    expect(container.querySelector('[data-node="c"]')!.textContent).toContain("▶");
    expect(container.querySelectorAll('[data-node="c"] circle')).toHaveLength(2); // an extra outer ring
    expect(container.textContent).toContain("d=0");
  });
});
