/**
 * Resume bullets for a project, built ONLY from evidence DataForge has:
 *  - the project's own written business problem
 *  - automated checks the learner actually passed (SQL checked against PostgreSQL, Python tests)
 *  - the technologies those passed checks demonstrate
 * It never invents a number or a skill. Counts come from the progress record; a technology such as
 * Airflow or dbt, which no automated check exercises, is listed as "covered" and kept out of the
 * generated text. Manual steps are labelled self-reported. The learner can edit the result.
 */
import type { Project, ProjectProgress } from "./projects";
import type { Task } from "./tasks";

export interface ResumeEvidence {
  automatedPassed: number;
  automatedTotal: number;
  /** Manual checklist steps ticked / total. Self-reported. */
  manualChecked: number;
  manualTotal: number;
  reviewApproved: boolean;
}

export interface ResumeEntry {
  slug: string;
  title: string;
  level: string;
  problem: string;
  /** Passed automated tasks, in project order. */
  implemented: { title: string; kind: "SQL" | "Python" | "Design decision" }[];
  /** Technologies backed by a passed check. */
  demonstrated: string[];
  /** Listed by the project but not exercised by any automated check. */
  covered: string[];
  evidence: ResumeEvidence;
  /** Markdown the learner can copy or edit. */
  text: string;
}

/** The first paragraph under "Business problem", or the project's description. */
export function businessProblem(project: Pick<Project, "body" | "description">): string {
  const m = project.body.match(/##\s+Business problem\s*\n+([\s\S]*?)(?:\n##\s|$)/i);
  const para = m?.[1].split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim();
  return para || project.description;
}

const passed = (t: Task, p: ProjectProgress) => t.type !== "checklist" && p.tasks[t.id]?.passed === true;

/** Which listed technologies the passed checks actually demonstrate. SQL checks run on PostgreSQL; Python checks run Python. */
export function demonstratedTech(technologies: string[], tasks: Task[], p: ProjectProgress): { demonstrated: string[]; covered: string[] } {
  const sql = tasks.some((t) => t.type === "sql" && passed(t, p));
  const py = tasks.some((t) => t.type === "python" && passed(t, p));
  const backed = (tech: string) => (sql && /^(sql|postgres(ql)?)$/i.test(tech)) || (py && /^python$/i.test(tech));
  return { demonstrated: technologies.filter(backed), covered: technologies.filter((t) => !backed(t)) };
}

/** An entry once at least one automated check has passed; null otherwise (nothing to claim yet). */
export function buildResumeEntry(project: Project, p: ProjectProgress): ResumeEntry | null {
  const automated = project.tasks.filter((t) => t.type !== "checklist");
  const done = project.tasks.filter((t) => passed(t, p));
  if (!done.length) return null;
  const manual = project.tasks.filter((t) => t.type === "checklist");
  const manualChecked = manual.reduce((n, t) => n + (p.checklist[t.id]?.filter(Boolean).length ?? 0), 0);
  const manualTotal = manual.reduce((n, t) => n + (t.type === "checklist" ? t.items.length : 0), 0);
  const { demonstrated, covered } = demonstratedTech(project.technologies, project.tasks, p);
  const evidence: ResumeEvidence = { automatedPassed: done.length, automatedTotal: automated.length, manualChecked, manualTotal, reviewApproved: p.submission?.review?.status === "Completed" };
  const implemented = done.map((t) => ({ title: t.title, kind: (t.type === "sql" ? "SQL" : t.type === "python" ? "Python" : "Design decision") as "SQL" | "Python" | "Design decision" }));
  const problem = businessProblem(project);

  const lines = [`**${project.title}**`, `- Problem: ${problem}`];
  if (demonstrated.length) lines.push(`- Technologies: ${demonstrated.join(", ")}`);
  const shown = implemented.slice(0, 5);
  lines.push(...shown.map((i) => `- ${i.title} (${i.kind})`));
  if (implemented.length > shown.length) lines.push(`- ${implemented.length - shown.length} more verified step${implemented.length - shown.length === 1 ? "" : "s"}`);
  lines.push(`- Outcome: ${evidence.automatedPassed} of ${evidence.automatedTotal} automated checks passed${evidence.reviewApproved ? "; reviewer approved" : ""}.`);

  return { slug: project.slug, title: project.title, level: project.level, problem, implemented, demonstrated, covered, evidence, text: lines.join("\n") };
}

// ── Edits, kept on this device ───────────────────────────────────────────
const KEY = "sqlp.resume.edits";
export const readEdits = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>; } catch { return {}; } };
export function saveEdit(slug: string, text: string | null) {
  const all = readEdits();
  if (text === null) delete all[slug]; else all[slug] = text.slice(0, 4000);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: the edit lives only in the open page */ }
}
