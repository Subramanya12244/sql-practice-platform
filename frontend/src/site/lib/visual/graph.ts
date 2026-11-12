/**
 * Graph Explorer engine. Pure (no React). Every algorithm here is a real implementation that is instrumented: the
 * frames are snapshots taken while it runs, so the trace is the execution itself and not a separate hand-written script.
 * Supported: BFS, DFS (explicit stack and recursive), shortest path (BFS hops, Dijkstra, Bellman-Ford), cycle detection
 * (directed and undirected), connected components, strongly connected components (Tarjan) and topological sort (Kahn).
 * Neighbours are always taken in alphabetical order so a run is deterministic and easy to follow.
 */

export const MAX_NODES = 12;
export const MAX_EDGES = 30;
export const VIEW = { w: 460, h: 300 };

export interface GNode { id: string; x: number; y: number }
/** `w` is undefined for an unweighted edge; algorithms that need a cost treat it as 1. */
export interface GEdge { from: string; to: string; w?: number }
export interface Graph { nodes: GNode[]; edges: GEdge[]; directed: boolean }

export const nodeIds = (g: Graph) => g.nodes.map((n) => n.id);
export const weightOf = (e: GEdge) => e.w ?? 1;
export const isWeighted = (g: Graph) => g.edges.some((e) => e.w !== undefined);
const cmp = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

// ── Edge list text: parsing, validation, layout ──────────────────────────
const NAME = /^[A-Za-z0-9_]{1,8}$/;
const EDGE_LINE = /^([A-Za-z0-9_]+)\s*(->|--|-)\s*([A-Za-z0-9_]+)\s*(?::\s*(.*))?$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

export type ParseResult = { ok: true; names: string[]; edges: GEdge[] } | { ok: false; errors: string[] };

/**
 * One edge per line: `A-B`, `A-B:3` (weight) or `A->B:3`. A line with only a name declares an isolated node. `#` starts a comment.
 * Whether an edge is one-way is decided by the directed switch, not by the arrow, so a lesson can flip it without rewriting edges.
 */
export function parseEdgeText(text: string, directed: boolean): ParseResult {
  const errors: string[] = [];
  const names: string[] = [];
  const edges: GEdge[] = [];
  const seenEdges = new Set<string>();
  const add = (n: string) => { if (!names.includes(n)) names.push(n); };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const at = `Line ${i + 1}`;
    if (NAME.test(line)) { add(line); return; }
    const m = EDGE_LINE.exec(line);
    if (!m) { errors.push(`${at}: "${line}" is not an edge. Write it like A-B or A-B:3 (a weight), one edge per line. Names use letters, digits and _ only.`); return; }
    const [, a, , b, wText] = m;
    if (!NAME.test(a) || !NAME.test(b)) { errors.push(`${at}: node names can be at most 8 characters (letters, digits, _).`); return; }
    let w: number | undefined;
    if (wText !== undefined) {
      const t = wText.trim();
      if (!NUMBER.test(t)) { errors.push(`${at}: the weight "${t}" is not a number. Write a weight like A-B:3 or A-B:-2.`); return; }
      w = Number(t);
      if (Math.abs(w) > 1000) { errors.push(`${at}: the weight ${t} is too large. Use a weight between -1000 and 1000.`); return; }
    }
    if (a === b && !directed) { errors.push(`${at}: ${a}-${b} is a self-loop. Self-loops are only allowed in a directed graph.`); return; }
    const key = directed ? `${a}>${b}` : [a, b].sort().join("|");
    if (seenEdges.has(key)) { errors.push(`${at}: the edge ${a}${directed ? "->" : "-"}${b} is already listed. Remove the duplicate.`); return; }
    seenEdges.add(key);
    add(a); add(b);
    edges.push(w === undefined ? { from: a, to: b } : { from: a, to: b, w });
  });
  if (names.length === 0 && errors.length === 0) errors.push("Add at least one node or edge, for example A-B.");
  if (names.length > MAX_NODES) errors.push(`The graph has ${names.length} nodes. The limit is ${MAX_NODES} so the picture stays readable.`);
  if (edges.length > MAX_EDGES) errors.push(`The graph has ${edges.length} edges. The limit is ${MAX_EDGES}.`);
  return errors.length ? { ok: false, errors } : { ok: true, names, edges };
}

