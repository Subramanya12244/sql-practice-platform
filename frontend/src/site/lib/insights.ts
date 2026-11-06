import type { QuestionSummary, Topic } from "../types";
import type { Progress } from "./progress";

export interface TopicScore {
  topic: string;
  label: string;
  total: number;
  solved: number;
  attempts: number;
  /** 0 (strong) … 1 (needs work). */
  weakness: number;
}

/**
 * Score each topic from this visitor's history: low coverage, many attempts per
 * solve, and revealed solutions all count as weakness. Untouched topics sit in
 * the middle so they still get recommended, after the ones you struggle with.
 */
export function topicScores(index: QuestionSummary[], topics: Topic[], p: Progress): TopicScore[] {
  return topics.map((t) => {
    const qs = index.filter((q) => q.topic === t.slug);
    let solved = 0;
    let attempts = 0;
    let revealed = 0;
    for (const q of qs) {
      const s = p.questions[q.number];
      if (!s) continue;
      attempts += s.attempts;
      if (s.solvedAt) solved++;
      if (s.revealed) revealed++;
    }
    const touched = attempts > 0 || revealed > 0;
    const coverage = qs.length ? solved / qs.length : 1;
    const effort = solved ? Math.min(1, (attempts / solved - 1) / 3) : touched ? 1 : 0.5;
    const peeked = qs.length ? revealed / qs.length : 0;
    const weakness = touched ? 0.5 * (1 - coverage) + 0.35 * effort + 0.15 * peeked : 0.5;
    return { topic: t.slug, label: t.label, total: qs.length, solved, attempts, weakness: Math.round(weakness * 100) / 100 };
  });
}

/** Unsolved questions from the weakest topics, easiest first within each topic. */
export function practiceNext(index: QuestionSummary[], topics: Topic[], p: Progress, n = 3): QuestionSummary[] {
  const rank = { Easy: 0, Medium: 1, Hard: 2 } as Record<string, number>;
  const weak = topicScores(index, topics, p)
    .filter((s) => s.solved < s.total)
    .sort((a, b) => b.weakness - a.weakness || a.label.localeCompare(b.label));
  const out: QuestionSummary[] = [];
  // Round-robin over weak topics so one topic doesn't fill the whole list.
  const pools = weak.map((w) =>
    index
      .filter((q) => q.topic === w.topic && !p.questions[q.number]?.solvedAt)
      .sort((a, b) => (rank[a.difficulty] ?? 1) - (rank[b.difficulty] ?? 1) || a.number - b.number),
  );
  for (let round = 0; out.length < n && pools.some((pool) => pool.length > round); round++) {
    for (const pool of pools) {
      if (pool[round] && out.length < n) out.push(pool[round]);
    }
  }
  return out;
}

/** Solved questions due for a re-solve, oldest-due first. */
export function dueQuestions(index: QuestionSummary[], p: Progress, today: string): QuestionSummary[] {
  return index
    .filter((q) => {
      const s = p.questions[q.number];
      const r = p.revision?.[`sql:${q.number}`];
      if (r) return r.due <= today;
      if (!s?.solvedAt) return false;
      const due = s.reviewDue ?? addDays(s.solvedAt.slice(0, 10), 3);
      return due <= today;
    })
    .sort((a, b) => {
      const da = p.revision?.[`sql:${a.number}`]?.due ?? p.questions[a.number]?.reviewDue ?? "";
      const db = p.revision?.[`sql:${b.number}`]?.due ?? p.questions[b.number]?.reviewDue ?? "";
      return da.localeCompare(db) || a.number - b.number;
    });
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
