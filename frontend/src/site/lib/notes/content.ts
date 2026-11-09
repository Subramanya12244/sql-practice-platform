/**
 * Collects the content of a Visual Learning Notes document from real sources only:
 * question JSON, schema.json, the AST query visualizer, PGlite (reference output rows),
 * the Python problem files, the learner's own passing code, and Pyodide (outline + tests).
 * The result is plain data, so the PDF can be built in a worker and the preview in React.
 */
import type { Question, SchemaTable } from "../../types";
import type { FlowGraph } from "../queryGraph";
import type { PyOutline } from "./pyOutline";

export interface NotesInclude {
  statement: boolean; schema: boolean; queryDiagram: boolean; pyDiagram: boolean; deDiagram: boolean; code: boolean;
  explanation: boolean; output: boolean; notes: boolean; reference: boolean; tests: boolean;
}
export interface NotesOptions {
  title: string; branding: boolean; theme: "light" | "dark"; pageNumbers: boolean; toc: boolean; labels: boolean; date: boolean;
  mode: "detailed" | "compact"; include: NotesInclude; pySolution: "mine" | "reference" | "both" | "none";
}
export const DEFAULT_INCLUDE: NotesInclude = { statement: true, schema: true, queryDiagram: true, pyDiagram: true, deDiagram: true, code: true, explanation: true, output: true, notes: true, reference: false, tests: true };
export const defaultOptions = (title = "DataForge study notes"): NotesOptions => ({
  title, branding: true, theme: "light", pageNumbers: true, toc: true, labels: true, date: true, mode: "detailed", include: { ...DEFAULT_INCLUDE }, pySolution: "both",
});

export type NotesPreset = "detailed" | "compact" | "project_docs";

export function getPresetOptions(preset: NotesPreset, currentTitle = "DataForge study notes"): NotesOptions {
  switch (preset) {
    case "compact":
      return {
        title: currentTitle.replace(/(study notes|technical documentation)/i, "Revision Sheet"),
        branding: true,
        theme: "light",
        pageNumbers: true,
        toc: false,
        labels: true,
        date: true,
        mode: "compact",
        include: {
          statement: true,
          schema: false,
          queryDiagram: true,
          pyDiagram: true,
          deDiagram: false,
          code: true,
          explanation: false,
          output: false,
          notes: true,
          reference: false,
          tests: false,
        },
        pySolution: "mine",
      };
    case "project_docs":
      return {
        title: currentTitle.replace(/(study notes|revision sheet)/i, "Technical Project Documentation"),
        branding: true,
        theme: "light",
        pageNumbers: true,
        toc: true,
        labels: true,
        date: true,
        mode: "detailed",
        include: {
          statement: true,
          schema: true,
          queryDiagram: true,
          pyDiagram: true,
          deDiagram: true,
          code: true,
          explanation: true,
          output: true,
          notes: true,
          reference: true,
          tests: true,
        },
        pySolution: "both",
      };
    case "detailed":
    default:
      return defaultOptions(currentTitle.replace(/(revision sheet|technical project documentation)/i, "Study Notes"));
  }
}
/** A compact revision sheet keeps the essentials. */
export function effectiveInclude(o: NotesOptions): NotesInclude {
  if (o.mode === "detailed") return o.include;
  return { ...o.include, schema: false, deDiagram: false, tests: false, reference: false, explanation: o.include.explanation, output: false };
}

export interface SqlNote {
  kind: "sql"; ref: string; number: number; title: string; difficulty: string; topic: string; concepts: string[];
  problem: string; objective: string; tables: SchemaTable[];
  /** The learner's solved query when available, else the reference. */
  sql: string; sqlSource: "yours" | "reference"; reference: string;
  flow: FlowGraph | null; flowNote: string | null;
  steps: { clause: string; text: string }[]; joins: string[]; approach: string; why: string;
  output: { columns: string[]; rows: string[][]; total: number } | null; outputNote: string | null;
  pitfalls: string[]; watchOutFor: string; takeaway: string; optimizations: string[]; related: string[]; followups: { question: string; answer: string }[];
}
export interface PyNote {
  kind: "python"; ref: string; code: string; slug: string; title: string; difficulty: string; category: string; skill: string; concepts: string[];
  sections: Record<string, string>; time: string; space: string; explanation: string;
  mine: string | null; reference: string; outline: PyOutline | null; outlineNote: string | null;
  tests: { visible: { passed: number; total: number }; hidden: { passed: number; total: number }; ran: "yours" | "reference" } | null;
}
export type NoteItem = SqlNote | PyNote;

