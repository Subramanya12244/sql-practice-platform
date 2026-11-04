import { describe, expect, it } from "vitest";
import { MIN_EVIDENCE, assessReadiness, levelFor } from "../site/lib/readiness";
import { recordAttempt, recordHint, getProgress, resetProgress } from "../site/lib/progress";
import type { Progress } from "../site/lib/progress";
import type { QuestionSummary, Topic } from "../site/types";

const q = (n: number, topic: string, difficulty = "Easy"): QuestionSummary => ({
  number: n, slug: `q${n}`, title: `Q${n}`, topic, topicLabel: topic, difficulty, concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "",
});
const index = [1, 2, 3, 4].map((n) => q(n, "a")).concat([5, 6, 7, 8].map((n) => q(n, "b")), [9, 10, 11].map((n) => q(n, "c")));
const topics: Topic[] = ["a", "b", "c"].map((s) => ({ slug: s, label: s, folder: s, questions: [] }));
const P = (questions: Progress["questions"]): Progress => ({ version: 1, questions, activeDays: [], cards: {} });

describe("readiness", () => {
  it("never scores a topic without enough practice evidence, and ignores imported solves", () => {
    const r = assessReadiness(index, topics, [], P({ 1: { attempts: 1, solvedAt: "x", imported: true }, 2: { attempts: 1, solvedAt: "x", imported: true }, 3: { attempts: 1, solvedAt: "x", imported: true } }), "2026-11-04");
    const a = r.topics.find((t) => t.topic === "a")!;
    expect(a.importedSolved).toBe(3);
    expect(a.level).toBe("Not assessed");
    expect(r.overall).toBeNull();
    expect(r.evidenceNote).toMatch(/Not enough evidence/);
  });
  it("separates independent from assisted solves", () => {
    const practiced = (assisted: boolean) => ({ attempts: 1, solvedAt: "x", practiced: true, assisted });
    const r = assessReadiness(index, topics, [], P({ 1: practiced(false), 2: practiced(false), 3: practiced(true), 4: { attempts: 3, practiced: true } }), "2026-11-04");
    const a = r.topics.find((t) => t.topic === "a")!;
    expect(a.practiced).toBe(4);
    expect(a.solvedIndependent).toBe(2);
    expect(a.solvedAssisted).toBe(1);
    expect(a.dims.application.score).toBe(75);
    expect(a.dims.independence.score).toBe(67);
    expect(a.score).not.toBeNull();
    expect(MIN_EVIDENCE).toBe(3);
    expect(levelFor(80)).toBe("Strong");
  });
});

describe("assistance tracking", () => {
  it("marks a solve after hint level 2+ as assisted, and records error kinds", () => {
    resetProgress();
    recordAttempt(50, "select 1", false, "Wrong result");
    recordAttempt(50, "select 2", true);
    expect(getProgress().questions[50]).toMatchObject({ practiced: true, assisted: false, errorKinds: { "Wrong result": 1 } });
    recordHint(51, 1);
    recordAttempt(51, "select 1", true);
    expect(getProgress().questions[51].assisted).toBe(false);
    recordHint(52, 2);
    recordAttempt(52, "select 1", true);
    expect(getProgress().questions[52].assisted).toBe(true);
    resetProgress();
  });
});
