// @vitest-environment node
import { describe, expect, it } from "vitest";
import indexJson from "../../public/data/index.json";
import registry from "../site/content/tracks.json";
import {
  COMPANY_TYPES, ROLE_PATHS, answerQueue, hoursNeeded, interviewQA, isDone, keyTerms, nextAnswerState, planItems, portfolioMarkdown,
  schedule, termCoverage, type PlanItem, type PlanSource, type Portfolio,
} from "../site/lib/career";
import { NOTE_CATEGORIES, parseNote } from "../site/lib/learning";
import { mergeProgress } from "../site/lib/account";
import type { Progress } from "../site/lib/progress";
import type { QuestionSummary } from "../site/types";

const glob = (g: Record<string, string>) => Object.entries(g);
const noteFiles = glob(import.meta.glob<string>("../site/content/notes/*/*.md", { eager: true, query: "?raw", import: "default" }));
const setFiles = glob(import.meta.glob<string>("../site/content/sets/*.md", { eager: true, query: "?raw", import: "default" }));
const scenarioFiles = glob(import.meta.glob<string>("../site/content/scenarios/*.md", { eager: true, query: "?raw", import: "default" }));
const pyFiles = glob(import.meta.glob<string>("../site/content/python/*.md", { eager: true, query: "?raw", import: "default" }));
const slug = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");
const notes = noteFiles.map(([p, r]) => parseNote(r, slug(p), p.split("/").slice(-2, -1)[0]));
const index = indexJson as QuestionSummary[];

const src: PlanSource = {
  notes, index,
  sets: setFiles.map(([p, r]) => ({ slug: slug(p), questions: (r.match(/^questions:\s*\[([^\]]*)\]/m)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) })),
  scenarios: scenarioFiles.map(([p]) => ({ slug: slug(p), title: slug(p) })),
  exercises: pyFiles.map(([p]) => ({ slug: slug(p), title: slug(p) })),
  projects: (registry.projects as { slug: string; title: string; level: string }[]),
};
const EMPTY: Progress = { version: 1, questions: {}, activeDays: [], cards: {} };

describe("career content references", () => {
  const cats = new Set(NOTE_CATEGORIES.map((c) => c.slug));
  const sets = new Set(src.sets.map((s) => s.slug));
  const scen = new Set(src.scenarios.map((s) => s.slug));
  const proj = new Set(src.projects.map((p) => p.slug));
  it("role paths only reference existing categories, sets, scenarios and projects", () => {
    const bad: string[] = [];
    for (const r of ROLE_PATHS) for (const st of r.stages) {
      for (const c of st.categories ?? []) if (!cats.has(c)) bad.push(`${r.id}: category ${c}`);
      if (st.set && !sets.has(st.set)) bad.push(`${r.id}: set ${st.set}`);
      for (const s of st.scenarios ?? []) if (!scen.has(s)) bad.push(`${r.id}: scenario ${s}`);
      for (const p of st.projects ?? []) if (!proj.has(p)) bad.push(`${r.id}: project ${p}`);
    }
    expect(bad).toEqual([]);
  });
  it("company types do too, and never name a real company", () => {
    const bad: string[] = [];
    for (const c of COMPANY_TYPES) {
      for (const cat of c.categories) if (!cats.has(cat)) bad.push(`${c.id}: category ${cat}`);
      if (!sets.has(c.set)) bad.push(`${c.id}: set ${c.set}`);
      for (const s of c.scenarios) if (!scen.has(s)) bad.push(`${c.id}: scenario ${s}`);
      for (const p of c.projects) if (!proj.has(p)) bad.push(`${c.id}: project ${p}`);
      if (/google|amazon|meta|facebook|apple|netflix|microsoft|uber|airbnb/i.test(JSON.stringify(c))) bad.push(`${c.id}: names a company`);
    }
    expect(bad).toEqual([]);
  });
});

