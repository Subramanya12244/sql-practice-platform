/**
 * Teaching content layered over converted exercises by id. Files live in content/workspace/enrichment/*.json:
 *   { "version": 1, "items": { "<exercise id>": ExerciseEnrichment } }
 * They are loaded lazily (one chunk per file) and merged by `enrichExercise`. Enrichment never touches grading data
 * (validation, starterCode, solution.code), so an exercise grades the same with or without it.
 */
import type { DebugNote, ExerciseDef, ExerciseEnrichment, Hint } from "../types";
import { leaksSolution } from "./hintMap";

const files = import.meta.glob("../../content/workspace/enrichment/*.json") as Record<string, () => Promise<{ default: EnrichmentFile }>>;

export interface EnrichmentFile { version: 1; items: Record<string, ExerciseEnrichment> }

let cache: Promise<Map<string, ExerciseEnrichment>> | null = null;

/** All enrichment items by exercise id. Cached after the first call. A malformed file is skipped, never fatal. */
export function loadEnrichment(): Promise<Map<string, ExerciseEnrichment>> {
  cache ??= (async () => {
    const map = new Map<string, ExerciseEnrichment>();
    await Promise.all(Object.values(files).map(async (load) => {
      try {
        const f = (await load()).default;
        if (f?.version === 1 && f.items) for (const [id, e] of Object.entries(f.items)) map.set(id, e);
      } catch { /* skip */ }
    }));
    return map;
  })();
  return cache;
}

export function resetEnrichmentCache() { cache = null; }

const DEBUG_CATEGORIES = new Set([
  "syntax", "join", "filter", "grouping", "aggregation", "null", "window", "performance", "types", "variables", "control-flow",
  "functions", "runtime", "indexing", "filtering", "missing-data", "shape", "broadcasting", "axis", "matmul", "transformation",
]);

/** Problems with one enrichment item. Empty when it is fit to merge. Used by the merge and by the content tests. */
export function enrichmentProblems(id: string, e: ExerciseEnrichment, base?: ExerciseDef): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const h of e.hints ?? []) {
    if (![1, 2, 3, 4].includes(h.level)) out.push(`${id}: hint level ${h.level} is not 1 to 4`);
    if (seen.has(h.level)) out.push(`${id}: duplicate hint level ${h.level}`);
    seen.add(h.level);
    if (!h.body?.trim()) out.push(`${id}: empty hint ${h.level}`);
    if (base?.solution?.code && leaksSolution(h.body ?? "", base.solution.code)) out.push(`${id}: hint ${h.level} contains the full solution`);
  }
  for (const d of e.debugging ?? []) {
    if (!DEBUG_CATEGORIES.has(d.category)) out.push(`${id}: unknown debugging category "${d.category}"`);
    if (!d.symptom?.trim() || !d.cause?.trim() || !d.fix?.trim()) out.push(`${id}: debugging note "${d.category}" is incomplete`);
    if (base?.solution?.code && leaksSolution(d.fix ?? "", base.solution.code)) out.push(`${id}: debugging fix contains the full solution`);
  }
  for (const a of e.alternatives ?? []) {
    if (!a.title?.trim() || !a.code?.trim()) out.push(`${id}: alternative is incomplete`);
    if (a.note !== undefined && !a.note.trim()) out.push(`${id}: alternative "${a.title}" has an empty note`);
  }
  return out;
}

const nonEmpty = <T>(a: T[] | undefined): a is T[] => !!a && a.length > 0;

/** Merge enrichment into an exercise. Items with problems are ignored whole. Grading fields are never changed. */
export function mergeEnrichment(ex: ExerciseDef, e: ExerciseEnrichment | undefined): ExerciseDef {
  if (!e || enrichmentProblems(ex.id, e, ex).length > 0) return ex;
  const hints: Hint[] = nonEmpty(e.hints)
    ? [...ex.hints.filter((h) => !e.hints!.some((n) => n.level === h.level)), ...e.hints].sort((a, b) => a.level - b.level)
    : ex.hints;
  const alternatives = nonEmpty(e.alternatives) ? [...(ex.solution?.alternatives ?? []), ...e.alternatives] : ex.solution?.alternatives;
  const solution = ex.solution
    ? { ...ex.solution, explanation: ex.solution.explanation?.trim() ? ex.solution.explanation : e.explanation ?? ex.solution.explanation, ...(alternatives ? { alternatives } : {}) }
    : ex.solution;
  return {
    ...ex,
    hints,
    solution,
    ...(nonEmpty<DebugNote>(e.debugging) ? { debugging: e.debugging } : {}),
    ...(nonEmpty(e.constraints) ? { constraints: e.constraints } : {}),
    ...(e.realWorld?.trim() ? { realWorld: e.realWorld } : {}),
    ...(nonEmpty(e.prerequisites) ? { prerequisites: e.prerequisites } : {}),
    ...(nonEmpty(e.commonMistakes) ? { commonMistakes: e.commonMistakes } : {}),
    ...(e.complexity ? { complexity: e.complexity } : {}),
    ...(e.interviewRelevance?.trim() ? { interviewRelevance: e.interviewRelevance } : {}),
  };
}

export async function enrichExercise(ex: ExerciseDef): Promise<ExerciseDef> {
  return mergeEnrichment(ex, (await loadEnrichment()).get(ex.id));
}
