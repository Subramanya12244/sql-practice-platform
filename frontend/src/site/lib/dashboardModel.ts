/**
 * The learning dashboard's questions, answered from existing progress: what to do next, what needs revising, where the
 * projects stand. Pure functions over data the app already keeps (Daily Learning, revision, Mistake Notebook, projects).
 * No second progress system, no estimates, and no AI: each line says which fact it comes from.
 */
import { dayHref, isAuthored } from "./daily";
import type { dailyResume } from "./dailyResume";
import { improvement, recurring, type NotebookRow } from "./mistakes";
import { projectStatus, type Project, type ProjectMeta, type ProjectProgress, type ProjectStatus } from "./projects";

export interface NextAction {
  id: string;
  kind: "daily" | "revision" | "mistakes" | "project" | "practice";
  title: string;
  detail: string;
  to: string;
}

export interface NextActionInput {
  resume: ReturnType<typeof dailyResume>;
  dueQuestions: number;
  dueCards: number;
  /** Daily Learning days whose revision task is due. */
  dueLessons: string[];
  notebook: NotebookRow[];
  project?: { title: string; slug: string; percent: number; pending?: string } | null;
  suggestedProject?: { title: string; slug: string; level: string } | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function nextActions(i: NextActionInput, limit = 5): NextAction[] {
  const out: NextAction[] = [];
  const t = i.resume.target;
  if (t) {
    out.push({
      id: "daily", kind: "daily",
      title: i.resume.last && !i.resume.lastDone ? `Finish today's lesson: Day ${t.day}` : i.resume.started ? `Start your next lesson: Day ${t.day}` : "Start Day 1",
      detail: t.title,
      to: isAuthored(t.id) ? dayHref(t) : "/daily",
    });
  }
  const due = i.dueQuestions + i.dueCards + i.dueLessons.length;
  if (due > 0) {
    const parts = [i.dueQuestions && plural(i.dueQuestions, "question"), i.dueCards && plural(i.dueCards, "flashcard"), i.dueLessons.length && plural(i.dueLessons.length, "lesson revision")].filter(Boolean);
    out.push({ id: "revision", kind: "revision", title: `Revise what is due (${due})`, detail: parts.join(", "), to: i.dueQuestions || i.dueCards ? "/review" : dayHref({ day: Number(i.dueLessons[0].replace(/\D/g, "")) || 1, path: i.dueLessons[0].startsWith("a") ? "analyst" : i.dueLessons[0].startsWith("e") ? "engineer" : "common" }) });
  }
  const open = i.notebook.filter((r) => r.status === "open");
  if (open.length > 0) {
    const rec = recurring(i.notebook)[0];
    out.push({
      id: "mistakes", kind: "mistakes",
      title: rec ? `Practise ${rec.label}: it keeps going wrong` : `Fix ${plural(open.length, "open mistake")}`,
      detail: rec ? `${rec.count} failed attempts across ${rec.questions} challenges. ${plural(open.length, "challenge")} still open in the Mistake Notebook.` : "Solve them again or mark them understood in the Mistake Notebook.",
      to: "/mistakes",
    });
  }
  if (i.project) {
    out.push({ id: "project", kind: "project", title: `Continue project: ${i.project.title}`, detail: `${i.project.percent}% of automated checks passed${i.project.pending ? `. Next task: ${i.project.pending}` : ""}`, to: `/projects-lab/${i.project.slug}` });
  } else if (i.suggestedProject) {
    out.push({ id: "project", kind: "project", title: `Build a project: ${i.suggestedProject.title}`, detail: `${i.suggestedProject.level} guided project, checked automatically`, to: `/projects-lab/${i.suggestedProject.slug}` });
  }
  if (out.length === 0) out.push({ id: "practice", kind: "practice", title: "Solve a SQL question", detail: "Graded on real data in your browser", to: "/questions" });
  return out.slice(0, limit);
}

// ── Revision and mistakes ────────────────────────────────────────────────
export interface RevisionSummary {
  pending: { questions: number; cards: number; lessons: number; total: number };
  repeated: ReturnType<typeof recurring>;
  weakTopics: { topic: string; label: string; open: number }[];
  corrected: NotebookRow[];
}

export function revisionSummary(i: Pick<NextActionInput, "dueQuestions" | "dueCards" | "dueLessons" | "notebook">): RevisionSummary {
  const imp = improvement(i.notebook);
  return {
    pending: { questions: i.dueQuestions, cards: i.dueCards, lessons: i.dueLessons.length, total: i.dueQuestions + i.dueCards + i.dueLessons.length },
    repeated: recurring(i.notebook).slice(0, 3),
    weakTopics: imp.topics.filter((t) => t.missed - t.fixed > 0).slice(0, 3).map((t) => ({ topic: t.topic, label: t.label, open: t.missed - t.fixed })),
    corrected: i.notebook.filter((r) => r.status !== "open").sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 3),
  };
}

// ── Projects ─────────────────────────────────────────────────────────────
const LEVEL_RANK: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };
const CURRENT: ProjectStatus[] = ["In progress", "Submitted", "Under evaluation", "Changes requested"];

export interface ProjectRow { meta: ProjectMeta; status: ProjectStatus; passed: number; total: number }
export interface ProjectActivity { current: ProjectRow[]; completed: ProjectRow[]; next?: ProjectMeta; total: number }

export function projectActivity(projects: ProjectMeta[], tasks: { slug: string; tasks: Project["tasks"] }[], progressOf: (slug: string) => ProjectProgress): ProjectActivity {
  const rows: ProjectRow[] = [];
  for (const meta of projects) {
    const def = tasks.find((x) => x.slug === meta.slug);
    if (!def) continue;
    const p = progressOf(meta.slug);
    const automated = def.tasks.filter((t) => t.type !== "checklist");
    rows.push({ meta, status: projectStatus({ tasks: def.tasks }, p), passed: automated.filter((t) => p.tasks[t.id]?.passed).length, total: automated.length });
  }
  const notStarted = rows.filter((r) => r.status === "Not started").map((r) => r.meta).sort((a, b) => (LEVEL_RANK[a.level] ?? 0) - (LEVEL_RANK[b.level] ?? 0));
  return { current: rows.filter((r) => CURRENT.includes(r.status)), completed: rows.filter((r) => r.status === "Completed"), next: notStarted[0], total: rows.length };
}
