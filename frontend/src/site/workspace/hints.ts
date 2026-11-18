/**
 * Pure rules for the five-level help ladder. Levels 1 to 4 come from `ExerciseDef.hints`; level 5 is the solution and exists
 * only when `ExerciseDef.solution` does. Nothing here opens a level: the session hook does that, one level at a time, on request.
 */
import type { ExerciseDef, Hint, HintLevel } from "./types";

export const HINT_LEVELS: { level: HintLevel; label: string; desc: string }[] = [
  { level: 1, label: "Concept", desc: "Which ideas this exercise needs" },
  { level: 2, label: "Approach", desc: "Where to start" },
  { level: 3, label: "Partial structure", desc: "The shape of an answer, with blanks" },
  { level: 4, label: "Detailed explanation", desc: "Why it works and where it goes wrong" },
  { level: 5, label: "Full solution", desc: "The reference answer, only when you ask" },
];

/** Levels that have content for this exercise, ascending. */
export function availableLevels(ex: Pick<ExerciseDef, "hints" | "solution">): HintLevel[] {
  const out = new Set<HintLevel>();
  for (const h of ex.hints) if (h.level >= 1 && h.level <= 4 && h.body.trim()) out.add(h.level);
  if (ex.solution?.code?.trim()) out.add(5);
  return [...out].sort((a, b) => a - b);
}

/** The next level to offer after `current` (0 = none opened), or null when the ladder is finished. Skips levels with no content. */
export function nextLevel(ex: Pick<ExerciseDef, "hints" | "solution">, current: number): HintLevel | null {
  return availableLevels(ex).find((l) => l > current) ?? null;
}

/** May `level` be opened now? Only the next available level, never a skip ahead. */
export const canOpen = (ex: Pick<ExerciseDef, "hints" | "solution">, current: number, level: number): boolean => nextLevel(ex, current) === level;

/** Hints visible at `current`: levels 1 to 4 up to and including it. The solution is never in this list. */
export function visibleHints(ex: Pick<ExerciseDef, "hints">, current: number): Hint[] {
  return ex.hints.filter((h) => h.level <= Math.min(current, 4) && h.body.trim()).sort((a, b) => a.level - b.level);
}

export const levelInfo = (level: number) => HINT_LEVELS.find((l) => l.level === level);
