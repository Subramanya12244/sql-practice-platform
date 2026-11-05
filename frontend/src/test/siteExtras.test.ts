import { describe, expect, it } from "vitest";
import { dailyChallenge, masteryLevel, personalReportHtml, savedSolutions, sqlRevision, submissionHistory } from "../site/lib/extras";
import type { Progress } from "../site/lib/progress";
import type { PyExerciseMeta } from "../site/lib/pyExercises";
import type { QuestionSummary } from "../site/types";

const Q = (number: number, difficulty: string, topic = "joins") => ({ number, slug: `q${number}`, title: `T${number}`, topic, topicLabel: "Joins", difficulty }) as QuestionSummary;
const P = (slug: string, difficulty: string) => ({ slug, title: slug, difficulty, code: "PY-001", category: "etl" }) as PyExerciseMeta;
const base = (questions: Progress["questions"] = {}): Progress => ({ version: 1, questions, activeDays: [], cards: {} });

describe("learner extras", () => {
  it("picks the same daily challenge for a day, at that day's level", () => {
    const sql = [Q(1, "Easy"), Q(2, "Easy"), Q(3, "Medium"), Q(4, "Hard")];
    const py = [P("a", "Easy"), P("b", "Hard")];
    const a = dailyChallenge("2026-11-03", sql, py); // Tuesday → Medium
    expect(a.level).toBe("Medium");
    expect(a.sql?.number).toBe(3);
    expect(a.python).toBeDefined(); // no Medium Python here, so any problem
    expect(dailyChallenge("2026-11-03", sql, py)).toEqual(a);
    expect(dailyChallenge("2026-11-02", sql, py).level).toBe("Easy");
  });
  it("grades mastery from evidence, halving assisted solves", () => {
    const it_ = (difficulty: string, solved: boolean, independent = solved) => ({ difficulty, solved, independent, attempted: solved });
    expect(masteryLevel([it_("Easy", false), it_("Hard", false)]).level).toBe("Not started");
    expect(masteryLevel([it_("Easy", true), it_("Easy", true), it_("Hard", false)]).level).toBe("Proficient");
    expect(masteryLevel([it_("Easy", true), it_("Hard", true)]).level).toBe("Mastered");
    expect(masteryLevel([it_("Easy", true, false), it_("Hard", true, false)])).toEqual({ level: "Practising", score: 50 });
  });
  it("lists questions to revise and history with saved solutions", () => {
    const index = [Q(1, "Easy"), Q(2, "Easy"), Q(3, "Hard")];
    const progress = base({
      1: { attempts: 4, practiced: true, startedAt: "2026-11-01T10:00:00Z", lastSql: "select 1" },
      2: { attempts: 1, practiced: true, solvedAt: "2026-11-02T10:00:00Z", assisted: true, lastSql: "select 2" },
      3: { attempts: 1, practiced: true, solvedAt: "2026-11-03T10:00:00Z", lastSql: "select 3" },
    });
    expect(sqlRevision(index, progress).map((r) => r.q.number)).toEqual([1, 2]);
    const h = submissionHistory(index, progress, [P("a", "Easy")], { a: [
      { at: "2026-11-04T10:00:00Z", kind: "check", ok: true, message: "ok", code: "def f(): ..." },
      { at: "2026-11-03T09:00:00Z", kind: "check", ok: false, message: "fail" },
      { at: "2026-11-03T08:00:00Z", kind: "run", ok: true, message: "ran" },
    ] });
    expect(h.map((x) => x.key)).toEqual(["py:a", "q3", "py:a", "q2", "q1"]);
    expect(savedSolutions(h).map((x) => x.key)).toEqual(["py:a", "q3", "q2"]);
  });
  it("escapes learner text in the report", () => {
    const html = personalReportHtml({ name: "<script>x</script>", generated: "now", sql: { solved: 1, total: 2, independent: 1 }, python: { solved: 0, total: 150, accuracy: null },
      activeTime: { today: "1 min", week: "1 min", total: "1 min" }, streak: 1, sqlTopics: [], pyTopics: [], revise: [{ title: "Q1 <b>", reason: "x" }], mocks: [] });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<script/);
  });
});

import { pickAssessment } from "../site/lib/extras";
import { relatedTables } from "../site/components/SchemaFlow";
import schemaJson from "../../public/data/schema.json";
describe("assessment and ER helpers", () => {
  it("picks one problem per level, preferring unsolved ones", () => {
    const all = [{ slug: "e1", difficulty: "Easy" }, { slug: "e2", difficulty: "Easy" }, { slug: "m1", difficulty: "Medium" }, { slug: "h1", difficulty: "Hard" }];
    expect(pickAssessment(all, { "py:e1": "2026-01-01" }, "seed", false)).toEqual(["e2", "m1", "h1"]);
    expect(pickAssessment(all, { "py:m1": "x" }, "seed", false)).toContain("m1"); // the only Medium, even if solved
  });
  it("finds a table's neighbours through foreign keys in both directions", () => {
    const r = relatedTables(schemaJson as never, "orders");
    for (const t of ["orders", "customers", "employees", "shippers", "order_details"]) expect(r.has(t)).toBe(true);
    expect(r.has("categories")).toBe(false);
  });
});
