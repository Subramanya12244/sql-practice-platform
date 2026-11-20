import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { EASE, MOTION, STAGGER } from "../../lib/motion";
import type { Trace } from "../../lib/visual/pyTrace";
import { pyStepStory, type PyScene, type PyStoryContext, type PyStoryResult, type SceneLoop } from "../../lib/visual/pyStory";
import { StoryPanel } from "./StoryPanel";

/**
 * The picture that goes with a Python step's story: the line being run, the calculation and the variable change, the list a loop is
 * walking (current item marked), arguments flowing into parameters, the return value, the branch outcome, the output and an error.
 * It only draws a `PyScene` (lib/visual/pyStory.ts), which is built from the recorded trace, so nothing here is invented.
 *
 * Motion: a part that arrives on this step pops in (transform and opacity, `.df-cell`, delays from STAGGER); a highlighted list
 * item changes colour and scale with a transition from MOTION / EASE. With `reduced` none of that is rendered: the same
 * information is shown as static "before -> after" values, and nothing depends on motion to be understood. Nothing loops.
 */

const tone = {
  plain: "border-surface-border bg-surface-soft text-ink",
  accent: "border-accent bg-accent-dim text-ink",
  warn: "border-warn/60 bg-warn-dim text-ink",
  danger: "border-danger/50 bg-danger-dim text-ink",
  ghost: "border-dashed border-surface-border bg-transparent text-ink-muted",
} as const;
type Tone = keyof typeof tone;

const popStyle = (reduced: boolean, n: number): CSSProperties | undefined => (reduced ? undefined : { animationDelay: `${Math.min(n, STAGGER.maxItems) * STAGGER.stepMs}ms` });
const moveStyle = (reduced: boolean): CSSProperties | undefined => (reduced ? undefined : { transitionDuration: `${MOTION.base}ms`, transitionTimingFunction: EASE.out });
const MOVES = "transition-[background-color,border-color,opacity,transform]";

function Chip({ children, t = "plain", n = 0, reduced, testId, title }: { children: ReactNode; t?: Tone; n?: number; reduced: boolean; testId?: string; title?: string }) {
  return <span data-testid={testId} title={title} style={popStyle(reduced, n)} className={`${reduced ? "" : "df-cell"} inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-xs ${tone[t]}`}>{children}</span>;
}
const Arrow = () => <span aria-hidden className="text-ink-faint">→</span>;
const Cap = ({ children }: { children: ReactNode }) => <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{children}</p>;

// ── This line: statement, calculation, variable change ───────────────────

