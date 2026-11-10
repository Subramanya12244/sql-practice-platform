import { useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Play, Plus, Save, Trash2 } from "lucide-react";
import { NODE_INFO, PRESET_CLEAN_ORDERS, SAMPLES, dbTables, runPipeline, validatePipeline, type EtlNode, type NodeKind, type Pipeline, type Row, type RunResult } from "../../lib/lab/etl";
import { deleteDoc, listDocs, loadDoc, saveDoc } from "../../lib/lab/store";
import { Button } from "../ui";

const KIND_ORDER = Object.keys(NODE_INFO) as NodeKind[];
const STATUS_CLS: Record<string, string> = { ok: "border-success", error: "border-danger", skipped: "border-warn", idle: "border-surface-border" };
const INPUT = "w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink";
let counter = 0;
const newId = () => `n${Date.now().toString(36)}${counter++}`;

function EtlNodeBox({ data }: NodeProps) {
  const d = data as { node: EtlNode; status: string; rows?: number; selected: boolean };
  return (
    <div className={`w-[190px] rounded-xl border-2 bg-surface-raised px-3 py-2 text-left shadow-panel ${STATUS_CLS[d.status]} ${d.selected ? "ring-2 ring-accent" : ""}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{NODE_INFO[d.node.kind].group}</p>
      <p className="truncate text-sm font-semibold text-ink">{d.node.label || NODE_INFO[d.node.kind].title}</p>
      <p className="text-[11px] text-ink-muted">{d.status === "idle" ? NODE_INFO[d.node.kind].title : d.status === "ok" ? `${d.rows ?? 0} rows` : d.status === "error" ? "Failed" : "Skipped"}</p>
    </div>
  );
}
const nodeTypes = { etl: EtlNodeBox };

function layout(p: Pipeline): Record<string, { x: number; y: number }> {
  const depth: Record<string, number> = {};
  const d = (id: string): number => depth[id] ?? (depth[id] = Math.max(-1, ...(p.nodes.find((n) => n.id === id)?.inputs ?? []).map((i) => (i === id ? -1 : d(i)))) + 1);
  p.nodes.forEach((n) => { try { d(n.id); } catch { depth[n.id] = 0; } });
  const rowsAt: Record<number, number> = {};
  return Object.fromEntries(p.nodes.map((n) => { const x = depth[n.id] ?? 0; const y = rowsAt[x] ?? 0; rowsAt[x] = y + 1; return [n.id, { x: x * 240, y: y * 100 }]; }));
}

function Table({ rows, caption }: { rows: Row[]; caption: string }) {
  const cols = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))];
  if (!rows.length) return <p className="text-xs text-ink-muted">{caption}: no rows.</p>;
  return (
    <div className="overflow-auto rounded-lg border border-surface-border">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-overlay text-ink-faint"><tr>{cols.map((c) => <th key={c} scope="col" className="px-2 py-1 font-medium">{c}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 20).map((r, i) => <tr key={i} className="border-t border-surface-border">{cols.map((c) => <td key={c} className="px-2 py-1 font-mono text-ink">{r[c] === null || r[c] === undefined ? <span className="text-ink-faint">null</span> : String(r[c])}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > 20 && <p className="px-2 py-1 text-[11px] text-ink-faint">Showing 20 of {rows.length} rows.</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs text-ink-muted">{label}<div className="mt-1">{children}</div></label>;
}

export default function EtlWorkspace() {
  const [p, setP] = useState<Pipeline>(PRESET_CLEAN_ORDERS);
  const [sel, setSel] = useState<string | null>("src");
  const [result, setResult] = useState<RunResult | null>(null);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [docId, setDocId] = useState<string | undefined>();
  const [name, setName] = useState("My pipeline");
  const [saved, setSaved] = useState(() => listDocs("etl"));
  const [msg, setMsg] = useState<string | null>(null);

  const wiring = useMemo(() => validatePipeline(p), [p]);
  const auto = useMemo(() => layout(p), [p]);
  const node = p.nodes.find((n) => n.id === sel) ?? null;
  const edit = (next: Pipeline) => { setP(next); setResult(null); };
  const patch = (id: string, f: (n: EtlNode) => EtlNode) => edit({ nodes: p.nodes.map((n) => (n.id === id ? f(n) : n)) });
  const setCfg = (id: string, k: string, v: unknown) => patch(id, (n) => ({ ...n, config: { ...n.config, [k]: v } }));

  const add = (kind: NodeKind) => {
    const id = newId();
    const defaults: Record<string, unknown> = kind === "source-csv" ? { text: SAMPLES.orders_csv } : kind === "source-json" ? { text: SAMPLES.customers_json } : kind === "source-db" ? { table: "products" } : kind === "output" ? { name: "target_table" } : {};
    edit({ nodes: [...p.nodes, { id, kind, inputs: [], config: defaults }] });
    setSel(id);
  };
  const remove = (id: string) => { edit({ nodes: p.nodes.filter((n) => n.id !== id).map((n) => ({ ...n, inputs: n.inputs.filter((i) => i !== id) })) }); setSel(null); };
  const connect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    patch(c.target, (n) => (n.inputs.includes(c.source!) || n.inputs.length >= NODE_INFO[n.kind].inputs ? n : { ...n, inputs: [...n.inputs, c.source!] }));
  };

  const nodes: Node[] = p.nodes.map((n) => ({ id: n.id, type: "etl", position: pos[n.id] ?? auto[n.id], data: { node: n, status: result?.status[n.id] ?? "idle", rows: result?.outputs[n.id]?.length, selected: n.id === sel } }));
  const edges: Edge[] = p.nodes.flatMap((n) => n.inputs.map((i) => ({ id: `${i}-${n.id}`, source: i, target: n.id, markerEnd: { type: MarkerType.ArrowClosed } })));

  const run = () => setResult(runPipeline(p));
  const save = () => { const id = saveDoc("etl", { id: docId, name, data: p }); if (id) { setDocId(id); setSaved(listDocs("etl")); setMsg("Saved on this device."); } else setMsg("Could not save: browser storage is full or blocked."); };
  const load = (id: string) => { const d = loadDoc<Pipeline>("etl", id); if (d) { setP(d); setResult(null); setDocId(id); setName(saved.find((s) => s.id === id)?.name ?? "My pipeline"); setSel(null); setMsg(null); } };

  const inputCols = node && result?.inputsOf[node.id]?.[0] ? Object.keys(result.inputsOf[node.id][0]) : [];
  const upstream = (n: EtlNode) => p.nodes.filter((x) => x.id !== n.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Pipeline actions">
        <Button onClick={run} disabled={!p.nodes.length}><Play className="h-4 w-4" aria-hidden /> Run pipeline</Button>
        <Button variant="secondary" onClick={() => { edit(PRESET_CLEAN_ORDERS); setSel("src"); setDocId(undefined); setName("Clean orders"); }}>Load example</Button>
        <Button variant="ghost" onClick={() => { edit({ nodes: [] }); setSel(null); setDocId(undefined); }}>New</Button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <input aria-label="Pipeline name" value={name} onChange={(e) => setName(e.target.value)} className={`${INPUT} w-40`} maxLength={60} />
          <Button variant="secondary" onClick={save}><Save className="h-4 w-4" aria-hidden /> Save</Button>
          {saved.length > 0 && (
            <select aria-label="Open a saved pipeline" value="" onChange={(e) => e.target.value && load(e.target.value)} className={`${INPUT} w-44`}>
              <option value="">Open saved...</option>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {docId && <button type="button" onClick={() => { deleteDoc("etl", docId); setSaved(listDocs("etl")); setDocId(undefined); }} className="text-xs text-ink-muted hover:text-danger">Delete saved</button>}
        </span>
      </div>
      {msg && <p role="status" className="text-xs text-ink-muted">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_18rem]">
        <nav aria-label="Add a step" className="space-y-3">
          {(["Source", "Transform", "Validate", "Load"] as const).map((g) => (
            <div key={g}>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{g}</p>
              <ul className="mt-1 space-y-1">
                {KIND_ORDER.filter((k) => NODE_INFO[k].group === g).map((k) => (
                  <li key={k}><button type="button" onClick={() => add(k)} title={NODE_INFO[k].help} className="flex w-full items-center gap-1.5 rounded-lg border border-surface-border px-2 py-1 text-left text-xs text-ink hover:border-accent"><Plus className="h-3 w-3 shrink-0 text-accent" aria-hidden />{NODE_INFO[k].title}</button></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          <div className="h-[380px] overflow-hidden rounded-card border border-surface-border bg-surface" role="region" aria-label="Pipeline canvas. Select a step to edit it, drag between steps to connect them, or use the Input fields in the step panel.">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)} onConnect={connect}
              onNodeDragStop={(_, n) => setPos((s) => ({ ...s, [n.id]: n.position }))} fitView fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }} nodesConnectable>
              <Background gap={18} /><Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {wiring.length > 0 && <ul role="alert" className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-warn">{wiring.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>

        <aside aria-label="Step settings" className="space-y-2 rounded-card border border-surface-border bg-surface-raised p-3">
          {!node ? <p className="text-sm text-ink-muted">Select a step to change it, or add one from the left.</p> : (
            <>
              <h2 className="text-sm font-semibold text-ink">{NODE_INFO[node.kind].title}</h2>
              <p className="text-xs text-ink-muted">{NODE_INFO[node.kind].help}</p>
              <Field label="Name"><input value={node.label ?? ""} placeholder={NODE_INFO[node.kind].title} onChange={(e) => patch(node.id, (n) => ({ ...n, label: e.target.value }))} className={INPUT} maxLength={40} /></Field>
              {Array.from({ length: NODE_INFO[node.kind].inputs }, (_, slot) => (
                <Field key={slot} label={NODE_INFO[node.kind].inputs === 2 ? (slot === 0 ? "Left input" : "Right input") : "Input"}>
                  <select value={node.inputs[slot] ?? ""} onChange={(e) => patch(node.id, (n) => { const ins = [...n.inputs]; if (e.target.value) ins[slot] = e.target.value; else ins.splice(slot, 1); return { ...n, inputs: ins.filter(Boolean) }; })} className={INPUT}>
                    <option value="">Not connected</option>
                    {upstream(node).map((u) => <option key={u.id} value={u.id}>{u.label || NODE_INFO[u.kind].title}</option>)}
                  </select>
                </Field>
              ))}
              <NodeConfig node={node} cols={inputCols} setCfg={(k, v) => setCfg(node.id, k, v)} />
              <button type="button" onClick={() => remove(node.id)} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove this step</button>
            </>
          )}
        </aside>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Data preview" className="min-w-0 space-y-2">
          <h2 className="text-sm font-semibold text-ink">Data preview</h2>
          {!result ? <p className="text-sm text-ink-muted">Run the pipeline to see the data going into and out of the selected step.</p>
            : !node ? <p className="text-sm text-ink-muted">Select a step to see its data.</p>
              : <>
                {node.inputs.length > 0 && <Table rows={result.inputsOf[node.id] ?? []} caption="Input rows" />}
                {result.outputs[node.id] ? <Table rows={result.outputs[node.id]} caption="Output rows" /> : <p className="text-sm text-ink-muted">This step produced no output ({result.status[node.id]}).</p>}
              </>}
        </section>
        <section aria-label="Run log" className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Run log {result && <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${result.ok ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>{result.ok ? "Succeeded" : "Did not finish"}</span>}</h2>
          {!result ? <p className="mt-1 text-sm text-ink-muted">Nothing has run yet.</p> : (
            <ol className="mt-1 space-y-1 font-mono text-xs" aria-live="polite">
              {result.logs.map((l, i) => <li key={i} className={l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warn" : "text-ink-muted"}>{l.level === "error" ? "ERROR " : l.level === "warn" ? "NOTE  " : "INFO  "}{l.message}</li>)}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function NodeConfig({ node, cols, setCfg }: { node: EtlNode; cols: string[]; setCfg: (k: string, v: unknown) => void }) {
  const c = node.config;
  const s = (k: string, d = "") => (typeof c[k] === "string" ? (c[k] as string) : d);
  const colInput = (k: string, label: string) => (
    <Field label={label}><input list="etl-cols" value={s(k)} onChange={(e) => setCfg(k, e.target.value)} className={INPUT} /></Field>
  );
  const list = (k: string) => (Array.isArray(c[k]) ? (c[k] as string[]).join(", ") : s(k));
  const listInput = (k: string, label: string, hint: string) => (
    <Field label={`${label} (${hint})`}><input list="etl-cols" value={list(k)} onChange={(e) => setCfg(k, e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} className={INPUT} /></Field>
  );
  const sel = (k: string, label: string, opts: [string, string][], d: string) => (
    <Field label={label}><select value={s(k, d)} onChange={(e) => setCfg(k, e.target.value)} className={INPUT}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
  );
  const datalist = <datalist id="etl-cols">{cols.map((x) => <option key={x} value={x} />)}</datalist>;
  const rules = (Array.isArray(c.rules) ? c.rules : []) as { column: string; rule: string; arg?: string }[];
  switch (node.kind) {
    case "source-csv": case "source-json":
      return <Field label="Data"><textarea value={s("text")} onChange={(e) => setCfg("text", e.target.value)} rows={7} className={`${INPUT} font-mono text-xs`} spellCheck={false} /></Field>;
    case "source-db":
      return sel("table", "Table", Object.keys(dbTables).map((t) => [t, t]), "products");
    case "select": return <>{datalist}{listInput("columns", "Columns to keep", "comma separated")}</>;
    case "filter": return <>{datalist}{colInput("column", "Column")}{sel("op", "Condition", [["=", "equals"], ["!=", "does not equal"], [">", "greater than"], [">=", "at least"], ["<", "less than"], ["<=", "at most"], ["contains", "contains"], ["is null", "is empty"], ["is not null", "is not empty"]], "=")}<Field label="Value"><input value={s("value")} onChange={(e) => setCfg("value", e.target.value)} className={INPUT} /></Field></>;
    case "convert": return <>{datalist}{colInput("column", "Column")}{sel("to", "Convert to", [["number", "Number"], ["date", "Date (YYYY-MM-DD)"], ["boolean", "True / false"], ["string", "Text"]], "number")}{sel("onError", "If a value cannot be converted", [["null", "Make it empty and continue"], ["fail", "Stop the run"]], "null")}</>;
    case "nulls": return <>{datalist}{colInput("column", "Column")}{sel("strategy", "When empty", [["drop", "Drop the row"], ["fill", "Fill with a value"], ["mean", "Fill with the average"]], "drop")}{s("strategy", "drop") === "fill" && <Field label="Value"><input value={s("value")} onChange={(e) => setCfg("value", e.target.value)} className={INPUT} /></Field>}</>;
    case "dedupe": return <>{datalist}{listInput("keys", "Key columns", "blank = whole row")}</>;
    case "aggregate": return <>{datalist}{listInput("groupBy", "Group by", "comma separated")}{sel("fn", "Calculate", [["count", "Count"], ["sum", "Sum"], ["avg", "Average"], ["min", "Minimum"], ["max", "Maximum"]], "count")}{s("fn", "count") !== "count" && colInput("column", "Of column")}<Field label="Result column name"><input value={s("as")} onChange={(e) => setCfg("as", e.target.value)} className={INPUT} /></Field></>;
    case "join": return <>{datalist}{colInput("leftKey", "Left key")}{colInput("rightKey", "Right key")}{sel("kind", "Join type", [["inner", "Inner (matches only)"], ["left", "Left (keep all left rows)"]], "inner")}</>;
    case "validate": return (
      <>
        {datalist}
        {sel("onFail", "When a row breaks a rule", [["fail", "Stop the run"], ["drop", "Drop the row and continue"]], "fail")}
        <ul className="space-y-1">
          {rules.map((r, i) => (
            <li key={i} className="flex gap-1">
              <input aria-label="Rule column" list="etl-cols" value={r.column} onChange={(e) => setCfg("rules", rules.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))} className={`${INPUT} w-20`} />
              <select aria-label="Rule" value={r.rule} onChange={(e) => setCfg("rules", rules.map((x, j) => (j === i ? { ...x, rule: e.target.value } : x)))} className={`${INPUT} w-24`}>{["not-null", "unique", "min", "max", "regex"].map((x) => <option key={x}>{x}</option>)}</select>
              <input aria-label="Rule value" value={r.arg ?? ""} onChange={(e) => setCfg("rules", rules.map((x, j) => (j === i ? { ...x, arg: e.target.value } : x)))} className={`${INPUT} w-14`} />
              <button type="button" aria-label="Remove rule" onClick={() => setCfg("rules", rules.filter((_, j) => j !== i))} className="px-1 text-ink-muted hover:text-danger">×</button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setCfg("rules", [...rules, { column: "", rule: "not-null" }])} className="text-xs font-medium text-accent hover:underline">Add a rule</button>
      </>
    );
    case "output": return <Field label="Destination table name"><input value={s("name")} onChange={(e) => setCfg("name", e.target.value)} className={INPUT} /></Field>;
  }
}
