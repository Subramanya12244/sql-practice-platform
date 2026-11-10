import { mergeRevision } from "./revision";
import { mergeSessions } from "./solveSessions";
import { mergeMistakes } from "./mistakes";
import type { Progress, QuestionProgress } from "./progress";

/** Supabase needs an email per account; plain usernames map to this synthetic domain. */
export const USERNAME_EMAIL_DOMAIN = "users.sqlpractice.local";

export const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export interface ProgressRow {
  question_number: number;
  attempts: number;
  solved_at: string | null;
  revealed: boolean;
  review_box?: number | null;
  review_due?: string | null;
}

export interface MockRow {
  created_at: string;
  solved: number;
  total: number;
  used_sec: number;
  duration_min: number;
}

export interface RemoteState {
  activeDays?: string[];
  cards?: Progress["cards"];
  lessons?: Progress["lessons"];
  bookmarks?: Progress["bookmarks"];
  read?: Progress["read"];
  dailyGoal?: Progress["dailyGoal"];
  dayCounts?: Progress["dayCounts"];
  plan?: Progress["plan"];
  answers?: Progress["answers"];
  portfolio?: Progress["portfolio"];
  reviews?: Progress["reviews"];
  revision?: Progress["revision"];
  revisionMarks?: Progress["revisionMarks"];
  sessions?: Progress["sessions"];
  mistakes?: Progress["mistakes"];
  /** Per-question evidence that has no column on the progress table. */
  qmeta?: Record<string, Pick<QuestionProgress, "practiced" | "imported" | "hintLevel" | "assisted" | "startedAt" | "solveSec" | "errorKinds" | "lastSql">>;
}

const earliest = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);

function mergeQuestion(local: QuestionProgress | undefined, row: ProgressRow): QuestionProgress {
  return {
    // Rows only on the server (e.g. imported from the repo) are not practice evidence.
    ...(local ? {} : { imported: true }),
    ...local,
    attempts: Math.max(local?.attempts ?? 0, row.attempts),
    solvedAt: earliest(local?.solvedAt, row.solved_at ?? undefined),
    revealed: Boolean(local?.revealed || row.revealed) || undefined,
    // Keep whichever schedule has progressed further.
    ...((row.review_box ?? 0) > (local?.reviewBox ?? 0)
      ? { reviewBox: row.review_box ?? undefined, reviewDue: row.review_due ?? undefined }
      : {}),
  };
}

/**
 * Combine account data with what is in this browser. Nothing is lost: attempts take
 * the max, the earliest solve wins, days and mocks are unioned, and cards keep the higher box.
 */
export function mergeProgress(local: Progress, rows: ProgressRow[], state: RemoteState, mocks: MockRow[]): Progress {
  const questions = { ...local.questions };
  for (const row of rows) questions[row.question_number] = mergeQuestion(questions[row.question_number], row);
  for (const [k, meta] of Object.entries(state.qmeta ?? {})) {
    // A saved query restores even on a device that has no other progress for the question.
    if (!questions[k] && meta.lastSql) questions[k] = { attempts: 0 };
    const q = questions[k];
    if (!q) continue;
    questions[k] = {
      ...meta,
      ...q,
      practiced: Boolean(q.practiced || meta.practiced) || undefined,
      imported: q.practiced || meta.practiced ? undefined : q.imported ?? meta.imported,
      hintLevel: Math.max(q.hintLevel ?? 0, meta.hintLevel ?? 0) || undefined,
      assisted: q.solvedAt === undefined ? meta.assisted : q.assisted ?? meta.assisted,
      // This browser's draft wins; otherwise use the account's copy.
      lastSql: q.lastSql || meta.lastSql || undefined,
    };
  }

  const cards = { ...(state.cards ?? {}) };
  for (const [k, v] of Object.entries(local.cards)) {
    if (!cards[k] || v.box > cards[k].box) cards[k] = v;
  }

  const seen = new Set<string>();
  const allMocks = [
    ...(local.mocks ?? []),
    ...mocks.map((m) => ({ date: m.created_at, solved: m.solved, total: m.total, usedSec: m.used_sec, durationMin: m.duration_min })),
  ]
    .filter((m) => {
      const key = `${m.date.slice(0, 16)}|${m.solved}|${m.total}|${m.usedSec}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-50);

  return {
    ...local,
    questions,
    cards,
    activeDays: [...new Set([...local.activeDays, ...(state.activeDays ?? [])])].sort().slice(-400),
    mocks: allMocks,
    lessons: { ...(state.lessons ?? {}), ...(local.lessons ?? {}) },
    bookmarks: [...new Set([...(local.bookmarks ?? []), ...(state.bookmarks ?? [])])],
    read: { ...(state.read ?? {}), ...(local.read ?? {}) },
    dailyGoal: local.dailyGoal ?? state.dailyGoal,
    dayCounts: mergeCounts(local.dayCounts, state.dayCounts),
    plan: local.plan ?? state.plan,
    answers: mergeAnswers(local.answers, state.answers),
    portfolio: local.portfolio ?? state.portfolio,
    reviews: mergeReviews(local.reviews, state.reviews),
    revision: mergeRevision(local.revision, state.revision),
    revisionMarks: [...new Set([...(local.revisionMarks ?? []), ...(state.revisionMarks ?? [])])],
    sessions: mergeSessions(local.sessions, state.sessions),
    mistakes: mergeMistakes(local.mistakes, state.mistakes),
  };
}

/** Per card, keep the record with more attempts (the later one on a tie). */
function mergeAnswers(a: Progress["answers"] = {}, b: Progress["answers"] = {}) {
  const out = { ...b };
  for (const [k, v] of Object.entries(a)) {
    const o = out[k];
    if (!o || v.attempts > o.attempts || (v.attempts === o.attempts && v.at > o.at)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Union of reviewed card keys per day, last 30 days. */
function mergeReviews(a: Progress["reviews"] = {}, b: Progress["reviews"] = {}) {
  const out: Record<string, string[]> = {};
  for (const d of new Set([...Object.keys(a), ...Object.keys(b)])) out[d] = [...new Set([...(a[d] ?? []), ...(b[d] ?? [])])];
  const days = Object.keys(out).sort().slice(-30);
  return days.length ? Object.fromEntries(days.map((d) => [d, out[d]])) : undefined;
}

function mergeCounts(a: Record<string, number> = {}, b: Record<string, number> = {}) {
  const out: Record<string, number> = { ...b };
  for (const [k, v] of Object.entries(a)) out[k] = Math.max(v, out[k] ?? 0);
  return out;
}

/** Rows to upload so the account holds everything this browser knows. */
export function progressToRows(p: Progress): ProgressRow[] {
  return Object.entries(p.questions)
    .filter(([, q]) => q.attempts > 0 || q.solvedAt || q.revealed)
    .map(([num, q]) => ({
      question_number: Number(num),
      attempts: q.attempts,
      solved_at: q.solvedAt ?? null,
      revealed: Boolean(q.revealed),
      review_box: q.reviewBox ?? null,
      review_due: q.reviewDue ?? null,
    }));
}
