/**
 * Tree Explorer engine. Pure (no React). Every algorithm here is REALLY EXECUTED on a live tree: the same code that
 * changes or reads the tree also emits the frames, through `Rec.emit`, at the moment each step happens. Nothing is
 * scripted separately from the algorithm, so a trace is an execution trace of that algorithm running in this page.
 * It is not the learner's own code.
 *
 * Conventions (stated in the UI too):
 *  - depth of the root is 0 and counts edges; height of a leaf is 0; height of an empty subtree is -1.
 *  - level-order input is the LeetCode form: nulls are real gaps and a null has no children listed under it.
 *  - a BST here has unique keys (inserting a duplicate is ignored and says so).
 */

export const MAX_NODES = 31;
export const MIN_VALUE = -999;
export const MAX_VALUE = 999;
/** Longest level-order list accepted (31 values plus the nulls that can sit between them). */
export const MAX_TOKENS = 2 * MAX_NODES + 1;

export type TreeErrorCode = "empty" | "syntax" | "range" | "limit" | "shape" | "value" | "not-bst";
export class TreeError extends Error {
  constructor(public code: TreeErrorCode, message: string) { super(message); this.name = "TreeError"; }
}

// ── Snapshot model (what a frame carries) ───────────────────────────────

export interface SNode {
  id: number;
  value: number;
  parent: number | null;
  left: number | null;
  right: number | null;
  /** Edges from the root. */
  depth: number;
  /** Edges down to the deepest leaf below. */
  height: number;
  leaf: boolean;
}
export interface SEdge { from: number; to: number; side: "left" | "right" }
export interface Snap { root: number | null; nodes: SNode[]; edges: SEdge[] }

export const EMPTY_SNAP: Snap = { root: null, nodes: [], edges: [] };

/** Live, mutable node used while an algorithm runs. */
class TNode {
  left: TNode | null = null;
  right: TNode | null = null;
  constructor(public id: number, public value: number) {}
}

export function snapshotOf(root: TNode | null): Snap {
  const nodes: SNode[] = [];
  const edges: SEdge[] = [];
  const walk = (n: TNode | null, parent: number | null, depth: number): number => {
    if (!n) return -1;
    const s: SNode = { id: n.id, value: n.value, parent, left: n.left ? n.left.id : null, right: n.right ? n.right.id : null, depth, height: 0, leaf: !n.left && !n.right };
    nodes.push(s);
    if (n.left) edges.push({ from: n.id, to: n.left.id, side: "left" });
    const hl = walk(n.left, n.id, depth + 1);
    if (n.right) edges.push({ from: n.id, to: n.right.id, side: "right" });
    const hr = walk(n.right, n.id, depth + 1);
    s.height = 1 + Math.max(hl, hr);
    return s.height;
  };
  walk(root, null, 0);
  nodes.sort((a, b) => a.id - b.id);
  return { root: root ? root.id : null, nodes, edges };
}

function toLive(snap: Snap): TNode | null {
  const m = new Map<number, TNode>();
  for (const n of snap.nodes) m.set(n.id, new TNode(n.id, n.value));
  for (const n of snap.nodes) {
    const t = m.get(n.id)!;
    t.left = n.left === null ? null : m.get(n.left) ?? null;
    t.right = n.right === null ? null : m.get(n.right) ?? null;
  }
  return snap.root === null ? null : m.get(snap.root) ?? null;
}

const nextIdOf = (snap: Snap) => snap.nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1;

const indexCache = new WeakMap<Snap, Map<number, SNode>>();
/** id to node lookup, cached per (immutable) snapshot. */
export function byId(snap: Snap): Map<number, SNode> {
  let m = indexCache.get(snap);
  if (!m) { m = new Map(snap.nodes.map((n) => [n.id, n])); indexCache.set(snap, m); }
  return m;
}

function pathIds(snap: Snap, id: number | null): number[] {
  if (id === null) return [];
  const m = byId(snap);
  const out: number[] = [];
  for (let n = m.get(id); n; n = n.parent === null ? undefined : m.get(n.parent)) out.unshift(n.id);
  return out;
}

// ── Properties computed from a snapshot (also cross-checked against the executed `analyze`) ──────────────

export interface TreeStats {
  count: number;
  /** Edges on the longest root-to-leaf path; -1 for an empty tree. */
  height: number;
  leaves: number;
  root: number | null;
  /** Every node's two subtree heights differ by at most 1. */
  balanced: boolean;
  isBst: boolean;
  /** Every node has at most one child and there is more than one node: the tree is really a linked list. */
  degenerate: boolean;
  /** A perfectly packed tree would need this many levels for `count` nodes. */
  minHeight: number;
}

export function isBst(snap: Snap): boolean {
  const m = byId(snap);
  const ok = (id: number | null, lo: number, hi: number): boolean => {
    if (id === null) return true;
    const n = m.get(id)!;
    return n.value > lo && n.value < hi && ok(n.left, lo, n.value) && ok(n.right, n.value, hi);
  };
  return ok(snap.root, -Infinity, Infinity);
}

export function treeStats(snap: Snap): TreeStats {
  const m = byId(snap);
  const h = (id: number | null) => (id === null ? -1 : m.get(id)!.height);
  const balanced = snap.nodes.every((n) => Math.abs(h(n.left) - h(n.right)) <= 1);
  const count = snap.nodes.length;
  return {
    count,
    height: snap.root === null ? -1 : m.get(snap.root)!.height,
    leaves: snap.nodes.filter((n) => n.leaf).length,
    root: snap.root,
    balanced,
    isBst: isBst(snap),
    degenerate: count > 1 && snap.nodes.every((n) => n.left === null || n.right === null),
    minHeight: count === 0 ? -1 : Math.floor(Math.log2(count)),
  };
}

