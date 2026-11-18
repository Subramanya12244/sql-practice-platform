/**
 * The Learn hub's topic library. A topic is a theory note (167) or, for Data Analytics, a Daily Learning phase that has no
 * notes (11). Everything is joined from data the app already has: note front matter (prerequisites, questions, patterns,
 * guides, projects), Python exercises (`topic` is a note slug), mind map nodes (which link to notes) and the Daily curriculum
 * (which phase teaches which notes). Nothing is copied or invented; a topic only lists a resource that exists.
 *
 * Pure functions, no React: the build step and the tests call them directly.
 */
import { CURRICULUM, PHASE_BY_ID, dayHref, isAuthored } from "./daily";
import { NOTE_CATEGORIES, walkNodes, type MindMap, type NoteMeta, type PatternMeta } from "./learning";
import type { PyExerciseMeta } from "./pyExercises";
import type { ProjectMeta } from "./projects";
import type { Progress } from "./progress";
import type { QuestionSummary } from "../types";
import { noteStatus } from "./noteStatus";
import { hasActivity, isDone, type DailyState } from "./dailyProgress";
import { DAILY_EXERCISE_TITLES, DAILY_TOPIC_EXERCISES } from "./workspaceLinksData";
import { domainOfId, pickPractice, practiceDifficulty, sqlId, pyId, type PracticeItem } from "./workspaceLinks";

export type Subject = "sql" | "python" | "analytics" | "engineering";

export const SUBJECTS: { id: Subject; label: string; blurb: string }[] = [
  { id: "sql", label: "SQL", blurb: "Queries, joins, window functions, performance" },
  { id: "python", label: "Python for Data", blurb: "Python, pandas, NumPy, files and APIs" },
  { id: "analytics", label: "Data Analytics", blurb: "Excel, statistics, EDA, visualisation, BI" },
  { id: "engineering", label: "Data Engineering", blurb: "ETL, warehousing, Spark, Airflow, dbt, cloud" },
];
export const SUBJECT_LABEL = Object.fromEntries(SUBJECTS.map((s) => [s.id, s.label])) as Record<Subject, string>;
export const SUBJECT_SHORT: Record<Subject, string> = { sql: "SQL", python: "Python", analytics: "Analytics", engineering: "Engineering" };

/** "SQL · Joins", but "SQL Fundamentals" (not "SQL · SQL Fundamentals") when the category already names the subject. */
export function topicEyebrow(subject: Subject, categoryLabel: string): string {
  const short = SUBJECT_SHORT[subject];
  return categoryLabel.toLowerCase().startsWith(short.toLowerCase()) ? categoryLabel : `${short} · ${categoryLabel}`;
}

