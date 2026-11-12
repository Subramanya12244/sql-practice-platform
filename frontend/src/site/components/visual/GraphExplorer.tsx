import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { useReducedMotion } from "../../lib/visual/motion";
import {
  ALGORITHMS, MAX_EDGES, MAX_NODES, PRESETS, buildGraph, describeFrame, nodeIds, nodeStates, runAlgorithm, tableOf,
  type AlgoId, type EdgeKind, type GFrame, type GResult, type NodeState,
} from "../../lib/visual/graph";

const R = 18;
const VIEWBOX = "0 -24 460 332";
const sel = "rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink";
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

export interface DiagramNode { id: string; x: number; y: number; /** Text inside the node when it differs from the id (for example a value in a linked list). */ label?: string }
export interface DiagramEdge { from: string; to: string; w?: number }

export interface GraphDiagramProps {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  directed?: boolean;
  /** Nodes drawn with an extra ring (a path, a cycle, or whatever the caller wants to point at). */
  highlight?: Iterable<string>;
  /** Indexes into `edges` drawn thick. */
  highlightEdges?: Iterable<number>;
  /** Ring and thick-edge colour: green for "found", red for "problem". */
  tone?: "success" | "danger";
  /** Per-node state; shape and a mark change as well as colour. Nodes not listed are drawn as unvisited. */
  states?: Record<string, NodeState>;
  /** Small text under a node, for example a distance. */
  badges?: Record<string, string>;
  /** Edge being examined (index into `edges`). */
  activeEdge?: number;
  edgeKinds?: Record<number, EdgeKind>;
  /** Accessible name of the picture. */
  label?: string;
  className?: string;
}

type Pt = { x: number; y: number };
const unit = (a: Pt, b: Pt): Pt => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };

/** Path and label position for one edge. Opposite directed edges bend apart; a self-loop is drawn above its node. */
function geometry(a: Pt, b: Pt, bend: boolean, self: boolean, directed: boolean) {
  const gap = directed ? 5 : 0;
  if (self) {
    return { d: `M ${a.x - 9} ${a.y - R + 2} C ${a.x - 34} ${a.y - R - 40} ${a.x + 34} ${a.y - R - 40} ${a.x + 9} ${a.y - R + 2}`, mid: { x: a.x, y: a.y - R - 30 } };
  }
  if (bend) {
    const u = unit(a, b);
    const c = { x: (a.x + b.x) / 2 - u.y * 34, y: (a.y + b.y) / 2 + u.x * 34 };
    const s0 = unit(a, c), e0 = unit(b, c);
    const s = { x: a.x + s0.x * R, y: a.y + s0.y * R }, e = { x: b.x + e0.x * (R + gap), y: b.y + e0.y * (R + gap) };
    return { d: `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${e.x} ${e.y}`, mid: { x: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y } };
  }
  const u = unit(a, b);
  const s = { x: a.x + u.x * R, y: a.y + u.y * R }, e = { x: b.x - u.x * (R + gap), y: b.y - u.y * (R + gap) };
  return { d: `M ${s.x} ${s.y} L ${e.x} ${e.y}`, mid: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 } };
}

const KIND_MARK: Record<EdgeKind, string> = { tree: "T", back: "B", forward: "F", cross: "C" };
const STATE_WORD: Record<NodeState, string> = { unvisited: "not visited", frontier: "waiting", current: "current", visited: "visited" };

/**
 * Reusable SVG graph drawing: arrows for directed edges, weights on edges, and node state shown by shape and mark as well as colour
 * (plain circle = not visited, dashed ring = waiting, double ring with a play mark = current, filled with a tick = visited).
 * It only draws; coordinates come from the caller, so the Python Time Machine can reuse it for linked structures.
 */