export interface Relations {
  id: number; value: number; isRoot: boolean; isLeaf: boolean; depth: number; height: number;
  parent: number | null; children: number[]; siblings: number[]; subtreeSize: number;
}
export function relations(snap: Snap, id: number): Relations | null {
  const m = byId(snap);
  const n = m.get(id);
  if (!n) return null;
  const size = (x: number | null): number => (x === null ? 0 : 1 + size(m.get(x)!.left) + size(m.get(x)!.right));
  const children = [n.left, n.right].filter((c): c is number => c !== null);
  const p = n.parent === null ? null : m.get(n.parent)!;
  const siblings = p ? [p.left, p.right].filter((c): c is number => c !== null && c !== id) : [];
  return { id, value: n.value, isRoot: n.parent === null, isLeaf: n.leaf, depth: n.depth, height: n.height, parent: n.parent, children, siblings, subtreeSize: size(id) };
}

/** Level-order node ids (breadth first, left before right). */
export function levelOrderIds(snap: Snap): number[] {
  const m = byId(snap);
  const out: number[] = [];
  if (snap.root === null) return out;
  const q = [snap.root];
  for (let i = 0; i < q.length; i++) {
    const n = m.get(q[i])!;
    out.push(n.id);
    if (n.left !== null) q.push(n.left);
    if (n.right !== null) q.push(n.right);
  }
  return out;
}

/** Plain-text equivalent of the drawing: one line per node in level order, for screen readers and the text view. */
export function describeTree(snap: Snap): string[] {
  const s = treeStats(snap);
  if (snap.root === null) return ["The tree is empty."];
  const m = byId(snap);
  const lines = [`Tree with ${s.count} node${s.count === 1 ? "" : "s"}, height ${s.height}, ${s.leaves} ${s.leaves === 1 ? "leaf" : "leaves"}. ${s.balanced ? "Balanced." : "Not balanced."}`];
  for (const id of levelOrderIds(snap)) {
    const n = m.get(id)!;
    const role = n.parent === null ? "root" : n.leaf ? "leaf" : "internal";
    const kids = [n.left !== null ? `left child ${m.get(n.left)!.value}` : "", n.right !== null ? `right child ${m.get(n.right)!.value}` : ""].filter(Boolean).join(", ");
    const parent = n.parent === null ? "" : `, parent ${m.get(n.parent)!.value}`;
    lines.push(`Node ${n.value} (${role}, depth ${n.depth}${parent})${kids ? `: ${kids}` : ""}.`);
  }
  return lines;
}

// ── Level-order input ───────────────────────────────────────────────────

const NULL_WORDS = new Set(["null", "none", "nil", "#", "_"]);

/** Parse text such as `8,3,10,null,6` into tokens. Throws TreeError with a message a learner can act on. */
export function parseTokens(text: string): (number | null)[] {
  const raw = text.split(/[\s,;]+/).filter(Boolean);
  if (!raw.length) throw new TreeError("empty", "Enter at least one value, for example 8,3,10,null,6.");
  if (raw.length > MAX_TOKENS) throw new TreeError("limit", `Too many entries (${raw.length}). The limit is ${MAX_TOKENS} entries, including nulls, for at most ${MAX_NODES} nodes.`);
  const out = raw.map((t, i): number | null => {
    if (NULL_WORDS.has(t.toLowerCase())) return null;
    if (!/^[+-]?\d+$/.test(t)) throw new TreeError("syntax", `Entry ${i + 1}, "${t.length > 12 ? t.slice(0, 12) + "..." : t}", is not a whole number. Use whole numbers separated by commas, and null for a gap, for example 8,3,10,null,6.`);
    const v = Number(t);
    if (v < MIN_VALUE || v > MAX_VALUE) throw new TreeError("range", `Entry ${i + 1} (${v}) is out of range. Use whole numbers from ${MIN_VALUE} to ${MAX_VALUE}.`);
    return v;
  });
  if (out[0] === null) throw new TreeError("shape", "The first entry is the root and cannot be null.");
  return out;
}

/** Build a tree from level-order tokens (LeetCode convention). Ids are 1, 2, 3... in token order. */
export function buildLevelOrder(tokens: (number | null)[]): Snap {
  const t = [...tokens];
  while (t.length && t[t.length - 1] === null) t.pop();
  if (!t.length || t[0] === null) throw new TreeError("shape", "The first entry is the root and cannot be null.");
  if (t.filter((x) => x !== null).length > MAX_NODES) throw new TreeError("limit", `Too many nodes. The limit is ${MAX_NODES}.`);
  let id = 1;
  const root = new TNode(id++, t[0]);
  const q = [root];
  let i = 1;
  while (q.length && i < t.length) {
    const n = q.shift()!;
    if (i < t.length) { const v = t[i++]; if (v !== null) { n.left = new TNode(id++, v); q.push(n.left); } }
    if (i < t.length) { const v = t[i++]; if (v !== null) { n.right = new TNode(id++, v); q.push(n.right); } }
  }
  if (i < t.length) {
    throw new TreeError("shape", `Entry ${i + 1} (${t[i]}) has no parent to attach to. In level order every null leaves a gap and a gap has no children, so the list must fill each row before the next. Example: 1,null,2 puts 2 as the right child of 1.`);
  }
  return snapshotOf(root);
}

export const parseLevelOrder = (text: string): Snap => buildLevelOrder(parseTokens(text));

/** Level-order text for a snapshot (round-trips through `parseLevelOrder`). */
export function toLevelOrder(snap: Snap): string {
  if (snap.root === null) return "";
  const m = byId(snap);
  const out: string[] = [];
  const q: (number | null)[] = [snap.root];
  for (let i = 0; i < q.length; i++) {
    const id = q[i];
    if (id === null) { out.push("null"); continue; }
    const n = m.get(id)!;
    out.push(String(n.value));
    q.push(n.left, n.right);
  }
  while (out.length && out[out.length - 1] === "null") out.pop();
  return out.join(",");
}

export function parseValue(text: string): number {
  const t = text.trim();
  if (!t) throw new TreeError("value", "Enter a value first.");
  if (!/^[+-]?\d+$/.test(t)) throw new TreeError("value", `"${t.length > 12 ? t.slice(0, 12) + "..." : t}" is not a whole number.`);
  const v = Number(t);
  if (v < MIN_VALUE || v > MAX_VALUE) throw new TreeError("range", `${v} is out of range. Use whole numbers from ${MIN_VALUE} to ${MAX_VALUE}.`);
  return v;
}

// ── Frames ──────────────────────────────────────────────────────────────

