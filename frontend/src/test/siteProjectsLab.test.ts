// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { loadAllProjects, loadProjectIndex, projectStatus, type ProjectMeta, type ProjectProgress } from "../site/lib/projects";
import {
  LEVELS, NO_PROJECT_FILTER, filterProjects, isProjectFiltered, libraryTotals, nextTask, projectFilterFromSearch, projectFilterToSearch, statusGroup, summarise, taskState, technologyOptions,
  type ProjectTasks, type TaskRef,
} from "../site/lib/projectsLab";
import { PROJECT_ICON, projectIcon } from "../site/components/projects/ProjectUi";

let meta: ProjectMeta[];
let lists: ProjectTasks[];
const none = (): ProjectProgress => ({ tasks: {}, checklist: {} });
const pass = (...ids: string[]): ProjectProgress => ({ tasks: Object.fromEntries(ids.map((id) => [id, { passed: true, at: "2026-01-01" }])), checklist: {} });

beforeAll(async () => {
  meta = await loadProjectIndex();
  lists = (await loadAllProjects()).map((p) => ({ slug: p.slug, tasks: p.tasks.map((t) => ({ id: t.id, type: t.type, title: t.title })) }));
});

describe("library totals are the real content", () => {
  it("12 projects, and the task total is the sum of the projects' own tasks", () => {
    const t = libraryTotals(meta);
    expect(t.projects).toBe(12);
    expect(t.tasks).toBe(lists.reduce((s, l) => s + l.tasks.length, 0));
    expect(t.automated + t.manual).toBe(t.tasks);
    // eslint-disable-next-line no-console
    console.log(`PROJECT TOTALS projects=${t.projects} tasks=${t.tasks} automated=${t.automated} manual=${t.manual}`);
  });

  it("every project has its own icon", () => {
    for (const p of meta) expect(PROJECT_ICON[p.slug], p.slug).toBeTruthy();
    expect(Object.keys(PROJECT_ICON).sort()).toEqual(meta.map((p) => p.slug).sort());
    expect(projectIcon("not-a-project")).toBeTruthy();
  });
});

describe("task state comes only from stored check results", () => {
  const sql: TaskRef = { id: "t1", type: "sql", title: "Load" };
  const manual: TaskRef = { id: "m1", type: "checklist", title: "Review" };

  it("an automated task is pending until it is run, then passed or failed", () => {
    expect(taskState(sql, none())).toBe("pending");
    expect(taskState(sql, pass("t1"))).toBe("passed");
    expect(taskState(sql, { tasks: { t1: { passed: false, at: "x" } }, checklist: {} })).toBe("failed");
  });

  it("a manual step is todo, partial or done by its ticks", () => {
    expect(taskState(manual, none())).toBe("todo");
    expect(taskState(manual, { tasks: {}, checklist: { m1: [true, false] } })).toBe("partial");
    expect(taskState(manual, { tasks: {}, checklist: { m1: [true, true] } })).toBe("done");
  });

  it("a project is only Completed when its checks pass (the existing rule is untouched)", () => {
    for (const l of lists) {
      const auto = l.tasks.filter((t) => t.type !== "checklist");
      const hasManual = l.tasks.some((t) => t.type === "checklist");
      expect(projectStatus({ tasks: l.tasks as never }, none()), l.slug).toBe("Not started");
      const all = pass(...auto.map((t) => t.id));
      expect(projectStatus({ tasks: l.tasks as never }, all), l.slug).toBe(hasManual ? "In progress" : "Completed");
      if (auto.length > 1) expect(projectStatus({ tasks: l.tasks as never }, pass(auto[0].id)), l.slug).not.toBe("Completed");
    }
  });
});

