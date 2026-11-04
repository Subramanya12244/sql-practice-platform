import { useSyncExternalStore } from "react";

/** Per-visitor progress, kept in localStorage. Every access is guarded: storage may be unavailable. */

export interface QuestionProgress {
  attempts: number;
  solvedAt?: string;
  lastSql?: string;
  revealed?: boolean;
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
const EMPTY: Progress = { version: 1, questions: {}, activeDays: [], cards: {} };
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
      if (parsed && parsed.version === 1) current = { ...EMPTY, ...parsed };
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

export function recordAttempt(num: number, sql: string, correct: boolean) {
  const p = read();
  const prev = p.questions[num] ?? { attempts: 0 };
  const q: QuestionProgress = {
    ...prev,
    attempts: prev.attempts + 1,
    lastSql: sql,
    solvedAt: prev.solvedAt ?? (correct ? new Date().toISOString() : undefined),
  };
  write({
    ...p,
    questions: { ...p.questions, [num]: q },
    activeDays: correct ? addDay(p.activeDays, today()) : p.activeDays,
  });
  sink?.question(num, q, correct && !prev.solvedAt);
  if (correct) sink?.state(current);
}

export function saveDraft(num: number, sql: string) {
  const p = read();
  const prev = p.questions[num] ?? { attempts: 0 };
  write({ ...p, questions: { ...p.questions, [num]: { ...prev, lastSql: sql } } });
}

export function markRevealed(num: number) {
  const p = read();
  const prev = p.questions[num] ?? { attempts: 0 };
  const q = { ...prev, revealed: true };
  write({ ...p, questions: { ...p.questions, [num]: q } });
  sink?.question(num, q, false);
}

const BOX_DAYS = [0, 1, 2, 4, 8, 16];

export function reviewCard(num: number, knewIt: boolean) {
  const p = read();
  const prevBox = p.cards[num]?.box ?? 1;
  const box = knewIt ? Math.min(5, prevBox + 1) : 1;
  const due = new Date(Date.now() + BOX_DAYS[box] * 86_400_000).toISOString().slice(0, 10);
  write({
    ...p,
    cards: { ...p.cards, [num]: { box, due } },
    activeDays: addDay(p.activeDays, today()),
  });
  sink?.state(current);
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

export function completeExercise(key: string) {
  const p = read();
  if (p.lessons?.[key]) return;
  write({ ...p, lessons: { ...p.lessons, [key]: new Date().toISOString() }, activeDays: addDay(p.activeDays, today()) });
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
    write({ ...EMPTY, ...parsed });
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