export type Mark = "parent" | "child" | "new" | "removing" | "successor" | "found" | "missing" | "unbalanced" | "target";
export type StackKind = "call" | "stack" | "queue";
export interface StackEntry {
  label: string;
  /** Node this entry is about, or null for a call on an empty child. */
  node: number | null;
  /** Local variables worth showing, such as "left height 1". */
  note?: string;
  /** Return value shown just before the frame pops. */
  ret?: string;
}

export interface TreeFrame {
  /** Active line of the pseudo-code; -1 for a summary frame with no active line. */
  line: number;
  text: string;
  phase?: string;
  /** Short badge such as "Case 3: two children". */
  note?: string;
  current: number | null;
  /** Nodes visited so far, in visit order. */
  visited: number[];
  /** Values visited so far, in visit order (what a traversal prints). */
  output: number[];
  stackKind: StackKind | null;
  /** For stacks and call stacks: bottom first (the last item is the top). For queues: front first. */
  stack: StackEntry[];
  /** Root to current node. */
  path: number[];
  marks: Record<number, Mark>;
  tree: Snap;
}

export type Order = "inorder" | "preorder" | "postorder" | "levelorder";
export type TraversalMode = "recursive" | "iterative";
export type DeleteCase = "not-found" | "leaf" | "one-child" | "two-children";

export type OpSpec =
  | { kind: "traverse"; order: Order; mode: TraversalMode }
  | { kind: "insert"; value: number }
  | { kind: "search"; value: number }
  | { kind: "delete"; value: number }
  | { kind: "analyze" }
  | { kind: "degenerate"; count?: number };

export interface Outcome {
  output?: number[];
  found?: boolean;
  inserted?: boolean;
  deleteCase?: DeleteCase;
  count?: number;
  leaves?: number;
  /** Height returned by the executed recursion (edges; -1 for empty). */
  height?: number;
  balanced?: boolean;
  unbalanced?: number[];
  comparisons?: number;
  maxStack: number;
  /** Traversal mode actually used (level-order is always iterative). */
  mode?: TraversalMode;
  demo?: { n: number; sortedHeight: number; balancedHeight: number; sortedComparisons: number; balancedComparisons: number };
}

export interface TreeRun {
  op: OpSpec;
  title: string;
  /** Pseudo-code of the algorithm that ran; `TreeFrame.line` indexes into it. */
  code: string[];
  frames: TreeFrame[];
  summary: string;
  /** Tree after the run. */
  final: Snap;
  /** True when the run changed the learner's tree (insert, delete); false for read-only runs and demos. */
  commits: boolean;
  outcome: Outcome;
}

const MAX_FRAMES = 5000;

type Marks = Record<number, Mark>;
interface EmitOpts { current?: TNode | null; marks?: Marks; note?: string; phase?: string; path?: number[] }

/** Holds the live tree and the algorithm's bookkeeping. Algorithms call `emit` as they run. */
class Rec {
  frames: TreeFrame[] = [];
  visited: number[] = [];
  out: number[] = [];
  stack: StackEntry[] = [];
  maxStack = 0;
  muted = false;
  private snap: Snap | null = null;
  constructor(public root: TNode | null, public nextId: number, public stackKind: StackKind | null = null) {}

  /** Call after every structural change so the next frame takes a fresh snapshot. */
  touch() { this.snap = null; }
  tree(): Snap { return (this.snap ??= snapshotOf(this.root)); }
  newNode(value: number) { this.touch(); return new TNode(this.nextId++, value); }

  visit(n: TNode, line: number, text: string, o: EmitOpts = {}) {
    this.visited.push(n.id);
    this.out.push(n.value);
    this.emit(line, text, { current: n, ...o });
  }

  emit(line: number, text: string, o: EmitOpts = {}) {
    if (this.muted) return;
    if (this.frames.length >= MAX_FRAMES) throw new TreeError("limit", "This run produced too many steps.");
    const tree = this.tree();
    const cur = o.current ?? null;
    this.maxStack = Math.max(this.maxStack, this.stack.length);
    this.frames.push({
      line, text, phase: o.phase, note: o.note,
      current: cur ? cur.id : null,
      visited: [...this.visited], output: [...this.out],
      stackKind: this.stackKind, stack: this.stack.map((e) => ({ ...e })),
      path: o.path ?? pathIds(tree, cur ? cur.id : null),
      marks: { ...(o.marks ?? {}) },
      tree,
    });
  }
}

const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;

// ── Traversals ──────────────────────────────────────────────────────────

const RECURSIVE_CODE: Record<"inorder" | "preorder" | "postorder", string[]> = {
  inorder: ["function inorder(node):", "  if node is null: return", "  inorder(node.left)", "  visit(node)", "  inorder(node.right)"],
  preorder: ["function preorder(node):", "  if node is null: return", "  visit(node)", "  preorder(node.left)", "  preorder(node.right)"],
  postorder: ["function postorder(node):", "  if node is null: return", "  postorder(node.left)", "  postorder(node.right)", "  visit(node)"],
};
const VISIT_LINE = { inorder: 3, preorder: 2, postorder: 4 } as const;

function traverseRecursive(rec: Rec, order: "inorder" | "preorder" | "postorder") {
  rec.stackKind = "call";
  const fn = order;
  const visit = (n: TNode) => rec.visit(n, VISIT_LINE[order], `Visit ${n.value}: append it to the output.`);
  const go = (n: TNode | null, from: TNode | null, side: "left" | "right") => {
    const entry: StackEntry = { label: `${fn}(${n ? n.value : "null"})`, node: n ? n.id : null };
    rec.stack.push(entry);
    if (!n) {
      rec.emit(1, from ? `${fn}(null): ${from.value} has no ${side} child, so this call returns at once.` : `${fn}(null): the tree is empty, so there is nothing to visit.`, { marks: from ? { [from.id]: "parent" } : {} });
      rec.stack.pop();
      return;
    }
    rec.emit(0, `Call ${fn}(${n.value}): a new frame goes on the call stack${from ? `, for the ${side} child of ${from.value}` : ", for the root"}.`, { current: n, marks: from ? { [from.id]: "parent" } : {} });
    if (order === "preorder") visit(n);
    go(n.left, n, "left");
    if (order === "inorder") visit(n);
    go(n.right, n, "right");
    if (order === "postorder") visit(n);
    entry.ret = "done";
    rec.emit(4, `${fn}(${n.value}) has finished both subtrees: its frame pops and control returns to the caller.`, { current: n });
    rec.stack.pop();
  };
  go(rec.root, null, "left");
}

