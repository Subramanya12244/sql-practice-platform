import { describe, expect, it } from "vitest";
import { weekActivity } from "../site/lib/dashboard";
import type { Progress } from "../site/lib/progress";

const EMPTY: Progress = { version: 1, questions: {}, activeDays: [], cards: {} };

describe("dashboard metrics", () => {
  it("returns the last 7 days with zeros for gaps", () => {
    const w = weekActivity({ ...EMPTY, dayCounts: { "2026-11-05": 3, "2026-11-01": 1 } }, "2026-11-05");
    expect(w.map((d) => d.day)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(w.map((d) => d.count)).toEqual([0, 0, 1, 0, 0, 0, 3]);
  });
  it("gives a new visitor an empty week", () => {
    expect(weekActivity(EMPTY, "2026-11-05").every((d) => d.count === 0)).toBe(true);
  });
});
