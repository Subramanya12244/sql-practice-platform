import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { VisualizerProps } from "../../types";
import { isPythonVisualData, type PythonVisualData } from "../../adapters/python/model";
import { ProvenanceBadge } from "../../../components/visual/Playback";
import { PyStoryBlock } from "../../../components/visual/PyScene";
import { PyInspector } from "./PyInspector";
import { describeStep, lineCounts, type Trace } from "../../../lib/visual/pyTrace";
import { pyStepStory, type PyStoryContext } from "../../../lib/visual/pyStory";
import { gapAfter, gapBefore, gapLabel, gapSummary, jumpTargets, num, stepPosition } from "../../../lib/visual/traceStore";
import { availableMoves } from "../../../lib/visual/pyStepper";
import { BranchPanel, DiagnosisCard, StepControls, useStepNote } from "../../../components/visual/PyTracePanels";

const btn = "rounded-lg border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const card = "rounded-lg border border-surface-border p-2";
const label = "mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint";

/** Frame call arguments: the variables of that frame at the call event that created it (recorded, never inferred). */
function callArgs(t: Trace, i: number, frameIndex: number): string | null {
  const depth = frameIndex + 1;
  const fn = t.steps[i]?.frames[frameIndex]?.fn;
  if (!fn || fn === "<module>") return null;
  for (let k = i; k >= 0; k--) {
    const s = t.steps[k];
    if (s.frames.length < depth) return null;
    if (s.ev === "call" && s.frames.length === depth && s.frames[frameIndex]?.fn === fn) {
      const vars = s.frames[frameIndex].vars;
      return Object.entries(vars).map(([n, idx]) => `${n}=${t.vals[idx]?.r ?? "?"}`).join(", ");
    }
  }
  return null; // the call event was not recorded
}

function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={card}>
      <p className={`${label} flex items-center gap-2`}>{title}{badge}</p>
      {children}
    </section>
  );
}

/** The source with the previous, current and next line marked. It scrolls only itself, never the page or the visualizer box, so the story stays in view. */
const SourcePane = memo(function SourcePane({ code, line, prev, next, counts, exact, smooth }: { code: string; line: number; prev?: number; next?: number; counts: Record<number, number>; exact: boolean; smooth: boolean }) {
  const list = useRef<HTMLOListElement | null>(null);
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const ol = list.current, li = ref.current;
    if (!ol || !li) return;
    const o = ol.getBoundingClientRect(), l = li.getBoundingClientRect();
    const pad = 6;
    const top = l.top < o.top ? ol.scrollTop - (o.top - l.top) - pad : l.bottom > o.bottom ? ol.scrollTop + (l.bottom - o.bottom) + pad : ol.scrollTop;
    ol.scrollTo?.({ top, behavior: smooth ? "smooth" : "auto" });
  }, [line, smooth]);
  return (
    <ol ref={list} className="max-h-72 overflow-auto rounded-lg border border-surface-border bg-surface-soft py-1 font-mono text-xs" aria-label="Source code">
      {code.split("\n").map((text, n) => {
        const ln = n + 1;
        const current = ln === line;
        const mark = current ? "now" : ln === prev ? "prev" : ln === next ? "next" : "";
        return (
          <li key={n} ref={current ? ref : undefined} aria-current={current ? "step" : undefined} data-mark={mark || undefined}
            className={`flex gap-2 px-2 ${smooth ? "transition-colors" : ""} ${current ? "bg-accent-dim text-ink" : mark ? "bg-surface-overlay text-ink" : "text-ink-muted"}`}>
            <span className="w-6 shrink-0 select-none text-right text-ink-faint">{ln}</span>
            <span className="w-8 shrink-0 select-none text-[10px] uppercase text-ink-faint">{mark}</span>
            <span className="whitespace-pre">{text || " "}</span>
            {counts[ln] > 1 && <span className="ml-auto shrink-0 text-[10px] text-ink-faint" title={exact ? "Times this line ran in the whole run (exact)" : "Times this line ran before tracing stopped (a lower bound)"}>{exact ? "" : "≥"}×{num(counts[ln])}</span>}
          </li>
        );
      })}
    </ol>
  );
});

