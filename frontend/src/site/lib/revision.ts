/**
 * Rule-based revision schedule for SQL questions and Python problems. No model, no scoring
 * magic: each outcome moves a problem to a fixed interval given by RULES, which are shown to
 * learners and can be tuned here.
 */
import type { QuestionSummary } from "../types";
import type { PyExerciseMeta } from "./pyExercises";

export const RULES = {
  /** A wrong submit or a failed check. */
  incorrectDays: 1,
  /** Correct, but slow (SQL: first solve took longer than slowMinutes) or after many failed tries. */
  slowDays: 3,
  /** Correct. */
  correctDays: 7,
  /** Correct this many times in a row: the problem is mastered and moves to periodic review. */
  masteredAfter: 3,
  masteredDays: 30,
  slowMinutes: 15,
  /** Python: correct only after at least this many failed checks counts as "slow". */
  slowFailedChecks: 3,
} as const;

export interface RevOutcome { at: string; ok: boolean }
export interface RevItem { due: string; interval: number; streak: number; last: string; history: RevOutcome[] }
export type RevKey = `sql:${number}` | `py:${string}`;

const DAY = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The next schedule after an outcome. */
export function nextRevision(prev: RevItem | undefined, outcome: { correct: boolean; slow?: boolean }, now = new Date()): RevItem {
  const day = now.toISOString().slice(0, 10);
  const streak = outcome.correct ? (prev?.streak ?? 0) + 1 : 0;
  const interval = !outcome.correct ? RULES.incorrectDays
    : streak >= RULES.masteredAfter ? RULES.masteredDays
      : outcome.slow ? RULES.slowDays : RULES.correctDays;
  return { due: addDays(day, interval), interval, streak, last: now.toISOString(), history: [...(prev?.history ?? []), { at: now.toISOString(), ok: outcome.correct }].slice(-12) };
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
