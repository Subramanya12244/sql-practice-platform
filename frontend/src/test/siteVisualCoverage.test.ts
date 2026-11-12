// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CURRICULUM } from "../site/lib/daily";
import { AID_NAMES, LESSON_OVERRIDES, LESSON_PRESETS, PRESET_KINDS, TEMPLATES, explainVisual, visualFor, visualHref, type VisualKind } from "../site/lib/visual/dailyVisual";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(here, "..", "..");
const read = (p: string) => fs.readFileSync(p, "utf8");
const days = CURRICULUM.days;
const choice = (d: (typeof days)[number]) => explainVisual({ id: d.id, title: d.title, topics: d.topics })!;

/** Aid kind -> component and lib file of the eight preset-aware aids. */
const AIDS: Record<string, { component: string; lib: string }> = {
  tree: { component: "TreeExplorer", lib: "tree" }, graph: { component: "GraphExplorer", lib: "graph" }, excel: { component: "ExcelLab", lib: "excel" },
  linux: { component: "LinuxLab", lib: "linux" }, git: { component: "GitLab", lib: "git" }, stats: { component: "StatsLab", lib: "stats" },
  business: { component: "BusinessLab", lib: "business" }, interview: { component: "InterviewLab", lib: "interview" },
};

describe("every lesson maps to a learning aid", () => {
  it("resolves all 270 lessons by id, with a reason, and never by the language fallback", () => {
    expect(days).toHaveLength(270);
    for (const d of days) {
      const c = choice(d);
      expect(c, d.id).toBeDefined();
      expect(c.why.length, d.id).toBeGreaterThan(10);
      expect(c.source, `${d.id} fell back to the language of its code`).not.toBe("language");
      expect(Object.keys(TEMPLATES), d.id).toContain(c.template.kind);
      expect(c.template.route, d.id).toBe(TEMPLATES[c.template.kind].route);
    }
  });
  it("keeps visualFor working with and without an id", () => {
    expect(visualFor({ title: "LEFT JOIN", topics: ["sql"] })).toBe(TEMPLATES.sql);
    expect(visualFor({ id: "d086", title: "Descriptive statistics", topics: ["mean"] })?.kind).toBe("stats");
    expect(visualFor({ title: "Team retrospective", topics: ["notes"] })).toBeUndefined();
  });
  it("every override and preset names a real lesson and a real aid", () => {
    const ids = new Set(days.map((d) => d.id));
    for (const id of Object.keys(LESSON_OVERRIDES)) { expect(ids.has(id), id).toBe(true); expect(Object.keys(TEMPLATES)).toContain(LESSON_OVERRIDES[id].kind); }
    for (const id of Object.keys(LESSON_PRESETS)) {
      expect(ids.has(id), id).toBe(true);
      expect(PRESET_KINDS, `${id} has a preset, but its aid ignores presets`).toContain(choice(days.find((d) => d.id === id)!).template.kind);
    }
  });
  it("sends lessons to the aid that fits, not to a code visualizer by default", () => {
    const kindOf = (id: string) => choice(days.find((d) => d.id === id)!).template.kind;
    expect(kindOf("a141")).toBe("business"); // stakeholder presentation, not the Python tracer
    expect(kindOf("a142")).toBe("business");
    for (const id of ["a167", "a168", "a169", "a170", "a171", "e169", "e170", "e171", "e172"]) expect(kindOf(id), id).toBe("interview");
    for (const id of ["d086", "d087", "d088", "d089", "d090", "a101", "a102", "a103"]) expect(kindOf(id), id).toBe("stats");
    for (const id of ["a094", "a096"]) expect(kindOf(id), id).toBe("excel");
    expect(kindOf("d029")).toBe("linux");
    expect(kindOf("d030")).toBe("git");
    expect(kindOf("e157")).toBe("graph");
    expect(kindOf("e153")).toBe("linux");
    expect(kindOf("d060")).toBe("sql"); // SQL COMMIT is not a Git commit
    expect(kindOf("a143")).toBe("business");
    expect(kindOf("a145")).toBe("business");
    // A capstone step goes to the aid that matches its work.
    expect(kindOf("a176")).toBe("sql");
    expect(kindOf("a177")).toBe("chart");
    expect(kindOf("e174")).toBe("api");
    expect(kindOf("a180")).toBe("interview");
  });
  it("lists a limit for every lesson whose aid is only a neighbouring fit", () => {
    const generic = days.filter((d) => choice(d).generic);
    expect(generic.length).toBeGreaterThan(20);
    // Power BI has no aid of its own: all 14 lessons are an honest approximation and must say so.
    for (const d of days.filter((x) => x.phase === "power-bi")) expect(choice(d).generic, d.id).toBeTruthy();
  });
});

