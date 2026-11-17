// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import indexJson from "../../public/data/index.json";
import { loadAllGuides, loadAllSets } from "../site/lib/content";
import { loadAllMaps, loadAllNotes, loadNoteIndex, loadPatternIndex, slugifyHeading } from "../site/lib/learning";
import { loadExerciseIndex } from "../site/lib/pyExercises";
import { loadProjectIndex } from "../site/lib/projects";
import { CURRICULUM, isAuthored } from "../site/lib/daily";
import type { QuestionSummary } from "../site/types";
import {
  ALL_VISUAL_ROUTES, ANALYTICS_MODULES, NO_FILTER, PHASE_LEVEL, discoveryOrder, durationLabel, topicEyebrow, SUBJECTS, buildBundle, buildTopics, categoriesFor, filterTopics, isFiltered, mapIndex, subjectOfCategory, toLite, topicProgress,
  type HubTopic, type TopicLite,
} from "../site/lib/learnTopics";

const ROUTES = [...readFileSync(join(__dirname, "..", "site", "routes.tsx"), "utf8").matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
const routeExists = (to: string) => ROUTES.some((r) => new RegExp(`^${r.replace(/:[^/]+/g, "[^/]+")}$`).test(to));

let topics: HubTopic[];
let lite: TopicLite[];
let notes: Awaited<ReturnType<typeof loadNoteIndex>>;
let exercises: Awaited<ReturnType<typeof loadExerciseIndex>>;

beforeAll(async () => {
  notes = await loadNoteIndex();
  exercises = await loadExerciseIndex();
  topics = buildTopics({ notes, patterns: await loadPatternIndex(), mapsByNote: mapIndex(await loadAllMaps()), exercises });
  lite = topics.map(toLite);
});

describe("topic library data", () => {
  it("one topic per note plus the analytics modules, with unique ids", () => {
    expect(topics.filter((t) => t.kind === "note")).toHaveLength(notes.length);
    expect(topics.filter((t) => t.kind === "module")).toHaveLength(ANALYTICS_MODULES.length);
    expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length);
  });

  it("covers the four subjects, and Data Analytics is not empty", () => {
    for (const s of SUBJECTS) expect(topics.filter((t) => t.subject === s.id).length, s.label).toBeGreaterThan(0);
    expect(subjectOfCategory("joins")).toBe("sql");
    expect(subjectOfCategory("python")).toBe("python");
    expect(subjectOfCategory("airflow")).toBe("engineering");
  });

  it("every analytics module is a real, authored phase with a level", () => {
    for (const m of ANALYTICS_MODULES) {
      const phase = CURRICULUM.phases.find((p) => p.id === m.phase);
      expect(phase, m.phase).toBeTruthy();
      expect(["Beginner", "Intermediate", "Advanced"]).toContain(m.level);
      expect(CURRICULUM.days.some((d) => d.phase === m.phase && isAuthored(d.id)), m.phase).toBe(true);
    }
  });

  it("only links to resources that exist", () => {
    const slugs = new Set(topics.map((t) => t.id));
    for (const t of topics) {
      for (const s of [...t.prerequisites, ...t.related]) expect(slugs.has(s), `${t.id} -> ${s}`).toBe(true);
    }
  });

  it("every Python exercise belongs to exactly one topic", () => {
    const all = topics.flatMap((t) => t.exercises);
    expect(all.length).toBe(exercises.length);
    expect(new Set(all).size).toBe(exercises.length);
  });

  it("every visual explanation points at a real route", () => {
    for (const to of ALL_VISUAL_ROUTES) expect(routeExists(to), to).toBe(true);
  });

  it("counts in the compact projection match the full topic", () => {
    const t = topics.find((x) => x.id === "left-join")!;
    const l = lite.find((x) => x.id === "left-join")!;
    expect(l.n.practice).toBe(t.questions.length + t.exercises.length);
    expect(l.n.note).toBe(1);
    expect(lite.every((x) => x.description.length <= 170)).toBe(true);
  });
});

