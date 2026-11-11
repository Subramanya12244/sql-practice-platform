/**
 * Mistake notebook: what went wrong, where, and whether it is better now.
 *
 * Stored per challenge in `Progress.mistakes` (counts and categories only, never source code, SQL
 * text or output). Classification is deterministic: SQL failures reuse the titles from
 * `errorHelp.ts`; Python failures are read from the exception name. Older progress with no notebook
 * entries still shows up, built from `errorKinds` and Python check counts.
 */
import type { Progress } from "./progress";
import type { PyExerciseMeta } from "./pyExercises";
import { PY_CATEGORIES, type PyStat } from "./pyPractice";
import type { QuestionSummary } from "../types";
import { DAY_BY_ID, PHASE_BY_ID, dayHref } from "./daily";

export type MistakeKind = "sql" | "python";

export interface Mistake {
  /** "sql:25" or "py:<slug>", the same keys the revision queue uses. */
  ref: string;
  kind: MistakeKind;
  /** SQL topic slug or Python category slug. */
  topic: string;
  /** Failed graded attempts by category. */
  categories: Record<string, number>;
  /** Total failed graded attempts. */
  count: number;
  /** Runs that ended in an error (not graded). */
  runErrors: number;
  firstAt: string;
  lastAt: string;
  /** Set when the challenge was solved after (or between) these failures. */
  solved?: string;
  /** Set when the learner marked it understood; cleared if the same mistake happens again. */
  understood?: string;
}

// ── Categories ───────────────────────────────────────────────────────────
export const SQL_CATEGORY_LABEL: Record<string, string> = {
  join: "JOIN", "group-by": "GROUP BY / HAVING", aggregation: "Aggregation", window: "Window functions", cte: "CTEs", null: "NULL handling",
  subquery: "Subqueries", "set-ops": "Set operators", schema: "Table or column names", types: "Types and casting", syntax: "Syntax",
  "wrong-result": "Wrong result", other: "Other",
};
export const PY_CATEGORY_LABEL: Record<string, string> = {
  lists: "Lists and indexing", dicts: "Dictionaries and keys", types: "Types and conversion", names: "Names and functions", syntax: "Syntax and indentation",
  files: "Files", loops: "Loops and performance", exceptions: "Exceptions", "wrong-output": "Wrong output", "not-started": "Not implemented", other: "Other",
};
export const categoryLabel = (kind: MistakeKind, cat: string) => (kind === "sql" ? SQL_CATEGORY_LABEL : PY_CATEGORY_LABEL)[cat] ?? cat;

const TITLE_TO_CATEGORY: [RegExp, string][] = [
  [/Column not grouped|Aggregate in WHERE/i, "group-by"],
  [/Window function/i, "window"],
  [/Ambiguous column|Unknown table alias/i, "join"],
  [/Unknown column|Unknown table/i, "schema"],
  [/Division by zero/i, "null"],
  [/Type mismatch|ROUND on a float/i, "types"],
  [/column count/i, "set-ops"],
  [/Subquery returned/i, "subquery"],
  [/Syntax error/i, "syntax"],
];
const TOPIC_TO_CATEGORY: [RegExp, string][] = [
  [/join/i, "join"], [/group-by|having/i, "group-by"], [/window/i, "window"], [/^cte$/i, "cte"], [/subquer/i, "subquery"],
  [/aggregation/i, "aggregation"], [/set-op/i, "set-ops"],
];

/**
 * `title` is the error title from `explainError` ("Unknown column", "Wrong result" ...). A wrong
 * result carries no error text, so it is filed under the question's own topic (a wrong result in a
 * LEFT JOIN question counts as a JOIN mistake).
 */
export function classifySqlMistake(title: string | null | undefined, topic: string): string {
  for (const [re, cat] of TITLE_TO_CATEGORY) if (title && re.test(title)) return cat;
  if (!title || /wrong result/i.test(title)) return TOPIC_TO_CATEGORY.find(([re]) => re.test(topic))?.[1] ?? "wrong-result";
  return "other";
}

/** Python category from the check message or exception text. */
export function classifyPyMistake(text: string): string {
  const t = text ?? "";
  if (/NotImplementedError|raises NotImplementedError/.test(t)) return "not-started";
  if (/SyntaxError|IndentationError/.test(t)) return "syntax";
  if (/KeyError/.test(t)) return "dicts";
  if (/IndexError/.test(t)) return "lists";
  if (/FileNotFoundError|IsADirectoryError|PermissionError|OSError|IOError/.test(t)) return "files";
  if (/Timed out|Stopped after|RecursionError|MemoryError|timeout/i.test(t)) return "loops";
  if (/NameError|AttributeError|UnboundLocalError/.test(t)) return "names";
  if (/TypeError|ValueError|ZeroDivisionError|OverflowError/.test(t)) return "types";
  if (/Exception|raise|exception/.test(t) && /not raised|did not raise|expected .* raise/i.test(t)) return "exceptions";
  if (/AssertionError|fails a hidden test|A test failed|expected|!=/.test(t)) return "wrong-output";
  return "other";
}

