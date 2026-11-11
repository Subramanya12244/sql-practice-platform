/** Browser glue for Daily Learning study time: moves finished timers from the active store into `Progress.daily`. */
import { recordStudy } from "./progress";
import { GRACE_MS, activeWithPrefix, takeActive } from "./solveSessions";
import { DAILY_STALE_MS, dayRef, toStudySession } from "./dailyStudy";

/**
 * End this lesson's timer and store it. The session ends at the last heartbeat plus the grace period at most, so time after
 * a sleep or a closed tab is never counted. Returns true when a session was kept (false: none open, or too short).
 */
export function commitDayStudy(dayId: string, now = Date.now()): boolean {
  const s = takeActive(dayRef(dayId));
  if (!s) return false;
  const session = toStudySession(s, Math.min(now, s.beat + GRACE_MS));
  if (!session) return false;
  recordStudy(dayId, session);
  return true;
}

/**
 * Commit daily timers nobody has touched for a while (a closed tab, a crash). `except` is the lesson on screen, whose
 * timer is alive. Each ends at its last heartbeat, so the idle gap is never counted as study.
 */
export function sweepDailyStudy(except?: string, now = Date.now()) {
  for (const s of activeWithPrefix("day:")) {
    if (s.kind !== "daily" || s.ref === (except ? dayRef(except) : "") || now - s.beat <= DAILY_STALE_MS) continue;
    const taken = takeActive(s.ref);
    const session = taken && toStudySession(taken, taken.beat);
    if (session) recordStudy(s.ref.slice(4), session);
  }
}
