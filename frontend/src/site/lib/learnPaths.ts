/**
 * Learning paths, the curriculum roadmap, the continue card and explainable recommendations for the Learn hub.
 *
 * A path is a view over data DataForge already has: its lessons are Daily Learning phases (real lessons, real planned minutes),
 * its notes are note categories, its final project is one of the 12 guided projects. Progress is each learner's own record
 * (Daily days completed, notes read, questions solved). Nothing is blended into one made-up percentage and nothing is
 * counted because a page was opened. Pure functions, no React.
 */
import { BRANCH_DAYS, COMMON_DAYS, CURRICULUM, PHASE_BY_ID, dayHref, isAuthored, type BranchId, type DayMeta, type PathId as DailyPathId } from "./daily";
import { hasActivity, isDone, type DailyState } from "./dailyProgress";
import type { dailyResume } from "./dailyResume";
import type { LessonSummary } from "../types";
import { projectStatus, type ProjectMeta, type ProjectProgress, type ProjectStatus } from "./projects";
import type { Task } from "./tasks";
import type { Progress } from "./progress";
import { LEVELS, PHASE_LEVEL, topicProgress, type Subject, type TopicLite } from "./learnTopics";

export type PathId = "sql-developer" | "python-for-data" | "data-analyst" | "data-engineer";

export interface PracticeRef { label: string; to: string; desc: string }

export interface PathDef {
  id: PathId;
  title: string;
  subject: Subject;
  tagline: string;
  objectives: string[];
  prerequisites: string[];
  /** Daily Learning phases that make up the path, in order. */
  phases: string[];
  /** Specialisation path whose lessons these are; it builds on the 90-day common core. */
  branch?: BranchId;
  /** Note categories that support the path. */
  noteCategories: string[];
  /** Slug of the final project (one of the guided projects). */
  project: string;
  practice: PracticeRef[];
  /** The free 18-lesson SQL course is an alternative start for this path. */
  sqlCourse?: boolean;
}

const SQL_NOTES = ["fundamentals", "joins", "aggregations", "subqueries", "ctes", "window-functions", "set-operators", "advanced-sql"];