const StatementStrip = memo(function StatementStrip({ scene, reduced, step }: { scene: PyScene; reduced: boolean; step: number }) {
  const { calc, changes, effect } = scene;
  const shownChanges = changes.slice(0, 3);
  const isLine = scene.kind !== "call" && scene.kind !== "return" && scene.kind !== "yield" && scene.kind !== "finish" && scene.kind !== "end" && scene.kind !== "exception";
  let n = 0;
  return (
    <section aria-label="This line" data-testid="py-statement" data-kind={scene.kind} data-step-key={step} className="space-y-2 rounded-lg border border-surface-border bg-surface-soft/60 p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink-muted">line {scene.line} · {scene.scope}</span>
        {scene.stack.length > 1 && <span className="text-[11px] text-ink-faint">depth {scene.depth}</span>}
      </div>
      <p className="min-w-0 break-words font-mono text-sm font-semibold text-ink" data-testid="py-statement-code">{scene.statement || "(end of the program)"}</p>

      {isLine && calc && (
        <div key={`calc.${step}`} className="space-y-1">
          <Cap>The calculation, from recorded values</Cap>
          <p data-testid="py-calc" data-formula={calc.formula} aria-label={`Calculation ${calc.formula}`} className="flex flex-wrap items-center gap-1.5 text-sm">
            {calc.operands.map((o, k) => (
              <span key={k} className="contents">
                <Chip reduced={reduced} n={n++} t={o.name ? "plain" : "ghost"}>{o.value}</Chip>
                {k < calc.symbols.length && <>{" "}<span className="font-mono font-bold text-ink-muted">{calc.symbols[k]}</span>{" "}</>}
              </span>
            ))}
            {" "}<span className="font-mono font-bold text-ink-muted">=</span>{" "}
            <Chip reduced={reduced} n={n++} t="accent">{calc.result}</Chip>
          </p>
          <p className="text-[11px] text-ink-faint" data-testid="py-calc-names">{calc.operands.some((o) => o.name) ? `${calc.operands.map((o) => (o.name ? `${o.name}${o.scope === "<module>" ? " (global)" : ""}` : "a literal")).join(", ")}; result is stored in ${calc.target}` : `result is stored in ${calc.target}`}</p>
        </div>
      )}

      {isLine && shownChanges.length > 0 && (
        <div key={`chg.${step}`} className="space-y-1">
          <Cap>{effect.status === "ok" ? "After this line" : "Change"}</Cap>
          <ul className="space-y-1" aria-label="Variables this line changes">
            {shownChanges.map((c) => (
              <li key={`${c.depth}.${c.name}`} data-testid="py-var-change" data-name={c.name} data-kind={c.kind} className="flex flex-wrap items-center gap-1.5 text-xs">
                <code className="font-semibold text-ink">{c.name}</code>
                {c.scope !== scene.fn && <span className="text-[10px] text-ink-faint">{c.scope === "<module>" ? "global" : `in ${c.scope}()`}</span>}
                {c.kind === "new" ? <Chip reduced={reduced} n={n++} t="ghost">new</Chip> : <Chip reduced={reduced} n={n++} t="plain" title="Value before this line">{c.before}</Chip>}
                <Arrow />
                {c.kind === "removed" ? <Chip reduced={reduced} n={n++} t="ghost">removed</Chip> : <Chip reduced={reduced} n={n++} t="accent" title="Value after this line">{c.after}</Chip>}
                {c.inPlace && <span className="text-[10px] text-ink-faint">changed in place</span>}
              </li>
            ))}
            {changes.length > shownChanges.length && <li className="text-[11px] text-ink-faint">and {changes.length - shownChanges.length} more</li>}
          </ul>
        </div>
      )}

      {isLine && effect.calls.length > 0 && (
        <ul className="space-y-1" aria-label="Calls made by this line">
          {effect.calls.slice(0, 3).map((c) => (
            <li key={c.callStep} data-testid="py-line-call" className="flex flex-wrap items-center gap-1.5 text-xs">
              <Chip reduced={reduced} n={n++} t="plain">{c.fn}({c.args.map((a) => `${a.name}=${a.value}`).join(", ")})</Chip>
              <Arrow />
              {c.returned !== undefined ? <Chip reduced={reduced} n={n++} t="accent">returned {c.returned}</Chip> : c.raised ? <Chip reduced={reduced} n={n++} t="danger">raised {c.raised}</Chip> : <Chip reduced={reduced} n={n++} t="ghost">no value recorded</Chip>}
            </li>
          ))}
        </ul>
      )}

      {isLine && scene.sampled && <p role="note" className="rounded border border-dashed border-warn/60 bg-warn-dim p-1.5 text-xs text-ink" data-testid="py-sampled">Not shown: the tracer sampled this stretch, so what this line did is unknown. No calculation is claimed.</p>}
      {isLine && !scene.sampled && effect.status === "ok" && !calc && shownChanges.length === 0 && effect.calls.length === 0 && <p className="text-[11px] text-ink-faint">This line changes no variable.</p>}
    </section>
  );
});

// ── Loop: the list with the current item marked ──────────────────────────