export function GraphDiagram({ nodes, edges, directed = false, highlight, highlightEdges, tone = "success", states, badges, activeEdge, edgeKinds, label, className }: GraphDiagramProps) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const at = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const hlN = useMemo(() => new Set(highlight ?? []), [highlight]);
  const hlE = useMemo(() => new Set(highlightEdges ?? []), [highlightEdges]);
  const ring = tone === "danger" ? "stroke-danger" : "stroke-success";
  const move = reduced ? "" : "transition-[stroke,fill,stroke-width] duration-200";
  return (
    <svg role="img" aria-label={label ?? `Graph with ${nodes.length} nodes and ${edges.length} edges`} viewBox={VIEWBOX} className={`h-auto w-full max-w-full ${className ?? ""}`} data-reduced={reduced ? "true" : "false"}>
      <defs>
        {(["base", "active", "hl"] as const).map((k) => (
          <marker key={k} id={`${uid}-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={k === "active" ? "fill-accent" : k === "hl" ? (tone === "danger" ? "fill-danger" : "fill-success") : "fill-ink-faint"} />
          </marker>
        ))}
      </defs>
      <g>
        {edges.map((e, i) => {
          const a = at.get(e.from), b = at.get(e.to);
          if (!a || !b) return null;
          const bend = directed && e.from !== e.to && edges.some((o, j) => j !== i && o.from === e.to && o.to === e.from);
          const g = geometry(a, b, bend, e.from === e.to, directed);
          const active = activeEdge === i, hl = hlE.has(i);
          const kind = edgeKinds?.[i];
          const cls = hl ? `${ring} stroke-[3.5]` : active ? "stroke-accent stroke-[3.5]" : kind === "tree" ? "stroke-ink-muted stroke-[2.5]" : "stroke-ink-faint stroke-[1.6]";
          const dash = kind === "back" ? "6 4" : kind === "cross" ? "2 4" : kind === "forward" ? "10 3 2 3" : undefined;
          const text = [e.w !== undefined ? num(e.w) : "", kind ? KIND_MARK[kind] : ""].filter(Boolean).join(" ");
          return (
            <g key={i} data-edge={i} data-active={active ? "true" : undefined} data-highlight={hl ? "true" : undefined}>
              <title>{`${e.from} ${directed ? "to" : "and"} ${e.to}${e.w !== undefined ? `, weight ${num(e.w)}` : ""}${kind ? `, ${kind} edge` : ""}`}</title>
              <path d={g.d} fill="none" strokeDasharray={dash} className={`${cls} ${move}`} markerEnd={directed ? `url(#${uid}-${hl ? "hl" : active ? "active" : "base"})` : undefined} />
              {text && (
                <g>
                  <rect x={g.mid.x - (text.length * 3.6 + 4)} y={g.mid.y - 8} width={text.length * 7.2 + 8} height={16} rx={4} className="fill-surface-raised stroke-surface-border" strokeWidth={0.5} />
                  <text x={g.mid.x} y={g.mid.y} textAnchor="middle" dominantBaseline="central" className="fill-ink text-[11px] font-semibold">{text}</text>
                </g>
              )}
            </g>
          );
        })}
      </g>
      <g>
        {nodes.map((n) => {
          const st = states?.[n.id] ?? "unvisited";
          const text = n.label ?? n.id;
          const size = text.length <= 2 ? 13 : text.length <= 4 ? 11 : 9;
          const body = st === "current" ? "fill-accent stroke-accent stroke-2" : st === "visited" ? "fill-success-dim stroke-success stroke-2" : st === "frontier" ? "fill-warn-dim stroke-warn stroke-[2.5]" : "fill-surface-raised stroke-ink-faint stroke-[1.5]";
          return (
            <g key={n.id} data-node={n.id} data-state={st} data-highlight={hlN.has(n.id) ? "true" : undefined}>
              <title>{`${n.id}: ${STATE_WORD[st]}${hlN.has(n.id) ? ", part of the highlighted result" : ""}`}</title>
              {hlN.has(n.id) && <circle cx={n.x} cy={n.y} r={R + 8} fill="none" className={`${ring} stroke-[3]`} />}
              {st === "current" && <circle cx={n.x} cy={n.y} r={R + 4} fill="none" className="stroke-accent stroke-[1.5]" />}
              <circle cx={n.x} cy={n.y} r={R} strokeDasharray={st === "frontier" ? "4 3" : undefined} className={`${body} ${move}`} />
              <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" style={{ fontSize: size }} className={`font-semibold ${st === "current" ? "fill-on-accent" : "fill-ink"}`}>{text}</text>
              {st === "visited" && <text x={n.x + R - 2} y={n.y - R + 2} textAnchor="middle" dominantBaseline="central" className="fill-success text-[12px] font-bold" aria-hidden>✓</text>}
              {st === "current" && <text x={n.x - R + 1} y={n.y - R + 1} textAnchor="middle" dominantBaseline="central" className="fill-accent text-[11px] font-bold" aria-hidden>▶</text>}
              {st === "frontier" && <text x={n.x + R - 2} y={n.y - R + 2} textAnchor="middle" dominantBaseline="central" className="fill-warn text-[12px] font-bold" aria-hidden>…</text>}
              {badges?.[n.id] && <text x={n.x} y={n.y + R + 12} textAnchor="middle" className="fill-ink-muted font-mono text-[10px]">{badges[n.id]}</text>}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────
const chip = "rounded-md border border-surface-border bg-surface-soft px-1.5 py-0.5 font-mono text-xs text-ink";
const panelTitle = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";

function FrontierPanel({ f }: { f: GFrame }) {
  const { kind, title, items } = f.frontier;
  if (kind === "none") return null;
  const mark = (i: number) => (kind === "queue" || kind === "pq" ? (i === 0 ? (kind === "pq" ? "min" : "front") : "") : i === items.length - 1 ? "top" : "");
  return (
    <section aria-label={title} className="rounded-lg border border-surface-border p-2" data-testid="graph-frontier" data-kind={kind}>
      <p className={panelTitle}>{title}</p>
      {items.length ? (
        <ol className="mt-1 flex flex-wrap gap-1">
          {items.map((it, i) => (
            <li key={`${it.label}-${i}`} className={`${chip} ${mark(i) ? "border-warn" : ""}`}>{mark(i) && <span className="mr-1 text-[10px] font-sans font-semibold uppercase text-warn">{mark(i)}</span>}{it.label}</li>
          ))}
        </ol>
      ) : <p className="mt-1 text-xs text-ink-muted">empty</p>}
    </section>
  );
}

function VisitedPanel({ f }: { f: GFrame }) {
  return (
    <section aria-label="Visited nodes" className="rounded-lg border border-surface-border p-2" data-testid="graph-visited">
      <p className={panelTitle}>Visited, in order</p>
      {f.visited.length ? <ol className="mt-1 flex flex-wrap gap-1">{f.visited.map((n) => <li key={n} className={chip}>{n}</li>)}</ol> : <p className="mt-1 text-xs text-ink-muted">nothing yet</p>}
      {f.order && <p className="mt-2 text-xs text-ink-muted">Order so far: <span className="font-mono text-ink">{f.order.join(", ") || "empty"}</span></p>}
      {f.groups && f.groups.length > 0 && <p className="mt-2 text-xs text-ink-muted">Components so far: <span className="font-mono text-ink">{f.groups.map((g) => `{${g.join(", ")}}`).join(" ")}</span></p>}
    </section>
  );
}

function TablePanel({ f, ids }: { f: GFrame; ids: string[] }) {
  const t = tableOf(f, ids);
  if (!t) return null;
  return (
    <section aria-label="Node table" className="overflow-x-auto rounded-lg border border-surface-border p-2" data-testid="graph-table">
      <table className="w-full text-left font-mono text-xs">
        <caption className="sr-only">Values the algorithm keeps for each node</caption>
        <thead><tr><th scope="col" className="pr-3 font-sans text-[10px] uppercase tracking-wider text-ink-faint">Node</th>{t.head.map((h) => <th key={h} scope="col" className="pr-3 font-sans text-[10px] uppercase tracking-wider text-ink-faint">{h}</th>)}</tr></thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.node} className={r.node === f.current ? "bg-accent-dim font-semibold" : ""} aria-current={r.node === f.current ? "true" : undefined}>
              <th scope="row" className="pr-3 text-ink">{r.node === f.current ? "▶ " : ""}{r.node}</th>
              {r.cells.map((c, i) => <td key={i} className="pr-3 text-ink">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Pseudo({ lines, active }: { lines: string[]; active: number }) {
  return (
    <section aria-label="Pseudo-code" className="rounded-lg border border-surface-border">
      <p className={`${panelTitle} px-2 pt-2`}>Pseudo-code (highlighted line is running)</p>
      <ol className="overflow-x-auto py-1 font-mono text-xs">
        {lines.map((l, i) => (
          <li key={i} aria-current={i === active ? "step" : undefined} data-active={i === active ? "true" : undefined}
            className={`whitespace-pre px-2 py-0.5 ${i === active ? "border-l-4 border-accent bg-accent-dim font-semibold text-ink" : "border-l-4 border-transparent text-ink-muted"}`}>{l}</li>
        ))}
      </ol>
    </section>
  );
}

function ResultPanel({ r }: { r: GResult | undefined }) {
  const bad = r && (r.kind === "cycle" || r.kind === "negative-cycle" || r.kind === "topo-cycle" || r.kind === "none");
  return (
    <section aria-label="Result" className={`rounded-lg border p-2 ${r ? (bad ? "border-danger/50 bg-danger-dim" : "border-success/50 bg-success-dim") : "border-surface-border"}`} data-testid="graph-result">
      <p className={panelTitle}>Result</p>
      {r ? (
        <div className="mt-1 space-y-0.5 text-sm">
          <p className="font-semibold text-ink">{r.title}</p>
          {r.lines.map((l, i) => <p key={i} className="break-words text-xs text-ink-muted">{l}</p>)}
        </div>
      ) : <p className="mt-1 text-xs text-ink-muted">The result appears on the last step.</p>}
    </section>
  );
}

function Legend({ kinds }: { kinds: boolean }) {
  const item = (cls: string, dash: boolean, extra: string, text: string) => (
    <li className="flex items-center gap-1.5">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden><circle cx="13" cy="13" r="9" strokeDasharray={dash ? "3 2" : undefined} className={cls} />{extra && <text x="13" y="13" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[10px] font-bold">{extra}</text>}</svg>
      {text}
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted" aria-label="Legend">
      {item("fill-surface-raised stroke-ink-faint stroke-[1.5]", false, "", "plain circle: not visited")}
      {item("fill-warn-dim stroke-warn stroke-2", true, "…", "dashed ring: waiting in the queue, stack or call stack")}
      {item("fill-accent stroke-accent stroke-2", false, "▶", "filled with a play mark: current node")}
      {item("fill-success-dim stroke-success stroke-2", false, "✓", "tick: visited")}
      {kinds && <li>Edge types: T tree, B back (dashed), F forward, C cross (dotted)</li>}
    </ul>
  );
}

// ── The explorer ─────────────────────────────────────────────────────────
const NO_FRAMES: GFrame[] = [];
const findPreset = (id?: string) => PRESETS.find((p) => p.id === id);
const CUSTOM = "custom";

/** Graph Explorer: pick or type a graph, pick an algorithm, and step through the real execution. */
export function GraphExplorer({ preset }: { preset?: string }) {
  const first = findPreset(preset) ?? PRESETS[0];
  const [pid, setPid] = useState(first.id);
  const [text, setText] = useState(first.text);
  const [directed, setDirected] = useState(first.directed);
  const [coords, setCoords] = useState(first.coords);
  const [algo, setAlgo] = useState<AlgoId>(first.algo);
  const [start, setStart] = useState(first.start);
  const [target, setTarget] = useState(first.target ?? "");
  const errId = useId();

  const apply = (p: (typeof PRESETS)[number]) => { setPid(p.id); setText(p.text); setDirected(p.directed); setCoords(p.coords); setAlgo(p.algo); setStart(p.start); setTarget(p.target ?? ""); };
  const lastProp = useRef(preset);
  useEffect(() => {
    if (lastProp.current === preset) return;
    lastProp.current = preset;
    const p = findPreset(preset);
    if (p) apply(p);
  }, [preset]);

  const built = useMemo(() => buildGraph(text, directed, coords), [text, directed, coords]);
  const graph = built.ok ? built.graph : null;
  const ids = useMemo(() => (graph ? nodeIds(graph) : []), [graph]);
  const info = ALGORITHMS.find((a) => a.id === algo)!;
  const effStart = ids.includes(start) ? start : ids[0] ?? "";
  const effTarget = ids.includes(target) ? target : "";
  const run = useMemo(() => (graph ? runAlgorithm(graph, algo, effStart, effTarget || undefined) : null), [graph, algo, effStart, effTarget]);
  const frames = run?.ok ? run.frames : NO_FRAMES;
  const pb = usePlayback(frames.length);
  const { dispatch } = pb;
  useEffect(() => { dispatch({ type: "restart" }); }, [run, dispatch]);

  const f = frames[pb.index];
  const states = f ? nodeStates(f, ids) : undefined;
  const badges = useMemo(() => {
    if (!f) return undefined;
    const b: Record<string, string> = {};
    for (const n of ids) {
      if (f.indeg) b[n] = `in ${f.indeg[n]}`;
      else if (f.dist && f.dist[n] != null) b[n] = `d=${num(f.dist[n] as number)}`;
    }
    return b;
  }, [f, ids]);
  const failTone = f?.result && (f.result.kind === "cycle" || f.result.kind === "negative-cycle" || f.result.kind === "topo-cycle") ? "danger" : "success";
  const detail = f ? describeFrame(f, ids).slice(f.text.length).trim() : "";

  return (
    <section aria-label="Graph Explorer" className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-ink-muted">Example graph
          <select className={`${sel} mt-0.5 w-full`} value={pid} onChange={(e) => { const p = findPreset(e.target.value); if (p) apply(p); }}>
            {pid === CUSTOM && <option value={CUSTOM}>Custom (edited)</option>}
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Algorithm
          <select className={`${sel} mt-0.5 w-full`} value={algo} onChange={(e) => setAlgo(e.target.value as AlgoId)}>
            {ALGORITHMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Start node
          <select className={`${sel} mt-0.5 w-full`} value={effStart} disabled={!info.usesStart} onChange={(e) => setStart(e.target.value)}>
            {ids.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Target node
          <select className={`${sel} mt-0.5 w-full`} value={effTarget} disabled={!info.usesTarget} onChange={(e) => setTarget(e.target.value)}>
            <option value="">(none: whole graph)</option>
            {ids.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end rounded-md border border-surface-border px-2 py-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={directed} onChange={(e) => setDirected(e.target.checked)} /> Directed edges (arrows)
        </label>
      </div>
      <p className="text-sm text-ink-muted">
        {info.blurb} <ProvenanceBadge p="executed" />{" "}
        <span className="text-xs text-ink-faint">Executed: the algorithm really runs in this page and each step is recorded from that run. Graphs are limited to {MAX_NODES} nodes and {MAX_EDGES} edges. Nothing leaves your browser.</span>
      </p>
      <p className="text-xs text-ink-faint">{(findPreset(pid)?.teaches) ?? "Your own graph: edit the edge list below."}</p>

      {run && !run.ok && (
        <div role="alert" className="space-y-2 rounded-lg border border-danger/50 bg-danger-dim p-3 text-sm text-ink" data-testid="graph-blocked">
          <p>{run.message}</p>
          {run.fix && (
            <button type="button" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => { if (run.fix?.algo) setAlgo(run.fix.algo); if (run.fix?.directed !== undefined) setDirected(run.fix.directed); }}>{run.fix.label}</button>
          )}
        </div>
      )}

      <VisualShell
        left={(
          <>
            {graph && (
              <div className="rounded-xl border border-surface-border bg-surface-raised p-2">
                <GraphDiagram nodes={graph.nodes} edges={graph.edges} directed={graph.directed} states={states} badges={badges} activeEdge={f?.edge}
                  highlight={f?.hlNodes} highlightEdges={f?.hlEdges} edgeKinds={f?.edgeKinds} tone={failTone}
                  label={f ? `Graph, ${graph.directed ? "directed" : "undirected"}, ${graph.nodes.length} nodes and ${graph.edges.length} edges. ${describeFrame(f, ids)}` : `Graph, ${graph.nodes.length} nodes and ${graph.edges.length} edges`} />
              </div>
            )}
            <Legend kinds={!!f?.edgeKinds && Object.keys(f.edgeKinds).length > 0} />
            {f && (
              <div aria-live="polite" aria-atomic="true" data-testid="graph-step-text" className="rounded-lg border border-surface-border bg-surface-soft p-2 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Step {pb.index + 1} of {frames.length}</p>
                <p className="text-ink">{f.text}</p>
                <span className="sr-only">{detail}</span>
              </div>
            )}
            <PlaybackBar pb={pb} labels={frames.map((x) => x.text)} />
          </>
        )}
        right={f && graph ? (
          <>
            <FrontierPanel f={f} />
            <VisitedPanel f={f} />
            <TablePanel f={f} ids={ids} />
            <ResultPanel r={f.result} />
            {run?.ok && <Pseudo lines={run.pseudo} active={f.line} />}
          </>
        ) : null}
        bottom={(
          <div className="space-y-1 rounded-lg border border-surface-border p-2">
            <label htmlFor={`${errId}-edges`} className="text-xs font-semibold text-ink">Edges, one per line</label>
            <textarea id={`${errId}-edges`} rows={6} spellCheck={false} value={text} aria-invalid={!built.ok} aria-describedby={`${errId}-help ${built.ok ? "" : `${errId}-err`}`.trim()}
              onChange={(e) => { setText(e.target.value); setPid(CUSTOM); }}
              className="w-full rounded-md border border-surface-border bg-surface px-2 py-1.5 font-mono text-xs text-ink" />
            <p id={`${errId}-help`} className="text-xs text-ink-faint">
              Write <code>A-B</code> for an edge, <code>A-B:3</code> to give it a weight (negative weights are allowed), or just <code>F</code> for a node with no edges. Use the Directed switch for arrows. Up to {MAX_NODES} nodes. Lines starting with # are comments.
            </p>
            {!built.ok && (
              <ul id={`${errId}-err`} role="alert" className="space-y-0.5 text-xs text-danger" data-testid="graph-errors">
                {built.errors.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
          </div>
        )}
      />
    </section>
  );
}