// ── Daily Learning refs ──────────────────────────────────────────────────
/** Notebook key for a Daily Learning exercise: "daily:<dayId>#<exerciseId>", one entry per exercise however often it fails. */
export const dailyMistakeRef = (dayId: string, exId: string) => `daily:${dayId}#${exId}`;

/** Fields a failed Daily Learning check shares; `topicHint` is the lesson's topics, used to pick a SQL category from a wrong result. */
export function dailyMistake(dayId: string, exId: string, kind: MistakeKind) {
  const day = DAY_BY_ID.get(dayId);
  return { ref: dailyMistakeRef(dayId, exId), kind, topic: day?.phase ?? "daily", topicHint: (day?.topics ?? []).join(" ") };
}

// ── Pure updates (the progress store calls these) ────────────────────────
export interface MistakeInput { ref: string; kind: MistakeKind; topic: string; category: string; graded: boolean }

export function applyMistake(prev: Mistake | undefined, i: MistakeInput, now: string): Mistake {
  const base: Mistake = prev ?? { ref: i.ref, kind: i.kind, topic: i.topic, categories: {}, count: 0, runErrors: 0, firstAt: now, lastAt: now };
  if (!i.graded) return { ...base, runErrors: base.runErrors + 1, lastAt: now, understood: undefined };
  return {
    ...base, topic: i.topic, count: base.count + 1, lastAt: now,
    categories: { ...base.categories, [i.category]: (base.categories[i.category] ?? 0) + 1 },
    // The same problem went wrong again: it is not "understood" any more, and not solved-after-this-failure.
    understood: undefined,
  };
}
export const applySolved = (prev: Mistake | undefined, now: string): Mistake | undefined => (prev ? { ...prev, solved: prev.solved ?? now } : prev);
export const applyUnderstood = (prev: Mistake | undefined, on: boolean, now: string): Mistake | undefined => (prev ? { ...prev, understood: on ? now : undefined } : prev);

/** Union by ref. Counts take the larger side, dates the earliest first and latest last. Safe to repeat. */
export function mergeMistakes(a: Record<string, Mistake> = {}, b: Record<string, Mistake> = {}): Record<string, Mistake> {
  const out: Record<string, Mistake> = { ...b };
  for (const [ref, x] of Object.entries(a)) {
    const y = out[ref];
    if (!y) { out[ref] = x; continue; }
    const cats: Record<string, number> = { ...y.categories };
    for (const [c, n] of Object.entries(x.categories)) cats[c] = Math.max(cats[c] ?? 0, n);
    const lastAt = x.lastAt > y.lastAt ? x.lastAt : y.lastAt;
    const understood = [x.understood, y.understood].filter((u): u is string => Boolean(u) && u! >= lastAt).sort().pop();
    out[ref] = {
      ...x, categories: cats, count: Math.max(x.count, y.count), runErrors: Math.max(x.runErrors, y.runErrors),
      firstAt: x.firstAt < y.firstAt ? x.firstAt : y.firstAt, lastAt,
      solved: [x.solved, y.solved].filter(Boolean).sort()[0], understood,
    };
  }
  return out;
}

// ── Notebook view ────────────────────────────────────────────────────────
export type MistakeStatus = "open" | "solved" | "understood";
export interface NotebookRow {
  ref: string; kind: MistakeKind; topic: string; topicLabel: string; title: string; path: string; difficulty: string;
  categories: { category: string; label: string; count: number }[];
  count: number; runErrors: number; lastAt: string; status: MistakeStatus;
  /** Extra signals read from existing progress: hints or many attempts. */
  notes: string[];
}

interface Inputs { index: QuestionSummary[]; exercises: PyExerciseMeta[]; progress: Progress; pyStats: Record<string, PyStat> }