const ITER_CODE: Record<Order, string[]> = {
  inorder: [
    "stack = []; node = root", "while node is not null or stack is not empty:", "  while node is not null:", "    push(node); node = node.left",
    "  node = pop()", "  visit(node)", "  node = node.right",
  ],
  preorder: ["stack = [root]", "while stack is not empty:", "  node = pop()", "  visit(node)", "  if node.right: push(node.right)", "  if node.left: push(node.left)"],
  postorder: [
    "stack = []; node = root; last = null", "while node is not null or stack is not empty:", "  if node is not null: push(node); node = node.left",
    "  else:", "    top = peek(stack)", "    if top.right exists and top.right != last: node = top.right", "    else: visit(top); last = pop()",
  ],
  levelorder: ["queue = [root]", "while queue is not empty:", "  node = dequeue()", "  visit(node)", "  if node.left: enqueue(node.left)", "  if node.right: enqueue(node.right)"],
};

function traverseIterative(rec: Rec, order: Order) {
  rec.stackKind = order === "levelorder" ? "queue" : "stack";
  const items: TNode[] = [];
  const add = (n: TNode) => { items.push(n); rec.stack.push({ label: String(n.value), node: n.id }); };
  const take = (fromFront: boolean): TNode => { rec.stack[fromFront ? "shift" : "pop"](); return fromFront ? items.shift()! : items.pop()!; };
  const root = rec.root;

  if (order === "inorder") {
    let node = root;
    rec.emit(0, root ? `Start with an empty stack and node = the root (${root.value}).` : "The tree is empty: the stack starts empty and node is null, so the loop never runs.", { current: root });
    while (node || items.length) {
      while (node) {
        add(node);
        rec.emit(3, `Push ${node.value} on the stack, then move to its left child${node.left ? ` (${node.left.value})` : ", which is empty"}.`, { current: node });
        node = node.left;
      }
      const n = take(false);
      rec.emit(4, `The left side is exhausted. Pop ${n.value} from the top of the stack.`, { current: n });
      rec.visit(n, 5, `Visit ${n.value}: append it to the output.`);
      node = n.right;
      rec.emit(6, n.right ? `Move to the right child of ${n.value} (${n.right.value}) and repeat.` : `${n.value} has no right child, so the next pop returns to its parent.`, { current: n });
    }
  } else if (order === "preorder") {
    if (root) add(root);
    rec.emit(0, root ? `Start with the root (${root.value}) on the stack.` : "The tree is empty: the stack starts empty.", { current: root });
    while (items.length) {
      const n = take(false);
      rec.emit(2, `Pop ${n.value} from the top of the stack.`, { current: n });
      rec.visit(n, 3, `Visit ${n.value}: append it to the output.`);
      if (n.right) { add(n.right); rec.emit(4, `Push the right child ${n.right.value} first, so it comes out after the left one.`, { current: n, marks: { [n.right.id]: "child" } }); }
      if (n.left) { add(n.left); rec.emit(5, `Push the left child ${n.left.value} last, so it is on top and is processed next.`, { current: n, marks: { [n.left.id]: "child" } }); }
    }
  } else if (order === "postorder") {
    let node = root;
    let last: TNode | null = null;
    rec.emit(0, root ? `Start with an empty stack, node = the root (${root.value}) and nothing visited yet.` : "The tree is empty: nothing to do.", { current: root });
    while (node || items.length) {
      if (node) {
        add(node);
        rec.emit(2, `Push ${node.value} and keep going left${node.left ? ` to ${node.left.value}` : " (no left child)"}.`, { current: node });
        node = node.left;
      } else {
        const top = items[items.length - 1];
        if (top.right && top.right !== last) {
          node = top.right;
          rec.emit(5, `Peek at ${top.value}: its right child ${top.right.value} has not been visited, so go right before visiting ${top.value}.`, { current: top, marks: { [top.right.id]: "child" } });
        } else {
          take(false);
          rec.visit(top, 6, `${top.value} has no unvisited right child, so both subtrees are done: pop and visit ${top.value}.`);
          last = top;
        }
      }
    }
  } else {
    if (root) add(root);
    rec.emit(0, root ? `Start with the root (${root.value}) in the queue.` : "The tree is empty: the queue starts empty.", { current: root });
    while (items.length) {
      const n = take(true);
      rec.emit(2, `Dequeue ${n.value} from the front of the queue.`, { current: n });
      rec.visit(n, 3, `Visit ${n.value}: append it to the output.`);
      if (n.left) { add(n.left); rec.emit(4, `Enqueue the left child ${n.left.value} at the back of the queue.`, { current: n, marks: { [n.left.id]: "child" } }); }
      if (n.right) { add(n.right); rec.emit(5, `Enqueue the right child ${n.right.value} at the back of the queue.`, { current: n, marks: { [n.right.id]: "child" } }); }
    }
  }
}

const ORDER_NAME: Record<Order, string> = { inorder: "In-order", preorder: "Pre-order", postorder: "Post-order", levelorder: "Level-order" };
export const ORDER_LABEL = ORDER_NAME;
const ORDER_RULE: Record<Order, string> = {
  inorder: "left subtree, node, right subtree (a BST comes out sorted)",
  preorder: "node, left subtree, right subtree (a parent before its children)",
  postorder: "left subtree, right subtree, node (children before their parent)",
  levelorder: "one row at a time, left to right (breadth first, using a queue)",
};

// ── BST operations ──────────────────────────────────────────────────────