/** Split problem Markdown into "## Heading" sections. */
export function sections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur = "Intro";
  for (const line of md.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) { cur = m[1]; out[cur] = ""; continue; }
    out[cur] = (out[cur] ?? "") + line + "\n";
  }
  for (const k of Object.keys(out)) out[k] = out[k].replace(/<!--task:[^>]*-->/g, "").trim();
  return out;
}

const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v));

export interface SqlDeps {
  schema: SchemaTable[];
  buildGraphs: (sql: string) => Promise<{ ok: true; flow: FlowGraph } | { ok: false; reason: string }>;
  explain: (sql: string) => { steps: { clause: string; text: string }[]; joins: string[]; unsupported?: string; notes: { text: string }[] };
  run: (sql: string) => Promise<{ success: boolean; columns: string[]; rows: unknown[][]; message?: string | null }>;
  titleOf: (n: number) => string | undefined;
}

export async function sqlNote(q: Question, userSql: string | undefined, deps: SqlDeps, rowsMax = 12): Promise<SqlNote> {
  const sql = (userSql?.trim() ? userSql : q.solution || q.referenceQuery).trim();
  const graphs = await deps.buildGraphs(sql);
  const ex = deps.explain(sql);
  let output: SqlNote["output"] = null, outputNote: string | null = null;
  const res = await deps.run(q.referenceQuery);
  if (res.success) output = { columns: res.columns, rows: res.rows.slice(0, rowsMax).map((r) => r.map(cell)), total: res.rows.length };
  else outputNote = `The reference query could not be run here: ${res.message ?? "unknown error"}`;
  const used = new Set(q.tables.map((t) => t.toLowerCase()));
  return {
    kind: "sql", ref: `q${q.number}`, number: q.number, title: q.title, difficulty: q.difficulty, topic: q.topicLabel, concepts: q.concepts,
    problem: q.problem, objective: q.objective, tables: deps.schema.filter((t) => used.has(t.name.toLowerCase())),
    sql, sqlSource: userSql?.trim() ? "yours" : "reference", reference: q.solution || q.referenceQuery,
    flow: graphs.ok ? graphs.flow : null, flowNote: graphs.ok ? null : `No query-flow diagram: ${graphs.reason}`,
    steps: ex.unsupported ? [] : ex.steps.map((s) => ({ clause: s.clause, text: s.text.replace(/\s+/g, " ") })), joins: ex.joins, approach: q.approach, why: q.why,
    output, outputNote, pitfalls: q.pitfalls ?? [], watchOutFor: q.watchOutFor, takeaway: q.takeaway,
    optimizations: ex.notes.map((n) => n.text), related: (q.related ?? []).map((n) => deps.titleOf(n)).filter((x): x is string => !!x).slice(0, 5),
    followups: (q.followups ?? []).slice(0, 3),
  };
}

export interface PyDeps {
  outline: (code: string) => Promise<PyOutline | null>;
  tests: (code: string) => Promise<{ visible: { passed: number; total: number }; hidden: { passed: number; total: number } } | null>;
}
export interface PySource {
  slug: string; code: string; title: string; difficulty: string; category: string; skill: string; concepts: string[]; time: string; space: string;
  body: string; task: { solution: string; explanation?: string } | null;
}

export async function pyNote(e: PySource, mine: string | null, deps: PyDeps): Promise<PyNote> {
  const reference = e.task?.solution ?? "";
  const analysed = mine ?? reference;
  // One Python worker serves both calls, so they run one after the other.
  const outline = analysed ? await deps.outline(analysed) : null;
  const tests = analysed ? await deps.tests(analysed) : null;
  return {
    kind: "python", ref: `py:${e.slug}`, code: e.code, slug: e.slug, title: e.title, difficulty: e.difficulty, category: e.category, skill: e.skill, concepts: e.concepts,
    sections: sections(e.body), time: e.time, space: e.space, explanation: e.task?.explanation ?? "",
    mine, reference, outline, outlineNote: outline ? null : "No logic diagram: the solution could not be analysed.",
    tests: tests ? { ...tests, ran: mine ? "yours" : "reference" } : null,
  };
}

/** Topics covered, for the library listing and the cover page. */
export const topicsOf = (items: NoteItem[]) => [...new Set(items.map((i) => (i.kind === "sql" ? i.topic : i.category)))];
export const kindOf = (items: NoteItem[]): "sql" | "python" | "mixed" => {
  const k = new Set(items.map((i) => i.kind));
  return k.size > 1 ? "mixed" : (items[0]?.kind ?? "sql");
};