describe("phase levels and the default order", () => {
  it("every Daily phase has a level", () => {
    for (const p of CURRICULUM.phases) expect(["Beginner", "Intermediate", "Advanced"], p.id).toContain(PHASE_LEVEL[p.id]);
  });

  it("with nothing typed, the first page is easier topics from every subject, not one subject's alphabet", () => {
    const first = filterTopics(lite, NO_FILTER).slice(0, 8);
    expect(first.every((t) => t.level === "Beginner")).toBe(true);
    expect(new Set(first.map((t) => t.subject)).size).toBeGreaterThanOrEqual(3);
    expect(discoveryOrder(lite)).toHaveLength(lite.length);
    expect(new Set(discoveryOrder(lite).map((t) => t.id)).size).toBe(lite.length);
  });

  it("topics with nothing to read first come before the ones that build on them", () => {
    const order = filterTopics(lite, { ...NO_FILTER, subject: "all" }).map((t) => t.id);
    const intro = order.indexOf("intro-to-sql");
    const fundamentalsWithPrereq = lite.filter((t) => t.category === "fundamentals" && t.prerequisites.includes("intro-to-sql") && t.level === "Beginner").map((t) => order.indexOf(t.id));
    expect(intro).toBeGreaterThanOrEqual(0);
    for (const i of fundamentalsWithPrereq) expect(intro).toBeLessThan(i);
  });
});

describe("filters and search", () => {
  it("no filter returns everything, and reports it is not filtered", () => {
    expect(filterTopics(lite, NO_FILTER)).toHaveLength(lite.length);
    expect(isFiltered(NO_FILTER)).toBe(false);
  });

  it("filters by subject, level, resource type and category", () => {
    const sql = filterTopics(lite, { ...NO_FILTER, subject: "sql" });
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.every((t) => t.subject === "sql")).toBe(true);
    expect(filterTopics(lite, { ...NO_FILTER, level: "Advanced" }).every((t) => t.level === "Advanced")).toBe(true);
    expect(filterTopics(lite, { ...NO_FILTER, type: "project" }).every((t) => t.n.project > 0)).toBe(true);
    expect(filterTopics(lite, { ...NO_FILTER, type: "map" }).every((t) => t.n.map > 0)).toBe(true);
    const joins = filterTopics(lite, { ...NO_FILTER, subject: "sql", category: "joins" });
    expect(joins.length).toBe(lite.filter((t) => t.category === "joins").length);
    expect(isFiltered({ ...NO_FILTER, level: "Beginner" })).toBe(true);
  });

  it("filters combine, and an impossible combination is empty", () => {
    expect(filterTopics(lite, { ...NO_FILTER, subject: "analytics", type: "pattern" })).toEqual([]);
    expect(filterTopics(lite, { ...NO_FILTER, q: "zzzzqqq" })).toEqual([]);
  });

  it("search ranks a title that starts with the phrase first and ignores case", () => {
    const hits = filterTopics(lite, { ...NO_FILTER, q: "WINDOW" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title.toLowerCase()).toContain("window");
    const phrase = filterTopics(lite, { ...NO_FILTER, q: "left join" });
    expect(phrase[0].title.toLowerCase()).toContain("left join");
  });

  it("search also matches the category, so 'airflow' finds the track", () => {
    const hits = filterTopics(lite, { ...NO_FILTER, q: "airflow" });
    expect(hits.some((t) => t.category === "airflow")).toBe(true);
  });

  it("the Topic filter lists only categories of the chosen subject", () => {
    const cats = categoriesFor(lite, "engineering").map((c) => c.slug);
    expect(cats).toContain("etl");
    expect(cats).not.toContain("joins");
    expect(categoriesFor(lite, "all").length).toBeGreaterThan(cats.length);
  });
});

describe("topic progress comes from evidence, never from opening", () => {
  const withQuestions = () => lite.find((t) => t.kind === "note" && t.questions.length >= 2)!;
  const empty = { read: {}, questions: {} };

  it("a note nobody touched is not started", () => {
    expect(topicProgress(lite.find((t) => t.kind === "note")!, empty, { days: {} }).status).toBe("new");
  });

  it("read but mostly unsolved is Read, not Learned", () => {
    const t = withQuestions();
    const p = topicProgress(t, { read: { [t.id]: "2026-02-01T00:00:00Z" }, questions: {} }, { days: {} });
    expect(p.label).toBe("Read");
    expect(p.detail).toContain(`0 of ${t.questions.length}`);
  });

  it("read plus half the questions solved is Learned", () => {
    const t = withQuestions();
    const solved = Object.fromEntries(t.questions.slice(0, Math.ceil(t.questions.length / 2)).map((n) => [n, { attempts: 1, solvedAt: "2026-02-01" }]));
    expect(topicProgress(t, { read: { [t.id]: "x" }, questions: solved }, { days: {} }).label).toBe("Learned");
  });

  it("solving questions without reading the note does not make it learned", () => {
    const t = withQuestions();
    const solved = Object.fromEntries(t.questions.map((n) => [n, { attempts: 1, solvedAt: "2026-02-01" }]));
    expect(topicProgress(t, { read: {}, questions: solved }, { days: {} }).status).toBe("new");
  });

  it("a module is In progress after one completed lesson and Completed after all", () => {
    const m = lite.find((t) => t.kind === "module")!;
    const days = m.days!;
    expect(topicProgress(m, empty, { days: {} }).label).toBe("Not started");
    expect(topicProgress(m, empty, { days: { [days[0]]: { completedAt: "2026-02-01" } } }).label).toBe("In progress");
    expect(topicProgress(m, empty, { days: Object.fromEntries(days.map((d) => [d, { completedAt: "2026-02-01" }])) }).label).toBe("Completed");
    // opening a lesson (a visit with no work) changes nothing
    expect(topicProgress(m, empty, { days: { [days[0]]: { lastVisit: "2026-02-01" } } }).label).toBe("Not started");
  });
});

