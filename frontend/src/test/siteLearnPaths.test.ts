// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { loadLessonSummaries } from "../site/lib/content";
import { CURRICULUM, COMMON_DAYS, BRANCH_DAYS, isAuthored, sequenceFor } from "../site/lib/daily";
import type { DailyState } from "../site/lib/dailyProgress";
import { dailyResume } from "../site/lib/dailyResume";
import { loadAllMaps, loadNoteIndex, loadPatternIndex, NOTE_CATEGORIES } from "../site/lib/learning";
import { loadExerciseIndex } from "../site/lib/pyExercises";
import { loadAllProjects, loadProjectIndex, type ProjectMeta } from "../site/lib/projects";
import type { Task } from "../site/lib/tasks";
import type { LessonSummary } from "../site/types";
import { buildTopics, mapIndex, toLite, type TopicLite } from "../site/lib/learnTopics";
import { LEARN_PATHS, continueTarget, courseModel, hoursLabel, levelRange, pathById, pathModel, recommend, roadmapPhases, spineOf, type PathContext } from "../site/lib/learnPaths";

let topics: TopicLite[];
let lessons: LessonSummary[];
let projects: ProjectMeta[];
let projectTasks: { slug: string; tasks: Task[] }[];

beforeAll(async () => {
  const notes = await loadNoteIndex();
  topics = buildTopics({ notes, patterns: await loadPatternIndex(), mapsByNote: mapIndex(await loadAllMaps()), exercises: await loadExerciseIndex() }).map(toLite);
  lessons = await loadLessonSummaries();
  projects = await loadProjectIndex();
  projectTasks = (await loadAllProjects()).map((p) => ({ slug: p.slug, tasks: p.tasks }));
});

const doneState = (ids: string[], extra: DailyState["days"] = {}): DailyState => ({ days: { ...Object.fromEntries(ids.map((id) => [id, { completedAt: "2026-02-01T10:00:00Z", lastVisit: "2026-02-01T10:00:00Z" }])), ...extra } });
const ctx = (daily: DailyState = { days: {} }, progress: PathContext["progress"] = { read: {}, questions: {}, lessons: {} }, masteredIds: ReadonlySet<string> = new Set()): PathContext => ({
  daily, progress, masteredIds, topics, lessons, projects, projectTasks, projectProgress: () => ({ tasks: {}, checklist: {} }),
});
const model = (id: string, c = ctx()) => pathModel(pathById(id)!, c);

describe("path definitions point only at real things", () => {
  it("has the four paths", () => {
    expect(LEARN_PATHS.map((p) => p.id)).toEqual(["sql-developer", "python-for-data", "data-analyst", "data-engineer"]);
  });

  it("every phase, note category and final project exists, and every path has objectives and prerequisites", () => {
    const phases = new Set(CURRICULUM.phases.map((p) => p.id));
    const cats = new Set(NOTE_CATEGORIES.map((c) => c.slug));
    for (const p of LEARN_PATHS) {
      expect(p.objectives.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.prerequisites.length, p.id).toBeGreaterThan(0);
      expect(p.practice.length, p.id).toBeGreaterThan(0);
      for (const ph of p.phases) expect(phases.has(ph), `${p.id}: ${ph}`).toBe(true);
      for (const c of p.noteCategories) expect(cats.has(c), `${p.id}: ${c}`).toBe(true);
      expect(projects.some((x) => x.slug === p.project), `${p.id}: ${p.project}`).toBe(true);
      expect(spineOf(p).length, p.id).toBeGreaterThan(0);
    }
  });

  it("a specialisation path's lessons are exactly its branch (90 days) and build on the 90-day common core", () => {
    expect(spineOf(pathById("data-analyst")!)).toHaveLength(BRANCH_DAYS.analyst.filter((d) => isAuthored(d.id)).length);
    expect(spineOf(pathById("data-engineer")!)).toHaveLength(BRANCH_DAYS.engineer.filter((d) => isAuthored(d.id)).length);
    expect(model("data-analyst").core).toEqual({ done: 0, total: COMMON_DAYS.length });
    expect(model("sql-developer").core).toBeNull();
  });
});