const INSERT_CODE = [
  "function insert(value):", "  if root is null: root = Node(value); return", "  node = root", "  repeat:",
  "    if value == node.value: return        // duplicate: ignore", "    side = left if value < node.value else right",
  "    if node.side is null: node.side = Node(value); return", "    node = node.side",
];
const SEARCH_CODE = [
  "function search(value):", "  node = root", "  while node is not null:", "    if value == node.value: return node",
  "    node = node.left if value < node.value else node.right", "  return null            // not found",
];
const DELETE_CODE = [
  "function delete(value):", "  find node and its parent, as in search; if missing: return", "  if node has no children:              // case 1: leaf",
  "    parent.link = null", "  else if node has one child:           // case 2", "    parent.link = node's only child",
  "  else:                                 // case 3: two children", "    succ = leftmost node of node.right    // in-order successor",
  "    node.value = succ.value", "    unlink succ (its right child, if any, takes its place)",
];
const ANALYZE_CODE = [
  "function analyze(node):", "  if node is null: return -1", "  hl = analyze(node.left)", "  hr = analyze(node.right)",
  "  count += 1; if node is a leaf: leaves += 1", "  if |hl - hr| > 1: mark node unbalanced", "  return 1 + max(hl, hr)",
];

const cmpWord = (a: number, b: number) => (a < b ? "<" : a > b ? ">" : "=");

interface InsertResult { inserted: boolean; comparisons: number; node?: TNode; parent?: TNode }

function insertInto(rec: Rec, value: number, verbose: boolean, phase?: string): InsertResult {
  if (rec.root === null) {
    const n = rec.newNode(value);
    rec.root = n;
    rec.touch();
    rec.emit(1, `The tree is empty, so ${value} becomes the root.`, { current: n, marks: { [n.id]: "new" }, phase });
    return { inserted: true, comparisons: 0, node: n };
  }
  let node = rec.root;
  let comparisons = 0;
  for (;;) {
    comparisons++;
    if (value === node.value) {
      rec.emit(4, `${value} = ${node.value}: the key is already in the tree. A BST holds unique keys, so nothing is inserted.`, { current: node, marks: { [node.id]: "found" }, note: "Duplicate ignored", phase });
      return { inserted: false, comparisons, parent: node };
    }
    const side = value < node.value ? "left" : "right";
    const child: TNode | null = node[side];
    if (verbose && child) rec.emit(5, `Compare ${value} with ${node.value}: ${value} ${cmpWord(value, node.value)} ${node.value}, so go ${side}.`, { current: node, phase });
    if (!child) {
      const n = rec.newNode(value);
      node[side] = n;
      rec.touch();
      rec.emit(6, `${value} ${cmpWord(value, node.value)} ${node.value} and the ${side} slot is empty: place ${value} there as the ${side} child of ${node.value} (${plural(comparisons, "comparison")}).`, { current: n, marks: { [n.id]: "new", [node.id]: "parent" }, phase });
      return { inserted: true, comparisons, node: n, parent: node };
    }
    node = child;
  }
}

interface SearchResult { found: TNode | null; comparisons: number; last: TNode | null }

function searchFor(rec: Rec, value: number, verbose: boolean, phase?: string): SearchResult {
  let node = rec.root;
  let last: TNode | null = null;
  let comparisons = 0;
  while (node) {
    comparisons++;
    if (value === node.value) {
      rec.emit(3, `${value} = ${node.value}: found it at depth ${pathIds(rec.tree(), node.id).length - 1} after ${plural(comparisons, "comparison")}.`, { current: node, marks: { [node.id]: "found" }, phase });
      return { found: node, comparisons, last };
    }
    const side = value < node.value ? "left" : "right";
    if (verbose) rec.emit(4, `Compare ${value} with ${node.value}: ${value} ${cmpWord(value, node.value)} ${node.value}, so any match must be in the ${side} subtree. Go ${side}.`, { current: node, phase });
    last = node;
    node = node[side];
  }
  rec.emit(5, last
    ? `Reached an empty slot below ${last.value}: ${value} is not in the tree (${plural(comparisons, "comparison")}).`
    : `The tree is empty, so ${value} is not in it.`, { current: null, marks: last ? { [last.id]: "missing" } : {}, path: last ? pathIds(rec.tree(), last.id) : [], phase });
  return { found: null, comparisons, last };
}

