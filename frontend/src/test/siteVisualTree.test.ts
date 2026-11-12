// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_NODES, PRESETS, TreeError, balancedInsertOrder, buildBst, buildLevelOrder, byId, describeFrame, describeTree, isBst, layoutDiagram, levelOrderIds, parseLevelOrder, parseTokens, parseValue,
  presetById, presetSnap, relations, runOp, snapToDiagram, toLevelOrder, treeStats,
  type DiagramNode, type Order, type Snap, type TreeRun,
} from "../site/lib/visual/tree";

/** Small deterministic PRNG so property-style tests are repeatable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const inorderValues = (s: Snap) => runOp(s, { kind: "traverse", order: "inorder", mode: "iterative" }).outcome.output!;
const CLASSIC = () => presetSnap(presetById("bst-classic")!);
const ORDERS: Order[] = ["inorder", "preorder", "postorder", "levelorder"];

/** Structural consistency every snapshot must have. */
function checkSnapshot(s: Snap) {
  const m = byId(s);
  expect(m.size).toBe(s.nodes.length);
  if (s.root === null) { expect(s.nodes).toHaveLength(0); return; }
  expect(m.get(s.root)!.parent).toBeNull();
  let edges = 0;
  for (const n of s.nodes) {
    for (const side of ["left", "right"] as const) {
      const c = n[side];
      if (c === null) continue;
      edges++;
      expect(m.get(c)!.parent).toBe(n.id);
      expect(m.get(c)!.depth).toBe(n.depth + 1);
    }
    const hl = n.left === null ? -1 : m.get(n.left)!.height, hr = n.right === null ? -1 : m.get(n.right)!.height;
    expect(n.height).toBe(1 + Math.max(hl, hr));
    expect(n.leaf).toBe(n.left === null && n.right === null);
  }
  expect(edges).toBe(s.nodes.length - 1);
  expect(s.edges).toHaveLength(edges);
}

function randomLevelOrder(r: () => number, limit = 20): string {
  const tokens: string[] = [String(Math.floor(r() * 100))];
  let level = 1;
  while (level > 0 && tokens.length < limit) {
    let next = 0;
    for (let i = 0; i < level * 2; i++) { if (r() < 0.62) { tokens.push(String(Math.floor(r() * 100))); next++; } else tokens.push("null"); }
    level = next;
  }
  return tokens.join(",");
}

describe("level-order input", () => {
  it("builds the expected shape with null gaps", () => {
    const s = parseLevelOrder("1,2,3,null,4,null,5,6");
    expect(inorderValues(s)).toEqual([2, 6, 4, 1, 3, 5]);
    const m = byId(s);
    const two = s.nodes.find((n) => n.value === 2)!;
    expect(two.left).toBeNull();
    expect(m.get(two.right!)!.value).toBe(4);
    checkSnapshot(s);
  });
  it("round-trips through toLevelOrder and ignores trailing nulls", () => {
    for (const p of PRESETS) expect(toLevelOrder(parseLevelOrder(toLevelOrder(presetSnap(p))))).toBe(toLevelOrder(presetSnap(p)));
    expect(toLevelOrder(parseLevelOrder("5,3,null,null,null"))).toBe("5,3");
    expect(toLevelOrder({ root: null, nodes: [], edges: [] })).toBe("");
  });
  it("accepts separators and null spellings", () => {
    expect(treeStats(parseLevelOrder("5; 3 None, 8 #  nil")).count).toBe(3);
  });
  it.each([
    ["", "empty", /at least one value/],
    ["   ", "empty", /at least one value/],
    ["null,1", "shape", /root and cannot be null/],
    ["1,abc", "syntax", /"abc", is not a whole number/],
    ["1,2.5", "syntax", /not a whole number/],
    ["1,5000", "range", /out of range/],
    ["1,null,null,7", "shape", /has no parent/],
    [Array.from({ length: 32 }, (_, i) => i + 1).join(","), "limit", /Too many nodes/],
    [Array(70).fill("1").join(","), "limit", /Too many entries/],
  ])("rejects %j with a clear message", (text, code, msg) => {
    let err: unknown;
    try { parseLevelOrder(text); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TreeError);
    expect((err as TreeError).code).toBe(code);
    expect((err as TreeError).message).toMatch(msg);
  });
  it("exposes tokens and validates single values", () => {
    expect(parseTokens("1,null,3")).toEqual([1, null, 3]);
    expect(parseValue(" -7 ")).toBe(-7);
    for (const bad of ["", "x", "1.5", "1000", "-1000"]) expect(() => parseValue(bad)).toThrow(TreeError);
    expect(() => buildLevelOrder([])).toThrow(TreeError);
  });
});

