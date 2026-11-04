/**
 * Career tools: role-based study planner, interview prep by company type, answer practice and the
 * evidence portfolio. Everything is derived from existing content and this visitor's real progress;
 * nothing here claims what a specific company asks.
 */
import type { QuestionSummary } from "../types";
import type { NoteMeta, Note } from "./learning";
import type { Progress } from "./progress";

// ── Role paths ──────────────────────────────────────────────────────────
export type RoleId = "data-analyst" | "data-engineer" | "analytics-engineer";

export interface Stage {
  title: string;
  /** Note categories, read in difficulty order. */
  categories?: string[];
  /** Interview set whose questions are practised in this stage. */
  set?: string;
  scenarios?: string[];
  projects?: string[];
  python?: boolean;
  mocks?: number;
}
export interface RolePath {
  id: RoleId;
  title: string;
  summary: string;
  stages: Stage[];
}

export const ROLE_PATHS: RolePath[] = [
  {
    id: "data-analyst",
    title: "Data analyst",
    summary: "SQL from the ground up, analytical patterns, business scenarios and timed mock interviews.",
    stages: [
      { title: "SQL foundations", categories: ["fundamentals", "joins", "aggregations"] },
      { title: "Intermediate SQL", categories: ["subqueries", "ctes", "set-operators"] },
      { title: "Window functions and analysis", categories: ["window-functions"], set: "data-analyst" },
      { title: "Business scenarios", scenarios: ["monthly-revenue-growth", "cohort-retention", "inactive-customers", "declining-customers", "quota-attainment", "above-department-average"] },
      { title: "Interview readiness", set: "top-20", mocks: 2 },
    ],
  },
  {
    id: "data-engineer",
    title: "Data engineer",
    summary: "SQL for pipelines, Python, ETL, warehousing, orchestration and end-to-end projects.",
    stages: [
      { title: "SQL core", categories: ["fundamentals", "joins", "aggregations", "ctes", "window-functions"] },
      { title: "Python for data", categories: ["python"], python: true },
      { title: "Pipelines and modelling", categories: ["etl", "warehousing"], set: "data-engineer", projects: ["csv-to-postgres-etl", "star-schema-warehouse"] },
      { title: "Processing and orchestration", categories: ["spark", "airflow"], projects: ["airflow-etl-pipeline", "incremental-loading"] },
      { title: "Cloud and capstone", categories: ["cloud", "advanced-sql"], projects: ["end-to-end-pipeline"], mocks: 2 },
    ],
  },
  {
    id: "analytics-engineer",
    title: "Analytics engineer",
    summary: "Analytical SQL, dimensional modelling, dbt and data quality.",
    stages: [
      { title: "SQL core", categories: ["fundamentals", "joins", "aggregations", "ctes"] },
      { title: "Analytical SQL", categories: ["window-functions", "subqueries"], set: "data-analyst" },
      { title: "Modelling and dbt", categories: ["warehousing", "dbt"], projects: ["dbt-analytics-project", "star-schema-warehouse"] },
      { title: "Data quality", scenarios: ["duplicate-orders", "orders-without-payment", "po-receipt-reconciliation"], projects: ["data-validation-pipeline"], mocks: 1 },
    ],
  },
];

// ── Company types ───────────────────────────────────────────────────────
export interface CompanyType {
  id: string;
  title: string;
  /** What interviews at this kind of company commonly emphasise. General guidance, not a claim about any one company. */
  emphasis: string;
  rounds: string[];
  categories: string[];
  set: string;
  scenarios: string[];
  projects: string[];
}