describe("labels", () => {
  it("does not repeat the subject in a category that already names it", () => {
    expect(topicEyebrow("sql", "SQL Fundamentals")).toBe("SQL Fundamentals");
    expect(topicEyebrow("sql", "JOINs")).toBe("SQL · JOINs");
    expect(topicEyebrow("python", "Python for Data Engineering")).toBe("Python for Data Engineering");
    expect(topicEyebrow("engineering", "Apache Spark")).toBe("Engineering · Apache Spark");
    expect(topicEyebrow("analytics", "Common core")).toBe("Analytics · Common core");
  });

  it("shows minutes for a note and hours for a phase", () => {
    expect(durationLabel(8)).toBe("8 min");
    expect(durationLabel(119)).toBe("119 min");
    expect(durationLabel(1320)).toBe("22 h");
    expect(durationLabel(660)).toBe("11 h");
  });
});

describe("topic page bundle", () => {
  it("resolves a note's own resources and links the interview section that exists", async () => {
    const [patterns, guides, maps, sets, projects] = await Promise.all([loadPatternIndex(), loadAllGuides(), loadAllMaps(), loadAllSets(), loadProjectIndex()]);
    const b = buildBundle("left-join", {
      topics, notes, patterns, guides, maps: maps.map(({ slug, title }) => ({ slug, title })), index: indexJson as QuestionSummary[], exercises, projects,
      sets: sets.map(({ slug, title, questions }) => ({ slug, title, questions })),
    })!;
    expect(b.topic.title.toLowerCase()).toContain("left join");
    expect(b.questions.length).toBeGreaterThan(0);
    expect(b.questions.every((q) => q.slug && q.title)).toBe(true);
    expect(b.interview?.href).toBe("/notes/left-join#interview-questions");
    const note = (await loadAllNotes()).find((n) => n.slug === "left-join")!;
    expect([...note.body.matchAll(/^##\s+(.+)$/gm)].map((m) => slugifyHeading(m[1]))).toContain("interview-questions");
    expect(buildBundle("nope", { topics, notes, patterns, guides, maps: [], index: [], exercises, projects, sets: [] })).toBeNull();
  });

  it("never lists a topic as related when it is already read-first or leads-to", async () => {
    const [patterns, projects] = await Promise.all([loadPatternIndex(), loadProjectIndex()]);
    const base = { topics, notes, patterns, guides: [], maps: [], index: indexJson as QuestionSummary[], exercises, projects, sets: [] };
    for (const t of topics.filter((x) => x.kind === "note").slice(0, 60)) {
      const b = buildBundle(t.id, base)!;
      const placed = new Set([...b.prerequisites, ...b.unlocks].map((r) => r.id));
      for (const r of b.related) expect(placed.has(r.id), `${t.id} lists ${r.id} twice`).toBe(false);
    }
  });

  it("a Python note lists its exercises and an analytics module lists its Daily lessons", async () => {
    const mk = async (id: string) => buildBundle(id, {
      topics, notes, patterns: await loadPatternIndex(), guides: [], maps: [], index: indexJson as QuestionSummary[], exercises, projects: await loadProjectIndex(), sets: [],
    })!;
    const py = topics.find((t) => t.kind === "note" && t.exercises.length > 0)!;
    expect((await mk(py.id)).exercises).toHaveLength(py.exercises.length);
    const excel = await mk("excel");
    expect(excel.daily).toHaveLength(1);
    expect(excel.daily[0].lessons).toBe(CURRICULUM.days.filter((d) => d.phase === "excel" && isAuthored(d.id)).length);
    expect(excel.daily[0].href).toMatch(/^\/daily\//);
    expect(excel.topic.visual.map((v) => v.to)).toContain("/visual/excel");
  });
});
