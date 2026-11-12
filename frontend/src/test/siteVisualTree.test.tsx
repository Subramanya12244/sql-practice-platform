import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TreeDiagram, TreeExplorer } from "../site/components/visual/TreeExplorer";
import { writeMotionPref } from "../site/lib/visual/motion";
import type { DiagramNode } from "../site/lib/visual/tree";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(() => { cleanup(); vi.useRealTimers(); try { localStorage.clear(); } catch { /* ignore */ } });

const status = () => screen.getByRole("status").textContent;
const live = () => screen.getByTestId("tree-live").textContent ?? "";
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next step" }));
const prev = () => fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
const bar = () => screen.getByRole("group", { name: "Playback controls" });
const end = () => fireEvent.keyDown(bar(), { key: "End" });
const stat = (k: string) => within(screen.getByTestId("tree-stats")).getByText(k).nextElementSibling!.textContent;
const setValue = (v: string) => fireEvent.change(screen.getByLabelText("Value"), { target: { value: v } });
const choose = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const nodeStatus = (id: number) => screen.getByTestId(`node-${id}`).getAttribute("data-status");

describe("TreeExplorer", () => {
  it("is labelled Executed and says it is the algorithm running here, not the learner's code", () => {
    render(<TreeExplorer />);
    expect(screen.getAllByText("Executed").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/not your own code/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Binary search tree with 9 nodes, root 8, height 3/ })).toBeInTheDocument();
  });

  it("steps forward and backward through precomputed frames and the drawing follows", () => {
    render(<TreeExplorer />);
    const total = Number(status()!.match(/of (\d+)/)![1]);
    expect(total).toBeGreaterThan(20);
    expect(status()).toBe(`Step 1 of ${total}`);
    const first = live();
    expect(first).toMatch(/Call inorder\(8\)/);
    expect(nodeStatus(1)).toBe("current"); // the root
    next();
    expect(status()).toBe(`Step 2 of ${total}`);
    expect(live()).not.toBe(first);
    expect(live()).toMatch(/Call inorder\(3\)/);
    expect(nodeStatus(2)).toBe("current");
    expect(nodeStatus(1)).not.toBe("current");
    prev();
    expect(status()).toBe(`Step 1 of ${total}`);
    expect(live()).toBe(first);
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(status()).toBe(`Step 2 of ${total}`);
    fireEvent.keyDown(bar(), { key: "Home" });
    expect(status()).toBe(`Step 1 of ${total}`);
  });

  it("shows the growing output, the call stack, and the empty stack at the end", () => {
    render(<TreeExplorer />);
    const stack = () => within(screen.getByTestId("tree-stack"));
    expect(stack().getByText("Call stack (top first)")).toBeInTheDocument();
    expect(stack().getByText("inorder(8)")).toBeInTheDocument();
    expect(screen.getByTestId("tree-output")).toHaveTextContent("Nothing visited yet.");
    // Step until the first visit; the output list then has one item and the stack is two deep or more.
    for (let i = 0; i < 40 && !/^Visit/.test(live()); i++) next();
    expect(live()).toMatch(/Visit 1:/);
    expect(within(screen.getByTestId("tree-output")).getAllByRole("listitem").map((x) => x.textContent)).toEqual(["1"]);
    expect(stack().getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    end();
    expect(within(screen.getByTestId("tree-output")).getAllByRole("listitem").map((x) => x.textContent)).toEqual(["1", "3", "4", "6", "7", "8", "10", "13", "14"]);
    expect(stack().getByText("Empty.")).toBeInTheDocument();
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("In-order traversal (recursive) finished");
  });

  it("highlights exactly one active pseudo-code line and it follows the algorithm", () => {
    render(<TreeExplorer />);
    const active = () => Array.from(document.querySelectorAll('[data-active="true"]')).map((e) => e.textContent);
    expect(active()).toEqual(["function inorder(node):"]);
    for (let i = 0; i < 40 && !/^Visit/.test(live()); i++) next();
    expect(active()).toEqual(["  visit(node)"]);
    end();
    expect(active()).toEqual([]); // the summary frame has no active line
  });

  it("plays on a timer, pauses, and stays paused", () => {
    vi.useFakeTimers();
    render(<TreeExplorer />);
    click("Play");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1400); });
    expect(status()).toMatch(/^Step 2 of/);
    click("Pause");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(status()).toMatch(/^Step 2 of/);
  });

  it("honours reduced motion: no transitions when reduced, transitions otherwise", () => {
    writeMotionPref("reduce");
    const { unmount } = render(<TreeExplorer />);
    expect(screen.getByTestId("tree-svg")).toHaveAttribute("data-motion", "reduced");
    const circle = screen.getByTestId("node-1").querySelectorAll("circle")[1] as SVGCircleElement;
    expect(circle.getAttribute("style") ?? "").toMatch(/transition:\s*none/);
    unmount();
    writeMotionPref("full");
    render(<TreeExplorer />);
    expect(screen.getByTestId("tree-svg")).toHaveAttribute("data-motion", "full");
    expect((screen.getByTestId("node-1").querySelectorAll("circle")[1] as SVGCircleElement).getAttribute("style") ?? "").toMatch(/transition:\s*fill/);
    writeMotionPref("system");
  });

  it("describes each step in an aria-live region, including current node, output and stack", () => {
    render(<TreeExplorer />);
    const region = screen.getByTestId("tree-live");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    const sr = () => region.querySelector(".sr-only")!.textContent;
    expect(sr()).toMatch(/Current node 8\./);
    expect(sr()).toMatch(/Call stack, top first: inorder\(8\)\./);
    for (let i = 0; i < 40 && !/^Visit/.test(live()); i++) next();
    expect(sr()).toMatch(/Output so far: 1\./);
    end();
    expect(sr()).toMatch(/Output so far: 1, 3, 4, 6, 7, 8, 10, 13, 14\./);
    expect(sr()).toMatch(/Call stack is empty/);
    // The drawing has a text equivalent too.
    fireEvent.click(screen.getByText("Text description of the tree"));
    expect(screen.getByText(/Node 8 \(root, depth 0\): left child 3, right child 10/)).toBeInTheDocument();
  });

  it("runs another traversal: iterative post-order shows the explicit stack; level-order uses a queue and locks the method", () => {
    render(<TreeExplorer />);
    choose("Traversal order", "postorder");
    choose("Traversal method", "iterative");
    click("Run traversal");
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("Post-order traversal (iterative)");
    expect(screen.getByTestId("tree-stack")).toHaveTextContent("Explicit stack (top first)");
    end();
    expect(within(screen.getByTestId("tree-output")).getAllByRole("listitem").map((x) => x.textContent)).toEqual(["1", "4", "7", "6", "3", "13", "14", "10", "8"]);
    expect(status()).toMatch(/^Step \d+ of \d+$/);
    choose("Traversal order", "levelorder");
    expect(screen.getByLabelText("Traversal method")).toBeDisabled();
    click("Run traversal");
    expect(screen.getByTestId("tree-stack")).toHaveTextContent("Queue (front first)");
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("Level-order traversal (iterative)");
    expect(status()).toMatch(/^Step 1 of/); // a new run starts from its first step
  });

  it("inserts a value: the tree only changes when the step is reached, and the change is kept", () => {
    render(<TreeExplorer />);
    setValue("5");
    click("Insert");
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("Inserted 5");
    expect(stat("Nodes")).toBe("9");
    expect(live()).toMatch(/Compare 5 with 8/);
    expect(nodeStatus(1)).toBe("current");
    end();
    expect(stat("Nodes")).toBe("10");
    prev();
    expect(live()).toMatch(/place 5 there as the right child of 4/);
    expect(Array.from(document.querySelectorAll('[data-status="new"]'))).toHaveLength(1);
    // The next operation starts from the tree with 5 in it.
    setValue("5");
    click("Insert");
    end();
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("already present");
    expect(stat("Nodes")).toBe("10");
  });

  it("search shows the path with heavy edges; a missing value is reported", () => {
    render(<TreeExplorer />);
    setValue("7");
    click("Search");
    end();
    prev();
    expect(live()).toMatch(/found it at depth 3 after 4 comparisons/);
    expect(nodeStatus(8)).toBe("found");
    expect(document.querySelectorAll("line.stroke-accent")).toHaveLength(3);
    setValue("5");
    click("Search");
    end();
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("5 is not in the tree");
  });

  it("delete explains which of the three cases applied", () => {
    render(<TreeExplorer preset="bst-delete" />);
    const run = (v: string) => { setValue(v); click("Delete"); end(); prev(); };
    expect(stat("Nodes")).toBe("8");
    run("20");
    expect(live()).toMatch(/Case 1: leaf/);
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("case 1 (leaf)");
    expect(stat("Nodes")).toBe("7");
    run("40");
    expect(live()).toMatch(/Case 2: one child/);
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("case 2 (one child)");
    expect(stat("Nodes")).toBe("6");
    run("50"); // two children (30 and 70): the successor is 60
    expect(live()).toMatch(/Case 3: two children/);
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("case 3 (two children, in-order successor)");
    expect(live()).toMatch(/Unlink the successor/);
    expect(stat("Nodes")).toBe("5");
    run("12345");
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join("|")).toMatch(/12345 is out of range/);
  });

  it("rejects bad values with a visible error and leaves the tree alone", () => {
    render(<TreeExplorer />);
    const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join("|");
    setValue("abc");
    click("Insert");
    expect(alerts()).toMatch(/"abc" is not a whole number/);
    setValue("5000");
    click("Search");
    expect(alerts()).toMatch(/5000 is out of range/);
    setValue("");
    click("Delete");
    expect(alerts()).toMatch(/Enter a value first/);
    expect(stat("Nodes")).toBe("9");
    setValue("2");
    click("Insert");
    expect(alerts()).not.toMatch(/range|whole number|Enter a value/);
  });

  it("loads a custom level-order tree and explains invalid input", () => {
    render(<TreeExplorer />);
    const input = screen.getByLabelText(/Custom tree, level order/);
    fireEvent.change(input, { target: { value: "1,x,3" } });
    click("Load custom tree");
    expect(screen.getByText(/Entry 2, "x", is not a whole number/)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(stat("Nodes")).toBe("9");
    fireEvent.change(input, { target: { value: "null,1" } });
    click("Load custom tree");
    expect(screen.getByText(/root and cannot be null/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: Array.from({ length: 32 }, (_, i) => i + 1).join(",") } });
    click("Load custom tree");
    expect(screen.getByText(/Too many nodes\. The limit is 31/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "5,2,9,null,3" } });
    click("Load custom tree");
    expect(stat("Nodes")).toBe("4");
    expect(stat("Root")).toBe("5");
    expect(stat("Is a BST")).toBe("Yes");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Preset tree")).toHaveValue("custom");
    click("Show current tree as text");
    expect(input).toHaveValue("5,2,9,null,3");
  });

  it("turns off BST operations for a plain binary tree and can rebuild it as a BST", () => {
    render(<TreeExplorer />);
    choose("Preset tree", "bt-basic");
    expect(stat("Is a BST")).toBe("No");
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    // Traversals still work.
    click("Run traversal");
    end();
    expect(within(screen.getByTestId("tree-output")).getAllByRole("listitem")).toHaveLength(7);
    click("Rebuild as BST");
    expect(stat("Is a BST")).toBe("Yes");
    expect(screen.getByRole("button", { name: "Insert" })).toBeEnabled();
  });

  it("shows the degenerate warning for sorted inserts and the balance demo contrasts the two", () => {
    render(<TreeExplorer preset="bst-degenerate" />);
    expect(screen.getByLabelText("Preset tree")).toHaveValue("bst-degenerate");
    expect(screen.getByText(/every node has at most one child, so this tree is a linked list/i)).toBeInTheDocument();
    expect(stat("Height (edges)")).toBe("6");
    expect(stat("Balanced")).toBe("No");
    click("Why balance matters");
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("Sorted inserts: height 6, 7 comparisons to find 7. Balanced order: height 2");
    expect(live()).toMatch(/Insert 7 values/);
    end();
    prev();
    expect(live()).toMatch(/Same values, same BST rules, height 2 instead of 6/);
    expect(stat("Balanced")).toBe("Yes");
  });

  it("analyzes height, depth and balance with return values on the call stack", () => {
    render(<TreeExplorer preset="bst-lopsided" />);
    click("Height, depth and balance");
    expect(screen.getByTestId("tree-summary")).toHaveTextContent("Unbalanced at 2 nodes");
    let sawReturn = false;
    for (let i = 0; i < 80 && !/Unbalanced node/.test(screen.getByTestId("tree-live").textContent ?? ""); i++) {
      if (/returns -?\d/.test(screen.getByTestId("tree-stack").textContent ?? "")) sawReturn = true;
      next();
    }
    expect(sawReturn).toBe(true);
    expect(document.querySelectorAll('[data-status="unbalanced"]').length).toBe(1);
  });

  it("inspector lists parent, children, depth and height and outlines related nodes", () => {
    render(<TreeExplorer />);
    choose("Inspect node", "5"); // value 6, parent 3, children 4 and 7
    const rel = within(screen.getByRole("list", { name: "Node relations" }));
    expect(rel.getByText(/an internal node/)).toBeInTheDocument();
    expect(rel.getByText(/Parent: 3\. Children: 4, 7\./)).toBeInTheDocument();
    expect(rel.getByText(/Depth 2.*Height 1.*Subtree size 3/)).toBeInTheDocument();
    expect([2, 7, 8].map(nodeStatus)).toEqual(["related", "related", "related"]);
    fireEvent.click(screen.getByTestId("node-1")); // pointer shortcut selects the root
    expect(within(screen.getByRole("list", { name: "Node relations" })).getByText(/: the root\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Inspect node")).toHaveValue("1");
    choose("Inspect node", "");
    expect(nodeStatus(2)).not.toBe("related");
  });

  it("follows a changed preset prop and ignores an unknown one", () => {
    const { rerender } = render(<TreeExplorer preset="bst-perfect" />);
    expect(stat("Nodes")).toBe("7");
    rerender(<TreeExplorer preset="bt-full31" />);
    expect(stat("Nodes")).toBe("31");
    rerender(<TreeExplorer preset="does-not-exist" />);
    expect(stat("Nodes")).toBe("31");
    const { unmount } = render(<TreeExplorer preset="nonsense" />);
    expect(screen.getAllByLabelText("Preset tree").at(-1)).toHaveValue("bst-classic");
    unmount();
  });

  it("the drawing scales by viewBox instead of a fixed width", () => {
    render(<TreeExplorer preset="bt-full31" />);
    const svg = screen.getByTestId("tree-svg");
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    expect(svg.getAttribute("width")).toBeNull();
    expect(svg.getAttribute("class")).toMatch(/w-full/);
  });
});

