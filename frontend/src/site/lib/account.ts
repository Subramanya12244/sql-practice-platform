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
}

const earliest = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);

function mergeQuestion(local: QuestionProgress | undefined, row: ProgressRow): QuestionProgress {
  return {
    ...local,
    attempts: Math.max(local?.attempts ?? 0, row.attempts),
    solvedAt: earliest(local?.solvedAt, row.solved_at ?? undefined),
    revealed: Boolean(local?.revealed || row.revealed) || undefined,
  };
}

/**
 * Combine account data with what is in this browser. Nothing is lost: attempts take
 * the max, the earliest solve wins, days and mocks are unioned, and cards keep the higher box.
 */
export function mergeProgress(local: Progress, rows: ProgressRow[], state: RemoteState, mocks: MockRow[]): Progress {
  const questions = { ...local.questions };
  for (const row of rows) questions[row.question_number] = mergeQuestion(questions[row.question_number], row);

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
  };
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
    }));
}
