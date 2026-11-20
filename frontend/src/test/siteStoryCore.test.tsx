/**
 * The shared teaching layer: the four-part story contract, its panel, and the beat framework that turns real stages into steps.
 * Domain sequences (Python, Pandas, NumPy) have their own suites; this one guards what they all rely on.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STORY_MAX, STORY_PARTS, storyProblems, type StepStory } from "../site/lib/visual/story";
import { StoryPanel } from "../site/components/visual/StoryPanel";
import { beatAt, buildDataBeats, genericDataStory } from "../site/lib/visual/dataBeats";
import { buildDataModel, runDataProbe } from "../site/lib/visual/dataframe";
import { cpythonRun, hasDataPython } from "./siteWorkspaceDataPy";

const ok: StepStory = { what: "Filters the rows.", changed: "4 rows become 2.", why: "A condition keeps rows where it is True.", remember: "The condition is evaluated per row." };

describe("story contract", () => {
  it("accepts a complete story and rejects each broken part", () => {
    expect(storyProblems(ok)).toEqual([]);
    for (const { key } of STORY_PARTS) {
      expect(storyProblems({ ...ok, [key]: "" })).toContain(`${key} is empty`);
      expect(storyProblems({ ...ok, [key]: "x".repeat(STORY_MAX + 1) }).join()).toMatch(/max/);
      expect(storyProblems({ ...ok, [key]: "value is undefined here" }).join()).toMatch(/broken/);
    }
  });
  it("lets a pandas story talk about a real NaN only when asked", () => {
    expect(storyProblems({ ...ok, changed: "One NaN was filled." })).not.toEqual([]);
    expect(storyProblems({ ...ok, changed: "One NaN was filled." }, { allowNaN: true })).toEqual([]);
  });
  it("names the four parts in the order the brief asks for", () => {
    expect(STORY_PARTS.map((p) => p.title)).toEqual(["What is happening?", "What changed?", "Why did it happen?", "Remember this"]);
  });
});

describe("StoryPanel", () => {
  it("shows the four answers and announces only the 'what' sentence, without a hidden duplicate", () => {
    const { container, rerender } = render(<StoryPanel story={ok} stepKey="1.0" step={1} total={3} />);
    for (const { title } of STORY_PARTS) expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getAllByText("Filters the rows.")).toHaveLength(1);
    const live = container.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe("Filters the rows.");
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    rerender(<StoryPanel story={{ ...ok, what: "Sorts the rows." }} stepKey="1.1" step={2} total={3} />);
    expect(container.querySelectorAll("[aria-live]")[0]).toBe(live[0]); // the live region node itself stays mounted
    expect(live[0].textContent).toBe("Sorts the rows.");
  });
});

describe.skipIf(!hasDataPython)("beat framework on real stages", () => {
  const programs: Record<string, [("pandas" | "numpy"), string]> = {
    filter: ["pandas", "import pandas as pd\ndf = pd.DataFrame({'name': ['A', 'B', 'C', 'D'], 'salary': [30000, 60000, 45000, 80000]})\nresult = df[df['salary'] > 50000]\n"],
    groupby: ["pandas", "import pandas as pd\ndf = pd.DataFrame({'k': ['a', 'b', 'a'], 'v': [1, 2, 3]})\nt = df.groupby('k')['v'].sum()\n"],
    broadcast: ["numpy", "import numpy as np\na = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nresult = a + b\n"],
    reshape: ["numpy", "import numpy as np\nx = np.arange(6).reshape(2, 3)\ny = x.T\n"],
  };
  for (const [name, [domain, code]] of Object.entries(programs)) {
    it(`${name}: every stage yields beats, ids are unique and in order, and every story is complete`, async () => {
      const r = await runDataProbe(code, { run: cpythonRun });
      const data = buildDataModel(domain, r.probe!, code);
      const beats = buildDataBeats(data);
      expect(beats.length).toBeGreaterThanOrEqual(data.stages.length);
      expect(new Set(beats.map((b) => b.id)).size).toBe(beats.length);
      let last = -1;
      for (const b of beats) {
        expect(b.stage).toBeGreaterThanOrEqual(last);
        last = b.stage;
        expect(b.of).toBeGreaterThanOrEqual(1);
        expect(storyProblems(b.story, { allowNaN: true }), `${b.id} ${b.title}`).toEqual([]);
      }
      for (let s = 0; s < data.stages.length; s++) expect(beats.some((b) => b.stage === s)).toBe(true);
      // The player clamps: before the start and past the end still resolve to a real beat.
      expect(beatAt(beats, -5)).toBe(beats[0]);
      expect(beatAt(beats, 999)).toBe(beats[beats.length - 1]);
    });
  }
  it("the generic story uses only measured numbers: shapes and row counts match the stage", async () => {
    const [domain, code] = programs.filter;
    const r = await runDataProbe(code, { run: cpythonRun });
    const data = buildDataModel(domain, r.probe!, code);
    const i = data.stages.findIndex((s) => s.op === "[]");
    const story = genericDataStory(data.stages[i], data.analyses[i]);
    const text = `${story.what} ${story.changed}`;
    expect(text).toMatch(/2 rows kept/);
    expect(text).toMatch(/2 rows removed/);
    expect(text).toMatch(/\(4, 2\)/);
  });
});