/** Deterministic circular layout inside the drawing area, first node at the top and going clockwise. */
export function layoutCircle(names: string[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const n = names.length;
  names.forEach((id, i) => {
    if (n === 1) { out[id] = { x: VIEW.w / 2, y: VIEW.h / 2 }; return; }
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out[id] = { x: Math.round(VIEW.w / 2 + 170 * Math.cos(a)), y: Math.round(VIEW.h / 2 + 108 * Math.sin(a)) };
  });
  return out;
}

export type BuildResult = { ok: true; graph: Graph } | { ok: false; errors: string[] };

/** Parse the text and place the nodes: `coords` (a preset's own layout) is used only when it covers every node. */
export function buildGraph(text: string, directed: boolean, coords?: Record<string, { x: number; y: number }>): BuildResult {
  const p = parseEdgeText(text, directed);
  if (!p.ok) return p;
  const pos = coords && p.names.every((n) => coords[n]) ? coords : layoutCircle(p.names);
  return { ok: true, graph: { directed, edges: p.edges, nodes: p.names.map((id) => ({ id, x: pos[id].x, y: pos[id].y })) } };
}

// ── Adjacency ────────────────────────────────────────────────────────────
export interface Arc { from: string; to: string; edge: number; w: number }

/** Neighbours per node, sorted by name. `asUndirected` ignores edge direction (used for connected components). */
export function adjacency(g: Graph, asUndirected = false): Map<string, Arc[]> {
  const m = new Map<string, Arc[]>(g.nodes.map((n) => [n.id, []]));
  g.edges.forEach((e, i) => {
    const w = weightOf(e);
    m.get(e.from)!.push({ from: e.from, to: e.to, edge: i, w });
    if ((!g.directed || asUndirected) && e.from !== e.to) m.get(e.to)!.push({ from: e.to, to: e.from, edge: i, w });
  });
  for (const l of m.values()) l.sort((a, b) => cmp(a.to, b.to) || a.edge - b.edge);
  return m;
}

/** Every edge as relaxable arcs, in edge-list order. An undirected edge is two arcs (that is why one negative undirected edge is a negative cycle). */
function arcList(g: Graph): Arc[] {
  const out: Arc[] = [];
  g.edges.forEach((e, i) => {
    out.push({ from: e.from, to: e.to, edge: i, w: weightOf(e) });
    if (!g.directed && e.from !== e.to) out.push({ from: e.to, to: e.from, edge: i, w: weightOf(e) });
  });
  return out;
}

// ── Frames ───────────────────────────────────────────────────────────────
export type FrontierKind = "queue" | "stack" | "pq" | "call" | "none";
export interface FItem { label: string; node: string }
export interface Frontier { kind: FrontierKind; title: string; items: FItem[] }
export type EdgeKind = "tree" | "back" | "forward" | "cross";
export type Colour = "white" | "grey" | "black";

export interface GResult {
  kind: "order" | "path" | "none" | "distances" | "negative-cycle" | "cycle" | "acyclic" | "components" | "topo" | "topo-cycle";
  title: string;
  lines: string[];
  /** Nodes and edges (indexes into `Graph.edges`) to highlight: a path or a cycle. */
  nodes?: string[];
  edges?: number[];
  groups?: string[][];
}

export interface GFrame {
  /** Index into the pseudo-code of the algorithm: the line that is running. */
  line: number;
  /** One plain sentence saying what just happened and why. Also the text alternative for the picture. */
  text: string;
  current?: string;
  /** Edge being examined (index into `Graph.edges`) and the node it is being followed from. */
  edge?: number;
  edgeFrom?: string;
  /** Nodes the algorithm has marked visited, in order. */
  visited: string[];
  /** Nodes completely processed. */
  done: string[];
  frontier: Frontier;
  dist?: Record<string, number | null>;
  parent?: Record<string, string | null>;
  colour?: Record<string, Colour>;
  disc?: Record<string, number | null>;
  fin?: Record<string, number | null>;
  idx?: Record<string, number | null>;
  low?: Record<string, number | null>;
  indeg?: Record<string, number>;
  comp?: Record<string, number | null>;
  edgeKinds?: Record<number, EdgeKind>;
  groups?: string[][];
  order?: string[];
  /** Highlighted result path or cycle. */
  hlNodes?: string[];
  hlEdges?: number[];
  result?: GResult;
}

export type AlgoId = "bfs" | "dfs" | "dfs-recursive" | "shortest-bfs" | "dijkstra" | "bellman-ford" | "cycle" | "components" | "scc" | "topo";

const NO_FRONTIER: Frontier = { kind: "none", title: "", items: [] };
const clone = <T,>(v: T): T => {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  return v;
};

/** Collects frames. Each one is a deep copy, so later mutation by the running algorithm cannot change an earlier frame. */
class Rec {
  frames: GFrame[] = [];
  emit(line: number, text: string, x: Partial<GFrame> = {}) {
    this.frames.push(clone({ line, text, visited: [], done: [], frontier: NO_FRONTIER, ...x }) as GFrame);
  }
  /** The last frame carries the result. */
  finish(line: number, text: string, result: GResult, x: Partial<GFrame> = {}): GResult {
    this.emit(line, text, { ...x, result, hlNodes: result.nodes, hlEdges: result.edges });
    return result;
  }
}

const rec2 = <V,>(ids: string[], m: Map<string, V>, empty: V): Record<string, V> => Object.fromEntries(ids.map((id) => [id, m.has(id) ? (m.get(id) as V) : empty]));
const distRec = (ids: string[], m: Map<string, number>) => rec2<number | null>(ids, m, null);
const listItems = (xs: string[]): FItem[] => xs.map((n) => ({ label: n, node: n }));

interface Out { rec: Rec; result: GResult }

/** Walk parent links from `to` back to the root. Returns nodes and the edge used to reach each one. */
function walkBack(parent: Map<string, string | null>, pedge: Map<string, number>, to: string) {
  const nodes: string[] = [];
  const edges: number[] = [];
  for (let n: string | null | undefined = to; n != null; n = parent.get(n)) {
    nodes.push(n);
    if (pedge.has(n)) edges.push(pedge.get(n)!);
  }
  return { nodes: nodes.reverse(), edges: edges.reverse() };
}

const arrowOf = (g: Graph) => (g.directed ? "->" : "-");

// ── BFS and BFS shortest path ────────────────────────────────────────────
function runBfs(g: Graph, start: string, target?: string): Out {
  const rec = new Rec();
  const adj = adjacency(g);
  const all = nodeIds(g);
  const ar = arrowOf(g);
  const seen = new Set([start]);
  const visited = [start];
  const done: string[] = [];
  const dist = new Map<string, number>([[start, 0]]);
  const parent = new Map<string, string | null>([[start, null]]);
  const pedge = new Map<string, number>();
  const queue = [start];
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited, done, frontier: { kind: "queue", title: "Queue (front to back)", items: listItems(queue) },
    dist: distRec(all, dist), parent: rec2<string | null>(all, parent, null), ...x,
  });
  rec.emit(1, `Mark ${start} visited, put it in the queue and give it distance 0.${target ? ` The goal is ${target}.` : ""}${isWeighted(g) ? " This graph has weights, but BFS ignores them and counts edges (hops); use Dijkstra for the cheapest path." : ""}`, snap({ current: start }));
  const path = () => {
    const w = walkBack(parent, pedge, target!);
    const hops = dist.get(target!)!;
    return { nodes: w.nodes, edges: w.edges, hops };
  };
  if (start === target) {
    return { rec, result: rec.finish(8, `${start} is the goal, so the path is just ${start} (0 hops).`, { kind: "path", title: `Shortest path ${start} to ${target}`, lines: [`${start} (0 hops)`], nodes: [start], edges: [] }, snap()) };
  }
  while (queue.length) {
    const u = queue.shift()!;
    rec.emit(3, `Take ${u} from the front of the queue. Its neighbours are checked next.`, snap({ current: u }));
    for (const a of adj.get(u)!) {
      rec.emit(4, `Look at the edge ${u}${ar}${a.to}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      if (seen.has(a.to)) { rec.emit(5, `${a.to} is already visited, so skip it.`, snap({ current: u, edge: a.edge, edgeFrom: u })); continue; }
      seen.add(a.to); visited.push(a.to); parent.set(a.to, u); pedge.set(a.to, a.edge); dist.set(a.to, dist.get(u)! + 1); queue.push(a.to);
      rec.emit(6, `${a.to} is new: mark it visited, parent ${u}, distance ${dist.get(a.to)}, and add it to the back of the queue.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      if (a.to === target) {
        const p = path();
        rec.emit(7, `${target} was just found, and BFS reaches nodes in order of hop count, so no shorter path exists.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
        return { rec, result: rec.finish(8, `Shortest path ${p.nodes.join(" to ")}: ${p.hops} hop${p.hops === 1 ? "" : "s"}.`, { kind: "path", title: `Shortest path ${start} to ${target}`, lines: [`${p.nodes.join(" > ")} (${p.hops} hop${p.hops === 1 ? "" : "s"})`], nodes: p.nodes, edges: p.edges }, snap()) };
      }
    }
    done.push(u);
    rec.emit(2, `${u} is finished. ${queue.length ? "Continue with the next node in the queue." : "The queue is empty."}`, snap({ current: u }));
  }
  if (target) return { rec, result: rec.finish(8, `The queue is empty and ${target} was never reached: there is no path from ${start} to ${target}.`, { kind: "none", title: `No path ${start} to ${target}`, lines: [`${target} cannot be reached from ${start}.`] }, snap()) };
  const lost = all.filter((n) => !seen.has(n));
  return { rec, result: rec.finish(8, `Done. Visit order: ${visited.join(", ")}.${lost.length ? ` Not reachable from ${start}: ${lost.join(", ")}.` : ""}`, { kind: "order", title: "BFS visit order", lines: [visited.join(", "), ...(lost.length ? [`Not reachable from ${start}: ${lost.join(", ")}`] : []), ...visited.map((n) => `${n}: ${dist.get(n)} hop${dist.get(n) === 1 ? "" : "s"}`)] }, snap()) };
}

// ── DFS with an explicit stack ───────────────────────────────────────────
function runDfsStack(g: Graph, start: string): Out {
  const rec = new Rec();
  const adj = adjacency(g);
  const all = nodeIds(g);
  const ar = arrowOf(g);
  const seen = new Set<string>();
  const visited: string[] = [];
  const parent = new Map<string, string | null>();
  const stack: { node: string; from: string | null }[] = [{ node: start, from: null }];
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited, done: visited, frontier: { kind: "stack", title: "Stack (top on the right)", items: stack.map((s) => ({ label: s.node, node: s.node })) },
    parent: rec2<string | null>(all, parent, null), ...x,
  });
  rec.emit(1, `Push the start node ${start} on the stack.`, snap());
  while (stack.length) {
    const top = stack.pop()!;
    const u = top.node;
    rec.emit(3, `Pop ${u} from the top of the stack.`, snap({ current: u }));
    if (seen.has(u)) { rec.emit(4, `${u} was already visited (it was pushed more than once), so discard this copy.`, snap({ current: u })); continue; }
    seen.add(u); visited.push(u); parent.set(u, top.from);
    rec.emit(5, `Mark ${u} visited${top.from ? ` (reached from ${top.from})` : ""}.`, snap({ current: u }));
    const arcs = [...adj.get(u)!].reverse(); // reversed so the alphabetically first neighbour ends on top and is explored first
    for (const a of arcs) {
      if (seen.has(a.to)) { rec.emit(7, `${a.to} is already visited, so it is not pushed.`, snap({ current: u, edge: a.edge, edgeFrom: u })); continue; }
      stack.push({ node: a.to, from: u });
      rec.emit(7, `Push ${a.to} (edge ${u}${ar}${a.to}). The most recently pushed node is explored first, which is what makes this depth-first.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
    }
  }
  const lost = all.filter((n) => !seen.has(n));
  return { rec, result: rec.finish(8, `Done. Visit order: ${visited.join(", ")}.${lost.length ? ` Not reachable from ${start}: ${lost.join(", ")}.` : ""}`, { kind: "order", title: "DFS visit order", lines: [visited.join(", "), ...(lost.length ? [`Not reachable from ${start}: ${lost.join(", ")}`] : [])] }, snap()) };
}

// ── DFS, recursive, with discovery/finish times and edge types ───────────
function runDfsRecursive(g: Graph, start: string): Out {
  const rec = new Rec();
  const adj = adjacency(g);
  const all = nodeIds(g);
  const ar = arrowOf(g);
  const colour = new Map<string, Colour>(all.map((n) => [n, "white"]));
  const disc = new Map<string, number>();
  const fin = new Map<string, number>();
  const parent = new Map<string, string | null>([[start, null]]);
  const kinds: Record<number, EdgeKind> = {};
  const visited: string[] = [];
  const done: string[] = [];
  const calls: string[] = [];
  let time = 0;
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited, done, frontier: { kind: "call", title: "Call stack (top on the right)", items: calls.map((n) => ({ label: `dfs(${n})`, node: n })) },
    colour: Object.fromEntries(colour), disc: rec2<number | null>(all, disc, null), fin: rec2<number | null>(all, fin, null),
    parent: rec2<string | null>(all, parent, null), edgeKinds: kinds, ...x,
  });
  const visit = (u: string, via: number | null) => {
    colour.set(u, "grey"); disc.set(u, ++time); visited.push(u); calls.push(u);
    rec.emit(1, `Call dfs(${u}). Colour it grey (in progress) and record discovery time ${time}.`, snap({ current: u }));
    for (const a of adj.get(u)!) {
      if (kinds[a.edge] !== undefined || a.edge === via) {
        rec.emit(2, `The edge ${u}${ar}${a.to} was already classified from the other end, so skip it.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
        continue;
      }
      rec.emit(2, `Look at the edge ${u}${ar}${a.to}. ${a.to} is ${colour.get(a.to) === "white" ? "white (not seen yet)" : colour.get(a.to) === "grey" ? "grey (still on the call stack)" : "black (finished)"}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      const c = colour.get(a.to)!;
      if (c === "white") {
        kinds[a.edge] = "tree"; parent.set(a.to, u);
        rec.emit(3, `${a.to} is white, so ${u}${ar}${a.to} is a tree edge. Recurse into dfs(${a.to}).`, snap({ current: u, edge: a.edge, edgeFrom: u }));
        visit(a.to, a.edge);
        rec.emit(2, `Back in dfs(${u}) after dfs(${a.to}) returned.`, snap({ current: u }));
      } else if (c === "grey") {
        kinds[a.edge] = "back";
        rec.emit(4, `${a.to} is grey: it is an ancestor still on the call stack, so ${u}${ar}${a.to} is a back edge. A back edge means a cycle.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      } else {
        kinds[a.edge] = disc.get(u)! < disc.get(a.to)! ? "forward" : "cross";
        rec.emit(5, `${a.to} is black (already finished), so ${u}${ar}${a.to} is a ${kinds[a.edge]} edge. No recursion.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      }
    }
    colour.set(u, "black"); fin.set(u, ++time); calls.pop(); done.push(u);
    rec.emit(6, `All edges of ${u} are done. Colour it black, finish time ${time}, and return.`, snap({ current: u }));
  };
  visit(start, null);
  const lost = all.filter((n) => colour.get(n) === "white");
  const counts = (["tree", "back", "forward", "cross"] as EdgeKind[]).map((k) => `${Object.values(kinds).filter((x) => x === k).length} ${k}`).join(", ");
  return { rec, result: rec.finish(6, `Done. Visit order: ${visited.join(", ")}. Edge types: ${counts}.`, { kind: "order", title: "Recursive DFS", lines: [`Visit order: ${visited.join(", ")}`, `Edge types: ${counts}`, ...(lost.length ? [`Not reachable from ${start}: ${lost.join(", ")}`] : [])] }, snap()) };
}

// ── Dijkstra ─────────────────────────────────────────────────────────────
function runDijkstra(g: Graph, start: string, target?: string): Out {
  const rec = new Rec();
  const adj = adjacency(g);
  const all = nodeIds(g);
  const ar = arrowOf(g);
  const dist = new Map<string, number>([[start, 0]]);
  const parent = new Map<string, string | null>([[start, null]]);
  const pedge = new Map<string, number>();
  const settled: string[] = [];
  const order: string[] = [];
  /** Priority queue kept sorted by (distance, name). Stale entries stay in it until they are popped ("lazy deletion"). */
  const pq: { d: number; node: string }[] = [{ d: 0, node: start }];
  const push = (d: number, node: string) => { pq.push({ d, node }); pq.sort((x, y) => x.d - y.d || cmp(x.node, y.node)); };
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited: order, done: settled, frontier: { kind: "pq", title: "Priority queue (smallest distance first)", items: pq.map((p) => ({ label: `${p.node}:${num(p.d)}`, node: p.node })) },
    dist: distRec(all, dist), parent: rec2<string | null>(all, parent, null), ...x,
  });
  rec.emit(0, `Every distance starts at infinity except ${start}, which is 0. The priority queue holds only (${start}, 0).${isWeighted(g) ? "" : " This graph has no weights, so every edge costs 1."}`, snap());
  while (pq.length) {
    const { d, node: u } = pq.shift()!;
    rec.emit(2, `Pop the smallest entry: ${u} with distance ${num(d)}.`, snap({ current: u }));
    if (d > dist.get(u)!) { rec.emit(3, `This entry is stale: ${u} already has a better distance (${num(dist.get(u)!)}), so ignore it.`, snap({ current: u })); continue; }
    if (!order.includes(u)) order.push(u);
    if (u === target) {
      settled.push(u);
      const w = walkBack(parent, pedge, u);
      rec.emit(4, `${u} is the goal. Its distance ${num(d)} is final because every other queued entry is at least as large and no edge is negative.`, snap({ current: u }));
      return { rec, result: rec.finish(8, `Cheapest path ${w.nodes.join(" to ")} costs ${num(d)}.`, { kind: "path", title: `Cheapest path ${start} to ${target}`, lines: [`${w.nodes.join(" > ")} (cost ${num(d)})`], nodes: w.nodes, edges: w.edges }, snap()) };
    }
    for (const a of adj.get(u)!) {
      const cand = d + a.w;
      const had = dist.has(a.to);
      rec.emit(5, `Edge ${u}${ar}${a.to} costs ${num(a.w)}: the route through ${u} gives ${num(d)} + ${num(a.w)} = ${num(cand)}; ${a.to} currently has ${had ? num(dist.get(a.to)!) : "infinity"}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      if (!had || cand < dist.get(a.to)!) {
        dist.set(a.to, cand); parent.set(a.to, u); pedge.set(a.to, a.edge); push(cand, a.to);
        rec.emit(7, `${num(cand)} is better, so update ${a.to}: distance ${num(cand)}, parent ${u}, and push (${a.to}, ${num(cand)}).`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      } else {
        rec.emit(6, `${num(cand)} is not better than ${num(dist.get(a.to)!)}, so ${a.to} keeps its distance.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      }
    }
    settled.push(u);
    rec.emit(1, `${u} is settled: its distance ${num(d)} is final.`, snap({ current: u }));
  }
  if (target) return { rec, result: rec.finish(8, `The queue is empty and ${target} was never reached: there is no path.`, { kind: "none", title: `No path ${start} to ${target}`, lines: [`${target} cannot be reached from ${start}.`] }, snap()) };
  const lines = all.map((n) => (dist.has(n) ? `${n}: ${num(dist.get(n)!)}${parent.get(n) ? ` (via ${parent.get(n)})` : ""}` : `${n}: unreachable`));
  return { rec, result: rec.finish(8, `Done. Cheapest cost from ${start}: ${all.map((n) => `${n}=${dist.has(n) ? num(dist.get(n)!) : "inf"}`).join(", ")}.`, { kind: "distances", title: `Cheapest cost from ${start}`, lines }, snap()) };
}

// ── Bellman-Ford ─────────────────────────────────────────────────────────
function runBellmanFord(g: Graph, start: string, target?: string): Out {
  const rec = new Rec();
  const all = nodeIds(g);
  const arcs = arcList(g);
  const ar = arrowOf(g);
  const dist = new Map<string, number>([[start, 0]]);
  const parent = new Map<string, string | null>([[start, null]]);
  const pedge = new Map<string, number>();
  const reached: string[] = [start];
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited: reached, done: [], frontier: { kind: "none", title: "", items: [] }, dist: distRec(all, dist), parent: rec2<string | null>(all, parent, null), ...x,
  });
  rec.emit(0, `Every distance starts at infinity except ${start}, which is 0. Bellman-Ford will relax every edge, up to ${all.length - 1} passes, then check once more.${g.directed ? "" : " An undirected edge counts as two arcs, one each way."}`, snap());
  let pass = 0;
  for (; pass < all.length - 1; pass++) {
    let changed = false;
    rec.emit(1, `Pass ${pass + 1} of ${all.length - 1}: relax every edge in list order. Edges whose source is still unreachable are skipped.`, snap());
    for (const a of arcs) {
      if (!dist.has(a.from)) continue;
      const cand = dist.get(a.from)! + a.w;
      const had = dist.has(a.to);
      rec.emit(2, `Edge ${a.from}${ar}${a.to} (weight ${num(a.w)}): ${num(dist.get(a.from)!)} + ${num(a.w)} = ${num(cand)} against ${had ? num(dist.get(a.to)!) : "infinity"} at ${a.to}.`, snap({ current: a.from, edge: a.edge, edgeFrom: a.from }));
      if (!had || cand < dist.get(a.to)!) {
        dist.set(a.to, cand); parent.set(a.to, a.from); pedge.set(a.to, a.edge); changed = true;
        if (!reached.includes(a.to)) reached.push(a.to);
        rec.emit(3, `Shorter, so update ${a.to} to ${num(cand)} (parent ${a.from}).`, snap({ current: a.from, edge: a.edge, edgeFrom: a.from }));
      }
    }
    if (!changed) { rec.emit(4, `Nothing changed in pass ${pass + 1}, so every distance is final. Stop early.`, snap()); break; }
    rec.emit(4, `End of pass ${pass + 1}. Distances changed, so keep going.`, snap());
  }
  rec.emit(5, `Check pass: if any edge can still be relaxed, a negative cycle is reachable from ${start}.`, snap());
  for (const a of arcs) {
    if (!dist.has(a.from)) continue;
    const cand = dist.get(a.from)! + a.w;
    const better = !dist.has(a.to) || cand < dist.get(a.to)!;
    rec.emit(5, `Check ${a.from}${ar}${a.to}: ${num(dist.get(a.from)!)} + ${num(a.w)} = ${num(cand)} against ${dist.has(a.to) ? num(dist.get(a.to)!) : "infinity"}. ${better ? "Still improving." : "No improvement."}`, snap({ current: a.from, edge: a.edge, edgeFrom: a.from }));
    if (better) {
      parent.set(a.to, a.from); pedge.set(a.to, a.edge);
      // Walk back V steps along parents to be certain we stand on the cycle itself, then collect it.
      let x = a.to;
      for (let i = 0; i < all.length; i++) x = parent.get(x) ?? x;
      const cyc: string[] = [x];
      for (let y = parent.get(x)!; y !== x; y = parent.get(y)!) cyc.push(y);
      cyc.reverse();
      const edges = cyc.map((_, i) => pedge.get(cyc[(i + 1) % cyc.length])!);
      const total = edges.reduce((sum, e) => sum + weightOf(g.edges[e]), 0);
      const closed = [...cyc, cyc[0]].join(" to ");
      const why = g.directed ? "" : " Because the graph is undirected, one negative edge is already a negative cycle: walk it back and forth forever.";
      return { rec, result: rec.finish(5, `Negative cycle: ${closed}. Each lap lowers the cost, so shortest distances are undefined.${why}`, { kind: "negative-cycle", title: "Negative cycle detected", lines: [`Cycle: ${closed}`, `One lap costs ${num(total)}.${why}`, "No finite shortest path exists for any node that can be reached through this cycle."], nodes: cyc, edges }, snap({ current: a.from, edge: a.edge, edgeFrom: a.from })) };
    }
  }
  rec.emit(6, `No edge can be relaxed any more: there is no negative cycle reachable from ${start}.`, snap());
  if (target) {
    if (!dist.has(target)) return { rec, result: rec.finish(6, `${target} was never reached: there is no path.`, { kind: "none", title: `No path ${start} to ${target}`, lines: [`${target} cannot be reached from ${start}.`] }, snap()) };
    const w = walkBack(parent, pedge, target);
    return { rec, result: rec.finish(6, `Cheapest path ${w.nodes.join(" to ")} costs ${num(dist.get(target)!)}.`, { kind: "path", title: `Cheapest path ${start} to ${target}`, lines: [`${w.nodes.join(" > ")} (cost ${num(dist.get(target)!)})`], nodes: w.nodes, edges: w.edges }, snap()) };
  }
  const lines = all.map((n) => (dist.has(n) ? `${n}: ${num(dist.get(n)!)}${parent.get(n) ? ` (via ${parent.get(n)})` : ""}` : `${n}: unreachable`));
  return { rec, result: rec.finish(6, `Done. Cheapest cost from ${start}: ${all.map((n) => `${n}=${dist.has(n) ? num(dist.get(n)!) : "inf"}`).join(", ")}.`, { kind: "distances", title: `Cheapest cost from ${start}`, lines }, snap()) };
}