function deleteFrom(rec: Rec, value: number): DeleteCase {
  let node = rec.root;
  let parent: TNode | null = null;
  let side: "left" | "right" = "left";
  let comparisons = 0;
  while (node && node.value !== value) {
    comparisons++;
    const dir: "left" | "right" = value < node.value ? "left" : "right";
    rec.emit(1, `Compare ${value} with ${node.value}: ${value} ${cmpWord(value, node.value)} ${node.value}, so go ${dir} while looking for the node to delete.`, { current: node });
    parent = node; side = dir; node = node[dir];
  }
  if (!node) {
    rec.emit(1, parent ? `Reached an empty slot below ${parent.value}: ${value} is not in the tree, so nothing is deleted.` : "The tree is empty: nothing to delete.", { marks: parent ? { [parent.id]: "missing" } : {}, path: parent ? pathIds(rec.tree(), parent.id) : [], note: "Not found" });
    return "not-found";
  }
  comparisons++;
  const where = parent ? `its parent ${parent.value}'s ${side} link` : "the tree's root pointer";
  const link = (n: TNode | null) => { if (parent) parent[side] = n; else rec.root = n; rec.touch(); };
  const pm: Marks = parent ? { [parent.id]: "parent" } : {};

  if (!node.left && !node.right) {
    rec.emit(2, `Found ${value} after ${plural(comparisons, "comparison")}. It has no children, so this is case 1: a leaf.`, { current: node, marks: { ...pm, [node.id]: "removing" }, note: "Case 1: leaf" });
    link(null);
    rec.emit(3, `Case 1: set ${where} to null. The leaf disappears and no other node moves.`, { marks: pm, note: "Case 1: leaf", path: parent ? pathIds(rec.tree(), parent.id) : [] });
    return "leaf";
  }
  if (!node.left || !node.right) {
    const child = (node.left ?? node.right)!;
    rec.emit(4, `Found ${value} after ${plural(comparisons, "comparison")}. It has exactly one child (${child.value}), so this is case 2.`, { current: node, marks: { ...pm, [node.id]: "removing", [child.id]: "child" }, note: "Case 2: one child" });
    link(child);
    rec.emit(5, `Case 2: point ${where} at ${child.value}, the only child, so ${child.value} and everything below it move up into the gap. Order is unchanged.`, { current: child, marks: { ...pm, [child.id]: "child" }, note: "Case 2: one child" });
    return "one-child";
  }
  rec.emit(6, `Found ${value} after ${plural(comparisons, "comparison")}. It has two children (${node.left.value} and ${node.right.value}), so this is case 3. It cannot simply be unlinked: both subtrees need a parent.`, { current: node, marks: { ...pm, [node.id]: "target" }, note: "Case 3: two children" });
  // The in-order successor is the smallest key larger than `value`: leftmost node of the right subtree.
  let succParent: TNode = node;
  let succ: TNode = node.right;
  rec.emit(7, `Look for the in-order successor, the smallest value in the right subtree. Start at the right child ${succ.value}.`, { current: succ, marks: { [node.id]: "target" }, note: "Case 3: two children" });
  while (succ.left) {
    const next: TNode = succ.left;
    rec.emit(7, `${succ.value} has a left child (${next.value}), which is smaller. Keep going left.`, { current: succ, marks: { [node.id]: "target" }, note: "Case 3: two children" });
    succParent = succ; succ = next;
  }
  rec.emit(7, `${succ.value} has no left child, so it is the smallest value in the right subtree: the in-order successor.`, { current: succ, marks: { [node.id]: "target", [succ.id]: "successor" }, note: "Case 3: two children" });
  const old = node.value;
  node.value = succ.value;
  rec.touch();
  rec.emit(8, `Copy the successor's value ${succ.value} into the node that held ${old}. The value ${succ.value} now appears twice for a moment, and order around it is still valid.`, { current: node, marks: { [node.id]: "target", [succ.id]: "successor" }, note: "Case 3: two children" });
  if (succParent === node) succParent.right = succ.right; else succParent.left = succ.right;
  rec.touch();
  rec.emit(9, `Unlink the successor's old node: ${succ.right ? `its right child ${succ.right.value} takes its place` : "it was a leaf, so its slot becomes empty"}. That node had no left child, so this is an easy case 1 or case 2 removal.`, { current: node, marks: { [succParent.id]: "parent", [node.id]: "target" }, note: "Case 3: two children" });
  return "two-children";
}

// ── Analyze: height, count, leaves, balance, all in one real recursion ──

function analyzeTree(rec: Rec) {
  rec.stackKind = "call";
  const stats = { count: 0, leaves: 0, unbalanced: [] as number[] };
  const go = (n: TNode | null, from: TNode | null, side: "left" | "right"): number => {
    const entry: StackEntry = { label: `analyze(${n ? n.value : "null"})`, node: n ? n.id : null };
    rec.stack.push(entry);
    if (!n) {
      entry.ret = "-1";
      rec.emit(1, from ? `analyze(null): ${from.value} has no ${side} child. An empty subtree has height -1, so this call returns -1.` : "analyze(null): the tree is empty, so its height is -1.", { marks: from ? { [from.id]: "parent" } : {} });
      rec.stack.pop();
      return -1;
    }
    rec.emit(0, `Call analyze(${n.value}): measure the subtree rooted at ${n.value}.`, { current: n, marks: from ? { [from.id]: "parent" } : {} });
    const hl = go(n.left, n, "left");
    entry.note = `hl = ${hl}`;
    const hr = go(n.right, n, "right");
    entry.note = `hl = ${hl}, hr = ${hr}`;
    stats.count++;
    const leaf = !n.left && !n.right;
    if (leaf) stats.leaves++;
    const diff = Math.abs(hl - hr);
    const bad = diff > 1;
    if (bad) stats.unbalanced.push(n.id);
    rec.emit(5, `${n.value}: left height ${hl}, right height ${hr}, difference ${diff}. ${leaf ? "It is a leaf. " : ""}${bad ? "A difference above 1 means this node is unbalanced." : "A difference of 0 or 1 is balanced."} (Nodes counted so far: ${stats.count}.)`,
      { current: n, marks: bad ? { [n.id]: "unbalanced" } : {}, note: bad ? "Unbalanced node" : undefined });
    const h = 1 + Math.max(hl, hr);
    entry.ret = String(h);
    rec.emit(6, `analyze(${n.value}) returns 1 + max(${hl}, ${hr}) = ${h}${n === rec.root ? `, the height of the whole tree` : ""}.`, { current: n, marks: bad ? { [n.id]: "unbalanced" } : {} });
    rec.stack.pop();
    return h;
  };
  const height = go(rec.root, null, "left");
  return { ...stats, height };
}

// ── Degenerate-tree demonstration ───────────────────────────────────────

/** Insertion order that yields a minimum-height BST for sorted values: the median first, then each half the same way. */
export function balancedInsertOrder(sorted: number[]): number[] {
  if (!sorted.length) return [];
  const mid = Math.floor((sorted.length - 1) / 2);
  return [sorted[mid], ...balancedInsertOrder(sorted.slice(0, mid)), ...balancedInsertOrder(sorted.slice(mid + 1))];
}

function runDemo(rec: Rec, n: number) {
  const sorted = Array.from({ length: n }, (_, i) => i + 1);
  const last = sorted[n - 1];
  const A = "Sorted inserts", B = "Balanced-order inserts";
  rec.emit(-1, `Insert ${n} values, 1 to ${n}, in increasing order. Each new value is larger than everything already there, so it always goes right.`, { phase: A });
  for (const v of sorted) insertInto(rec, v, false, A);
  const sa = searchFor(rec, last, false, A);
  const hA = treeStats(rec.tree()).height;
  rec.emit(-1, `Sorted order built a chain of height ${hA}. Finding ${last} took ${plural(sa.comparisons, "comparison")}: this tree is a linked list in disguise.`, { phase: A, note: "Degenerate" });
  rec.root = null; rec.nextId = 1; rec.touch();
  rec.emit(-1, `Start over with the same ${n} values, but insert the middle value first and then the middle of each half.`, { phase: B });
  for (const v of balancedInsertOrder(sorted)) insertInto(rec, v, false, B);
  const sb = searchFor(rec, last, false, B);
  const hB = treeStats(rec.tree()).height;
  rec.emit(-1, `Same values, same BST rules, height ${hB} instead of ${hA}. Finding ${last} took ${plural(sb.comparisons, "comparison")} instead of ${sa.comparisons}. Height decides search cost: about log2(n) when balanced, n when degenerate.`, { phase: B, note: "Balanced" });
  return { n, sortedHeight: hA, balancedHeight: hB, sortedComparisons: sa.comparisons, balancedComparisons: sb.comparisons };
}

