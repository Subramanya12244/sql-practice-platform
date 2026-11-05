/**
 * Python practice library helpers: categories, per-problem attempt stats, the learner overview,
 * and deterministic feedback after a check (no AI; prewritten rules keyed on the error).
 *
 * Completion stays where it always was (`progress.lessons["py:<slug>"]`, synced with the account).
 * Attempt counts live in this browser (`sqlp.py.stats`); every check is also sent to the account as a
 * `python_submitted` learning event, so the server keeps the full attempt history.
 */
import type { PyExerciseMeta } from "./pyExercises";

export const PY_CATEGORIES = [
  { slug: "fundamentals", label: "Python Fundamentals for Data Engineering", short: "Fundamentals" },
  { slug: "dsa", label: "Data Structures and Algorithms", short: "Data structures" },
  { slug: "processing", label: "Data Processing and Transformation", short: "Processing" },
  { slug: "files", label: "File Handling and Data Formats", short: "Files & formats" },
  { slug: "etl", label: "ETL Pipeline Development", short: "ETL pipelines" },
  { slug: "advanced", label: "Advanced Python for Data Engineering", short: "Advanced" },
] as const;

export const PY_SKILLS: Record<string, string> = {
  ingestion: "Ingestion", parsing: "Parsing", cleaning: "Cleaning", validation: "Validation", transformation: "Transformation",
  aggregation: "Aggregation", deduplication: "Deduplication", incremental: "Incremental loads", orchestration: "Orchestration",
  streaming: "Streaming", reliability: "Reliability", performance: "Performance",
};

export const categoryLabel = (slug: string) => PY_CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
export const pyKey = (slug: string) => `py:${slug}`;

export interface PyStat { attempts: number; passes: number; firstSolvedAt?: string; lastAt: string; lastOk: boolean }
const STATS = "sqlp.py.stats";
const BUS = new Set<() => void>();

export function readStats(): Record<string, PyStat> {
  try { return JSON.parse(localStorage.getItem(STATS) ?? "{}"); } catch { return {}; }
}
export function recordPyAttempt(slug: string, ok: boolean, at = new Date().toISOString()) {
  const all = readStats();
  const s = all[slug] ?? { attempts: 0, passes: 0, lastAt: at, lastOk: false };
  all[slug] = { attempts: s.attempts + 1, passes: s.passes + (ok ? 1 : 0), firstSolvedAt: s.firstSolvedAt ?? (ok ? at : undefined), lastAt: at, lastOk: ok };
  try { localStorage.setItem(STATS, JSON.stringify(all)); } catch { /* storage full or blocked */ }
  BUS.forEach((f) => f());
}
export function subscribeStats(f: () => void) { BUS.add(f); return () => { BUS.delete(f); }; }

export type PyStatus = "solved" | "attempted" | "new";
export const statusOf = (slug: string, done: Record<string, string> | undefined, stats: Record<string, PyStat>): PyStatus =>
  done?.[pyKey(slug)] ? "solved" : stats[slug]?.attempts ? "attempted" : "new";

export interface PyFilter { q: string; difficulty: string; category: string; skill: string; status: string }
export function filterExercises(all: PyExerciseMeta[], f: PyFilter, done: Record<string, string> | undefined, stats: Record<string, PyStat>) {
  const q = f.q.trim().toLowerCase();
  return all.filter((e) =>
    (!q || `${e.code} ${e.title} ${e.description} ${e.concepts.join(" ")}`.toLowerCase().includes(q)) &&
    (!f.difficulty || e.difficulty === f.difficulty) &&
    (!f.category || e.category === f.category) &&
    (!f.skill || e.skill === f.skill) &&
    (!f.status || statusOf(e.slug, done, stats) === f.status));
}

export interface Bucket { key: string; label: string; total: number; solved: number; attempts: number; passes: number }
/** Accuracy is passing checks over all checks, so it falls when a learner needs many tries. */
export const accuracy = (b: { attempts: number; passes: number }) => (b.attempts ? Math.round((b.passes / b.attempts) * 100) : null);