describe("presets", () => {
  it("all parse, have unique ids and labels, respect the limit, and kinds are truthful", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      const s = presetSnap(p);
      checkSnapshot(s);
      expect(s.nodes.length).toBeGreaterThan(0);
      expect(s.nodes.length).toBeLessThanOrEqual(MAX_NODES);
      expect(p.label.length).toBeGreaterThan(3);
      expect(p.teaches.length).toBeGreaterThan(10);
      if (p.kind === "bst") expect(isBst(s)).toBe(true);
    }
    expect(isBst(presetSnap(presetById("bt-basic")!))).toBe(false);
    expect(presetById("nope")).toBeUndefined();
  });
  it("show the properties they claim", () => {
    expect(treeStats(presetSnap(presetById("bst-perfect")!))).toMatchObject({ count: 7, height: 2, balanced: true, degenerate: false });
    expect(treeStats(presetSnap(presetById("bst-degenerate")!))).toMatchObject({ count: 7, height: 6, balanced: false, degenerate: true });
    expect(treeStats(presetSnap(presetById("bst-lopsided")!)).balanced).toBe(false);
    expect(treeStats(presetSnap(presetById("bt-full31")!))).toMatchObject({ count: 31, height: 4, balanced: true });
  });
});

describe("traversals", () => {
  const known: Record<Order, number[]> = {
    inorder: [1, 3, 4, 6, 7, 8, 10, 13, 14],
    preorder: [8, 3, 1, 6, 4, 7, 10, 14, 13],
    postorder: [1, 4, 7, 6, 3, 13, 14, 10, 8],
    levelorder: [8, 3, 10, 1, 6, 14, 4, 7, 13],
  };
  for (const order of ORDERS) {
    it(`${order} gives the known result, recursive and iterative`, () => {
      for (const mode of ["recursive", "iterative"] as const) {
        const r = runOp(CLASSIC(), { kind: "traverse", order, mode });
        expect(r.outcome.output).toEqual(known[order]);
        expect(r.frames.at(-1)!.output).toEqual(known[order]);
        expect(r.outcome.mode).toBe(order === "levelorder" ? "iterative" : mode);
      }
    });
  }
  it("recursive and iterative agree on many random trees (BST and plain binary)", () => {
    const r = rng(7);
    for (let i = 0; i < 80; i++) {
      const s = i % 2 ? parseLevelOrder(randomLevelOrder(r)) : buildBst(Array.from({ length: 1 + Math.floor(r() * 25) }, () => Math.floor(r() * 200) - 100));
      for (const order of ORDERS) {
        const a = runOp(s, { kind: "traverse", order, mode: "recursive" }).outcome.output;
        const b = runOp(s, { kind: "traverse", order, mode: "iterative" }).outcome.output;
        expect(a).toEqual(b);
        expect(a).toHaveLength(s.nodes.length);
        expect(new Set(runOp(s, { kind: "traverse", order, mode: "iterative" }).frames.at(-1)!.visited).size).toBe(s.nodes.length);
      }
    }
  });
  it("level-order output matches levelOrderIds and in-order of a BST is sorted", () => {
    const s = CLASSIC();
    const m = byId(s);
    expect(levelOrderIds(s).map((id) => m.get(id)!.value)).toEqual(known.levelorder);
    const v = inorderValues(s);
    expect(v).toEqual([...v].sort((a, b) => a - b));
  });
  it("the output list only grows and visited ids stay in visit order", () => {
    for (const order of ORDERS) for (const mode of ["recursive", "iterative"] as const) {
      const r = runOp(CLASSIC(), { kind: "traverse", order, mode });
      for (let i = 1; i < r.frames.length; i++) {
        const a = r.frames[i - 1], b = r.frames[i];
        expect(b.output.slice(0, a.output.length)).toEqual(a.output);
        expect(b.visited.slice(0, a.visited.length)).toEqual(a.visited);
        expect(b.output.length - a.output.length).toBeLessThanOrEqual(1);
      }
    }
  });
  it("the call stack grows and shrinks like a real stack and ends empty", () => {
    const r = runOp(CLASSIC(), { kind: "traverse", order: "inorder", mode: "recursive" });
    expect(r.frames[0].stack.length).toBeGreaterThan(0);
    expect(r.frames.at(-1)!.stack).toEqual([]);
    for (let i = 1; i < r.frames.length; i++) expect(Math.abs(r.frames[i].stack.length - r.frames[i - 1].stack.length)).toBeLessThanOrEqual(1);
    expect(r.frames.every((f) => f.stackKind === "call")).toBe(true);
  });
  it("iterative variants use an explicit stack or a queue, with the right discipline", () => {
    const stack = runOp(CLASSIC(), { kind: "traverse", order: "preorder", mode: "iterative" });
    expect(stack.frames.every((f) => f.stackKind === "stack")).toBe(true);
    const q = runOp(CLASSIC(), { kind: "traverse", order: "levelorder", mode: "iterative" });
    expect(q.frames.every((f) => f.stackKind === "queue")).toBe(true);
    // Queue is FIFO: the visited sequence equals the order nodes were enqueued, so the first dequeue is the front.
    expect(q.frames[0].stack.map((e) => e.label)).toEqual(["8"]);
    const seenInQueue: string[] = [];
    for (const f of q.frames) for (const e of f.stack) if (!seenInQueue.includes(e.label)) seenInQueue.push(e.label);
    expect(seenInQueue.map(Number)).toEqual(q.outcome.output);
  });
  it("handles a single node and a chain", () => {
    const one = parseLevelOrder("9");
    for (const order of ORDERS) for (const mode of ["recursive", "iterative"] as const) expect(runOp(one, { kind: "traverse", order, mode }).outcome.output).toEqual([9]);
    const chain = presetSnap(presetById("bst-degenerate")!);
    expect(runOp(chain, { kind: "traverse", order: "postorder", mode: "iterative" }).outcome.output).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });
  it("traverses an empty tree without error", () => {
    let s = parseLevelOrder("5");
    s = runOp(s, { kind: "delete", value: 5 }).final;
    expect(s.nodes).toHaveLength(0);
    for (const order of ORDERS) for (const mode of ["recursive", "iterative"] as const) expect(runOp(s, { kind: "traverse", order, mode }).outcome.output).toEqual([]);
  });
});

