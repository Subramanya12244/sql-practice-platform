import { beforeEach, describe, expect, it } from "vitest";
import { RULES, improvement, mergeRevision, nextRevision, revisionQueue, splitQueue, stage } from "../site/lib/revision";
import { getProgress, recordAttempt, reviewQuestion, toggleRevisionMark } from "../site/lib/progress";
import { recordPyAttempt } from "../site/lib/pyPractice";
import type { QuestionSummary } from "../site/types";

const now = new Date("2026-11-06T10:00:00Z");
describe("revision rules", () => {
  beforeEach(() => localStorage.clear());
  it("follows the published intervals", () => {
    const wrong = nextRevision(undefined, { correct: false }, now);
    expect([wrong.due, wrong.interval, wrong.streak, stage(wrong)]).toEqual(["2026-11-07", RULES.incorrectDays, 0, "Relearning"]);
    const slow = nextRevision(wrong, { correct: true, slow: true }, now);
    expect([slow.due, slow.streak]).toEqual(["2026-11-09", 1]);
    const ok = nextRevision(slow, { correct: true }, now);
    expect(ok.due).toBe("2026-11-13");
    const mastered = nextRevision(ok, { correct: true }, now);
    expect([mastered.interval, stage(mastered)]).toEqual([RULES.masteredDays, "Mastered"]);
    expect(improvement(mastered)).toMatchObject({ after: 3, correctAfter: 3 });
    expect(improvement(nextRevision(undefined, { correct: true }, now))).toBeNull();
  });
  it("splits the queue, includes marked concepts and old solves, and merges by latest outcome", () => {
    const index = [{ number: 1, slug: "q1", title: "A", topic: "joins", topicLabel: "Joins", difficulty: "Easy", concepts: ["LEFT JOIN"] }, { number: 2, slug: "q2", title: "B", topic: "agg", topicLabel: "Aggregations", difficulty: "Easy", concepts: ["SUM"] }, { number: 3, slug: "q3", title: "C", topic: "agg", topicLabel: "Aggregations", difficulty: "Easy", concepts: [] }] as QuestionSummary[];
    const p = { questions: { 2: { solvedAt: "2026-11-01T00:00:00Z" } }, revision: { "sql:3": nextRevision(undefined, { correct: true }, now) }, revisionMarks: ["left join"] };
    const q = revisionQueue(index, [], p, "2026-11-06");
    expect(q.map((i) => [i.key, i.due])).toEqual([["sql:2", "2026-11-04"], ["sql:1", "2026-11-06"], ["sql:3", "2026-11-13"]]);
    expect(Object.fromEntries(Object.entries(splitQueue(q, "2026-11-06")).map(([k, v]) => [k, v.length]))).toEqual({ overdue: 1, today: 1, upcoming: 1 });
    const older = { ...p.revision["sql:3"], last: "2026-01-01T00:00:00Z" };
    expect(mergeRevision({ "sql:3": older }, p.revision)["sql:3"].last).toBe(p.revision["sql:3"].last);
  });
  it("is driven by real submits, review re-solves and Python checks", () => {
    recordAttempt(7, "select 1", false);
    expect(getProgress().revision?.["sql:7"]?.interval).toBe(RULES.incorrectDays);
    recordAttempt(7, "select 2", true);
    expect(getProgress().revision?.["sql:7"]?.streak).toBe(1);
    reviewQuestion(7, true);
    expect(getProgress().revision?.["sql:7"]?.streak).toBe(2);
    for (let i = 0; i < 3; i++) recordPyAttempt("safe-cast", false);
    recordPyAttempt("safe-cast", true);
    expect(getProgress().revision?.["py:safe-cast"]).toMatchObject({ interval: RULES.slowDays, streak: 1 });
    toggleRevisionMark("Window Functions");
    expect(getProgress().revisionMarks).toEqual(["Window Functions"]);
    toggleRevisionMark("window functions");
    expect(getProgress().revisionMarks).toEqual([]);
  });
});
