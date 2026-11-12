import { useEffect, useReducer, useRef, useState } from "react";
import { Pause, Play, Timer } from "lucide-react";
import {
  HEARTBEAT_MS, elapsedSec, formatClock, getActive, isRunning, openSession, pauseSession, resumeSession, saveActive, settle,
  subscribeSessions, tabHidden, tabVisible,
} from "../../lib/solveSessions";
import { dayRef } from "../../lib/dailyStudy";
import { commitDayStudy, sweepDailyStudy } from "../../lib/dailyStudyStore";
import { HelpTooltip } from "../../help/HelpTooltip";

/**
 * Active study time for one lesson. Same clock as the SQL/Python solve timer (heartbeat grace, auto-pause while the tab is
 * hidden, one shared clock across tabs). It starts when the lesson page is visible, and is committed into `Progress.daily`
 * when the learner leaves the lesson. There is no target and no "solved" state: the time is a record, never a score.
 */
function useStudyTimer(dayId: string) {
  const ref = dayRef(dayId);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [now, setNow] = useState(() => Date.now());
  const tabId = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random())).current;

  useEffect(() => {
    sweepDailyStudy(dayId);
    openSession({ kind: "daily", ref, difficulty: "", topic: "daily" }, Date.now(), !document.hidden);
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
      onHide();
      // Leaving the lesson (route change or day switch): store the session. A closed tab skips this and is swept later.
      commitDayStudy(dayId);
    };
  }, [dayId, ref, tabId]);

  const active = getActive(ref);
  return {
    active: active ?? null,
    seconds: active ? elapsedSec(active, now) : 0,
    toggle() {
      const s = getActive(ref); if (!s) return;
      const t = Date.now();
      saveActive(isRunning(s) ? pauseSession(settle(s, t), t) : tabVisible(resumeSession(s, t), tabId, t));
      setNow(t);
    },
  };
}

const btn = "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover/10 hover:text-ink focus-visible:outline-2";

export function StudyTimer({ dayId, className = "" }: { dayId: string; className?: string }) {
  const t = useStudyTimer(dayId);
  // Timestamps live in the browser only: render nothing on the server so hydration matches.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || !t.active) return null;
  const running = isRunning(t.active);
  return (
    <div data-help="study-timer" className={`inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-2 py-0.5 text-xs ${className}`} role="group" aria-label="Lesson study timer">
      <Timer className={`h-3.5 w-3.5 ${running ? "text-accent" : "text-ink-faint"}`} aria-hidden />
      <span role="timer" aria-live="off" aria-label={`Study time ${formatClock(t.seconds)}`} className="font-mono text-sm font-semibold tabular-nums text-ink">{formatClock(t.seconds)}</span>
      <span role="status" className="sr-only">{running ? "Study timer running" : "Study timer paused"}</span>
      {!running && <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted" aria-hidden>{t.active.auto ? "Tab hidden" : "Paused"}</span>}
      <button type="button" onClick={t.toggle} className={btn} aria-label={running ? "Pause study timer" : "Resume study timer"} title={running ? "Pause" : "Resume"}>
        {running ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
      </button>
      <HelpTooltip id="study-timer" label="What does the study timer count?" />
    </div>
  );
}
