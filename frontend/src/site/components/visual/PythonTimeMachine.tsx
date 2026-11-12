import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { PlaybackBar, ProvenanceBadge, VisualShell, usePlayback } from "./Playback";
import { changeBase, changedVars, costNotes, describeStep, lineCounts, memoryAt, traceRun, type PyVal, type Trace, type TraceGap, type TraceRun } from "../../lib/visual/pyTrace";
import { PAGE_SIZE, gapAfter, gapBefore, gapLabel, gapSummary, jumpTargets, num, pageCount, pageOf, pageRows, stepPosition } from "../../lib/visual/traceStore";
import { describeDataChange, diffGrids, gridOf } from "../../lib/visual/dataDiff";

const cellCls = "border border-surface-border px-1.5 py-0.5 text-xs tabular-nums";

/** A captured DataFrame, Series or array as a grid. Changed cells (against `before`) are highlighted. */
export function DataGrid({ v, before, caption }: { v: PyVal; before?: PyVal; caption?: string }) {
  const g = gridOf(v);
  if (!g) return null;
  const d = before ? diffGrids(gridOf(before), g) : null;
  const changed = new Set((d?.changed ?? []).map((c) => `${c.row}:${c.col}`));
  const addedCols = new Set(d?.addedCols ?? []), addedRows = new Set(d?.addedRows ?? []);
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-left" aria-label={caption ?? `${v.k} values`}>
        {caption && <caption className="mb-1 text-left text-xs text-ink-faint">{caption}</caption>}
        <thead>
          <tr><th className={`${cellCls} bg-surface-soft`} />{g.colLabels.map((c, i) => (
            <th key={i} className={`${cellCls} bg-surface-soft font-semibold ${addedCols.has(c) ? "bg-accent-dim text-accent" : ""}`}>{c}{v.dtypes?.[i] ? <span className="block text-[10px] font-normal text-ink-faint">{v.dtypes[i]}</span> : null}</th>
          ))}</tr>
        </thead>
        <tbody>{g.cells.map((row, r) => (
          <tr key={r}>
            <th className={`${cellCls} bg-surface-soft font-medium ${addedRows.has(g.rowLabels[r]) ? "text-accent" : ""}`}>{g.rowLabels[r]}</th>
            {row.map((c, ci) => (
              <td key={ci} className={`${cellCls} ${changed.has(`${r}:${ci}`) ? "bg-warn-dim font-semibold text-ink" : addedCols.has(g.colLabels[ci]) ? "bg-accent-dim" : ""} ${c === null ? "italic text-ink-faint" : "text-ink"}`}
                title={changed.has(`${r}:${ci}`) ? "Changed in this step" : undefined}>{c === null ? "NaN" : c}</td>
            ))}
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-1 text-[11px] text-ink-faint">
        {v.shape ? `shape (${v.shape.join(", ")})` : ""}{v.dtype ? ` · dtype ${v.dtype}` : ""}{v.na?.some((n) => n > 0) ? ` · missing per column: ${v.na.join(", ")}` : ""}{v.more ? " · only the first rows and columns are shown" : ""}
      </p>
    </div>
  );
}

/** One value drawn as boxes (list, tuple, set, deque), key-value rows (dict), a grid (data) or text. Children come from the value table. */
export function ValueView({ t, idx, depth = 0 }: { t: Trace; idx: number; depth?: number }) {
  const v = t.vals[idx];
  if (!v) return null;
  const child = (i: number) => (depth < 2 ? <ValueView t={t} idx={i} depth={depth + 1} /> : <code className="text-xs">{t.vals[i]?.r}</code>);
  if ((v.k === "list" || v.k === "tuple" || v.k === "set" || v.k === "frozenset" || v.k === "deque") && v.items) {
    return (
      <div className="flex flex-wrap items-stretch gap-1" role="list" aria-label={`${v.k} with ${v.n} items`}>
        <span className="self-center pr-1 text-[10px] uppercase tracking-wider text-ink-faint">{v.k}</span>
        {(v.items ?? []).map((i, n) => (
          <div key={n} role="listitem" className="rounded border border-surface-border bg-surface-soft px-1.5 py-0.5 text-center">
            {v.k === "list" || v.k === "tuple" || v.k === "deque" ? <div className="text-[10px] text-ink-faint">{n}</div> : null}
            <div className="text-xs text-ink">{child(i)}</div>
          </div>
        ))}
        {v.more && <span className="self-center text-xs text-ink-faint">… {v.n} items in all</span>}
        {v.n === 0 && <span className="self-center text-xs text-ink-faint">empty</span>}
      </div>
    );
  }
  if (v.k === "dict" && v.items) {
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < (v.items?.length ?? 0); i += 2) pairs.push([v.items![i], v.items![i + 1]]);
    return (
      <table className="text-xs" aria-label={`dict with ${v.n} items`}><tbody>
        {pairs.map(([k, val], n) => <tr key={n}><td className="border border-surface-border bg-surface-soft px-1.5 py-0.5 font-medium text-ink">{child(k)}</td><td className="px-1 text-ink-faint" aria-hidden>→</td><td className="border border-surface-border px-1.5 py-0.5 text-ink">{child(val)}</td></tr>)}
        {v.n === 0 && <tr><td className="text-ink-faint">empty dict</td></tr>}
        {v.more && <tr><td colSpan={3} className="text-ink-faint">… {v.n} items in all</td></tr>}
      </tbody></table>
    );
  }
  if (v.k === "df" || v.k === "series" || v.k === "nd") return <DataGrid v={v} />;
  if (v.k === "obj") {
    return (
      <div className="rounded border border-surface-border p-1.5 text-xs">
        <span className="font-semibold text-ink">{v.t}</span>
        <ul>{Object.entries(v.attrs ?? {}).map(([a, i]) => <li key={a}><span className="text-ink-muted">.{a} →</span> {child(i)}</li>)}</ul>
      </div>
    );
  }
  if (v.k === "gen") return <span className="text-xs text-ink">generator <code>{v.r}</code> <span className="text-ink-faint">({v.state?.replace("GEN_", "").toLowerCase()})</span></span>;
  return <code className="text-xs text-ink">{v.r}</code>;
}

/** Conceptual memory model: names point at objects; two arrows into one object mean an alias. */
export function MemoryDiagram({ t, i }: { t: Trace; i: number }) {
  const m = memoryAt(t, i);
  if (!m.names.length) return <p className="text-xs text-ink-faint">No variables yet.</p>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 text-xs" aria-label="Memory model">
      <div>
        <p className="mb-1 font-semibold uppercase tracking-wider text-ink-faint">Names</p>
        <ul className="space-y-1">{m.names.map((n) => (
          <li key={`${n.scope}.${n.name}`} className="flex items-center gap-1">
            <code className="rounded bg-surface-soft px-1 text-ink">{n.scope === "<module>" ? n.name : `${n.scope}.${n.name}`}</code>
            <span className="text-ink-faint" aria-hidden>→</span>
            {n.objectId !== undefined ? <span className={`rounded px-1 ${m.aliased.includes(n.objectId) ? "bg-warn-dim text-ink" : "bg-accent-dim text-accent"}`}>object #{n.objectId}</span>
              : <code className="text-ink">{n.val.r}</code>}
          </li>
        ))}</ul>
      </div>
      <div>
        <p className="mb-1 font-semibold uppercase tracking-wider text-ink-faint">Objects</p>
        {m.objects.length === 0 ? <p className="text-ink-faint">Only plain values so far (numbers, text, True/False, None). These cannot be changed in place, so names never share them.</p> : (
          <ul className="space-y-1.5">{m.objects.map((o) => (
            <li key={o.id} className={`rounded-lg border p-1.5 ${m.aliased.includes(o.id) ? "border-warn/50" : "border-surface-border"}`}>
              <p className="text-ink-muted">#{o.id} · {o.val.k} · <span className="font-medium">changeable in place</span>{o.val.k === "tuple" || o.val.k === "frozenset" ? "" : ""}
                {m.aliased.includes(o.id) && <span className="ml-1 text-warn"> shared by {o.names.join(" and ")}: a change through one shows through the other</span>}</p>
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}

/** Highlighted source with the line that is about to run, and how often each line has run in the whole trace. */
function SourcePane({ code, line, counts, exact }: { code: string; line: number; counts: Record<number, number>; exact: boolean }) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: "nearest" }); }, [line]);
  return (
    <ol className="overflow-x-auto rounded-lg border border-surface-border bg-surface-soft py-1 font-mono text-xs" aria-label="Source code">
      {code.split("\n").map((l, n) => (
        <li key={n} ref={n + 1 === line ? ref : undefined} aria-current={n + 1 === line ? "step" : undefined} className={`flex gap-2 px-2 ${n + 1 === line ? "bg-accent-dim text-ink" : "text-ink-muted"}`}>
          <span className="w-6 shrink-0 select-none text-right text-ink-faint">{n + 1}</span>
          <span className="whitespace-pre">{l || " "}</span>
          {counts[n + 1] > 1 && <span className="ml-auto shrink-0 text-[10px] text-ink-faint" title={exact ? "How many times this line ran in the whole run (exact, including steps the trace did not record)" : "How many times this line ran before tracing stopped (a lower bound)"}>{exact ? "" : "≥"}×{num(counts[n + 1])}</span>}
        </li>
      ))}
    </ol>
  );
}

/** One gap, in words, with what the loop did while its steps were skipped. Never lists steps that were not recorded. */
function GapDetail({ t, gap }: { t: Trace; gap: TraceGap }) {
  return (
    <div className="space-y-1">
      <p>{gapSummary(gap)}</p>
      {gap.loops.map((l, n) => (
        <details key={n} className="rounded border border-surface-border p-1.5">
          <summary className="cursor-pointer text-ink">Loop at line {l.line}: iterations {num(l.from)} to {num(l.to)}</summary>
          <p className="mt-1 text-ink-faint">Lines run in these iterations (exact): {Object.entries(l.lines).map(([ln, c]) => `line ${ln} ×${num(c)}`).join(", ") || "none"}</p>
          {l.vars.length > 0 && (
            <table className="mt-1 text-left" aria-label={`Variables over iterations ${l.from} to ${l.to}`}>
              <thead><tr><th className="pr-2 font-semibold">Variable</th><th className="pr-2 font-semibold">First</th><th className="pr-2 font-semibold">Last</th><th className="font-semibold">Changes</th></tr></thead>
              <tbody>{l.vars.map((v) => (
                <tr key={v.name}><td className="pr-2"><code>{v.name}</code></td><td className="pr-2"><code>{t.vals[v.first]?.r}</code></td><td className="pr-2"><code>{t.vals[v.last]?.r}</code></td><td>{num(v.changes)}</td></tr>
              ))}</tbody>
            </table>
          )}
          <p className="mt-1 text-[11px] text-ink-faint">First and last are the loop frame's variables at the start of the first and last summarised iteration; a change is counted when a value differs from the one at the start of the previous summarised iteration.</p>
        </details>
      ))}
    </div>
  );
}

/** Says plainly that this trace is sampled (or stopped early), what that means, and which numbers stay exact. */
function SampledNotice({ t }: { t: Trace }) {
  if (!t.truncated) return null;
  const c = t.counts;
  return (
    <div role="note" aria-label="This trace is sampled" className="rounded-lg border border-warn/50 bg-warn-dim p-2 text-xs text-ink">
      <p className="font-semibold">This trace is sampled{t.detached ? " and stopped early" : ""}.</p>
      <p>
        {c ? `${num(c.events)} traced event${c.events === 1 ? "" : "s"} ran` : "The program ran"}; {num(t.steps.length)} {t.steps.length === 1 ? "step is" : "steps are"} recorded
        {t.skipped ? ` and ${num(t.skipped.steps)} ${t.skipped.steps === 1 ? "was" : "were"} not` : ""}. The first steps, the last steps, checkpoints inside long loops, the deepest call stack and the exception are always kept. Gap markers show what was skipped; those steps do not exist in this view.
      </p>
      {t.detached && (
        <p className="mt-1">
          Tracing stopped after {num(t.detached.atEvent)} events ({t.detached.reason === "events" ? "event budget" : t.detached.reason === "time" ? "time budget" : "tracer error"}); your program then ran to its end untraced with the same output. Line counts are lower bounds. The last step shows the variables when the program finished.
        </p>
      )}
      {c?.exact && <p className="mt-1">Line counts, call counts and the call depth are exact for the whole run.</p>}
    </div>
  );
}

/** Jump buttons: first step, last step, the exception, checkpoints and the next gap. Only recorded steps can be reached. */
function JumpBar({ t, i, go }: { t: Trace; i: number; go: (index: number) => void }) {
  const j = jumpTargets(t, i);
  const b = "rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-40";
  return (
    <div role="group" aria-label="Jump to a recorded step" className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={b} disabled={i === j.first} onClick={() => go(j.first)}>First step</button>
      <button type="button" className={b} disabled={i === j.last} onClick={() => go(j.last)}>Last step</button>
      {j.exception !== null && <button type="button" className={`${b} border-danger/40`} disabled={i === j.exception} onClick={() => go(j.exception!)}>Exception</button>}
      {(t.checkpoints?.length ?? 0) > 0 && (
        <>
          <button type="button" className={b} disabled={j.prevCheckpoint === null} onClick={() => go(j.prevCheckpoint!)}>Previous checkpoint</button>
          <button type="button" className={b} disabled={j.nextCheckpoint === null} onClick={() => go(j.nextCheckpoint!)}>Next checkpoint</button>
        </>
      )}
      {(t.gaps?.length ?? 0) > 0 && <button type="button" className={b} disabled={j.nextGap === null} onClick={() => go(j.nextGap!)}>Next gap</button>}
    </div>
  );
}

/** The recorded steps one page at a time, with a marker wherever steps were skipped. A large trace never renders all its rows. */
function StepList({ t, i, go }: { t: Trace; i: number; go: (index: number) => void }) {
  const pages = pageCount(t.steps.length);
  const [page, setPage] = useState(pageOf(i));
  useEffect(() => setPage(pageOf(i)), [i]); // the page follows the current step; paging by hand only browses
  const rows = useMemo(() => pageRows(t, page), [t, page]);
  const from = page * PAGE_SIZE + 1, to = Math.min(t.steps.length, (page + 1) * PAGE_SIZE);
  const b = "rounded-lg border border-surface-border px-2 py-0.5 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-40";
  return (
    <section aria-label="Recorded steps" className="rounded-lg border border-surface-border p-2">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-ink-faint">Recorded steps</span>
        <span className="tabular-nums text-ink-muted" aria-live="polite">{num(from)} to {num(to)} of {num(t.steps.length)}</span>
        {pages > 1 && (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" className={b} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous page</button>
            <span className="tabular-nums text-ink-muted">Page {num(page + 1)} of {num(pages)}</span>
            <button type="button" className={b} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next page</button>
          </span>
        )}
      </div>
      <ol className="max-h-64 overflow-y-auto text-xs">
        {rows.map((r) => r.type === "gap" ? (
          <li key={`g${r.gap.before}`} data-gap={r.gap.kind} className="my-0.5 rounded border border-dashed border-warn/60 bg-warn-dim px-2 py-1 text-ink">
            <details>
              <summary className="cursor-pointer">⋯ {gapLabel(r.gap)}</summary>
              <div className="mt-1 text-ink-muted"><GapDetail t={t} gap={r.gap} /></div>
            </details>
          </li>
        ) : (
          <li key={r.index}>
            <button type="button" onClick={() => go(r.index)} aria-current={r.index === i ? "step" : undefined}
              className={`flex w-full items-center gap-2 rounded px-2 py-0.5 text-left ${r.index === i ? "bg-accent-dim text-ink" : "text-ink-muted hover:bg-surface-soft"}`}>
              <span className="w-12 shrink-0 tabular-nums text-ink-faint">#{num(r.index + 1)}</span>
              <span className="w-16 shrink-0">{r.step.ev}</span>
              <span>line {r.step.line}</span>
              {r.step.loop && <span className="text-ink-faint">iter {num(r.step.loop[1])}</span>}
              {r.step.cp && <span className="rounded bg-accent-dim px-1 text-accent">checkpoint</span>}
              {r.step.ev === "exception" && <span className="rounded bg-danger-dim px-1 text-ink">exception</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export type TraceView = "variables" | "memory" | "data";

/**
 * The visual execution workspace for one real trace: source with the current line, variables with changes, call stack,
 * data structures, the conceptual memory model, output so far, and costs. `mode="data"` leads with pandas/NumPy tables.
 */
export function TraceViewer({ code, trace, mode = "variables" }: { code: string; trace: Trace; mode?: TraceView }) {
  const pb = usePlayback(trace.steps.length);
  const [tab, setTab] = useState<TraceView>(mode);
  useEffect(() => setTab(mode), [mode]);
  const i = pb.index;
  const step = trace.steps[i];
  const frame = step?.frames[step.frames.length - 1];
  const source = useMemo(() => code.split("\n"), [code]);
  const counts = useMemo(() => lineCounts(trace), [trace]);
  const notes = useMemo(() => costNotes(trace), [trace]);
  const changes = useMemo(() => (step ? changedVars(trace, i) : []), [trace, i, step]);
  const changeOf = (name: string) => changes.find((c) => c.name === name);
  const dataVars = useMemo(() => Object.entries(frame?.vars ?? {}).filter(([, idx]) => ["df", "series", "nd"].includes(trace.vals[idx]?.k)), [frame, trace]);
  const printed = step ? trace.stdout.slice(0, step.out) : "";
  const labels = useMemo(() => trace.steps.map((s) => `Line ${s.line} (${s.ev})`), [trace]);
  const go = (index: number) => pb.dispatch({ type: "seek", index });
  if (!step) return <p className="text-sm text-ink-muted">The program recorded no steps (nothing to run).</p>;
  const last = trace.steps.length - 1;
  const exact = trace.counts ? trace.counts.exact : !trace.truncated;
  const gapNow = gapBefore(trace, i), gapNext = gapAfter(trace, i);
  const base = changeBase(trace, i);

  const left = (
    <>
      <SourcePane code={code} line={step.line} counts={counts} exact={exact} />
      <div className="rounded-lg border border-surface-border p-2" aria-label="Call stack">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Call stack</p>
        <ol className="flex flex-col-reverse gap-1">{step.frames.map((f, n) => (
          <li key={n} className={`rounded border px-2 py-0.5 text-xs ${n === step.frames.length - 1 ? "border-accent bg-accent-dim text-ink" : "border-surface-border text-ink-muted"}`}>
            <code>{f.fn === "<module>" ? "main program" : `${f.fn}()`}</code> <span className="text-ink-faint">line {f.line}</span>
          </li>
        ))}</ol>
      </div>
      <div className="rounded-lg border border-surface-border p-2" aria-label="Program output">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Output so far</p>
        <pre className="min-h-[1.5rem] whitespace-pre-wrap font-mono text-xs text-ink">{printed || <span className="text-ink-faint">nothing printed yet</span>}</pre>
        {trace.stdoutTruncated && <p className="mt-1 text-[11px] text-ink-faint">Showing the first {num(trace.stdout.length)} of {num(trace.stdoutChars ?? 0)} characters the program printed.</p>}
      </div>
    </>
  );

  const right = (
    <>
      <SampledNotice t={trace} />
      <div className="space-y-1.5">
        <p className="text-xs tabular-nums text-ink-muted" data-testid="step-position">{stepPosition(trace, i)}</p>
        <JumpBar t={trace} i={i} go={go} />
      </div>
      {gapNow && <div data-testid="gap-before" className="rounded-lg border border-dashed border-warn/60 bg-warn-dim p-2 text-xs text-ink"><p className="font-semibold">Steps skipped before this one</p><GapDetail t={trace} gap={gapNow} /></div>}
      <div role="status" aria-live="polite" className={`rounded-lg border p-2 text-sm ${step.ev === "exception" ? "border-danger/50 bg-danger-dim text-ink" : "border-surface-border bg-surface-soft text-ink"}`}>
        {describeStep(trace, i, source)}
      </div>
      {!gapNow && base && base.skippedBetween > 0 && <p className="text-[11px] text-ink-faint">{num(base.skippedBetween)} steps ran between this step and the one it is compared with; they were not recorded.</p>}
      {gapNext && <p className="text-[11px] text-ink-faint">The next recorded step comes after a gap: {gapLabel(gapNext)}.</p>}
      <div role="tablist" aria-label="View" className="flex gap-1 text-xs">
        {([["variables", "Variables"], ["memory", "Memory model"], ["data", "Tables and arrays"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full px-2.5 py-1 font-medium ${tab === id ? "bg-accent text-white" : "bg-surface-soft text-ink-muted hover:text-ink"}`}>{label}</button>
        ))}
        <span className="ml-auto self-center"><ProvenanceBadge p={tab === "memory" ? "conceptual" : "executed"} /></span>
      </div>
      {tab === "variables" && (
        <div className="space-y-2">
          {Object.keys(frame?.vars ?? {}).length === 0 && <p className="text-xs text-ink-faint">No variables in this scope yet.</p>}
          {Object.entries(frame?.vars ?? {}).map(([name, idx]) => {
            const ch = changeOf(name);
            return (
              <div key={name} className={`rounded-lg border p-2 ${ch ? "border-warn/60" : "border-surface-border"}`}>
                <p className="mb-1 flex flex-wrap items-center gap-1 text-xs"><code className="font-semibold text-ink">{name}</code>
                  <span className="text-ink-faint">{trace.vals[idx]?.t ?? trace.vals[idx]?.k}</span>
                  {ch?.kind === "new" && <span className="rounded bg-accent-dim px-1 text-accent">new</span>}
                  {ch?.kind === "changed" && <span className="rounded bg-warn-dim px-1 text-ink">changed from <code>{trace.vals[ch.before!]?.r}</code></span>}
                </p>
                <ValueView t={trace} idx={idx} />
              </div>
            );
          })}
          {step.ret !== undefined && <p className="text-xs text-ink-muted">{step.ev === "yield" ? "Yielded" : "Returned"}: <code className="text-ink">{trace.vals[step.ret]?.r}</code></p>}
        </div>
      )}
      {tab === "memory" && (
        <div className="space-y-2">
          <MemoryDiagram t={trace} i={i} />
          <p className="text-[11px] text-ink-faint">A simplified teaching model: names point at objects. Object numbers are counters for this trace, not memory addresses. It does not show how CPython really lays out memory.</p>
        </div>
      )}
      {tab === "data" && (
        <div className="space-y-3">
          {dataVars.length === 0 && <p className="text-xs text-ink-faint">No DataFrame, Series or NumPy array exists at this step. Import pandas or numpy and create one to see it here.</p>}
          {dataVars.map(([name, idx]) => {
            const ch = changeOf(name);
            const before = ch?.kind === "changed" ? trace.vals[ch.before!] : undefined;
            const after = trace.vals[idx];
            const note = describeDataChange(before, after, name);
            return <div key={name} className="space-y-1"><p className="text-xs font-semibold text-ink"><code>{name}</code></p>
              {before && <DataGrid v={before} caption="Before this step" />}
              <DataGrid v={after} before={before} caption={before ? "After (changed cells highlighted)" : "Current value"} />
              {note && <p className="text-xs text-ink-muted">{note}</p>}</div>;
          })}
        </div>
      )}
      {trace.error && (i === last || i === trace.exceptionStep) && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger-dim p-2 text-xs text-ink">Stopped by <strong>{trace.error.type}</strong>: {trace.error.msg}{trace.error.line ? ` (line ${trace.error.line})` : ""}. The values above are what the program held just before it failed.</p>
      )}
    </>
  );

  return (
    <VisualShell
      left={left}
      right={right}
      bottom={
        <div className="space-y-2">
          <PlaybackBar pb={pb} labels={labels} />
          <StepList t={trace} i={i} go={go} />
          <details className="rounded-lg border border-surface-border p-2 text-xs">
            <summary className="cursor-pointer font-semibold text-ink">Cost of this run</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{notes.measured.map((n) => <li key={n}>{n}</li>)}</ul>
            <p className="mt-2 flex items-center gap-1 font-semibold text-ink">Growth notes <ProvenanceBadge p="estimated" /></p>
            <ul className="list-disc space-y-0.5 pl-5 text-ink-muted">{notes.conceptual.map((n) => <li key={n}>{n}</li>)}</ul>
            {trace.truncated && <p className="mt-1 text-warn">{trace.detached ? "Tracing stopped early; the program itself ran to the end." : "Some steps are not recorded (see the gap markers). The program itself ran to the end."}</p>}
          </details>
        </div>
      }
    />
  );
}

/** Run `code` under the tracer in the browser and play the result. The learner's own run and grading are not involved. */
export function PythonTimeMachine({ code, stdin = "", mode = "variables", autoStart = false, run = traceRun }: { code: string; stdin?: string; mode?: TraceView; autoStart?: boolean; run?: typeof traceRun }) {
  const [state, setState] = useState<{ phase: "idle" | "busy" | "done"; out?: TraceRun }>({ phase: "idle" });
  const started = useRef(false);
  async function go() {
    setState({ phase: "busy" });
    const out = await run(code, stdin);
    setState({ phase: "done", out });
  }
  useEffect(() => { if (autoStart && !started.current) { started.current = true; void go(); } }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-label="Python code time machine" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={go} disabled={state.phase === "busy" || !code.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {state.phase === "busy" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {state.phase === "done" ? "Trace again" : "Explain visually"}
        </button>
        <span className="text-xs text-ink-faint">Runs your code once in the browser and records every step. The first run downloads Python.</span>
      </div>
      {state.phase === "done" && state.out && (state.out.trace ? <TraceViewer code={code} trace={state.out.trace} mode={mode} /> : (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger-dim p-2 text-sm text-ink">
          The trace could not be recorded{state.out.result.error ? `: ${state.out.result.error.split("\n").slice(-1)[0]}` : "."}{state.out.result.phase === "timeout" ? " The program took too long, so it was stopped." : ""}
        </p>
      ))}
    </section>
  );
}