// ── Public entry points ─────────────────────────────────────────────────

const needBst = (snap: Snap) => {
  if (!isBst(snap)) throw new TreeError("not-bst", "This tree is not a binary search tree, so ordered insert, search and delete do not apply. Use 'Rebuild as BST' to re-insert its values in order, or load a BST preset.");
};

export function runOp(tree: Snap, op: OpSpec): TreeRun {
  const rec = new Rec(toLive(tree), nextIdOf(tree));
  const before = treeStats(tree);
  const done = (title: string, code: string[], summary: string, outcome: Partial<Outcome>, commits = false, mode?: TraversalMode): TreeRun => {
    rec.emit(-1, summary, { note: "Done" });
    return { op, title, code, frames: rec.frames, summary, final: rec.tree(), commits, outcome: { maxStack: rec.maxStack, mode, ...outcome } };
  };

  switch (op.kind) {
    case "traverse": {
      const mode: TraversalMode = op.order === "levelorder" ? "iterative" : op.mode;
      if (mode === "recursive") traverseRecursive(rec, op.order as "inorder" | "preorder" | "postorder"); else traverseIterative(rec, op.order);
      const code = mode === "recursive" ? RECURSIVE_CODE[op.order as "inorder" | "preorder" | "postorder"] : ITER_CODE[op.order];
      const title = `${ORDER_NAME[op.order]} traversal (${mode})`;
      return done(title, code, `${title} finished. Order: ${ORDER_RULE[op.order]}. Output: ${rec.out.length ? rec.out.join(", ") : "(empty)"}.`, { output: [...rec.out] }, false, mode);
    }
    case "insert": {
      checkValue(op.value);
      needBst(tree);
      if (before.count >= MAX_NODES) throw new TreeError("limit", `The tree already has ${MAX_NODES} nodes, the limit for this tool.`);
      const r = insertInto(rec, op.value, true);
      return done(`Insert ${op.value}`, INSERT_CODE, r.inserted ? `Inserted ${op.value} after ${plural(r.comparisons, "comparison")}. The tree now has ${before.count + 1} nodes.` : `${op.value} was already present, so the tree is unchanged.`, { inserted: r.inserted, comparisons: r.comparisons }, true);
    }
    case "search": {
      checkValue(op.value);
      needBst(tree);
      const r = searchFor(rec, op.value, true);
      return done(`Search ${op.value}`, SEARCH_CODE, r.found ? `Found ${op.value} after ${plural(r.comparisons, "comparison")}.` : `${op.value} is not in the tree (${plural(r.comparisons, "comparison")}).`, { found: !!r.found, comparisons: r.comparisons });
    }
    case "delete": {
      checkValue(op.value);
      needBst(tree);
      const c = deleteFrom(rec, op.value);
      const label = { "not-found": "not found, nothing changed", leaf: "case 1 (leaf)", "one-child": "case 2 (one child)", "two-children": "case 3 (two children, in-order successor)" }[c];
      return done(`Delete ${op.value}`, DELETE_CODE, c === "not-found" ? `${op.value} is not in the tree, so nothing was deleted.` : `Deleted ${op.value} using ${label}. The tree now has ${before.count - 1} nodes and is still a valid BST.`, { deleteCase: c }, c !== "not-found");
    }
    case "analyze": {
      const r = analyzeTree(rec);
      const s = r.unbalanced.length ? `Unbalanced at ${r.unbalanced.length} node${r.unbalanced.length === 1 ? "" : "s"}.` : "Balanced: no node has subtrees differing in height by more than 1.";
      return done("Height, count and balance", ANALYZE_CODE, `${plural(r.count, "node")}, ${plural(r.leaves, "leaf", "leaves")}, height ${r.height}. ${s}`, { count: r.count, leaves: r.leaves, height: r.height, balanced: r.unbalanced.length === 0, unbalanced: r.unbalanced });
    }
    case "degenerate": {
      const n = Math.max(3, Math.min(15, Math.trunc(op.count ?? 7)));
      rec.root = null; rec.nextId = 1; rec.touch();
      const demo = runDemo(rec, n);
      return done("Why balance matters", INSERT_CODE, `Sorted inserts: height ${demo.sortedHeight}, ${demo.sortedComparisons} comparisons to find ${n}. Balanced order: height ${demo.balancedHeight}, ${demo.balancedComparisons} comparisons.`, { demo });
    }
  }
}

function checkValue(v: number) {
  if (!Number.isInteger(v)) throw new TreeError("value", "The value must be a whole number.");
  if (v < MIN_VALUE || v > MAX_VALUE) throw new TreeError("range", `${v} is out of range. Use whole numbers from ${MIN_VALUE} to ${MAX_VALUE}.`);
}

/** Build a BST by inserting values in the given order (duplicates are skipped). No frames are kept. */
export function buildBst(values: number[]): Snap {
  const rec = new Rec(null, 1);
  rec.muted = true;
  for (const v of values) {
    checkValue(v);
    if (rec.tree().nodes.length >= MAX_NODES) throw new TreeError("limit", `The limit is ${MAX_NODES} nodes.`);
    insertInto(rec, v, false);
  }
  return rec.tree();
}

