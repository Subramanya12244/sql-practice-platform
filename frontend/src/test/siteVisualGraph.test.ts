// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ALGORITHMS, MAX_EDGES, MAX_NODES, PRESETS, PSEUDO, adjacency, buildGraph, describeFrame, layoutCircle, nodeIds, nodeStates, parseEdgeText, runAlgorithm, tableOf, weightOf,
  type AlgoId, type GFrame, type Graph, type RunResult,
} from "../site/lib/visual/graph";

// ── deterministic helpers ────────────────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NAMES = "ABCDEFGHIJKL".split("");
type Wt = "none" | "pos" | "neg";

/** Random graph written as edge-list text and built through the real parser. */
function randomGraph(seed: number, directed: boolean, wt: Wt, maxN = 8): Graph {
  const r = rng(seed);
  const n = 2 + Math.floor(r() * (maxN - 1));
  const p = 0.12 + r() * 0.3;
  const lines: string[] = NAMES.slice(0, n).map((x) => x);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || (!directed && j < i)) continue;
      if (r() >= p || lines.length - n >= MAX_EDGES) continue;
      const w = wt === "none" ? "" : wt === "pos" ? `:${1 + Math.floor(r() * 9)}` : `:${Math.floor(r() * 11) - 3}`;
      lines.push(`${NAMES[i]}-${NAMES[j]}${w}`);
    }
  }
  const b = buildGraph(lines.join("\n"), directed);
  if (!b.ok) throw new Error(b.errors.join("; "));
  return b.graph;
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const ok = (r: RunResult) => { if (!r.ok) throw new Error(r.message); return r; };

/** Arcs as a test would write them, independent of the library. */
function arcs(g: Graph) {
  const out: { u: string; v: string; w: number }[] = [];
  for (const e of g.edges) { out.push({ u: e.from, v: e.to, w: e.w ?? 1 }); if (!g.directed) out.push({ u: e.to, v: e.from, w: e.w ?? 1 }); }
  return out;
}
/** Floyd-Warshall, an independent all-pairs reference. */
function floyd(g: Graph, cost: (w: number) => number) {
  const ids = nodeIds(g);
  const d: Record<string, Record<string, number>> = {};
  for (const a of ids) { d[a] = {}; for (const b of ids) d[a][b] = a === b ? 0 : Infinity; }
  for (const x of arcs(g)) d[x.u][x.v] = Math.min(d[x.u][x.v], cost(x.w));
  for (const k of ids) for (const i of ids) for (const j of ids) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  return d;
}
/** reach[a][b]: b can be reached from a by one or more edges. */
function reach(g: Graph) {
  const ids = nodeIds(g);
  const r: Record<string, Record<string, boolean>> = {};
  for (const a of ids) { r[a] = {}; for (const b of ids) r[a][b] = false; }
  for (const x of arcs(g)) r[x.u][x.v] = true;
  for (const k of ids) for (const i of ids) for (const j of ids) if (r[i][k] && r[k][j]) r[i][j] = true;
  return r;
}
const sameSets = (a: string[][], b: string[][]) => {
  const norm = (x: string[][]) => x.map((g) => [...g].sort().join("")).sort();
  expect(norm(a)).toEqual(norm(b));
};

const SEEDS = range(60);

