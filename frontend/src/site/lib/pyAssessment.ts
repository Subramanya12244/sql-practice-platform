/**
 * Python assessment helpers: how a check ended in plain words, the submission log kept for each
 * problem, and statistics across past assessments. Only outcomes are stored (pass or fail, counts,
 * when), never the learner's code or the hidden tests.
 */

import { PY_TIMEOUT_MS } from "./pyRunner";

export type CheckKind = "passed" | "failed" | "limit" | "error";
export interface CheckLog {
  /** Seconds since the assessment started. */
  at: number;
  ok: boolean;
  kind: CheckKind;
  /** Visible examples passed / total, and hidden edge-case tests passed / total (counts only). */
  visible?: [number, number];
  hidden?: [number, number];
}

/** Hard limits the sandbox enforces, shown to the learner. */
export const LIMITS = { seconds: PY_TIMEOUT_MS / 1000, note: "Code that runs longer than this is stopped, so an endless loop cannot freeze the page." } as const;

/** One line of plain language for how a check ended, including resource limits. Never includes test source. */
export function describeCheck(message: string, ok: boolean): { kind: CheckKind; text: string } {
  if (ok) return { kind: "passed", text: "All visible and hidden tests passed." };
  if (/Stopped after|Timed out|timeout|timed out/i.test(message))
    return { kind: "limit", text: `Your code ran longer than the ${LIMITS.seconds} second limit and was stopped. Look for a loop that never ends, or a nested loop over the whole input where a dict or set lookup would do.` };
  if (/MemoryError|out of memory|memory limit/i.test(message))
    return { kind: "limit", text: "Your code used too much memory and was stopped. Avoid building very large lists; process the data one item at a time." };
  if (/RecursionError|maximum recursion/i.test(message))
    return { kind: "limit", text: "Your recursion went too deep. Use a loop or an explicit stack for large inputs." };
  if (/Python could not start|Worker|failed to initialize|Failed to load/i.test(message))
    return { kind: "error", text: "The Python runtime did not start, so this check did not count. Try again in a moment." };
  if (/SyntaxError|IndentationError|NameError|NotImplementedError|Traceback/i.test(message))
    return { kind: "error", text: message.split("\n")[0].slice(0, 200) };
  return { kind: "failed", text: message.split("\n")[0].slice(0, 200) };
}

export interface ProblemStats {
  checks: number;
  /** Checks up to and including the first pass; null if it never passed. */
  checksToPass: number | null;
  /** Seconds from the start to the first pass. */
  secondsToPass: number | null;
  limitHits: number;
  /** Hidden edge-case tests passed / total on the last check that reported them. */
  hidden: [number, number] | null;
}

export function problemStats(log: CheckLog[] = []): ProblemStats {
  const first = log.findIndex((c) => c.ok);
  const lastHidden = [...log].reverse().find((c) => c.hidden)?.hidden ?? null;
  return { checks: log.length, checksToPass: first < 0 ? null : first + 1, secondsToPass: first < 0 ? null : log[first].at, limitHits: log.filter((c) => c.kind === "limit").length, hidden: lastHidden };
}

export interface AssessmentLike {
  at: string; usedSec: number; solved: number; total: number; durationMin: number;
  problems: { slug: string; passed: boolean; checks: number; log?: CheckLog[] }[];
}

export interface AssessmentStats {
  taken: number;
  averageScore: number | null;
  bestScore: number | null;
  averageMinutes: number | null;
  /** Average checks needed per solved problem, where known. */
  checksPerSolve: number | null;
  /** Average share of the time limit used, over finished assessments. */
  timeUsedShare: number | null;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function assessmentStats(history: AssessmentLike[]): AssessmentStats {
  if (!history.length) return { taken: 0, averageScore: null, bestScore: null, averageMinutes: null, checksPerSolve: null, timeUsedShare: null };
  const scores = history.map((h) => pct(h.solved, h.total));
  const solved = history.flatMap((h) => h.problems.filter((p) => p.passed && p.checks > 0));
  return {
    taken: history.length,
    averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    bestScore: Math.max(...scores),
    averageMinutes: Math.round(history.reduce((a, h) => a + h.usedSec, 0) / history.length / 60),
    checksPerSolve: solved.length ? Math.round((solved.reduce((a, p) => a + p.checks, 0) / solved.length) * 10) / 10 : null,
    timeUsedShare: Math.round((history.reduce((a, h) => a + h.usedSec / (h.durationMin * 60), 0) / history.length) * 100),
  };
}