export const LEARN_PATHS: PathDef[] = [
  {
    id: "sql-developer", title: "SQL Developer", subject: "sql", sqlCourse: true,
    tagline: "From SELECT to window functions, plans and indexes, on a real PostgreSQL database.",
    objectives: [
      "Query a relational database with SELECT, filters, joins and subqueries, and change data safely.",
      "Use CTEs, window functions and set operators for analysis.",
      "Read query plans and optimise queries.",
      "Solve interview-style SQL questions graded on real results.",
    ],
    prerequisites: [
      "None for the free SQL course: it starts from SELECT.",
      "The Daily SQL lessons are Days 31 to 60 of the programme and list the earlier days as prerequisites.",
    ],
    phases: ["sql-fundamentals", "sql-advanced"], noteCategories: SQL_NOTES, project: "hr-analytics-warehouse",
    practice: [
      { label: "SQL practice", to: "/questions", desc: "Graded questions on the Northwind database" },
      { label: "SQL query visualizer", to: "/query-visualizer", desc: "Watch a query run on real rows" },
      { label: "SQL playground", to: "/playground", desc: "Six practice databases" },
    ],
  },
  {
    id: "python-for-data", title: "Python for Data", subject: "python",
    tagline: "Python, testing, NumPy and pandas, with code that runs in your browser.",
    objectives: [
      "Write and run small programs: values, control flow, collections and functions.",
      "Write reusable, robust programs and work from the command line with Git.",
      "Write automated tests so changes to code are safe.",
      "Load, clean, reshape and summarise tabular data with NumPy and pandas.",
    ],
    prerequisites: ["None. Day 1 installs Python and runs a first script."],
    phases: ["python-fundamentals", "python-intermediate", "python-testing", "numpy", "pandas"], noteCategories: ["python"], project: "python-data-cleaning",
    practice: [
      { label: "Python practice", to: "/practice/python", desc: "Problems that run and are checked in your browser" },
      { label: "Python assessment", to: "/practice/python/assessment", desc: "Timed, three problems" },
      { label: "Code time machine", to: "/visual/python", desc: "Step through code and watch variables change" },
    ],
  },
  {
    id: "data-analyst", title: "Data Analyst", subject: "analytics", branch: "analyst",
    tagline: "Excel, statistics, EDA, charts and Power BI, finished with an analytics project.",
    objectives: [
      "Analyse and report in Excel: formulas, lookups, PivotTables and Power Query.",
      "Explore a new dataset systematically and communicate the findings.",
      "Choose and build clear charts, then build a Power BI model, DAX and dashboard.",
      "Apply analysis to realistic business problems and practise analyst interview questions.",
      "Deliver one complete analytics project from raw data to a presentation.",
    ],
    prerequisites: ["The 90-day common core (Days 1 to 90): Python, SQL, NumPy, pandas and statistics foundations."],
    phases: CURRICULUM.phases.filter((p) => p.path === "analyst").map((p) => p.id), noteCategories: ["fundamentals", "joins", "aggregations", "window-functions", "python"], project: "sales-analytics-pipeline",
    practice: [
      { label: "SQL practice", to: "/questions", desc: "Graded questions on the Northwind database" },
      { label: "Business scenarios", to: "/scenarios", desc: "Realistic business problems with data" },
      { label: "Data profiler", to: "/data-profiler", desc: "Profile your own CSV in the browser" },
    ],
  },
  {
    id: "data-engineer", title: "Data Engineer", subject: "engineering", branch: "engineer",
    tagline: "Pipelines, quality checks, warehousing, Airflow and Spark, ending with a full pipeline.",
    objectives: [
      "Load files and REST APIs into PostgreSQL reliably.",
      "Design batch pipelines that can be re-run safely, and prove the data is correct.",
      "Model data for analytics and build a warehouse in PostgreSQL.",
      "Schedule and monitor pipelines with Airflow, and process larger data with Spark.",
      "Deliver a complete pipeline from source to analytics.",
    ],
    prerequisites: ["The 90-day common core (Days 1 to 90): Python, SQL, NumPy, pandas and statistics foundations."],
    phases: CURRICULUM.phases.filter((p) => p.path === "engineer").map((p) => p.id), noteCategories: ["etl", "warehousing", "airflow", "spark", "dbt", "cloud"], project: "end-to-end-pipeline",
    practice: [
      { label: "ETL pipeline builder", to: "/etl-builder", desc: "Source to load, with previews and logs" },
      { label: "DAG simulator", to: "/dag-simulator", desc: "Retries, failures and Airflow concepts" },
      { label: "Data quality exercises", to: "/dq-exercises", desc: "Five dimensions, before and after score" },
      { label: "Pipeline debugging lab", to: "/debug-lab", desc: "Fix broken data pipelines" },
    ],
  },
];

export const pathById = (id: string) => LEARN_PATHS.find((p) => p.id === id);

/** "Expert" notes are shown as Advanced: the brief and the UI use three levels. */
export const levelClass = (level: string) => (level === "Expert" ? "Advanced" : level);

export function levelRange(levels: string[]): { levels: string[]; label: string } {
  const set = new Set(levels.map(levelClass));
  const ordered = LEVELS.filter((l) => l !== "Expert" && set.has(l));
  if (!ordered.length) return { levels: [], label: "" };
  return { levels: ordered, label: ordered.length === 1 ? ordered[0] : `${ordered[0]} to ${ordered[ordered.length - 1]}` };
}

// ── Path model ───────────────────────────────────────────────────────────
export interface StageModel {
  id: string;
  title: string;
  summary: string;
  days: DayMeta[];
  done: number;
  minutes: number;
  /** First lesson not yet completed (or the first lesson when none is done). */
  href: string;
}

export interface NextStep {
  kind: "daily" | "course" | "project";
  title: string;
  detail: string;
  to: string;
  /** A fact from the learner's own record that explains the suggestion. */
  reason: string;
}

export interface PathContext {
  daily: DailyState;
  masteredIds: ReadonlySet<string>;
  progress: Pick<Progress, "read" | "questions" | "lessons">;
  topics: TopicLite[];
  lessons: LessonSummary[];
  projects: ProjectMeta[];
  projectTasks: { slug: string; tasks: Task[] }[];
  projectProgress: (slug: string) => ProjectProgress;
}

export interface CourseModel { lessons: LessonSummary[]; doneEx: number; totalEx: number; lessonsDone: number; next?: LessonSummary }

export interface PathModel {
  def: PathDef;
  stages: StageModel[];
  lessons: number;
  done: number;
  mastered: number;
  percent: number;
  minutes: number;
  remainingMinutes: number;
  core: { done: number; total: number } | null;
  levels: string[];
  levelLabel: string;
  notes: { category: string; label: string; read: number; total: number }[];
  next: NextStep | null;
  course: CourseModel | null;
  project: { meta: ProjectMeta; status: ProjectStatus } | null;
  /** Any lesson, course exercise or read note of this path has been worked on. */
  started: boolean;
}

