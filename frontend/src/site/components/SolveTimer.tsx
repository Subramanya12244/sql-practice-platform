import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Square, Timer } from "lucide-react";
import { useProgress, recordSession } from "../lib/progress";
import {
  HEARTBEAT_MS, elapsedSec, finishSession, formatClock, formatDuration, getActive, isRunning, openSession, pauseSession, resumeSession,
  saveActive, settle, subscribeSessions, sweepStale, tabHidden, tabVisible, type OpenMeta, type SolveSession,
} from "../lib/solveSessions";

/**
 * Keeps one solve session alive for a challenge page: opens or resumes it, heartbeats it every
 * 10 s (storage is not written per second), pauses it while the tab is hidden, and re-renders
 * each second from stored timestamps, so a throttled background tab can never make it drift.
 */
export function useSolveTimer(meta: OpenMeta) {
  const { kind, ref, difficulty, topic, targetSec } = meta;
  const progress = useProgress();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [now, setNow] = useState(() => Date.now());
  // The session this page last finished (solved or abandoned), shown until a new attempt starts.
  const [endedId, setEndedId] = useState<string | null>(null);
  // Identifies this tab among others showing the same challenge (see tabVisible).
  const tabId = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random())).current;

  const open = useCallback(() => {
    const s = openSession({ kind, ref, difficulty, topic, targetSec }, Date.now(), !document.hidden);
    setEndedId(null);
    return s;
  }, [kind, ref, difficulty, topic, targetSec]);

  useEffect(() => {
    sweepStale(recordSession);
    open();
    { const s = getActive(ref); if (s && !document.hidden && (isRunning(s) || s.auto)) saveActive(tabVisible(s, tabId, Date.now())); }
    rerender();
    const unsub = subscribeSessions(rerender);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const beat = window.setInterval(() => {
      const s = getActive(ref);
      if (s && !document.hidden && (isRunning(s) || s.auto)) saveActive(tabVisible(s, tabId, Date.now()));
    }, HEARTBEAT_MS);
    const onVis = () => {
      const s = getActive(ref);
      if (!s) return;
      const t = Date.now();
      if (document.hidden) saveActive(tabHidden(s, tabId, t));
      else if (isRunning(s) || s.auto) saveActive(tabVisible(s, tabId, t)); // a Pause click stays paused
      setNow(t);
    };
    const onHide = () => { const s = getActive(ref); if (s) saveActive(tabHidden(s, tabId, Date.now())); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(tick); window.clearInterval(beat); unsub();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      onHide(); // leaving the page: keep the time so far (never finishes the session)
    };
  }, [ref, open]);

  const active = getActive(ref);
  const ended: SolveSession | undefined = progress.sessions?.filter((x) => x.ref === ref).slice(-1)[0];
  // Solved elsewhere in this page (a validated submit ended the session) → show the result.
  const finished = !active && ended && (endedId === null || endedId === ended.id) ? ended : null;

  return {
    now,
    active: active ?? null,
    finished,
    seconds: active ? elapsedSec(active, now) : 0,
    toggle() {
      const s = getActive(ref); if (!s) return;
      const t = Date.now();
      saveActive(isRunning(s) ? pauseSession(settle(s, t), t) : tabVisible(resumeSession(s, t), tabId, t));
      setNow(t);
    },
    finish() {
      const done = finishSession(ref, recordSession);
      if (done) setEndedId(done.id);
    },
    restart() { open(); rerender(); },
  };
}

const btn = "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover/10 hover:text-ink focus-visible:outline-2";

/** Compact timer pill for a challenge header: elapsed time, optional target, pause/resume, finish. */
export function SolveTimer({ meta, className = "" }: { meta: OpenMeta; className?: string }) {
  const t = useSolveTimer(meta);
  const [confirm, setConfirm] = useState(false);
  // Stored timestamps only exist in the browser: render nothing on the server so hydration matches.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  const label = meta.kind === "sql" ? "SQL" : "Python";

  if (!t.active) {
    const f = t.finished;
    return (
      <div className={`inline-flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-2.5 py-1 text-xs ${className}`} role="group" aria-label={`${label} solve timer`}>
        <Timer className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
        {f ? (
          <span role="status" className={f.status === "solved" ? "font-medium text-success" : "text-ink-muted"}>
            {f.status === "solved" ? `Solved in ${formatDuration(f.activeSec)}` : `Session ended · ${formatDuration(f.activeSec)} · not solved`}
          </span>
        ) : <span className="text-ink-faint">Timer ready</span>}
        <button type="button" onClick={t.restart} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-accent hover:underline">
          <RotateCcw className="h-3 w-3" aria-hidden /> New attempt
        </button>
      </div>
    );
  }

  const running = isRunning(t.active);
  const target = t.active.targetSec;
  const over = target != null && t.seconds > target;
  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-2 py-0.5 text-xs ${className}`} role="group" aria-label={`${label} solve timer`}>
      <Timer className={`h-3.5 w-3.5 ${running ? "text-accent" : "text-ink-faint"}`} aria-hidden />
      <span role="timer" aria-live="off" aria-label={`Elapsed time ${formatClock(t.seconds)}`} className="font-mono text-sm font-semibold tabular-nums text-ink">{formatClock(t.seconds)}</span>
      {target != null && <span className={`tabular-nums ${over ? "text-warn" : "text-ink-faint"}`} title="A guide for this difficulty, not a limit">/ {formatClock(target)}{over ? " · over target" : ""}</span>}
      <span role="status" className="sr-only">{running ? "Timer running" : "Timer paused"}</span>
      {!running && <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted" aria-hidden>{t.active.auto ? "Tab hidden" : "Paused"}</span>}
      {confirm ? (
        <span className="inline-flex items-center gap-1" role="group" aria-label="Confirm finish">
          <span className="text-ink-muted">End without solving?</span>
          <button type="button" onClick={() => { t.finish(); setConfirm(false); }} className="rounded-md bg-surface-soft px-1.5 py-0.5 font-medium text-ink hover:bg-surface-overlay">End</button>
          <button type="button" onClick={() => setConfirm(false)} className="rounded-md px-1.5 py-0.5 text-ink-muted hover:text-ink">Keep going</button>
        </span>
      ) : (
        <>
          <button type="button" onClick={t.toggle} className={btn} aria-label={running ? "Pause timer" : "Resume timer"} title={running ? "Pause timer" : "Resume timer"}>
            {running ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          </button>
          <button type="button" onClick={() => setConfirm(true)} className={btn} aria-label="Finish session without solving" title="Finish session (recorded as not solved)">
            <Square className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
