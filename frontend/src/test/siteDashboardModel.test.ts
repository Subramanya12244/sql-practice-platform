import { describe, expect, it } from "vitest";
import { CURRICULUM, sequenceFor } from "../site/lib/daily";
import type { DailyState } from "../site/lib/dailyProgress";
import { dailyResume } from "../site/lib/dailyResume";
import { SKILLS, lessonsOf, skillRows, skillStatus } from "../site/lib/skills";
import { nextActions, projectActivity, revisionSummary } from "../site/lib/dashboardModel";
import type { NotebookRow } from "../site/lib/mistakes";
import type { ProjectMeta } from "../site/lib/projects";

const done = (ids: string[]): DailyState => ({ days: Object.fromEntries(ids.map((id) => [id, { completedAt: "2026-02-01T10:00:00Z", lastVisit: "2026-02-01T10:00:00Z" }])) });
const row = (id: string) => skillRows({ days: {} }, new Set()).find((r) => r.id === id)!;

describe("skill status rules", () => {
  it("every skill has lessons, and every phase of every skill exists", () => {
    const phases = new Set(CURRICULUM.phases.map((p) => p.id));
    for (const s of SKILLS) {
      expect(lessonsOf(s).length, s.label).toBeGreaterThan(0);
      for (const p of s.phases) expect(phases.has(p), `${s.id}: ${p}`).toBe(true);
    }
  });

  it("a learner with no work has no skill assessed", () => {
    for (const r of skillRows({ days: {} }, new Set())) expect(r.status).toBe("not-assessed");
  });

  it("started, practicing, completed and mastered follow the evidence", () => {
    const sql = lessonsOf(SKILLS.find((s) => s.id === "sql")!);
    const opened: DailyState = { days: { [sql[0].id]: { theory: "2026-02-01T10:00:00Z" } } };
    expect(skillRows(opened, new Set()).find((r) => r.id === "sql")!.status).toBe("started");
    expect(skillRows(done([sql[0].id]), new Set()).find((r) => r.id === "sql")!.status).toBe("practicing");
    const all = done(sql.map((d) => d.id));
    expect(skillRows(all, new Set()).find((r) => r.id === "sql")!.status).toBe("completed");
    expect(skillRows(all, new Set(sql.map((d) => d.id))).find((r) => r.id === "sql")!.status).toBe("mastered");
    // completing every lesson but mastering only some is not mastery
    expect(skillRows(all, new Set([sql[0].id])).find((r) => r.id === "sql")!.status).toBe("completed");
  });

  it("graded practice alone can start a skill and show practicing, but never completes or masters it", () => {
    const base = { done: 0, total: 30, mastered: 0, active: 0 };
    expect(skillStatus({ ...base, practice: { label: "q", value: 1, max: 150 } })).toBe("started");
    expect(skillStatus({ ...base, practice: { label: "q", value: 5, max: 150 } })).toBe("practicing");
    expect(skillStatus({ ...base, practice: { label: "q", value: 150, max: 150 } })).toBe("practicing");
  });

  it("a skill taught only on a path the learner has not chosen says so", () => {
    expect(row("spark").onlyOnPath).toBe("engineer");
    expect(row("sql").onlyOnPath).toBeUndefined();
    expect(skillRows({ days: {}, path: "engineer" }, new Set()).find((r) => r.id === "spark")!.onlyOnPath).toBeUndefined();
  });

  it("completion is counted per skill, from that skill's lessons only", () => {
    const python = lessonsOf(SKILLS.find((s) => s.id === "python")!);
    const r = skillRows(done(python.slice(0, 3).map((d) => d.id)), new Set()).find((x) => x.id === "python")!;
    expect([r.done, r.total]).toEqual([3, python.length]);
    expect(skillRows(done(python.slice(0, 3).map((d) => d.id)), new Set()).find((x) => x.id === "sql")!.done).toBe(0);
  });
});

const seq = sequenceFor(undefined);
const resume = (state: DailyState) => dailyResume({ state, seq, path: state.path });
const nb = (o: Partial<NotebookRow>): NotebookRow => ({ ref: "sql:1", kind: "sql", topic: "joins", topicLabel: "Joins", title: "Q1", path: "/questions/q1", difficulty: "Easy", categories: [{ category: "join", label: "JOIN", count: 3 }], count: 3, runErrors: 0, lastAt: "2026-02-01", status: "open", notes: [], ...o });