/**
 * Step viewer for one real Python trace: source with the previous, current and next line, step over/into/out/back computed from the
 * recorded call depth, a variable inspector (scope, type, changed), the call stack with arguments and return values, a condition, loop
 * and branch panel read from executed events, and an error diagnosis with before/after. Play, pause, speed and the step slider are the
 * workspace's shared player; this component renders the model at `step` and moves it through `onStepChange`.
 */
export function PythonTraceVisualizer({ model, step, onStepChange, reducedMotion }: VisualizerProps) {
  const data: PythonVisualData | null = isPythonVisualData(model.data) ? model.data : null;
  const { note, say } = useStepNote();
  const trace = data?.trace;
  const last = trace ? trace.steps.length - 1 : 0;
  const i = Math.min(Math.max(0, step), Math.max(0, last));
  const s = trace?.steps[i];
  const code = data?.code ?? "";
  const source = useMemo(() => code.split("\n"), [code]);
  const moves = useMemo(() => (trace ? availableMoves(trace, i) : null), [trace, i]);
  const counts = useMemo(() => (trace ? lineCounts(trace) : {}), [trace]);
  const args = useMemo(() => (trace && s ? s.frames.map((_, k) => callArgs(trace, i, k)) : []), [trace, s, i]);
  // One stable context per run; the story is rebuilt only when the step changes (a pure function of trace, step and context).
  const ctx = useMemo<PyStoryContext>(() => ({ code, source: data?.source, diagnoses: data?.diagnoses }), [code, data?.source, data?.diagnoses]);
  const result = useMemo(() => (trace && s ? pyStepStory(trace, i, ctx) : null), [trace, s, i, ctx]);

  if (!data || !trace || !s || !moves || !result) return <p role="status" className="text-sm text-ink-muted">This run has no recorded steps to show.</p>;

  const frames = s.frames.map((f, k) => ({ f, k })).reverse(); // innermost first
  const prevLine = i > 0 && moves.back.to !== null ? trace.steps[i - 1].line : undefined;
  const nextLine = moves.into.to !== null ? trace.steps[i + 1].line : undefined;
  const exact = trace.counts ? trace.counts.exact : !trace.truncated;
  const j = jumpTargets(trace, i);
  const gapNow = gapBefore(trace, i), gapNext = gapAfter(trace, i);
  const atException = trace.exceptionStep === i || (trace.error !== undefined && i === last);
  const motion = reducedMotion ? "" : "transition-colors";

  return (
    <div className="space-y-3 text-sm" data-testid="python-visualizer" data-reduced-motion={reducedMotion ? "true" : "false"}>
      {/* The story comes first: the line being run with its calculation and change, the picture (list, call, branch, output) and the four answers. */}
      <PyStoryBlock result={result} step={i + 1} total={trace.steps.length} reducedMotion={reducedMotion} />

      <div className="space-y-1.5">
        <StepControls trace={trace} i={i} motion={motion}
          go={(to, text) => { onStepChange(to); say(to, text); }}
          leading={<button type="button" className={`${btn} ${motion}`} onClick={() => { onStepChange(0); say(0, "Back at the first recorded step."); }} disabled={i === 0}>Restart</button>}
          trailing={<span className="ml-auto"><ProvenanceBadge p="executed" /></span>} />
        <p role="status" aria-live="polite" className="text-xs text-ink-muted" data-testid="step-note">{note && note.at === i ? note.text : ""}</p>
      </div>

      <p className="text-xs tabular-nums text-ink-muted" data-testid="step-position">{stepPosition(trace, i)} · depth {s.frames.length}</p>

      <SourcePane code={code} line={s.line} prev={prevLine} next={nextLine} counts={counts} exact={exact} smooth={!reducedMotion} />
      <p className="text-[11px] text-ink-faint">Marked lines: <strong>now</strong> is about to run, <strong>prev</strong> ran just before, <strong>next</strong> runs after a plain step.</p>

      {trace.truncated && (
        <div role="note" className="rounded-lg border border-warn/50 bg-warn-dim p-2 text-xs text-ink" data-testid="sampled-notice">
          <p className="font-semibold">This trace is sampled{trace.detached ? " and stopped early" : ""}.</p>
          {gapNow && <p className="mt-1">Before this step: {gapSummary(gapNow)}</p>}
          {gapNext && <p className="mt-1">After this step: {gapLabel(gapNext)}.</p>}
        </div>
      )}

      <Section title="Variables" badge={<ProvenanceBadge p="executed" />}>
        <PyInspector trace={trace} i={i} effect={result.scene.effect} reduced={reducedMotion} />
      </Section>

      <Section title="Call stack">
        <ol className="flex flex-col gap-1" aria-label="Call stack, innermost first">
          {frames.map(({ f, k }) => (
            <li key={k} className={`rounded border px-2 py-0.5 text-xs ${k === s.frames.length - 1 ? "border-accent bg-accent-dim text-ink" : "border-surface-border text-ink-muted"}`}>
              <code>{f.fn === "<module>" ? "main program" : `${f.fn}(${args[k] ?? ""})`}</code> <span className="text-ink-faint">line {f.line}</span>
            </li>
          ))}
        </ol>
        {s.ev === "call" && <p className="mt-1 text-xs text-ink-muted">Entering <code>{s.frames[s.frames.length - 1].fn}</code> with {Object.keys(s.frames[s.frames.length - 1].vars).length ? Object.entries(s.frames[s.frames.length - 1].vars).map(([n, idx]) => `${n} = ${trace.vals[idx]?.r}`).join(", ") : "no arguments"}.</p>}
        {(s.ev === "return" || s.ev === "yield") && s.ret !== undefined && <p className="mt-1 text-xs text-ink-muted" data-testid="return-value">{s.ev === "yield" ? "Yields" : "Returns"} <code>{trace.vals[s.ret]?.r}</code>{s.frames.length === 1 && s.ev === "return" ? "; the program is finished." : s.ev === "return" ? "; the frame is popped." : "."}</p>}
      </Section>

      <Section title="Output so far">
        <pre className="min-h-[1.5rem] whitespace-pre-wrap font-mono text-xs text-ink">{trace.stdout.slice(0, s.out) || <span className="text-ink-faint">nothing printed yet</span>}</pre>
      </Section>

      {trace.error && (
        <div className="space-y-2">
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger-dim p-2 text-xs text-ink">
            The run ended with <strong>{trace.error.type}</strong>: {trace.error.msg}{trace.error.line ? ` (line ${trace.error.line})` : ""}.{" "}
            {j.exception !== null && <button type="button" className={`${btn} ml-1`} onClick={() => onStepChange(j.exception!)} disabled={i === j.exception}>Go to the exception</button>}
          </p>
          {data.diagnoses.map((d, n) => <DiagnosisCard key={`${d.cls}${n}`} d={d} open={atException && n === 0} />)}
        </div>
      )}

      {/* Secondary views, below the story and the picture. */}
      <details className={card} data-testid="branch-details">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-ink-faint">Conditions, branches and loops <span className="font-normal normal-case">(read from executed lines and the source shape)</span></summary>
        <div className="mt-2"><BranchPanel trace={trace} code={code} source={data.source} i={i} /></div>
      </details>

      <div role="status" className={`rounded-lg border p-2 text-xs ${s.ev === "exception" ? "border-danger/50 bg-danger-dim" : "border-surface-border bg-surface-soft text-ink-muted"}`}>{describeStep(trace, i, source)}</div>

      <div role="group" aria-label="Jump to a recorded step" className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-faint">Jump (not stepping):</span>
        <button type="button" className={btn} disabled={i === j.first} onClick={() => onStepChange(j.first)}>First</button>
        <button type="button" className={btn} disabled={i === j.last} onClick={() => onStepChange(j.last)}>Last</button>
        {j.prevCheckpoint !== null && <button type="button" className={btn} onClick={() => onStepChange(j.prevCheckpoint!)}>Previous checkpoint</button>}
        {j.nextCheckpoint !== null && <button type="button" className={btn} onClick={() => onStepChange(j.nextCheckpoint!)}>Next checkpoint</button>}
        {j.nextGap !== null && <button type="button" className={btn} onClick={() => onStepChange(j.nextGap!)}>Next gap</button>}
      </div>
    </div>
  );
}
