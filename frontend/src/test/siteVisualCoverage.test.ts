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

/**
 * Phase 2 (workspace content quality) replaced the third hint of 17 guided exercises, because that hint was the complete answer.
 * Those are the only lesson edits allowed, and only their `hints[2]` may differ from the committed file. Everything else under
 * src/site/content is unchanged, except new files in content/workspace (the enrichment data).
 */
const ALLOWED_HINT_EDITS: Record<string, string[]> = {
  d001: ["g1", "g2"], d031: ["g1", "g2", "g4"], d032: ["g1", "g2"], d034: ["g4"], d036: ["g1", "g4"], d047: ["g1", "g3", "g4"], d054: ["g1"], d058: ["g1", "g3", "g4"],
};

describe("lesson files are untouched", () => {
  it("git reports no change under src/site/content except the 17 replaced answer-hints and the workspace enrichment data", () => {
    let top = "";
    try { top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
    if (!top) { console.info("SKIPPED: not a git checkout, cannot compare the lesson files"); return; }
    const rel = path.relative(top, path.join(frontend, "src/site/content")).split(path.sep).join("/");
    const lines = (a: string[]) => execFileSync("git", a, { cwd: top, encoding: "utf8" }).split("\n").map((l) => l.trim()).filter(Boolean);
    const changed = lines(["diff", "--name-only", "--", rel]);
    const untracked = lines(["ls-files", "--others", "--exclude-standard", "--", rel]);
    expect(untracked.filter((f) => !f.startsWith(`${rel}/workspace/`)), "untracked content files outside content/workspace").toEqual([]);
    const allowedFiles = Object.keys(ALLOWED_HINT_EDITS).map((d) => `${rel}/daily/days/${d}.json`);
    expect(changed.filter((f) => !allowedFiles.includes(f)), "tracked content files changed outside the allowed hint edits").toEqual([]);
    for (const f of changed) {
      const day = path.basename(f, ".json");
      const before = JSON.parse(execFileSync("git", ["show", `HEAD:${f}`], { cwd: top, encoding: "utf8" }));
      const after = JSON.parse(read(path.join(top, f)));
      for (const e of [...(after.guided ?? [])]) if (ALLOWED_HINT_EDITS[day].includes(e.id)) e.hints[2] = "<edited>";
      for (const e of [...(before.guided ?? [])]) if (ALLOWED_HINT_EDITS[day].includes(e.id)) e.hints[2] = "<edited>";
      expect(after, `${f}: something other than the allowed hint changed`).toEqual(before);
    }
  });
  it("no guided hint is the complete solution any more (same normalisation as the workspace's leaksSolution)", () => {
    const norm = (s: string) => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").replace(/\s*([(),;=<>+\-*/])\s*/g, "$1").replace(/;+$/, "").trim();
    const dir = path.join(frontend, "src/site/content/daily/days");
    const leaks: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const j = JSON.parse(read(path.join(dir, f))) as { guided?: { id: string; kind: string; hints?: string[]; solution?: string }[]; independent?: { id: string; kind: string; hints?: string[]; solution?: string }[] };
      for (const e of [...(j.guided ?? []), ...(j.independent ?? [])]) {
        const sol = norm(e.solution ?? "");
        if (e.kind === "written" || sol.length < 12) continue;
        (e.hints ?? []).forEach((h, i) => { if (norm(h).includes(sol)) leaks.push(`${f.slice(0, -5)}#${e.id} hint ${i + 1}`); });
      }
    }
    expect(leaks).toEqual([]);
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