describe("next actions come from stated facts, in a fixed order", () => {
  const empty = { dueQuestions: 0, dueCards: 0, dueLessons: [], notebook: [] as NotebookRow[] };

  it("a new learner is told to start day 1 and nothing else invented", () => {
    const a = nextActions({ ...empty, resume: resume({ days: {} }) });
    expect(a.map((x) => x.id)).toEqual(["daily"]);
    expect(a[0].title).toBe("Start Day 1");
    expect(a[0].to).toBe("/daily/day/1");
  });

  it("lesson, then due revision, then mistakes, then a project", () => {
    const a = nextActions({
      resume: resume(done([seq[0].id])), dueQuestions: 2, dueCards: 3, dueLessons: [seq[0].id],
      notebook: [nb({ ref: "sql:1" }), nb({ ref: "sql:2", title: "Q2" })],
      project: { title: "ETL", slug: "etl", percent: 40, pending: "Load" },
    });
    expect(a.map((x) => x.id)).toEqual(["daily", "revision", "mistakes", "project"]);
    expect(a[1].title).toBe("Revise what is due (6)");
    expect(a[1].detail).toBe("2 questions, 3 flashcards, 1 lesson revision");
    expect(a[2].title).toBe("Practise JOIN: it keeps going wrong");
    expect(a[3].detail).toContain("40%");
  });

  it("a solved mistake is not offered for fixing", () => {
    expect(nextActions({ ...empty, resume: resume(done(seq.map((d) => d.id))), notebook: [nb({ status: "solved" })] }).map((x) => x.id)).toEqual(["practice"]);
  });

  it("suggests a project only when none is under way, and respects the limit", () => {
    const a = nextActions({ ...empty, resume: resume({ days: {} }), suggestedProject: { title: "Sales dashboard", slug: "s", level: "Beginner" } });
    expect(a.map((x) => x.id)).toEqual(["daily", "project"]);
    expect(nextActions({ ...empty, resume: resume({ days: {} }), suggestedProject: { title: "x", slug: "x", level: "Beginner" } }, 1)).toHaveLength(1);
  });
});

describe("revision and mistakes summary", () => {
  it("counts what is pending and finds repeated mistakes, weak topics and corrections", () => {
    const rows = [
      nb({ ref: "sql:1", topic: "joins", topicLabel: "Joins" }),
      nb({ ref: "sql:2", topic: "joins", topicLabel: "Joins", title: "Q2", status: "solved", lastAt: "2026-02-03" }),
      nb({ ref: "sql:3", topic: "agg", topicLabel: "Aggregation", title: "Q3", categories: [{ category: "join", label: "JOIN", count: 2 }], count: 2 }),
    ];
    const s = revisionSummary({ dueQuestions: 1, dueCards: 2, dueLessons: ["d001"], notebook: rows });
    expect(s.pending).toEqual({ questions: 1, cards: 2, lessons: 1, total: 4 });
    expect(s.repeated[0]).toMatchObject({ label: "JOIN", questions: 3 });
    expect(s.weakTopics.map((t) => [t.label, t.open]).sort()).toEqual([["Aggregation", 1], ["Joins", 1]]);
    expect(s.corrected.map((r) => r.title)).toEqual(["Q2"]);
  });
  it("is empty for a learner with no mistakes", () => {
    const s = revisionSummary({ dueQuestions: 0, dueCards: 0, dueLessons: [], notebook: [] });
    expect([s.pending.total, s.repeated.length, s.weakTopics.length, s.corrected.length]).toEqual([0, 0, 0, 0]);
  });
});

describe("project activity", () => {
  const meta = (slug: string, level: string) => ({ slug, title: slug, level }) as ProjectMeta;
  const tasks = [{ slug: "a", tasks: [{ id: "t1", type: "sql", title: "" }, { id: "t2", type: "sql", title: "" }] }, { slug: "b", tasks: [{ id: "t1", type: "sql", title: "" }] }, { slug: "c", tasks: [{ id: "t1", type: "sql", title: "" }] }] as never;
  const progress = (slug: string) => (slug === "a" ? { tasks: { t1: { passed: true } }, checklist: {} } : slug === "b" ? { tasks: { t1: { passed: true } }, checklist: {} } : { tasks: {}, checklist: {} }) as never;

  it("separates in progress, completed and not started, and suggests the easiest unstarted one", () => {
    const a = projectActivity([meta("a", "Beginner"), meta("b", "Intermediate"), meta("c", "Advanced"), meta("d", "Beginner")], tasks, progress);
    expect(a.current.map((r) => [r.meta.slug, r.passed, r.total])).toEqual([["a", 1, 2]]);
    expect(a.completed.map((r) => r.meta.slug)).toEqual(["b"]);
    expect(a.next?.slug).toBe("c"); // "d" has no task list, so it is not counted
    expect(a.total).toBe(3);
  });
});
