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
    all.sort((a, b) => (RANK[a.difficulty] ?? 1) - (RANK[b.difficulty] ?? 1) || a.title.localeCompare(b.title)),
  );
  return cache;
}
export const loadExerciseIndex = async (): Promise<PyExerciseMeta[]> => (await loadAllExercises()).map(({ body: _b, task: _t, ...m }) => m);
export const loadExercise = async (slug: string) => (await loadAllExercises()).find((e) => e.slug === slug);
