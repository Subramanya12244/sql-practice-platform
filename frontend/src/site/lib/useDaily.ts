import { useEffect, useMemo, useState } from "react";
import { today as todayUtc, useProgress, type Progress } from "./progress";
import { EMPTY_DAILY, masteryOf, type DailyState } from "./dailyProgress";
import { loadDay, sequenceFor, type BranchId, type DayExtras, type DayMeta } from "./daily";
import type { RevItem } from "./revision";

export interface DailyView {
  progress: Progress;
  state: DailyState;
  /** The learner's chosen path, if any. */
  path: BranchId | undefined;
  /** The 180 days they follow (the 90 common days until a path is chosen). */
  seq: DayMeta[];
  revisions: Record<string, RevItem>;
}

export function useDaily(): DailyView {
  const progress = useProgress();
  const state = progress.daily ?? EMPTY_DAILY;
  const seq = useMemo(() => sequenceFor(state.path), [state.path]);
  return { progress, state, path: state.path, seq, revisions: progress.revision ?? {} };
}

/** Today's date (UTC, as the rest of DataForge uses), known only after mount so prerendered HTML never bakes in a date. */
export function useToday(): string | null {
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(todayUtc()), []);
  return day;
}

export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

const extrasCache = new Map<string, DayExtras | null>();

/**
 * Ids of completed days that are also mastered (knowledge check 80%+, independent exercises passed, revision done).
 * Mastery needs each lesson's exercise list, so the lessons of completed days are loaded once and cached. Empty until
 * they have loaded; never guessed.
 */
export function useMasteredIds(state: DailyState): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    void (async () => {
      const out = new Set<string>();
      for (const [id, rec] of Object.entries(state.days)) {
        if (!rec.completedAt) continue;
        if (!extrasCache.has(id)) extrasCache.set(id, await loadDay(id).catch(() => null));
        const extras = extrasCache.get(id);
        if (extras && masteryOf(rec, extras).mastered) out.add(id);
      }
      if (live) setIds(out);
    })();
    return () => { live = false; };
  }, [state.days]);
  return ids;
}
