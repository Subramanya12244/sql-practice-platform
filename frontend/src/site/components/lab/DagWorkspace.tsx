import { useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Play, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { CONCEPTS, PRESET_DAG, SCHEDULE_TEXT, executeRun, order, retryFailed, simulate, validateDag, type Behavior, type Dag, type DagRun, type DagTask, type Schedule, type TaskState } from "../../lib/lab/dag";
import { deleteDoc, listDocs, loadDoc, saveDoc } from "../../lib/lab/store";
import { today } from "../../lib/progress";
import { Button } from "../ui";

const INPUT = "w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink";
const STATE_CLS: Record<string, string> = { success: "border-success", failed: "border-danger", upstream_failed: "border-warn", none: "border-surface-border" };
const STATE_TEXT: Record<string, string> = { success: "Success", failed: "Failed", upstream_failed: "Upstream failed", none: "Not run" };
let n = 0;

function TaskBox({ data }: NodeProps) {
  const d = data as { task: DagTask; state: TaskState | "none"; tries: number; selected: boolean };
  return (
    <div className={`w-[170px] rounded-xl border-2 bg-surface-raised px-3 py-2 text-left shadow-panel ${STATE_CLS[d.state]} ${d.selected ? "ring-2 ring-accent" : ""}`}>
      <p className="truncate font-mono text-sm font-semibold text-ink">{d.task.name}</p>
      <p className="text-[11px] text-ink-muted">{STATE_TEXT[d.state]}{d.tries > 1 ? ` · ${d.tries} attempts` : ""}</p>
    </div>
  );
}
const nodeTypes = { task: TaskBox };

const bKind = (b: Behavior) => b.kind;
function behaviorOf(kind: string, prev: Behavior): Behavior {
  if (kind === "fail-times") return { kind, times: prev.kind === "fail-times" ? prev.times : 1 };
  if (kind === "fail-on-runs") return { kind, runs: prev.kind === "fail-on-runs" ? prev.runs : [0] };
  return kind === "always-fail" ? { kind } : { kind: "succeed" };
}

export default function DagWorkspace() {
  const [dag, setDag] = useState<Dag>(PRESET_DAG);
  const [runs, setRuns] = useState<DagRun[]>([]);
  const [runIdx, setRunIdx] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>("extract");
  const [docId, setDocId] = useState<string | undefined>();
  const [saved, setSaved] = useState(() => listDocs("dag"));
  const [msg, setMsg] = useState<string | null>(null);

  const problems = useMemo(() => validateDag(dag), [dag]);
  const run = runIdx !== null ? runs[runIdx] ?? null : null;
  const task = dag.tasks.find((t) => t.id === sel) ?? null;
  const edit = (next: Dag) => { setDag(next); setRuns([]); setRunIdx(null); };
  const patch = (id: string, f: (t: DagTask) => DagTask) => edit({ ...dag, tasks: dag.tasks.map((t) => (t.id === id ? f(t) : t)) });

  const positions = useMemo(() => {
    const depth: Record<string, number> = {};
    const d = (id: string, seen = new Set<string>()): number => { if (depth[id] !== undefined) return depth[id]; if (seen.has(id)) return 0; seen.add(id); const t = dag.tasks.find((x) => x.id === id); return (depth[id] = t && t.deps.length ? Math.max(...t.deps.map((x) => d(x, seen))) + 1 : 0); };
    const rowsAt: Record<number, number> = {};
    return Object.fromEntries(dag.tasks.map((t) => { const x = d(t.id); const y = rowsAt[x] ?? 0; rowsAt[x] = y + 1; return [t.id, { x: x * 210, y: y * 90 }]; }));
  }, [dag.tasks]);
  const nodes: Node[] = dag.tasks.map((t) => ({ id: t.id, type: "task", position: positions[t.id], draggable: false, data: { task: t, state: run?.tasks[t.id]?.state ?? "none", tries: run?.tasks[t.id]?.attempts.length ?? 0, selected: t.id === sel } }));
  const edges: Edge[] = dag.tasks.flatMap((t) => t.deps.map((x) => ({ id: `${x}-${t.id}`, source: x, target: t.id, markerEnd: { type: MarkerType.ArrowClosed } })));

  const go = () => { const r = simulate(dag, today()); setRuns(r); setRunIdx(r.length ? r.length - 1 : null); };
  const trigger = () => { const r = [...runs, executeRun(dag, runs.length, today())]; setRuns(r); setRunIdx(r.length - 1); };
  const retry = () => { if (run && runIdx !== null) setRuns(runs.map((r, i) => (i === runIdx ? retryFailed(dag, r) : r))); };
  const addTask = () => { const id = `task${++n}${Date.now().toString(36)}`; edit({ ...dag, tasks: [...dag.tasks, { id, name: `task_${dag.tasks.length + 1}`, deps: [], retries: 1, retryDelayMin: 2, durationMin: 5, behavior: { kind: "succeed" } }] }); setSel(id); };
  const removeTask = (id: string) => { edit({ ...dag, tasks: dag.tasks.filter((t) => t.id !== id).map((t) => ({ ...t, deps: t.deps.filter((d) => d !== id) })) }); setSel(null); };
  const save = () => { const id = saveDoc("dag", { id: docId, name: dag.name, data: dag }); if (id) { setDocId(id); setSaved(listDocs("dag")); setMsg("Saved on this device."); } else setMsg("Could not save: browser storage is full or blocked."); };
  const load = (id: string) => { const d = loadDoc<Dag>("dag", id); if (d) { setDag(d); setRuns([]); setRunIdx(null); setDocId(id); setSel(null); } };
  const canRetry = run !== null && Object.values(run.tasks).some((t) => t.state === "failed");
  const fmtMin = (m: number) => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  const ordered = order(dag);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Simulator actions">
        <Button onClick={go} disabled={problems.length > 0}><Play className="h-4 w-4" aria-hidden /> Run the schedule</Button>
        <Button variant="secondary" onClick={trigger} disabled={problems.length > 0}>Trigger a run now</Button>
        <Button variant="secondary" onClick={retry} disabled={!canRetry}><RotateCcw className="h-4 w-4" aria-hidden /> Retry failed tasks</Button>
        <Button variant="ghost" onClick={() => { edit(PRESET_DAG); setSel("extract"); setDocId(undefined); }}>Load example</Button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={save}><Save className="h-4 w-4" aria-hidden /> Save</Button>
          {saved.length > 0 && <select aria-label="Open a saved DAG" value="" onChange={(e) => e.target.value && load(e.target.value)} className={`${INPUT} w-44`}><option value="">Open saved...</option>{saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          {docId && <button type="button" onClick={() => { deleteDoc("dag", docId); setSaved(listDocs("dag")); setDocId(undefined); }} className="text-xs text-ink-muted hover:text-danger">Delete saved</button>}
        </span>
      </div>
      {msg && <p role="status" className="text-xs text-ink-muted">{msg}</p>}
      {problems.length > 0 && <ul role="alert" className="list-disc space-y-0.5 pl-5 text-xs text-warn">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-3" aria-label="DAG settings">
          <div className="space-y-2 rounded-card border border-surface-border bg-surface-raised p-3">
            <label className="block text-xs text-ink-muted">DAG name<input value={dag.name} onChange={(e) => edit({ ...dag, name: e.target.value })} className={`${INPUT} mt-1`} maxLength={50} /></label>
            <label className="block text-xs text-ink-muted">Schedule
              <select value={dag.schedule} onChange={(e) => edit({ ...dag, schedule: e.target.value as Schedule })} className={`${INPUT} mt-1`}>{(Object.keys(SCHEDULE_TEXT) as Schedule[]).map((s) => <option key={s} value={s}>{s === "manual" ? "manual" : s}: {SCHEDULE_TEXT[s]}</option>)}</select>
            </label>
            <label className="block text-xs text-ink-muted">Start date<input type="date" value={dag.startDate} onChange={(e) => edit({ ...dag, startDate: e.target.value })} className={`${INPUT} mt-1`} /></label>
            <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={dag.catchup} onChange={(e) => edit({ ...dag, catchup: e.target.checked })} /> Catch up on missed intervals (catchup)</label>
          </div>
          <div className="rounded-card border border-surface-border bg-surface-raised p-3">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-ink">Tasks</h2><button type="button" onClick={addTask} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"><Plus className="h-3 w-3" aria-hidden /> Add task</button></div>
            <ul className="mt-2 space-y-1">{(ordered ?? dag.tasks.map((t) => t.id)).map((id) => { const t = dag.tasks.find((x) => x.id === id)!; return <li key={id}><button type="button" onClick={() => setSel(id)} aria-current={sel === id} className={`w-full rounded-lg border px-2 py-1 text-left font-mono text-xs ${sel === id ? "border-accent bg-accent-dim text-ink" : "border-surface-border text-ink-muted hover:border-accent"}`}>{t.name || t.id}</button></li>; })}</ul>
          </div>
          {task && (
            <div className="space-y-2 rounded-card border border-surface-border bg-surface-raised p-3" aria-label="Task settings">
              <label className="block text-xs text-ink-muted">Name<input value={task.name} onChange={(e) => patch(task.id, (t) => ({ ...t, name: e.target.value }))} className={`${INPUT} mt-1 font-mono`} maxLength={30} /></label>
              <fieldset className="text-xs text-ink-muted"><legend>Runs after</legend>
                {dag.tasks.filter((t) => t.id !== task.id).length === 0 ? <p className="mt-1 text-ink-faint">Add another task to set dependencies.</p> : dag.tasks.filter((t) => t.id !== task.id).map((t) => (
                  <label key={t.id} className="mt-1 flex items-center gap-2 text-ink"><input type="checkbox" checked={task.deps.includes(t.id)} onChange={(e) => patch(task.id, (x) => ({ ...x, deps: e.target.checked ? [...x.deps, t.id] : x.deps.filter((d) => d !== t.id) }))} /><span className="font-mono">{t.name}</span></label>
                ))}
              </fieldset>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-ink-muted">Retries<input type="number" min={0} max={5} value={task.retries} onChange={(e) => patch(task.id, (t) => ({ ...t, retries: Number(e.target.value) }))} className={`${INPUT} mt-1`} /></label>
                <label className="text-xs text-ink-muted">Retry delay (min)<input type="number" min={0} value={task.retryDelayMin} onChange={(e) => patch(task.id, (t) => ({ ...t, retryDelayMin: Number(e.target.value) }))} className={`${INPUT} mt-1`} /></label>
                <label className="text-xs text-ink-muted">Takes (min)<input type="number" min={1} value={task.durationMin} onChange={(e) => patch(task.id, (t) => ({ ...t, durationMin: Number(e.target.value) }))} className={`${INPUT} mt-1`} /></label>
              </div>
              <label className="block text-xs text-ink-muted">What goes wrong
                <select value={bKind(task.behavior)} onChange={(e) => patch(task.id, (t) => ({ ...t, behavior: behaviorOf(e.target.value, t.behavior) }))} className={`${INPUT} mt-1`}>
                  <option value="succeed">Nothing: it always works</option><option value="fail-times">Fails a few times, then works</option><option value="always-fail">Always fails until fixed</option><option value="fail-on-runs">Fails on chosen runs (a bad day)</option>
                </select>
              </label>
              {task.behavior.kind === "fail-times" && <label className="block text-xs text-ink-muted">Failing attempts<input type="number" min={1} max={9} value={task.behavior.times} onChange={(e) => patch(task.id, (t) => ({ ...t, behavior: { kind: "fail-times", times: Number(e.target.value) } }))} className={`${INPUT} mt-1`} /></label>}
              {task.behavior.kind === "fail-on-runs" && <label className="block text-xs text-ink-muted">Run numbers (first run is 0)<input value={task.behavior.runs.join(", ")} onChange={(e) => patch(task.id, (t) => ({ ...t, behavior: { kind: "fail-on-runs", runs: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0) } }))} className={`${INPUT} mt-1`} /></label>}
              <button type="button" onClick={() => removeTask(task.id)} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove task</button>
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="h-[300px] overflow-hidden rounded-card border border-surface-border bg-surface" role="region" aria-label="DAG graph. Colours show the state of the selected run.">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, nd) => setSel(nd.id)} nodesConnectable={false} fitView fitViewOptions={{ padding: 0.25 }} proOptions={{ hideAttribution: true }}><Background gap={18} /><Controls showInteractive={false} /></ReactFlow>
          </div>

          <section aria-label="Run history">
            <h2 className="text-sm font-semibold text-ink">Run history</h2>
            {!runs.length ? <p className="mt-1 text-sm text-ink-muted">{dag.schedule === "manual" ? "Trigger a run to see how the tasks execute." : "Run the schedule to create the runs this DAG would have made, or trigger one now."}</p> : (
              <div className="mt-1 overflow-x-auto rounded-lg border border-surface-border">
                <table className="w-full min-w-[26rem] text-left text-xs">
                  <caption className="sr-only">DAG runs</caption>
                  <thead className="bg-surface-overlay text-ink-faint"><tr><th scope="col" className="px-2 py-1.5 font-medium">Run</th><th scope="col" className="px-2 py-1.5 font-medium">Logical date</th><th scope="col" className="px-2 py-1.5 font-medium">State</th><th scope="col" className="px-2 py-1.5 font-medium">Duration</th></tr></thead>
                  <tbody>{runs.map((r, i) => (
                    <tr key={i} className={`border-t border-surface-border ${i === runIdx ? "bg-accent-dim" : ""}`}>
                      <th scope="row" className="px-2 py-1.5 font-medium"><button type="button" onClick={() => setRunIdx(i)} className="text-accent hover:underline" aria-current={i === runIdx}>#{r.index}</button></th>
                      <td className="px-2 py-1.5 tabular-nums">{r.logicalDate}</td>
                      <td className="px-2 py-1.5"><span className={r.state === "success" ? "text-success" : "text-danger"}>{r.state === "success" ? "Success" : "Failed"}</span></td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtMin(r.endMin - r.startMin)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </section>

          {run && (
            <div className="grid gap-4 lg:grid-cols-2">
              <section aria-label="Task attempts" className="min-w-0">
                <h2 className="text-sm font-semibold text-ink">Run #{run.index}: tasks</h2>
                <ul className="mt-1 space-y-1 text-xs">
                  {dag.tasks.map((t) => { const ti = run.tasks[t.id]; return (
                    <li key={t.id} className="rounded-lg border border-surface-border px-2 py-1.5">
                      <span className="font-mono font-semibold text-ink">{t.name}</span> <span className={ti?.state === "success" ? "text-success" : ti?.state === "failed" ? "text-danger" : "text-warn"}>{STATE_TEXT[ti?.state ?? "none"]}</span>
                      <span className="block text-ink-muted">{ti?.attempts.length ? ti.attempts.map((a) => `try ${a.number} ${a.ok ? "ok" : "failed"} (${a.startMin}-${a.endMin} min)`).join(" · ") : "never started"}</span>
                    </li>); })}
                </ul>
              </section>
              <section aria-label="Run log" className="min-w-0">
                <h2 className="text-sm font-semibold text-ink">Log</h2>
                <ol className="mt-1 max-h-72 space-y-0.5 overflow-auto font-mono text-[11px] text-ink-muted" aria-live="polite">{run.logs.map((l, i) => <li key={i} className={/FAILED|failed with/.test(l) ? "text-danger" : /RETRY|upstream_failed|cleared/.test(l) ? "text-warn" : ""}>{l}</li>)}</ol>
              </section>
            </div>
          )}

          <section aria-label="Airflow concepts">
            <h2 className="text-sm font-semibold text-ink">How this maps to Apache Airflow</h2>
            <dl className="mt-1 grid gap-2 sm:grid-cols-2">{CONCEPTS.map((c) => <div key={c.term} className="rounded-lg border border-surface-border p-2 text-xs"><dt className="font-semibold text-ink">{c.term} <span className="font-mono font-normal text-accent">{c.airflow}</span></dt><dd className="mt-0.5 text-ink-muted">{c.meaning}</dd></div>)}</dl>
            <p className="mt-2 text-xs text-ink-faint">Simplified on purpose: every task uses the all_success trigger rule, tasks run in parallel without limits, and time is virtual. Real Airflow adds sensors, pools, XCom and many more features.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
