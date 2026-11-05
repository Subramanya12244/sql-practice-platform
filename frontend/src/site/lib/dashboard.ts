/**
 * Learning dashboard metrics, all derived from the visitor's real progress record.
 * Nothing here is estimated or seeded: a new visitor gets zeros and empty lists.
 * XP, levels, achievements and missions live in gamification.ts.
 */
import type { Progress } from "./progress";
import { addDaysIso } from "./career";

/** Learning actions for the 7 days ending today (oldest first). */
export function weekActivity(p: Progress, today: string): { day: string; count: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDaysIso(today, i - 6);
    return { day, count: p.dayCounts?.[day] ?? 0 };
  });
}
