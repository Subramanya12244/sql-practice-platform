/**
 * Rule-based revision schedule for SQL questions and Python problems. No model, no scoring
 * magic: each outcome moves a problem to a fixed interval given by RULES, which are shown to
 * learners and can be tuned here.
 */
import type { QuestionSummary } from "../types";
import type { PyExerciseMeta } from "./pyExercises";

/** Days until the next review, by stage. A clean review moves up one stage; trouble moves it back. */
export const LADDER = [1, 3, 7, 14, 30] as const;

export const RULES = {
  ladder: LADDER,
  /** Wrong submit or failed check: back to the first stage. */
  incorrectDays: 1,
  /** Correct, but the answer needed help: same gap again. Help means any of these: */
  slowMinutes: 15,
  /** Python: correct only after at least this many failed checks counts as slow. */
  slowFailedChecks: 3,
  /** Hint level at which an answer counts as helped (SQL ladder level 2 = first hint; Python = hints shown). */
  helpHintLevel: 2,
  /** This many attempts before the pass counts as helped. */
  manyAttempts: 3,
  /** Fast = done within this share of the goal time. A fast, clean answer after two clean ones skips a stage. */
  fastShare: 0.5,
  skipAfterClean: 2,
  /** Correct this many times in a row: mastered (the 30 day gap). */
  masteredAfter: 3,
  masteredDays: 30,
} as const;

export interface RevOutcome {
  at: string; ok: boolean;
  /** A scheduled re-solve (there was already a schedule), not the first outcome. */
  rev?: boolean;
  /** Done after the due day. */
  late?: boolean;
}
/** `stage` is an index into LADDER (the gap just scheduled); older items without it are read from `interval`. */
export interface RevItem { due: string; interval: number; streak: number; last: string; history: RevOutcome[]; stage?: number }
export type RevKey = `sql:${number}` | `py:${string}`;

const DAY = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Stage of an item scheduled before the ladder existed: the nearest step at or below its interval. */
export const stageFromInterval = (interval: number) => Math.max(0, LADDER.reduce((best, d, i) => (d <= interval ? i : best), 0));
export const stageOf = (r?: RevItem) => (r ? r.stage ?? stageFromInterval(r.interval) : -1);

export interface Outcome {
  correct: boolean;
  /** Took longer than the slow limit. */
  slow?: boolean;
  /** Highest hint level (SQL) or hints shown (Python) before this answer. */
  hints?: number;
  /** Graded attempts up to and including this one. */
  attempts?: number;
  /** Finished within RULES.fastShare of the goal time. */
  fast?: boolean;
}

/** An answer that needed help: slow, hints, or many attempts. */
export const neededHelp = (o: Outcome) => Boolean(o.slow || (o.hints ?? 0) >= RULES.helpHintLevel || (o.attempts ?? 0) >= RULES.manyAttempts);

/** The next schedule after an outcome (see RULES; every rule is also shown to the learner). */
export function nextRevision(prev: RevItem | undefined, outcome: Outcome, now = new Date()): RevItem {
  const day = now.toISOString().slice(0, 10);
  const before = stageOf(prev);
  const streak = outcome.correct ? (prev?.streak ?? 0) + 1 : 0;
  let stage: number;
  if (!outcome.correct) stage = 0;
  else if (before < 0) stage = 0; // first correct answer: look again tomorrow
  else if (neededHelp(outcome)) stage = before; // correct, with help: the same gap again
  else stage = Math.min(LADDER.length - 1, before + (outcome.fast && (prev?.streak ?? 0) >= RULES.skipAfterClean ? 2 : 1));
  const interval = LADDER[stage];
  const entry: RevOutcome = { at: now.toISOString(), ok: outcome.correct, ...(prev ? { rev: true, late: day > prev.due } : {}) };
  return { due: addDays(day, interval), interval, streak, stage, last: now.toISOString(), history: [...(prev?.history ?? []), entry].slice(-20) };
}

export const stage = (r: RevItem) => (r.streak >= RULES.masteredAfter ? "Mastered" : r.streak === 0 ? "Relearning" : "Learning");