// ── parsing ──────────────────────────────────────────────────────────────
describe("edge list parsing", () => {
  it("parses edges, weights, isolated nodes and comments in first-seen order", () => {
    const p = parseEdgeText("# roads\nA-B:3\nB->C:-2\nD\n\nA--E", true);
    expect(p).toEqual({ ok: true, names: ["A", "B", "C", "D", "E"], edges: [{ from: "A", to: "B", w: 3 }, { from: "B", to: "C", w: -2 }, { from: "A", to: "E" }] });
  });
  it("reports clear errors with line numbers", () => {
    const bad = (t: string, d = false) => { const p = parseEdgeText(t, d); if (p.ok) throw new Error("should fail"); return p.errors.join(" | "); };
    expect(bad("A-B\nA B C")).toMatch(/Line 2: "A B C" is not an edge/);
    expect(bad("A-B:x")).toMatch(/Line 1: the weight "x" is not a number/);
    expect(bad("A-B:5000")).toMatch(/too large/);
    expect(bad("A-B\nB-A")).toMatch(/Line 2: the edge B-A is already listed/);
    expect(bad("A-A")).toMatch(/self-loop/);
    expect(bad("LONGERTHAN8-B")).toMatch(/at most 8 characters/);
    expect(bad("   \n# nothing")).toMatch(/at least one node/);
    expect(parseEdgeText("A-B\nB-A", true).ok).toBe(true); // both directions are distinct directed edges
  });
  it("allows a self-loop only in a directed graph", () => {
    expect(parseEdgeText("A->A", true).ok).toBe(true);
    expect(parseEdgeText("A->A", false).ok).toBe(false);
  });
  it("limits the number of nodes and edges", () => {
    const many = range(MAX_NODES + 1).map((i) => `N${i}`).map((n, i, a) => (i ? `${a[i - 1]}-${n}` : n)).join("\n");
    const p = parseEdgeText(many, false);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join(" ")).toContain(`limit is ${MAX_NODES}`);
    expect(parseEdgeText(NAMES.slice(0, MAX_NODES).map((n, i, a) => (i ? `${a[i - 1]}-${n}` : n)).join("\n"), false).ok).toBe(true);
    const dense = NAMES.flatMap((a, i) => NAMES.slice(i + 1).map((b) => `${a}-${b}`)).slice(0, MAX_EDGES + 1).join("\n");
    const q = parseEdgeText(dense, false);
    expect(q.ok).toBe(false);
  });
  it("lays out deterministically and only uses preset coordinates when they cover every node", () => {
    expect(layoutCircle(["A", "B", "C"])).toEqual(layoutCircle(["A", "B", "C"]));
    const coords = { A: { x: 1, y: 2 }, B: { x: 3, y: 4 } };
    const covered = buildGraph("A-B", false, coords);
    expect(covered.ok && covered.graph.nodes.map((n) => [n.x, n.y])).toEqual([[1, 2], [3, 4]]);
    const partial = buildGraph("A-B\nB-C", false, coords);
    expect(partial.ok && partial.graph.nodes[0].x).not.toBe(1); // C has no coordinate, so everything falls back to the circle
  });
});

// ── presets ──────────────────────────────────────────────────────────────
describe("preset graphs", () => {
  it("have unique ids, cover the required teaching graphs and build with their own coordinates", () => {
    const idsList = PRESETS.map((p) => p.id);
    expect(new Set(idsList).size).toBe(idsList.length);
    for (const id of ["tree", "cycle", "disconnected", "roads", "dag", "negative"]) expect(idsList).toContain(id);
    for (const p of PRESETS) {
      expect(p.label.length).toBeGreaterThan(3);
      const b = buildGraph(p.text, p.directed, p.coords);
      expect(b.ok, p.id).toBe(true);
      if (!b.ok) continue;
      for (const n of b.graph.nodes) expect(n, `${p.id} ${n.id}`).toMatchObject(p.coords[n.id]);
      expect(nodeIds(b.graph)).toContain(p.start);
      if (p.target) expect(nodeIds(b.graph)).toContain(p.target);
      expect(ALGORITHMS.map((a) => a.id)).toContain(p.algo);
    }
  });
  it("every preset runs with its suggested algorithm, except the negative-weight Dijkstra demo which is refused on purpose", () => {
    for (const p of PRESETS) {
      const b = buildGraph(p.text, p.directed, p.coords);
      if (!b.ok) throw new Error(p.id);
      const r = runAlgorithm(b.graph, p.algo, p.start, p.target);
      if (p.id === "negative") { expect(r.ok).toBe(false); continue; }
      expect(r.ok, p.id).toBe(true);
    }
  });
  const preset = (id: string) => { const p = PRESETS.find((x) => x.id === id)!; const b = buildGraph(p.text, p.directed, p.coords); if (!b.ok) throw new Error(id); return { g: b.graph, p }; };
  it("give the known answers", () => {
    const tree = preset("tree").g;
    const bfs = ok(runAlgorithm(tree, "bfs", "A"));
    expect(bfs.frames.at(-1)!.visited).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(ok(runAlgorithm(tree, "dfs", "A")).frames.at(-1)!.visited).toEqual(["A", "B", "D", "E", "C", "F", "G"]);
    const roads = preset("roads").g;
    const d = ok(runAlgorithm(roads, "dijkstra", "A", "G"));
    expect(d.result).toMatchObject({ kind: "path", nodes: ["A", "C", "B", "D", "E", "G"] });
    expect(d.result.lines[0]).toContain("cost 13");
    const h = ok(runAlgorithm(roads, "shortest-bfs", "A", "G"));
    expect(h.result.nodes).toHaveLength(4); // fewest roads: 3 hops, even though it costs 15
    expect(h.result.lines[0]).toContain("3 hops");
    expect(ok(runAlgorithm(preset("dag").g, "topo", "A")).result).toMatchObject({ kind: "topo", nodes: ["A", "B", "C", "D", "E", "F"] });
    const cyc = ok(runAlgorithm(preset("cycle").g, "cycle", "A"));
    expect(cyc.result).toMatchObject({ kind: "cycle", nodes: ["A", "B", "C"], edges: [0, 1, 2] });
    sameSets(ok(runAlgorithm(preset("disconnected").g, "components", "A")).result.groups!, [["A", "B", "C"], ["D", "E"], ["F"]]);
    sameSets(ok(runAlgorithm(preset("scc").g, "scc", "A")).result.groups!, [["A", "B", "C"], ["D", "E", "F"], ["G"]]);
    const neg = ok(runAlgorithm(preset("negative").g, "bellman-ford", "A", "D"));
    expect(neg.result).toMatchObject({ kind: "path", nodes: ["A", "C", "B", "D"] });
    expect(neg.result.lines[0]).toContain("cost 1");
    const nc = ok(runAlgorithm(preset("negative-cycle").g, "bellman-ford", "A", "D"));
    expect(nc.result.kind).toBe("negative-cycle");
    expect([...nc.result.nodes!].sort()).toEqual(["B", "C"]);
  });
  it("undirected cycle detection names the edge that closes the cycle", () => {
    const g = buildGraph("A-B\nB-C\nC-A\nC-D", false);
    if (!g.ok) throw new Error();
    const r = ok(runAlgorithm(g.graph, "cycle", "A"));
    expect(r.result.kind).toBe("cycle");
    expect([...r.result.nodes!].sort()).toEqual(["A", "B", "C"]);
    const closing = g.graph.edges[r.result.edges!.at(-1)!];
    expect([closing.from, closing.to].sort()).toEqual(["A", "C"]);
    // the walk back along the edge we arrived by is not mistaken for a cycle
    const line = buildGraph("A-B\nB-C", false);
    if (!line.ok) throw new Error();
    expect(ok(runAlgorithm(line.graph, "cycle", "A")).result.kind).toBe("acyclic");
  });
});

