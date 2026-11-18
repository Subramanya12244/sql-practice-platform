// @vitest-environment node
// Workspace domain map (lib/visual/dailyVisual.ts): every lesson and exercise gets the domain its real exercise kind and code require.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CURRICULUM, type DayExtras } from "../site/lib/daily";
import {
  WORKSPACE_EXERCISES, WORKSPACE_EXTRA_PACKAGES, exerciseWorkspace, exerciseWorkspaceDomain, extraPackagesOf, lessonWorkspace,
  workspaceDomainOfExercise, workspacePresetsFor,
} from "../site/lib/visual/dailyVisual";

const jsonFiles = import.meta.glob<DayExtras>("../site/content/daily/days/*.json", { eager: true, import: "default" });
const extrasById = new Map(Object.entries(jsonFiles).map(([p, e]) => [p.split("/").pop()!.replace(".json", ""), e]));
const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LETTER = { sql: "s", python: "p", pandas: "d", numpy: "n" } as const;

describe("workspace domain classifier", () => {
  it("maps kind and imports to a domain, and written to none", () => {
    expect(workspaceDomainOfExercise("sql", "SELECT 1")).toBe("sql");
    expect(workspaceDomainOfExercise("written", "model answer")).toBeNull();
    expect(workspaceDomainOfExercise("python", "print(1)")).toBe("python");
    expect(workspaceDomainOfExercise("python", "import sqlite3\nprint(1)")).toBe("python");
    expect(workspaceDomainOfExercise("python", "import numpy as np\nprint(np.arange(3))")).toBe("numpy");
    expect(workspaceDomainOfExercise("python", "import numpy as np\nimport pandas as pd")).toBe("pandas");
    expect(workspaceDomainOfExercise("python", "import numpy as np, pandas as pd")).toBe("pandas");
    expect(workspaceDomainOfExercise("python", "from pandas import DataFrame")).toBe("pandas");
    expect(workspaceDomainOfExercise("python", "# import pandas\nprint('pandas')")).toBe("python");
  });
  it("finds scipy and statsmodels imports only", () => {
    expect(extraPackagesOf("import scipy.stats as st\nimport statsmodels.api as sm")).toEqual(["scipy", "statsmodels"]);
    expect(extraPackagesOf("import numpy as np")).toEqual([]);
    expect(extraPackagesOf("# scipy is mentioned\nprint('scipy')")).toEqual([]);
  });
});

describe("generated table matches the real lesson JSON", () => {
  it("has one row per curriculum lesson and no others", () => {
    expect(Object.keys(WORKSPACE_EXERCISES).sort()).toEqual(CURRICULUM.days.map((d) => d.id).sort());
  });
  it("encodes every exercise with the domain its kind and solution give", () => {
    const wrong: string[] = [];
    for (const d of CURRICULUM.days) {
      const x = extrasById.get(d.id)!;
      const [g, i = ""] = WORKSPACE_EXERCISES[d.id].split("|");
      if (g.length !== x.guided.length || i.length !== x.independent.length) { wrong.push(`${d.id}: ${g}|${i} has the wrong count`); continue; }
      [...x.guided, ...x.independent].forEach((e, k) => {
        const dom = workspaceDomainOfExercise(e.kind, e.solution);
        const want = dom ? LETTER[dom] : "w";
        const got = (g + i)[k];
        if (got !== want) wrong.push(`${d.id}/${e.id}: table ${got}, real ${want}`);
        if (e.kind === "written" && got !== "w") wrong.push(`${d.id}/${e.id}: written exercise got a domain`);
        if (e.kind === "sql" && got !== "s") wrong.push(`${d.id}/${e.id}: SQL exercise is not sql`);
        if (e.kind === "python" && got === "s") wrong.push(`${d.id}/${e.id}: python exercise is sql`);
        expect(exerciseWorkspaceDomain(d.id, e.id), `${d.id}/${e.id}`).toBe(dom);
      });
    }
    expect(wrong).toEqual([]);
  });
  it("lists exactly the exercises that import scipy or statsmodels", () => {
    const real: Record<string, string[]> = {};
    for (const d of CURRICULUM.days) {
      const x = extrasById.get(d.id)!;
      for (const [w, list] of [["g", x.guided], ["i", x.independent]] as const) list.forEach((e, k) => {
        const p = e.kind === "python" ? extraPackagesOf(e.solution) : [];
        if (p.length) real[`${d.id}/${w}${k + 1}`] = p;
      });
    }
    expect(WORKSPACE_EXTRA_PACKAGES).toEqual(real);
  });
  it("is what `node scripts/daily-workspace-map.mjs --check` would write", () => {
    expect(() => execFileSync("node", ["scripts/daily-workspace-map.mjs", "--check"], { cwd: frontend, stdio: "pipe" })).not.toThrow();
  });
  it("returns undefined for unknown ids and null for written exercises", () => {
    expect(exerciseWorkspaceDomain("d999", "g1")).toBeUndefined();
    expect(exerciseWorkspaceDomain("d004", "g99")).toBeUndefined();
    expect(exerciseWorkspaceDomain("d004", "x1")).toBeUndefined();
    const written = CURRICULUM.days.flatMap((d) => [...extrasById.get(d.id)!.guided, ...extrasById.get(d.id)!.independent].filter((e) => e.kind === "written").map((e) => [d.id, e.id] as const));
    expect(written.length).toBeGreaterThan(100);
    for (const [d, e] of written) expect(exerciseWorkspaceDomain(d, e), `${d}/${e}`).toBeNull();
  });
});