describe("path model", () => {
  it("counts real lessons and planned minutes, and a new learner has no progress", () => {
    for (const def of LEARN_PATHS) {
      const m = pathModel(def, ctx());
      const days = spineOf(def);
      expect(m.lessons).toBe(days.length);
      expect(m.minutes).toBe(days.reduce((s, d) => s + d.minutes, 0));
      expect(m.remainingMinutes).toBe(m.minutes);
      expect(m.done).toBe(0);
      expect(m.percent).toBe(0);
      expect(m.started).toBe(false);
      expect(m.stages.reduce((s, x) => s + x.days.length, 0)).toBe(days.length);
    }
  });

  it("progress counts completed lessons only; opening a lesson does not move it", () => {
    const sql = spineOf(pathById("sql-developer")!);
    const opened = model("sql-developer", ctx({ days: { [sql[0].id]: { lastVisit: "2026-02-01T10:00:00Z" } } }));
    expect(opened.done).toBe(0);
    expect(opened.started).toBe(false);
    const three = model("sql-developer", ctx(doneState(sql.slice(0, 3).map((d) => d.id))));
    expect(three.done).toBe(3);
    expect(three.percent).toBe(Math.round((100 * 3) / sql.length));
    expect(three.remainingMinutes).toBe(three.minutes - sql.slice(0, 3).reduce((s, d) => s + d.minutes, 0));
    expect(three.started).toBe(true);
  });

  it("mastered counts only completed lessons that are also mastered", () => {
    const sql = spineOf(pathById("sql-developer")!);
    const m = model("sql-developer", ctx(doneState([sql[0].id, sql[1].id]), { read: {}, questions: {}, lessons: {} }, new Set([sql[0].id, sql[5].id])));
    expect(m.mastered).toBe(1);
  });

  it("a branch path counts the common core as a prerequisite, separately from the path's own progress", () => {
    const core = COMMON_DAYS.slice(0, 10).map((d) => d.id);
    const m = model("data-engineer", ctx(doneState(core)));
    expect(m.core).toEqual({ done: 10, total: COMMON_DAYS.length });
    expect(m.done).toBe(0);
  });

  it("level range is derived from the content and never exceeds three levels", () => {
    expect(model("sql-developer").levelLabel).toBe("Beginner to Advanced");
    expect(model("python-for-data").levelLabel).toBe("Beginner to Intermediate");
    expect(model("data-engineer").levelLabel).toBe("Intermediate to Advanced");
    expect(new Set(LEARN_PATHS.map((p) => model(p.id).levelLabel)).size).toBeGreaterThan(2);
    expect(levelRange(["Beginner", "Expert"]).label).toBe("Beginner to Advanced");
    expect(levelRange(["Intermediate"]).label).toBe("Intermediate");
    expect(levelRange([]).label).toBe("");
    for (const def of LEARN_PATHS) expect(model(def.id).levels.length, def.id).toBeGreaterThan(0);
  });

  it("the final project status comes from the project's own progress", () => {
    const m = model("data-engineer");
    expect(m.project?.meta.slug).toBe("end-to-end-pipeline");
    expect(m.project?.status).toBe("Not started");
  });

  it("note progress counts only notes marked read", () => {
    const sqlNote = topics.find((t) => t.kind === "note" && t.category === "joins")!;
    const m = model("sql-developer", ctx({ days: {} }, { read: { [sqlNote.id]: "2026-02-01" }, questions: {}, lessons: {} }));
    expect(m.notes.find((n) => n.category === "joins")!.read).toBe(1);
    expect(m.started).toBe(true);
  });
});