// ── Cycle detection ──────────────────────────────────────────────────────
function runCycle(g: Graph): Out {
  const rec = new Rec();
  const adj = adjacency(g);
  const all = nodeIds(g);
  const ar = arrowOf(g);
  const colour = new Map<string, Colour>(all.map((n) => [n, "white"]));
  const parent = new Map<string, string | null>();
  const pedge = new Map<string, number>();
  const visited: string[] = [];
  const done: string[] = [];
  const path: string[] = [];
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited, done, frontier: { kind: "call", title: "Current DFS path (call stack)", items: path.map((n) => ({ label: n, node: n })) },
    colour: Object.fromEntries(colour), parent: rec2<string | null>(all, parent, null), ...x,
  });
  let found: GResult | null = null;
  const visit = (u: string, via: number | null): boolean => {
    colour.set(u, "grey"); visited.push(u); path.push(u);
    rec.emit(1, `Enter ${u}: colour it grey (on the current path).`, snap({ current: u }));
    for (const a of adj.get(u)!) {
      if (!g.directed && a.edge === via) {
        rec.emit(2, `Skip the edge ${u}${ar}${a.to}: it is the edge we just came along, and going back along it is not a cycle.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
        continue;
      }
      const c = colour.get(a.to)!;
      rec.emit(2, `Look at the edge ${u}${ar}${a.to}. ${a.to} is ${c === "white" ? "white (new)" : c === "grey" ? "grey (on the current path)" : "black (finished, cannot lead back here)"}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      if (c === "white") {
        parent.set(a.to, u); pedge.set(a.to, a.edge);
        rec.emit(3, `${a.to} is new, so go deeper into ${a.to}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
        if (visit(a.to, a.edge)) return true;
        rec.emit(2, `Back at ${u}.`, snap({ current: u }));
      } else if (c === "grey") {
        const cyc = path.slice(path.indexOf(a.to));
        const edges = cyc.slice(1).map((n) => pedge.get(n)!).concat(a.edge);
        const closed = [...cyc, cyc[0]].join(g.directed ? " > " : " - ");
        found = { kind: "cycle", title: "Cycle found", lines: [`Cycle: ${closed}`, g.directed ? `The back edge ${u}${ar}${a.to} points to ${a.to}, which is still on the current path.` : `The edge ${u}-${a.to} reaches ${a.to}, which is already on the current path and is not the edge we arrived by.`], nodes: cyc, edges };
        rec.emit(4, `${g.directed ? `${u}${ar}${a.to} is a back edge` : `${u}-${a.to} closes a cycle`}: ${a.to} is on the current path. Cycle: ${closed}.`, snap({ current: u, edge: a.edge, edgeFrom: u, hlNodes: cyc, hlEdges: edges }));
        return true;
      }
    }
    colour.set(u, "black"); path.pop(); done.push(u);
    rec.emit(5, `${u} has no more edges to follow. Colour it black and leave the path.`, snap({ current: u }));
    return false;
  };
  rec.emit(0, g.directed ? "Directed graph: three-colour DFS. White = unseen, grey = on the current path, black = finished. An edge into a grey node is a back edge and proves a cycle." : "Undirected graph: DFS that remembers the edge it arrived by. Meeting an already-seen node through any other edge proves a cycle.", snap());
  for (const s of all) {
    if (colour.get(s) !== "white") continue;
    rec.emit(0, `Start a DFS from ${s}, which has not been visited yet.`, snap({ current: s }));
    if (visit(s, null)) {
      const r = found as unknown as GResult;
      return { rec, result: rec.finish(4, `Cycle found. ${r.lines[0]}.`, r, snap()) };
    }
  }
  return { rec, result: rec.finish(6, g.directed ? "Every node finished without meeting a grey node: the graph has no cycle (it is a DAG)." : "Every node finished without a second route to a seen node: the graph has no cycle (it is a forest).", { kind: "acyclic", title: "No cycle", lines: [g.directed ? "No back edge exists, so this directed graph is a DAG." : "No edge closes a loop, so this undirected graph is a forest."] }, snap()) };
}

// ── Connected components ─────────────────────────────────────────────────
function runComponents(g: Graph): Out {
  const rec = new Rec();
  const adj = adjacency(g, true);
  const all = nodeIds(g);
  const ar = "-";
  const seen = new Set<string>();
  const visited: string[] = [];
  const done: string[] = [];
  const label = new Map<string, number>();
  const groups: string[][] = [];
  const queue: string[] = [];
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited, done, frontier: { kind: "queue", title: "Queue (front to back)", items: listItems(queue) }, comp: rec2<number | null>(all, label, null), groups, ...x,
  });
  rec.emit(0, `Start with no components.${g.directed ? " The graph is directed; edge direction is ignored here, so these are weakly connected components." : ""} Each unvisited node starts a new component, and a BFS flood fill collects everything connected to it.`, snap());
  for (const s of all) {
    if (seen.has(s)) continue;
    const c = groups.length + 1;
    groups.push([]);
    seen.add(s); visited.push(s); queue.push(s);
    rec.emit(2, `${s} is not visited yet, so it starts component ${c}. Put it in the queue.`, snap({ current: s }));
    while (queue.length) {
      const u = queue.shift()!;
      label.set(u, c); groups[c - 1].push(u);
      rec.emit(3, `Take ${u} from the queue and label it component ${c}.`, snap({ current: u }));
      for (const a of adj.get(u)!) {
        if (seen.has(a.to)) { rec.emit(4, `${a.to} is already visited, skip.`, snap({ current: u, edge: a.edge, edgeFrom: u })); continue; }
        seen.add(a.to); visited.push(a.to); queue.push(a.to);
        rec.emit(4, `Edge ${u}${ar}${a.to}: ${a.to} is new, so it is in the same component. Enqueue it.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      }
      done.push(u);
    }
    rec.emit(1, `Component ${c} is complete: ${groups[c - 1].join(", ")}.`, snap());
  }
  const lines = groups.map((m, i) => `Component ${i + 1}: ${m.join(", ")}`);
  return { rec, result: rec.finish(5, `Done: ${groups.length} component${groups.length === 1 ? "" : "s"}. ${groups.map((m) => `{${m.join(", ")}}`).join(" ")}`, { kind: "components", title: `${groups.length} connected component${groups.length === 1 ? "" : "s"}`, lines, groups: groups.map((m) => [...m]) }, snap()) };
}

// ── Strongly connected components (Tarjan) ───────────────────────────────
function runScc(g: Graph): Out {
  const rec = new Rec();
  const adj = adjacency(g);
  const all = nodeIds(g);
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const label = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const visited: string[] = [];
  const done: string[] = [];
  const groups: string[][] = [];
  let next = 0;
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited, done, frontier: { kind: "stack", title: "Tarjan stack (top on the right)", items: listItems(stack) },
    idx: rec2<number | null>(all, idx, null), low: rec2<number | null>(all, low, null), comp: rec2<number | null>(all, label, null), groups, ...x,
  });
  const strong = (u: string) => {
    idx.set(u, next); low.set(u, next); next++; stack.push(u); onStack.add(u); visited.push(u);
    rec.emit(1, `Visit ${u}: index ${idx.get(u)}, lowlink ${low.get(u)}. Push it on the Tarjan stack.`, snap({ current: u }));
    for (const a of adj.get(u)!) {
      rec.emit(2, `Look at the edge ${u}->${a.to}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      if (!idx.has(a.to)) {
        rec.emit(3, `${a.to} has no index yet, so recurse into it.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
        strong(a.to);
        low.set(u, Math.min(low.get(u)!, low.get(a.to)!));
        rec.emit(3, `Back at ${u}: lowlink becomes min(${u}, ${a.to}) = ${low.get(u)}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      } else if (onStack.has(a.to)) {
        low.set(u, Math.min(low.get(u)!, idx.get(a.to)!));
        rec.emit(4, `${a.to} is still on the Tarjan stack, so it can reach back to an earlier node: lowlink of ${u} becomes ${low.get(u)}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      } else {
        rec.emit(4, `${a.to} already belongs to a finished component, so this edge cannot be part of a cycle with ${u}.`, snap({ current: u, edge: a.edge, edgeFrom: u }));
      }
    }
    if (low.get(u) === idx.get(u)) {
      const members: string[] = [];
      for (let w: string; ; ) {
        w = stack.pop()!; onStack.delete(w); members.push(w);
        if (w === u) break;
      }
      members.sort((p, q) => all.indexOf(p) - all.indexOf(q));
      groups.push(members);
      members.forEach((m) => { label.set(m, groups.length); done.push(m); });
      rec.emit(5, `${u} has lowlink = index (${idx.get(u)}): it is the root of a component. Pop the stack down to ${u}: component {${members.join(", ")}}.`, snap({ current: u }));
    } else {
      rec.emit(5, `${u} has lowlink ${low.get(u)} below its index ${idx.get(u)}, so it belongs to a component that is rooted higher up. Leave it on the stack.`, snap({ current: u }));
    }
  };
  rec.emit(0, "Tarjan's algorithm: one DFS. Each node gets an index and a lowlink (the smallest index it can reach). A node whose lowlink equals its own index is the root of a strongly connected component.", snap());
  for (const s of all) if (!idx.has(s)) strong(s);
  const lines = groups.map((m, i) => `Component ${i + 1}: ${m.join(", ")}${m.length === 1 ? " (alone)" : ""}`);
  return { rec, result: rec.finish(6, `Done: ${groups.length} strongly connected component${groups.length === 1 ? "" : "s"}. ${groups.map((m) => `{${m.join(", ")}}`).join(" ")}`, { kind: "components", title: `${groups.length} strongly connected component${groups.length === 1 ? "" : "s"}`, lines, groups: groups.map((m) => [...m]) }, snap()) };
}

// ── Topological sort (Kahn) ──────────────────────────────────────────────
function runTopo(g: Graph): Out {
  const rec = new Rec();
  const adj = adjacency(g);
  const all = nodeIds(g);
  const indeg = new Map<string, number>(all.map((n) => [n, 0]));
  for (const e of g.edges) indeg.set(e.to, indeg.get(e.to)! + 1);
  const queue: string[] = [];
  const order: string[] = [];
  const visited: string[] = [];
  const snap = (x: Partial<GFrame> = {}): Partial<GFrame> => ({
    visited, done: order, frontier: { kind: "queue", title: "Queue of nodes with in-degree 0", items: listItems(queue) }, indeg: Object.fromEntries(indeg), order, ...x,
  });
  rec.emit(0, `Count the in-degree of every node (how many edges point into it). ${all.map((n) => `${n}=${indeg.get(n)}`).join(", ")}.`, snap());
  for (const n of all) if (indeg.get(n) === 0) { queue.push(n); visited.push(n); }
  rec.emit(1, queue.length ? `Nodes with in-degree 0 have no prerequisites, so they go in the queue: ${queue.join(", ")}.` : "No node has in-degree 0, so nothing can go first. Every node waits on another, which means there is a cycle.", snap());
  while (queue.length) {
    const u = queue.shift()!;
    order.push(u);
    rec.emit(3, `Take ${u} from the queue and append it to the order. Order so far: ${order.join(", ")}.`, snap({ current: u }));
    for (const a of adj.get(u)!) {
      indeg.set(a.to, indeg.get(a.to)! - 1);
      const zero = indeg.get(a.to) === 0;
      if (zero) { queue.push(a.to); visited.push(a.to); }
      rec.emit(4, `Remove the edge ${u}->${a.to}: in-degree of ${a.to} drops to ${indeg.get(a.to)}.${zero ? ` It is 0, so ${a.to} joins the queue.` : ""}`, snap({ current: u, edge: a.edge, edgeFrom: u }));
    }
  }
  if (order.length === all.length) {
    return { rec, result: rec.finish(5, `Every node was placed. Topological order: ${order.join(", ")}.`, { kind: "topo", title: "Topological order", lines: [order.join(" > "), "Every edge goes from an earlier node to a later one."], nodes: [...order] }, snap()) };
  }
  const stuck = all.filter((n) => !order.includes(n));
  return { rec, result: rec.finish(5, `The queue is empty but only ${order.length} of ${all.length} nodes were placed. ${stuck.join(", ")} never reached in-degree 0, so the graph has a cycle and has no topological order.`, { kind: "topo-cycle", title: "Graph has a cycle", lines: [`No topological order exists.`, `Placed: ${order.join(", ") || "none"}.`, `Stuck (on a cycle or waiting on one): ${stuck.join(", ")}.`] }, snap()) };
}

// ── Public entry ─────────────────────────────────────────────────────────
export interface AlgoInfo { id: AlgoId; label: string; blurb: string; usesStart: boolean; usesTarget: boolean; needsDirected?: boolean }

export const ALGORITHMS: AlgoInfo[] = [
  { id: "bfs", label: "Breadth-first search (BFS)", blurb: "Visits nodes level by level using a queue.", usesStart: true, usesTarget: false },
  { id: "dfs", label: "Depth-first search (explicit stack)", blurb: "Goes as deep as possible first, using a stack you can see.", usesStart: true, usesTarget: false },
  { id: "dfs-recursive", label: "Depth-first search (recursive)", blurb: "The same walk written with recursion, so the call stack is the stack.", usesStart: true, usesTarget: false },
  { id: "shortest-bfs", label: "Shortest path, fewest edges (BFS)", blurb: "Fewest hops in an unweighted graph.", usesStart: true, usesTarget: true },
  { id: "dijkstra", label: "Shortest path, weights (Dijkstra)", blurb: "Cheapest path when no weight is negative.", usesStart: true, usesTarget: true },
  { id: "bellman-ford", label: "Shortest path, negative weights (Bellman-Ford)", blurb: "Handles negative edges and detects negative cycles.", usesStart: true, usesTarget: true },
  { id: "cycle", label: "Cycle detection", blurb: "Finds the edge that closes a cycle.", usesStart: false, usesTarget: false },
  { id: "components", label: "Connected components", blurb: "Groups nodes that can reach each other (edge direction ignored).", usesStart: false, usesTarget: false },
  { id: "scc", label: "Strongly connected components (Tarjan)", blurb: "Groups of nodes that can all reach each other following arrows.", usesStart: false, usesTarget: false, needsDirected: true },
  { id: "topo", label: "Topological sort (Kahn)", blurb: "Orders a DAG so every edge points forward.", usesStart: false, usesTarget: false, needsDirected: true },
];

/** Pseudo-code shown beside the graph. `GFrame.line` indexes into these arrays. */
export const PSEUDO: Record<AlgoId, string[]> = {
  bfs: [
    "BFS(start, target?):",
    "  visited = {start}; queue = [start]; dist[start] = 0",
    "  while queue is not empty:",
    "    u = queue.dequeue()",
    "    for each neighbour v of u:",
    "      if v is already visited: skip",
    "      else: visit v; parent[v] = u; dist[v] = dist[u] + 1; queue.enqueue(v)",
    "      if v == target: stop, the path is found",
    "  return visit order (or the path)",
  ],
  "shortest-bfs": [
    "BFS(start, target?):",
    "  visited = {start}; queue = [start]; dist[start] = 0",
    "  while queue is not empty:",
    "    u = queue.dequeue()",
    "    for each neighbour v of u:",
    "      if v is already visited: skip",
    "      else: visit v; parent[v] = u; dist[v] = dist[u] + 1; queue.enqueue(v)",
    "      if v == target: stop, the path is found",
    "  return the path from parent[] (or no path)",
  ],
  dfs: [
    "DFS(start):",
    "  stack = [start]",
    "  while stack is not empty:",
    "    u = stack.pop()",
    "    if u is already visited: continue",
    "    visit u",
    "    for each neighbour v of u (alphabetical, pushed in reverse):",
    "      if v is not visited: stack.push(v)",
    "  return visit order",
  ],
  "dfs-recursive": [
    "dfs(u):",
    "  colour[u] = grey; disc[u] = ++time",
    "  for each edge u->v:",
    "    if v is white: parent[v] = u; dfs(v)        # tree edge",
    "    else if v is grey: back edge                # v is on the call stack",
    "    else: forward or cross edge                 # v already finished",
    "  colour[u] = black; fin[u] = ++time; return",
  ],
  dijkstra: [
    "dist[all] = infinity; dist[start] = 0; pq = [(0, start)]",
    "while pq is not empty:",
    "  (d, u) = pq.pop_min()",
    "  if d > dist[u]: continue              # stale entry",
    "  if u == target: stop                  # distance is final",
    "  for each edge u->v with weight w:",
    "    if dist[u] + w < dist[v]:",
    "      dist[v] = dist[u] + w; parent[v] = u; pq.push((dist[v], v))",
    "return dist, parent",
  ],
  "bellman-ford": [
    "dist[all] = infinity; dist[start] = 0",
    "repeat V - 1 times:",
    "  for each edge u->v with weight w:",
    "    if dist[u] + w < dist[v]: dist[v] = dist[u] + w; parent[v] = u",
    "  if nothing changed in this pass: stop early",
    "check pass: if any edge can still be relaxed: negative cycle",
    "return dist, parent",
  ],
  cycle: [
    "for each node s: if colour[s] is white: visit(s)",
    "visit(u, arrivedBy): colour[u] = grey; path.push(u)",
    "  for each edge u->v (undirected: skip the edge we arrived by):",
    "    if v is white: parent[v] = u; visit(v)",
    "    else if v is grey: cycle found, from v along the path to u and back to v",
    "  colour[u] = black; path.pop()",
    "return no cycle",
  ],
  components: [
    "count = 0",
    "for each node s in order:",
    "  if s is not visited: count += 1; queue = [s]; mark s",
    "  while queue is not empty: u = dequeue; label[u] = count",
    "    for each neighbour v of u: if v is not visited: mark v; enqueue v",
    "return the groups",
  ],
  scc: [
    "for each node s: if idx[s] is unset: strong(s)",
    "strong(u): idx[u] = low[u] = next++; push u on the stack",
    "  for each edge u->v:",
    "    if idx[v] is unset: strong(v); low[u] = min(low[u], low[v])",
    "    else if v is on the stack: low[u] = min(low[u], idx[v])",
    "  if low[u] == idx[u]: pop the stack down to u: one component",
    "return the components",
  ],
  topo: [
    "indeg[v] = number of edges pointing into v",
    "queue = every node with indeg 0",
    "while queue is not empty:",
    "  u = queue.dequeue(); order.append(u)",
    "  for each edge u->v: indeg[v] -= 1; if indeg[v] == 0: queue.enqueue(v)",
    "if order has every node: return order, else: cycle (no order exists)",
  ],
};

export type RunResult =
  | { ok: true; algo: AlgoId; frames: GFrame[]; result: GResult; pseudo: string[] }
  | { ok: false; message: string; fix?: { label: string; algo?: AlgoId; directed?: boolean } };

/** Run one algorithm for real and return its frames. Refuses (with an explanation) when the algorithm cannot give a correct answer. */
export function runAlgorithm(g: Graph, algo: AlgoId, start: string, target?: string): RunResult {
  const info = ALGORITHMS.find((a) => a.id === algo);
  if (!info) return { ok: false, message: `Unknown algorithm "${algo}".` };
  const ids = nodeIds(g);
  if (ids.length === 0) return { ok: false, message: "The graph has no nodes." };
  if (info.usesStart && !ids.includes(start)) return { ok: false, message: `The start node "${start}" is not in the graph. Choose one of ${ids.join(", ")}.` };
  const tgt = info.usesTarget && target ? target : undefined;
  if (tgt && !ids.includes(tgt)) return { ok: false, message: `The target node "${tgt}" is not in the graph. Choose one of ${ids.join(", ")}.` };
  if (info.needsDirected && !g.directed) {
    return { ok: false, message: `${info.id === "topo" ? "A topological order" : "Strongly connected components"} only make sense for a directed graph, because they depend on the direction of each edge. This graph is undirected.${info.id === "scc" ? " In an undirected graph every connected component is already strongly connected: use Connected components." : ""}`, fix: { label: "Make the graph directed", directed: true } };
  }
  if (algo === "dijkstra") {
    const neg = g.edges.find((e) => weightOf(e) < 0);
    if (neg) {
      return {
        ok: false,
        message: `Dijkstra cannot run: the edge ${neg.from}${g.directed ? "->" : "-"}${neg.to} has weight ${num(weightOf(neg))}. Dijkstra settles a node the first time it leaves the priority queue and assumes no later route can be cheaper. That is only true when every weight is zero or more; a negative edge can make a longer route cheaper after the node was settled, so the answer would be wrong. Bellman-Ford re-checks every edge several times, so it handles negative weights and detects negative cycles.`,
        fix: { label: "Run Bellman-Ford instead", algo: "bellman-ford" },
      };
    }
  }
  const out: Out =
    algo === "bfs" ? runBfs(g, start)
    : algo === "shortest-bfs" ? runBfs(g, start, tgt)
    : algo === "dfs" ? runDfsStack(g, start)
    : algo === "dfs-recursive" ? runDfsRecursive(g, start)
    : algo === "dijkstra" ? runDijkstra(g, start, tgt)
    : algo === "bellman-ford" ? runBellmanFord(g, start, tgt)
    : algo === "cycle" ? runCycle(g)
    : algo === "components" ? runComponents(g)
    : algo === "scc" ? runScc(g)
    : runTopo(g);
  return { ok: true, algo, frames: out.rec.frames, result: out.result, pseudo: PSEUDO[algo] };
}

// ── Helpers for drawing ──────────────────────────────────────────────────
export type NodeState = "unvisited" | "frontier" | "current" | "visited";

/** What each node looks like in a frame. Order of precedence: current, finished, waiting in the frontier, marked visited. */
export function nodeStates(f: GFrame, ids: string[]): Record<string, NodeState> {
  const waiting = new Set(f.frontier.items.map((i) => i.node));
  const done = new Set(f.done);
  const vis = new Set(f.visited);
  return Object.fromEntries(ids.map((id) => [id, id === f.current ? "current" : done.has(id) ? "visited" : waiting.has(id) ? "frontier" : vis.has(id) ? "visited" : "unvisited"] as const));
}

export interface TableData { head: string[]; rows: { node: string; cells: string[] }[] }

/** The per-node table for a frame: only the columns the running algorithm actually keeps. */
export function tableOf(f: GFrame, ids: string[]): TableData | null {
  const cols: { head: string; get: (n: string) => string }[] = [];
  const numCol = (head: string, r: Record<string, number | null> | undefined, inf = "-") => { if (r) cols.push({ head, get: (n) => (r[n] == null ? inf : num(r[n] as number)) }); };
  if (f.indeg) cols.push({ head: "In-degree", get: (n) => String(f.indeg![n]) });
  numCol("Dist", f.dist, "inf");
  if (f.parent) cols.push({ head: "Parent", get: (n) => f.parent![n] ?? "-" });
  if (f.colour) cols.push({ head: "Colour", get: (n) => f.colour![n] });
  numCol("Disc", f.disc);
  numCol("Fin", f.fin);
  numCol("Index", f.idx);
  numCol("Low", f.low);
  numCol("Comp", f.comp);
  if (!cols.length) return null;
  return { head: cols.map((c) => c.head), rows: ids.map((n) => ({ node: n, cells: cols.map((c) => c.get(n)) })) };
}

/** Short text description of the picture for a frame (the alternative to the drawing). */
export function describeFrame(f: GFrame, ids: string[]): string {
  const st = nodeStates(f, ids);
  const by = (s: NodeState) => ids.filter((n) => st[n] === s);
  const part = (label: string, xs: string[]) => `${label}: ${xs.length ? xs.join(", ") : "none"}.`;
  return [f.text, f.current ? `Current node: ${f.current}.` : "", part("Visited", by("visited")), part("Waiting", by("frontier")), f.frontier.kind !== "none" ? `${f.frontier.title}: ${f.frontier.items.length ? f.frontier.items.map((i) => i.label).join(", ") : "empty"}.` : ""].filter(Boolean).join(" ");
}

// ── Preset graphs ────────────────────────────────────────────────────────
export interface GraphPreset {
  id: string;
  label: string;
  teaches: string;
  directed: boolean;
  text: string;
  coords: Record<string, { x: number; y: number }>;
  algo: AlgoId;
  start: string;
  target?: string;
}

export const PRESETS: GraphPreset[] = [
  {
    id: "tree", label: "Tree-like graph", teaches: "A graph with no cycles. Compare how BFS goes level by level and DFS goes deep.", directed: false, algo: "bfs", start: "A",
    text: "A-B\nA-C\nB-D\nB-E\nC-F\nC-G",
    coords: { A: { x: 230, y: 40 }, B: { x: 120, y: 125 }, C: { x: 340, y: 125 }, D: { x: 60, y: 225 }, E: { x: 180, y: 225 }, F: { x: 290, y: 225 }, G: { x: 400, y: 225 } },
  },
  {
    id: "cycle", label: "Graph with a cycle", teaches: "A directed graph with a loop A > B > C > A and a tail. Three-colour DFS finds the back edge.", directed: true, algo: "cycle", start: "A",
    text: "A->B\nB->C\nC->A\nC->D\nD->E",
    coords: { A: { x: 90, y: 90 }, B: { x: 230, y: 50 }, C: { x: 230, y: 170 }, D: { x: 340, y: 230 }, E: { x: 410, y: 140 } },
  },
  {
    id: "disconnected", label: "Disconnected graph", teaches: "Three separate pieces, one of them a single node. BFS from one node cannot see the others.", directed: false, algo: "components", start: "A",
    text: "A-B\nB-C\nA-C\nD-E\nF",
    coords: { A: { x: 70, y: 80 }, B: { x: 190, y: 50 }, C: { x: 150, y: 190 }, D: { x: 300, y: 90 }, E: { x: 400, y: 150 }, F: { x: 330, y: 240 } },
  },
  {
    id: "roads", label: "Weighted road map", teaches: "Distances between towns. The path with the fewest roads is not always the cheapest.", directed: false, algo: "dijkstra", start: "A", target: "G",
    text: "A-B:4\nA-C:2\nB-C:1\nB-D:5\nC-D:8\nC-E:10\nD-E:2\nD-F:6\nE-G:3\nF-G:1",
    coords: { A: { x: 50, y: 150 }, B: { x: 140, y: 60 }, C: { x: 140, y: 240 }, D: { x: 250, y: 90 }, E: { x: 270, y: 235 }, F: { x: 360, y: 70 }, G: { x: 415, y: 175 } },
  },
  {
    id: "dag", label: "DAG (task order)", teaches: "Tasks with prerequisites. Kahn's algorithm builds a valid order and would report a cycle if there were one.", directed: true, algo: "topo", start: "A",
    text: "A->C\nB->C\nB->D\nC->E\nD->F\nE->F",
    coords: { A: { x: 60, y: 70 }, B: { x: 60, y: 220 }, C: { x: 170, y: 70 }, D: { x: 190, y: 220 }, E: { x: 300, y: 80 }, F: { x: 410, y: 150 } },
  },
  {
    id: "negative", label: "Negative weights", teaches: "A road with a refund (a negative weight). Dijkstra refuses to run; Bellman-Ford handles it.", directed: true, algo: "dijkstra", start: "A", target: "D",
    text: "A->B:4\nA->C:2\nC->B:-3\nB->D:2\nC->D:5",
    coords: { A: { x: 60, y: 150 }, B: { x: 220, y: 50 }, C: { x: 220, y: 250 }, D: { x: 400, y: 150 } },
  },
  {
    id: "negative-cycle", label: "Negative cycle", teaches: "A loop whose total weight is below zero. Going round forever keeps lowering the cost, so no shortest path exists.", directed: true, algo: "bellman-ford", start: "A", target: "D",
    text: "A->B:1\nB->C:-3\nC->B:1\nC->D:2",
    coords: { A: { x: 60, y: 150 }, B: { x: 190, y: 80 }, C: { x: 190, y: 220 }, D: { x: 400, y: 150 } },
  },
  {
    id: "scc", label: "Strongly connected groups", teaches: "Directed graph made of loops joined by one-way links. Tarjan finds each group.", directed: true, algo: "scc", start: "A",
    text: "A->B\nB->C\nC->A\nC->D\nD->E\nE->F\nF->D\nF->G",
    coords: { A: { x: 60, y: 90 }, B: { x: 170, y: 40 }, C: { x: 170, y: 170 }, D: { x: 290, y: 170 }, E: { x: 350, y: 60 }, F: { x: 410, y: 190 }, G: { x: 300, y: 260 } },
  },
];
