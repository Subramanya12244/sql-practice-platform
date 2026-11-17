import { DAY_BY_ID, type DayMeta } from "./daily";
import { programmeStats } from "./dailyProgress";
import type { DailyView } from "./useDaily";

/** The lesson the learner last opened, if any: the day with the newest `lastVisit`. */
export function lastVisitedDay(view: Pick<DailyView, "state">): DayMeta | undefined {
  let best: { id: string; at: string } | undefined;
  for (const [id, rec] of Object.entries(view.state.days)) {
    if (rec.lastVisit && (!best || rec.lastVisit > best.at)) best = { id, at: rec.lastVisit };
  }
  return best ? DAY_BY_ID.get(best.id) : undefined;
}

/** Where the Daily Learning programme stands for this learner, from real progress only. Nothing is shown as done that is not. */
export function dailyResume(view: Pick<DailyView, "state" | "seq" | "path">) {
  const stats = programmeStats(view.seq, view.state);
  const last = lastVisitedDay(view);
  const lastDone = last ? !!view.state.days[last.id]?.completedAt : false;
  const next = stats.current;
  const target = last && !lastDone ? last : next;
  const started = stats.completed > 0 || !!last;
  return { stats, last, lastDone, next, target, started };
}
