import { useMemo, useState } from "react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { DEFAULT_OPTIONS, SCENARIOS, backoffSchedule, runScenario, type ApiFrame, type Options, type ScenarioId } from "../../lib/visual/apiSim";

const sel = "rounded-md border border-surface-border bg-surface px-1.5 py-1 text-xs text-ink";
const json = (v: unknown) => JSON.stringify(v, null, 2);

function Kv({ title, data }: { title: string; data: Record<string, string> | undefined }) {
  const e = Object.entries(data ?? {});
  if (!e.length) return null;
  return <div><p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{title}</p><ul className="font-mono text-xs text-ink">{e.map(([k, v]) => <li key={k}><span className="text-ink-muted">{k}:</span> {v}</li>)}</ul></div>;
}

function FrameDetail({ f }: { f: ApiFrame }) {
  const status = f.res?.status;
  return (
    <div className="space-y-2">
      <div className={`rounded-lg border p-2 text-sm ${f.phase === "error" ? "border-danger/50 bg-danger-dim" : f.phase === "wait" || f.phase === "retry" ? "border-warn/50 bg-warn-dim" : "border-surface-border bg-surface-soft"}`} role="status" aria-live="polite">
        <p className="font-semibold text-ink">{f.title}</p>
        <p className="text-ink-muted">{f.detail}</p>
        <p className="mt-1 text-xs tabular-nums text-ink-faint">Virtual time {f.at} ms</p>
      </div>
      {f.req && (
        <div className="rounded-lg border border-surface-border p-2">
          <p className="font-mono text-xs font-semibold text-ink">{f.req.method} {f.req.url}</p>
          <Kv title="Query parameters" data={f.req.query} />
          <Kv title="Headers" data={f.req.headers} />
          {f.req.body !== undefined && <div><p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Body</p><pre className="font-mono text-xs text-ink">{json(f.req.body)}</pre></div>}
        </div>
      )}
      {f.res && (
        <div className="rounded-lg border border-surface-border p-2">
          <p className={`font-mono text-xs font-semibold ${status && status >= 400 ? "text-danger" : status === 0 ? "text-warn" : "text-success"}`}>{f.res.timedOut ? "No response (timed out)" : `${status} ${f.res.statusText}`} <span className="font-normal text-ink-faint">· {f.res.ms} ms</span></p>
          <Kv title="Headers" data={f.res.headers} />
          {f.res.body !== undefined && <pre className="max-h-48 overflow-auto font-mono text-xs text-ink">{json(f.res.body)}</pre>}
        </div>
      )}
      {f.collected !== undefined && <p className="text-xs text-ink-muted">Collected so far: <strong>{f.collected}</strong></p>}
    </div>
  );
}

/** Interactive request lifecycle on a deterministic mock server. No real network request is ever made. */
export function ApiStudio() {
  const [id, setId] = useState<ScenarioId>("ratelimit-429");
  const [o, setO] = useState<Options>(DEFAULT_OPTIONS);
  const run = useMemo(() => runScenario(id, o), [id, o]);
  const pb = usePlayback(run.frames.length);
  const f = run.frames[pb.index];
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const set = <K extends keyof Options>(k: K, v: Options[K]) => { setO((x) => ({ ...x, [k]: v })); pb.dispatch({ type: "restart" }); };
  return (
    <section aria-label="API request studio" className="space-y-3">
      <div role="tablist" aria-label="Scenario" className="flex flex-wrap gap-1.5">
        {SCENARIOS.map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === id} type="button" onClick={() => { setId(s.id); pb.dispatch({ type: "restart" }); }}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.id === id ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>{s.label}</button>
        ))}
      </div>
      <p className="text-sm text-ink-muted">{sc.teaches} <ProvenanceBadge p="simulated" /></p>
      <VisualShell
        left={(
          <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-surface-border p-2 text-xs">
            <legend className="px-1 font-semibold text-ink">Client settings</legend>
            <label className="text-ink-muted">Credentials<select className={`${sel} mt-0.5 w-full`} value={o.token} onChange={(e) => set("token", e.target.value as Options["token"])}>
              <option value="valid">Valid token</option><option value="missing">No token</option><option value="expired">Expired token</option><option value="readonly">Read-only token</option></select></label>
            <label className="text-ink-muted">Max retries<input type="number" min={0} max={6} className={`${sel} mt-0.5 w-full`} value={o.maxRetries} onChange={(e) => set("maxRetries", Math.max(0, Math.min(6, Number(e.target.value))))} /></label>
            <label className="text-ink-muted">Backoff base (ms)<input type="number" min={50} max={2000} step={50} className={`${sel} mt-0.5 w-full`} value={o.baseDelayMs} onChange={(e) => set("baseDelayMs", Math.max(50, Math.min(2000, Number(e.target.value))))} /></label>
            <label className="text-ink-muted">Timeout (ms)<input type="number" min={100} max={5000} step={100} className={`${sel} mt-0.5 w-full`} value={o.timeoutMs} onChange={(e) => set("timeoutMs", Math.max(100, Math.min(5000, Number(e.target.value))))} /></label>
            <label className="text-ink-muted">Page size<input type="number" min={1} max={10} className={`${sel} mt-0.5 w-full`} value={o.pageSize} onChange={(e) => set("pageSize", Math.max(1, Math.min(10, Number(e.target.value))))} /></label>
            <div className="space-y-1 text-ink-muted">
              <label className="flex items-center gap-1"><input type="checkbox" checked={o.honorRetryAfter} onChange={(e) => set("honorRetryAfter", e.target.checked)} /> Honour Retry-After</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={o.idempotencyKey} onChange={(e) => set("idempotencyKey", e.target.checked)} /> Send Idempotency-Key</label>
            </div>
            <p className="col-span-2 text-ink-faint">Backoff schedule for {o.maxRetries} retries: {backoffSchedule(o.maxRetries, o.baseDelayMs).join(", ") || "none"} ms. Requests go to a built-in mock server only.</p>
          </fieldset>
        )}
        right={f ? <FrameDetail f={f} /> : null}
        bottom={(
          <div className="space-y-2">
            <PlaybackBar pb={pb} labels={run.frames.map((x) => x.title)} />
            <p className="text-xs text-ink-muted" role="status">Result: {run.summary} ({run.requests} request{run.requests === 1 ? "" : "s"}, {run.totalMs} virtual ms)</p>
          </div>
        )}
      />
    </section>
  );
}
