import { useSyncExternalStore } from "react";

/** Per-visitor progress, kept in localStorage. Every access is guarded: storage may be unavailable. */

export interface QuestionProgress {
  attempts: number;
  solvedAt?: string;
  lastSql?: string;
  revealed?: boolean;
  /** Re-solve schedule for the review queue (Leitner box 1–5, next due day). */
  reviewBox?: number;
  reviewDue?: string;
  /** Submitted in the editor at least once (evidence). Repo/account imports don't set this. */
  practiced?: boolean;
  /** Came from an import (e.g. solved in the GitHub repo), not from practice here. */
  imported?: boolean;
  /** Highest assistance level used: 1 concept … 5 full solution. */
  hintLevel?: number;
  /** The first solve happened after hints ≥ 2 or a revealed solution. Never counts as independent. */
  assisted?: boolean;
  /** First interaction time, and seconds from it to the first solve. */
  startedAt?: string;
  solveSec?: number;
  /** Counts of classified errors on failed submits ("Column not grouped", "Wrong result", …). */
  errorKinds?: Record<string, number>;
}

export interface Progress {
  version: 1;
  questions: Record<string, QuestionProgress>;
  /** ISO dates (YYYY-MM-DD) on which the visitor solved at least one question or reviewed cards. */
  activeDays: string[];
  /** Flashcard Leitner box per question number (1 = review soon … 5 = mastered). */
  cards: Record<string, { box: number; due: string }>;
  /** Finished mock interviews, newest last. */
  mocks?: { date: string; solved: number; total: number; usedSec: number; durationMin: number }[];
  /** Learning-path exercises passed, keyed "lesson-slug#index" → ISO time. */
  lessons?: Record<string, string>;
  /** Saved items, keyed "note:<slug>", "pattern:<slug>", "map:<slug>", "q:<number>". */
  bookmarks?: string[];
  /** Recently opened learning pages, newest first. */
  recent?: { key: string; title: string; path: string; at: string }[];
  /** Theory notes marked as read: slug → ISO time. */
  read?: Record<string, string>;
  /** Daily goal: learning actions (solves, reviews, notes read, exercises) per day. */
  dailyGoal?: number;
  /** Learning actions per day, for the goal meter. */
  dayCounts?: Record<string, number>;
  /** Tutor behaviour: the highest assistance level it may show, and whether level 5 asks first. */
  tutor?: { maxLevel: number; confirmSolution: boolean };
  /** One-off data migrations already applied to this record. */
  migrations?: string[];
}

/** Receives every change so a signed-in account can mirror it; null when anonymous. */
export interface ProgressSink {
  question(num: number, q: QuestionProgress, solvedNow: boolean): void;
  mock(entry: NonNullable<Progress["mocks"]>[number]): void;
  state(p: Progress): void;
}
let sink: ProgressSink | null = null;
export function setProgressSink(next: ProgressSink | null) {
  sink = next;
}

const KEY = "sqlp.public.progress";
const RENUMBER = "q98-142-to-q147-191";
const EMPTY: Progress = { version: 1, questions: {}, activeDays: [], cards: {}, migrations: [RENUMBER] };

/**
 * Practice questions Q98–Q142 became Q147–Q191 (they clashed with imported Q98–Q146).
 * Move saved attempts and flashcard boxes so nobody loses progress.
 */
export function migrateProgress(p: Progress): Progress {
  if (p.migrations?.includes(RENUMBER)) return p;
  const shift = <T,>(rec: Record<string, T>) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => {
      const n = Number(k);
      return [n >= 98 && n <= 142 ? String(n + 49) : k, v];
    }));
  return { ...p, questions: shift(p.questions), cards: shift(p.cards), migrations: [...(p.migrations ?? []), RENUMBER] };
}
const listeners = new Set<() => void>();
let current: Progress = EMPTY;
let loaded = false;

function read(): Progress {
  if (loaded) return current;
  loaded = true;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Progress;
      if (parsed && parsed.version === 1) current = migrateProgress({ ...EMPTY, ...parsed, migrations: parsed.migrations ?? [] });
    }
  } catch {
    /* storage unavailable or corrupt — start fresh */
  }
  return current;
}

function write(next: Progress) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const today = () => new Date().toISOString().slice(0, 10);

function addDay(days: string[], day: string): string[] {
  return days.includes(day) ? days : [...days, day].sort().slice(-400);
}

export function recordAttempt(num: number, sql: string, correct: boolean, errorKind?: string) {
  const p = read();
  const prev = p.questions[num] ?? { attempts: 0 };
  const now = new Date();
  const firstSolve = correct && !prev.solvedAt;
  const startedAt = prev.startedAt ?? now.toISOString();
  const q: QuestionProgress = {
    ...prev,
    attempts: prev.attempts + 1,
    lastSql: sql,
    practiced: true,
    startedAt,
    solvedAt: prev.solvedAt ?? (correct ? now.toISOString() : undefined),
    ...(firstSolve
      ? {
          assisted: (prev.hintLevel ?? 0) >= 2 || Boolean(prev.revealed),
          solveSec: Math.max(1, Math.round((now.getTime() - Date.parse(startedAt)) / 1000)),
        }
      : {}),
    ...(!correct && errorKind ? { errorKinds: { ...prev.errorKinds, [errorKind]: (prev.errorKinds?.[errorKind] ?? 0) + 1 } } : {}),
  };
  write({
    ...p,
    questions: { ...p.questions, [num]: q },
    ...(correct ? bump(p) : { activeDays: p.activeDays }),
  });
  sink?.question(num, q, correct && !prev.solvedAt);
  if (correct) sink?.state(current);
}

