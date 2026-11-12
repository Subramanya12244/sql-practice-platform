import { useMemo, useState } from "react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { DEFAULT_PIPELINE, STAGES, applyCdc, applyScd2, runDag, runPipeline, type Change, type DimRow, type EtlFrame, type Failure, type PipelineOptions, type Task } from "../../lib/visual/etlSim";

const sel = "rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink";
const TONE: Record<EtlFrame["status"], string> = { ok: "border-success/40 bg-success-dim", warn: "border-warn/50 bg-warn-dim", fail: "border-danger/50 bg-danger-dim", retry: "border-warn/50 bg-warn-dim", skipped: "border-surface-border bg-surface-soft" };

function Table({ rows, caption }: { rows: Record<string, unknown>[]; caption: string }) {
  if (!rows.length) return <p className="text-xs text-ink-faint">{caption}: no rows.</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="max-h-52 overflow-auto"><table className="w-full border-collapse text-left text-xs"><caption className="mb-1 text-left text-ink-faint">{caption}</caption>
      <thead><tr>{cols.map((c) => <th key={c} className="border border-surface-border bg-surface-soft px-1.5 py-0.5">{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="border border-surface-border px-1.5 py-0.5 text-ink">{r[c] === null ? <i className="text-ink-faint">null</i> : String(r[c])}</td>)}</tr>)}</tbody></table></div>
  );
}

function Pipeline() {
  const [o, setO] = useState<PipelineOptions>(DEFAULT_PIPELINE);
  const [first, setFirst] = useState<ReturnType<typeof runPipeline> | null>(null);
  const run = useMemo(() => runPipeline(o), [o]);
  const pb = usePlayback(run.frames.length);
  const f = run.frames[pb.index];
  const set = <K extends keyof PipelineOptions>(k: K, v: PipelineOptions[K]) => { setO((x) => ({ ...x, [k]: v })); pb.dispatch({ type: "restart" }); };
  const current = f?.stage;
  return (
    <div className="space-y-3">
      <ol aria-label="Pipeline stages" className="flex flex-wrap items-center gap-1 text-xs">
        {STAGES.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span aria-current={s === current ? "step" : undefined} className={`rounded-full px-2.5 py-1 font-semibold uppercase tracking-wide ${s === current ? "bg-accent text-white" : "bg-surface-soft text-ink-muted"}`}>{s}</span>
            {i < STAGES.length - 1 && <span aria-hidden className="text-ink-faint">→</span>}
          </li>
        ))}
      </ol>
      <VisualShell
        left={(
          <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-surface-border p-2 text-xs">
            <legend className="px-1 font-semibold text-ink">Pipeline settings</legend>
            <label className="text-ink-muted">Load mode<select className={`${sel} mt-0.5 w-full`} value={o.mode} onChange={(e) => set("mode", e.target.value as PipelineOptions["mode"])}><option value="full">Full load</option><option value="incremental">Incremental (watermark)</option></select></label>
            <label className="text-ink-muted">Watermark<select className={`${sel} mt-0.5 w-full`} value={o.watermark} disabled={o.mode !== "incremental"} onChange={(e) => set("watermark", e.target.value)}>{["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"].map((d) => <option key={d}>{d}</option>)}</select></label>
            <label className="text-ink-muted">Load style<select className={`${sel} mt-0.5 w-full`} value={o.load} onChange={(e) => set("load", e.target.value as PipelineOptions["load"])}><option value="upsert">Upsert (idempotent)</option><option value="append">Append</option></select></label>
            <label className="text-ink-muted">Inject a failure<select className={`${sel} mt-0.5 w-full`} value={o.failure} onChange={(e) => set("failure", e.target.value as Failure)}>
              <option value="none">None</option><option value="extract-fails-twice">Extract fails twice</option><option value="extract-always-fails">Extract always fails</option><option value="transform-crash-row-6">Transform crashes on row 6</option><option value="load-fails-once">Load fails once</option><option value="load-always-fails">Load always fails</option></select></label>
            <label className="text-ink-muted">Max retries<input type="number" min={0} max={5} className={`${sel} mt-0.5 w-full`} value={o.maxRetries} onChange={(e) => set("maxRetries", Math.max(0, Math.min(5, Number(e.target.value))))} /></label>
            <div className="space-y-1 text-ink-muted">
              <label className="flex items-center gap-1"><input type="checkbox" checked={o.dedupe} onChange={(e) => set("dedupe", e.target.checked)} /> Deduplicate by key</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={o.quarantine} onChange={(e) => set("quarantine", e.target.checked)} /> Quarantine bad rows</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={o.deadLetter} onChange={(e) => set("deadLetter", e.target.checked)} /> Dead-letter queue</label>
            </div>
            <div className="col-span-2 flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border border-surface-border px-2 py-1 text-ink-muted hover:text-ink" onClick={() => { setFirst(run); setO((x) => ({ ...x, targetBefore: run.target })); pb.dispatch({ type: "restart" }); }}>Keep this target and run again</button>
              <button type="button" className="rounded-lg border border-surface-border px-2 py-1 text-ink-muted hover:text-ink" onClick={() => { setFirst(null); setO((x) => ({ ...x, targetBefore: [] })); pb.dispatch({ type: "restart" }); }}>Empty the target</button>
            </div>
            {first && <p className="col-span-2 text-ink-faint">Rerunning on the target from the previous run ({first.target.length} rows). With Append, the same rows load twice; with Upsert, nothing changes.</p>}
          </fieldset>
        )}
        right={f ? (
          <div className="space-y-2">
            <div role="status" aria-live="polite" className={`rounded-lg border p-2 text-sm ${TONE[f.status]}`}>
              <p className="font-semibold text-ink">{f.title}</p><p className="text-ink-muted">{f.detail}</p>
              <p className="mt-1 text-xs tabular-nums text-ink-faint">{(["in", "out", "rejected", "retries", "errors"] as const).filter((k) => f.counts[k] !== undefined).map((k) => `${k} ${f.counts[k]}`).join(" · ")} · virtual time {f.at} ms{f.checkpoint ? ` · checkpoint ${f.checkpoint}` : ""}</p>
            </div>
            {f.rejected?.length ? <Table caption="Quarantined rows" rows={f.rejected as unknown as Record<string, unknown>[]} /> : null}
            {f.rows ? <Table caption={`Rows after ${f.stage}`} rows={f.rows} /> : null}
          </div>
        ) : null}
        bottom={(
          <div className="space-y-2">
            <PlaybackBar pb={pb} labels={run.frames.map((x) => x.title)} />
            <p className="text-xs text-ink-muted" role="status">Run result: <strong>{run.status}</strong> · {run.retries} retr{run.retries === 1 ? "y" : "ies"} · {run.quarantine.length} quarantined · {run.deadLetter.length} dead-lettered · next checkpoint {run.checkpoint ?? "unchanged"} · {run.durationMs} virtual ms <ProvenanceBadge p="simulated" /></p>
          </div>
        )}
      />
    </div>
  );
}