// ── refusing and explaining ──────────────────────────────────────────────
describe("refusals", () => {
  it("Dijkstra refuses a negative weight, explains why and offers Bellman-Ford", () => {
    const g = buildGraph("A->B:4\nA->C:2\nC->B:-3", true);
    if (!g.ok) throw new Error();
    const r = runAlgorithm(g.graph, "dijkstra", "A", "B");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("C->B has weight -3");
    expect(r.message).toMatch(/first time it leaves the priority queue/);
    expect(r.message).toMatch(/Bellman-Ford/);
    expect(r.fix).toMatchObject({ algo: "bellman-ford" });
  });
  it("topological sort and SCC need a directed graph, and offer to switch", () => {
    const g = buildGraph("A-B\nB-C", false);
    if (!g.ok) throw new Error();
    for (const a of ["topo", "scc"] as const) {
      const r = runAlgorithm(g.graph, a, "A");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fix).toEqual({ label: "Make the graph directed", directed: true });
    }
  });
  it("rejects an unknown start or target node", () => {
    const g = buildGraph("A-B", false);
    if (!g.ok) throw new Error();
    expect(runAlgorithm(g.graph, "bfs", "Z").ok).toBe(false);
    expect(runAlgorithm(g.graph, "shortest-bfs", "A", "Z").ok).toBe(false);
  });
  it("BFS says plainly that it ignores weights", () => {
    const roads = PRESETS.find((p) => p.id === "roads")!;
    const g = buildGraph(roads.text, false, roads.coords);
    if (!g.ok) throw new Error();
    expect(ok(runAlgorithm(g.graph, "shortest-bfs", "A", "G")).frames[0].text).toMatch(/ignores them/);
  });
});