const LoopPicture = memo(function LoopPicture({ loop, reduced }: { loop: SceneLoop; reduced: boolean }) {
  const list = loop.list;
  const head = loop.kind === "for"
    ? loop.state === "finished" ? "no items left, the loop ends" : loop.state === "taking" ? "takes the next item" : loop.state === "running" ? "running the body" : "not known"
    : loop.state === "finished" ? "condition is False, the loop ends" : loop.state === "taking" ? "condition is True" : loop.state === "running" ? "running the body" : "not known";
  return (
    <section aria-label="Loop progress" data-testid="py-loop" data-state={loop.state} data-index={loop.index ?? ""} className="space-y-2 rounded-lg border border-surface-border p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <code className="text-xs font-semibold text-ink">{loop.header}</code>
        {loop.iteration !== undefined && <span className="rounded bg-accent-dim px-1.5 py-0.5 text-[11px] font-semibold text-ink" data-testid="py-iteration">{loop.atHeader ? `check ${loop.iteration}` : `iteration ${loop.iteration}`}{loop.iterations !== undefined ? ` of ${loop.iterations}` : ""}</span>}
        <span className="text-[11px] text-ink-faint">{head}</span>
        {loop.outer > 0 && <span className="text-[11px] text-ink-faint">inside {loop.outer} outer loop{loop.outer === 1 ? "" : "s"}</span>}
      </div>
      {list && (
        <div>
          <Cap>{list.name} ({list.type}{list.length !== undefined ? `, ${list.length} item${list.length === 1 ? "" : "s"}` : ""})</Cap>
          <ol aria-label={`Items of ${list.name}`} className="mt-1 flex flex-wrap items-stretch gap-1.5" data-testid="py-list">
            {list.items.map((r, n) => {
              const state = loop.state === "finished" ? "done" : loop.index === undefined ? "idle" : n === loop.index ? "current" : n < loop.index ? "done" : "next";
              const cls = state === "current" ? "border-accent bg-accent-dim text-ink" : state === "done" ? "border-surface-border bg-surface-soft text-ink-faint" : "border-surface-border text-ink";
              return (
                <li key={n} data-state={state} aria-current={state === "current" ? "true" : undefined} style={moveStyle(reduced)}
                  className={`${reduced ? "" : `${MOVES} ${state === "current" ? "scale-110" : state === "done" ? "opacity-60" : ""}`} min-w-[2.75rem] rounded-md border px-2 py-1 text-center font-mono text-xs ${cls}`}>
                  <span className="block text-[10px] text-ink-faint">{n}</span>
                  <span className="block font-semibold">{r}</span>
                  <span className="block h-3 text-[9px] font-bold uppercase leading-3 tracking-wider text-accent">{state === "current" ? "now" : state === "done" ? "done" : ""}</span>
                </li>
              );
            })}
            {list.more && <li className="self-center text-xs text-ink-faint">… {list.length ?? "more"} items in all</li>}
          </ol>
        </div>
      )}
      {loop.vars.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="py-loop-vars">
          {loop.vars.map((v) => <Chip key={v.name} reduced={reduced} t={loop.state === "finished" ? "plain" : "accent"}>{v.name} = {v.value}</Chip>)}
          {loop.index !== undefined && list && <span className="text-ink-faint">item {loop.index} of {list.length ?? list.items.length}</span>}
          {loop.index === undefined && list && loop.state !== "finished" && loop.state !== "unknown" && <span className="text-ink-faint">position in the list not verified</span>}
        </p>
      )}
      {loop.kind === "while" && loop.operands.length > 0 && <p className="flex flex-wrap gap-1.5 text-xs">{loop.operands.map((o) => <Chip key={o.name} reduced={reduced}>{o.name} = {o.value}</Chip>)}</p>}
    </section>
  );
});

// ── Call and return ──────────────────────────────────────────────────────

function Stack({ names, mark, reduced }: { names: string[]; mark: "push" | "pop" | "none"; reduced: boolean }) {
  return (
    <ol aria-label="Call stack, bottom to top" data-testid="py-stack" className="flex flex-wrap items-center gap-1.5">
      {names.map((n, k) => {
        const last = k === names.length - 1;
        return (
          <li key={`${k}.${n}`} className={`${reduced || !(last && mark === "push") ? "" : "df-cell"} rounded border px-1.5 py-0.5 font-mono text-[11px] ${last && mark === "push" ? tone.accent : tone.plain}`}>
            {n === "<module>" ? "main program" : `${n}()`}{last && mark === "push" ? " (new)" : ""}
          </li>
        );
      })}
    </ol>
  );
}