describe("recursion visualisation, height, depth and balance", () => {
  it("call stack depth equals the number of levels (height + 1), plus one frame for an empty child", () => {
    const r = rng(11);
    for (let i = 0; i < 60; i++) {
      const s = i % 2 ? parseLevelOrder(randomLevelOrder(r)) : buildBst(Array.from({ length: 1 + Math.floor(r() * 25) }, () => Math.floor(r() * 300) - 150));
      const h = treeStats(s).height;
      for (const run of [runOp(s, { kind: "analyze" }), runOp(s, { kind: "traverse", order: "inorder", mode: "recursive" }), runOp(s, { kind: "traverse", order: "postorder", mode: "recursive" })]) {
        const real = Math.max(...run.frames.map((f) => f.stack.filter((e) => e.node !== null).length));
        expect(real).toBe(h + 1);
        expect(run.outcome.maxStack).toBe(h + 2);
      }
    }
  });
  it("analyze executes the recursion: returned height, counts and balance match the snapshot", () => {
    const r = rng(23);
    for (let i = 0; i < 60; i++) {
      const s = i % 2 ? parseLevelOrder(randomLevelOrder(r)) : buildBst(Array.from({ length: 1 + Math.floor(r() * 25) }, () => Math.floor(r() * 300) - 150));
      const st = treeStats(s);
      const o = runOp(s, { kind: "analyze" }).outcome;
      expect(o.height).toBe(st.height);
      expect(o.count).toBe(st.count);
      expect(o.leaves).toBe(st.leaves);
      expect(o.balanced).toBe(st.balanced);
    }
  });
  it("shows return values on the stack just before it pops", () => {
    const run = runOp(parseLevelOrder("1,2,3,4"), { kind: "analyze" });
    const returns = run.frames.flatMap((f) => (f.stack.length && f.stack.at(-1)!.ret !== undefined ? [`${f.stack.at(-1)!.label}=${f.stack.at(-1)!.ret}`] : []));
    expect(returns).toContain("analyze(null)=-1");
    expect(returns).toContain("analyze(4)=0");
    expect(returns).toContain("analyze(2)=1");
    expect(returns).toContain("analyze(1)=2");
    expect(run.outcome).toMatchObject({ height: 2, count: 4, leaves: 2, balanced: true });
  });
  it("detects unbalanced trees and names the offending nodes", () => {
    const s = presetSnap(presetById("bst-lopsided")!);
    const o = runOp(s, { kind: "analyze" }).outcome;
    expect(o.balanced).toBe(false);
    const m = byId(s);
    expect(o.unbalanced!.map((id) => m.get(id)!.value).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(runOp(presetSnap(presetById("bst-perfect")!), { kind: "analyze" }).outcome.unbalanced).toEqual([]);
  });
  it("depth, height, parent, children, siblings, root and leaf are consistent", () => {
    const s = CLASSIC();
    const m = byId(s);
    const id = (v: number) => s.nodes.find((n) => n.value === v)!.id;
    expect(relations(s, id(8))).toMatchObject({ isRoot: true, isLeaf: false, depth: 0, height: 3, parent: null, subtreeSize: 9 });
    expect(relations(s, id(6))).toMatchObject({ depth: 2, height: 1, parent: id(3), siblings: [id(1)], subtreeSize: 3 });
    expect(relations(s, id(13))).toMatchObject({ isLeaf: true, depth: 3, height: 0, children: [], parent: id(14) });
    expect(relations(s, 999)).toBeNull();
    expect(treeStats(s)).toMatchObject({ count: 9, height: 3, leaves: 4, root: s.root, isBst: true });
    for (const n of s.nodes) expect(n.leaf === (relations(s, n.id)!.children.length === 0)).toBe(true);
    expect(m.get(s.root!)!.depth).toBe(0);
  });
  it("describeTree gives one line per node plus a summary", () => {
    const lines = describeTree(CLASSIC());
    expect(lines).toHaveLength(10);
    expect(lines[0]).toMatch(/9 nodes, height 3, 4 leaves/);
    expect(lines[1]).toMatch(/Node 8 \(root, depth 0\): left child 3, right child 10/);
    expect(describeTree({ root: null, nodes: [], edges: [] })).toEqual(["The tree is empty."]);
  });
});

describe("BST insert, search and delete", () => {
  it("insert follows the BST rule and reports comparisons that equal the new node's depth", () => {
    const r = rng(3);
    let s = parseLevelOrder("50");
    for (let i = 0; i < 28; i++) {
      const v = Math.floor(r() * 99) + 1;
      const run = runOp(s, { kind: "insert", value: v });
      s = run.final;
      checkSnapshot(s);
      expect(isBst(s)).toBe(true);
      if (run.outcome.inserted) {
        const placed = run.frames.at(-2)!; // the frame before the summary
        const depth = byId(s).get(placed.current!)!.depth;
        expect(run.outcome.comparisons).toBe(depth);
        expect(byId(s).get(placed.current!)!.value).toBe(v);
      }
    }
  });
  it("property: BST invariants hold after every insertion and deletion over many random sequences", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed * 101);
      const model = new Set<number>();
      let s = parseLevelOrder(String(Math.floor(r() * 60)));
      model.add(s.nodes[0].value);
      for (let step = 0; step < 60; step++) {
        const v = Math.floor(r() * 60);
        const doDelete = r() < 0.45 && model.size > 0;
        if (doDelete) {
          const pick = r() < 0.7 ? [...model][Math.floor(r() * model.size)] : v;
          const before = s;
          const target = before.nodes.find((n) => n.value === pick);
          const run = runOp(s, { kind: "delete", value: pick });
          s = run.final;
          if (!target) expect(run.outcome.deleteCase).toBe("not-found");
          else {
            const kids = (target.left !== null ? 1 : 0) + (target.right !== null ? 1 : 0);
            expect(run.outcome.deleteCase).toBe(kids === 0 ? "leaf" : kids === 1 ? "one-child" : "two-children");
            model.delete(pick);
            expect(s.nodes.length).toBe(before.nodes.length - 1);
          }
        } else if (model.size < MAX_NODES) {
          const run = runOp(s, { kind: "insert", value: v });
          s = run.final;
          expect(run.outcome.inserted).toBe(!model.has(v));
          model.add(v);
        } else continue;
        checkSnapshot(s);
        expect(isBst(s)).toBe(true);
        expect(inorderValues(s)).toEqual([...model].sort((a, b) => a - b));
        expect(s.nodes.length).toBe(model.size);
      }
    }
  });
  it("search finds present values and reports absent ones, following one root-to-node path", () => {
    const s = CLASSIC();
    const hit = runOp(s, { kind: "search", value: 7 });
    expect(hit.outcome.found).toBe(true);
    const m = byId(s);
    const fin = hit.frames.at(-2)!;
    expect(fin.path.map((id) => m.get(id)!.value)).toEqual([8, 3, 6, 7]);
    expect(hit.outcome.comparisons).toBe(4);
    const miss = runOp(s, { kind: "search", value: 5 });
    expect(miss.outcome.found).toBe(false);
    expect(miss.frames.at(-2)!.text).toMatch(/not in the tree/);
    expect(runOp(s, { kind: "search", value: 8 }).outcome.comparisons).toBe(1);
  });
  it("search agrees with set membership on random trees", () => {
    const r = rng(77);
    const vals = Array.from({ length: 25 }, () => Math.floor(r() * 80));
    const s = buildBst(vals);
    for (let v = -2; v < 82; v++) expect(runOp(s, { kind: "search", value: v }).outcome.found).toBe(vals.includes(v));
  });
  it("insert ignores a duplicate and says so", () => {
    const run = runOp(CLASSIC(), { kind: "insert", value: 6 });
    expect(run.outcome.inserted).toBe(false);
    expect(run.final.nodes).toHaveLength(9);
    expect(run.frames.some((f) => /already in the tree/.test(f.text) && f.note === "Duplicate ignored")).toBe(true);
  });
  it("delete case 1: a leaf is unlinked and nothing else changes", () => {
    const s = CLASSIC();
    const run = runOp(s, { kind: "delete", value: 4 });
    expect(run.outcome.deleteCase).toBe("leaf");
    expect(inorderValues(run.final)).toEqual([1, 3, 6, 7, 8, 10, 13, 14]);
    expect(run.frames.some((f) => f.note === "Case 1: leaf" && /leaf/.test(f.text))).toBe(true);
    const keep = (x: Snap) => x.nodes.filter((n) => n.value !== 4).map((n) => [n.id, n.value, n.depth].join(":")).sort();
    expect(keep(run.final)).toEqual(keep(s));
  });
  it("delete case 2: a node with one child is replaced by that child's subtree", () => {
    const s = CLASSIC(); // 14 has only a left child, 13
    const run = runOp(s, { kind: "delete", value: 14 });
    expect(run.outcome.deleteCase).toBe("one-child");
    const m = byId(run.final);
    const ten = run.final.nodes.find((n) => n.value === 10)!;
    expect(m.get(ten.right!)!.value).toBe(13);
    expect(run.final.nodes).toHaveLength(8);
    expect(run.frames.some((f) => f.note === "Case 2: one child")).toBe(true);
  });
  it("delete case 3: copies the in-order successor and unlinks it", () => {
    const s = CLASSIC();
    const run = runOp(s, { kind: "delete", value: 3 }); // successor is 4 (leftmost of 6's subtree)
    expect(run.outcome.deleteCase).toBe("two-children");
    expect(run.final.nodes).toHaveLength(8);
    const three = s.nodes.find((n) => n.value === 3)!;
    expect(byId(run.final).get(three.id)!.value).toBe(4); // same node keeps its place, takes the successor's value
    expect(run.frames.some((f) => Object.values(f.marks).includes("successor"))).toBe(true);
    expect(run.frames.some((f) => /Copy the successor's value 4 into the node that held 3/.test(f.text))).toBe(true);
    expect(inorderValues(run.final)).toEqual([1, 4, 6, 7, 8, 10, 13, 14]);
    // Deleting the root whose successor is its own right child (10 has no left child).
    const root = runOp(s, { kind: "delete", value: 8 });
    expect(root.outcome.deleteCase).toBe("two-children");
    expect(byId(root.final).get(root.final.root!)!.value).toBe(10);
    expect(inorderValues(root.final)).toEqual([1, 3, 4, 6, 7, 10, 13, 14]);
  });
  it("delete handles the root as a leaf, as a one-child node, and a missing value", () => {
    const solo = runOp(parseLevelOrder("5"), { kind: "delete", value: 5 });
    expect(solo.final.root).toBeNull();
    expect(solo.outcome.deleteCase).toBe("leaf");
    const rootOne = runOp(parseLevelOrder("5,null,9"), { kind: "delete", value: 5 });
    expect(rootOne.outcome.deleteCase).toBe("one-child");
    expect(byId(rootOne.final).get(rootOne.final.root!)!.value).toBe(9);
    const none = runOp(CLASSIC(), { kind: "delete", value: 99 });
    expect(none.outcome.deleteCase).toBe("not-found");
    expect(none.commits).toBe(false);
    expect(none.final.nodes).toHaveLength(9);
  });
  it("insert and delete commit; read-only runs and demos do not", () => {
    const s = CLASSIC();
    expect(runOp(s, { kind: "insert", value: 2 }).commits).toBe(true);
    expect(runOp(s, { kind: "delete", value: 1 }).commits).toBe(true);
    expect(runOp(s, { kind: "search", value: 1 }).commits).toBe(false);
    expect(runOp(s, { kind: "analyze" }).commits).toBe(false);
    expect(runOp(s, { kind: "degenerate" }).commits).toBe(false);
    expect(runOp(s, { kind: "traverse", order: "inorder", mode: "recursive" }).final).toEqual(s);
  });
  it("rejects BST operations on a non-BST, out-of-range values, and growth past the limit", () => {
    const bt = presetSnap(presetById("bt-basic")!);
    for (const kind of ["insert", "search", "delete"] as const) {
      let err: unknown;
      try { runOp(bt, { kind, value: 3 }); } catch (e) { err = e; }
      expect((err as TreeError).code).toBe("not-bst");
    }
    expect(() => runOp(CLASSIC(), { kind: "insert", value: 1000 })).toThrow(TreeError);
    expect(() => runOp(CLASSIC(), { kind: "insert", value: 1.5 })).toThrow(/whole number/);
    let s = buildBst(Array.from({ length: MAX_NODES }, (_, i) => i));
    expect(s.nodes).toHaveLength(MAX_NODES);
    expect(() => runOp(s, { kind: "insert", value: 500 })).toThrow(/limit/);
    expect(() => buildBst(Array.from({ length: MAX_NODES + 1 }, (_, i) => i))).toThrow(TreeError);
    s = runOp(s, { kind: "delete", value: 0 }).final;
    expect(runOp(s, { kind: "insert", value: 500 }).final.nodes).toHaveLength(MAX_NODES);
  });
});