describe("routes and links", () => {
  const routes = read(path.join(frontend, "src/site/routes.tsx"));
  const pages = read(path.join(frontend, "src/site/pages/VisualPages.tsx"));
  it("every aid route is registered and has a page", () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(routes, t.route).toContain(`path: "${t.route}"`);
      if (t.route.startsWith("/visual/")) expect(pages, t.route).toContain(`path="${t.route}"`);
    }
  });
  it("every lesson links to a registered route", () => {
    for (const d of days) {
      const href = visualHref(choice(d).template);
      expect(routes, d.id).toContain(`path: "${href.split("?")[0]}"`);
    }
  });
  it("builds the helper link with an encoded preset only when there is one", () => {
    expect(visualHref(TEMPLATES.sql)).toBe("/query-visualizer");
    expect(visualHref({ ...TEMPLATES.stats, preset: "t-test" })).toBe("/visual/stats?preset=t-test");
    expect(visualHref({ ...TEMPLATES.stats, preset: "a b&c" })).toBe("/visual/stats?preset=a%20b%26c");
    expect(AID_NAMES.tree).toBe("Tree Explorer");
  });
});

describe("presets exist in the aid", () => {
  for (const kind of PRESET_KINDS) {
    const { component, lib } = AIDS[kind];
    const wanted = days.map((d) => ({ id: d.id, preset: choice(d).template.preset })).filter((x) => x.preset && choice(days.find((d) => d.id === x.id)!).template.kind === kind);
    const placeholder = read(path.join(frontend, `src/site/components/visual/${component}.tsx`)).includes("is being built");
    const run = placeholder ? it.skip : it;
    // A skipped test names the reason: the aid component still holds the placeholder text.
    run(`${kind}: ${placeholder ? "SKIPPED, the aid is still a placeholder (\"is being built\"); presets cannot be checked yet. " : ""}${wanted.length} lessons reference presets that exist`, async () => {
      const mod = (await import(/* @vite-ignore */ `../site/lib/visual/${lib}`)) as { PRESETS?: { id: string }[] };
      expect(mod.PRESETS, `${lib}.ts must export PRESETS`).toBeDefined();
      const ids = new Set(mod.PRESETS!.map((p) => p.id));
      for (const w of wanted) expect(ids.has(w.preset!), `${w.id} -> ${kind} preset "${w.preset}" is not in ${lib}.ts PRESETS (${[...ids].join(", ")})`).toBe(true);
    });
  }
});

describe("lesson files are untouched", () => {
  it("git reports no change under src/site/content", () => {
    let top = "";
    try { top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
    if (!top) { console.info("SKIPPED: not a git checkout, cannot compare the lesson files"); return; }
    const rel = path.relative(top, path.join(frontend, "src/site/content"));
    const changed = execFileSync("git", ["diff", "--name-only", "--", rel], { cwd: top, encoding: "utf8" }).trim();
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", rel], { cwd: top, encoding: "utf8" }).trim();
    expect(changed, "tracked content files changed").toBe("");
    expect(untracked, "untracked content files added").toBe("");
  });
});

describe("docs/VISUAL_LEARNING_COVERAGE.md matches the mapping", () => {
  const doc = read(path.join(frontend, "..", "docs", "VISUAL_LEARNING_COVERAGE.md"));
  const rowOf = new Map<string, string>();
  for (const m of doc.matchAll(/^\| ([ade]\d{3}) \|(.*)$/gm)) rowOf.set(m[1], m[2]);
  const kinds = Object.keys(TEMPLATES) as VisualKind[];
  const counts = Object.fromEntries(kinds.map((k) => [k, days.filter((d) => choice(d).template.kind === k).length]));
  it("has one row per lesson, each naming the aid the mapping picks", () => {
    expect(rowOf.size, "run: node scripts/visual-coverage.mjs").toBe(270);
    for (const d of days) {
      const c = choice(d);
      expect(rowOf.get(d.id), d.id).toContain(`${AID_NAMES[c.template.kind]} (\`${visualHref(c.template)}\`)`);
    }
  });
  it("states the same per-aid counts as the mapping", () => {
    for (const k of kinds) {
      const m = doc.match(new RegExp(`^\\| ${AID_NAMES[k]} \\| ${k} \\| \`[^\`]+\` \\| (\\d+) \\|`, "m"));
      expect(m, `${k} row in the summary table (run: node scripts/visual-coverage.mjs)`).not.toBeNull();
      expect(Number(m![1]), k).toBe(counts[k]);
    }
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(270);
    expect(doc).toContain("Lessons with a learning aid: 270 of 270");
  });
  it("lists exactly the generic-fit lessons", () => {
    const generic = days.filter((d) => choice(d).generic);
    expect(doc).toContain(`Lessons where the aid is a generic or partial fit: ${generic.length}`);
  });
  it("reports preset status honestly", () => {
    for (const kind of PRESET_KINDS) {
      const placeholder = read(path.join(frontend, `src/site/components/visual/${AIDS[kind].component}.tsx`)).includes("is being built");
      const row = doc.match(new RegExp(`^\\| ${AID_NAMES[kind]} \\| ${kind} \\|.*$`, "m"))![0];
      if (placeholder) expect(row, `${kind} doc is stale: run node scripts/visual-coverage.mjs`).toContain("pending aid");
      else expect(row, `${kind} doc is stale: run node scripts/visual-coverage.mjs`).not.toContain("pending aid");
    }
  });
});