const CallPicture = memo(function CallPicture({ scene, reduced }: { scene: PyScene; reduced: boolean }) {
  const c = scene.call;
  const r = scene.ret;
  if (c) {
    return (
      <section aria-label="Function call" data-testid="py-call" className="space-y-2 rounded-lg border border-surface-border p-2.5">
        <Cap>Arguments flow into parameters</Cap>
        {c.params.length === 0 ? <p className="text-xs text-ink-muted">{c.fn}() takes no arguments.</p> : (
          <ul className="space-y-1" aria-label="Arguments and parameters">
            {c.params.map((p, k) => (
              <li key={p.name} data-testid="py-param" data-param={p.name} className="flex flex-wrap items-center gap-1.5 text-xs">
                {p.arg !== undefined ? <Chip reduced={reduced} n={k} t="plain" title={p.verified ? "Argument value checked against the recorded parameter" : "Argument as written in the call"}>{p.arg}</Chip> : <Chip reduced={reduced} n={k} t="ghost">default / not shown</Chip>}
                <Arrow />
                <Chip reduced={reduced} n={k + 1} t="accent">{p.name} = {p.value}</Chip>
                {p.arg !== undefined && !p.verified && <span className="text-[10px] text-ink-faint">argument text only; the value is the recorded one</span>}
              </li>
            ))}
          </ul>
        )}
        <Cap>Call stack</Cap>
        <Stack names={c.stackAfter} mark="push" reduced={reduced} />
      </section>
    );
  }
  if (r) {
    return (
      <section aria-label="Function return" data-testid="py-return" className="space-y-2 rounded-lg border border-surface-border p-2.5">
        <Cap>{r.yields ? "Value handed out" : "Return value goes back to the caller"}</Cap>
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <Chip reduced={reduced} t="accent" testId="py-return-value">{r.yields ? "yield" : "return"} {r.value ?? "None"}</Chip>
          {!r.yields && <><Arrow /><Chip reduced={reduced} n={1} t="plain">{r.callerLine !== undefined ? `line ${r.callerLine} in the caller` : "the caller"}</Chip></>}
        </p>
        <p className="text-[11px] text-ink-faint">{r.yields ? "Locals kept" : "Locals discarded"}: {r.locals.length ? r.locals.join(", ") : "none"}</p>
        <Cap>Call stack after</Cap>
        <Stack names={r.stackAfter.length ? r.stackAfter : [r.fn]} mark="none" reduced={reduced} />
      </section>
    );
  }
  return null;
});

// ── Branch, output, error ────────────────────────────────────────────────

const BranchPicture = memo(function BranchPicture({ scene, reduced }: { scene: PyScene; reduced: boolean }) {
  const b = scene.branch!;
  return (
    <section aria-label="Condition" data-testid="py-branch" data-outcome={b.outcome} data-took={b.took} className="space-y-2 rounded-lg border border-surface-border p-2.5">
      <p className="flex flex-wrap items-center gap-1.5 text-xs">
        <code className="font-semibold text-ink">{b.kind} {b.condition}</code>
        <Arrow />
        <Chip reduced={reduced} t={b.outcome === "true" ? "accent" : b.outcome === "false" ? "warn" : "ghost"} testId="py-outcome">{b.outcome === "true" ? "True" : b.outcome === "false" ? "False" : "not known"}</Chip>
      </p>
      {b.operands.length > 0 && <p className="flex flex-wrap gap-1.5 text-xs">{b.operands.map((o) => <Chip key={o.name} reduced={reduced}>{o.name} = {o.value}</Chip>)}</p>}
      <p className="text-xs text-ink-muted" data-testid="py-branch-label">{b.label}{b.nextLine !== undefined && b.outcome !== "unknown" ? `; next executed line: ${b.nextLine}` : ""}</p>
    </section>
  );
});

