/**
 * Daily Learning graded exercises: the ONE place that writes what a learner does on an exercise to the stores.
 *
 * Two screens drive an exercise: the in-page runner (`GradedExercise` in components/daily/LessonUi.tsx) and the unified exercise
 * workspace (workspace/dailyPort.ts, embedded in the lesson). Both call these functions, so a pass, a failed check, a draft or a
 * run is recorded with the same store calls, in the same order, whichever screen the learner used. Nothing here runs code or
 * grades: the caller says whether the answer was right.
 *
 * What is recorded (and what never is):
 *  - a check that passed: `markMistakeSolved`, `updateDay` (attempted, passed, draft; counts toward the daily goal), `completeExercise`.
 *  - a check that failed: `recordMistake` (graded, count and category only, never code) and `updateDay` (attempted).
 *  - a draft: `updateDay` (drafts) a moment after the learner stops typing.
 *  - activity events: `*_executed` for a Run, `*_submitted` (with `passed`) for a check.
 *  Opening an exercise, running code, opening a hint, looking at a solution or visualizing never marks anything passed.
 */
import { track } from "./activity";
import { MAX_DRAFT_CHARS, withId } from "./dailyProgress";
import { explainError } from "./errorHelp";
import { classifySqlMistake, dailyMistake } from "./mistakes";
import { completeExercise, markMistakeSolved, recordMistake, updateDay } from "./progress";

export type DailyKind = "python" | "sql";

/** How long after the last keystroke a draft is saved. */
export const DRAFT_SAVE_MS = 900;

/** The activity ref both screens use. */
export const dailyActivityRef = (dayId: string, exId: string) => `daily:${dayId}:${exId}`;

/** A Run (not graded). Fires the same event the in-page runner always has. */
export function trackDailyRun(kind: DailyKind, dayId: string, exId: string) {
  track(kind === "python" ? "python_executed" : "sql_executed", dailyActivityRef(dayId, exId));
}

/** Save the learner's code as a draft (Daily Learning keeps one draft per exercise id). */
export function saveDailyDraft(dayId: string, exId: string, code: string) {
  updateDay(dayId, (r) => ({ ...r, drafts: { ...r.drafts, [exId]: code.slice(0, MAX_DRAFT_CHARS) } }));
}

export interface DailyCheck {
  dayId: string;
  exId: string;
  kind: DailyKind;
  /** The grading verdict (SQL: `submit` said correct; Python: the program ran and its output matched). */
  ok: boolean;
  /** The learner's code: stored as the draft on a pass. */
  code: string;
  /** Python failure category. Default `"wrong-output"` (the program ran but printed the wrong thing). */
  pyCategory?: string;
  /** SQL: the engine's error text when the query itself failed to run (used only to pick a category, never stored). */
  sqlErrorText?: string;
}

/**
 * A graded check finished. Records the activity event, then the pass or the failure. This is the only function that can mark a
 * Daily exercise passed.
 */
export function recordDailyCheck({ dayId, exId, kind, ok, code, pyCategory = "wrong-output", sqlErrorText = "" }: DailyCheck) {
  track(kind === "python" ? "python_submitted" : "sql_submitted", dailyActivityRef(dayId, exId), { passed: ok });
  const mistake = dailyMistake(dayId, exId, kind);
  if (ok) {
    markMistakeSolved(mistake.ref);
    updateDay(dayId, (r) => ({ ...r, attempted: withId(r.attempted, exId), passed: withId(r.passed, exId), drafts: { ...r.drafts, [exId]: code.slice(0, MAX_DRAFT_CHARS) } }), true);
    completeExercise(`daily:${dayId}#${exId}`);
  } else {
    // A failed graded check goes into the Mistake Notebook: a count and a category, never the learner's code.
    recordMistake({ ...mistake, category: kind === "python" ? pyCategory : classifySqlMistake(explainError(sqlErrorText)?.title, mistake.topicHint), graded: true });
    updateDay(dayId, (r) => ({ ...r, attempted: withId(r.attempted, exId) }));
  }
}

/**
 * Daily solution policy: a solution unlocks after a pass, after two checks that did not pass, or (guided exercises only) once every
 * hint has been opened. Independent exercises have no hints.
 */
export function canRevealSolution(s: { passed: boolean; fails: number; guided: boolean; hintsOpened: number; hintsTotal: number }): boolean {
  return s.passed || s.fails >= 2 || (s.guided && s.hintsTotal > 0 && s.hintsOpened >= s.hintsTotal);
}

/** Copy shown while the solution is locked. */
export const SOLUTION_LOCKED_NOTE = (guided: boolean) =>
  guided ? "A solution unlocks after you have used all the hints or tried twice." : "No hints on independent exercises. A solution unlocks after two checks that did not pass.";
