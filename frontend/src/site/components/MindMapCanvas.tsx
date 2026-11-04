import { memo, useCallback, useMemo, useState } from "react";
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, getNodesBounds, getViewportForBounds, useReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng, toSvg } from "html-to-image";
import { Download, Maximize2, Minimize2, Search } from "lucide-react";
import type { MapNode, MindMap } from "../lib/learning";

export type NodeStatus = "done" | "weak" | "none";

/** Lay the tree out left-to-right: depth on x, leaves stacked on y, parents centred on their children. */
export function layoutTree(root: MapNode, collapsed: Set<string>, gapX = 250, gapY = 58) {
  const pos = new Map<string, { x: number; y: number; depth: number }>();
  let leaf = 0;
  const place = (n: MapNode, depth: number): number => {
    const kids = collapsed.has(n.id) ? [] : n.children ?? [];
    let y: number;
    if (!kids.length) y = leaf++ * gapY;
    else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    pos.set(n.id, { x: depth * gapX, y, depth });
    return y;
  };
  place(root, 0);
  return pos;
}

interface Data extends Record<string, unknown> {
  node: MapNode;
  status: NodeStatus;
  hasKids: boolean;
  collapsed: boolean;
  match: boolean;
  selected: boolean;
  depth: number;
  onToggle: (id: string) => void;
}

const MapNodeView = memo(function MapNodeView({ data }: NodeProps<Node<Data>>) {
  const tone =
    data.status === "done" ? "border-success/60 bg-success-dim" : data.status === "weak" ? "border-warn/60 bg-warn-dim" : "border-surface-border bg-surface-raised";
  return (
    <div
      className={`flex min-w-[150px] max-w-[210px] items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-panel ${tone} ${
        data.match ? "ring-2 ring-accent" : ""
      } ${data.selected ? "outline outline-2 outline-accent" : ""} ${data.depth === 0 ? "font-bold" : ""}`}
      title={data.node.detail}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <span className="min-w-0 flex-1 truncate text-ink">{data.node.label}</span>
      {data.hasKids && (
        <button
          type="button"
          className="nodrag rounded border border-surface-border bg-surface px-1 text-xs text-ink-muted hover:text-ink"
          aria-label={data.collapsed ? `Expand ${data.node.label}` : `Collapse ${data.node.label}`}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle(data.node.id);
          }}
        >
          {data.collapsed ? "+" : "−"}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
});

const nodeTypes = { mm: MapNodeView };

function Canvas({ map, statusOf, onSelect, selectedId }: {
  map: MindMap;
  statusOf: (n: MapNode) => NodeStatus;
  onSelect: (n: MapNode) => void;
  selectedId: string | null;
}) {
  const flow = useReactFlow();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const all = useMemo(() => {
    const list: { n: MapNode; parent?: MapNode; ancestors: string[] }[] = [];
    const walk = (n: MapNode, anc: string[], parent?: MapNode) => {
      list.push({ n, parent, ancestors: anc });
      for (const c of n.children ?? []) walk(c, [...anc, n.id], n);
    };
    walk(map.root, []);
    return list;
  }, [map]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => new Set(needle ? all.filter(({ n }) => `${n.label} ${n.detail ?? ""}`.toLowerCase().includes(needle)).map(({ n }) => n.id) : []),
    [all, needle],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Searching opens every branch that leads to a match.
  const effectiveCollapsed = useMemo(() => {
    if (!matches.size) return collapsed;
    const open = new Set(all.filter(({ n }) => matches.has(n.id)).flatMap(({ ancestors }) => ancestors));
    return new Set([...collapsed].filter((id) => !open.has(id)));
  }, [collapsed, matches, all]);

  const { nodes, edges } = useMemo(() => {
    const pos = layoutTree(map.root, effectiveCollapsed);
    const nodes: Node<Data>[] = [];
    const edges: Edge[] = [];
    for (const { n, parent } of all) {
      const p = pos.get(n.id);
      if (!p) continue;
      nodes.push({
        id: n.id,
        type: "mm",
        position: { x: p.x, y: p.y },
        data: {
          node: n, status: statusOf(n), hasKids: Boolean(n.children?.length), collapsed: effectiveCollapsed.has(n.id),
          match: matches.has(n.id), selected: selectedId === n.id, depth: p.depth, onToggle: toggle,
        },
      });
      if (parent && pos.has(parent.id)) edges.push({ id: `${parent.id}-${n.id}`, source: parent.id, target: n.id, type: "smoothstep" });
      for (const pre of n.prereq ?? []) {
        if (pos.has(pre)) {
          edges.push({ id: `pre-${pre}-${n.id}`, source: pre, target: n.id, animated: true, style: { strokeDasharray: "4 4", opacity: 0.6 }, label: "prereq" });
        }
      }
    }
    return { nodes, edges };
  }, [map, all, effectiveCollapsed, matches, selectedId, statusOf, toggle]);

  const setAll = (open: boolean) =>
    setCollapsed(open ? new Set() : new Set(all.filter(({ n }, i) => i > 0 && n.children?.length).map(({ n }) => n.id)));

  async function exportImage(kind: "png" | "svg") {
    const el = document.querySelector<HTMLElement>(".mm-canvas .react-flow__viewport");
    if (!el) return;
    const bounds = getNodesBounds(flow.getNodes());
    const width = Math.ceil(bounds.width + 160);
    const height = Math.ceil(bounds.height + 160);
    const vp = getViewportForBounds(bounds, width, height, 0.2, 2, 0.05);
    const bg = getComputedStyle(document.body).backgroundColor;
    const opts = { backgroundColor: bg, width, height, skipFonts: true, style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` } };
    const url = kind === "png" ? await toPng(el, opts) : await toSvg(el, opts);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${map.slug}-mindmap.${kind}`;
    a.click();
  }

  const btn = "inline-flex items-center gap-1 rounded-lg border border-surface-border bg-surface-raised px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink";
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-border p-2">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-ink-faint" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search nodes" aria-label="Search nodes"
            className="w-48 rounded-lg border border-surface-border bg-surface py-1.5 pl-7 pr-2 text-xs text-ink" />
        </label>
        {needle && <span className="text-xs text-ink-faint">{matches.size} match{matches.size === 1 ? "" : "es"}</span>}
        <button type="button" className={btn} onClick={() => setAll(true)}><Maximize2 className="h-3.5 w-3.5" aria-hidden /> Expand all</button>
        <button type="button" className={btn} onClick={() => setAll(false)}><Minimize2 className="h-3.5 w-3.5" aria-hidden /> Collapse all</button>
        <span className="ml-auto flex gap-2">
          <button type="button" className={btn} onClick={() => exportImage("png")}><Download className="h-3.5 w-3.5" aria-hidden /> PNG</button>
          <button type="button" className={btn} onClick={() => exportImage("svg")}><Download className="h-3.5 w-3.5" aria-hidden /> SVG</button>
        </span>
      </div>
      <div className="mm-canvas min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_e, node) => onSelect((node.data as Data).node)}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!hidden sm:!block" />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function MindMapCanvas(props: Parameters<typeof Canvas>[0]) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
