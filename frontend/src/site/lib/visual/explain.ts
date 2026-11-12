/**
 * Universal "Explain visually": progressive explanations built from the learner's own code and real results. Everything
 * is rule-based and runs in the browser; there is no AI service. The full solution is never produced unless the learner
 * asks for that last level.
 */
import { parseSelect } from "../sqlClauses";
import { classifyPyMistake } from "../mistakes";

export type Lang = "sql" | "python";
export type Level = "concept" | "hint" | "visual" | "detailed" | "solution";
export const LEVELS: { id: Level; label: string }[] = [
  { id: "concept", label: "Concept" }, { id: "hint", label: "First hint" }, { id: "visual", label: "Visual demonstration" },
  { id: "detailed", label: "Detailed execution" }, { id: "solution", label: "Full solution explanation" },
];

export interface ExplainContext {
  lang: Lang;
  code: string;
  topic?: string;
  prompt?: string;
  hints?: string[];
  /** The model solution. Only shown at the last level, and only when the learner asks. */
  solution?: string;
  /** Python: the exact expected stdout. */
  expected?: string;
  /** What the learner's run really produced. */
  run?: { ok: boolean; text?: string; error?: string; columns?: string[]; rowCount?: number; rows?: unknown[][] };
  verdict?: { ok: boolean; message: string };
}