describe("degenerate-tree demonstration", () => {
  it("sorted inserts give a chain; the balanced order gives minimum height; search cost differs", () => {
    for (const n of [3, 5, 7, 10, 15]) {
      const run = runOp(CLASSIC(), { kind: "degenerate", count: n });
      expect(run.outcome.demo).toEqual({ n, sortedHeight: n - 1, balancedHeight: Math.floor(Math.log2(n)), sortedComparisons: n, balancedComparisons: expect.any(Number) });
      expect(run.outcome.demo!.balancedComparisons).toBeLessThanOrEqual(Math.floor(Math.log2(n)) + 1);
      expect(run.outcome.demo!.balancedComparisons).toBeLessThan(run.outcome.demo!.sortedComparisons);
      const phases = new Set(run.frames.map((f) => f.phase).filter(Boolean));
      expect(phases).toEqual(new Set(["Sorted inserts", "Balanced-order inserts"]));
      expect(treeStats(run.frames.find((f) => f.note === "Degenerate")!.tree).degenerate).toBe(true);
      expect(treeStats(run.final).balanced).toBe(true);
    }
  });
  it("clamps the size and balancedInsertOrder is a permutation that builds a minimum-height BST", () => {
    expect(runOp(CLASSIC(), { kind: "degenerate", count: 500 }).outcome.demo!.n).toBe(15);
    expect(runOp(CLASSIC(), { kind: "degenerate", count: 0 }).outcome.demo!.n).toBe(3);
    for (let n = 1; n <= 31; n++) {
      const sorted = Array.from({ length: n }, (_, i) => i + 1);
      const order = balancedInsertOrder(sorted);
      expect([...order].sort((a, b) => a - b)).toEqual(sorted);
      expect(treeStats(buildBst(order)).height).toBe(Math.floor(Math.log2(n)));
      expect(treeStats(buildBst(sorted)).height).toBe(n - 1);
    }
  });
});

