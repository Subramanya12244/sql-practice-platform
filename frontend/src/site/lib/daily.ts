/**
 * Daily Learning: curriculum metadata and lesson content loaders. Format: docs/DAILY_LEARNING_CONTENT.md.
 *
 * - `content/daily/curriculum.json`: phases, paths and every day's metadata (180 days per path).
 * - `content/daily/days/<id>.md`: theory, syntax, runnable examples, review (one file per authored day).
 * - `content/daily/days/<id>.json`: time budget, exercises, knowledge check and reuse links.
 * A day with no files is "content coming": the roadmap still shows its title, phase, topics and prerequisites.
 */
import curriculumJson from "../content/daily/curriculum.json";

export type PathId = "common" | "analyst" | "engineer";
export type BranchId = Exclude<PathId, "common">;
export type DayKind = "lesson" | "project" | "checkpoint" | "capstone";

export interface DayMeta {
  /** "d042" (common days 1–90), "a120" (analyst), "e120" (engineer). Progress is keyed by id. */
  id: string;
  /** Position in the programme, 1–180. Analyst and engineer days both use 91–180. */
  day: number;
  title: string;
  phase: string;
  path: PathId;
  kind: DayKind;
  /** Planned study minutes. */
  minutes: number;
  topics: string[];
  prerequisites: string[];
}

export interface PhaseMeta {
  id: string;
  title: string;
  path: PathId;
  summary: string;
  firstDay: number;
  lastDay: number;
  /** Existing DataForge resources for this phase (slugs). */
  resources: DayLinks;
}

export interface DayLinks {
  notes?: string[];
  questions?: number[];
  pyExercises?: string[];
  projects?: string[];
  mindmaps?: string[];
  patterns?: string[];
}

export interface Curriculum {
  version: number;
  programme: { title: string; totalDays: number; commonDays: number; branchStartDay: number; defaultDailyMinutes: number };
  paths: { id: BranchId; title: string; summary: string }[];
  phases: PhaseMeta[];
  days: DayMeta[];
}

export const CURRICULUM = curriculumJson as unknown as Curriculum;
export const PATHS = CURRICULUM.paths;
export const DAY_BY_ID = new Map(CURRICULUM.days.map((d) => [d.id, d]));
export const PHASE_BY_ID = new Map(CURRICULUM.phases.map((p) => [p.id, p]));
export const COMMON_DAYS = CURRICULUM.days.filter((d) => d.path === "common");
export const BRANCH_DAYS: Record<BranchId, DayMeta[]> = {
  analyst: CURRICULUM.days.filter((d) => d.path === "analyst"),
  engineer: CURRICULUM.days.filter((d) => d.path === "engineer"),
};

/** The ordered 180 days a learner on `path` follows: the common core, then their path (or the common core alone before a choice). */
export function sequenceFor(path: BranchId | undefined): DayMeta[] {
  return path ? [...COMMON_DAYS, ...BRANCH_DAYS[path]] : COMMON_DAYS;
}

export const phasesFor = (path: BranchId | undefined) =>
  CURRICULUM.phases.filter((p) => p.path === "common" || p.path === path);

export function dayHref(d: Pick<DayMeta, "day" | "path">): string {
  return d.path === "common" ? `/daily/day/${d.day}` : `/daily/${d.path}/day/${d.day}`;
}

export function findDay(path: PathId, day: number): DayMeta | undefined {
  return CURRICULUM.days.find((d) => d.path === path && d.day === day);
}

// ── Content files ────────────────────────────────────────────────────────
const mdFiles = import.meta.glob("../content/daily/days/*.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const jsonFiles = import.meta.glob("../content/daily/days/*.json", { import: "default" }) as Record<string, () => Promise<DayExtras>>;
const idOf = (p: string) => p.split("/").pop()!.replace(/\.(md|json)$/, "");

/** Ids of days that have both a lesson file and an exercise file. Computed from file names, no content is loaded. */
export const AUTHORED_IDS: ReadonlySet<string> = new Set(
  Object.keys(mdFiles).map(idOf).filter((id) => Object.keys(jsonFiles).some((p) => idOf(p) === id)),
);
export const isAuthored = (id: string) => AUTHORED_IDS.has(id);

export interface TimeBudget { theory: number; examples: number; guided: number; independent: number; review: number }

export interface Exercise {
  id: string;
  title: string;
  /** python and sql are graded in the browser. written is self-assessed against `rubric` (use it for tools that cannot run in the browser). */
  kind: "python" | "sql" | "written";
  /** Markdown instructions. */
  prompt: string;
  starter: string;
  solution: string;
  /** Python: exact stdout of a correct program (compared per line, trailing spaces ignored). */
  expected?: string;
  /** Python: text fed to input(). */
  stdin?: string;
  /** SQL: row order matters when true. Results are compared with the solution query's results. */
  ordered?: boolean;
  /** Guided exercises only: progressive hints, gentlest first. */
  hints?: string[];
  /** Default true. An optional exercise never blocks completing the day. */
  required?: boolean;
  /** written exercises: what a good answer contains. The learner ticks these off against `solution`. */
  rubric?: string[];
}

export interface Check {
  id: string;
  question: string;
  options: string[];
  /** Index into options. */
  answer: number;
  explanation: string;
}

export interface DayExtras {
  id: string;
  time: TimeBudget;
  links?: DayLinks;
  guided: Exercise[];
  independent: Exercise[];
  checks: Check[];
  /** Set when something in the day needs software the browser cannot run. Shown to the learner and listed in the coverage report. */
  environment?: { packages: string[]; note: string };
}

export type Block =
  | { kind: "text"; md: string }
  | { kind: "example"; id: string; title: string; lang: "python" | "sql" | "bash"; code: string; stdin?: string; output: string; browser: boolean };

export interface DayContent extends DayExtras {
  /** Markdown of each required section, keyed by heading. */
  sections: Record<string, string>;
  /** "Learn by example" split into prose and runnable examples. */
  examples: Block[];
}

export const REQUIRED_SECTIONS = [
  "Objectives", "Understand", "Syntax and key functions", "Learn by example", "Real-world applications",
  "Daily review", "Revision task", "Next-day preparation",
] as const;

/** Split a lesson's markdown into its `##` sections. Text before the first heading is dropped. */
export function splitSections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^##\s+(.+)$/gm;
  const marks = [...md.matchAll(re)];
  marks.forEach((m, i) => {
    out[m[1].trim()] = md.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim();
  });
  return out;
}