export const COMPANY_TYPES: CompanyType[] = [
  {
    id: "product-tech",
    title: "Large tech and product companies",
    emphasis: "Fast, correct SQL under time pressure, window functions, and turning a vague product question into a metric.",
    rounds: ["Online SQL screen", "Live SQL or Python coding", "Product metrics case", "Behavioural"],
    categories: ["window-functions", "ctes", "aggregations"],
    set: "faang-style",
    scenarios: ["cohort-retention", "monthly-revenue-growth", "declining-customers"],
    projects: ["sales-analytics-pipeline"],
  },
  {
    id: "startup",
    title: "Startups",
    emphasis: "Breadth over depth: you may own the pipeline, the model and the dashboard. Take-home projects are common.",
    rounds: ["Intro call", "Take-home project", "Project walkthrough", "Team fit"],
    categories: ["etl", "warehousing", "python"],
    set: "data-engineer",
    scenarios: ["duplicate-orders", "inactive-customers"],
    projects: ["end-to-end-pipeline", "rest-api-to-postgres"],
  },
  {
    id: "services",
    title: "Consulting and IT services",
    emphasis: "Solid fundamentals across SQL and data warehousing concepts, explained clearly to non-specialists.",
    rounds: ["Aptitude or SQL test", "Technical interview", "Client-style scenario", "HR"],
    categories: ["fundamentals", "joins", "warehousing"],
    set: "top-20",
    scenarios: ["reporting-chain", "org-chart-levels", "latest-performance-review"],
    projects: ["hr-analytics-warehouse"],
  },
  {
    id: "finance",
    title: "Banks and fintech",
    emphasis: "Accuracy and controls: reconciliation, duplicates, auditability and data quality checks.",
    rounds: ["SQL test", "Data quality / reconciliation case", "Technical interview", "Risk and compliance awareness"],
    categories: ["aggregations", "subqueries", "set-operators"],
    set: "data-engineer",
    scenarios: ["duplicate-payments", "duplicate-transactions", "loans-without-accounts"],
    projects: ["data-validation-pipeline", "incremental-loading"],
  },
  {
    id: "retail",
    title: "E-commerce and retail",
    emphasis: "Order, customer and inventory analytics: funnels, retention, stock and fulfilment gaps.",
    rounds: ["SQL screen", "Business case on sales data", "Technical interview", "Stakeholder interview"],
    categories: ["joins", "aggregations", "window-functions"],
    set: "data-analyst",
    scenarios: ["orders-without-payment", "overdue-purchase-orders", "po-receipt-reconciliation"],
    projects: ["sales-analytics-pipeline", "star-schema-warehouse"],
  },
];

// ── Planner ─────────────────────────────────────────────────────────────
export interface PlanSettings {
  role: RoleId;
  /** ISO date the plan starts. */
  start: string;
  weeks: number;
  hoursPerWeek: number;
}

export type PlanKind = "note" | "question" | "scenario" | "python" | "project" | "mock";
export interface PlanItem {
  kind: PlanKind;
  ref: string;
  title: string;
  path: string;
  minutes: number;
  stage: string;
}
export interface PlanWeek {
  index: number;
  start: string;
  items: PlanItem[];
  minutes: number;
}
export interface PlanSource {
  notes: NoteMeta[];
  index: QuestionSummary[];
  sets: { slug: string; questions: string[] }[];
  scenarios: { slug: string; title: string }[];
  exercises: { slug: string; title: string }[];
  projects: { slug: string; title: string; level?: string }[];
}

const DIFF = { Beginner: 0, Intermediate: 1, Advanced: 2, Expert: 3 } as Record<string, number>;
const PROJECT_MIN: Record<string, number> = { Beginner: 120, Intermediate: 180, Advanced: 240 };
export const MINUTES = { question: 12, scenario: 20, python: 15, mock: 60, noteExtra: 5 };

/** Every item of a role path, in study order. Unknown refs are skipped. */
export function planItems(role: RoleId, src: PlanSource): PlanItem[] {
  const path = ROLE_PATHS.find((r) => r.id === role);
  if (!path) return [];
  const bySlug = new Map(src.index.map((q) => [q.slug, q]));
  const seen = new Set<string>();
  const out: PlanItem[] = [];
  const add = (i: PlanItem) => {
    const k = `${i.kind}:${i.ref}`;
    if (!seen.has(k)) (seen.add(k), out.push(i));
  };
  for (const st of path.stages) {
    for (const cat of st.categories ?? []) {
      src.notes.filter((n) => n.category === cat)
        .sort((a, b) => (DIFF[a.difficulty] ?? 1) - (DIFF[b.difficulty] ?? 1))
        .forEach((n) => add({ kind: "note", ref: n.slug, title: n.title, path: `/notes/${n.slug}`, minutes: (n.minutes || 8) + MINUTES.noteExtra, stage: st.title }));
    }
    if (st.python) src.exercises.forEach((e) => add({ kind: "python", ref: e.slug, title: e.title, path: `/practice/python/${e.slug}`, minutes: MINUTES.python, stage: st.title }));
    for (const qs of src.sets.find((s) => s.slug === st.set)?.questions ?? []) {
      const q = bySlug.get(qs);
      if (q) add({ kind: "question", ref: String(q.number), title: `Q${q.number} ${q.title}`, path: `/questions/${q.slug}`, minutes: MINUTES.question, stage: st.title });
    }
    for (const s of st.scenarios ?? []) {
      const sc = src.scenarios.find((x) => x.slug === s);
      if (sc) add({ kind: "scenario", ref: s, title: sc.title, path: `/scenarios/${s}`, minutes: MINUTES.scenario, stage: st.title });
    }
    for (const p of st.projects ?? []) {
      const pr = src.projects.find((x) => x.slug === p);
      if (pr) add({ kind: "project", ref: p, title: pr.title, path: `/projects-lab/${p}`, minutes: PROJECT_MIN[pr.level ?? ""] ?? 180, stage: st.title });
    }
    for (let i = 0; i < (st.mocks ?? 0); i++) add({ kind: "mock", ref: `${st.title}#${i}`, title: "Timed mock interview", path: "/mock-interview", minutes: MINUTES.mock, stage: st.title });
  }
  return out;
}

