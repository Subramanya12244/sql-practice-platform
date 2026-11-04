import type { QuestionSummary } from "../types";

export type MockLevel = "balanced" | "easier" | "harder";

export interface MockResult {
  attempts: number;
  correct: boolean;
  solvedAfterSec?: number;
}

export interface MockSession {
  slugs: string[];
  durationMin: number;
  level: MockLevel;
  startedAt: number;
  current: number;
  results: Record<string, MockResult>;
  finishedAt?: number;
}

export const MOCK_SIZE = 5;

const MIX: Record<MockLevel, [easy: number, medium: number, hard: number]> = {
  balanced: [2, 2, 1],
  easier: [3, 2, 0],
  harder: [0, 2, 3],
};

const bucket = (d: string) => (d === "Easy" ? 0 : d === "Medium" ? 1 : 2);

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick questions for a mock interview: the difficulty mix for the level, preferring
 * distinct topics, and topping up from any difficulty if a bucket runs short.
 */
export function pickMockQuestions(index: QuestionSummary[], level: MockLevel, rand: () => number = Math.random): string[] {
  const pool = shuffle(index, rand);
  const picked: QuestionSummary[] = [];
  const topics = new Set<string>();
  const take = (q: QuestionSummary) => {
    picked.push(q);
    topics.add(q.topic);
  };
  MIX[level].forEach((want, b) => {
    const inBucket = pool.filter((q) => bucket(q.difficulty) === b);
    for (const q of [...inBucket.filter((q) => !topics.has(q.topic)), ...inBucket]) {
      if (picked.filter((p) => bucket(p.difficulty) === b).length >= want) break;
      if (!picked.includes(q)) take(q);
    }
  });
  for (const q of pool) {
    if (picked.length >= MOCK_SIZE) break;
    if (!picked.includes(q)) take(q);
  }
  // Easiest first, like a real interview warm-up.
  return picked.sort((a, b) => bucket(a.difficulty) - bucket(b.difficulty)).map((q) => q.slug);
}

export function remainingSec(s: MockSession, now = Date.now()): number {
  return Math.max(0, Math.round((s.startedAt + s.durationMin * 60_000 - now) / 1000));
}

export function mockScore(s: MockSession) {
  const solved = s.slugs.filter((slug) => s.results[slug]?.correct).length;
  const end = s.finishedAt ?? Date.now();
  return { solved, total: s.slugs.length, usedSec: Math.round((end - s.startedAt) / 1000) };
}

const KEY = "sqlp.public.mock";

export function loadMock(): MockSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MockSession) : null;
  } catch {
    return null;
  }
}

export function saveMock(s: MockSession | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