/**
 * Turn the "Learn by example" section into prose and examples. An example is a fenced block tagged
 * `python run`, `sql run` (run in the browser and by the tests), `python local` or `bash run` (run by the tests only, shown read-only
 * in the browser with a "run on your computer" note), optionally followed by a `stdin` block, then its `output` block.
 * The nearest `###` heading above it is the example's title.
 */
export function parseExamples(section: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```([^\n]*)\n([\s\S]*?)```/g;
  let last = 0;
  let title = "Example";
  let n = 0;
  let pending: { id: string; title: string; lang: "python" | "sql" | "bash"; code: string; stdin?: string; browser: boolean } | null = null;
  const pushText = (text: string) => {
    const t = text.trim();
    if (t) blocks.push({ kind: "text", md: t });
    for (const h of t.matchAll(/^###\s+(.+)$/gm)) title = h[1].trim().replace(/^Example\s*\d+\s*[:.\-–]\s*/i, "");
  };
  for (const m of section.matchAll(fence)) {
    const info = m[1].trim();
    const body = m[2].replace(/\n$/, "");
    const [lang, mode] = info.split(/\s+/);
    // python run / sql run: executed by the tests and by the browser. python local / bash run: executed by the tests only.
    const isRun = (mode === "run" && (lang === "python" || lang === "sql" || lang === "bash")) || (mode === "local" && lang === "python");
    if (info === "stdin" && pending) {
      pending.stdin = body;
      last = m.index! + m[0].length;
      continue;
    }
    if (info === "output" && pending) {
      blocks.push({ kind: "example", ...pending, output: body });
      pending = null;
      last = m.index! + m[0].length;
      continue;
    }
    if (isRun) {
      if (pending) throw new Error(`Example "${pending.title}" has no output block`);
      pushText(section.slice(last, m.index));
      pending = { id: `ex${++n}`, title, lang: lang as "python" | "sql" | "bash", code: body, browser: mode === "run" && lang !== "bash" };
      last = m.index! + m[0].length;
      continue;
    }
    // Any other fenced block stays in the prose.
  }
  if (pending) throw new Error(`Example "${pending.title}" has no output block`);
  pushText(section.slice(last));
  return blocks;
}

/** One cell as shown in expected-output blocks: NULL for null, ISO date for dates, JSON for objects. */
export function renderCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return v.getUTCHours() + v.getUTCMinutes() + v.getUTCSeconds() === 0 ? v.toISOString().slice(0, 10) : v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Query result as text: a header line, then one line per row, cells joined by " | ". The format of SQL `output` blocks. */
export function renderResultText(columns: string[], rows: unknown[][]): string {
  return [columns.join(" | "), ...rows.map((r) => r.map(renderCell).join(" | "))].join("\n");
}

/** Compare outputs line by line, ignoring trailing spaces and trailing blank lines. */
export const normaliseOutput = (s: string) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
export const sameOutput = (a: string, b: string) => normaliseOutput(a) === normaliseOutput(b);

export function parseDay(md: string, extras: DayExtras): DayContent {
  const sections = splitSections(md);
  return { ...extras, sections, examples: parseExamples(sections["Learn by example"] ?? "") };
}

export async function loadDay(id: string): Promise<DayContent | null> {
  const mdKey = Object.keys(mdFiles).find((p) => idOf(p) === id);
  const jsonKey = Object.keys(jsonFiles).find((p) => idOf(p) === id);
  if (!mdKey || !jsonKey) return null;
  const [md, extras] = await Promise.all([mdFiles[mdKey](), jsonFiles[jsonKey]()]);
  return parseDay(md, extras);
}

/** Learning-resource links for a day: its own, or the phase's when it has none. */
export function linksFor(day: DayMeta, content?: Pick<DayExtras, "links"> | null): DayLinks {
  return content?.links ?? PHASE_BY_ID.get(day.phase)?.resources ?? {};
}

/** Prerequisites of `day` that are not complete, given a completion predicate. */
export const unmetPrerequisites = (day: DayMeta, isDone: (id: string) => boolean): DayMeta[] =>
  day.prerequisites.filter((id) => !isDone(id)).map((id) => DAY_BY_ID.get(id)).filter((d): d is DayMeta => !!d);

export const prerequisitesOf = (day: DayMeta): DayMeta[] =>
  day.prerequisites.map((id) => DAY_BY_ID.get(id)).filter((d): d is DayMeta => !!d);

export function neighbours(day: DayMeta, path: BranchId | undefined) {
  const seq = day.path === "common" ? sequenceFor(path) : sequenceFor(day.path);
  const i = seq.findIndex((d) => d.id === day.id);
  return { prev: i > 0 ? seq[i - 1] : undefined, next: i >= 0 && i + 1 < seq.length ? seq[i + 1] : undefined };
}