describe("recommended next lesson, with a reason from the learner's record", () => {
  it("a new SQL learner is sent to the first course lesson, because it needs no prior knowledge", () => {
    const n = model("sql-developer").next!;
    expect(n.kind).toBe("course");
    expect(n.to).toBe(`/learn/${lessons[0].slug}`);
    expect(n.reason).toMatch(/SELECT/);
  });

  it("a new Python learner starts at Day 1", () => {
    const n = model("python-for-data").next!;
    expect(n.to).toBe("/daily/day/1");
    expect(n.reason).toMatch(/first lesson/i);
  });

  it("a new analyst starts in the common core and is told why", () => {
    const n = model("data-analyst").next!;
    expect(n.to).toBe("/daily/day/1");
    expect(n.reason).toMatch(/common core/i);
    expect(n.reason).toContain(`0 of ${COMMON_DAYS.length}`);
  });

  it("after the core the analyst path continues with its own first lesson", () => {
    const n = model("data-analyst", ctx(doneState(COMMON_DAYS.map((d) => d.id)))).next!;
    expect(n.to).toBe(`/daily/analyst/day/${BRANCH_DAYS.analyst[0].day}`);
  });

  it("a lesson with work but no completion is reported as started", () => {
    const first = spineOf(pathById("python-for-data")!)[0];
    const n = model("python-for-data", ctx({ days: { [first.id]: { theory: "2026-02-01T10:00:00Z" } } })).next!;
    expect(n.to).toBe("/daily/day/1");
    expect(n.reason).toMatch(/started this lesson/);
  });

  it("the next lesson is the first one not completed, and it states the count", () => {
    const py = spineOf(pathById("python-for-data")!);
    const n = model("python-for-data", ctx(doneState(py.slice(0, 4).map((d) => d.id)))).next!;
    expect(n.detail).toBe(`Day ${py[4].day}`);
    expect(n.reason).toContain(`4 of ${py.length}`);
  });

  it("SQL course progress moves the suggestion to the next unfinished course lesson", () => {
    const l = lessons[0];
    const passed = Object.fromEntries(Array.from({ length: l.exercises }, (_, i) => [`${l.slug}#${i}`, "2026-02-01T10:00:00Z"]));
    const n = model("sql-developer", ctx({ days: {} }, { read: {}, questions: {}, lessons: passed })).next!;
    expect(n.kind).toBe("course");
    expect(n.to).toBe(`/learn/${lessons.find((x) => x.exercises > 0 && x.slug !== l.slug)!.slug}`);
    expect(n.reason).toContain(`passed ${l.exercises} of`);
  });

  it("finishing every lesson points at the final project", () => {
    const def = pathById("python-for-data")!;
    const n = model("python-for-data", ctx(doneState(spineOf(def).map((d) => d.id)))).next!;
    expect(n.kind).toBe("project");
    expect(n.to).toBe("/projects-lab/python-data-cleaning");
  });
});

describe("course model", () => {
  it("counts exercises passed and the first lesson left", () => {
    const c = courseModel(lessons, {});
    expect(c.doneEx).toBe(0);
    expect(c.totalEx).toBe(lessons.reduce((s, l) => s + l.exercises, 0));
    expect(c.next?.slug).toBe(lessons.find((l) => l.exercises > 0)!.slug);
  });
});

describe("curriculum roadmap", () => {
  it("lists every phase with its authored lessons; the three tabs add up to 270", () => {
    const sum = (p: "common" | "analyst" | "engineer") => roadmapPhases(p, { days: {} }).reduce((s, x) => s + x.lessons, 0);
    expect(sum("common")).toBe(90);
    expect(sum("analyst")).toBe(90);
    expect(sum("engineer")).toBe(90);
    expect(roadmapPhases("common", { days: {} }).map((p) => p.id)[0]).toBe("python-fundamentals");
  });

  it("status follows completed lessons", () => {
    const first = roadmapPhases("common", { days: {} })[0];
    const days = COMMON_DAYS.filter((d) => d.phase === first.id);
    expect(roadmapPhases("common", doneState([days[0].id]))[0].status).toBe("in-progress");
    expect(roadmapPhases("common", doneState(days.map((d) => d.id)))[0].status).toBe("completed");
    expect(roadmapPhases("common", { days: {} })[0].status).toBe("not-started");
    expect(roadmapPhases("common", doneState([days[0].id]))[0].href).toBe(`/daily/day/${days[1].day}`);
  });
});

describe("continue learning", () => {
  const view = (daily: DailyState) => ({ progress: {} as never, state: daily, path: undefined, seq: sequenceFor(undefined), revisions: {} });
  const resume = (daily: DailyState) => dailyResume(view(daily));
  const args = (daily: DailyState, progress: Parameters<typeof continueTarget>[0]["progress"] = {}) => ({ resume: resume(daily), daily, progress, lessons });

  it("is null for a learner with no activity", () => {
    expect(continueTarget(args({ days: {} }))).toBeNull();
  });

  it("offers the unfinished Daily lesson", () => {
    const t = continueTarget(args({ days: { d003: { lastVisit: "2026-03-01T10:00:00Z", theory: "x" } } }))!;
    expect(t.kind).toBe("daily");
    expect(t.to).toBe("/daily/day/3");
    expect(t.unfinished).toBe(true);
  });

  it("prefers whatever the learner did most recently", () => {
    const daily: DailyState = { days: { d003: { lastVisit: "2026-03-01T10:00:00Z", theory: "x" } } };
    const t = continueTarget(args(daily, { recent: [{ key: "note:left-join", title: "LEFT JOIN", path: "/notes/left-join", at: "2026-03-02T10:00:00Z" }] }))!;
    expect(t.kind).toBe("note");
    expect(t.to).toBe("/notes/left-join");
    const older = continueTarget(args(daily, { recent: [{ key: "note:left-join", title: "LEFT JOIN", path: "/notes/left-join", at: "2026-02-01T10:00:00Z" }] }))!;
    expect(older.kind).toBe("daily");
  });

  it("offers the next lesson after a completed one", () => {
    const t = continueTarget(args({ days: { d001: { completedAt: "2026-03-01T10:00:00Z", lastVisit: "2026-03-01T10:00:00Z" } } }))!;
    expect(t.to).toBe("/daily/day/2");
    expect(t.unfinished).toBe(false);
  });

  it("resumes the SQL course lesson with passed exercises", () => {
    const l = lessons.find((x) => x.exercises > 1)!;
    const t = continueTarget(args({ days: {} }, { lessons: { [`${l.slug}#0`]: "2026-03-01T10:00:00Z" } }))!;
    expect(t.kind).toBe("course");
    expect(t.unfinished).toBe(true);
  });
});

