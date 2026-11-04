/**
 * AI SQL tutor: provider abstraction + context assembly.
 *
 * No model is wired in by default. A provider is enabled only when a server-side endpoint is
 * configured (VITE_TUTOR_ENDPOINT); API keys never reach the browser. Everything in
 * `explainQuery` and `schemaCheck` is deterministic and works with no provider at all.
 */
import type { Question, SchemaTable } from "../types";
import type { NoteMeta } from "./learning";
import type { QuestionProgress } from "./progress";
import { parseSelect } from "./sqlClauses";
import { lint, type Note } from "./compareSolutions";

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TutorContext {
  question: Pick<Question, "number" | "title" | "problem" | "objective" | "tables" | "concepts" | "difficulty">;
  /** Only tables the question uses, with their real columns and keys. */
  schema: { table: string; columns: string[]; foreignKeys: string[] }[];
  userSql: string;
  attempts: number;
  hintLevel: number;
  previousMistakes: string[];
  relatedNotes: { slug: string; title: string }[];
}

export interface TutorProvider {
  id: string;
  label: string;
  available: boolean;
  ask(ctx: TutorContext, history: TutorMessage[]): Promise<string>;
}

/** Used when nothing is configured: the UI shows a disabled state instead of failing. */
export const disabledProvider: TutorProvider = {
  id: "none",
  label: "Not configured",
  available: false,
  ask: async () => {
    throw new Error("No AI provider is configured for this site.");
  },
};

/**
 * Talks to a server-side proxy that holds the model API key. The proxy receives the context
 * as data (never as instructions) and returns plain text.
 */
export function httpProvider(endpoint: string): TutorProvider {
  return {
    id: "http",
    label: "AI tutor",
    available: true,
    async ask(ctx, history) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: ctx, messages: history.slice(-12) }),
      });
      if (!res.ok) throw new Error(`Tutor request failed (${res.status})`);
      const data = (await res.json()) as { reply?: string };
      return String(data.reply ?? "");
    },
  };
}

export function getTutorProvider(): TutorProvider {
  const endpoint = import.meta.env.VITE_TUTOR_ENDPOINT as string | undefined;
  return endpoint ? httpProvider(endpoint) : disabledProvider;
}

export function buildContext(q: Question, schema: SchemaTable[], userSql: string, p: QuestionProgress | undefined, notes: NoteMeta[]): TutorContext {
  const used = new Set(q.tables.map((t) => t.toLowerCase()));
  return {
    question: { number: q.number, title: q.title, problem: q.problem, objective: q.objective, tables: q.tables, concepts: q.concepts, difficulty: q.difficulty },
    schema: schema
      .filter((t) => used.has(t.name.toLowerCase()))
      .map((t) => ({
        table: t.name,
        columns: t.columns.map((c) => `${c.name} ${c.type}${c.pk ? " PK" : ""}`),
        foreignKeys: t.columns.filter((c) => c.fk).map((c) => `${c.name} → ${c.fk!.table}.${c.fk!.column}`),
      })),
    userSql: userSql.slice(0, 8000),
    attempts: p?.attempts ?? 0,
    hintLevel: p?.hintLevel ?? 0,
    previousMistakes: [...q.myMistakes.slice(0, 5), ...Object.keys(p?.errorKinds ?? {})],
    relatedNotes: notes.map((n) => ({ slug: n.slug, title: n.title })),
  };
}

/** Tables and table.column references in the SQL that don't exist in the real schema. */
export function schemaCheck(sql: string, schema: SchemaTable[]): string[] {
  const tables = new Map(schema.map((t) => [t.name.toLowerCase(), new Set(t.columns.map((c) => c.name.toLowerCase()))]));
  const s = sql.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
  const cte = new Set([...s.matchAll(/(?:\bwith(?:\s+recursive)?|,)\s+([a-z_]\w*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const alias = new Map<string, string>();
  const problems: string[] = [];
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][\w]*)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi)) {
    const t = m[1].toLowerCase();
    if (t === "lateral" || t === "unnest" || t === "generate_series") continue;
    if (!tables.has(t) && !cte.has(t)) problems.push(`Table "${m[1]}" doesn't exist in this database.`);
    const a = m[2]?.toLowerCase();
    if (a && !/^(on|where|join|left|right|inner|full|cross|natural|group|order|limit|using|union|having|window)$/.test(a)) alias.set(a, t);
    alias.set(t, t);
  }
  for (const m of s.matchAll(/\b([a-z_]\w*)\.([a-z_]\w*)\b/gi)) {
    const t = alias.get(m[1].toLowerCase());
    const cols = t ? tables.get(t) : undefined;
    if (cols && !cols.has(m[2].toLowerCase())) problems.push(`Column "${m[2]}" doesn't exist on ${t} (referenced as ${m[1]}.${m[2]}).`);
  }
  return [...new Set(problems)];
}

const CLAUSE_TEXT: Record<string, (body: string) => string> = {
  with: () => "Defines named subqueries (CTEs) the main query can read like tables.",
  from: (b) => `Reads rows from ${b.split(/\s+(?:join|left|right|inner|full|cross)\b/i)[0].trim()}, combining other tables with the JOINs below.`,
  where: (b) => `Keeps only rows where ${b} is true (false and NULL rows are dropped). Runs before grouping.`,
  "group by": (b) => `Collapses rows into one group per distinct ${b}. Every other selected column must now be aggregated.`,
  having: (b) => `Keeps only groups where ${b} — this can use aggregates because grouping already happened.`,
  select: (b) => `Outputs ${b.length > 120 ? b.slice(0, 117) + "…" : b}.`,
  "order by": (b) => `Sorts the final rows by ${b}.`,
  limit: (b) => `Returns at most ${b} row(s), after sorting.`,
  offset: (b) => `Skips the first ${b} row(s).`,
};

export interface QueryExplanation {
  steps: { clause: string; text: string; sql: string }[];
  joins: string[];
  notes: Note[];
  unsupported?: string;
}

/** Deterministic, clause-by-clause explanation in logical processing order. */
export function explainQuery(sql: string): QueryExplanation {
  const p = parseSelect(sql);
  if (p.unsupported) return { steps: [], joins: [], notes: lint(sql), unsupported: p.unsupported };
  const order = ["from", "where", "group by", "having", "select", "order by", "limit", "offset"] as const;
  const steps: QueryExplanation["steps"] = [];
  if (p.with) steps.push({ clause: "WITH", text: CLAUSE_TEXT.with(""), sql: p.with });
  for (const c of order) {
    const body = p.clauses[c];
    if (body === undefined) continue;
    const label = c === "select" && p.distinct ? "SELECT DISTINCT" : c.toUpperCase();
    steps.push({ clause: label, text: CLAUSE_TEXT[c](body) + (c === "select" && p.windows.length ? ` Window functions (${p.windows.join(", ")}) are computed per row over their window.` : ""), sql: body });
  }
  const joins = p.joins.slice(1).map((j) => `${j.kind} ${j.source}${j.on ? ` ON ${j.on}` : ""}`);
  return { steps, joins, notes: lint(sql) };
}
