import { useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SchemaTable } from "../types";

/**
 * Interactive ER diagram from the real schema (columns, PKs, FKs). Tables can be dragged;
 * clicking one highlights it, its foreign keys and the tables that reference it.
 */
export function relatedTables(schema: SchemaTable[], name: string): Set<string> {
  const out = new Set([name]);
  for (const t of schema) for (const c of t.columns) {
    if (!c.fk) continue;
    if (t.name === name) out.add(c.fk.table);
    if (c.fk.table === name) out.add(t.name);
  }
  return out;
}

function TableBox({ t, dim, active }: { t: SchemaTable; dim: boolean; active: boolean }) {
  return (
    <div className={`w-[220px] overflow-hidden rounded-xl border bg-surface-raised text-left shadow-panel transition-opacity ${active ? "border-accent" : "border-surface-border"} ${dim ? "opacity-30" : ""}`}>
      <p className={`border-b border-surface-border px-3 py-1.5 font-mono text-sm font-semibold ${active ? "bg-accent-dim text-accent" : "text-ink"}`}>{t.name}</p>
      <ul className="px-3 py-1.5">
        {t.columns.map((c) => (
          <li key={c.name} className="flex justify-between gap-2 font-mono text-[11px] leading-5">
            <span className={c.pk ? "font-semibold text-ink" : "text-ink-muted"}>{c.name}</span>
            <span className="shrink-0 text-ink-faint">{c.pk ? "PK" : c.fk ? `FK → ${c.fk.table}` : c.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SchemaFlow({ schema }: { schema: SchemaTable[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const related = sel ? relatedTables(schema, sel) : null;
  const base = useMemo(() => {
    // Most-referenced tables in the middle column, the rest around them.
    const refs = new Map(schema.map((t) => [t.name, 0]));
    for (const t of schema) for (const c of t.columns) if (c.fk) refs.set(c.fk.table, (refs.get(c.fk.table) ?? 0) + 1);
    const order = [...schema].sort((a, b) => (refs.get(b.name)! - refs.get(a.name)!) || a.name.localeCompare(b.name));
    const cols = 3;
    return order.map((t, i) => ({ t, x: (i % cols) * 280, y: Math.floor(i / cols) * 300 }));
  }, [schema]);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});

  const nodes: Node[] = base.map(({ t, x, y }) => ({
    id: t.name, position: pos[t.name] ?? { x, y }, draggable: true,
    data: { label: <TableBox t={t} dim={!!related && !related.has(t.name)} active={sel === t.name} /> },
    style: { padding: 0, border: "none", background: "transparent", width: 220 },
  }));
  const edges: Edge[] = schema.flatMap((t) => t.columns.filter((c) => c.fk).map((c) => {
    const on = !related || (related.has(t.name) && related.has(c.fk!.table) && (t.name === sel || c.fk!.table === sel));
    return {
      id: `${t.name}.${c.name}`, source: t.name, target: c.fk!.table, label: `${c.name} → ${c.fk!.column}`,
      markerEnd: { type: MarkerType.ArrowClosed }, animated: !!sel && on,
      style: { strokeWidth: on && sel ? 2 : 1.25, opacity: on ? 1 : 0.15, stroke: "rgb(var(--color-accent))" },
      labelStyle: { fontSize: 10, fill: "rgb(var(--color-ink-muted))", opacity: on ? 1 : 0.2 },
      labelBgStyle: { fill: "rgb(var(--color-surface-raised))" },
    };
  }));

  return (
    <div>
      <div className="h-[560px] overflow-hidden rounded-card border border-surface-border bg-surface">
        <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} proOptions={{ hideAttribution: true }} nodesConnectable={false}
          onNodeClick={(_, n) => setSel((s) => (s === n.id ? null : n.id))} onPaneClick={() => setSel(null)}
          onNodeDragStop={(_, n) => setPos((p) => ({ ...p, [n.id]: n.position }))}>
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="mt-2 text-xs text-ink-muted" aria-live="polite">
        {sel ? <>Showing <span className="font-mono text-ink">{sel}</span> and {related!.size - 1} related table{related!.size === 2 ? "" : "s"}. Click it again or the background to clear.</> : "Drag tables to rearrange. Click a table to highlight its relationships; scroll or use the controls to zoom."}
      </p>
    </div>
  );
}