const exKey = (slug: string, i: number) => `${slug}#${i}`;

export function courseModel(lessons: LessonSummary[], done: Record<string, string> | undefined): CourseModel {
  let doneEx = 0, totalEx = 0, lessonsDone = 0;
  let next: LessonSummary | undefined;
  for (const l of lessons) {
    let n = 0;
    for (let i = 0; i < l.exercises; i++) if (done?.[exKey(l.slug, i)]) n++;
    doneEx += n; totalEx += l.exercises;
    if (l.exercises > 0 && n === l.exercises) lessonsDone++;
    else if (l.exercises > 0 && !next) next = l;
  }
  return { lessons, doneEx, totalEx, lessonsDone, next };
}

const sumMinutes = (days: DayMeta[]) => days.reduce((s, d) => s + d.minutes, 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const authored = (days: DayMeta[]) => days.filter((d) => isAuthored(d.id));

/** The path's own lessons, in curriculum order. */
export function spineOf(def: PathDef): DayMeta[] {
  return authored(CURRICULUM.days.filter((d) => def.phases.includes(d.phase)));
}

export function pathModel(def: PathDef, ctx: PathContext): PathModel {
  const { daily } = ctx;
  const days = spineOf(def);
  const stages: StageModel[] = def.phases.flatMap((pid) => {
    const p = PHASE_BY_ID.get(pid);
    const sd = days.filter((d) => d.phase === pid);
    if (!p || !sd.length) return [];
    const first = sd.find((d) => !isDone(daily, d.id)) ?? sd[0];
    return [{ id: pid, title: p.title, summary: p.summary, days: sd, done: sd.filter((d) => isDone(daily, d.id)).length, minutes: sumMinutes(sd), href: dayHref(first) }];
  });
  const done = days.filter((d) => isDone(daily, d.id)).length;
  const coreDays = def.branch ? authored(COMMON_DAYS) : [];
  const coreDone = coreDays.filter((d) => isDone(daily, d.id)).length;
  const notes = def.noteCategories.map((c) => {
    const ts = ctx.topics.filter((t) => t.kind === "note" && t.category === c);
    return { category: c, label: ts[0]?.categoryLabel ?? c, read: ts.filter((t) => ctx.progress.read?.[t.id]).length, total: ts.length };
  }).filter((n) => n.total > 0);

  // The classification is the range of the path's own phases (PHASE_LEVEL), plus the SQL course's lesson levels for the SQL path.
  const lv = [
    ...def.phases.map((p) => PHASE_LEVEL[p]).filter(Boolean),
    ...(def.sqlCourse ? ctx.lessons.map((l) => l.level) : []),
  ];
  const range = levelRange(lv);
  const course = def.sqlCourse ? courseModel(ctx.lessons, ctx.progress.lessons) : null;

  const meta = ctx.projects.find((p) => p.slug === def.project);
  const tasks = ctx.projectTasks.find((p) => p.slug === def.project)?.tasks;
  const project = meta && tasks ? { meta, status: projectStatus({ tasks }, ctx.projectProgress(def.project)) } : meta ? { meta, status: "Not started" as ProjectStatus } : null;

  const order = [...coreDays, ...days];
  const nextDay = order.find((d) => !isDone(daily, d.id));
  const spineActive = days.some((d) => hasActivity(daily.days[d.id]));
  const coreActive = coreDays.some((d) => hasActivity(daily.days[d.id]));

  let next: NextStep | null = null;
  const courseStarted = !!course && course.doneEx > 0;
  if (course?.next && (courseStarted || (!spineActive && !coreActive))) {
    next = {
      kind: "course", title: course.next.title, detail: `Course lesson ${course.next.order}`, to: `/learn/${course.next.slug}`,
      reason: courseStarted ? `You have passed ${course.doneEx} of ${plural(course.totalEx, "course exercise")}.` : "No prior knowledge is needed: the free course starts from SELECT.",
    };
  } else if (nextDay) {
    const rec = daily.days[nextDay.id];
    const reason = hasActivity(rec) ? "You started this lesson and have not completed it."
      : def.branch && nextDay.path === "common" ? `The common core comes first; this path builds on it (${coreDone} of ${coreDays.length} core lessons completed).`
      : done === 0 ? "The first lesson of this path."
      : `You have completed ${done} of ${plural(days.length, "lesson")} in this path.`;
    next = { kind: "daily", title: nextDay.title, detail: `Day ${nextDay.day}`, to: dayHref(nextDay), reason };
  } else if (project) {
    next = { kind: "project", title: project.meta.title, detail: "Final project", to: `/projects-lab/${project.meta.slug}`, reason: `You completed all ${plural(days.length, "lesson")} in this path.` };
  }

  const started = done > 0 || spineActive || courseStarted || notes.some((n) => n.read > 0);
  return {
    def, stages, lessons: days.length, done, mastered: days.filter((d) => isDone(daily, d.id) && ctx.masteredIds.has(d.id)).length,
    percent: days.length ? Math.round((100 * done) / days.length) : 0,
    minutes: sumMinutes(days), remainingMinutes: sumMinutes(days.filter((d) => !isDone(daily, d.id))),
    core: def.branch ? { done: coreDone, total: coreDays.length } : null,
    levels: range.levels, levelLabel: range.label, notes, next, course, project, started,
  };
}

export const hoursLabel = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`);


// ── Curriculum roadmap ───────────────────────────────────────────────────
export interface RoadmapPhase {
  id: string;
  title: string;
  summary: string;
  firstDay: number;
  lastDay: number;
  lessons: number;
  minutes: number;
  done: number;
  status: "not-started" | "in-progress" | "completed";
  href: string;
}

export type RoadmapPath = DailyPathId;

export function roadmapPhases(path: RoadmapPath, daily: DailyState): RoadmapPhase[] {
  return CURRICULUM.phases
    .filter((p) => p.path === path)
    .sort((a, b) => a.firstDay - b.firstDay)
    .flatMap((p) => {
      const days = authored((path === "common" ? COMMON_DAYS : BRANCH_DAYS[path]).filter((d) => d.phase === p.id));
      if (!days.length) return [];
      const done = days.filter((d) => isDone(daily, d.id)).length;
      const first = days.find((d) => !isDone(daily, d.id)) ?? days[0];
      const active = done > 0 || days.some((d) => hasActivity(daily.days[d.id]));
      return [{
        id: p.id, title: p.title, summary: p.summary, firstDay: p.firstDay, lastDay: p.lastDay, lessons: days.length, minutes: sumMinutes(days), done,
        status: done === days.length ? "completed" : active ? "in-progress" : "not-started", href: dayHref(first),
      } as RoadmapPhase];
    });
}

// ── Continue learning ────────────────────────────────────────────────────
export interface ContinueTarget {
  kind: "daily" | "course" | "note" | "pattern" | "map";
  /** What the learner did last, e.g. "You were on". */
  title: string;
  to: string;
  where: string;
  /** ISO time of the learner's last action here. */
  at: string;
  /** True when the lesson was started but not completed. */
  unfinished: boolean;
}

const RECENT_KIND: Record<string, { kind: ContinueTarget["kind"]; where: string }> = {
  note: { kind: "note", where: "Theory note" }, pattern: { kind: "pattern", where: "Pattern" }, map: { kind: "map", where: "Mind map" },
};

/**
 * Where the learner left off: the most recent of their Daily lesson, SQL course exercise and last opened note, pattern or map.
 * Null for a learner with no activity (the hub then shows a start prompt, never a made-up resume).
 */
export function continueTarget(i: { resume: ReturnType<typeof dailyResume>; daily: DailyState; progress: Pick<Progress, "recent" | "lessons">; lessons: LessonSummary[] }): ContinueTarget | null {
  const out: ContinueTarget[] = [];
  const { last, lastDone, next } = i.resume;
  if (last && !lastDone) {
    const at = i.daily.days[last.id]?.lastVisit;
    if (at) out.push({ kind: "daily", title: `Day ${last.day}: ${last.title}`, to: dayHref(last), where: "Daily Learning", at, unfinished: true });
  } else if (last && lastDone && next) {
    const at = i.daily.days[last.id]?.completedAt;
    if (at) out.push({ kind: "daily", title: `Day ${next.day}: ${next.title}`, to: dayHref(next), where: "Daily Learning, next lesson", at, unfinished: false });
  }
  const r = i.progress.recent?.[0];
  const rk = r && RECENT_KIND[r.key.split(":")[0]];
  if (r && rk) out.push({ kind: rk.kind, title: r.title, to: r.path, where: rk.where, at: r.at, unfinished: false });

  // SQL course: the lesson of the most recently passed exercise, or the next lesson when that one is complete.
  const passed = Object.entries(i.progress.lessons ?? {}).filter(([k]) => !k.startsWith("py:") && k.includes("#"));
  if (passed.length) {
    const [key, at] = passed.reduce((a, b) => (b[1] > a[1] ? b : a));
    const slug = key.split("#")[0];
    const idx = i.lessons.findIndex((l) => l.slug === slug);
    const course = courseModel(i.lessons, i.progress.lessons);
    if (idx >= 0) {
      const l = i.lessons[idx];
      const target = course.next ?? l;
      out.push({ kind: "course", title: target.title, to: `/learn/${target.slug}`, where: `SQL course, lesson ${target.order}`, at, unfinished: !!course.next });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

// ── Recommendations ──────────────────────────────────────────────────────
export interface Recommendation {
  id: string;
  kind: "finish" | "missed" | "practice" | "next";
  title: string;
  to: string;
  /** The fact from the learner's own record that this suggestion rests on. */
  reason: string;
}

/**
 * Up to three suggestions, each quoting the evidence behind it. A learner with no activity gets none.
 *  finish   a Daily lesson opened and not completed
 *  missed   a question attempted twice or more and still unsolved, with the note that covers it
 *  practice a note marked read whose linked questions are mostly unsolved
 *  next     the next unread note in a category the learner already started, whose prerequisites they have read
 */
export function recommend(i: { topics: TopicLite[]; progress: Pick<Progress, "read" | "questions">; resume: ReturnType<typeof dailyResume>; limit?: number }): Recommendation[] {
  const out: Recommendation[] = [];
  const seen = new Set<string>();
  const add = (r: Recommendation, topicId?: string) => {
    if (topicId) { if (seen.has(topicId)) return; seen.add(topicId); }
    out.push(r);
  };
  const { last, lastDone } = i.resume;
  if (last && !lastDone) add({ id: `finish-${last.id}`, kind: "finish", title: `Finish Day ${last.day}: ${last.title}`, to: dayHref(last), reason: `You opened Day ${last.day} and have not completed it.` });

  const notes = i.topics.filter((t) => t.kind === "note");
  const solved = (n: number) => !!i.progress.questions[n]?.solvedAt;
  const attempts = Object.entries(i.progress.questions)
    .map(([num, q]) => ({ num: Number(num), attempts: q.attempts ?? 0, done: !!q.solvedAt }))
    .filter((q) => q.attempts >= 2 && !q.done)
    .sort((a, b) => b.attempts - a.attempts);
  for (const q of attempts) {
    const t = notes.find((n) => n.questions.includes(q.num));
    if (t) add({ id: `missed-${q.num}`, kind: "missed", title: `Review ${t.title}`, to: `/learn/topic/${t.id}`, reason: `You attempted question ${q.num} ${q.attempts} times without solving it; this topic covers it.` }, t.id);
  }

  const gaps = notes
    .filter((t) => i.progress.read?.[t.id] && t.questions.length > 0 && t.questions.filter(solved).length * 2 < t.questions.length)
    .map((t) => ({ t, solved: t.questions.filter(solved).length, at: i.progress.read![t.id] }))
    .sort((a, b) => a.solved / a.t.questions.length - b.solved / b.t.questions.length || b.at.localeCompare(a.at));
  for (const g of gaps) add({ id: `practice-${g.t.id}`, kind: "practice", title: `Practise ${g.t.title}`, to: `/learn/topic/${g.t.id}`, reason: `You read this note but solved ${g.solved} of ${plural(g.t.questions.length, "linked question")}.` }, g.t.id);

  const categories = [...new Set(notes.map((t) => t.category))];
  for (const c of categories) {
    const inCat = notes.filter((t) => t.category === c);
    const read = inCat.filter((t) => i.progress.read?.[t.id]).length;
    if (read === 0 || read === inCat.length) continue;
    const nextTopic = inCat.find((t) => !i.progress.read?.[t.id] && t.prerequisites.every((p) => i.progress.read?.[p]));
    if (nextTopic) add({ id: `next-${nextTopic.id}`, kind: "next", title: `Read ${nextTopic.title}`, to: `/learn/topic/${nextTopic.id}`, reason: `You have read ${read} of ${plural(inCat.length, "topic")} in ${nextTopic.categoryLabel}; its prerequisites are done.` }, nextTopic.id);
  }
  return out.slice(0, i.limit ?? 3);
}

/** Status line for a topic in a path's note list (kept here so the path page and the library agree). */
export { topicProgress };
