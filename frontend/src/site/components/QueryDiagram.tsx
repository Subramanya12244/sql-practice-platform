import { useEffect, useMemo, useState } from "react";
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowGraph, FlowKind, RelGraph } from "../lib/queryGraph";
import type { DbKeys } from "../lib/browserDb";
import type { TableSchema } from "../../types";

const TONE: Record<FlowKind, string> = {
  cte: "border-secondary/60 bg-secondary-dim", source: "border-accent/50 bg-accent-dim", subquery: "border-secondary/60 bg-secondary-dim",
  join: "border-accent-muted/60 bg-surface-overlay", where: "border-warn/50 bg-warn-dim", group: "border-success/50 bg-success-dim",
  having: "border-warn/50 bg-warn-dim", window: "border-secondary/60 bg-secondary-dim", select: "border-surface-border bg-surface-overlay",
  distinct: "border-surface-border bg-surface-overlay", order: "border-surface-border bg-surface-overlay", limit: "border-surface-border bg-surface-overlay",
  setop: "border-secondary/60 bg-secondary-dim", branch: "border-surface-border bg-surface-overlay", result: "border-success/60 bg-success-dim",
};

/** Edge labels in theme colours (React Flow defaults to a white box). */
const LABEL = {
  labelStyle: { fontSize: 10, fill: "rgb(var(--color-ink))" },
  labelBgStyle: { fill: "rgb(var(--color-surface-raised))", stroke: "var(--color-border)" },
  labelBgPadding: [4, 2] as [number, number],
  labelBgBorderRadius: 4,
};

