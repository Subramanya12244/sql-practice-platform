/**
 * Playback controls for the SQL Practice visualizer. OWNER: Agent 4.
 *
 * This is only a VIEW of the shared playback state (`usePlayback` and `playbackReducer`): every control dispatches a reducer action,
 * nothing here keeps a step or a timer of its own. Keyboard (when the group or a control in it has focus), from `keyAction`:
 * Space play/pause, ArrowRight next, ArrowLeft previous, Home restart, End last step. Space and Enter on a focused button keep their
 * normal "press it" meaning, a focused speed list or timeline keeps its own arrow keys.
 */
import { useEffect, useId, type KeyboardEvent, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { SPEEDS, keyAction, type PlaybackAction, type Speed } from "../../../lib/visual/playback";
import { useReducedMotion } from "../../../lib/visual/motion";
import type { usePlayback } from "../Playback";

const btn = "cx-btn inline-flex items-center justify-center gap-1 rounded-lg border border-surface-border px-2 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-40";

/** The action a key press means for a playback control group, or null when the element that has focus should keep the key. */
export function playerKeyAction(e: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey"> & { target: EventTarget }): PlaybackAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const a = keyAction(e.key);
  if (!a) return null;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "SELECT" || tag === "TEXTAREA") return null;
  if (tag === "INPUT" && e.key !== " ") return null; // the timeline is a native slider: arrows, Home and End already seek
  if (tag === "BUTTON" && e.key === " ") return null; // Space presses the focused button
  return a;
}

/** Elements whose keys are never the player's: text fields, lists, the code editor, editable text, the query box (it scrolls with the arrows) and the row board's own Home/End/Up/Down. */
function ownsKey(t: HTMLElement, key: string): boolean {
  if (t.isContentEditable || t.closest(".monaco-editor, [contenteditable='true'], .cx-sql")) return true;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return true;
  if (t.closest("[data-card]") && ["Home", "End", "ArrowUp", "ArrowDown"].includes(key)) return true;
  return false;
}

export function ClassicPlayer({ pb, labels, keyRoot, count: countProp }: {
  pb: ReturnType<typeof usePlayback>; labels?: string[];
  /** The number of steps actually available (`ClassicStep.count`). When given it is the truth for every label, tick and disabled state; `pb.count` is only updated by an effect one render after the stages arrive and can still be 0. */
  count?: number;
  /** The visualizer's root element: when given, Space, arrows, Home and End work anywhere inside it (not only with the bar focused). Keys elsewhere on the page are never captured. */
  keyRoot?: RefObject<HTMLElement | null>;
}) {
  const { playing, speed, dispatch } = pb;
  const count = countProp ?? pb.count;
  const index = count > 0 ? Math.min(Math.max(0, Math.trunc(pb.index) || 0), count - 1) : 0;
  useEffect(() => {
    const root = keyRoot?.current;
    if (!root) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (ownsKey(t, e.key)) return;
      const a = playerKeyAction({ key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, target: t });
      if (a) { e.preventDefault(); dispatch(a); }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [keyRoot, dispatch]);
  const reduced = useReducedMotion();
  const keysId = useId();
  const label = labels?.[index];
  const stepText = count ? `Step ${index + 1} of ${count}${label ? ` · ${label}` : ""}` : "No steps";
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (keyRoot?.current) return; // the root listener already handles every key inside the visualizer, this one included
    const a = playerKeyAction(e);
    if (a) { e.preventDefault(); dispatch(a); }
  };
  return (
    <div
      role="group" aria-label="Playback controls" tabIndex={0} aria-keyshortcuts="Space ArrowLeft ArrowRight Home End" aria-describedby={keysId}
      data-testid="classic-player" data-step-index={index} data-reduced={reduced ? "true" : "false"} onKeyDown={onKeyDown}
      className="cx-player space-y-1 rounded-xl border border-surface-border bg-surface-raised p-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={btn} onClick={() => dispatch({ type: "restart" })} disabled={count === 0} aria-label="Restart"><RotateCcw className="h-4 w-4" aria-hidden /></button>
        <button type="button" className={btn} onClick={() => dispatch({ type: "prev" })} disabled={index === 0} aria-label="Previous step"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
        <button type="button" className={`${btn} bg-accent text-on-accent hover:text-on-accent`} onClick={() => dispatch({ type: "toggle" })} disabled={count === 0} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}<span aria-hidden>{playing ? "Pause" : "Play"}</span>
        </button>
        <button type="button" className={btn} onClick={() => dispatch({ type: "next" })} disabled={index >= count - 1} aria-label="Next step"><ChevronRight className="h-4 w-4" aria-hidden /></button>
        <label className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted">Speed
          <select aria-label="Playback speed" value={speed} onChange={(e) => dispatch({ type: "speed", speed: Number(e.target.value) as Speed })} className="cx-select rounded-md border border-surface-border bg-surface px-1 text-xs text-ink">
            {SPEEDS.map((v) => <option key={v} value={v}>{v}x</option>)}
          </select>
        </label>
      </div>
      {/* The one polite live region for a step change: the number and the name of the step, once per change. */}
      <p role="status" aria-live="polite" aria-atomic="true" data-testid="classic-live" className="text-xs tabular-nums text-ink-muted">{stepText}</p>
      <div className="cx-track">
        <div
          role="progressbar" aria-label="Step progress" aria-valuemin={count ? 1 : 0} aria-valuemax={count} aria-valuenow={count ? index + 1 : 0}
          aria-valuetext={stepText} data-testid="classic-progress" data-step-index={index} data-step-count={count} className="cx-bar"
        >
          <div className="cx-fill" style={{ transform: `scaleX(${count ? (index + 1) / count : 0})` }} />
          {Array.from({ length: Math.max(0, count - 1) }, (_, i) => <span key={i} aria-hidden className="cx-tick" style={{ left: `${((i + 1) * 100) / count}%` }} title={labels?.[i]} />)}
        </div>
        <input
          type="range" min={0} max={Math.max(0, count - 1)} value={index} disabled={count < 2} className="cx-slider"
          aria-label="Timeline" aria-valuetext={stepText} onChange={(e) => dispatch({ type: "seek", index: Number(e.target.value) })}
        />
      </div>
      <p id={keysId} className="sr-only">Keyboard: Space plays or pauses, left and right arrows change step, Home goes to the first step, End to the last.</p>
    </div>
  );
}
