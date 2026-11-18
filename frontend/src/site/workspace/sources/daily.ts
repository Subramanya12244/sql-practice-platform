/**
 * Daily Learning exercise (content/daily/days/<id>.json, `Exercise` from lib/daily.ts) to ExerciseDef. Pure.
 * Id `daily:<dayId>#<exerciseId>`, the ref the Mistake Notebook and progress store already use (`dailyMistakeRef`).
 *
 * Written (self-assessed) exercises cannot run in a browser engine, so they are not converted (the function returns null) and
 * stay in the lesson page. Python exercises that import pandas or numpy get that domain, so the right adapter opens them.
 */
import type { Exercise } from "../../lib/daily";
import { dailyMistakeRef } from "../../lib/mistakes";
import type { Difficulty, Domain, ExerciseDef } from "../types";
import { distributeHints, ladder, conceptHint } from "./hintMap";

export const dailyExerciseId = (dayId: string, exerciseId: string) => dailyMistakeRef(dayId, exerciseId);

export interface DailyDayInfo { title?: string; topics?: string[]; phase?: string }

/** pandas wins over numpy when both are imported (a DataFrame task). */
export function pythonDomainOf(code: string): Extract<Domain, "python" | "pandas" | "numpy"> {
  if (/^\s*(?:import|from)\s+pandas\b/m.test(code)) return "pandas";
  if (/^\s*(?:import|from)\s+numpy\b/m.test(code)) return "numpy";
  return "python";
}

export function dailyExerciseToExercise(dayId: string, ex: Exercise, day: DailyDayInfo = {}, section: "guided" | "independent" = "guided"): ExerciseDef | null {
  if (ex.kind === "written") return null;
  const isSql = ex.kind === "sql";
  const domain: Domain = isSql ? "sql" : pythonDomainOf(`${ex.starter}\n${ex.solution}`);
  const difficulty: Difficulty = section === "guided" ? "Easy" : "Medium"; // Daily has no difficulty field: guided practice is the gentler tier
  const topics = day.topics ?? [];
  return {
    id: dailyExerciseId(dayId, ex.id),
    domain,
    source: { kind: "daily", dayId, exerciseId: ex.id },
    title: ex.title,
    difficulty,
    topic: topics[0] ?? day.phase ?? "daily",
    subtopic: day.title,
    statement: ex.prompt,
    objectives: [],
    concepts: topics,
    starterCode: ex.starter,
    dataset: isSql ? { id: "northwind", label: "Northwind sample database" } : undefined,
    expectedOutput: !isSql ? ex.expected : undefined,
    validation: isSql
      ? { kind: "sql-result", expectedSql: ex.solution, orderMatters: !!ex.ordered, orderBy: null, database: "northwind" }
      : ex.expected !== undefined ? { kind: "python-stdout", expected: ex.expected, stdin: ex.stdin } : { kind: "none" },
    hints: ladder([...(topics.length ? [conceptHint(topics, "")] : []), ...distributeHints(ex.hints ?? [], ex.solution)]),
    solution: ex.solution ? { code: ex.solution, explanation: "" } : undefined,
    visualization: { enabled: true },
  };
}

/** Every convertible exercise of a day, in lesson order (guided, then independent). */
export function dailyDayExercises(dayId: string, extras: { guided: Exercise[]; independent: Exercise[] }, day: DailyDayInfo = {}): ExerciseDef[] {
  return [
    ...extras.guided.map((e) => dailyExerciseToExercise(dayId, e, day, "guided")),
    ...extras.independent.map((e) => dailyExerciseToExercise(dayId, e, day, "independent")),
  ].filter((e): e is ExerciseDef => e !== null);
}