/** All challenges with at least one recorded mistake, from the notebook plus older progress data. */
export function buildNotebook({ index, exercises, progress, pyStats }: Inputs): NotebookRow[] {
  const stored = progress.mistakes ?? {};
  const rows: NotebookRow[] = [];
  const pyLabel = (slug: string) => PY_CATEGORIES.find((c) => c.slug === slug)?.short ?? slug;

  const make = (m: Mistake, title: string, path: string, difficulty: string, topicLabel: string, notes: string[]): NotebookRow => ({
    ref: m.ref, kind: m.kind, topic: m.topic, topicLabel, title, path, difficulty,
    categories: Object.entries(m.categories).map(([category, count]) => ({ category, label: categoryLabel(m.kind, category), count })).sort((a, b) => b.count - a.count),
    count: m.count, runErrors: m.runErrors, lastAt: m.lastAt,
    status: m.understood && m.understood >= m.lastAt ? "understood" : m.solved ? "solved" : "open", notes,
  });

  for (const q of index) {
    const ref = `sql:${q.number}`;
    const p = progress.questions[q.number];
    const notes: string[] = [];
    if ((p?.hintLevel ?? 0) >= 2) notes.push(`Used hints up to level ${p!.hintLevel}`);
    if ((p?.attempts ?? 0) >= 4) notes.push(`${p!.attempts} attempts`);
    let m = stored[ref];
    if (!m && p?.errorKinds && Object.keys(p.errorKinds).length) {
      // Older progress: build from the per-kind counts that were already recorded.
      const categories: Record<string, number> = {};
      for (const [kind, n] of Object.entries(p.errorKinds)) { const c = classifySqlMistake(kind, q.topic); categories[c] = (categories[c] ?? 0) + n; }
      m = { ref, kind: "sql", topic: q.topic, categories, count: Object.values(p.errorKinds).reduce((a, b) => a + b, 0), runErrors: 0, firstAt: p.startedAt ?? p.solvedAt ?? "", lastAt: p.solvedAt ?? p.startedAt ?? "", solved: p.solvedAt };
    }
    if (m && m.count + m.runErrors > 0) rows.push(make(m, `Q${q.number} ${q.title}`, `/questions/${q.slug}`, q.difficulty, q.topicLabel, notes));
  }
  for (const e of exercises) {
    const ref = `py:${e.slug}`;
    const st = pyStats[e.slug];
    const notes: string[] = [];
    if ((st?.attempts ?? 0) >= 4) notes.push(`${st!.attempts} checks`);
    let m = stored[ref];
    const failed = st ? st.attempts - st.passes : 0;
    if (!m && failed > 0) {
      m = { ref, kind: "python", topic: e.category || "other", categories: { other: failed }, count: failed, runErrors: 0, firstAt: st!.lastAt, lastAt: st!.lastAt, solved: progress.lessons?.[ref] };
    }
    if (m && m.count + m.runErrors > 0) rows.push(make(m, `${e.code} ${e.title}`, `/practice/python/${e.slug}`, e.difficulty, pyLabel(e.category || "other"), notes));
  }
  // Daily Learning exercises: the stored entry is all there is (the lesson content is not loaded here).
  for (const m of Object.values(stored)) {
    if (!m.ref.startsWith("daily:") || m.count + m.runErrors === 0) continue;
    const [dayId, exId] = m.ref.slice(6).split("#");
    const day = DAY_BY_ID.get(dayId);
    if (!day) continue;
    const phase = PHASE_BY_ID.get(day.phase);
    rows.push(make(m, `Day ${day.day} ${day.title} (${exId})`, dayHref(day), "Daily", `Daily · ${phase?.title ?? "Lesson"}`, []));
  }
  return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export interface NotebookFilter { kind?: MistakeKind | "all"; topic?: string; status?: MistakeStatus | "all" }
export const filterNotebook = (rows: NotebookRow[], f: NotebookFilter) =>
  rows.filter((r) => (!f.kind || f.kind === "all" || r.kind === f.kind) && (!f.topic || f.topic === "all" || r.topic === f.topic) && (!f.status || f.status === "all" || r.status === f.status));

/** A category that went wrong on at least `minQuestions` different challenges, `minCount` times in total. */
export function recurring(rows: NotebookRow[], minCount = 3, minQuestions = 2) {
  const by = new Map<string, { kind: MistakeKind; category: string; label: string; count: number; questions: number }>();
  for (const r of rows) for (const c of r.categories) {
    const key = `${r.kind}:${c.category}`;
    const x = by.get(key) ?? { kind: r.kind, category: c.category, label: c.label, count: 0, questions: 0 };
    x.count += c.count; x.questions += 1; by.set(key, x);
  }
  return [...by.values()].filter((x) => x.count >= minCount && x.questions >= minQuestions).sort((a, b) => b.count - a.count);
}

/** How many missed challenges are solved now, overall and per topic. */
export function improvement(rows: NotebookRow[]) {
  const done = (r: NotebookRow) => r.status !== "open";
  const topics = new Map<string, { topic: string; label: string; missed: number; fixed: number }>();
  for (const r of rows) {
    const t = topics.get(`${r.kind}:${r.topic}`) ?? { topic: r.topic, label: r.topicLabel, missed: 0, fixed: 0 };
    t.missed++; if (done(r)) t.fixed++; topics.set(`${r.kind}:${r.topic}`, t);
  }
  return { missed: rows.length, fixed: rows.filter(done).length, topics: [...topics.values()].sort((a, b) => b.missed - b.fixed - (a.missed - a.fixed)) };
}