export const addDaysIso = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Fill weeks in order up to the weekly budget. An item never splits; one bigger than a whole week
 * gets a week of its own. The result can need more weeks than the target, which the page reports.
 */
export function schedule(items: PlanItem[], s: PlanSettings): PlanWeek[] {
  const budget = Math.max(30, Math.round(s.hoursPerWeek * 60));
  const weeks: PlanWeek[] = [];
  let cur: PlanWeek | null = null;
  for (const it of items) {
    if (!cur || (cur.minutes > 0 && cur.minutes + it.minutes > budget)) {
      cur = { index: weeks.length, start: addDaysIso(s.start, weeks.length * 7), items: [], minutes: 0 };
      weeks.push(cur);
    }
    cur.items.push(it);
    cur.minutes += it.minutes;
  }
  return weeks;
}

/** Hours per week needed to finish all items within the target weeks (rounded up to 0.5 h). */
export const hoursNeeded = (items: PlanItem[], weeks: number) =>
  Math.ceil((items.reduce((s, i) => s + i.minutes, 0) / 60 / Math.max(1, weeks)) * 2) / 2;

export interface DoneContext {
  progress: Progress;
  /** Projects whose status is Completed (all checks passed, or approved by a reviewer). */
  completedProjects: Set<string>;
  /** Mock interviews finished on or after the plan start. */
  mocksSinceStart: number;
}

/** Done is read from real evidence only; the planner never stores ticks of its own. */
export function isDone(i: PlanItem, ctx: DoneContext, mockOrdinal: number): boolean {
  const p = ctx.progress;
  switch (i.kind) {
    case "note": return Boolean(p.read?.[i.ref]);
    case "question": return Boolean(p.questions[i.ref]?.solvedAt);
    case "scenario": return Boolean(p.lessons?.[`scenario:${i.ref}`]);
    case "python": return Boolean(p.lessons?.[`py:${i.ref}`]);
    case "project": return ctx.completedProjects.has(i.ref);
    case "mock": return ctx.mocksSinceStart > mockOrdinal;
  }
}

// ── Answer practice ─────────────────────────────────────────────────────
export interface AnswerCard {
  key: string;
  question: string;
  answer: string;
  note: string;
  noteTitle: string;
  category: string;
}

