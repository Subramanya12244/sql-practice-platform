import { useEffect, useMemo, useState } from "react";
import { today as todayUtc, useProgress, type Progress } from "./progress";
import { EMPTY_DAILY, type DailyState } from "./dailyProgress";
import { sequenceFor, type BranchId, type DayMeta } from "./daily";
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
