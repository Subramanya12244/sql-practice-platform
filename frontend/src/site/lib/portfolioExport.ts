/**
 * Portfolio export: the learner's own solutions and project write-ups as plain files, for a ZIP
 * download or a GitHub repository. Only what the learner selects is included, and only work they
 * actually solved (SQL: the stored query of a solved question; Python: the last passing check).
 * Nothing is published automatically.
 */
import type { Project } from "./projects";
import type { DecisionTask } from "./tasks";

export interface ExportSql { number: number; slug: string; title: string; topic: string; difficulty: string; objective: string; sql: string }
export interface ExportPy { code: string; slug: string; title: string; category: string; difficulty: string; source: string }
export interface ExportProject { project: Project; status: string; tasksPassed: string[]; repoUrl?: string }
export interface ExportSelection { title: string; author: string; sql: ExportSql[]; python: ExportPy[]; projects: ExportProject[] }

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Comment header: what the query answers. Markdown backticks are kept as plain text. */
function sqlFile(q: ExportSql): string {
  return `-- Q${q.number} ${q.title}\n-- Topic: ${q.topic} · ${q.difficulty}\n-- Task: ${oneLine(q.objective).replace(/\n/g, " ")}\n\n${q.sql.trim()}\n`;
}
function pyFile(p: ExportPy): string {
  return `"""${p.code} ${p.title}\nCategory: ${p.category} · ${p.difficulty}\n"""\n\n${p.source.trim()}\n`;
}

/** README for a project: scenario, architecture (the project's own diagram), work done, design decisions. */
export function projectReadme(e: ExportProject, author: string): string {
  const { project } = e;
  const sections = Object.fromEntries(project.body.split(/\n(?=## )/).map((s) => [s.match(/^## (.+)/)?.[1] ?? "", s.replace(/^## .+\n/, "").replace(/<!--task:[^>]*-->/g, "").trim()]));
  const decisions = project.tasks.filter((t): t is DecisionTask => t.type === "decision");
  const automated = project.tasks.filter((t) => t.type === "sql" || t.type === "python");
  return [
    `# ${project.title}`,
    "",
    `${project.description}`,
    "",
    `**Status:** ${e.status} · **Level:** ${project.level} · **Stack:** ${project.technologies.join(", ")}${e.repoUrl ? ` · **Code:** ${e.repoUrl}` : ""}`,
    "",
    sections["Business problem"] ? `## Business problem\n\n${sections["Business problem"]}\n` : "",
    sections["Architecture"] ? `## Architecture\n\n${sections["Architecture"]}\n` : "",
    automated.length ? `## Work completed\n\n${automated.map((t) => `- [${e.tasksPassed.includes(t.id) ? "x" : " "}] ${t.title}`).join("\n")}\n` : "",
    decisions.length ? `## Design decisions\n\n${decisions.map((d) => `- **${d.title}:** ${d.options[d.answer]}. ${d.why[d.answer]}`).join("\n")}\n` : "",
    `---\n\nBuilt by ${author} on DataForge.\n`,
  ].filter(Boolean).join("\n");
}

export function buildExport(sel: ExportSelection): Record<string, string> {
  const files: Record<string, string> = {};
  for (const q of sel.sql) files[`sql/q${String(q.number).padStart(3, "0")}-${safe(q.title)}.sql`] = sqlFile(q);
  for (const p of sel.python) files[`python/${p.slug.replace(/-/g, "_")}.py`] = pyFile(p);
  for (const e of sel.projects) files[`projects/${e.project.slug}/README.md`] = projectReadme(e, sel.author);
  const list = (dir: string, items: string[]) => (items.length ? `\n## ${dir}\n\n${items.join("\n")}\n` : "");
  files["README.md"] = [
    `# ${sel.title}`,
    "",
    `Data engineering practice by ${sel.author}: SQL on a real PostgreSQL database, Python data processing, and end-to-end projects. Every solution here passed its checks on DataForge.`,
    list("SQL", sel.sql.map((q) => `- [Q${q.number} ${q.title}](sql/q${String(q.number).padStart(3, "0")}-${safe(q.title)}.sql) · ${q.topic}, ${q.difficulty}`)),
    list("Python", sel.python.map((p) => `- [${p.code} ${p.title}](python/${p.slug.replace(/-/g, "_")}.py) · ${p.category}, ${p.difficulty}`)),
    list("Projects", sel.projects.map((e) => `- [${e.project.title}](projects/${e.project.slug}/README.md) · ${e.status}`)),
  ].join("\n");
  return files;
}

export async function zipFiles(files: Record<string, string>, root: string): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const data: Record<string, Uint8Array> = {};
  for (const [p, c] of Object.entries(files)) data[`${root}/${p}`] = strToU8(c);
  return new Blob([zipSync(data, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}

/**
 * Create a repository (private unless asked otherwise) and add all files in one commit, using the
 * learner's GitHub token from their own session. Never called without an explicit confirmation.
 */
export async function pushToGitHub(token: string, opts: { repo: string; private: boolean; description: string; files: Record<string, string>; message: string }, api = "https://api.github.com"): Promise<{ url: string }> {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${api}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${(j as { message?: string }).message ?? ""}`.trim());
    return j as Record<string, unknown>;
  };
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(opts.repo)) throw new Error("Repository names may use letters, digits, '.', '-' and '_'.");
  const repo = await call("POST", "/user/repos", { name: opts.repo, private: opts.private, description: opts.description, auto_init: true });
  const full = String(repo.full_name);
  const branch = String(repo.default_branch ?? "main");
  const ref = await call("GET", `/repos/${full}/git/ref/heads/${branch}`);
  const parent = String((ref.object as { sha: string }).sha);
  const tree = await call("POST", `/repos/${full}/git/trees`, { base_tree: parent, tree: Object.entries(opts.files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })) });
  const commit = await call("POST", `/repos/${full}/git/commits`, { message: opts.message, tree: tree.sha, parents: [parent] });
  await call("PATCH", `/repos/${full}/git/refs/heads/${branch}`, { sha: commit.sha });
  return { url: String(repo.html_url) };
}

/**
 * The smallest GitHub OAuth scope that can do the job. A public repository needs only `public_repo`
 * (access to public repositories). Creating a private one needs `repo`, which also covers all of the
 * user's other private repositories, so it is only requested when the learner chooses a private repo.
 */
export type GithubAccess = "public" | "private";
export const githubScope = (access: GithubAccess): "public_repo" | "repo" => (access === "private" ? "repo" : "public_repo");
export const GITHUB_ACCESS_TEXT: Record<GithubAccess, { title: string; detail: string }> = {
  public: { title: "Public repositories only", detail: "DataForge asks GitHub for the public_repo permission: it can create and write public repositories, and cannot see your private ones." },
  private: { title: "Private repository too", detail: "A private repository needs GitHub's wider repo permission. It includes access to all your private repositories. DataForge only uses it when you press Create, and never stores the token." },
};
/** Whether a token obtained with `granted` can create a repository with the chosen visibility. */
export const scopeAllows = (granted: GithubAccess | null, wantPrivate: boolean) => granted === "private" || (granted === "public" && !wantPrivate);
