/**
 * Projects Lab model: filters, per-task state and "what do I do next". Pure functions over the project metadata and the learner's
 * own progress record. Nothing here decides whether a task passed: that comes only from the check results the learner's browser
 * stored (`ProjectProgress.tasks[id].passed`), exactly as `projectStatus` reads them.
 */
import type { ProjectMeta, ProjectProgress, ProjectStatus } from "./projects";

export type Level = "Beginner" | "Intermediate" | "Advanced";
export const LEVELS: Level[] = ["Beginner", "Intermediate", "Advanced"];

/** Status as a filter: the seven statuses of `projectStatus`, grouped into the three a learner thinks in. */
export type StatusGroup = "not-started" | "in-progress" | "completed";
export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = { "not-started": "Not started", "in-progress": "In progress", completed: "Completed" };

/** Completed is Completed. Not started is Not started. Everything between (started, submitted, under review, changes requested, rejected) is work in progress. */
export function statusGroup(s: ProjectStatus): StatusGroup {
  return s === "Completed" ? "completed" : s === "Not started" ? "not-started" : "in-progress";
}

/** What the index needs to know about each task: no code, no solutions. */
export interface TaskRef { id: string; type: "sql" | "python" | "checklist" | "decision"; title: string }
export interface ProjectTasks { slug: string; tasks: TaskRef[] }

export type TaskState =
  | "passed"       // an automated check passed
  | "failed"       // an automated check was run and did not pass
  | "pending"      // an automated check not yet run
  | "done"         // every box of a manual step is ticked
  | "partial"      // some boxes ticked
  | "todo";        // a manual step with nothing ticked

export function taskState(task: TaskRef, progress: ProjectProgress): TaskState {
  if (task.type === "checklist") {
    const ticks = progress.checklist[task.id] ?? [];
    return ticks.length > 0 && ticks.every(Boolean) ? "done" : ticks.some(Boolean) ? "partial" : "todo";
  }
  const r = progress.tasks[task.id];
  return r ? (r.passed ? "passed" : "failed") : "pending";
}

export const isAutomated = (t: TaskRef) => t.type !== "checklist";
export const isFinished = (s: TaskState) => s === "passed" || s === "done";

/** The first automated task that has not passed; once those are done, the first manual step with boxes left. Null when everything is finished. */
export function nextTask(tasks: TaskRef[], progress: ProjectProgress): TaskRef | null {
  const auto = tasks.find((t) => isAutomated(t) && taskState(t, progress) !== "passed");
  if (auto) return auto;
  return tasks.find((t) => !isAutomated(t) && taskState(t, progress) !== "done") ?? null;
}

export interface ProjectProgressSummary {
  status: ProjectStatus;
  group: StatusGroup;
  automated: number;
  passed: number;
  failed: number;
  manual: number;
  manualDone: number;
  next: TaskRef | null;
}

export function summarise(tasks: TaskRef[], progress: ProjectProgress, status: ProjectStatus): ProjectProgressSummary {
  const auto = tasks.filter(isAutomated);
  const manual = tasks.filter((t) => !isAutomated(t));
  return {
    status, group: statusGroup(status), automated: auto.length,
    passed: auto.filter((t) => taskState(t, progress) === "passed").length,
    failed: auto.filter((t) => taskState(t, progress) === "failed").length,
    manual: manual.length, manualDone: manual.filter((t) => taskState(t, progress) === "done").length,
    next: nextTask(tasks, progress),
  };
}

// ── Filters ──────────────────────────────────────────────────────────────
export interface ProjectFilter { q: string; level: Level | "all"; tech: string; status: StatusGroup | "all" }
export const NO_PROJECT_FILTER: ProjectFilter = { q: "", level: "all", tech: "all", status: "all" };
export const isProjectFiltered = (f: ProjectFilter) => f.q.trim() !== "" || f.level !== "all" || f.tech !== "all" || f.status !== "all";

/** The filter the address describes (?q=&level=&tech=&status=). Unknown values are ignored so an old link never breaks the page. */
export function projectFilterFromSearch(search: string, techs: string[] = []): ProjectFilter {
  const p = new URLSearchParams(search);
  const level = p.get("level") ?? "";
  const status = p.get("status") ?? "";
  const tech = p.get("tech") ?? "";
  return {
    q: (p.get("q") ?? "").slice(0, 80),
    level: (LEVELS as string[]).includes(level) ? (level as Level) : "all",
    status: (Object.keys(STATUS_GROUP_LABEL) as string[]).includes(status) ? (status as StatusGroup) : "all",
    tech: techs.length === 0 || techs.includes(tech) ? (tech || "all") : "all",
  };
}

export function projectFilterToSearch(f: ProjectFilter): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.level !== "all") p.set("level", f.level);
  if (f.tech !== "all") p.set("tech", f.tech);
  if (f.status !== "all") p.set("status", f.status);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Technologies across all projects, most used first, with how many projects use each. */
export function technologyOptions(projects: Pick<ProjectMeta, "technologies">[]): { tech: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of projects) for (const t of new Set(p.technologies)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tech, count]) => ({ tech, count })).sort((a, b) => b.count - a.count || a.tech.localeCompare(b.tech));
}

export function filterProjects<P extends Pick<ProjectMeta, "slug" | "title" | "description" | "level" | "technologies">>(projects: P[], statusOf: (slug: string) => StatusGroup, f: ProjectFilter): P[] {
  const tokens = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return projects.filter((p) => {
    if (f.level !== "all" && p.level !== f.level) return false;
    if (f.tech !== "all" && !p.technologies.includes(f.tech)) return false;
    if (f.status !== "all" && statusOf(p.slug) !== f.status) return false;
    if (!tokens.length) return true;
    const hay = `${p.title} ${p.description} ${p.technologies.join(" ")} ${p.level}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

/** Totals for the header: projects and tasks, and how many of the tasks are checked automatically. */
export function libraryTotals(projects: Pick<ProjectMeta, "taskCount" | "automated" | "manual">[]) {
  return { projects: projects.length, tasks: projects.reduce((s, p) => s + p.taskCount, 0), automated: projects.reduce((s, p) => s + p.automated, 0), manual: projects.reduce((s, p) => s + p.manual, 0) };
}
