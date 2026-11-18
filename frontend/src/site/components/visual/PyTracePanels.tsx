import { useMemo, useState, type ReactNode } from "react";
import type { Trace } from "../../lib/visual/pyTrace";
import { num } from "../../lib/visual/traceStore";
import { availableMoves, move, STEP_RULES, type StepMode, type StepMove } from "../../lib/visual/pyStepper";
import { branchAtStep, branchStats, loopExitsAtStep, loopsAtStep, type BranchStat, type SourceMap } from "../../lib/visual/pyBranches";
import type { Diagnosis } from "../../lib/visual/pyDiagnose";
import { PYTHON_LIMITATIONS } from "../../workspace/adapters/python/limitations";

/**
 * Panels shared by the workspace's PythonTraceVisualizer and the Code Time Machine's TraceViewer, so step over/into/out/back,
 * the branch and loop view, the error diagnosis and the "not supported" list exist once (pyStepper, pyBranches, pyDiagnose and the
 * Python adapter's limitations). Nothing here records or infers steps: it reads one recorded trace.
 */
const btn = "rounded-lg border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const card = "rounded-lg border border-surface-border p-2";

export function BranchStatsTable({ stats }: { stats: BranchStat[] }) {
  if (!stats.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-ink">Branch and loop counts for the whole run</summary>
      <table className="mt-1 w-full text-left" aria-label="Branch and loop counts">
        <thead><tr className="text-ink-faint"><th className="pr-2 font-semibold">Line</th><th className="pr-2 font-semibold">Statement</th><th className="pr-2 font-semibold">Checked</th><th className="pr-2 font-semibold">Taken</th><th className="pr-2 font-semibold">Not taken</th><th className="font-semibold">Loop ended</th></tr></thead>
        <tbody>{stats.map((s) => (
          <tr key={`${s.construct.kind}${s.construct.line}`}>
            <td className="pr-2 tabular-nums">{s.construct.line}</td>
            <td className="pr-2"><code>{s.construct.kind}{s.construct.kind === "else" ? "" : ` ${s.construct.kind === "for" ? `${s.construct.target} in ${s.construct.cond}` : s.construct.cond}`}</code></td>
            <td className="pr-2 tabular-nums">{s.construct.kind === "else" ? "n/a" : `${s.exact ? "" : "≥"}${num(s.evaluations)}`}</td>
            <td className="pr-2 tabular-nums">{s.exact ? "" : "≥"}{num(s.taken)}</td>
            <td className="pr-2 tabular-nums">{s.construct.kind === "else" ? "n/a" : num(s.notTaken)}</td>
            <td className="tabular-nums">{s.finishedNormally === undefined ? "" : `${num(s.finishedNormally)} normally${s.leftEarly !== undefined ? `, ${num(s.leftEarly)} early (break, return or error)` : ""}`}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-1 text-[11px] text-ink-faint">From the tracer's exact line counts: how often the condition line ran and how often the first line of its body ran. {stats.some((s) => !s.exact) ? "Tracing stopped early, so these are lower bounds." : "Exact for the whole run, including steps the view does not show."}</p>
    </details>
  );
}

export function DiagnosisCard({ d, open }: { d: Diagnosis; open: boolean }) {
  return (
    <details open={open} className={`${card} border-danger/40 bg-danger-dim text-xs text-ink`} data-testid="diagnosis">
      <summary className="cursor-pointer text-sm font-semibold">Why it failed: {d.errorType}{d.line ? ` on line ${d.line}` : ""}</summary>
      <div className="mt-2 space-y-2">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1">
          <dt className="font-semibold">Error type</dt><dd><code>{d.errorType}</code> <span className="text-ink-faint">({d.category}, {d.confidence})</span></dd>
          {d.message && <><dt className="font-semibold">Message</dt><dd><code>{d.message}</code></dd></>}
          {d.line !== undefined && <><dt className="font-semibold">Line</dt><dd>{d.line}{d.codeLine ? <> <code className="ml-1 rounded bg-surface px-1">{d.codeLine.trim()}</code></> : null}</dd></>}
          <dt className="font-semibold">Root cause</dt><dd>{d.rootCause}</dd>
          <dt className="font-semibold">Why</dt><dd>{d.why}</dd>
          <dt className="font-semibold">Corrected approach</dt><dd>{d.correctedApproach}</dd>
          <dt className="font-semibold">How to prevent it</dt><dd>{d.prevention}</dd>
        </dl>
        {d.relevantCode.length > 0 && (
          <pre className="overflow-x-auto rounded bg-surface p-1.5 font-mono" aria-label="Relevant code">{d.relevantCode.map((r) => `${r.current ? ">" : " "} ${String(r.line).padStart(3)}  ${r.text}`).join("\n")}</pre>
        )}
        {d.fix && (
          <div className="grid gap-1.5 sm:grid-cols-2" aria-label="Before and after">
            <div><p className="font-semibold">Before (line {d.fix.line})</p><pre className="overflow-x-auto rounded bg-surface p-1.5 font-mono">{d.fix.before || "(nothing: a new line is added)"}</pre></div>
            <div><p className="font-semibold">After</p><pre className="overflow-x-auto rounded bg-accent-dim p-1.5 font-mono">{d.fix.after}</pre></div>
          </div>
        )}
        {d.evidence.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{d.evidence.map((e, n) => <li key={n}>{e}</li>)}</ul>}
        {d.stateBefore && d.stateBefore.length > 0 && (
          <p className="text-ink-muted">Variables just before it failed: {d.stateBefore.map((s) => `${s.name} = ${s.value}`).join(", ")}.</p>
        )}
      </div>
    </details>
  );
}


/** Step back / into / over / out from the recorded call depth, the jump button across a gap, and the reason a move is unavailable. */
export function StepControls({ trace, i, go, leading, trailing, motion = "" }: { trace: Trace; i: number; go: (index: number, note: string) => void; leading?: ReactNode; trailing?: ReactNode; motion?: string }) {
  const moves = useMemo(() => availableMoves(trace, i), [trace, i]);
  const labels: Record<StepMode, string> = { into: "Step into", over: "Step over", out: "Step out", back: "Step back" };
  const blocked = (["into", "over", "out", "back"] as const).map((m) => ({ m, b: moves[m].blocked })).filter((x) => x.b?.reason === "gap" || x.b?.reason === "not-recorded");
  const jumpTo = blocked.find((x) => x.b?.jumpTo !== undefined)?.b?.jumpTo;
  const run = (mode: StepMode) => { const m: StepMove = move(trace, i, mode); go(m.to ?? i, m.explanation); };
  return (
    <div className="space-y-1.5">
      <div role="group" aria-label="Step controls" className="flex flex-wrap items-center gap-1.5">
        {leading}
        {(["back", "into", "over", "out"] as const).map((m) => (
          <button key={m} type="button" className={`${btn} ${motion}`} onClick={() => run(m)} disabled={moves[m].to === null} title={`${STEP_RULES[m]}${moves[m].to === null ? ` Unavailable: ${moves[m].explanation}` : ""}`} data-step={m}>{labels[m]}</button>
        ))}
        {jumpTo !== undefined && <button type="button" className={`${btn} border-warn/60`} onClick={() => go(jumpTo, `Jumped to recorded step ${jumpTo + 1}. This was a jump over steps that were not recorded, not a step.`)} data-step="jump">Jump to step {jumpTo + 1} (not a step)</button>}
        {trailing}
      </div>
      <p className="text-[11px] text-ink-faint">Step over, into and out use the recorded call depth. Play, pause and speed are in the player.</p>
      {blocked.length > 0 && <p className="rounded border border-dashed border-warn/60 bg-warn-dim p-1.5 text-xs text-ink" data-testid="gap-block">Stepping is disabled across a gap ({blocked.map((x) => labels[x.m].toLowerCase()).join(", ")}): the tracer sampled this stretch, so the steps in between were not recorded.</p>}
    </div>
  );
}

/** Stepping state for a component that owns `go(index)`: remembers the explanation of the last move for the step it landed on. */
export function useStepNote() {
  const [note, setNote] = useState<{ at: number; text: string } | null>(null);
  return { note, say: (at: number, text: string) => setNote({ at, text }) };
}

/** The if / elif / else / while / for under the marked line, loop progress, how loops ended, and counts for the whole run. */
export function BranchPanel({ trace, code, source, i }: { trace: Trace; code: string; source: SourceMap; i: number }) {
  const stats = useMemo(() => branchStats(trace, source), [trace, source]);
  const branch = useMemo(() => branchAtStep(trace, source, i), [trace, source, i]);
  const loops = useMemo(() => loopsAtStep(trace, source, i), [trace, source, i]);
  const exits = useMemo(() => loopExitsAtStep(trace, source, code, i), [trace, source, code, i]);
  return (
    <div className="space-y-2 text-xs">
          {!branch && loops.length === 0 && exits.length === 0 && <p className="text-ink-faint">The marked line is not a condition or inside a loop.</p>}
          {branch && (
            <div className="rounded border border-surface-border p-1.5" data-testid="branch-card" data-outcome={branch.outcome}>
              <p><code className="font-semibold">{branch.kind} {branch.text}</code> <span className={`ml-1 rounded px-1 ${branch.outcome === "true" ? "bg-accent-dim text-accent" : branch.outcome === "false" ? "bg-warn-dim text-ink" : "bg-surface-soft text-ink-faint"}`}>{branch.kind === "for" ? (branch.outcome === "true" ? "next item" : branch.outcome === "false" ? "no items left" : "unknown") : branch.outcome === "true" ? "True" : branch.outcome === "false" ? "False" : "unknown"}</span></p>
              {branch.operands.length > 0 && <p className="text-ink-muted">Values now: {branch.operands.map((o) => `${o.name} = ${o.value}`).join(", ")}</p>}
              <p>{branch.summary}</p>
              <p className="text-ink-faint">{branch.evidence}</p>
            </div>
          )}
          {loops.map((l) => (
            <div key={l.construct.line} className="rounded border border-surface-border p-1.5" data-testid="loop-card">
              <p><code className="font-semibold">{l.construct.kind} {l.construct.kind === "for" ? `${l.construct.target} in ${l.construct.cond}` : l.construct.cond}</code> <span className="text-ink-faint">line {l.construct.line}</span></p>
              <p>
                {l.iteration !== undefined ? (l.atHeader ? `Check number ${num(l.iteration)}` : `Iteration ${num(l.iteration)}`) : "Iteration number not available (the trace is sampled here)"}
                {l.stat ? ` of ${l.stat.approx ? "about " : ""}${num(l.stat.iterations)} in the whole run${l.stat.entries > 1 ? ` (${num(l.stat.entries)} runs of the loop)` : ""}` : ""}
                {l.loopVars.length ? `. ${l.loopVars.map((v) => `${v.name} = ${v.value}`).join(", ")}` : ""}
              </p>
            </div>
          ))}
          {exits.map((e) => (
            <p key={e.construct.line} className="rounded border border-surface-border p-1.5" data-testid="loop-exit">
              The loop on line {e.construct.line} ended: {e.how === "finished" ? (e.construct.kind === "for" ? "it ran out of items." : "its condition became False.") : e.how === "break" ? "it was left with break." : "it was left early (return or an error)."}
            </p>
          ))}
          <BranchStatsTable stats={stats} />
          {source.notes.length > 0 && <p className="text-[11px] text-ink-faint">{source.notes[source.notes.length - 1]}</p>}
        </div>
  );
}

/** What the tracer cannot do, from the Python adapter's own list (one list, shown wherever a trace is). */
export function TraceLimitations() {
  return (
    <details className="rounded-lg border border-surface-border p-2 text-xs text-ink-muted" data-testid="trace-limitations">
      <summary className="cursor-pointer font-medium text-ink">Not supported here</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{PYTHON_LIMITATIONS.map((l, k) => <li key={k}>{l}</li>)}</ul>
    </details>
  );
}
