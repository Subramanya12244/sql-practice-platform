/**
 * Python practice exercise (content/python/*.md, `PyExercise` from lib/pyExercises.ts) to ExerciseDef. Pure.
 * Id `py:<slug>`, the same key lib/pyPractice.ts (`pyKey`) and the progress store use.
 */
import type { PyExercise } from "../../lib/pyExercises";
import { splitHints } from "../../lib/pyPractice";
import { asDifficulty } from "./sql";
import { conceptHint, distributeHints, ladder } from "./hintMap";
import type { ExerciseDef } from "../types";

export const pyExerciseId = (slug: string) => `py:${slug}`;
const FALLBACK_STARTER = "# Write your Python solution here\n";

export function pythonExerciseToExercise(ex: PyExercise): ExerciseDef {
  const { body, hints: authored } = splitHints(ex.body);
  const task = ex.task && ex.task.type === "python" ? ex.task : null;
  const concepts = ex.concepts;
  return {
    id: pyExerciseId(ex.slug),
    domain: "python",
    source: { kind: "python-exercise", slug: ex.slug },
    title: ex.title,
    difficulty: asDifficulty(ex.difficulty),
    topic: ex.topic || ex.category || "python",
    category: ex.category || undefined,
    subtopic: ex.skill || undefined,
    statement: body.trim(),
    objectives: [],
    concepts,
    minutes: ex.minutes || undefined,
    starterCode: task?.starter ?? FALLBACK_STARTER,
    validation: task ? { kind: "python-tests", tests: task.tests, hidden: task.hidden || undefined } : { kind: "none" },
    hints: ladder([conceptHint(concepts, `This exercise practises ${ex.skill || ex.category || "core Python"}.`), ...distributeHints(authored, task?.solution)]),
    solution: task?.solution ? { code: task.solution, explanation: task.explanation ?? ex.description } : undefined,
    complexity: ex.time || ex.space ? { time: ex.time || undefined, space: ex.space || undefined } : undefined,
    visualization: { enabled: true },
  };
}
