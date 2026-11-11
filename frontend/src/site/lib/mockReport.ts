/**
 * Post-interview report for the SQL mock interview. Scoring is unchanged (each question is graded by
 * comparing result rows, exactly as in practice). The report adds:
 *  - performance by topic
 *  - query-quality notes, from the shared SQL lint (heuristics: they describe the query text,
 *    they never change the score)
 *  - revision areas: topics with a miss, newest first
 * It reads only what the interview already stores: results, and the last query saved per question.
 */
import { lint } from "./compareSolutions";
import type { MockSession } from "./mock";
import type { Progress } from "./progress";
import type { QuestionSummary } from "../types";

export interface TopicResult { topic: string; label: string; solved: number; total: number; attempts: number; avgSolveSec: number | null }
export interface QualityNote { slug: string; question: string; level: "warn" | "info"; text: string }
export interface RevisionArea { topic: string; label: string; missed: { slug: string; title: string }[] }

export interface MockReport {
  topics: TopicResult[];
  quality: QualityNote[];
  revision: RevisionArea[];
  /** Questions solved on the first attempt. */
  firstTry: number;
  avgSolveSec: number | null;
}

export function buildMockReport(session: MockSession, index: QuestionSummary[], progress: Pick<Progress, "questions">): MockReport {
  const bySlug = new Map(index.map((q) => [q.slug, q]));
  const topics = new Map<string, TopicResult & { secs: number[] }>();
  const revision = new Map<string, RevisionArea>();
  const quality: QualityNote[] = [];
  const seen = new Set<string>();
  let firstTry = 0;
  const allSecs: number[] = [];

  for (const slug of session.slugs) {
    const q = bySlug.get(slug);
    if (!q) continue;
    const r = session.results[slug];
    const t = topics.get(q.topic) ?? { topic: q.topic, label: q.topicLabel, solved: 0, total: 0, attempts: 0, avgSolveSec: null, secs: [] };
    t.total++;
    t.attempts += r?.attempts ?? 0;
    if (r?.correct) {
      t.solved++;
      if (r.attempts === 1) firstTry++;
      if (r.solvedAfterSec != null) { t.secs.push(r.solvedAfterSec); allSecs.push(r.solvedAfterSec); }
    } else {
      const a = revision.get(q.topic) ?? { topic: q.topic, label: q.topicLabel, missed: [] };
      a.missed.push({ slug, title: `Q${q.number} ${q.title}` });
      revision.set(q.topic, a);
    }
    topics.set(q.topic, t);

    // Quality notes from the last query the learner saved for this question (heuristics, de-duplicated per rule).
    const sql = progress.questions[q.number]?.lastSql;
    if (sql && (r?.attempts ?? 0) > 0) {
      for (const n of lint(sql)) {
        const key = `${slug}:${n.text.slice(0, 30)}`;
        if (!seen.has(key)) { seen.add(key); quality.push({ slug, question: `Q${q.number} ${q.title}`, level: n.level, text: n.text }); }
      }
    }
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    topics: [...topics.values()].map(({ secs, ...t }) => ({ ...t, avgSolveSec: avg(secs) })).sort((a, b) => a.solved / a.total - b.solved / b.total || a.label.localeCompare(b.label)),
    quality: quality.sort((a, b) => Number(b.level === "warn") - Number(a.level === "warn")),
    revision: [...revision.values()],
    firstTry,
    avgSolveSec: avg(allSecs),
  };
}

/** The per-topic summary kept in the mock history. */
export const topicSummary = (r: MockReport) => r.topics.map((t) => ({ topic: t.topic, label: t.label, solved: t.solved, total: t.total }));
