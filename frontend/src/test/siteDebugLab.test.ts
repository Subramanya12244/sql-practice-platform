// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import scenarios from "../site/content/debug/scenarios.json";

let python = "";
try { execFileSync("python3", ["-c", "import json"]); python = "python3"; } catch { /* skip without Python */ }
const passes = (code: string) => { try { execFileSync(python, ["-I", "-c", code], { stdio: "pipe", timeout: 30_000 }); return true; } catch { return false; } };

describe("pipeline debugging lab", () => {
  it("has three scenarios per level with well-formed diagnoses", () => {
    for (const lvl of ["Beginner", "Intermediate", "Advanced"]) expect(scenarios.filter((s) => s.level === lvl).length).toBeGreaterThanOrEqual(3);
    for (const s of scenarios) {
      expect(s.diagnosis.answer).toBeLessThan(s.diagnosis.options.length);
      expect(s.diagnosis.why).toHaveLength(s.diagnosis.options.length);
      expect(s.hints.length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });
  it.skipIf(!python).each(scenarios.map((s) => [s.id, s] as const))("%s: broken fails, fixed passes", (_id, s) => {
    expect(passes(`${s.pipeline}\n${s.tests}`)).toBe(false);
    expect(passes(`${s.fixed}\n${s.tests}`)).toBe(true);
  });
});