/** Improvement: the share of correct outcomes after the first miss, or null if never missed. */
export function improvement(r: RevItem): { firstMiss: string; after: number; correctAfter: number } | null {
  const i = r.history.findIndex((h) => !h.ok);
  if (i < 0) return null;
  const after = r.history.slice(i + 1);
  return { firstMiss: r.history[i].at, after: after.length, correctAfter: after.filter((h) => h.ok).length };
}

export interface QueueItem {
  key: RevKey; kind: "sql" | "python"; title: string; path: string; difficulty: string; concepts: string[]; due: string; item?: RevItem; manual?: boolean;
  ref: QuestionSummary | PyExerciseMeta;
}

/**
 * Every scheduled problem. SQL questions solved before this schedule existed keep their old
 * review date (or 3 days after solving) until their next outcome.
 */
export function revisionQueue(index: QuestionSummary[], exercises: PyExerciseMeta[], p: {
  questions: Record<string, { solvedAt?: string; reviewDue?: string }>; revision?: Record<string, RevItem>; revisionMarks?: string[];
}, today: string): QueueItem[] {
  const rev = p.revision ?? {};
  const marks = new Set((p.revisionMarks ?? []).map((m) => m.toLowerCase()));
  const marked = (concepts: string[], topic: string) => [topic, ...concepts].some((c) => marks.has(c.toLowerCase()));
  const out: QueueItem[] = [];
  for (const q of index) {
    const r = rev[`sql:${q.number}`];
    const s = p.questions[q.number];
    const manual = marked(q.concepts, q.topicLabel);
    if (!r && !s?.solvedAt && !manual) continue;
    const due = r?.due ?? (s?.solvedAt ? s.reviewDue ?? addDays(s.solvedAt.slice(0, 10), 3) : today);
    out.push({ key: `sql:${q.number}`, kind: "sql", title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}`, difficulty: q.difficulty, concepts: q.concepts, due: manual && due > today ? today : due, item: r, manual, ref: q });
  }
  for (const e of exercises) {
    const r = rev[`py:${e.slug}`];
    const manual = marked(e.concepts, e.category);
    if (!r && !manual) continue;
    const due = r?.due ?? today;
    out.push({ key: `py:${e.slug}`, kind: "python", title: `${e.code} ${e.title}`, path: `/practice/python/${e.slug}`, difficulty: e.difficulty, concepts: e.concepts, due: manual && due > today ? today : due, item: r, manual, ref: e });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

export function splitQueue(items: QueueItem[], today: string) {
  return { overdue: items.filter((i) => i.due < today), today: items.filter((i) => i.due === today), upcoming: items.filter((i) => i.due > today) };
}

/** Account merge: keep the entry with the latest outcome for each key. */
export function mergeRevision(a: Record<string, RevItem> = {}, b: Record<string, RevItem> = {}): Record<string, RevItem> {
  const out = { ...b };
  for (const [k, v] of Object.entries(a)) if (!out[k] || v.last > out[k].last) out[k] = v;
  return out;
}

export interface RevisionStats {
  week: { reviews: number; correct: number; onTime: number };
  all: { reviews: number; correct: number; onTime: number };
  /** Items per stage (index = LADDER index), plus how many are mastered. */
  byStage: number[];
  mastered: number;
}

/** Completion statistics from the review history. Only scheduled re-solves count as reviews. */
export function revisionStats(revision: Record<string, RevItem> | undefined, today: string): RevisionStats {
  const from = addDays(today, -6);
  const out: RevisionStats = { week: { reviews: 0, correct: 0, onTime: 0 }, all: { reviews: 0, correct: 0, onTime: 0 }, byStage: LADDER.map(() => 0), mastered: 0 };
  for (const r of Object.values(revision ?? {})) {
    out.byStage[Math.min(LADDER.length - 1, stageOf(r))]++;
    if (r.streak >= RULES.masteredAfter) out.mastered++;
    for (const h of r.history) {
      if (!h.rev) continue;
      const bucket = h.at.slice(0, 10) >= from && h.at.slice(0, 10) <= today ? [out.week, out.all] : [out.all];
      for (const b of bucket) { b.reviews++; if (h.ok) b.correct++; if (!h.late) b.onTime++; }
    }
  }
  return out;
}
