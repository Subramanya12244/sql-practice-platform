import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { PlaybackBar, ProvenanceBadge, usePlayback } from "./Playback";
import { Skeleton } from "../ui";
import { useReducedMotion } from "../../lib/visual/motion";
import { beatAt, buildDataBeats } from "../../lib/visual/dataBeats";
import { DATA_PRESETS, LEGACY_DATA_PRESETS, resolveDataPreset, type DataPreset } from "../../workspace/adapters/data/presets";
import { numpyAdapter, pandasAdapter, type DataDomain } from "../../workspace/adapters/data/adapter";
import { Visualizer } from "../../workspace/visualizers/data/LazyDataVisualizer";
import type { DataModelData, DataSnap } from "../../lib/visual/dataframe";
import type { ExerciseDef, FeedbackItem, RunOutcome, VisualModel } from "../../workspace/types";

const CodeEditor = lazy(() => import("../CodeEditor"));

const chip = "rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink aria-pressed:border-accent aria-pressed:text-ink";
const btnPrimary = "inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const btnGhost = "rounded-lg border border-surface-border px-3 py-2 text-sm font-medium text-ink-muted hover:text-ink disabled:opacity-50";
const box = "rounded-lg border border-surface-border p-2";

const DEFAULT_PRESET = DATA_PRESETS.find((p) => p.id === "pd-select-filter")!;
const LEGACY_TARGETS = new Set(LEGACY_DATA_PRESETS.map((l) => l.presetId));

/** pandas when the code imports it, else NumPy when it imports that. Only the labels differ; both adapters run the same probe. */
export function dataDomainOf(code: string, preset?: DataPreset): DataDomain {
  if (preset && preset.code === code) return preset.domain;
  if (/^\s*(?:import\s+pandas|from\s+pandas)\b/m.test(code)) return "pandas";
  if (/^\s*(?:import\s+numpy|from\s+numpy)\b/m.test(code)) return "numpy";
  return "pandas";
}

/** The exercise the shared adapter needs: nothing is graded on this page (`validation: none`). */
function studioExercise(domain: DataDomain, code: string): ExerciseDef {
  return {
    id: "visual:data", domain, source: { kind: "authored", id: "visual-data" }, title: "Pandas and NumPy Studio", difficulty: "Easy", topic: "visual",
    statement: "Free exploration: run your own pandas or NumPy code and watch each operation.", objectives: [], concepts: [], starterCode: code,
    validation: { kind: "none" }, hints: [], visualization: { enabled: true },
  };
}

interface Shown { code: string; domain: DataDomain; outcome: RunOutcome; model: VisualModel | null; message: string | null; feedback: FeedbackItem[]; visual: boolean }

function SourceList({ code, line }: { code: string; line: number }) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: "nearest" }); }, [line]);
  return (
    <ol className="max-h-56 overflow-auto rounded-lg border border-surface-border bg-surface-soft py-1 font-mono text-xs" aria-label="Source code">
      {code.split("\n").map((l, n) => (
        <li key={n} ref={n + 1 === line ? ref : undefined} aria-current={n + 1 === line ? "step" : undefined} className={`flex gap-2 px-2 ${n + 1 === line ? "bg-accent-dim text-ink" : "text-ink-muted"}`}>
          <span className="w-6 shrink-0 select-none text-right text-ink-faint">{n + 1}</span>
          <span className="whitespace-pre">{l || " "}</span>
        </li>
      ))}
    </ol>
  );
}

function FinalVariables({ finals }: { finals: Record<string, DataSnap> }) {
  const rows = Object.entries(finals);
  if (!rows.length) return <p className="text-xs text-ink-faint">The program finished without a DataFrame, Series or array variable.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" aria-label="Final variables">
        <thead><tr className="text-ink-faint"><th className="pr-3 font-semibold">Name</th><th className="pr-3 font-semibold">Kind</th><th className="pr-3 font-semibold">Shape</th><th className="font-semibold">Dtype</th></tr></thead>
        <tbody>{rows.map(([name, s]) => (
          <tr key={name}><td className="py-0.5 pr-3"><code className="font-semibold text-ink">{name}</code></td><td className="pr-3 text-ink-muted">{s.k === "df" ? "DataFrame" : s.k === "series" ? "Series" : s.k === "nd" ? "ndarray" : s.k === "group" ? "GroupBy" : s.k}</td><td className="pr-3 tabular-nums">{s.shape ? `(${s.shape.join(", ")})` : ""}</td><td className="text-ink-muted">{s.k === "df" ? (s.colDtypes ?? s.dtypes ?? []).join(", ") : s.dtype ?? ""}</td></tr>
        ))}</tbody>
      </table>
      <p className="mt-1 text-[11px] text-ink-faint">The values the variables hold when the program ends. Use the stage player for every step before that.</p>
    </div>
  );
}