export function overview(all: PyExerciseMeta[], done: Record<string, string> | undefined, stats: Record<string, PyStat>) {
  const bucket = (key: string, label: string, items: PyExerciseMeta[]): Bucket => ({
    key, label, total: items.length,
    solved: items.filter((e) => done?.[pyKey(e.slug)]).length,
    attempts: items.reduce((s, e) => s + (stats[e.slug]?.attempts ?? 0), 0),
    passes: items.reduce((s, e) => s + (stats[e.slug]?.passes ?? 0), 0),
  });
  const solved = all.filter((e) => done?.[pyKey(e.slug)]).length;
  const bySlug = new Map(all.map((e) => [e.slug, e]));
  return {
    total: all.length,
    solved,
    remaining: all.length - solved,
    difficulty: ["Easy", "Medium", "Hard"].map((d) => bucket(d, d, all.filter((e) => e.difficulty === d))),
    categories: PY_CATEGORIES.map((c) => bucket(c.slug, c.short, all.filter((e) => e.category === c.slug))),
    recent: Object.entries(stats).sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt)).slice(0, 6)
      .flatMap(([slug, s]) => (bySlug.has(slug) ? [{ ex: bySlug.get(slug)!, stat: s }] : [])),
    // Revision list: attempted and still unsolved, or solved only after several failed checks.
    revise: all.filter((e) => {
      const s = stats[e.slug];
      return s && (!done?.[pyKey(e.slug)] || s.attempts - s.passes >= 3);
    }).slice(0, 8),
  };
}

/** Split the problem body: hints are revealed one at a time, so they leave the main text. */
export function splitHints(body: string): { body: string; hints: string[] } {
  const m = body.match(/\n?## Hints\s*\n([\s\S]*?)(?=\n## |\n?$)/);
  if (!m) return { body, hints: [] };
  const hints = m[1].split("\n").filter((l) => /^\s*[-*] /.test(l)).map((l) => l.replace(/^\s*[-*] /, "").trim());
  return { body: body.replace(m[0], "\n"), hints };
}

/** Prewritten advice for the kind of failure; nothing is generated. */
export function feedbackFor(message: string, error = ""): string | null {
  const text = `${message}\n${error}`;
  const rules: [RegExp, string][] = [
    [/NotImplementedError/, "The starter still raises NotImplementedError. Replace that line with your implementation."],
    [/fails a hidden test/, "Your logic works for the shown cases. Re-read the constraints and test empty input, missing fields, None values, duplicates and ties."],
    [/Timed out|Stopped after/, "The code ran too long. Look for a loop that never ends, or a nested loop over the whole input where a dict or set lookup would do."],
    [/KeyError/, "A dict key was missing. Real records often lack fields: use `.get(key)` or check `key in record` before reading it."],
    [/TypeError: .*NoneType|'NoneType'/, "A None value reached an operation that needs a real value. Filter or default missing values before using them."],
    [/TypeError/, "Two values had incompatible types (for example str and int). Convert inputs explicitly before comparing or adding them."],
    [/ValueError/, "A conversion failed on a bad value. Catch ValueError around int()/float()/date parsing, or validate the text first."],
    [/IndexError/, "An index ran past the end of a list. Check empty input and the last element."],
    [/NameError/, "A name is not defined. Check spelling and that the function has the exact name in the problem."],
    [/AttributeError/, "An object doesn't have that method or attribute. Check the type you are holding at that line."],
    [/SyntaxError|IndentationError/, "Python couldn't parse the code. Check colons, brackets and consistent indentation near the marked line."],
    [/ImportError|ModuleNotFoundError/, "That module isn't available in the browser sandbox. These problems need only the standard library."],
    [/RecursionError/, "Recursion went too deep. Use a loop or an explicit stack for large inputs."],
    [/AssertionError|A test failed/, "A result didn't match. Compare your output with the expected value in the failing test, including order and types."],
  ];
  return rules.find(([r]) => r.test(text))?.[1] ?? null;
}