describe("frames are a real, self-consistent execution trace", () => {
  const runs = (): TreeRun[] => {
    const out: TreeRun[] = [];
    const r = rng(5);
    for (let i = 0; i < 6; i++) {
      const s = i % 2 ? parseLevelOrder(randomLevelOrder(r)) : buildBst(Array.from({ length: 1 + Math.floor(r() * 20) }, () => Math.floor(r() * 90)));
      for (const order of ORDERS) for (const mode of ["recursive", "iterative"] as const) out.push(runOp(s, { kind: "traverse", order, mode }));
      out.push(runOp(s, { kind: "analyze" }));
      if (isBst(s)) {
        const pick = s.nodes[Math.floor(r() * s.nodes.length)].value;
        out.push(runOp(s, { kind: "search", value: pick }), runOp(s, { kind: "search", value: 1000 - 1 }), runOp(s, { kind: "delete", value: pick }));
        if (s.nodes.length < MAX_NODES) out.push(runOp(s, { kind: "insert", value: Math.floor(r() * 90) }));
      }
    }
    out.push(runOp(CLASSIC(), { kind: "degenerate", count: 7 }));
    for (const v of [1, 3, 4, 6, 7, 8, 10, 13, 14]) out.push(runOp(CLASSIC(), { kind: "delete", value: v }));
    return out;
  };
  it("no frame references a node that is not in its own snapshot", () => {
    for (const run of runs()) {
      expect(run.frames.length).toBeGreaterThan(0);
      for (const f of run.frames) {
        const ids = byId(f.tree);
        if (f.current !== null) expect(ids.has(f.current)).toBe(true);
        for (const id of f.visited) expect(ids.has(id)).toBe(true);
        for (const id of f.path) expect(ids.has(id)).toBe(true);
        for (const id of Object.keys(f.marks)) expect(ids.has(Number(id))).toBe(true);
        for (const e of f.stack) if (e.node !== null) expect(ids.has(e.node)).toBe(true);
        for (const e of f.tree.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
        checkSnapshot(f.tree);
        if (f.current !== null) expect(f.path.at(-1)).toBe(f.current);
        if (f.path.length) expect(f.path[0]).toBe(f.tree.root);
      }
    }
  });
  it("every line index points into the pseudo-code, the last frame is a summary, and the final tree is the last snapshot", () => {
    for (const run of runs()) {
      for (const f of run.frames) { expect(f.line).toBeGreaterThanOrEqual(-1); expect(f.line).toBeLessThan(run.code.length); expect(f.text.length).toBeGreaterThan(5); }
      const last = run.frames.at(-1)!;
      expect(last.line).toBe(-1);
      expect(last.text).toBe(run.summary);
      expect(last.tree).toBe(run.final);
      if (run.op.kind !== "degenerate") expect(run.frames.filter((f) => f.line >= 0).length).toBeGreaterThan(0);
    }
  });
  it("only tree-changing steps change the snapshot, and frames are deterministic", () => {
    const a = runOp(CLASSIC(), { kind: "delete", value: 3 }), b = runOp(CLASSIC(), { kind: "delete", value: 3 });
    expect(a.frames).toEqual(b.frames);
    const t = runOp(CLASSIC(), { kind: "traverse", order: "preorder", mode: "recursive" });
    expect(new Set(t.frames.map((f) => f.tree)).size).toBe(1);
    expect(new Set(a.frames.map((f) => f.tree)).size).toBeGreaterThan(1);
  });
  it("the active line moves through the pseudo-code in a way that matches the algorithm", () => {
    const r = runOp(CLASSIC(), { kind: "traverse", order: "inorder", mode: "recursive" });
    const visitLines = r.frames.filter((f) => /^Visit /.test(f.text)).map((f) => r.code[f.line]);
    expect(visitLines).toHaveLength(9);
    expect(new Set(visitLines)).toEqual(new Set(["  visit(node)"]));
    const pre = runOp(CLASSIC(), { kind: "traverse", order: "preorder", mode: "iterative" });
    expect(pre.frames.filter((f) => /^Visit /.test(f.text)).every((f) => pre.code[f.line] === "  visit(node)")).toBe(true);
  });
  it("describeFrame mentions the current node, output and stack for screen readers", () => {
    const r = runOp(CLASSIC(), { kind: "traverse", order: "inorder", mode: "recursive" });
    const f = r.frames.find((x) => x.output.length === 2 && /^Visit/.test(x.text))!;
    const d = describeFrame(f);
    expect(d).toMatch(/Current node 3/);
    expect(d).toMatch(/Output so far: 1, 3/);
    expect(d).toMatch(/Call stack, top first: inorder\(3\), inorder\(8\)/);
    expect(describeFrame(r.frames.at(-1)!)).toMatch(/Call stack is empty/);
  });
});

describe("diagram layout", () => {
  it("places binary children by in-order position with no overlaps and a stable result", () => {
    for (const p of PRESETS) {
      const d = snapToDiagram(presetSnap(p));
      const a = layoutDiagram(d), b = layoutDiagram(d);
      expect(a).toEqual(b);
      expect(new Set(a.nodes.map((n) => `${n.depth}:${n.x}`)).size).toBe(a.nodes.length);
      expect(new Set(a.nodes.map((n) => n.x)).size).toBe(a.nodes.length); // in-order: one column each
      expect(a.edges).toHaveLength(a.nodes.length - 1);
      for (const e of a.edges) { const f = a.nodes.find((n) => n.key === e.from)!, t = a.nodes.find((n) => n.key === e.to)!; expect(t.depth).toBe(f.depth + 1); }
    }
    const s = parseLevelOrder("8,3,10");
    const l = layoutDiagram(snapToDiagram(s));
    const x = (v: string) => l.nodes.find((n) => n.label === v)!.x;
    expect(x("3")).toBeLessThan(x("8"));
    expect(x("8")).toBeLessThan(x("10"));
  });
  it("keeps left-only and right-only children on the correct side", () => {
    const l = layoutDiagram({ label: "p", children: [{ label: "L", children: [] }, null] });
    expect(l.nodes.find((n) => n.label === "L")!.x).toBeLessThan(l.nodes.find((n) => n.label === "p")!.x);
    const r = layoutDiagram({ label: "p", children: [null, { label: "R", children: [] }] });
    expect(r.nodes.find((n) => n.label === "R")!.x).toBeGreaterThan(r.nodes.find((n) => n.label === "p")!.x);
  });
  it("handles n-ary trees, empty input, duplicate ids and cycles", () => {
    const nary: DiagramNode = { label: "root", children: [{ label: "a", children: [] }, { label: "b", children: [{ label: "d", children: [] }] }, { label: "c", children: [] }] };
    const l = layoutDiagram(nary);
    expect(l.nodes).toHaveLength(5);
    expect(new Set(l.nodes.map((n) => `${n.depth}:${n.x}`)).size).toBe(5);
    expect(l.nodes[0].x).toBeGreaterThan(l.nodes.find((n) => n.label === "a")!.x);
    expect(l.nodes[0].x).toBeLessThan(l.nodes.find((n) => n.label === "c")!.x);
    expect(layoutDiagram(null)).toEqual({ nodes: [], edges: [], cols: 0, levels: 0 });
    const dup = layoutDiagram({ id: 1, label: "x", children: [{ id: 1, label: "y", children: [] }, null] });
    expect(new Set(dup.nodes.map((n) => n.key)).size).toBe(2);
    const loop: DiagramNode = { label: "a", children: [] };
    loop.children.push(loop, { label: "b", children: [loop] });
    expect(layoutDiagram(loop).nodes.map((n) => n.label).sort()).toEqual(["a", "b"]);
  });
});