function Outcome({ s }: { s: Shown }) {
  const o = s.outcome;
  const t = o.table;
  return (
    <section aria-label="Run output" className="space-y-2">
      {o.status === "ok" ? <p className="text-xs text-ink-muted" role="status">The program ran in {Math.round(o.durationMs)} ms.</p> : (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger-dim p-2 text-sm text-ink">{o.status === "timeout" ? "The program took too long, so it was stopped." : o.status === "stopped" ? "Stopped." : `The program stopped with ${o.error?.message ?? "an error"}${o.error?.line ? ` (line ${o.error.line})` : ""}.`}</p>
      )}
      {o.stdout ? <div className={box}><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Printed output</p><pre className="whitespace-pre-wrap font-mono text-xs text-ink">{o.stdout}</pre></div> : null}
      {t && <div className="overflow-x-auto"><table className="border-collapse text-left" aria-label="Last table the program produced">
        <thead><tr>{t.columns.map((c, i) => <th key={i} className="border border-surface-border bg-surface-soft px-1.5 py-0.5 text-xs font-semibold">{c}</th>)}</tr></thead>
        <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-surface-border px-1.5 py-0.5 text-xs tabular-nums">{c === null ? "NaN" : String(c)}</td>)}</tr>)}</tbody>
      </table>{t.truncated && <p className="mt-1 text-[11px] text-ink-faint">Only the first rows are shown.</p>}</div>}
      {s.feedback.length > 0 && (
        <div className={`${box} space-y-1 text-xs`} data-testid="data-feedback">
          <p className="font-semibold text-ink">What went wrong</p>
          {s.feedback.map((f, i) => <p key={i} className="text-ink-muted"><span className="font-semibold text-ink">{f.category}.</span> {f.message}{f.suggestion ? ` ${f.suggestion}` : ""}</p>)}
        </div>
      )}
    </section>
  );
}

/**
 * The Pandas and NumPy Studio. Your code runs once through the shared data adapter (`workspace/adapters/data`), which uses the same
 * Pyodide worker as every Python exercise and records real tables and arrays at every operation. The stage view is the shared
 * `DataVisualizer`, driven by the shared player. A failed run still shows the failing stage with the library's real error.
 */
