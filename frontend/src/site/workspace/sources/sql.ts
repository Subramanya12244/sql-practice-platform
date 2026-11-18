/**
 * SQL question (public/data/q/<slug>.json, type `Question`) to ExerciseDef. Pure: no fetching, no store access.
 * Id `sql:<slug>`. Progress key stays the question number (`source.number`), exactly as the SQL practice page uses it.
 */
import type { Question, SchemaTable } from "../../types";
import { solutionSkeleton } from "../../components/HintLadder";
import type { Difficulty, ExerciseDef, Hint } from "../types";
import { conceptHint, ladder } from "./hintMap";

export const sqlExerciseId = (slug: string) => `sql:${slug}`;
export const asDifficulty = (d: string): Difficulty => (d === "Easy" || d === "Medium" || d === "Hard" ? d : "Medium");

/** Same starting text the SQL practice page shows (PracticePanel `starter`). */
export function sqlStarter(q: Pick<Question, "starter" | "tables" | "number" | "title">): string {
  if (q.starter) return q.starter;
  if (!q.tables.length) return "-- Query any Northwind table. Ctrl/⌘+Enter runs everything.\n\nSELECT *\nFROM customers\nLIMIT 10;\n";
  return `-- Q${q.number}: ${q.title}\n-- Tables: ${q.tables.join(", ")}\n\nSELECT\n  \nFROM ${q.tables[0] ?? ""};\n`;
}

export interface SqlSourceOptions {
  /** Table definitions (public/data/schema.json). Without it the problem panel lists table names only. */
  schema?: SchemaTable[];
  /** Related question numbers to ids, so `related` can be filled. */
  slugByNumber?: ReadonlyMap<number, string>;
}

export function sqlQuestionToExercise(q: Question, opts: SqlSourceOptions = {}): ExerciseDef {
  const hints: Hint[] = [conceptHint(q.concepts, `This question practises ${q.topicLabel}.`)];
  if (q.approach.trim()) hints.push({ level: 2, title: "Approach", body: `${q.watchOutFor ? `Watch out: ${q.watchOutFor}\n\n` : ""}${q.approach.trim()}` });
  if (q.solution.trim()) hints.push({ level: 3, title: "Partial structure", body: "```sql-syntax\n" + solutionSkeleton(q.solution) + "\n```" });
  const detail = [q.why?.trim(), q.pitfalls.length ? q.pitfalls.slice(0, 3).map((p) => `- ${p}`).join("\n") : ""].filter(Boolean).join("\n\n");
  if (detail) hints.push({ level: 4, title: "Detailed explanation", body: detail });

  const tables = q.tables.map((name) => ({ name, columns: (opts.schema?.find((t) => t.name === name)?.columns ?? []).map((c) => ({ name: c.name, type: c.type })) }));
  const related = opts.slugByNumber ? q.related.flatMap((n) => (opts.slugByNumber!.has(n) ? [sqlExerciseId(opts.slugByNumber!.get(n)!)] : [])) : undefined;
  const followups = (q.followups ?? []).map((f) => f.question).slice(0, 2);
  return {
    id: sqlExerciseId(q.slug),
    domain: "sql",
    source: { kind: "sql-question", slug: q.slug, number: q.number },
    title: q.title,
    difficulty: asDifficulty(q.difficulty),
    topic: q.topic,
    topicLabel: q.topicLabel,
    category: q.category,
    statement: q.problem,
    objectives: q.objective ? [q.objective] : [],
    concepts: q.concepts,
    starterCode: sqlStarter(q),
    dataset: { id: "northwind", label: "Northwind sample database", tables },
    expectedOutput: q.expectedOutput || undefined,
    validation: { kind: "sql-result", expectedSql: q.referenceQuery, orderMatters: q.sortRequired, orderBy: q.orderBy ?? null, database: "northwind" },
    hints: ladder(hints),
    commonMistakes: q.pitfalls,
    solution: { code: q.solution, explanation: q.takeaway || "" },
    interviewRelevance: followups.length ? `Likely follow-ups: ${followups.join(" ")}` : undefined,
    visualization: { enabled: true },
    related,
  };
}
