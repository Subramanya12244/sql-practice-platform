import { splitFrontmatter } from "./learning";
import { extractTasks, type PythonTask } from "./tasks";

export interface PyExercise {
  slug: string;
  title: string;
  difficulty: string;
  description: string;
  topic: string;
  minutes: number;
  /** Stable problem id shown to learners, e.g. "PY-021". Progress is keyed by slug. */
  code: string;
  /** Concepts tested (front matter `concepts`, comma separated). */
  concepts: string[];
  /** One of PY_CATEGORIES (front matter `category`). */
  category: string;
  /** Data engineering skill practised, e.g. "validation" (front matter `skill`). */
  skill: string;
  /** Expected complexity, e.g. "O(n)". */
  time: string;
  space: string;
  body: string;
  task: PythonTask | null;
}
export type PyExerciseMeta = Omit<PyExercise, "body" | "task">;

const files = import.meta.glob("../content/python/*.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const RANK: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };

export interface StageMeta {
  stage: number;
  name: string;
  description: string;
}

export const PY_STAGES: StageMeta[] = [
  { stage: 1, name: "Variables, Types & Arithmetic", description: "Basic types, arithmetic, type coercion, unit conversions" },
  { stage: 2, name: "Conditions & Basic Flow Control", description: "If/else branches, threshold filters, null-skipping" },
  { stage: 3, name: "Strings, Parsing & Text Formatting", description: "String methods, regex parsing, text masking, formatting" },
  { stage: 4, name: "Lists, Tuples, Sets & Dictionaries", description: "Collections, deduplication, hash sets, nested dictionaries" },
  { stage: 5, name: "Functions, Parameters & Config", description: "Functions, arguments, config parsing with environment overrides" },
  { stage: 6, name: "Comprehensions & Functional Built-ins", description: "List/dict comprehensions, custom sorting, map/filter/zip" },
  { stage: 7, name: "Core Algorithms & Data Structures", description: "Two-pointer, heaps, binary search, queue allocation, interval merges" },
  { stage: 8, name: "Exceptions, Defensive Code & Validation", description: "Try/except, custom exception trees, schema validation rules" },
  { stage: 9, name: "File I/O, CSV, JSON/JSONL & Pathlib", description: "File processing, CSV parsing/writing, JSON streams, bounded handles" },
  { stage: 10, name: "Object-Oriented Programming & Dataclasses", description: "Classes, state encapsulation, dunder methods, dataclasses" },
  { stage: 11, name: "Iterators, Generators & Streaming", description: "Yield, streaming generators, chunking, sliding windows" },
  { stage: 12, name: "Data Transformation & Window Aggregations", description: "Group-by, rolling windows, pivot tables, forward-fill interpolation" },
  { stage: 13, name: "Advanced Optimization, Decorators & Contexts", description: "Decorators, context managers, LRU caches, atomic staging, rate limiters" },
  { stage: 14, name: "Data Engineering Pipeline Patterns", description: "Watermarks, CDC replay, DLQ, idempotent ledgers, DAG runners, SCD-2" },
];

/** Canonical pedagogical stage for each of the 150 Python practice problems (PY-001 to PY-150). */
export const PY_STAGE_MAP: Record<string, number> = {
  // Stage 1: Variables, Types & Arithmetic (4)
  "PY-023": 1, "PY-027": 1, "PY-051": 1, "PY-058": 1,

  // Stage 2: Conditions & Basic Flow Control (6)
  "PY-021": 2, "PY-031": 2, "PY-037": 2, "PY-048": 2, "PY-052": 2, "PY-061": 2,

  // Stage 3: Strings, Parsing & Text Formatting (10)
  "PY-010": 3, "PY-017": 3, "PY-036": 3, "PY-040": 3, "PY-044": 3,
  "PY-047": 3, "PY-049": 3, "PY-060": 3, "PY-097": 3, "PY-105": 3,

  // Stage 4: Lists, Tuples, Sets & Dictionaries (13)
  "PY-003": 4, "PY-026": 4, "PY-030": 4, "PY-039": 4, "PY-041": 4,
  "PY-042": 4, "PY-045": 4, "PY-054": 4, "PY-056": 4, "PY-073": 4,
  "PY-078": 4, "PY-088": 4, "PY-111": 4,

  // Stage 5: Functions, Parameters & Config (3)
  "PY-025": 5, "PY-084": 5, "PY-096": 5,

  // Stage 6: Comprehensions & Functional Built-ins (4)
  "PY-004": 6, "PY-024": 6, "PY-038": 6, "PY-059": 6,

  // Stage 7: Core Algorithms & Data Structures (19)
  "PY-009": 7, "PY-043": 7, "PY-062": 7, "PY-063": 7, "PY-065": 7,
  "PY-066": 7, "PY-081": 7, "PY-090": 7, "PY-091": 7, "PY-095": 7,
  "PY-108": 7, "PY-109": 7, "PY-118": 7, "PY-127": 7, "PY-128": 7,
  "PY-129": 7, "PY-132": 7, "PY-138": 7, "PY-144": 7,

  // Stage 8: Exceptions, Defensive Code & Validation (7)
  "PY-019": 8, "PY-055": 8, "PY-068": 8, "PY-072": 8, "PY-112": 8,
  "PY-113": 8, "PY-121": 8,

  // Stage 9: File I/O, CSV, JSON/JSONL & Pathlib (19)
  "PY-015": 9, "PY-020": 9, "PY-029": 9, "PY-032": 9, "PY-033": 9,
  "PY-035": 9, "PY-050": 9, "PY-053": 9, "PY-057": 9, "PY-064": 9,
  "PY-070": 9, "PY-071": 9, "PY-075": 9, "PY-089": 9, "PY-098": 9,
  "PY-103": 9, "PY-114": 9, "PY-146": 9, "PY-147": 9,

  // Stage 10: Object-Oriented Programming & Dataclasses (3)
  "PY-034": 10, "PY-086": 10, "PY-094": 10,

  // Stage 11: Iterators, Generators & Streaming (9)
  "PY-002": 11, "PY-022": 11, "PY-046": 11, "PY-077": 11, "PY-080": 11,
  "PY-092": 11, "PY-102": 11, "PY-134": 11, "PY-137": 11,

  // Stage 12: Data Transformation & Window Aggregations (19)
  "PY-001": 12, "PY-005": 12, "PY-006": 12, "PY-011": 12, "PY-012": 12,
  "PY-013": 12, "PY-069": 12, "PY-076": 12, "PY-079": 12, "PY-082": 12,
  "PY-083": 12, "PY-093": 12, "PY-099": 12, "PY-101": 12, "PY-124": 12,
  "PY-133": 12, "PY-135": 12, "PY-139": 12, "PY-145": 12,

  // Stage 13: Advanced Optimization, Decorators & Contexts (10)
  "PY-016": 13, "PY-028": 13, "PY-087": 13, "PY-104": 13, "PY-106": 13,
  "PY-107": 13, "PY-117": 13, "PY-125": 13, "PY-131": 13, "PY-148": 13,

  // Stage 14: Data Engineering Pipeline Patterns (24)
  "PY-007": 14, "PY-008": 14, "PY-014": 14, "PY-018": 14, "PY-067": 14,
  "PY-074": 14, "PY-085": 14, "PY-100": 14, "PY-110": 14, "PY-115": 14,
  "PY-116": 14, "PY-119": 14, "PY-120": 14, "PY-122": 14, "PY-123": 14,
  "PY-126": 14, "PY-130": 14, "PY-136": 14, "PY-140": 14, "PY-141": 14,
  "PY-142": 14, "PY-143": 14, "PY-149": 14, "PY-150": 14,
};

/** Maps each exercise to its target pedagogical progression stage (1 to 14). */
export function getExerciseStage(e: { code?: string; title: string; concepts?: string[]; category?: string; skill?: string; difficulty?: string }): number {
  if (e.code && PY_STAGE_MAP[e.code]) {
    return PY_STAGE_MAP[e.code];
  }
  const text = `${e.title} ${(e.concepts || []).join(" ")} ${e.skill || ""} ${e.category || ""}`.toLowerCase();

  // 14. Data engineering challenges & pipelines
  if (e.category === "etl" && (e.difficulty === "Hard" || /cdc|backfill|watermark|checkpoint|ledger|dlq|dead letter|pipeline|lake|warehouse/i.test(text))) return 14;

  // 13. Advanced optimization, caching, decorators, context managers
  if (e.category === "advanced" || /decorator|lru|cache|memoiz|token bucket|rate limit|context manager|atomic/i.test(text)) return 13;

  // 12. Data processing, aggregation, windowing, pivot, cumulative
  if (e.category === "processing" || /pivot|rolling|cumulative|window|aggregate|group by|metric|transform|summary/i.test(text)) return 12;

  // 11. Iterators, generators, streaming, batching
  if (/generator|yield|iter|stream|batch|chunk/i.test(text)) return 11;

  // 10. OOP and modular programming
  if (/class|dataclass|object|inherit|method|employee/i.test(text)) return 10;

  // 9. Files, CSV, JSON, logs & pathlib
  if (e.category === "files" || /csv|json|log|file|pathlib|xml/i.test(text)) return 9;

  // 8. Exceptions, error handling & debugging
  if (/safe|fallback|recover|catch|error/i.test(text) && /fallback|recover|safe|exception/i.test(text)) return 8;

  // 7. Searching, sorting & practical DSA
  if (e.category === "dsa" || /binary search|heap|stack|queue|sort|rank|top k|tree|graph|hash/i.test(text)) return 7;

  // 6. Comprehensions & built-ins (zip, enumerate, map, filter, any, all)
  if (/comprehension|zip|enumerate|any|all|map|filter|invert/i.test(text)) return 6;

  // 5. Functions & return values (args, kwargs, validation, parsing config)
  if (/function|args|kwargs|query param|config|parse/i.test(text)) return 5;

  // 4. Lists, tuples, sets & dictionaries
  if (/dict|list|set|tuple|lookup|dedupe|frequency|merge dict|running total/i.test(text)) return 4;

  // 3. Strings & string processing
  if (/string|slug|mask|trim|normalize|phone|url|format|sku|hh:mm/i.test(text)) return 3;

  // 2. Conditions & loops
  if (/loop|condition|flag|streak|threshold|range|sequence|tier|change|fizz/i.test(text)) return 2;

  // 1. Variables, types & operators
  return 1;
}

export function parseExercise(raw: string, fallback: string): PyExercise {
  const { meta, body } = splitFrontmatter(raw);
  const { tasks, rest } = extractTasks(body);
  const task = tasks.find((t): t is PythonTask => t.type === "python") ?? null;
  return {
    slug: meta.slug || fallback,
    title: meta.title || fallback,
    difficulty: meta.difficulty || "Easy",
    description: meta.description || "",
    topic: meta.topic || "",
    minutes: Number(meta.minutes) || 10,
    code: meta.id || "",
    concepts: (meta.concepts || "").split(",").map((c) => c.trim()).filter(Boolean),
    category: meta.category || "",
    skill: meta.skill || "",
    time: meta.time || "",
    space: meta.space || "",
    body: rest.replace(/<!--task:[^>]*-->/g, "").trim(),
    task,
  };
}

let cache: Promise<PyExercise[]> | null = null;
export function loadAllExercises(): Promise<PyExercise[]> {
  cache ??= Promise.all(Object.entries(files).map(async ([p, load]) => parseExercise(await load(), p.split("/").pop()!.replace(/\.md$/, "")))).then((all) =>
    all.sort((a, b) => {
      const da = (RANK[a.difficulty] ?? 1) - (RANK[b.difficulty] ?? 1);
      if (da !== 0) return da;
      const sa = getExerciseStage(a);
      const sb = getExerciseStage(b);
      if (sa !== sb) return sa - sb;
      return a.title.localeCompare(b.title);
    }),
  );
  return cache;
}
export const loadExerciseIndex = async (): Promise<PyExerciseMeta[]> => (await loadAllExercises()).map(({ body: _b, task: _t, ...m }) => m);
export const loadExercise = async (slug: string) => (await loadAllExercises()).find((e) => e.slug === slug);