function Box({ title, detail, kind }: { title: string; detail: string[]; kind: FlowKind }) {
  return (
    <div className={`w-[250px] rounded-xl border px-3 py-2 text-left shadow-panel ${TONE[kind]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{kind === "source" ? "table" : kind}</p>
      <p className="font-mono text-sm font-semibold text-ink">{title}</p>
      {detail.map((d, i) => <p key={i} className="mt-0.5 break-words font-mono text-[11px] leading-snug text-ink-muted">{d}</p>)}
    </div>
  );
}

/** Layered layout: each node sits one layer below its deepest input, siblings spread across. */
function layout(g: FlowGraph) {
  const layer = new Map<string, number>();
  const ins = new Map<string, string[]>();
  g.edges.forEach((e) => ins.set(e.to, [...(ins.get(e.to) ?? []), e.from]));
  const depth = (id: string, seen = new Set<string>()): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = Math.max(-1, ...(ins.get(id) ?? []).map((x) => depth(x, seen))) + 1;
    layer.set(id, d);
    return d;
  };
  g.nodes.forEach((n) => depth(n.id));
  const rows = new Map<number, string[]>();
  g.nodes.forEach((n) => rows.set(layer.get(n.id)!, [...(rows.get(layer.get(n.id)!) ?? []), n.id]));
  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of rows) ids.forEach((id, i) => pos.set(id, { x: (i - (ids.length - 1) / 2) * 290, y: l * 150 }));
  return pos;
}

export function FlowDiagram({ graph }: { graph: FlowGraph }) {
  const { nodes, edges } = useMemo(() => {
    const pos = layout(graph);
    return {
      nodes: graph.nodes.map((n): Node => ({ id: n.id, position: pos.get(n.id)!, data: { label: <Box title={n.title} detail={n.detail} kind={n.kind} /> }, style: { padding: 0, border: "none", background: "transparent", width: 250 }, draggable: true })),
      edges: graph.edges.map((e, i): Edge => ({ id: `e${i}`, source: e.from, target: e.to, label: e.label, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: "rgb(var(--color-accent))" }, ...LABEL })),
    };
  }, [graph]);
  return (
    <div className="h-[520px] overflow-hidden rounded-card border border-surface-border bg-surface" role="img" aria-label={`Logical query flow: ${graph.nodes.map((n) => n.title).join(", then ")}`}>
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} proOptions={{ hideAttribution: true }} nodesConnectable={false}>
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function RelationshipDiagram({ rel, schemas, keys }: { rel: RelGraph; schemas: TableSchema[]; keys: DbKeys | null }) {
  const { nodes, edges } = useMemo(() => {
    const used = new Set(rel.joins.flatMap((j) => j.pairs.flatMap((p) => [p.left, p.right])));
    const nodes: Node[] = rel.tables.map((t, i) => {
      const cols = schemas.find((s) => s.table_name === t.name)?.columns ?? [];
      const pk = new Set(keys?.pk[t.name] ?? []);
      const fks = new Set((keys?.fk ?? []).filter((f) => f.table === t.name).map((f) => f.column));
      const shown = cols.filter((c) => used.has(`${t.name}.${c.name}`) || pk.has(c.name) || fks.has(c.name)).slice(0, 10);
      return {
        id: t.name,
        position: { x: (i % 3) * 320, y: Math.floor(i / 3) * 260 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { padding: 0, border: "none", background: "transparent", width: 240 },
        data: {
          label: (
            <div className="w-[240px] overflow-hidden rounded-xl border border-surface-border bg-surface-raised text-left shadow-panel">
              <p className={`px-3 py-1.5 font-mono text-sm font-semibold text-ink ${t.cte ? "bg-secondary-dim" : "bg-accent-dim"}`}>{t.name}{t.aliases.length ? <span className="font-normal text-ink-muted"> as {t.aliases.join(", ")}</span> : null}</p>
              <ul className="px-3 py-1.5 font-mono text-[11px]">
                {t.cte && <li className="text-ink-faint">CTE (columns come from its SELECT)</li>}
                {!t.cte && !cols.length && <li className="text-ink-faint">not in this dataset's schema</li>}
                {shown.map((c) => (
                  <li key={c.name} className={used.has(`${t.name}.${c.name}`) ? "font-semibold text-accent" : "text-ink-muted"}>
                    {pk.has(c.name) ? "PK " : fks.has(c.name) ? "FK " : "   "}{c.name} <span className="text-ink-faint">{c.data_type}</span>
                  </li>
                ))}
                {cols.length > shown.length && <li className="text-ink-faint">+{cols.length - shown.length} more columns</li>}
              </ul>
            </div>
          ),
        },
      };
    });
    const names = new Set(rel.tables.map((t) => t.name));
    const edges: Edge[] = rel.joins.filter((j) => names.has(j.left) && names.has(j.right)).map((j, i) => ({
      id: `j${i}`, source: j.left, target: j.right, label: `${j.type}${j.pairs.length ? ` · ${j.pairs.map((p) => `${p.left.split(".")[1]} = ${p.right.split(".")[1]}`).join(", ")}` : ""}`,
      style: { stroke: "rgb(var(--color-accent))", strokeWidth: 2 }, ...LABEL, markerEnd: { type: MarkerType.ArrowClosed },
    }));
    // Foreign keys between the tables this query reads that it doesn't join on: dashed, for context.
    const joined = new Set(rel.joins.map((j) => [j.left, j.right].sort().join("|")));
    (keys?.fk ?? []).filter((f) => names.has(f.table) && names.has(f.refTable) && f.table !== f.refTable && !joined.has([f.table, f.refTable].sort().join("|"))).forEach((f, i) =>
      edges.push({ id: `f${i}`, source: f.table, target: f.refTable, label: `FK ${f.column} (not joined)`, style: { strokeDasharray: "5 4", stroke: "rgb(var(--color-ink-faint))" }, ...LABEL }));
    return { nodes, edges };
  }, [rel, schemas, keys]);
  if (!rel.tables.length) return <p className="text-sm text-ink-muted">This query doesn't read any tables.</p>;
  return (
    <div className="h-[480px] overflow-hidden rounded-card border border-surface-border bg-surface" role="img" aria-label={`Tables: ${rel.tables.map((t) => t.name).join(", ")}; ${rel.joins.length} join(s)`}>
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} proOptions={{ hideAttribution: true }} nodesConnectable={false}>
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** Loads schema + keys for the relationship view. */
export function useSchemaKeys(dataset: string, enabled: boolean) {
  const [s, setS] = useState<{ schemas: TableSchema[]; keys: DbKeys | null }>({ schemas: [], keys: null });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void import("../lib/browserDb").then(async (m) => {
      const [schemas, keys] = await Promise.all([m.getSchemas(dataset), m.getKeys(dataset).catch(() => null)]);
      if (live) setS({ schemas, keys });
    });
    return () => { live = false; };
  }, [dataset, enabled]);
  return s;
}

export default function QueryDiagrams({ mode, flow, rel, dataset }: { mode: "flow" | "rel"; flow: FlowGraph; rel: RelGraph; dataset: string }) {
  const { schemas, keys } = useSchemaKeys(dataset, mode === "rel");
  return mode === "flow" ? <FlowDiagram graph={flow} /> : <RelationshipDiagram rel={rel} schemas={schemas} keys={keys} />;
}