/** The "### question" blocks under "## Interview questions" in every note. */
export function interviewQA(note: Pick<Note, "slug" | "title" | "category" | "body">): AnswerCard[] {
  const sec = note.body.split(/^## Interview questions\s*$/m)[1];
  if (!sec) return [];
  const body = sec.split(/^## /m)[0];
  return body.split(/^### /m).slice(1).map((block, i) => {
    const [q, ...rest] = block.split("\n");
    return { key: `${note.slug}#${i}`, question: q.trim(), answer: rest.join("\n").trim(), note: note.slug, noteTitle: note.title, category: note.category };
  }).filter((c) => c.question && c.answer);
}

/** Terms the model answer relies on: inline code, bold text and capitalised SQL keywords. */
export function keyTerms(answer: string): string[] {
  const terms = new Set<string>();
  for (const m of answer.matchAll(/`([^`]{1,40})`/g)) terms.add(m[1].trim());
  for (const m of answer.matchAll(/\*\*([^*]{1,40})\*\*/g)) terms.add(m[1].trim());
  for (const m of answer.matchAll(/\b([A-Z]{2,}(?:\s+[A-Z]{2,})*)\b/g)) if (m[1].length > 2) terms.add(m[1]);
  return [...terms].filter((t) => /\w{2,}/.test(t)).slice(0, 12);
}

/**
 * Which key terms the learner's answer mentions. A study aid only: wording can differ and still be
 * right, so the page shows it next to the model answer and the learner rates themselves.
 */
export function termCoverage(mine: string, terms: string[]): { term: string; hit: boolean }[] {
  const norm = (s: string) => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  const text = norm(mine);
  return terms.map((t) => ({ term: t, hit: text.includes(norm(t)) }));
}

export type AnswerRating = "missed" | "partly" | "nailed";
export interface AnswerState { box: number; due: string; rating: AnswerRating; at: string; attempts: number }
const BOX_DAYS = [0, 1, 2, 4, 8, 16];

export function nextAnswerState(prev: AnswerState | undefined, rating: AnswerRating, day: string): AnswerState {
  const box = rating === "nailed" ? Math.min(5, (prev?.box ?? 0) + 1) : rating === "partly" ? Math.max(1, prev?.box ?? 1) : 1;
  return { box, due: addDaysIso(day, BOX_DAYS[box]), rating, at: new Date().toISOString(), attempts: (prev?.attempts ?? 0) + 1 };
}

/** Due cards first (oldest due), then unseen ones, in bank order. */
export function answerQueue(cards: AnswerCard[], state: Record<string, AnswerState>, day: string): AnswerCard[] {
  const due = cards.filter((c) => state[c.key] && state[c.key].due <= day).sort((a, b) => state[a.key].due.localeCompare(state[b.key].due));
  const fresh = cards.filter((c) => !state[c.key]);
  return [...due, ...fresh];
}

// ── Portfolio ───────────────────────────────────────────────────────────
export interface PortfolioProject { slug: string; title: string; status: string; passed: number; automated: number; repo?: string; reviewerApproved: boolean }
export interface Portfolio {
  name: string;
  headline: string;
  sql: { independent: number; assisted: number; imported: number; total: number; practicedDays: number };
  topics: { label: string; solved: number; total: number }[];
  tracks: { title: string; read: number; total: number }[];
  projects: PortfolioProject[];
  python: number;
  scenarios: number;
  mocks: { count: number; best: string | null };
  quality: { dataset: string; score: number }[];
  answers: { practiced: number; nailed: number };
}

/** Markdown export. Every figure states what it counts; imported solves are listed separately. */
export function portfolioMarkdown(p: Portfolio, siteUrl: string): string {
  const lines = [`# ${p.name || "My data portfolio"}`, ""];
  if (p.headline) lines.push(p.headline, "");
  lines.push("## SQL practice", "",
    `- ${p.sql.independent} questions solved independently, ${p.sql.assisted} with hints (of ${p.sql.total})`,
    ...(p.sql.imported ? [`- ${p.sql.imported} more marked solved from an imported history (not practised here)`] : []),
    `- Active on ${p.sql.practicedDays} days`, "");
  const topics = p.topics.filter((t) => t.solved);
  if (topics.length) lines.push("### By topic", "", ...topics.map((t) => `- ${t.label}: ${t.solved}/${t.total}`), "");
  if (p.projects.length) {
    lines.push("## Projects", "");
    for (const pr of p.projects) {
      lines.push(`- **${pr.title}**: ${pr.status}${pr.reviewerApproved ? " (reviewer approved)" : ""}, ${pr.passed}/${pr.automated} automated checks passed${pr.repo ? ` — ${pr.repo}` : ""}`);
    }
    lines.push("");
  }
  const tracks = p.tracks.filter((t) => t.read);
  if (tracks.length) lines.push("## Learning tracks", "", ...tracks.map((t) => `- ${t.title}: ${t.read}/${t.total} topics read`), "");
  const other = [
    p.python ? `- ${p.python} Python exercises passed` : "",
    p.scenarios ? `- ${p.scenarios} business scenarios solved` : "",
    p.mocks.count ? `- ${p.mocks.count} timed mock interviews${p.mocks.best ? `, best ${p.mocks.best}` : ""}` : "",
    p.answers.practiced ? `- ${p.answers.practiced} interview answers practised, ${p.answers.nailed} self-rated as complete` : "",
    ...p.quality.map((q) => `- Data quality checks on ${q.dataset}: best score ${q.score}%`),
  ].filter(Boolean);
  if (other.length) lines.push("## Other evidence", "", ...other, "");
  lines.push(`_Generated from practice records on ${siteUrl}._`, "");
  return lines.join("\n");
}