describe("lesson-level launch data", () => {
  it("gives every lesson a primary domain, because each has at least two graded exercises", () => {
    for (const d of CURRICULUM.days) {
      const l = lessonWorkspace(d.id, d.title, d.topics)!;
      expect(l, d.id).toBeDefined();
      expect(l.graded, d.id).toBeGreaterThanOrEqual(2);
      expect(l.primary, d.id).not.toBeNull();
      expect(l.presets.length, d.id).toBeGreaterThan(0);
      expect(l.graded + l.written, d.id).toBe(extrasById.get(d.id)!.guided.length + extrasById.get(d.id)!.independent.length);
    }
    expect(lessonWorkspace("d999", "x", [])).toBeUndefined();
  });
  it("runs the SQL phases in the SQL workspace and the pandas phase in pandas", () => {
    const primary = (id: string) => lessonWorkspace(id, "", [])!.primary;
    for (const d of CURRICULUM.days.filter((x) => x.phase === "sql-fundamentals")) expect(primary(d.id), d.id).toBe("sql");
    for (const id of ["d041", "d049", "d054"]) expect(primary(id), id).toBe("sql");
    for (const id of ["d001", "d004", "d026"]) expect(primary(id), id).toBe("python");
    expect(CURRICULUM.days.filter((x) => x.phase === "pandas").filter((d) => lessonWorkspace(d.id, "", [])!.primary === "pandas").length).toBeGreaterThanOrEqual(12);
    expect(CURRICULUM.days.filter((x) => x.phase === "numpy").filter((d) => ["numpy", "pandas"].includes(lessonWorkspace(d.id, "", [])!.primary!)).length).toBe(5);
  });
  it("builds exercise launch data: domain, presets and packages", () => {
    expect(exerciseWorkspace("d041", "g1", "LEFT JOIN", ["join"])).toEqual({ domain: "sql", presets: ["stages", "join"], packages: [] });
    expect(exerciseWorkspace("d001", "g1", "Install Python", ["REPL"])).toEqual({ domain: "python", presets: ["trace", "variables"], packages: [] });
    const withScipy = Object.keys(WORKSPACE_EXTRA_PACKAGES)[0];
    const [day, ex] = withScipy.split("/");
    expect(exerciseWorkspace(day, ex, "t", [])?.packages.length).toBeGreaterThan(0);
    const writtenDay = CURRICULUM.days.find((d) => WORKSPACE_EXERCISES[d.id].includes("w"))!;
    const row = WORKSPACE_EXERCISES[writtenDay.id].split("|");
    const idx = row[0].indexOf("w");
    if (idx >= 0) expect(exerciseWorkspace(writtenDay.id, `g${idx + 1}`, "t", [])).toBeNull();
  });
  it("chooses presets from the topic text", () => {
    expect(workspacePresetsFor("sql", "UNION and EXCEPT")).toEqual(["stages", "setops"]);
    expect(workspacePresetsFor("sql", "Reading EXPLAIN plans and indexes")).toEqual(["stages", "plan"]);
    expect(workspacePresetsFor("python", "Recursion")).toEqual(["trace", "variables", "callStack"]);
    expect(workspacePresetsFor("pandas", "merge and groupby")).toEqual(["beforeAfter", "merge", "groupby"]);
    expect(workspacePresetsFor("numpy", "Broadcasting rules")).toEqual(["shapes", "broadcast"]);
  });
});