// ── correctness against brute force on pseudo-random graphs ──────────────
describe("algorithms agree with independent references", () => {
  it("BFS distances equal Floyd-Warshall hop counts, for directed and undirected graphs", () => {
    for (const seed of SEEDS) for (const directed of [false, true]) {
      const g = randomGraph(seed, directed, "none");
      const ref = floyd(g, () => 1);
      const f = ok(runAlgorithm(g, "bfs", "A")).frames.at(-1)!;
      for (const n of nodeIds(g)) expect(f.dist![n] ?? Infinity, `${seed} ${directed} ${n}`).toBe(ref.A[n]);
    }
  });
  it("BFS shortest path is a real path of the shortest length (or reports none)", () => {
    for (const seed of SEEDS) {
      const g = randomGraph(seed, seed % 2 === 0, "none");
      const ref = floyd(g, () => 1);
      for (const t of nodeIds(g)) {
        const r = ok(runAlgorithm(g, "shortest-bfs", "A", t)).result;
        if (ref.A[t] === Infinity) { expect(r.kind).toBe("none"); continue; }
        expect(r.nodes!.length - 1).toBe(ref.A[t]);
        expect(r.nodes![0]).toBe("A"); expect(r.nodes!.at(-1)).toBe(t);
        const arcsSet = new Set(arcs(g).map((x) => `${x.u}>${x.v}`));
        r.nodes!.slice(1).forEach((v, i) => expect(arcsSet.has(`${r.nodes![i]}>${v}`)).toBe(true));
      }
    }
  });
  it("Dijkstra, Bellman-Ford and Floyd-Warshall agree on non-negative graphs", () => {
    for (const seed of SEEDS) for (const directed of [false, true]) {
      const g = randomGraph(seed + 1000, directed, "pos");
      const ref = floyd(g, (w) => w);
      const dj = ok(runAlgorithm(g, "dijkstra", "A")).frames.at(-1)!;
      const bf = ok(runAlgorithm(g, "bellman-ford", "A")).frames.at(-1)!;
      for (const n of nodeIds(g)) {
        expect(dj.dist![n] ?? Infinity, `dj ${seed} ${n}`).toBe(ref.A[n]);
        expect(bf.dist![n] ?? Infinity, `bf ${seed} ${n}`).toBe(ref.A[n]);
      }
    }
  });
  it("Dijkstra and Bellman-Ford return a path whose cost matches the reference", () => {
    for (const seed of SEEDS) {
      const g = randomGraph(seed + 2000, true, "pos");
      const ref = floyd(g, (w) => w);
      for (const t of nodeIds(g)) for (const a of ["dijkstra", "bellman-ford"] as const) {
        const r = ok(runAlgorithm(g, a, "A", t)).result;
        if (ref.A[t] === Infinity) { expect(r.kind).toBe("none"); continue; }
        expect(r.kind).toBe("path");
        const cost = r.edges!.reduce((s, e) => s + weightOf(g.edges[e]), 0);
        expect(cost).toBe(ref.A[t]);
        expect(r.nodes![0]).toBe("A"); expect(r.nodes!.at(-1)).toBe(t);
      }
    }
  });
  it("Bellman-Ford finds shortest paths with negative edges when no negative cycle is reachable, and flags the negative cycle otherwise", () => {
    let withCycle = 0, without = 0;
    for (const seed of SEEDS) for (const directed of [false, true]) {
      const g = randomGraph(seed + 3000, directed, "neg");
      const ref = floyd(g, (w) => w);
      const ids = nodeIds(g);
      const reachable = ids.filter((n) => ref.A[n] < Infinity || n === "A");
      // A negative cycle reachable from A shows up as a node reachable from A with a negative distance to itself.
      const hasNeg = reachable.some((n) => ref[n][n] < 0);
      const r = ok(runAlgorithm(g, "bellman-ford", "A"));
      if (hasNeg) {
        withCycle++;
        expect(r.result.kind, `${seed} ${directed}`).toBe("negative-cycle");
        // the reported cycle is a real cycle with negative total weight
        const cyc = r.result.nodes!;
        const arcSet = arcs(g);
        let total = 0;
        cyc.forEach((u, i) => {
          const v = cyc[(i + 1) % cyc.length];
          const best = Math.min(...arcSet.filter((x) => x.u === u && x.v === v).map((x) => x.w));
          expect(best, `${u}>${v} must be an arc`).toBeLessThan(Infinity);
          total += best;
        });
        expect(total).toBeLessThan(0);
      } else {
        without++;
        expect(r.result.kind).toBe("distances");
        const f = r.frames.at(-1)!;
        for (const n of ids) expect(f.dist![n] ?? Infinity, `${seed} ${n}`).toBe(ref.A[n]);
      }
    }
    expect(withCycle).toBeGreaterThan(5); // the generator really exercises both outcomes
    expect(without).toBeGreaterThan(5);
  });
  it("cycle detection matches a brute-force check for directed and undirected graphs", () => {
    let cyc = 0, acyc = 0;
    for (const seed of SEEDS) for (const directed of [false, true]) {
      const g = randomGraph(seed + 4000, directed, "none");
      const ids = nodeIds(g);
      let expected: boolean;
      if (directed) { const r = reach(g); expected = ids.some((n) => r[n][n]); }
      else {
        // a simple undirected graph is a forest exactly when edges = nodes - components
        const r = reach(g);
        const comps = new Set(ids.map((n) => ids.filter((m) => m === n || r[n][m]).sort().join(""))).size;
        expected = g.edges.length > ids.length - comps;
      }
      const res = ok(runAlgorithm(g, "cycle", "A")).result;
      expect(res.kind === "cycle", `${seed} ${directed}`).toBe(expected);
      expected ? cyc++ : acyc++;
      if (expected) {
        const nodes = res.nodes!;
        const set = new Set(arcs(g).map((x) => `${x.u}>${x.v}`));
        nodes.forEach((u, i) => expect(set.has(`${u}>${nodes[(i + 1) % nodes.length]}`), `cycle edge ${u}`).toBe(true));
        expect(new Set(nodes).size).toBe(nodes.length);
        if (!directed) expect(nodes.length).toBeGreaterThanOrEqual(3);
      }
    }
    expect(cyc).toBeGreaterThan(10); expect(acyc).toBeGreaterThan(10);
  });
  it("connected components match the transitive closure", () => {
    for (const seed of SEEDS) for (const directed of [false, true]) {
      const g = randomGraph(seed + 5000, directed, "none", 10);
      const ids = nodeIds(g);
      const sym: Graph = { ...g, directed: false };
      const r = reach(sym);
      const expected = [...new Set(ids.map((n) => ids.filter((m) => m === n || r[n][m]).join("")))].map((s) => s.split(""));
      sameSets(ok(runAlgorithm(g, "components", "A")).result.groups!, expected);
    }
  });
  it("strongly connected components match mutual reachability", () => {
    for (const seed of SEEDS) {
      const g = randomGraph(seed + 6000, true, "none", 9);
      const ids = nodeIds(g);
      const r = reach(g);
      const expected = [...new Set(ids.map((n) => ids.filter((m) => m === n || (r[n][m] && r[m][n])).join("")))].map((s) => s.split(""));
      const got = ok(runAlgorithm(g, "scc", "A")).result.groups!;
      sameSets(got, expected);
      expect(got.flat().sort()).toEqual([...ids].sort());
    }
  });
  it("topological sort gives a valid order for a DAG and reports a cycle otherwise", () => {
    let dag = 0, cyc = 0;
    for (const seed of SEEDS) for (const dense of [0, 1]) {
      const g = randomGraph(seed + 7000 + dense * 100, true, "none");
      const r = reach(g);
      const isDag = !nodeIds(g).some((n) => r[n][n]);
      const res = ok(runAlgorithm(g, "topo", "A")).result;
      if (isDag) {
        dag++;
        expect(res.kind).toBe("topo");
        const pos = new Map(res.nodes!.map((n, i) => [n, i]));
        expect(pos.size).toBe(nodeIds(g).length);
        for (const e of g.edges) expect(pos.get(e.from)!, `${e.from}>${e.to}`).toBeLessThan(pos.get(e.to)!);
      } else {
        cyc++;
        expect(res.kind).toBe("topo-cycle");
        expect(res.lines.join(" ")).toMatch(/no topological order/i);
      }
    }
    expect(dag).toBeGreaterThan(10); expect(cyc).toBeGreaterThan(10);
  });
  it("iterative and recursive DFS visit nodes in the same order, and BFS visits exactly the reachable set", () => {
    for (const seed of SEEDS) for (const directed of [false, true]) {
      const g = randomGraph(seed + 8000, directed, "none");
      const a = ok(runAlgorithm(g, "dfs", "A")).frames.at(-1)!.visited;
      const b = ok(runAlgorithm(g, "dfs-recursive", "A")).frames.at(-1)!.visited;
      expect(a, `${seed} ${directed}`).toEqual(b);
      const bfs = ok(runAlgorithm(g, "bfs", "A")).frames.at(-1)!.visited;
      expect([...bfs].sort()).toEqual([...a].sort());
      const r = reach(g);
      expect([...a].sort()).toEqual(nodeIds(g).filter((n) => n === "A" || r.A[n]).sort());
    }
  });
});