describe("planner", () => {
  it("builds every role from real items with no duplicates", () => {
    for (const r of ROLE_PATHS) {
      const items = planItems(r.id, src);
      expect(items.length).toBeGreaterThan(20);
      expect(new Set(items.map((i) => `${i.kind}:${i.ref}`)).size).toBe(items.length);
    }
    expect(planItems("data-engineer", src).some((i) => i.kind === "project")).toBe(true);
  });
  it("fills weeks up to the budget without splitting items", () => {
    const it = (m: number, ref: string): PlanItem => ({ kind: "note", ref, title: ref, path: "/", minutes: m, stage: "s" });
    const weeks = schedule([it(50, "a"), it(50, "b"), it(30, "c"), it(200, "d"), it(10, "e")], { role: "data-analyst", start: "2026-01-05", weeks: 2, hoursPerWeek: 2 });
    expect(weeks.map((w) => w.items.map((i) => i.ref))).toEqual([["a", "b"], ["c"], ["d"], ["e"]]);
    expect(weeks[1].start).toBe("2026-01-12");
    expect(hoursNeeded([it(60, "a"), it(60, "b"), it(90, "c")], 2)).toBe(2);
  });
  it("marks items done only from evidence", () => {
    const p: Progress = { ...EMPTY, read: { "inner-join": "x" }, questions: { 25: { attempts: 1, solvedAt: "x" }, 26: { attempts: 3 } }, lessons: { "py:a": "x", "scenario:b": "x" } };
    const ctx = { progress: p, completedProjects: new Set(["proj"]), mocksSinceStart: 1 };
    const t = (kind: PlanItem["kind"], ref: string) => isDone({ kind, ref, title: "", path: "", minutes: 1, stage: "" }, ctx, 0);
    expect([t("note", "inner-join"), t("note", "left-join"), t("question", "25"), t("question", "26")]).toEqual([true, false, true, false]);
    expect([t("python", "a"), t("scenario", "b"), t("project", "proj"), t("project", "other"), t("mock", "m")]).toEqual([true, true, true, false, true]);
    expect(isDone({ kind: "mock", ref: "m2", title: "", path: "", minutes: 1, stage: "" }, ctx, 1)).toBe(false);
  });
});

describe("answer practice", () => {
  const bank = notes.flatMap(interviewQA);
  it("extracts question and answer pairs from every note", () => {
    expect(bank.length).toBeGreaterThan(400);
    expect(new Set(bank.map((c) => c.key)).size).toBe(bank.length);
    expect(bank.every((c) => !c.answer.startsWith("##"))).toBe(true);
    const cross = bank.find((c) => c.key === "cross-join#0");
    expect(cross?.question).toBe("What does CROSS JOIN return?");
  });
  it("finds key terms and reports coverage without grading", () => {
    const terms = keyTerms("Use `LEFT JOIN` and keep rows where the key IS NULL. **Anti-join**.");
    expect(terms).toEqual(expect.arrayContaining(["LEFT JOIN", "Anti-join", "IS NULL"]));
    expect(termCoverage("a left  join then filter is null", ["LEFT JOIN", "Anti-join"])).toEqual([{ term: "LEFT JOIN", hit: true }, { term: "Anti-join", hit: false }]);
  });
  it("schedules misses sooner and orders due before new", () => {
    const a = nextAnswerState(undefined, "nailed", "2026-01-01");
    expect([a.box, a.due]).toEqual([1, "2026-01-02"]);
    const b = nextAnswerState(a, "nailed", "2026-01-02");
    expect([b.box, b.due, b.attempts]).toEqual([2, "2026-01-04", 2]);
    expect(nextAnswerState(b, "missed", "2026-01-04").box).toBe(1);
    expect(nextAnswerState(b, "partly", "2026-01-04").box).toBe(2);
    const q = answerQueue(bank.slice(0, 3), { [bank[2].key]: { ...a, due: "2026-01-01" } }, "2026-01-05");
    expect(q.map((c) => c.key)).toEqual([bank[2].key, bank[0].key, bank[1].key]);
  });
  it("syncs answer state with the account without losing attempts", () => {
    const local = { ...EMPTY, answers: { k: { box: 2, due: "d", rating: "nailed" as const, at: "2026-01-02", attempts: 2 } }, plan: { role: "data-engineer" as const, start: "2026-01-01", weeks: 8, hoursPerWeek: 5 } };
    const merged = mergeProgress(local, [], { answers: { k: { box: 1, due: "d", rating: "missed", at: "2026-01-03", attempts: 1 }, j: { box: 1, due: "d", rating: "partly", at: "x", attempts: 1 } }, plan: { role: "data-analyst", start: "x", weeks: 1, hoursPerWeek: 1 } }, []);
    expect(merged.answers?.k.attempts).toBe(2);
    expect(Object.keys(merged.answers ?? {}).sort()).toEqual(["j", "k"]);
    expect(merged.plan?.role).toBe("data-engineer");
  });
});

describe("portfolio export", () => {
  it("lists imported solves separately and marks reviewer approval", () => {
    const p: Portfolio = {
      name: "A", headline: "", sql: { independent: 10, assisted: 2, imported: 80, total: 191, practicedDays: 5 },
      topics: [{ label: "Joins", solved: 4, total: 20 }], tracks: [{ title: "SQL", read: 3, total: 65 }],
      projects: [{ slug: "p", title: "ETL", status: "Completed", passed: 3, automated: 3, repo: "https://github.com/a/b", reviewerApproved: true }],
      python: 0, scenarios: 1, mocks: { count: 0, best: null }, quality: [], answers: { practiced: 0, nailed: 0 },
    };
    const md = portfolioMarkdown(p, "https://x.test");
    expect(md).toContain("10 questions solved independently, 2 with hints (of 191)");
    expect(md).toContain("80 more marked solved from an imported history (not practised here)");
    expect(md).toContain("**ETL**: Completed (reviewer approved), 3/3 automated checks passed — https://github.com/a/b");
    expect(md).not.toContain("Python exercises");
  });
});
