/**
 * ProgressPort backed by the EXISTING stores only. There is no workspace progress store.
 *
 *   SQL      lib/progress.ts (recordAttempt, recordHint, markRevealed, recordMistake), lib/mistakes.ts (classifySqlMistake),
 *            lib/errorHelp.ts (explainError, the same classifier the SQL practice page uses), lib/solveSessions.ts (noteAttempt)
 *   Python   lib/pyPractice.ts (recordPyAttempt), lib/progress.ts (completeExercise, recordMistake), lib/mistakes.ts (classifyPyMistake),
 *            lib/solveSessions.ts (noteHint, noteAttempt, noteExecution)
 *   Daily    lib/progress.ts (updateDay, completeExercise, recordMistake), lib/dailyProgress.ts (withId), lib/mistakes.ts (dailyMistake)
 *
 * The calls mirror what the existing pages make for a graded submit, so a learner who solves an exercise here sees the same
 * state as one who solved it on its own page. Opening a workspace, running code, opening a hint or watching a visualization never
 * marks anything solved. Only `recordAttempt(passed = true)` can, exactly like the existing "Check" buttons.
 */
import type { ExerciseDef, ProgressPort } from "./types";
import { completeExercise, markRevealed, recordAttempt, recordHint, recordMistake, recordSession, updateDay } from "../lib/progress";
import { recordPyAttempt } from "../lib/pyPractice";
import { createDailyPort } from "./dailyPort";
import { classifyPyMistake, classifySqlMistake, dailyMistake } from "../lib/mistakes";
import { explainError } from "../lib/errorHelp";
import { noteAttempt, noteExecution, noteHint } from "../lib/solveSessions";
import { MAX_DRAFT_CHARS, withId } from "../lib/dailyProgress";

/** The store functions the port may call. Injectable so tests can prove nothing else is touched. */
export interface ProgressDeps {
  completeExercise: typeof completeExercise;
  markRevealed: typeof markRevealed;
  recordAttempt: typeof recordAttempt;
  recordHint: typeof recordHint;
  recordMistake: typeof recordMistake;
  recordSession: typeof recordSession;
  updateDay: typeof updateDay;
  recordPyAttempt: typeof recordPyAttempt;
  noteAttempt: typeof noteAttempt;
  noteExecution: typeof noteExecution;
  noteHint: typeof noteHint;
}
const STORES: ProgressDeps = { completeExercise, markRevealed, recordAttempt, recordHint, recordMistake, recordSession, updateDay, recordPyAttempt, noteAttempt, noteExecution, noteHint };

/** Session ref the solve timer uses: "sql:<number>" or "py:<slug>". Daily has no solve session. */
function sessionRef(ex: ExerciseDef): string | null {
  const s = ex.source;
  return s.kind === "sql-question" ? `sql:${s.number}` : s.kind === "python-exercise" ? `py:${s.slug}` : null;
}

export function createProgressPort(deps: ProgressDeps = STORES): ProgressPort {
  return {
    recordAttempt(ex, passed, errorKind, code = "") {
      const s = ex.source;
      const ref = sessionRef(ex);
      if (s.kind === "sql-question") {
        // Same title the SQL practice page files the failure under ("Wrong result" when the query ran but differed).
        const kind = passed ? undefined : explainError(errorKind)?.title ?? (errorKind ? "SQL error" : "Wrong result");
        deps.recordAttempt(s.number, code, passed, kind);
        if (!passed) deps.recordMistake({ ref: `sql:${s.number}`, kind: "sql", topic: ex.topic, category: classifySqlMistake(kind, ex.topic), graded: true });
      } else if (s.kind === "python-exercise") {
        deps.recordPyAttempt(s.slug, passed);
        if (passed) deps.completeExercise(`py:${s.slug}`);
        else deps.recordMistake({ ref: `py:${s.slug}`, kind: "python", topic: ex.category || "other", category: classifyPyMistake(errorKind ?? ""), graded: true });
      } else if (s.kind === "daily") {
        const kind = ex.domain === "sql" ? "sql" : "python";
        const m = dailyMistake(s.dayId, s.exerciseId, kind);
        if (passed) {
          deps.updateDay(s.dayId, (r) => ({ ...r, attempted: withId(r.attempted, s.exerciseId), passed: withId(r.passed, s.exerciseId), drafts: { ...r.drafts, [s.exerciseId]: code.slice(0, MAX_DRAFT_CHARS) } }), true);
          deps.completeExercise(m.ref);
        } else {
          const category = kind === "python" ? classifyPyMistake(errorKind ?? "") : classifySqlMistake(explainError(errorKind)?.title, m.topicHint);
          deps.recordMistake({ ref: m.ref, kind, topic: m.topic, category, graded: true });
          deps.updateDay(s.dayId, (r) => ({ ...r, attempted: withId(r.attempted, s.exerciseId) }));
        }
      }
      // authored exercises (examples, tests) have no store.
      if (ref) deps.noteAttempt(ref, passed, Date.now(), deps.recordSession);
    },

    recordHint(ex, level) {
      const s = ex.source;
      if (s.kind === "sql-question") deps.recordHint(s.number, level);
      else if (s.kind === "python-exercise") deps.noteHint(`py:${s.slug}`, level);
    },

    recordReveal(ex) {
      if (ex.source.kind === "sql-question") deps.markRevealed(ex.source.number);
    },

    recordRun(ex, ok, errorText) {
      const ref = sessionRef(ex);
      if (ref) deps.noteExecution(ref);
      if (ok) return;
      const s = ex.source;
      if (s.kind === "sql-question") deps.recordMistake({ ref: `sql:${s.number}`, kind: "sql", topic: ex.topic, category: classifySqlMistake(explainError(errorText)?.title, ex.topic), graded: false });
      else if (s.kind === "python-exercise") deps.recordMistake({ ref: `py:${s.slug}`, kind: "python", topic: ex.category || "other", category: classifyPyMistake(errorText ?? ""), graded: false });
    },
  };
}

/**
 * The default port: the real stores. Daily exercises go through `createDailyPort`, the same writes the Daily lesson page makes
 * (including the mistake-solved step, activity events and the Python failure category), so `/workspace?e=daily:...` and the lesson
 * leave identical records. Other sources use `createProgressPort`.
 */
const baseStorePort = createProgressPort();
const dailyStorePort = createDailyPort();
const isDaily = (ex: ExerciseDef) => ex.source.kind === "daily";
export const storeProgressPort: ProgressPort = {
  recordAttempt: (ex, passed, errorKind, code) => (isDaily(ex) ? dailyStorePort : baseStorePort).recordAttempt(ex, passed, errorKind, code),
  recordHint: (ex, level) => (isDaily(ex) ? dailyStorePort : baseStorePort).recordHint(ex, level),
  recordReveal: (ex) => (isDaily(ex) ? dailyStorePort : baseStorePort).recordReveal(ex),
  recordRun: (ex, ok, errorText) => (isDaily(ex) ? dailyStorePort : baseStorePort).recordRun?.(ex, ok, errorText),
};