// ── frames really are the execution ──────────────────────────────────────
const ALL_RUNS: { name: string; g: Graph; algo: AlgoId; target?: string }[] = [];
for (const seed of range(24)) {
  const d = seed % 2 === 0;
  const plain = randomGraph(seed + 9000, d, "none");
  const pos = randomGraph(seed + 9100, d, "pos");
  const neg = randomGraph(seed + 9200, d, "neg");
  for (const a of ["bfs", "dfs", "dfs-recursive", "cycle", "components"] as const) ALL_RUNS.push({ name: `${a}#${seed}`, g: plain, algo: a });
  ALL_RUNS.push({ name: `shortest-bfs#${seed}`, g: plain, algo: "shortest-bfs", target: nodeIds(plain).at(-1) });
  ALL_RUNS.push({ name: `dijkstra#${seed}`, g: pos, algo: "dijkstra", target: seed % 3 ? nodeIds(pos).at(-1) : undefined });
  ALL_RUNS.push({ name: `bellman#${seed}`, g: neg, algo: "bellman-ford", target: seed % 3 ? nodeIds(neg).at(-1) : undefined });
  if (d) for (const a of ["scc", "topo"] as const) ALL_RUNS.push({ name: `${a}#${seed}`, g: plain, algo: a });
}

describe("frames are consistent snapshots of a real run", () => {
  it("only reference existing nodes, edges and pseudo-code lines, and only the last frame has a result", () => {
    for (const run of ALL_RUNS) {
      const r = runAlgorithm(run.g, run.algo, "A", run.target);
      if (!r.ok) throw new Error(`${run.name}: ${r.message}`);
      const ids = new Set(nodeIds(run.g));
      const has = (n: unknown) => typeof n === "string" && ids.has(n);
      expect(r.frames.length, run.name).toBeGreaterThan(1);
      r.frames.forEach((f, i) => {
        const at = `${run.name} frame ${i}`;
        expect(f.text.length, at).toBeGreaterThan(5);
        expect(f.line, at).toBeGreaterThanOrEqual(0);
        expect(f.line, at).toBeLessThan(PSEUDO[run.algo].length);
        if (f.current !== undefined) expect(has(f.current), at).toBe(true);
        if (f.edge !== undefined) { expect(f.edge, at).toBeGreaterThanOrEqual(0); expect(f.edge, at).toBeLessThan(run.g.edges.length); }
        if (f.edgeFrom !== undefined) { const e = run.g.edges[f.edge!]; expect([e.from, e.to], at).toContain(f.edgeFrom); }
        f.visited.forEach((n) => expect(has(n), at).toBe(true));
        f.done.forEach((n) => expect(has(n), at).toBe(true));
        expect(new Set(f.visited).size, `${at} visited has no repeats`).toBe(f.visited.length);
        f.frontier.items.forEach((it) => expect(has(it.node), at).toBe(true));
        for (const rec of [f.dist, f.parent, f.colour, f.disc, f.fin, f.idx, f.low, f.indeg, f.comp]) if (rec) expect(Object.keys(rec).sort(), at).toEqual([...ids].sort());
        if (f.parent) Object.values(f.parent).forEach((p) => { if (p !== null) expect(has(p), at).toBe(true); });
        f.hlNodes?.forEach((n) => expect(has(n), at).toBe(true));
        f.hlEdges?.forEach((e) => expect(e < run.g.edges.length && e >= 0, at).toBe(true));
        f.groups?.flat().forEach((n) => expect(has(n), at).toBe(true));
        f.order?.forEach((n) => expect(has(n), at).toBe(true));
        if (i < r.frames.length - 1) expect(f.result, at).toBeUndefined(); else expect(f.result, at).toEqual(r.result);
        expect(describeFrame(f, nodeIds(run.g)), at).toContain(f.text);
      });
    }
  });
  it("frames are independent copies: nothing a later step does changes an earlier frame", () => {
    const g = randomGraph(3, false, "none");
    const r = ok(runAlgorithm(g, "bfs", "A"));
    const first = r.frames[0];
    expect(first.visited).toEqual(["A"]);
    expect(first.frontier.items.map((i) => i.node)).toEqual(["A"]);
    expect(r.frames.at(-1)!.visited.length).toBeGreaterThanOrEqual(1);
    expect(r.frames[0].visited).not.toBe(r.frames[1].visited);
  });
  it("BFS queue contents follow FIFO order frame by frame", () => {
    for (const seed of range(30)) {
      const g = randomGraph(seed + 100, seed % 2 === 0, "none");
      const fr = ok(runAlgorithm(g, "bfs", "A")).frames;
      const q = (f: GFrame) => f.frontier.items.map((i) => i.node);
      const dequeued: string[] = [];
      fr.forEach((f, i) => {
        if (i === 0) return;
        const prev = q(fr[i - 1]);
        if (f.line === 3) { expect(f.current, `${seed}#${i}`).toBe(prev[0]); expect(q(f)).toEqual(prev.slice(1)); dequeued.push(f.current!); }
        if (f.line === 6) { expect(q(f).slice(0, -1), `${seed}#${i}`).toEqual(prev); expect(prev).not.toContain(q(f).at(-1)); }
        if (f.line === 4 || f.line === 5 || f.line === 2) expect(q(f)).toEqual(prev);
      });
      // order of dequeuing equals order of marking visited, and distances never decrease along it (that is what BFS guarantees)
      const last = fr.at(-1)!;
      expect(dequeued).toEqual(last.visited);
      const d = dequeued.map((n) => last.dist![n]!);
      expect(d).toEqual([...d].sort((a, b) => a - b));
    }
  });
  it("DFS stack contents follow LIFO order frame by frame", () => {
    for (const seed of range(30)) {
      const g = randomGraph(seed + 200, seed % 2 === 0, "none");
      const fr = ok(runAlgorithm(g, "dfs", "A")).frames;
      const s = (f: GFrame) => f.frontier.items.map((i) => i.node);
      fr.forEach((f, i) => {
        if (i === 0) return;
        const prev = s(fr[i - 1]);
        if (f.line === 3) { expect(f.current, `${seed}#${i}`).toBe(prev.at(-1)); expect(s(f)).toEqual(prev.slice(0, -1)); }
        if (f.line === 7 && s(f).length > prev.length) { expect(s(f).slice(0, -1)).toEqual(prev); const e = g.edges[f.edge!]; expect(s(f).at(-1)).toBe(f.edgeFrom === e.from ? e.to : e.from); }
      });
    }
  });
  it("recursive DFS call stack grows and shrinks like real recursion, and edge types are consistent", () => {
    for (const seed of range(30)) {
      const g = randomGraph(seed + 300, true, "none");
      const fr = ok(runAlgorithm(g, "dfs-recursive", "A")).frames;
      const depth = fr.map((f) => f.frontier.items.length);
      expect(depth[0]).toBe(1);
      for (let i = 1; i < depth.length; i++) expect(Math.abs(depth[i] - depth[i - 1])).toBeLessThanOrEqual(1);
      const last = fr.at(-1)!;
      expect(last.frontier.items).toEqual([]);
      const arcsOf = adjacency(g);
      // every examined edge got a type, and a back edge always points to an ancestor (smaller disc, larger fin)
      for (const [e, kind] of Object.entries(last.edgeKinds!)) {
        const edge = g.edges[Number(e)];
        const u = last.disc![edge.from]!, v = last.disc![edge.to]!;
        if (kind === "back") expect(v).toBeLessThanOrEqual(u);
        if (kind === "tree" || kind === "forward") expect(v).toBeGreaterThanOrEqual(u);
        if (kind === "cross") expect(v).toBeLessThan(u);
      }
      for (const n of last.visited) for (const a of arcsOf.get(n)!) expect(last.edgeKinds![a.edge]).toBeDefined();
      for (const n of last.visited) { expect(last.disc![n]).toBeLessThan(last.fin![n]!); expect(last.colour![n]).toBe("black"); }
    }
  });
  it("the Dijkstra priority queue pops in sorted order and settles nodes by non-decreasing distance", () => {
    for (const seed of range(30)) {
      const g = randomGraph(seed + 400, seed % 2 === 0, "pos");
      const fr = ok(runAlgorithm(g, "dijkstra", "A")).frames;
      const label = (f: GFrame) => f.frontier.items.map((i) => i.label);
      const parse = (l: string) => Number(l.split(":")[1]);
      const settledDist: number[] = [];
      fr.forEach((f, i) => {
        const items = label(f).map(parse);
        expect(items, `${seed}#${i} queue sorted`).toEqual([...items].sort((a, b) => a - b));
        if (i > 0 && f.line === 2) { expect(f.current).toBe(label(fr[i - 1])[0].split(":")[0]); expect(label(f)).toEqual(label(fr[i - 1]).slice(1)); }
        if (f.line === 1 && f.current) settledDist.push(f.dist![f.current]!);
      });
      expect(settledDist).toEqual([...settledDist].sort((a, b) => a - b));
      const last = fr.at(-1)!;
      expect(new Set(last.done).size).toBe(last.done.length); // a node is settled once
    }
  });
  it("Kahn's in-degree table always equals in-degrees recomputed from the edges not yet removed", () => {
    for (const seed of range(30)) {
      const g = randomGraph(seed + 500, true, "none");
      const fr = ok(runAlgorithm(g, "topo", "A")).frames;
      const base: Record<string, number> = Object.fromEntries(nodeIds(g).map((n) => [n, 0]));
      for (const e of g.edges) base[e.to]++;
      expect(fr[0].indeg).toEqual(base);
      for (const f of fr) {
        // At rest (after the initial queue is built, and at the end) the table is exactly the base degrees minus edges leaving placed nodes.
        if (f.line !== 1 && f.line !== 5) continue;
        const placed = new Set(f.order);
        const expected = { ...base };
        for (const e of g.edges) if (placed.has(e.from)) expected[e.to]--;
        expect(f.indeg, `${seed} line ${f.line}`).toEqual(expected);
      }
      for (let i = 1; i < fr.length; i++) for (const n of nodeIds(g)) expect(fr[i].indeg![n]).toBeLessThanOrEqual(fr[i - 1].indeg![n]);
    }
  });
  it("Bellman-Ford distances never increase between frames", () => {
    for (const seed of range(30)) {
      const g = randomGraph(seed + 600, true, "neg");
      const fr = ok(runAlgorithm(g, "bellman-ford", "A")).frames;
      for (let i = 1; i < fr.length; i++) for (const n of nodeIds(g)) {
        const a = fr[i - 1].dist![n], b = fr[i].dist![n];
        if (a !== null) expect(b).not.toBeNull();
        if (a !== null && b !== null) expect(b).toBeLessThanOrEqual(a);
      }
    }
  });
  it("Tarjan stack only holds nodes with an index and finishes empty", () => {
    for (const seed of range(30)) {
      const g = randomGraph(seed + 700, true, "none");
      const fr = ok(runAlgorithm(g, "scc", "A")).frames;
      for (const f of fr) for (const it of f.frontier.items) expect(f.idx![it.node]).not.toBeNull();
      expect(fr.at(-1)!.frontier.items).toEqual([]);
    }
  });
});