export function DataStudio({ presetParam, run }: { presetParam?: string; run?: { pandas: typeof pandasAdapter; numpy: typeof numpyAdapter } }) {
  const adapters = run ?? { pandas: pandasAdapter, numpy: numpyAdapter };
  const start = resolveDataPreset(presetParam) ?? DEFAULT_PRESET;
  const [code, setCode] = useState(start.code);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState<"run" | "visual" | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [tab, setTab] = useState<"tables" | "final">("tables");
  const reduced = useReducedMotion();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => () => abort.current?.abort(), []);

  const current = shown && shown.code === code ? shown : null;
  const model = current?.model ?? null;
  const data = model?.data as DataModelData | undefined;
  const pb = usePlayback(model?.steps ?? 0);
  const failedRun = !!current && current.outcome.status === "error";
  const modelId = useRef<VisualModel | null>(null);
  // Layout effect: the player must already sit on its starting stage when the first frame of a new model is painted.
  useLayoutEffect(() => {
    if (!model || modelId.current === model) return;
    modelId.current = model;
    setTab("tables");
    pb.dispatch({ type: "count", count: model.steps ?? 0 });
    pb.dispatch({ type: "seek", index: failedRun ? Math.max(0, (model.steps ?? 1) - 1) : 0 }); // a failed run opens on the stage that raised
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => abort.current?.abort(), []);
  const go = useCallback(async (visual: boolean) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const domain = dataDomainOf(code, DATA_PRESETS.find((p) => p.code === code));
    const adapter = adapters[domain];
    const ctx = { exercise: studioExercise(domain, code), signal: ctrl.signal };
    setBusy(visual ? "visual" : "run");
    try {
      const reuse = shown && shown.code === code && shown.outcome.status !== "stopped" ? shown.outcome : null;
      const outcome = reuse ?? await adapter.run(code, ctx);
      if (ctrl.signal.aborted || outcome.status === "stopped") { if (outcome.status === "stopped" || ctrl.signal.aborted) setShown(null); return; }
      let m: VisualModel | null = null;
      let message: string | null = null;
      if (visual) {
        if (outcome.status === "ok" || (outcome.status === "error" && adapter.visualizeOnError)) m = await adapter.visualize!(code, outcome, ctx);
        if (ctrl.signal.aborted) return;
        if (!m) message = outcome.status === "timeout" ? "The program took too long, so no stages were recorded." : outcome.status === "error" ? "Nothing ran far enough to record a stage (for example a syntax error), so there is nothing to step through." : "Your code ran, but it created no DataFrame, Series or array to show.";
      }
      const feedback = outcome.status === "error" ? adapter.explainFailure!(code, outcome, null, ctx) : [];
      setShown({ code, domain, outcome, model: m, message, feedback, visual });
    } catch (e) {
      if (!ctrl.signal.aborted) setShown({ code, domain, outcome: { status: "error", durationMs: 0, error: { message: e instanceof Error ? e.message : String(e) } }, model: null, message: null, feedback: [], visual });
    } finally {
      if (abort.current === ctrl) { abort.current = null; setBusy(null); }
    }
  }, [adapters, code, shown]);

  const legacy = useMemo(() => LEGACY_DATA_PRESETS.map((l) => ({ label: l.label, preset: DATA_PRESETS.find((p) => p.id === l.presetId)! })), []);
  const rest = useMemo(() => DATA_PRESETS.filter((p) => !LEGACY_TARGETS.has(p.id)), []);
  const groups: [string, DataPreset[]][] = [
    ["More pandas examples", rest.filter((p) => p.domain === "pandas")],
    ["More NumPy examples", rest.filter((p) => p.domain === "numpy" && !p.fails)],
    ["Invalid operations (these raise on purpose, to show the real error)", rest.filter((p) => p.fails)],
  ];
  const pick = (p: DataPreset) => { setCode(p.code); };
  const domain = dataDomainOf(code, DATA_PRESETS.find((p) => p.code === code));
  const limitations = adapters[domain].limitations ?? [];
  const beats = useMemo(() => (data ? buildDataBeats(data) : []), [data]);
  const st = data ? data.stages[beatAt(beats, pb.index)?.stage ?? 0] : undefined;

  return (
    <div className="space-y-3 pb-16">
      <p className="text-sm text-ink-muted">Each step shows the real table or array your code produced, from a real run in your browser. Changed cells are highlighted, with shape and dtype changes explained.</p>
      <div className="space-y-2" role="group" aria-label="Examples">
        <div className="flex flex-wrap gap-2">
          {legacy.map(({ label, preset }) => <button key={label} type="button" onClick={() => pick(preset)} aria-pressed={code === preset.code} className={chip}>{label}</button>)}
        </div>
        {groups.map(([title, list]) => list.length > 0 && (
          <details key={title} className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-ink-muted">{title}</summary>
            <div className="mt-1.5 flex flex-wrap gap-2">{list.map((p) => <button key={p.id} type="button" onClick={() => pick(p)} aria-pressed={code === p.code} className={chip}>{p.title}</button>)}</div>
          </details>
        ))}
      </div>
      {mounted ? <Suspense fallback={<Skeleton className="h-[220px]" />}><CodeEditor value={code} onChange={setCode} onRun={() => void go(true)} height={220} language="python" label="Python code to trace" /></Suspense> : <Skeleton className="h-[220px]" />}

      <section aria-label="Python code time machine" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void go(true)} disabled={busy !== null || !code.trim()} className={btnPrimary}>
            {busy === "visual" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {current?.visual ? "Trace again" : "Explain visually"}
          </button>
          <button type="button" onClick={() => void go(false)} disabled={busy !== null || !code.trim()} className={btnGhost}>
            {busy === "run" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden />}Run
          </button>
          {busy && <button type="button" onClick={stop} className={btnGhost}>Stop</button>}
          <span className="text-xs text-ink-faint">Runs your code once in the browser and records every operation. The first run downloads Python and pandas or NumPy.</span>
        </div>

        {current && <Outcome s={current} />}
        {current?.visual && !model && current.message && <p role="status" className="rounded-lg bg-surface-soft p-3 text-sm text-ink-muted">{current.message}</p>}
        {current && !current.visual && current.outcome.status !== "stopped" && <p className="text-xs text-ink-faint">Press Explain visually to step through each operation of this run.</p>}

        {model && data && (
          <div className="space-y-3">
            <div role="tablist" aria-label="View" className="flex gap-1 text-xs">
              {([["tables", "Tables and arrays"], ["final", "Final variables"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full px-2.5 py-1 font-medium ${tab === id ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>{label}</button>
              ))}
              <span className="ml-auto self-center"><ProvenanceBadge p={model.provenance} /></span>
            </div>
            {tab === "tables" ? (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="min-w-0 space-y-2">
                  <SourceList code={code} line={st?.line ?? 0} />
                  <PlaybackBar pb={pb} labels={beats.map((b) => (b.of > 1 ? `${data.analyses[b.stage].title}: ${b.title}` : b.title))} />
                </div>
                <div className="min-w-0">
                  <Suspense fallback={<Skeleton className="h-[220px]" />}>
                    <Visualizer model={model} step={pb.index} onStepChange={(i) => pb.dispatch({ type: "seek", index: i })} reducedMotion={reduced} hostPlayer />
                  </Suspense>
                </div>
              </div>
            ) : <FinalVariables finals={data.finals} />}
          </div>
        )}
      </section>

      {limitations.length > 0 && (
        <details className="rounded-lg border border-surface-border p-2 text-xs text-ink-muted">
          <summary className="cursor-pointer font-medium text-ink">Not supported here</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