describe("TreeDiagram (reusable)", () => {
  const tree: DiagramNode = { label: "a", children: [{ label: "b", children: [{ label: "d", children: [] }, null] }, { label: "c", children: [] }] };

  it("draws any generic tree, with positional keys when ids are absent", () => {
    render(<TreeDiagram root={tree} current="r.0" visited={["r", "r.0"]} path={["r", "r.0"]} highlight={new Set(["r.1"])} marks={{ "r.0.0": "found" }} reduced />);
    expect(screen.getByRole("img", { name: "Tree with 4 nodes, root a" })).toBeInTheDocument();
    expect(nodeStatus_("r")).toBe("visited");
    expect(nodeStatus_("r.0")).toBe("current");
    expect(nodeStatus_("r.1")).toBe("related");
    expect(nodeStatus_("r.0.0")).toBe("found");
    expect(document.querySelectorAll("line.stroke-accent")).toHaveLength(1); // only the edge on the path
    expect(screen.getByTestId("tree-svg")).toHaveAttribute("data-motion", "reduced");
    expect(screen.getByText("root")).toBeInTheDocument();
  });

  it("shows an empty message for a null tree and selection callbacks for clicks", () => {
    const { rerender } = render(<TreeDiagram root={null} />);
    expect(screen.getByRole("img", { name: "Empty tree" })).toBeInTheDocument();
    const onSelect = vi.fn();
    rerender(<TreeDiagram root={tree} onSelect={onSelect} selected="r.1" ariaLabel="Linked list tree" />);
    fireEvent.click(screen.getByTestId("node-r.1"));
    expect(onSelect).toHaveBeenCalledWith("r.1");
    expect(screen.getByRole("img", { name: "Linked list tree" })).toBeInTheDocument();
  });

  it("survives a cyclic structure", () => {
    const loop: DiagramNode = { label: "x", children: [] };
    loop.children.push(loop, null);
    render(<TreeDiagram root={loop} />);
    expect(screen.getByRole("img", { name: /1 nodes/ })).toBeInTheDocument();
  });
});

function nodeStatus_(key: string) { return screen.getByTestId(`node-${key}`).getAttribute("data-status"); }