describe("drawing helpers", () => {
  it("nodeStates ranks current over visited over waiting over unvisited", () => {
    const g = randomGraph(1, false, "none");
    const fr = ok(runAlgorithm(g, "bfs", "A")).frames;
    const ids = nodeIds(g);
    const second = fr.find((f) => f.line === 3)!;
    const st = nodeStates(second, ids);
    expect(st.A).toBe("current");
    expect(Object.values(nodeStates(fr.at(-1)!, ids)).filter((s) => s === "visited").length).toBe(fr.at(-1)!.visited.length);
    expect(Object.values(st).every((s) => ["unvisited", "frontier", "current", "visited"].includes(s))).toBe(true);
  });
  it("tableOf only shows columns the algorithm keeps", () => {
    const g = randomGraph(2, true, "pos");
    const ids = nodeIds(g);
    const dj = tableOf(ok(runAlgorithm(g, "dijkstra", "A")).frames[0], ids)!;
    expect(dj.head).toEqual(["Dist", "Parent"]);
    expect(dj.rows[0].cells).toEqual(["0", "-"]);
    expect(dj.rows[1].cells[0]).toBe("inf");
    expect(tableOf(ok(runAlgorithm(g, "topo", "A")).frames[0], ids)!.head).toEqual(["In-degree"]);
    expect(tableOf(ok(runAlgorithm(g, "dfs-recursive", "A")).frames[0], ids)!.head).toEqual(["Parent", "Colour", "Disc", "Fin"]);
    expect(tableOf(ok(runAlgorithm(g, "scc", "A")).frames[0], ids)!.head).toEqual(["Index", "Low", "Comp"]);
  });
  it("has pseudo-code for every algorithm and an entry in the algorithm list", () => {
    for (const a of ALGORITHMS) { expect(PSEUDO[a.id].length).toBeGreaterThan(4); expect(a.label.length).toBeGreaterThan(5); }
    expect(Object.keys(PSEUDO).sort()).toEqual(ALGORITHMS.map((a) => a.id).sort());
  });
});