function Scd2() {
  const dim: DimRow[] = [{ key: "ana", city: "Oslo", from: "2025-01-01", to: null, current: true }, { key: "ben", city: "Rome", from: "2025-01-01", to: null, current: true }];
  const [moved, setMoved] = useState(true);
  const r = useMemo(() => applyScd2(dim, [{ key: "ana", city: moved ? "Lima" : "Oslo", on: "2026-03-01" }, { key: "cy", city: "Kyiv", on: "2026-03-01" }]), [moved]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-2 text-sm"><label className="flex items-center gap-1 text-xs text-ink-muted"><input type="checkbox" checked={moved} onChange={(e) => setMoved(e.target.checked)} /> Ana moves to Lima on 2026-03-01</label>
      <Table caption="Before" rows={dim as unknown as Record<string, unknown>[]} /><Table caption="After SCD type 2" rows={r.dim as unknown as Record<string, unknown>[]} />
      <ul className="list-disc pl-5 text-xs text-ink-muted">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
  );
}

function Cdc() {
  const feed: Change[] = [{ seq: 1, op: "insert", id: 3, value: 30 }, { seq: 2, op: "update", id: 1, value: 15 }, { seq: 3, op: "delete", id: 2 }];
  const [replay, setReplay] = useState(false);
  const base = { 1: 10, 2: 20 };
  const once = useMemo(() => applyCdc(base, feed), []); // eslint-disable-line react-hooks/exhaustive-deps
  const twice = useMemo(() => applyCdc(once.table, feed), [once]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = replay ? twice : once;
  return (
    <div className="space-y-2 text-sm"><label className="flex items-center gap-1 text-xs text-ink-muted"><input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} /> Replay the same change feed a second time</label>
      <Table caption="Table before" rows={Object.entries(base).map(([id, value]) => ({ id, value }))} /><Table caption={replay ? "After the feed, twice" : "After the feed"} rows={Object.entries(shown.table).map(([id, value]) => ({ id, value }))} />
      <ul className="list-disc pl-5 text-xs text-ink-muted">{shown.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      {replay && <p className="text-xs text-ink-muted">The table is identical after the replay: each change is keyed, so applying the feed again is safe.</p>}</div>
  );
}

function Dag() {
  const [fail, setFail] = useState<string>("transform");
  const tasks: Task[] = [{ id: "extract", deps: [] }, { id: "validate", deps: ["extract"] }, { id: "transform", deps: ["validate"], fails: fail === "transform" }, { id: "load", deps: ["transform"] }, { id: "report", deps: ["load"] }, { id: "audit", deps: ["validate"], fails: fail === "audit" }];
  const r = runDag(tasks);
  return (
    <div className="space-y-2 text-sm"><label className="text-xs text-ink-muted">Make this task fail <select className={`${sel} ml-1`} value={fail} onChange={(e) => setFail(e.target.value)}><option value="">None</option>{tasks.map((t) => <option key={t.id}>{t.id}</option>)}</select></label>
      <ol className="space-y-1">{r.order.map((id) => <li key={id} className={`rounded border px-2 py-1 text-xs ${r.state[id] === "success" ? "border-success/40 bg-success-dim" : r.state[id] === "failed" ? "border-danger/50 bg-danger-dim" : "border-surface-border bg-surface-soft"}`}><strong>{id}</strong> after [{tasks.find((t) => t.id === id)!.deps.join(", ") || "nothing"}]: {r.state[id]}</li>)}</ol>
      <p className="text-xs text-ink-muted">A task runs only when everything it depends on succeeded. When one fails, tasks downstream of it are skipped, while independent branches still run.</p></div>
  );
}

const TABS = [["pipeline", "Pipeline run"], ["scd2", "Slowly changing dimension"], ["cdc", "Change data capture"], ["dag", "Dependencies"]] as const;

export function EtlPlayback() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("pipeline");
  return (
    <section aria-label="ETL pipeline playback" className="space-y-3">
      <div role="tablist" aria-label="ETL topic" className="flex flex-wrap gap-1.5">{TABS.map(([id, label]) => <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${tab === id ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>{label}</button>)}</div>
      {tab === "pipeline" && <Pipeline />}{tab === "scd2" && <Scd2 />}{tab === "cdc" && <Cdc />}{tab === "dag" && <Dag />}
    </section>
  );
}
