import { useEffect, useRef } from "react";
import { DRAFT_SAVE_MS, saveDailyDraft } from "../../lib/dailyExercise";

/**
 * Saves the learner's code as the exercise's draft a moment after they stop typing, so they can continue later. `saved` is what is
 * already stored (nothing is written until `value` differs from it). Used by the in-page runner, the written exercise and the
 * embedded workspace, so a draft is stored the same way whichever screen the learner typed in.
 */
export function useDraftSaver(dayId: string, exId: string, value: string, saved: string) {
  const last = useRef(saved);
  useEffect(() => {
    if (value === last.current) return;
    const t = setTimeout(() => {
      last.current = value;
      saveDailyDraft(dayId, exId, value);
    }, DRAFT_SAVE_MS);
    return () => clearTimeout(t);
  }, [value, dayId, exId]);
}