describe("next task", () => {
  it("is the first automated task not yet passed, in the project's order", () => {
    for (const l of lists) {
      const auto = l.tasks.filter((t) => t.type !== "checklist");
      if (!auto.length) continue;
      expect(nextTask(l.tasks, none())?.id, l.slug).toBe(auto[0].id);
      if (auto.length > 1) expect(nextTask(l.tasks, pass(auto[0].id))?.id, l.slug).toBe(auto[1].id);
    }
  });

  it("a failed task is still the next one, and manual steps come after the automated ones", () => {
    const tasks: TaskRef[] = [{ id: "m", type: "checklist", title: "M" }, { id: "a", type: "sql", title: "A" }, { id: "b", type: "python", title: "B" }];
    expect(nextTask(tasks, { tasks: { a: { passed: false, at: "x" } }, checklist: {} })?.id).toBe("a");
    expect(nextTask(tasks, pass("a"))?.id).toBe("b");
    expect(nextTask(tasks, pass("a", "b"))?.id).toBe("m");
    expect(nextTask(tasks, { tasks: pass("a", "b").tasks, checklist: { m: [true] } })).toBeNull();
  });

  it("summarise counts what was passed and failed, and never invents progress", () => {
    const tasks: TaskRef[] = [{ id: "a", type: "sql", title: "A" }, { id: "b", type: "sql", title: "B" }, { id: "m", type: "checklist", title: "M" }];
    const s = summarise(tasks, { tasks: { a: { passed: true, at: "x" }, b: { passed: false, at: "x" } }, checklist: {} }, "In progress");
    expect(s).toMatchObject({ automated: 2, passed: 1, failed: 1, manual: 1, manualDone: 0, group: "in-progress" });
    expect(s.next?.id).toBe("b");
    expect(summarise(tasks, none(), "Not started")).toMatchObject({ passed: 0, failed: 0, group: "not-started" });
  });
});

describe("filters", () => {
  const group = () => "not-started" as const;
  it("no filter keeps everything, and any filter is reported as active", () => {
    expect(filterProjects(meta, group, NO_PROJECT_FILTER)).toHaveLength(meta.length);
    expect(isProjectFiltered(NO_PROJECT_FILTER)).toBe(false);
    expect(isProjectFiltered({ ...NO_PROJECT_FILTER, tech: "dbt" })).toBe(true);
  });

  it("level, technology and search narrow the list, and they combine", () => {
    for (const level of LEVELS) expect(filterProjects(meta, group, { ...NO_PROJECT_FILTER, level }).every((p) => p.level === level)).toBe(true);
    const techs = technologyOptions(meta);
    expect(techs[0].count).toBeGreaterThanOrEqual(techs[techs.length - 1].count);
    for (const { tech, count } of techs) expect(filterProjects(meta, group, { ...NO_PROJECT_FILTER, tech }).length, tech).toBe(count);
    const dbt = filterProjects(meta, group, { ...NO_PROJECT_FILTER, q: "dbt" });
    expect(dbt.length).toBeGreaterThan(0);
    expect(filterProjects(meta, group, { ...NO_PROJECT_FILTER, q: "dbt", level: "Beginner" })).toEqual([]);
    expect(filterProjects(meta, group, { ...NO_PROJECT_FILTER, q: "zzzzqqq" })).toEqual([]);
  });

  it("search is case-insensitive and matches every word", () => {
    expect(filterProjects(meta, group, { ...NO_PROJECT_FILTER, q: "AIRFLOW etl" }).map((p) => p.slug)).toContain("airflow-etl-pipeline");
  });

  it("status filters use the learner's real status, grouped", () => {
    expect(statusGroup("Completed")).toBe("completed");
    expect(statusGroup("Not started")).toBe("not-started");
    for (const s of ["In progress", "Submitted", "Under evaluation", "Changes requested", "Rejected"] as const) expect(statusGroup(s), s).toBe("in-progress");
    const some = meta[0].slug;
    const only = filterProjects(meta, (slug) => (slug === some ? "completed" : "not-started"), { ...NO_PROJECT_FILTER, status: "completed" });
    expect(only.map((p) => p.slug)).toEqual([some]);
  });

  it("the address round-trips, and unknown values are ignored", () => {
    const f = { q: "etl", level: "Advanced" as const, tech: "dbt", status: "in-progress" as const };
    expect(projectFilterFromSearch(projectFilterToSearch(f))).toEqual(f);
    expect(projectFilterToSearch(NO_PROJECT_FILTER)).toBe("");
    expect(projectFilterFromSearch("?level=Expert&status=weird&q=" + "x".repeat(200)).q.length).toBe(80);
    expect(projectFilterFromSearch("?level=Expert&status=weird")).toMatchObject({ level: "all", status: "all" });
  });
});
