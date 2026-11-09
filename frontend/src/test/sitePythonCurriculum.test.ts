import { describe, expect, it } from "vitest";
import { loadAllExercises, PY_STAGES, PY_STAGE_MAP, getExerciseStage } from "../site/lib/pyExercises";

describe("Python Curriculum 14-Stage Pedagogical Progression", () => {
  it("defines all 14 pedagogical stages", () => {
    expect(PY_STAGES).toHaveLength(14);
    PY_STAGES.forEach((s, idx) => {
      expect(s.stage).toBe(idx + 1);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    });
  });

  it("maps exactly 150 unique exercise IDs to stages 1 through 14", () => {
    const ids = Object.keys(PY_STAGE_MAP);
    expect(ids).toHaveLength(150);

    const expectedIds = Array.from({ length: 150 }, (_, i) => `PY-${String(i + 1).padStart(3, "0")}`);
    expect([...ids].sort()).toEqual(expectedIds);

    ids.forEach((id) => {
      const stage = PY_STAGE_MAP[id];
      expect(stage).toBeGreaterThanOrEqual(1);
      expect(stage).toBeLessThanOrEqual(14);
    });
  });

  it("reconciles stage counts to exactly 150 with zero discrepancy", () => {
    const stageCounts: Record<number, number> = {};
    for (let i = 1; i <= 14; i++) stageCounts[i] = 0;

    Object.values(PY_STAGE_MAP).forEach((st) => {
      stageCounts[st] = (stageCounts[st] || 0) + 1;
    });

    const expectedCounts: Record<number, number> = {
      1: 4,
      2: 6,
      3: 10,
      4: 13,
      5: 3,
      6: 4,
      7: 19,
      8: 7,
      9: 19,
      10: 3,
      11: 9,
      12: 19,
      13: 10,
      14: 24,
    };

    expect(stageCounts).toEqual(expectedCounts);
    const total = Object.values(stageCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(150);
  });

  it("loads all 150 exercises and assigns correct primary stage", async () => {
    const exercises = await loadAllExercises();
    expect(exercises).toHaveLength(150);

    exercises.forEach((ex) => {
      const stage = getExerciseStage(ex);
      expect(stage).toBeGreaterThanOrEqual(1);
      expect(stage).toBeLessThanOrEqual(14);
      expect(stage).toBe(PY_STAGE_MAP[ex.code]);
    });
  });

  it("sorts exercises pedagogically by Difficulty, then Stage, then Title", async () => {
    const exercises = await loadAllExercises();
    const rank: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };

    for (let i = 0; i < exercises.length - 1; i++) {
      const a = exercises[i];
      const b = exercises[i + 1];
      const diffDiff = (rank[a.difficulty] ?? 1) - (rank[b.difficulty] ?? 1);
      if (diffDiff !== 0) {
        expect(diffDiff).toBeLessThanOrEqual(0);
      } else {
        const sa = getExerciseStage(a);
        const sb = getExerciseStage(b);
        if (sa !== sb) {
          expect(sa).toBeLessThanOrEqual(sb);
        }
      }
    }
  });
});