/** Study time: minutes for a note, hours for anything over two hours (a Daily phase is 5 to 18 lessons). */
export function durationLabel(minutes: number): string {
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`;
}

export function subjectOfCategory(category: string): Subject {
  if (category === "python") return "python";
  return NOTE_CATEGORIES.find((c) => c.slug === category)?.group === "sql" ? "sql" : "engineering";
}

export type ResourceType = "note" | "practice" | "daily" | "pattern" | "guide" | "map" | "project" | "visual";
export const RESOURCE_TYPES: { id: ResourceType; label: string }[] = [
  { id: "note", label: "Theory notes" },
  { id: "practice", label: "Practice problems" },
  { id: "daily", label: "Daily lessons" },
  { id: "pattern", label: "Patterns" },
  { id: "guide", label: "Concept guides" },
  { id: "map", label: "Mind maps" },
  { id: "project", label: "Projects" },
  { id: "visual", label: "Visual explanations" },
];

export const LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;

/**
 * How demanding each Daily Learning phase is, relative to the programme. This is an editorial call (a test checks that every
 * phase has one); it is what a path's Beginner / Intermediate / Advanced classification is computed from. Notes and lessons
 * carry their own difficulty, and these only cover phases that have none.
 */
export const PHASE_LEVEL: Record<string, "Beginner" | "Intermediate" | "Advanced"> = {
  "python-fundamentals": "Beginner", "sql-fundamentals": "Beginner", "statistics-foundations": "Beginner",
  "python-intermediate": "Intermediate", "python-testing": "Intermediate", numpy: "Intermediate", pandas: "Intermediate", "sql-advanced": "Advanced",
  excel: "Beginner", "analyst-statistics": "Intermediate", eda: "Intermediate", visualisation: "Intermediate", "power-bi": "Intermediate",
  storytelling: "Intermediate", "business-analytics": "Intermediate", "analyst-data-prep": "Intermediate", "analyst-interview": "Advanced", "analyst-capstone": "Advanced",
  "ingestion-csv-excel": "Intermediate", "rest-api": "Intermediate", "sql-python-eng": "Intermediate", etl: "Intermediate", "data-quality": "Intermediate",
  warehousing: "Intermediate", "linux-tools": "Intermediate", airflow: "Advanced", spark: "Advanced", "engineer-interview": "Advanced", "engineer-capstone": "Advanced",
};

/**
 * Data Analytics has no note category; it is taught in Daily Learning phases. Each such phase is a topic, with the phase's
 * lessons, minutes and resources from the curriculum.
 */
export const ANALYTICS_MODULES: { phase: string; level: string }[] = [
  "statistics-foundations", "excel", "analyst-statistics", "eda", "visualisation", "power-bi", "storytelling", "business-analytics", "analyst-data-prep", "analyst-interview", "analyst-capstone",
].map((phase) => ({ phase, level: PHASE_LEVEL[phase] }));

export interface VisualRef { label: string; to: string }
const V = (label: string, to: string): VisualRef => ({ label, to });
const QV = V("SQL query visualizer", "/query-visualizer");
const TM = V("Python code time machine", "/visual/python");
const DATA = V("Data and pandas visualizer", "/visual/data");

/** Which existing visual lab explains a topic. Only topics a lab really shows are listed; the routes are checked by a test. */
const VISUAL_BY_CATEGORY: Record<string, VisualRef[]> = {
  fundamentals: [QV], joins: [QV], aggregations: [QV], subqueries: [QV], ctes: [QV], "window-functions": [QV], "set-operators": [QV],
  etl: [V("ETL visual", "/visual/etl"), V("ETL pipeline builder", "/etl-builder")],
  airflow: [V("DAG simulator", "/dag-simulator")],
  warehousing: [V("Schema designer", "/schema-designer")],
};
const VISUAL_BY_NOTE: Record<string, VisualRef[]> = {
  ...Object.fromEntries(["python-fundamentals", "python-variables-data-types", "python-collections", "python-conditionals", "python-loops", "python-functions", "python-lambdas", "python-comprehensions", "python-oop", "python-exceptions"].map((s) => [s, [TM]])),
  "python-pandas": [DATA], "python-numpy": [DATA], "python-csv-json": [DATA],
  "python-api-integration": [V("API visualizer", "/visual/api")],
  "python-etl-pipelines": [V("ETL visual", "/visual/etl")],
};
const VISUAL_BY_PHASE: Record<string, VisualRef[]> = {
  "statistics-foundations": [V("Statistics lab", "/visual/stats")],
  "analyst-statistics": [V("Statistics lab", "/visual/stats")],
  excel: [V("Excel lab", "/visual/excel")],
  eda: [DATA],
  visualisation: [V("Chart explorer", "/visual/charts")],
  storytelling: [V("Chart explorer", "/visual/charts")],
  "business-analytics": [V("Business lab", "/visual/business")],
  "analyst-interview": [V("Interview lab", "/visual/interview")],
};
export const ALL_VISUAL_ROUTES: string[] = [...new Set([...Object.values(VISUAL_BY_CATEGORY), ...Object.values(VISUAL_BY_NOTE), ...Object.values(VISUAL_BY_PHASE)].flat().map((v) => v.to))];

export interface HubTopic {
  /** Note slug, or the Daily phase id for an analytics module. Used in /learn/topic/:id. */
  id: string;
  kind: "note" | "module";
  title: string;
  subject: Subject;
  /** Note category slug, or "analytics-core" / "analytics-analyst" for modules. */
  category: string;
  categoryLabel: string;
  level: string;
  minutes: number;
  description: string;
  prerequisites: string[];
  related: string[];
  questions: number[];
  exercises: string[];
  patterns: string[];
  guides: string[];
  maps: string[];
  projects: string[];
  /** Daily Learning phases that teach this topic. */
  phases: string[];
  visual: VisualRef[];
}

export interface TopicInputs {
  notes: NoteMeta[];
  patterns: PatternMeta[];
  /** Note slug to the slugs of mind maps whose nodes link to it. */
  mapsByNote: Record<string, string[]>;
  exercises: PyExerciseMeta[];
}

/** Mind map slugs per note, from the nodes' `note` links. */
export function mapIndex(maps: MindMap[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of maps) {
    walkNodes(m.root, (n) => {
      if (n.note && !(out[n.note] ??= []).includes(m.slug)) out[n.note].push(m.slug);
    });
  }
  return out;
}

const phaseDays = (phase: string) => CURRICULUM.days.filter((d) => d.phase === phase && isAuthored(d.id));
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function buildTopics({ notes, patterns, mapsByNote, exercises }: TopicInputs): HubTopic[] {
  const catLabel = Object.fromEntries(NOTE_CATEGORIES.map((c) => [c.slug, c.label]));
  const exBy: Record<string, string[]> = {};
  for (const e of exercises) (exBy[e.topic] ??= []).push(e.slug);
  const phasesOf = (slug: string) => CURRICULUM.phases.filter((p) => p.resources.notes?.includes(slug)).map((p) => p.id);

  const fromNotes: HubTopic[] = notes.map((n) => ({
    id: n.slug, kind: "note", title: n.title, subject: subjectOfCategory(n.category), category: n.category, categoryLabel: catLabel[n.category] ?? n.category,
    level: n.difficulty, minutes: n.minutes, description: n.description,
    prerequisites: n.prerequisites.filter((s) => notes.some((x) => x.slug === s)), related: n.related.filter((s) => notes.some((x) => x.slug === s)),
    questions: n.questions, exercises: exBy[n.slug] ?? [],
    patterns: uniq([...n.patterns, ...patterns.filter((p) => p.notes.includes(n.slug)).map((p) => p.slug)]),
    guides: n.guides, maps: mapsByNote[n.slug] ?? [], projects: n.projects, phases: phasesOf(n.slug),
    visual: VISUAL_BY_NOTE[n.slug] ?? VISUAL_BY_CATEGORY[n.category] ?? [],
  }));

  const modules: HubTopic[] = ANALYTICS_MODULES.flatMap(({ phase, level }) => {
    const p = PHASE_BY_ID.get(phase);
    if (!p) return [];
    return [{
      id: p.id, kind: "module" as const, title: p.title, subject: "analytics" as const,
      category: p.path === "common" ? "analytics-core" : "analytics-analyst", categoryLabel: p.path === "common" ? "Common core" : "Analyst path",
      level, minutes: phaseDays(p.id).reduce((s, d) => s + d.minutes, 0), description: p.summary,
      prerequisites: [], related: (p.resources.notes ?? []).filter((s) => notes.some((x) => x.slug === s)),
      questions: [], exercises: [], patterns: [], guides: [], maps: p.resources.mindmaps ?? [], projects: p.resources.projects ?? [],
      phases: [p.id], visual: VISUAL_BY_PHASE[p.id] ?? [],
    }];
  });
  return [...fromNotes, ...modules];
}

/** What the library needs per topic: counts, not lists. Keeps the hub's embedded page data small. */
export interface TopicLite {
  id: string; kind: "note" | "module"; title: string; subject: Subject; category: string; categoryLabel: string; level: string; minutes: number;
  description: string;
  /** Prerequisite topic ids (the recommendations need them). */
  prerequisites: string[];
  /** Linked SQL question numbers (status needs them). */
  questions: number[];
  /** Daily day ids of the phase (modules only; status needs them). */
  days?: string[];
  n: Record<ResourceType, number>;
}

export function toLite(t: HubTopic): TopicLite {
  const days = t.kind === "module" ? phaseDays(t.id).map((d) => d.id) : undefined;
  return {
    id: t.id, kind: t.kind, title: t.title, subject: t.subject, category: t.category, categoryLabel: t.categoryLabel, level: t.level, minutes: t.minutes,
    description: t.description.length > 170 ? `${t.description.slice(0, 167).trimEnd()}…` : t.description,
    prerequisites: t.prerequisites, questions: t.questions, days,
    n: {
      note: t.kind === "note" ? 1 : 0, practice: t.questions.length + t.exercises.length, daily: t.phases.length, pattern: t.patterns.length,
      guide: t.guides.length, map: t.maps.length, project: t.projects.length, visual: t.visual.length,
    },
  };
}

// ── Status (from real progress only) ─────────────────────────────────────
export type TopicStatus = "new" | "started" | "learned";
export interface TopicProgress { status: TopicStatus; label: string; detail: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Notes: Not started, Read (marked as read), Learned (read and at least half the linked questions solved; same rule as the
 * notes page). Modules: Not started, In progress, Completed, from the Daily Learning lessons of the phase.
 * No state is "mastered": opening a page changes nothing.
 */
export function topicProgress(t: Pick<TopicLite, "id" | "kind" | "questions" | "days">, p: Pick<Progress, "read" | "questions">, daily: DailyState): TopicProgress {
  if (t.kind === "module") {
    const days = t.days ?? [];
    const done = days.filter((d) => isDone(daily, d)).length;
    const detail = `${done} of ${plural(days.length, "lesson")} completed`;
    if (days.length > 0 && done === days.length) return { status: "learned", label: "Completed", detail };
    if (done > 0 || days.some((d) => hasActivity(daily.days[d]))) return { status: "started", label: "In progress", detail };
    return { status: "new", label: "Not started", detail };
  }
  const s = noteStatus({ slug: t.id, questions: t.questions }, p);
  const solved = t.questions.filter((q) => p.questions[q]?.solvedAt).length;
  const detail = t.questions.length ? `${solved} of ${plural(t.questions.length, "question")} solved` : "No linked questions";
  return s === "learned" ? { status: "learned", label: "Learned", detail } : s === "read" ? { status: "started", label: "Read", detail } : { status: "new", label: "Not started", detail };
}

// ── Search and filters ───────────────────────────────────────────────────
export interface TopicFilter {
  q: string;
  subject: Subject | "all";
  level: string;
  type: ResourceType | "all";
  /** A category slug within the chosen subject, or "all". */
  category: string;
}
export const NO_FILTER: TopicFilter = { q: "", subject: "all", level: "all", type: "all", category: "all" };
export const isFiltered = (f: TopicFilter) => f.q.trim() !== "" || f.subject !== "all" || f.level !== "all" || f.type !== "all" || f.category !== "all";

/** Rank for a search: title starts with it, title contains it, category, then description. 0 means no match. */
function score(t: TopicLite, tokens: string[], phrase: string): number {
  const title = t.title.toLowerCase();
  const cat = t.categoryLabel.toLowerCase();
  const desc = t.description.toLowerCase();
  if (!tokens.every((k) => title.includes(k) || cat.includes(k) || desc.includes(k) || t.id.includes(k))) return 0;
  let s = 1;
  if (title.startsWith(phrase)) s += 60;
  else if (title.includes(phrase)) s += 40;
  for (const k of tokens) { if (title.includes(k)) s += 6; if (cat.includes(k)) s += 3; }
  return s;
}

/**
 * With nothing typed, "All subjects" would open on one subject's alphabetical start. Instead: easier topics first, topics
 * with nothing to read first before the ones that build on them, and the four subjects taking turns.
 */
export function discoveryOrder(topics: TopicLite[]): TopicLite[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const depthOf = (t: TopicLite, seen = new Set<string>()): number => {
    const known = depth.get(t.id);
    if (known !== undefined) return known;
    if (seen.has(t.id)) return 0;
    seen.add(t.id);
    const d = t.prerequisites.reduce((m, p) => { const x = byId.get(p); return x ? Math.max(m, depthOf(x, seen) + 1) : m; }, 0);
    depth.set(t.id, d);
    return d;
  };
  const rank = (l: string) => LEVELS.indexOf(l as (typeof LEVELS)[number]);
  const position = new Map(topics.map((t, i) => [t.id, i]));
  const sorted = [...topics].sort((a, b) => rank(a.level) - rank(b.level) || depthOf(a) - depthOf(b) || position.get(a.id)! - position.get(b.id)!);
  // Within each level, take one topic from each subject in turn.
  const out: TopicLite[] = [];
  for (const level of LEVELS) {
    const queues = SUBJECTS.map((s) => sorted.filter((t) => t.level === level && t.subject === s.id));
    for (let i = 0; queues.some((q) => i < q.length); i++) for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out.length === topics.length ? out : sorted;
}

export function filterTopics(topics: TopicLite[], f: TopicFilter): TopicLite[] {
  const phrase = f.q.trim().toLowerCase();
  const tokens = phrase.split(/\s+/).filter(Boolean);
  const kept = topics.filter((t) =>
    (f.subject === "all" || t.subject === f.subject) &&
    (f.level === "all" || t.level === f.level) &&
    (f.category === "all" || t.category === f.category) &&
    (f.type === "all" || t.n[f.type] > 0),
  );
  if (!tokens.length) return f.subject === "all" && f.category === "all" ? discoveryOrder(kept) : kept;
  return kept.map((t) => ({ t, s: score(t, tokens, phrase) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.t);
}

/** Categories offered in the Topic filter for a subject, in curriculum order. */
export function categoriesFor(topics: TopicLite[], subject: Subject | "all"): { slug: string; label: string; count: number }[] {
  const out = new Map<string, { slug: string; label: string; count: number }>();
  for (const t of topics) {
    if (subject !== "all" && t.subject !== subject) continue;
    const row = out.get(t.category) ?? { slug: t.category, label: t.categoryLabel, count: 0 };
    row.count++;
    out.set(t.category, row);
  }
  return [...out.values()];
}

// ── Topic page bundle ────────────────────────────────────────────────────
export interface TopicRef { id: string; title: string; level: string; kind: "note" | "module" }

export interface TopicBundle {
  topic: HubTopic;
  prerequisites: TopicRef[];
  /** Topics that list this one as a prerequisite. */
  unlocks: TopicRef[];
  related: TopicRef[];
  guides: { slug: string; title: string }[];
  patterns: { slug: string; title: string; difficulty: string }[];
  maps: { slug: string; title: string }[];
  questions: { number: number; slug: string; title: string; difficulty: string }[];
  exercises: { slug: string; title: string; difficulty: string; code: string }[];
  projects: { slug: string; title: string; level: string; minutes: number }[];
  /** Daily Learning phases that teach the topic. `href` opens the phase's first lesson. */
  daily: { id: string; title: string; path: string; firstDay: number; lastDay: number; lessons: number; minutes: number; href: string; days: string[] }[];
  /** A few real exercises the unified workspace opens for this topic (3 to 5 when the topic has that many), easiest first. Empty when none exist. */
  workspace: PracticeItem[];
  /** The note's own "Interview questions" section and any interview sets that contain the topic's questions. */
  interview: { href: string; label: string; sets: { slug: string; title: string; shared: number }[] } | null;
}

export interface BundleInputs {
  topics: HubTopic[];
  notes: NoteMeta[];
  patterns: PatternMeta[];
  guides: { slug: string; title: string }[];
  maps: { slug: string; title: string }[];
  index: QuestionSummary[];
  exercises: PyExerciseMeta[];
  projects: ProjectMeta[];
  /** Interview sets with the question slugs they contain. */
  sets: { slug: string; title: string; questions: string[] }[];
}

export function buildBundle(id: string, i: BundleInputs): TopicBundle | null {
  const topic = i.topics.find((t) => t.id === id);
  if (!topic) return null;
  const ref = (s: string): TopicRef | null => {
    const t = i.topics.find((x) => x.id === s);
    return t ? { id: t.id, title: t.title, level: t.level, kind: t.kind } : null;
  };
  const pick = <T,>(slugs: string[], from: T[], key: (x: T) => string) => slugs.map((s) => from.find((x) => key(x) === s)).filter((x): x is T => !!x);
  const questions = topic.questions.map((n) => i.index.find((q) => q.number === n)).filter((q): q is QuestionSummary => !!q);
  const qSlugs = new Set(questions.map((q) => q.slug));
  const sets = i.sets.map((s) => ({ slug: s.slug, title: s.title, shared: s.questions.filter((q) => qSlugs.has(q)).length })).filter((s) => s.shared > 0);
  const interview = topic.kind === "note"
    ? { href: `/notes/${topic.id}#interview-questions`, label: "Interview questions in the note", sets }
    : topic.id === "analyst-interview" ? { href: "/interview/data-analyst", label: "Data analyst interview set", sets: [] } : null;
  const prerequisites = topic.prerequisites.map(ref).filter((r): r is TopicRef => !!r);
  const unlocks = i.topics.filter((t) => t.prerequisites.includes(topic.id)).map((t) => ref(t.id)!);
  // A topic already listed as read-first or leads-to is not listed again as related.
  const placed = new Set([...prerequisites, ...unlocks].map((r) => r.id));
  const exercises = topic.exercises.map((s) => i.exercises.find((e) => e.slug === s)).filter((e): e is PyExerciseMeta => !!e);
  const dailyItems: PracticeItem[] = (DAILY_TOPIC_EXERCISES[topic.id] ?? []).flatMap((id) => {
    const domain = domainOfId(id);
    const title = DAILY_EXERCISE_TITLES[id];
    return domain && title ? [{ id, title, difficulty: id.includes("#g") ? ("Easy" as const) : ("Medium" as const), domain }] : [];
  });
  const workspace = pickPractice(
    questions.map((q) => ({ id: sqlId(q.slug), title: q.title, difficulty: practiceDifficulty(q.difficulty), domain: "sql" as const })),
    exercises.map((e) => ({ id: pyId(e.slug), title: e.title, difficulty: practiceDifficulty(e.difficulty), domain: "python" as const })),
    dailyItems,
  );
  return {
    topic,
    prerequisites,
    unlocks,
    related: topic.related.map(ref).filter((r): r is TopicRef => !!r && !placed.has(r.id)),
    guides: pick(topic.guides, i.guides, (g) => g.slug).map(({ slug, title }) => ({ slug, title })),
    patterns: pick(topic.patterns, i.patterns, (p) => p.slug).map(({ slug, title, difficulty }) => ({ slug, title, difficulty })),
    maps: pick(topic.maps, i.maps, (m) => m.slug).map(({ slug, title }) => ({ slug, title })),
    questions: questions.map(({ number, slug, title, difficulty }) => ({ number, slug, title, difficulty })),
    exercises: pick(topic.exercises, i.exercises, (e) => e.slug).map(({ slug, title, difficulty, code }) => ({ slug, title, difficulty, code })),
    projects: pick(topic.projects, i.projects, (p) => p.slug).map(({ slug, title, level, minutes }) => ({ slug, title, level, minutes })),
    daily: topic.phases.flatMap((pid) => {
      const p = PHASE_BY_ID.get(pid);
      const days = phaseDays(pid);
      return p && days.length ? [{ id: p.id, title: p.title, path: p.path, firstDay: p.firstDay, lastDay: p.lastDay, lessons: days.length, minutes: days.reduce((s, d) => s + d.minutes, 0), href: dayHref(days[0]), days: days.map((d) => d.id) }] : [];
    }),
    workspace,
    interview,
  };
}