export function saveDraft(num: number, sql: string) {
  const p = read();
  const prev = p.questions[num] ?? { attempts: 0 };
  write({ ...p, questions: { ...p.questions, [num]: { ...prev, lastSql: sql, startedAt: prev.startedAt ?? new Date().toISOString() } } });
}

/** Record that assistance level `level` (1–5) was opened for a question. */
export function recordHint(num: number, level: number) {
  const p = read();
  const prev = p.questions[num] ?? { attempts: 0 };
  if ((prev.hintLevel ?? 0) >= level) return;
  const q = { ...prev, hintLevel: level, startedAt: prev.startedAt ?? new Date().toISOString(), revealed: prev.revealed || level >= 5 || undefined };
  write({ ...p, questions: { ...p.questions, [num]: q } });
  sink?.question(num, q, false);
  sink?.state(current);
}

export function markRevealed(num: number) {
  const p = read();
  const prev = p.questions[num] ?? { attempts: 0 };
  const q = { ...prev, revealed: true };
  write({ ...p, questions: { ...p.questions, [num]: q } });
  sink?.question(num, q, false);
}

const BOX_DAYS = [0, 1, 2, 4, 8, 16];

/** `num` is a question number, or a string key such as "n:left-join#0" for note-based cards. */
export function reviewCard(num: number | string, knewIt: boolean) {
  const p = read();
  const prevBox = p.cards[num]?.box ?? 1;
  const box = knewIt ? Math.min(5, prevBox + 1) : 1;
  const due = new Date(Date.now() + BOX_DAYS[box] * 86_400_000).toISOString().slice(0, 10);
  write({
    ...p,
    cards: { ...p.cards, [num]: { box, due } },
    ...bump(p),
  });
  sink?.state(current);
}

/** Re-solving a solved question from the review queue moves it up a box; a miss sends it back to box 1. */
export function reviewQuestion(num: number, correct: boolean) {
  const p = read();
  const prev = p.questions[num];
  if (!prev?.solvedAt) return;
  const box = correct ? Math.min(5, (prev.reviewBox ?? 1) + 1) : 1;
  const due = new Date(Date.now() + BOX_DAYS[box] * 86_400_000).toISOString().slice(0, 10);
  const q = { ...prev, reviewBox: box, reviewDue: due };
  write({ ...p, questions: { ...p.questions, [num]: q }, activeDays: addDay(p.activeDays, today()) });
  sink?.question(num, q, false);
}

export function recordMock(entry: { solved: number; total: number; usedSec: number; durationMin: number }) {
  const p = read();
  const mock = { date: new Date().toISOString(), ...entry };
  write({
    ...p,
    mocks: [...(p.mocks ?? []), mock].slice(-50),
    activeDays: addDay(p.activeDays, today()),
  });
  sink?.mock(mock);
  sink?.state(current);
}

function bump(p: Progress): Pick<Progress, "dayCounts" | "activeDays"> {
  const d = today();
  const counts = Object.fromEntries(Object.entries(p.dayCounts ?? {}).sort().slice(-60));
  counts[d] = (counts[d] ?? 0) + 1;
  return { dayCounts: counts, activeDays: addDay(p.activeDays, d) };
}

export function toggleBookmark(key: string) {
  const p = read();
  const has = p.bookmarks?.includes(key);
  write({ ...p, bookmarks: has ? p.bookmarks!.filter((k) => k !== key) : [key, ...(p.bookmarks ?? [])].slice(0, 200) });
  sink?.state(current);
}

export function recordVisit(key: string, title: string, path: string) {
  const p = read();
  if (p.recent?.[0]?.key === key) return;
  const recent = [{ key, title, path, at: new Date().toISOString() }, ...(p.recent ?? []).filter((r) => r.key !== key)].slice(0, 12);
  write({ ...p, recent });
}

export function markNoteRead(slug: string, isRead = true) {
  const p = read();
  const next = { ...(p.read ?? {}) };
  if (isRead) {
    if (next[slug]) return;
    next[slug] = new Date().toISOString();
    write({ ...p, read: next, ...bump(p) });
  } else {
    delete next[slug];
    write({ ...p, read: next });
  }
  sink?.state(current);
}

export function setTutorSettings(t: NonNullable<Progress["tutor"]>) {
  const p = read();
  write({ ...p, tutor: { maxLevel: Math.max(1, Math.min(5, t.maxLevel)), confirmSolution: t.confirmSolution } });
}

export function setDailyGoal(n: number) {
  const p = read();
  write({ ...p, dailyGoal: Math.max(1, Math.min(20, Math.round(n))) });
  sink?.state(current);
}

export function completeExercise(key: string) {
  const p = read();
  if (p.lessons?.[key]) return;
  write({ ...p, lessons: { ...p.lessons, [key]: new Date().toISOString() }, ...bump(p) });
  sink?.state(current);
}

/** Consecutive active days ending today (or yesterday, so the streak survives until tonight). */
export function streak(days: string[]): number {
  const set = new Set(days);
  const d = new Date();
  if (!set.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  while (set.has(d.toISOString().slice(0, 10))) {
    n++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

export function exportProgress(): string {
  return JSON.stringify(read(), null, 2);
}

export function importProgress(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Progress;
    if (parsed?.version !== 1 || typeof parsed.questions !== "object") return false;
    write(migrateProgress({ ...EMPTY, migrations: [], ...parsed }));
    return true;
  } catch {
    return false;
  }
}

export function resetProgress() {
  write(EMPTY);
}

export function getProgress(): Progress {
  return read();
}

/** Swap in merged account progress (used after sign-in). */
export function replaceProgress(next: Progress) {
  write(next);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      loaded = false;
      read();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Server render and first client render both see EMPTY, so hydration matches; real data follows. */
export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