/** Text summary of one frame for the aria-live region. */
export function describeFrame(f: TreeFrame): string {
  const m = byId(f.tree);
  const val = (id: number) => m.get(id)?.value;
  const parts = [f.text];
  if (f.current !== null) parts.push(`Current node ${val(f.current)}.`);
  if (f.output.length) parts.push(`Output so far: ${f.output.join(", ")}.`);
  if (f.stackKind && f.stack.length) {
    const names = f.stackKind === "queue" ? f.stack.map((e) => e.label) : [...f.stack].reverse().map((e) => e.label);
    parts.push(`${f.stackKind === "call" ? "Call stack, top first" : f.stackKind === "stack" ? "Stack, top first" : "Queue, front first"}: ${names.join(", ")}.`);
  } else if (f.stackKind) parts.push(`${f.stackKind === "call" ? "Call stack" : f.stackKind === "stack" ? "Stack" : "Queue"} is empty.`);
  return parts.join(" ");
}

// ── Presets ─────────────────────────────────────────────────────────────

export interface TreePreset { id: string; label: string; kind: "binary" | "bst"; /** Level-order text. */ values: string; teaches: string }

export const PRESETS: TreePreset[] = [
  { id: "bst-classic", label: "BST: classic, 9 nodes", kind: "bst", values: "8,3,10,1,6,null,14,null,null,4,7,13", teaches: "A typical binary search tree. Try the four traversals and notice that in-order comes out sorted." },
  { id: "bst-perfect", label: "BST: perfectly balanced, 7 nodes", kind: "bst", values: "4,2,6,1,3,5,7", teaches: "Every level is full, so the height is as small as it can be: 2 for 7 nodes." },
  { id: "bst-delete", label: "BST: practise the three delete cases", kind: "bst", values: "50,30,70,20,40,60,80,null,null,35,null", teaches: "Delete 20 (a leaf), 40 (one child) and 30 or 50 (two children, uses the in-order successor)." },
  { id: "bst-degenerate", label: "BST: degenerate (sorted inserts)", kind: "bst", values: "1,null,2,null,3,null,4,null,5,null,6,null,7", teaches: "What inserting 1 to 7 in order produces: a chain. Height 6 for 7 nodes, so search is no better than a list." },
  { id: "bst-lopsided", label: "BST: lopsided (unbalanced)", kind: "bst", values: "20,10,30,5,null,null,null,3", teaches: "A valid BST that is not balanced: the left side is deeper than the right by more than 1." },
  { id: "bt-basic", label: "Binary tree: 7 nodes (not a BST)", kind: "binary", values: "1,2,3,4,5,6,7", teaches: "A plain binary tree has no ordering rule. Traversals still work; ordered search does not." },
  { id: "bt-gaps", label: "Binary tree with gaps", kind: "binary", values: "1,2,3,null,4,null,5,6", teaches: "How null gaps in a level-order list place children: 2 has no left child, 3 has no left child." },
  { id: "bt-full31", label: "Binary tree: 31 nodes (the size limit)", kind: "binary", values: Array.from({ length: 31 }, (_, i) => i + 1).join(","), teaches: "A full tree with five levels, the largest this tool accepts." },
];

export const presetById = (id: string | undefined) => PRESETS.find((p) => p.id === id);
export const presetSnap = (p: TreePreset): Snap => parseLevelOrder(p.values);

// ── Generic diagram layout (used by TreeDiagram; deterministic, no layout library) ──────────────────────

export type DiagramKey = string | number;
export interface DiagramNode { id?: DiagramKey; label: string; children: (DiagramNode | null)[] }
export interface LaidOutNode { key: DiagramKey; label: string; x: number; y: number; depth: number; parent: DiagramKey | null; leaf: boolean }
export interface DiagramLayout { nodes: LaidOutNode[]; edges: { from: DiagramKey; to: DiagramKey }[]; cols: number; levels: number }

/**
 * Binary nodes (at most two children, null marks a missing side) are placed by in-order position, so a left-only child sits
 * left of its parent and a right-only child sits right of it, and no two nodes overlap. Nodes with more than two children are
 * centred over their children. A node reached twice (a cycle or a shared object) is drawn once.
 */
export function layoutDiagram(root: DiagramNode | null): DiagramLayout {
  const nodes: LaidOutNode[] = [];
  const edges: { from: DiagramKey; to: DiagramKey }[] = [];
  if (!root) return { nodes, edges, cols: 0, levels: 0 };
  const seen = new Set<DiagramNode>();
  const usedKeys = new Set<DiagramKey>();
  let slot = 0;
  let levels = 0;
  const place = (n: DiagramNode, depth: number, path: string, parent: DiagramKey | null): number => {
    seen.add(n);
    let key: DiagramKey = n.id ?? path;
    while (usedKeys.has(key)) key = `${String(key)}#`;
    usedKeys.add(key);
    levels = Math.max(levels, depth + 1);
    const entry: LaidOutNode = { key, label: n.label, x: 0, y: depth, depth, parent, leaf: true };
    nodes.push(entry);
    const kids = n.children.map((c, i) => ({ c, i })).filter((k): k is { c: DiagramNode; i: number } => !!k.c && !seen.has(k.c));
    entry.leaf = kids.length === 0;
    const link = (k: { c: DiagramNode; i: number }) => {
      const before = nodes.length;
      const x = place(k.c, depth + 1, `${path}.${k.i}`, key);
      edges.push({ from: key, to: nodes[before].key });
      return x;
    };
    if (n.children.length <= 2) {
      // children[0] is the left side and children[1] the right side, even when one is null.
      const left = kids.find((k) => k.i === 0);
      const right = kids.find((k) => k.i === 1);
      if (left) link(left);
      entry.x = slot++;
      if (right) link(right);
    } else if (!kids.length) {
      entry.x = slot++;
    } else {
      const xs = kids.map(link);
      entry.x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    return entry.x;
  };
  place(root, 0, "r", null);
  const maxX = nodes.reduce((m, n) => Math.max(m, n.x), 0);
  return { nodes, edges, cols: Math.max(1, Math.ceil(maxX) + 1), levels };
}

/** Snapshot as a generic diagram tree (ids are the snapshot node ids). */
export function snapToDiagram(snap: Snap): DiagramNode | null {
  if (snap.root === null) return null;
  const m = byId(snap);
  const build = (id: number): DiagramNode => {
    const n = m.get(id)!;
    return { id, label: String(n.value), children: n.leaf ? [] : [n.left === null ? null : build(n.left), n.right === null ? null : build(n.right)] };
  };
  return build(snap.root);
}
