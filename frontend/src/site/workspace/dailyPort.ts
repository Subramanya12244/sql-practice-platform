/**
 * Daily Learning inside the unified exercise workspace.
 *
 * One source of truth: the workspace writes what the in-page runner always wrote, through the same functions
 * (lib/dailyExercise.ts: `recordDailyCheck`, `trackDailyRun`, `saveDailyDraft`), so a pass or a failed check leaves the same
 * `Progress.daily` record, the same Mistake Notebook entry, the same `completeExercise` event and the same activity events
 * whichever screen the learner used. Nothing is recorded on open, run, visualize, hint or reveal:
 *   recordAttempt  graded Submit finished -> `recordDailyCheck` (the only call that can mark an exercise passed)
 *   recordRun      a Run finished        -> an activity event only (`python_executed` / `sql_executed`)
 *   recordHint     a hint opened         -> nothing is stored (the in-page ladder never stored hints either); the host is told
 *   recordReveal   solution opened       -> nothing is stored; the host is told
 *
 * This file also decides which Daily exercises the workspace can really run (`dailyEmbedDecision`). Exercises it cannot run keep
 * the in-page runner.
 */
import type { Exercise } from "../lib/daily";
import { DAY_BY_ID } from "../lib/daily";
import { recordDailyCheck, trackDailyRun, type DailyKind } from "../lib/dailyExercise";
import { classifyPyMistake } from "../lib/mistakes";
import { hasAdapterSource } from "./registry";
import { dailyExerciseToExercise } from "./sources/daily";
import type { Domain, ExerciseDef, ProgressPort } from "./types";

export const dailyKindOf = (ex: Pick<ExerciseDef, "domain">): DailyKind => (ex.domain === "sql" ? "sql" : "python");

/**
 * Python failure category from the text the session hands the port (`failureText` in useExerciseSession). The in-page runner files a
 * program that ran but printed the wrong thing under "wrong-output" and a crash under the exception's own category. A crash text
 * starts with the exception name ("NameError: ..."), so that is what separates the two.
 */
const CRASH_TEXT = /^(?:[A-Za-z_.]*(?:Error|Exception|Exit|Interrupt)|Timeout\w*)\b/;
export const pyCategoryOfFailure = (text: string | undefined): string => (text && CRASH_TEXT.test(text.trimStart()) ? classifyPyMistake(text) : "wrong-output");

export interface DailyPortOptions {
  /** A graded check did not pass (the host counts these to unlock the solution). */
  onFail?(ex: ExerciseDef): void;
  /** A graded check passed. The store has already been written. */
  onPass?(ex: ExerciseDef): void;
  /** A hint level was opened before the exercise was solved. */
  onHint?(ex: ExerciseDef, level: number): void;
  /** The workspace's own solution level was opened before the exercise was solved. */
  onReveal?(ex: ExerciseDef): void;
}

/** ProgressPort for one Daily exercise. Other exercise sources are ignored (their own port handles them). */
export function createDailyPort(opts: DailyPortOptions = {}): ProgressPort {
  return {
    recordAttempt(ex, passed, errorKind, code = "") {
      const s = ex.source;
      if (s.kind !== "daily") return;
      const kind = dailyKindOf(ex);
      recordDailyCheck({
        dayId: s.dayId, exId: s.exerciseId, kind, ok: passed, code,
        pyCategory: kind === "python" ? pyCategoryOfFailure(errorKind) : undefined,
        sqlErrorText: kind === "sql" ? errorKind ?? "" : undefined,
      });
      if (passed) opts.onPass?.(ex); else opts.onFail?.(ex);
    },
    recordHint(ex, level) {
      if (ex.source.kind === "daily") opts.onHint?.(ex, level);
    },
    recordReveal(ex) {
      if (ex.source.kind === "daily") opts.onReveal?.(ex);
    },
    recordRun(ex) {
      const s = ex.source;
      if (s.kind === "daily") trackDailyRun(dailyKindOf(ex), s.dayId, s.exerciseId);
    },
  };
}

// ── Which exercises the workspace can really run ─────────────────────────────────────────────────────────────────────
export interface EmbedDecision {
  /** Render the unified workspace in the lesson. False keeps the in-page runner. */
  embed: boolean;
  /** Why not (or "ok"). Shown in docs and tests, never to the learner. */
  reason: string;
  /** The workspace domain, when the exercise is graded in the browser. */
  domain?: Domain;
  /** The converted exercise (null for a written exercise). */
  def: ExerciseDef | null;
}

/**
 * Embed the workspace for this exercise, or keep the in-page runner? Pure; the lesson page and the audit use the same rule.
 *  - written: self-assessed, nothing to run or grade in a browser engine.
 *  - no expected output (nothing to grade): kept.
 *  - no adapter for the domain in this build: kept.
 *  - pandas or NumPy exercise that reads `stdin`: the data adapter does not feed stdin to a run, so the in-page runner keeps it.
 * SQL needs no extra rule: the SQL adapter derives each exercise's policy from its own reference script (including the exact writes the
 * reference makes), and siteWorkspaceDailyAdapters.test.ts runs every reference through that adapter, so an exercise the adapter would
 * refuse fails the test instead of reaching a learner.
 * Everything else is graded by the same code the in-page runner used (`submit` for SQL, `sameOutput` for Python).
 */
export function dailyEmbedDecision(dayId: string, ex: Exercise, section: "guided" | "independent" = "guided"): EmbedDecision {
  if (ex.kind === "written") return { embed: false, reason: "written: self-assessed, not run or graded by a browser engine", def: null };
  const meta = DAY_BY_ID.get(dayId);
  const def = dailyExerciseToExercise(dayId, ex, { title: meta?.title, topics: meta?.topics, phase: meta?.phase }, section);
  if (!def) return { embed: false, reason: "not convertible", def: null };
  const domain = def.domain;
  if (def.validation.kind === "none") return { embed: false, reason: "no expected output to grade against", domain, def };
  if (!hasAdapterSource(domain)) return { embed: false, reason: `no ${domain} engine in this build`, domain, def };
  if (ex.stdin !== undefined && (domain === "pandas" || domain === "numpy")) return { embed: false, reason: "reads stdin, which the pandas and NumPy adapter does not provide", domain, def };
  return { embed: true, reason: "ok", domain, def };
}

/**
 * Runtime gate for SQL: can the workspace's SQL adapter run this exercise's own reference answer under the policy it will enforce?
 * If it cannot (the safety checker refuses or cannot read the script, or fails to load), a learner could never type the answer in the
 * workspace, so the lesson keeps the in-page runner for that exercise instead of showing a workspace that cannot be solved.
 * Uses the adapter's own `policyOf` and `checkSqlPolicy`, so it cannot disagree with `run`. Never runs SQL.
 */
export async function sqlWorkspaceRunnable(def: ExerciseDef): Promise<{ ok: boolean; reason?: string }> {
  if (def.validation.kind !== "sql-result") return { ok: true };
  try {
    const [{ policyOf }, { checkSqlPolicy }] = await Promise.all([import("./adapters/sql/adapter"), import("./adapters/sql/policy")]);
    const spec = await policyOf(def);
    if (!spec) return { ok: true };
    const verdict = await checkSqlPolicy(def.validation.expectedSql, spec);
    return verdict.allowed ? { ok: true } : { ok: false, reason: verdict.reasons[0] };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