const CONCEPTS: { re: RegExp; lang?: Lang; text: string }[] = [
  { re: /left\s+join|right\s+join|full\s+(outer\s+)?join|inner\s+join|\bjoin\b/i, lang: "sql", text: "A JOIN pairs rows from two tables where the ON condition is true. INNER keeps only matched pairs; LEFT keeps every left row and fills the right side with NULL when nothing matches." },
  { re: /group\s+by|having|count\(|sum\(|avg\(/i, lang: "sql", text: "GROUP BY collapses rows that share the same value into one group, and aggregates (COUNT, SUM, AVG) summarise each group. HAVING filters whole groups after that; WHERE filters rows before it." },
  { re: /over\s*\(/i, lang: "sql", text: "A window function computes a value across related rows but keeps every row. PARTITION BY defines the related rows; ORDER BY inside OVER sets the order the function sees them." },
  { re: /\bwith\b[\s\S]*\bas\s*\(/i, lang: "sql", text: "A CTE (WITH …) gives a name to an intermediate result so the main query can read it like a table." },
  { re: /\bis\s+null\b|coalesce|null/i, lang: "sql", text: "NULL means unknown. Comparisons with NULL are never true, so use IS NULL, and remember aggregates skip NULLs." },
  { re: /select[\s\S]*\(\s*select/i, lang: "sql", text: "A subquery is a query inside another. A scalar subquery returns one value that the outer query can compare against." },
  { re: /union|intersect|except/i, lang: "sql", text: "Set operators combine two result sets with matching columns. UNION removes duplicates, UNION ALL keeps them, INTERSECT keeps shared rows, EXCEPT removes the second set's rows." },
  { re: /\bfor\b[\s\S]*\bin\b|\bwhile\b/, lang: "python", text: "A loop repeats a block. A for loop takes the next item from a sequence each time and stops when the sequence is used up; a while loop repeats until its condition becomes false." },
  { re: /def\s+\w+/, lang: "python", text: "A function packages steps under a name. Calling it creates a new frame with its own local variables; return hands a value back and removes that frame." },
  { re: /\{[^}]*:[^}]*\}|dict\(|\.get\(|\.items\(/, lang: "python", text: "A dictionary maps keys to values. Looking up a key is fast; assigning to an existing key replaces its value, and a missing key raises KeyError unless you use .get()." },
  { re: /\.append\(|\[\s*\d|list\(|\.sort\(/, lang: "python", text: "A list is an ordered, changeable sequence. Methods such as append and sort change the same list in place, so every name that refers to it sees the change." },
  { re: /try:|except|raise/, lang: "python", text: "try/except runs risky code and handles an exception if one occurs. The traceback names the exception type and the line where it was raised." },
  { re: /groupby|merge\(|\.pivot|melt\(|DataFrame/, lang: "python", text: "A pandas DataFrame is a labelled table. Operations such as filtering, groupby and merge return a new table; compare the shape and columns before and after each step." },
  { re: /np\.|numpy/, lang: "python", text: "A NumPy array holds same-typed values in a grid. Operations apply to every element at once (vectorisation), and arrays of different shapes can combine when their shapes are compatible (broadcasting)." },
];

export function conceptFor(ctx: Pick<ExplainContext, "lang" | "code" | "topic">): string {
  const hay = `${ctx.code}\n${ctx.topic ?? ""}`;
  const hit = CONCEPTS.find((c) => c.lang === ctx.lang && c.re.test(hay));
  return hit?.text ?? (ctx.lang === "sql" ? "SQL describes the result you want; the database decides how to produce it. Think in steps: pick the rows (FROM, JOIN, WHERE), summarise them (GROUP BY), then shape the output (SELECT, ORDER BY)." : "Python runs one line at a time, top to bottom. Follow how each line changes the variables.");
}

const CLAUSE_ROLE: Record<string, string> = {
  from: "reads the source rows", where: "keeps only rows where the condition is true", "group by": "forms groups", having: "keeps only groups whose aggregate passes", select: "computes the output columns",
  "order by": "sorts the result", limit: "keeps the first rows",
};

/** Clauses of a SELECT in processing order, each with what it does to the rows. Parsed from the learner's text only. */
export function sqlSteps(sql: string): string[] {
  const p = parseSelect(sql);
  if (p.unsupported) return [p.unsupported];
  const out: string[] = [];
  if (p.with) out.push("WITH builds named intermediate results first.");
  for (const j of p.joins.slice(1)) out.push(`${j.kind} ${j.source}${j.on ? ` ON ${j.on}` : ""}: ${/left/i.test(j.kind) ? "keeps all left rows, NULL where unmatched" : /right/i.test(j.kind) ? "keeps all right rows, NULL where unmatched" : /full/i.test(j.kind) ? "keeps unmatched rows from both sides" : /cross/i.test(j.kind) ? "pairs every row with every row" : "keeps only matching pairs"}.`);
  for (const c of ["from", "where", "group by", "having"] as const) if (p.clauses[c]) out.push(`${c.toUpperCase()} ${p.clauses[c]}: ${CLAUSE_ROLE[c]}.`);
  if (p.windows.length) out.push(`Window function${p.windows.length > 1 ? "s" : ""}: each row gets a value computed over its partition.`);
  if (p.clauses.select) out.push(`SELECT ${p.clauses.select.length > 60 ? `${p.clauses.select.slice(0, 57)}…` : p.clauses.select}: ${CLAUSE_ROLE.select}.`);
  if (p.distinct) out.push("DISTINCT removes duplicate output rows.");
  for (const c of ["order by", "limit"] as const) if (p.clauses[c]) out.push(`${c.toUpperCase()} ${p.clauses[c]}: ${CLAUSE_ROLE[c]}.`);
  return out;
}

/** First line where the output differs from the expected output, as a sentence. */
export function firstDifference(actual: string, expected: string): string | null {
  const a = actual.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n"), e = expected.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if ((a[i] ?? null) !== (e[i] ?? null)) {
      if (a[i] === undefined) return `Your output stops after line ${i}; the expected output has ${e.length - i} more line${e.length - i === 1 ? "" : "s"}.`;
      if (e[i] === undefined) return `Your output has ${a.length - i} extra line${a.length - i === 1 ? "" : "s"} starting at line ${i + 1}.`;
      return `Line ${i + 1} differs: you printed ${JSON.stringify(a[i])} but the expected line is ${JSON.stringify(e[i])}.`;
    }
  }
  return null;
}

/** Why this output happened, from the real run. */
export function whyOutput(ctx: ExplainContext): string[] {
  const r = ctx.run;
  if (!r) return ["Run your code first; the explanation uses what it actually produced."];
  const out: string[] = [];
  if (!r.ok) { out.push(`It stopped with an error: ${(r.error ?? r.text ?? "").split("\n").slice(-1)[0]}`); return out; }
  if (ctx.lang === "sql") {
    out.push(`The query returned ${r.rowCount ?? r.rows?.length ?? 0} row${(r.rowCount ?? r.rows?.length) === 1 ? "" : "s"}${r.columns ? ` with columns ${r.columns.join(", ")}` : ""}.`);
    const nulls = r.rows?.reduce((n, row) => n + row.filter((c) => c === null).length, 0) ?? 0;
    if (nulls) out.push(`${nulls} NULL value${nulls === 1 ? "" : "s"} appear in the shown rows: an unmatched LEFT/RIGHT/FULL JOIN side or a missing value.`);
    out.push(...sqlSteps(ctx.code).slice(0, 6));
  } else {
    out.push(`The program printed ${(r.text ?? "").split("\n").filter(Boolean).length} line(s).`);
    if (ctx.expected !== undefined) { const d = firstDifference(r.text ?? "", ctx.expected); out.push(d ?? "Your output matches the expected output exactly."); }
  }
  return out;
}

const MISTAKES_SQL: Record<string, string> = {
  join: "Using INNER JOIN where unmatched rows matter, or joining on the wrong key so rows multiply or disappear.",
  "group-by": "Selecting a column that is neither grouped nor aggregated, or filtering an aggregate in WHERE instead of HAVING.",
  window: "Forgetting PARTITION BY (the window spans every row) or filtering on a window function in WHERE.",
  null: "Comparing with = NULL instead of IS NULL, or forgetting that aggregates skip NULLs.",
  "wrong-result": "The query runs but answers a slightly different question. Re-read the prompt for filters, ties and ordering.",
};
const MISTAKES_PY: Record<string, string> = {
  lists: "Indexing past the end (indexes start at 0 and stop at len - 1), or changing a list while looping over it.",
  dicts: "Reading a key that does not exist; use .get() or check with `in` first.",
  types: "Mixing types, such as adding a string to a number. Convert with int(), float() or str().",
  names: "Using a name before it is defined, or a typo in a variable or function name.",
  syntax: "A missing colon, bracket or indentation level.",
  "wrong-output": "The program runs but prints something different. Compare your output with the expected output character by character, including spaces and capital letters.",
  loops: "An off-by-one in a range, or a loop that never ends.",
};

/** The most likely common mistake for this failure, from the same classifier the Mistake Notebook uses. */
export function commonMistake(ctx: ExplainContext): string {
  if (ctx.lang === "python") {
    const cat = ctx.run && !ctx.run.ok ? classifyPyMistake(`${ctx.run.error ?? ""}\n${ctx.run.text ?? ""}`) : "wrong-output";
    return MISTAKES_PY[cat] ?? "Compare what each line does with what the exercise asks, step by step.";
  }
  const code = ctx.code.toLowerCase();
  const cat = /=\s*null\b/.test(code) ? "null" : /over\s*\(/.test(code) && !/partition\s+by/.test(code) ? "window" : /group\s+by/.test(code) && /where[\s\S]*(count|sum|avg)\(/.test(code) ? "group-by" : /\bjoin\b/.test(code) ? "join" : "wrong-result";
  return MISTAKES_SQL[cat] ?? MISTAKES_SQL["wrong-result"];
}

export interface LevelText { level: Level; label: string; lines: string[]; /** The visual level opens the matching visualizer. */ action?: "visualize" }

/** Text for one level. `solution` is empty unless a solution exists, and callers show it only after an explicit request. */
export function explainLevel(level: Level, ctx: ExplainContext): LevelText {
  const label = LEVELS.find((l) => l.id === level)!.label;
  switch (level) {
    case "concept": return { level, label, lines: [conceptFor(ctx)] };
    case "hint": return { level, label, lines: [ctx.hints?.[0] ?? commonMistake(ctx)] };
    case "visual": return { level, label, lines: [ctx.lang === "sql" ? "Step through your own query: each logical stage shows the rows it receives and the rows it keeps or removes." : "Step through your own code: the current line, variables, call stack and objects are recorded from a real run."], action: "visualize" };
    case "detailed": return { level, label, lines: [...whyOutput(ctx), ...(ctx.verdict && !ctx.verdict.ok ? [ctx.verdict.message] : [])] };
    case "solution": return { level, label, lines: ctx.solution ? [ctx.solution] : ["No model solution is attached to this exercise."] };
  }
}

/** Next exercise on the same topic that is not the current one. Pure; the caller supplies the pool. */
export function similarChallenge<T extends { id: string; topic: string }>(current: { id: string; topic: string }, pool: T[]): T | undefined {
  const same = pool.filter((p) => p.topic === current.topic && p.id !== current.id);
  if (!same.length) return undefined;
  const at = pool.findIndex((p) => p.id === current.id);
  return same.find((p) => pool.indexOf(p) > at) ?? same[0];
}
