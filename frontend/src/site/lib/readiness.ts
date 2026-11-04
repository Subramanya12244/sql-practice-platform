import type { QuestionSummary, Topic } from "../types";
import type { NoteMeta } from "./learning";
import type { Progress } from "./progress";

/** Minimum number of questions practiced in a topic before it is scored at all. */
export const MIN_EVIDENCE = 3;
/** Reasonable first-solve times by difficulty, for the efficiency dimension (seconds). */
const TARGET_SEC: Record<string, number> = { Easy: 6 * 60, Medium: 12 * 60, Hard: 20 * 60 };

export type Level = "Strong" | "Developing" | "Needs improvement" | "Not assessed";

export interface Dimension {
  score: number | null; // 0–100, null = no evidence for this dimension
  detail: string;
}

export interface TopicReadiness {
  topic: string;
  label: string;
  total: number;
  practiced: number;
  solvedPractice: number;
  solvedIndependent: number;
  solvedAssisted: number;
  importedSolved: number;
  hardSolved: number;
  dims: { knowledge: Dimension; application: Dimension; independence: Dimension; efficiency: Dimension; retention: Dimension };
  score: number | null;
  level: Level;
  topErrors: [string, number][];
}

export interface Readiness {
  topics: TopicReadiness[];
  overall: number | null;
  assessedTopics: number;
  coverage: number; // share of questions with practice evidence
  mockAverage: number | null;
  mocks: number;
  repeatedMistakes: [string, number][];
  consistency: number; // active days in the last 14
  nextAssessment: string;
  evidenceNote: string;
}

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function levelFor(score: number | null): Level {
  if (score === null) return "Not assessed";
  return score >= 75 ? "Strong" : score >= 50 ? "Developing" : "Needs improvement";
}

/**
 * Evidence-based estimate. Only questions submitted in the editor count as evidence; solves
 * imported from the repo are shown but never scored, and assisted solves never count as
 * independent. Every number here is derived from stored activity — nothing is inferred.
 */