const OutputPicture = memo(function OutputPicture({ scene, reduced }: { scene: PyScene; reduced: boolean }) {
  const o = scene.output!;
  const added = o.added ?? "";
  const before = added && o.total.endsWith(added) ? o.total.slice(0, o.total.length - added.length) : o.total;
  return (
    <section aria-label="Output" data-testid="py-output-strip" className="space-y-1 rounded-lg border border-surface-border p-2.5">
      <Cap>Output</Cap>
      <pre className="whitespace-pre-wrap rounded bg-surface-soft p-1.5 font-mono text-xs text-ink" data-testid="py-output-text">
        {before}{added && <mark data-testid="py-output-new" style={popStyle(reduced, 0)} className={`${reduced ? "" : "df-cell"} inline-block rounded bg-accent-dim px-0.5 text-ink`}>{added.replace(/\n$/, "")}</mark>}{added.endsWith("\n") ? "\n" : ""}
      </pre>
      {added && <p className="text-[11px] text-ink-faint">New on this line: <code>{JSON.stringify(added)}</code></p>}
    </section>
  );
});

const ErrorPicture = memo(function ErrorPicture({ scene, reduced }: { scene: PyScene; reduced: boolean }) {
  const e = scene.error!;
  return (
    <section aria-label="Error" data-testid="py-error" className="space-y-2 rounded-lg border border-danger/50 bg-danger-dim p-2.5">
      <p className="flex flex-wrap items-center gap-1.5 text-xs">
        <Chip reduced={reduced} t="danger">{e.type}</Chip>
        <span className="text-ink">{e.message}</span>
      </p>
      <p className="font-mono text-xs text-ink"><span className="text-ink-faint">line {e.line}</span> <span className="font-semibold">&gt; {e.codeLine}</span></p>
      {e.values.length > 0 && <p className="flex flex-wrap gap-1.5 text-xs">{e.values.map((v) => <Chip key={v.name} reduced={reduced}>{v.name} = {v.value}</Chip>)}</p>}
      <p className="text-[11px] text-ink-muted">{e.fate === "uncaught" ? "Nothing handles it: the program ends here." : e.fate === "caught" ? "A handler catches it." : e.fate === "propagates" ? "It moves up to the caller." : ""}{e.diagnosis ? ` Diagnosis: ${e.diagnosis.category}, ${e.diagnosis.confidence}.` : ""}</p>
    </section>
  );
});

// ── The whole block ──────────────────────────────────────────────────────

/** Picture parts for a scene, in teaching order. */
const ScenePictures = memo(function ScenePictures({ scene, reduced }: { scene: PyScene; reduced: boolean }) {
  return (
    <div className="space-y-2" data-testid="py-scene" data-scene={scene.kind}>
      {scene.call || scene.ret ? <CallPicture scene={scene} reduced={reduced} /> : null}
      {scene.loop && <LoopPicture loop={scene.loop} reduced={reduced} />}
      {scene.branch && <BranchPicture scene={scene} reduced={reduced} />}
      {scene.error && <ErrorPicture scene={scene} reduced={reduced} />}
      {scene.output && (scene.output.added !== undefined || scene.kind === "finish" || scene.kind === "exception") && <OutputPicture scene={scene} reduced={reduced} />}
    </div>
  );
});

/**
 * The story of one recorded step with its picture: line strip, picture, then the four answers. `result` comes from `pyStepStory`
 * (the caller memoises it per step), so stepping re-renders only the parts whose scene changed.
 */
export const PyStoryBlock = memo(function PyStoryBlock({ result, step, total, reducedMotion }: { result: PyStoryResult; step: number; total: number; reducedMotion: boolean }) {
  const { story, scene } = result;
  return (
    <div className="space-y-2" data-testid="py-story-block">
      <StatementStrip scene={scene} reduced={reducedMotion} step={step} />
      <ScenePictures scene={scene} reduced={reducedMotion} />
      <StoryPanel story={story} stepKey={`${step}`} step={step} total={total} heading={scene.statement ? `line ${scene.line}` : undefined} reduced={reducedMotion} />
    </div>
  );
});

/** Build the story for step `i` once per (trace, step, ctx). `ctx` must be stable between renders. */
export function usePyStory(trace: Trace, i: number, ctx: PyStoryContext): PyStoryResult {
  return useMemo(() => pyStepStory(trace, i, ctx), [trace, i, ctx]);
}
