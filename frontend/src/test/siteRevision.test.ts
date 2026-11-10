import { beforeEach, describe, expect, it } from "vitest";
import { RULES, improvement, mergeRevision, nextRevision, revisionQueue, revisionStats, splitQueue, stage, stageFromInterval, stageOf } from "../site/lib/revision";
import { getProgress, recordAttempt, reviewQuestion, toggleRevisionMark } from "../site/lib/progress";
import { recordPyAttempt } from "../site/lib/pyPractice";
import type { QuestionSummary } from "../site/types";

const now = new Date("2026-11-06T10:00:00Z");
describe("revision rules", () => {
  beforeEach(() => localStorage.clear());
  it("follows the 1 / 3 / 7 / 14 / 30 ladder", () => {
    const wrong = nextRevision(undefined, { correct: false }, now);
    expect([wrong.due, wrong.interval, wrong.streak, stage(wrong)]).toEqual(["2026-11-07", RULES.incorrectDays, 0, "Relearning"]);
    // Correct with help: the same gap again.
    const helped = nextRevision(wrong, { correct: true, slow: true }, now);
    expect([helped.interval, helped.streak]).toEqual([1, 1]);
    let r = helped;
    const gaps = [];
    for (let i = 0; i < 5; i++) { r = nextRevision(r, { correct: true }, now); gaps.push(r.interval); }
    expect(gaps).toEqual([3, 7, 14, 30, 30]); // clean reviews climb, then stay at the top
    expect(stage(r)).toBe("Mastered");
    expect(improvement(r)).toMatchObject({ after: 6, correctAfter: 6 });
    expect(improvement(nextRevision(undefined, { correct: true }, now))).toBeNull();
  });
  it("the first correct answer is reviewed tomorrow; a wrong one resets from any stage", () => {
    const first = nextRevision(undefined, { correct: true }, now);
    expect([first.interval, first.stage]).toEqual([1, 0]);
    const high = { ...first, stage: 4, interval: 30, streak: 5 };
    expect(nextRevision(high, { correct: false }, now)).toMatchObject({ interval: 1, stage: 0, streak: 0 });
  });
  it("adapts to hints, attempts and time", () => {
    const at3 = { ...nextRevision(undefined, { correct: true }, now), stage: 2, interval: 7, streak: 2 };
    expect(nextRevision(at3, { correct: true, hints: 2 }, now).interval).toBe(7); // used a hint: same gap
    expect(nextRevision(at3, { correct: true, hints: 1 }, now).interval).toBe(14); // a concept nudge is not help
    expect(nextRevision(at3, { correct: true, attempts: 3 }, now).interval).toBe(7); // three attempts
    expect(nextRevision(at3, { correct: true, slow: true }, now).interval).toBe(7); // slow
    expect(nextRevision(at3, { correct: true, fast: true }, now).interval).toBe(30); // fast after 2 clean: skips a step
    expect(nextRevision({ ...at3, streak: 1 }, { correct: true, fast: true }, now).interval).toBe(14); // not enough clean answers yet
  });
  it("old items map onto the ladder by interval and keep their due date", () => {
    expect(stageFromInterval(1)).toBe(0);
    expect(stageFromInterval(3)).toBe(1);
    expect(stageFromInterval(7)).toBe(2);
    expect(stageFromInterval(30)).toBe(4);
    const legacy = { due: "2026-11-10", interval: 7, streak: 1, last: "2026-11-03T00:00:00Z", history: [{ at: "2026-11-03T00:00:00Z", ok: true }] };
    expect(stageOf(legacy)).toBe(2);
    expect(nextRevision(legacy, { correct: true }, now).interval).toBe(14);
  });
  it("records whether a review was a scheduled re-solve and whether it was late, and counts them", () => {
    const first = nextRevision(undefined, { correct: true }, new Date("2026-11-01T10:00:00Z")); // due 11-02
    const onTime = nextRevision(first, { correct: true }, new Date("2026-11-02T09:00:00Z"));
    const late = nextRevision(onTime, { correct: false }, new Date("2026-11-20T09:00:00Z"));
    expect(first.history[0]).toEqual({ at: "2026-11-01T10:00:00.000Z", ok: true });
    expect(onTime.history[1]).toMatchObject({ rev: true, late: false });
    expect(late.history[2]).toMatchObject({ rev: true, late: true, ok: false });
    const st = revisionStats({ "sql:1": late }, "2026-11-20");
    expect(st.all).toEqual({ reviews: 2, correct: 1, onTime: 1 });
    expect(st.week).toEqual({ reviews: 1, correct: 0, onTime: 0 }); // only the 11-20 review is inside the last 7 days
    expect(st.byStage[0]).toBe(1);
    expect(revisionStats(undefined, "2026-11-20").all.reviews).toBe(0);
  });
  it("splits the queue, includes marked concepts and old solves, and merges by latest outcome", () => {
    const index = [{ number: 1, slug: "q1", title: "A", topic: "joins", topicLabel: "Joins", difficulty: "Easy", concepts: ["LEFT JOIN"] }, { number: 2, slug: "q2", title: "B", topic: "agg", topicLabel: "Aggregations", difficulty: "Easy", concepts: ["SUM"] }, { number: 3, slug: "q3", title: "C", topic: "agg", topicLabel: "Aggregations", difficulty: "Easy", concepts: [] }] as QuestionSummary[];
    const p = { questions: { 2: { solvedAt: "2026-11-01T00:00:00Z" } }, revision: { "sql:3": nextRevision(undefined, { correct: true }, now) }, revisionMarks: ["left join"] };
    const q = revisionQueue(index, [], p, "2026-11-06");
    expect(q.map((i) => [i.key, i.due])).toEqual([["sql:2", "2026-11-04"], ["sql:1", "2026-11-06"], ["sql:3", "2026-11-07"]]); // first correct answer: tomorrow
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
    expect(getProgress().revision?.["py:safe-cast"]).toMatchObject({ interval: 1, streak: 1 }); // passed after 3 failed checks: slow, same gap
    toggleRevisionMark("Window Functions");
    expect(getProgress().revisionMarks).toEqual(["Window Functions"]);
    toggleRevisionMark("window functions");
    expect(getProgress().revisionMarks).toEqual([]);
  });
});
