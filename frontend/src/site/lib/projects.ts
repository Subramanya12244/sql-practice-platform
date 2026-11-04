import { splitFrontmatter } from "./learning";
import { extractTasks, type Task } from "./tasks";
import { dataSink } from "./dataSync";

export interface Project {
  slug: string;
  title: string;
  level: string;
  description: string;
  technologies: string[];
  dataset: string;
  prerequisites: string[];
  minutes: number;
  /** Markdown with `<!--task:id-->` markers where task blocks were. */
  body: string;
  tasks: Task[];
}
export type ProjectMeta = Omit<Project, "body" | "tasks"> & { taskCount: number; automated: number; manual: number };

const files = import.meta.glob("../content/projects/*.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const list = (v?: string) => (v ?? "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
const LEVEL: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };

export function parseProject(raw: string, fallback: string): Project {
  const { meta, body } = splitFrontmatter(raw);
  const { tasks, rest } = extractTasks(body);
  return {
    slug: meta.slug || fallback,
    title: meta.title || fallback,
    level: meta.level || "Beginner",
    description: meta.description || "",
    technologies: list(meta.technologies),
    dataset: meta.dataset || "northwind",
    prerequisites: list(meta.prerequisites),
    minutes: Number(meta.minutes) || 60,
    body: rest,
    tasks,
  };
}

let cache: Promise<Project[]> | null = null;
export function loadAllProjects(): Promise<Project[]> {
  cache ??= Promise.all(Object.entries(files).map(async ([p, load]) => parseProject(await load(), p.split("/").pop()!.replace(/\.md$/, "")))).then((all) =>
    all.sort((a, b) => (LEVEL[a.level] ?? 1) - (LEVEL[b.level] ?? 1) || a.title.localeCompare(b.title)),
  );
  return cache;
}
export const loadProjectIndex = async (): Promise<ProjectMeta[]> =>
  (await loadAllProjects()).map(({ body: _b, tasks, ...m }) => ({
    ...m,
    taskCount: tasks.length,
    automated: tasks.filter((t) => t.type !== "checklist").length,
    manual: tasks.filter((t) => t.type === "checklist").length,
  }));
export const loadProject = async (slug: string) => (await loadAllProjects()).find((p) => p.slug === slug);

// ── Progress (this browser) ────────────────────────────────────────────────
export type ProjectStatus = "Not started" | "In progress" | "Submitted" | "Under evaluation" | "Completed";

export interface ProjectProgress {
  tasks: Record<string, { passed: boolean; code?: string; at: string; message?: string }>;
  checklist: Record<string, boolean[]>;
  submission?: { url?: string; notes?: string; at: string };
}

const KEY = (slug: string) => `sqlp.project.${slug}`;
export function getProjectProgress(slug: string): ProjectProgress {
  try {
    return { tasks: {}, checklist: {}, ...(JSON.parse(localStorage.getItem(KEY(slug)) ?? "{}") as Partial<ProjectProgress>) };
  } catch {
    return { tasks: {}, checklist: {} };
  }
}
/** `submitted` marks a new submission, which is recorded once on the account. */
export function saveProjectProgress(slug: string, p: ProjectProgress, submitted = false) {
  try {
    localStorage.setItem(KEY(slug), JSON.stringify(p));
  } catch {
    /* ignore */
  }
  dataSink()?.project(slug, p, submitted);
}

/**
 * Status is derived, never stored, so it can't drift from the evidence:
 * - Completed: every automated task passes AND the project has no manual (checklist) tasks.
 * - Under evaluation: submitted, all automated tasks pass, but manual steps need a reviewer.
 * - Submitted: the learner submitted before every automated task passed.
 * - In progress: anything attempted. Opening a project changes nothing.
 */
export function projectStatus(project: Pick<Project, "tasks">, p: ProjectProgress): ProjectStatus {
  const automated = project.tasks.filter((t) => t.type !== "checklist");
  const manual = project.tasks.filter((t) => t.type === "checklist");
  const allPassed = automated.length > 0 && automated.every((t) => p.tasks[t.id]?.passed);
  if (allPassed && manual.length === 0) return "Completed";
  if (p.submission) return allPassed ? "Under evaluation" : "Submitted";
  const touched = Object.keys(p.tasks).length > 0 || Object.values(p.checklist).some((c) => c.some(Boolean));
  return touched ? "In progress" : "Not started";
}

export function isRepoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^(github\.com|gitlab\.com|bitbucket\.org)$/.test(u.hostname) && u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}