describe("recommendations explain themselves", () => {
  const notes = () => topics.filter((t) => t.kind === "note");
  const rec = (progress: Parameters<typeof recommend>[0]["progress"], daily: DailyState = { days: {} }, limit?: number) =>
    recommend({ topics, progress, resume: dailyResume({ state: daily, path: undefined, seq: sequenceFor(undefined) }), limit });

  it("a learner with no activity gets none", () => {
    expect(rec({ read: {}, questions: {} })).toEqual([]);
  });

  it("a note read with its questions unsolved leads to practice, and says how many are solved", () => {
    const t = notes().find((n) => n.questions.length >= 2)!;
    const r = rec({ read: { [t.id]: "2026-02-01T00:00:00Z" }, questions: {} }).find((x) => x.kind === "practice")!;
    expect(r.to).toBe(`/learn/topic/${t.id}`);
    expect(r.reason).toContain(`0 of ${t.questions.length}`);
  });

  it("a question attempted twice without a solve points at the topic that covers it", () => {
    const t = notes().find((n) => n.questions.length > 0)!;
    const q = t.questions[0];
    const r = rec({ read: {}, questions: { [q]: { attempts: 3 } } }).find((x) => x.kind === "missed")!;
    expect(r.reason).toContain(`question ${q} 3 times`);
    expect(r.to).toBe(`/learn/topic/${notes().find((n) => n.questions.includes(q))!.id}`);
  });

  it("one attempt, or a solved question, is not a reason", () => {
    const q = notes().find((n) => n.questions.length > 0)!.questions[0];
    expect(rec({ read: {}, questions: { [q]: { attempts: 1 } } })).toEqual([]);
    expect(rec({ read: {}, questions: { [q]: { attempts: 5, solvedAt: "2026-02-01" } } })).toEqual([]);
  });

  it("offers the next topic of a started category once its prerequisites are read", () => {
    const cat = notes().filter((n) => n.category === "python");
    const first = cat.find((n) => n.prerequisites.length === 0)!;
    const r = rec({ read: { [first.id]: "2026-02-01" }, questions: {} }).find((x) => x.kind === "next")!;
    expect(r.reason).toMatch(/You have read 1 of \d+ topics in /);
    expect(r.to).toMatch(/^\/learn\/topic\//);
  });

  it("an unfinished Daily lesson comes first", () => {
    const rs = rec({ read: {}, questions: {} }, { days: { d002: { lastVisit: "2026-03-01T10:00:00Z", theory: "x" } } });
    expect(rs[0].kind).toBe("finish");
    expect(rs[0].reason).toContain("Day 2");
  });

  it("returns at most three, with no topic twice", () => {
    const withQ = notes().filter((n) => n.questions.length >= 2).slice(0, 6);
    const read = Object.fromEntries(withQ.map((n) => [n.id, "2026-02-01"]));
    const rs = rec({ read, questions: {} });
    expect(rs.length).toBeLessThanOrEqual(3);
    expect(new Set(rs.map((r) => r.to)).size).toBe(rs.length);
    expect(rs.every((r) => r.reason.length > 10)).toBe(true);
  });
});

describe("labels", () => {
  it("formats study time", () => {
    expect(hoursLabel(45)).toBe("45 min");
    expect(hoursLabel(1960)).toBe("32.7 h");
  });
});
