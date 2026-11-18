/**
 * Exercise sources: stable ids, id parsing, loading by id, and a schema check. The same exercise yields the same id and the same
 * validation wherever it is shown, because every host goes through these converters.
 *
 *   sql:<slug>                 public/data/q/<slug>.json
 *   py:<slug>                  content/python/<slug>.md
 *   daily:<dayId>#<exerciseId> content/daily/days/<dayId>.json (guided and independent, never written)
 */
import { DAY_BY_ID, loadDay } from "../../lib/daily";
import { loadExercise } from "../../lib/pyExercises";
import { loadQuestion, loadSchema } from "../../lib/data";
import type { ExerciseDef } from "../types";
import { dailyDayExercises } from "./daily";
import { pythonExerciseToExercise } from "./python";
import { sqlQuestionToExercise } from "./sql";
import { enrichExercise } from "./enrichment";

export { dailyExerciseToExercise, dailyDayExercises, dailyExerciseId, pythonDomainOf } from "./daily";
export { pythonExerciseToExercise, pyExerciseId } from "./python";
export { sqlQuestionToExercise, sqlExerciseId, sqlStarter } from "./sql";
export { distributeHints, leaksSolution } from "./hintMap";
export { enrichExercise, enrichmentProblems, loadEnrichment, mergeEnrichment, resetEnrichmentCache, type EnrichmentFile } from "./enrichment";

export type ParsedId = { kind: "sql"; slug: string } | { kind: "py"; slug: string } | { kind: "daily"; dayId: string; exerciseId: string };

export function parseExerciseId(id: string): ParsedId | null {
  const m = /^(sql|py):([A-Za-z0-9][A-Za-z0-9_-]*)$/.exec(id);
  if (m) return { kind: m[1] as "sql" | "py", slug: m[2] };
  const d = /^daily:([A-Za-z0-9]+)#([A-Za-z0-9_-]+)$/.exec(id);
  return d ? { kind: "daily", dayId: d[1], exerciseId: d[2] } : null;
}

/** Load and convert one exercise. Resolves to null when the id is malformed or the content does not exist. */
export async function loadExerciseById(id: string): Promise<ExerciseDef | null> {
  const base = await loadBaseExerciseById(id);
  return base ? enrichExercise(base) : null;
}

/** The converted exercise without enrichment. Grading data is identical either way. */
export async function loadBaseExerciseById(id: string): Promise<ExerciseDef | null> {
  const p = parseExerciseId(id);
  if (!p) return null;
  try {
    if (p.kind === "sql") {
      const [q, schema] = await Promise.all([loadQuestion(p.slug), loadSchema().catch(() => undefined)]);
      return sqlQuestionToExercise(q, { schema });
    }
    if (p.kind === "py") {
      const ex = await loadExercise(p.slug);
      return ex ? pythonExerciseToExercise(ex) : null;
    }
    const content = await loadDay(p.dayId);
    if (!content) return null;
    const meta = DAY_BY_ID.get(p.dayId);
    return dailyDayExercises(p.dayId, content, { title: meta?.title, topics: meta?.topics, phase: meta?.phase }).find((e) => e.id === id) ?? null;
  } catch {
    return null;
  }
}

/** Problems that make an ExerciseDef unfit to show. Empty when valid. Used by the tests and available to dev tooling. */
export function exerciseProblems(ex: ExerciseDef): string[] {
  const out: string[] = [];
  const p = parseExerciseId(ex.id);
  if (!p) out.push(`id "${ex.id}" is not sql:<slug>, py:<slug> or daily:<day>#<id>`);
  const s = ex.source;
  if (p && s.kind === "sql-question" && !(p.kind === "sql" && p.slug === s.slug)) out.push("id does not match source");
  if (p && s.kind === "python-exercise" && !(p.kind === "py" && p.slug === s.slug)) out.push("id does not match source");
  if (p && s.kind === "daily" && !(p.kind === "daily" && p.dayId === s.dayId && p.exerciseId === s.exerciseId)) out.push("id does not match source");
  if (!ex.title.trim()) out.push("empty title");
  if (!ex.statement.trim()) out.push("empty statement");
  if (!ex.validation) out.push("no validation");
  if (ex.validation?.kind === "sql-result" && !ex.validation.expectedSql.trim()) out.push("sql-result validation has no expected query");
  if (ex.validation?.kind === "python-tests" && !ex.validation.tests.trim()) out.push("python-tests validation has no tests");
  if (ex.validation?.kind !== "none" && ex.validation && !ex.starterCode.trim()) out.push("graded exercise has no starter code");
  if (ex.domain === "sql" && ex.validation?.kind !== "sql-result" && ex.validation?.kind !== "none") out.push("sql exercise with a python validation");
  if (ex.domain !== "sql" && (ex.validation?.kind === "sql-result")) out.push("python-family exercise with a sql validation");
  const seen = new Set<number>();
  for (const h of ex.hints) {
    if (![1, 2, 3, 4].includes(h.level)) out.push(`hint level ${h.level} is not 1 to 4 (level 5 is the solution)`);
    if (seen.has(h.level)) out.push(`duplicate hint level ${h.level}`);
    seen.add(h.level);
    if (!h.body.trim()) out.push(`empty hint at level ${h.level}`);
    if (ex.solution?.code && h.body.includes(ex.solution.code.trim()) && ex.solution.code.trim().length > 12) out.push(`hint level ${h.level} contains the full solution`);
  }
  return out;
}