export function assessReadiness(index: QuestionSummary[], topics: Topic[], notes: NoteMeta[], p: Progress, today: string): Readiness {
  const all: TopicReadiness[] = topics.map((t) => {
    const qs = index.filter((q) => q.topic === t.slug);
    const prog = qs.map((q) => ({ q, s: p.questions[q.number] }));
    const practiced = prog.filter(({ s }) => s?.practiced);
    const solvedP = practiced.filter(({ s }) => s?.solvedAt);
    const independent = solvedP.filter(({ s }) => !s?.assisted);
    const imported = prog.filter(({ s }) => s?.solvedAt && !s.practiced).length;

    // Knowledge: notes read for this topic + flashcard boxes for its questions.
    const topicNotes = notes.filter((n) => n.questions.some((num) => qs.some((q) => q.number === num)));
    const readNotes = topicNotes.filter((n) => p.read?.[n.slug]).length;
    const cards = qs.map((q) => p.cards[q.number]).filter(Boolean);
    const knowledgeParts: number[] = [];
    if (topicNotes.length) knowledgeParts.push(pct(readNotes, topicNotes.length));
    if (cards.length) knowledgeParts.push(Math.round((100 * cards.reduce((s, c) => s + c.box, 0)) / (5 * cards.length)));
    const knowledge: Dimension = {
      score: knowledgeParts.length ? avg(knowledgeParts) : null,
      detail: `${readNotes}/${topicNotes.length} notes read · ${cards.length} flashcards reviewed`,
    };

    const application: Dimension = {
      score: practiced.length ? pct(solvedP.length, practiced.length) : null,
      detail: `${solvedP.length} of ${practiced.length} practiced questions solved`,
    };
    const independence: Dimension = {
      score: solvedP.length ? pct(independent.length, solvedP.length) : null,
      detail: `${independent.length} independent, ${solvedP.length - independent.length} with hints or solution`,
    };

    const effParts = solvedP.map(({ q, s }) => {
      const byAttempts = 100 / Math.max(1, s!.attempts);
      const target = TARGET_SEC[q.difficulty] ?? TARGET_SEC.Medium;
      const byTime = s!.solveSec ? Math.min(100, (100 * target) / s!.solveSec) : null;
      return byTime === null ? byAttempts : (byAttempts + byTime) / 2;
    });
    const times = solvedP.map(({ s }) => s!.solveSec).filter((x): x is number => !!x);
    const efficiency: Dimension = {
      score: effParts.length ? avg(effParts) : null,
      detail: `${(solvedP.reduce((a, { s }) => a + (s?.attempts ?? 0), 0) / Math.max(1, solvedP.length)).toFixed(1)} attempts per solve${
        times.length ? ` · median ${Math.round([...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] / 60)} min` : ""
      }`,
    };

    const reviewed = solvedP.filter(({ s }) => s?.reviewBox);
    const retention: Dimension = {
      score: reviewed.length ? Math.round((100 * reviewed.reduce((a, { s }) => a + (s!.reviewBox ?? 1), 0)) / (5 * reviewed.length)) : null,
      detail: reviewed.length ? `${reviewed.length} re-solved from the review queue` : "no reviews yet",
    };

    const assessed = practiced.length >= MIN_EVIDENCE;
    const weighted: [Dimension, number][] = [[application, 0.3], [independence, 0.3], [efficiency, 0.15], [knowledge, 0.15], [retention, 0.1]];
    const have = weighted.filter(([d]) => d.score !== null);
    const w = have.reduce((s, [, x]) => s + x, 0);
    const score = assessed && w ? Math.round(have.reduce((s, [d, x]) => s + d.score! * x, 0) / w) : null;

    const errors: Record<string, number> = {};
    for (const { s } of prog) for (const [k, v] of Object.entries(s?.errorKinds ?? {})) errors[k] = (errors[k] ?? 0) + v;

    return {
      topic: t.slug,
      label: t.label,
      total: qs.length,
      practiced: practiced.length,
      solvedPractice: solvedP.length,
      solvedIndependent: independent.length,
      solvedAssisted: solvedP.length - independent.length,
      importedSolved: imported,
      hardSolved: solvedP.filter(({ q }) => q.difficulty === "Hard").length,
      dims: { knowledge, application, independence, efficiency, retention },
      score,
      level: levelFor(score),
      topErrors: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  });

  const assessed = all.filter((t) => t.score !== null);
  const overall = assessed.length >= 3 ? Math.round(assessed.reduce((s, t) => s + t.score! * t.total, 0) / assessed.reduce((s, t) => s + t.total, 0)) : null;
  const practicedTotal = all.reduce((s, t) => s + t.practiced, 0);
  const mocks = p.mocks ?? [];
  const errorTotals: Record<string, number> = {};
  for (const t of all) for (const [k, v] of t.topErrors) errorTotals[k] = (errorTotals[k] ?? 0) + v;
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 13);
  const recentDays = p.activeDays.filter((d) => d >= since.toISOString().slice(0, 10)).length;
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + (assessed.length ? 7 : 3));

  return {
    topics: all,
    overall,
    assessedTopics: assessed.length,
    coverage: pct(practicedTotal, index.length),
    mockAverage: mocks.length ? avg(mocks.map((m) => pct(m.solved, m.total))) : null,
    mocks: mocks.length,
    repeatedMistakes: Object.entries(errorTotals).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5),
    consistency: recentDays,
    nextAssessment: next.toISOString().slice(0, 10),
    evidenceNote:
      overall === null
        ? `Not enough evidence yet: an overall estimate needs at least 3 topics with ${MIN_EVIDENCE}+ practiced questions each (you have ${assessed.length}).`
        : `Based on ${practicedTotal} practiced questions across ${assessed.length} topics.`,
  };
}
