// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import northwind from "../../public/data/northwind.sql?raw";
import routesSource from "../site/routes.tsx?raw";
import { CATEGORIES, CATEGORY_LABEL, PRESETS, QUESTIONS, answerLines, byCategory, questionById, type Cell, type Snippet } from "../site/lib/visual/interview";

const VENV_PYTHON = resolve(process.cwd(), "../.venv-daily/bin/python");
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";

const allSnippets = (): { id: string; where: string; s: Snippet }[] =>
  QUESTIONS.flatMap((q) => [
    ...q.answer.snippets.map((s, i) => ({ id: q.id, where: `answer ${i + 1}`, s })),
    ...q.followUps.flatMap((f, i) => (f.snippet ? [{ id: q.id, where: `follow-up ${i + 1}`, s: f.snippet }] : [])),
  ]);
const pythonSnippets = () => allSnippets().filter((x) => x.s.lang === "python");
const sqlSnippets = () => allSnippets().filter((x) => x.s.lang === "sql");

describe("question bank: structure", () => {
  it("has at least 24 questions with unique ids, covering every required area", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    for (const c of CATEGORIES) expect(byCategory(c).length, c).toBeGreaterThan(0);
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([...CATEGORIES].sort());
    expect(byCategory("all")).toBe(QUESTIONS);
    for (const id of ["sql-left-join-zero", "sql-not-in-null", "sql-dedupe-latest", "sql-top-n-ties", "sql-lag-mom", "sql-null-traps", "py-two-sum", "pd-merge-check", "etl-idempotent-load", "etl-incremental-watermark", "etl-late-data", "stats-ab-test", "case-metric-drop", "case-define-kpi", "beh-project-result-first", "beh-portfolio-walkthrough"]) expect(questionById(id), id).toBeDefined();
    expect(questionById("nope")).toBeUndefined();
  });

  it("exports PRESETS with a label per question", () => {
    expect(PRESETS).toHaveLength(QUESTIONS.length);
    expect(PRESETS.map((p) => p.id)).toEqual(QUESTIONS.map((q) => q.id));
    for (const p of PRESETS) expect(p.label.length).toBeGreaterThan(5);
  });

  it("every question is complete", () => {
    for (const q of QUESTIONS) {
      const at = (what: string) => `${q.id}: ${what}`;
      expect(/^[a-z0-9-]+$/.test(q.id), at("id format")).toBe(true);
      expect(CATEGORIES, at("category")).toContain(q.category);
      expect(["warm-up", "core", "stretch"], at("level")).toContain(q.level);
      expect(q.title.length, at("title")).toBeGreaterThan(8);
      expect(q.prompt.length, at("prompt")).toBeGreaterThan(40);
      expect(q.minutes, at("minutes")).toBeGreaterThan(4);
      expect(q.clarify.length, at("clarifying questions")).toBeGreaterThanOrEqual(3);
      expect(q.hints.length, at("hints")).toBeGreaterThanOrEqual(3);
      expect(q.approach.length, at("approach")).toBeGreaterThanOrEqual(4);
      expect(q.answer.text.length, at("answer text")).toBeGreaterThan(200);
      expect(q.pitfalls.length, at("pitfalls")).toBeGreaterThanOrEqual(3);
      expect(q.followUps.length, at("follow-ups")).toBeGreaterThanOrEqual(2);
      for (const f of q.followUps) { expect(f.q.length, at("follow-up question")).toBeGreaterThan(10); expect(f.hint.length, at("follow-up hint")).toBeGreaterThan(10); expect(f.answer.length, at("follow-up answer")).toBeGreaterThan(40); }
      expect(q.rubric.length, at("rubric")).toBeGreaterThanOrEqual(4);
      expect(q.withheld.length, at("withheld terms")).toBeGreaterThan(0);
      for (const list of [q.clarify, q.hints, q.approach, q.pitfalls, q.rubric]) for (const item of list) { expect(item.trim().length, at("item")).toBeGreaterThan(15); expect(item, at("no placeholder")).not.toMatch(/\b(TODO|TBD|lorem)\b/i); }
      // SQL and Python categories always ship a runnable, checked example.
      if (q.category === "sql" || q.category === "python" || q.category === "pandas") expect(q.answer.snippets.length, at("snippets")).toBeGreaterThan(0);
    }
  });

  it("covers the topics the brief requires", () => {
    const text = QUESTIONS.map((q) => `${q.title} ${q.prompt} ${q.answer.text}`).join(" ").toLowerCase();
    for (const topic of ["join", "window", "dedup", "null", "complexity|linear time", "idempoten", "incremental", "late", "a/b", "p-value", "kpi", "portfolio", "rebase"]) expect(new RegExp(topic).test(text), topic).toBe(true);
    // "top-N per group": the ranking-function question covers it
    expect(text).toMatch(/highest-paid employee in each department|top two products per region/);
  });
});

describe("hints never give the answer", () => {
  it("the first hint names the concept; later hints stay conceptual", () => {
    for (const q of QUESTIONS) expect(q.hints[0].startsWith("Concept:"), q.id).toBe(true);
  });
  it("no hint contains a withheld term, a line of the answer's code, or a long run of the answer text", () => {
    for (const q of QUESTIONS) {
      const lines = answerLines(q).map((l) => l.toLowerCase());
      for (const hint of [...q.hints, ...q.followUps.map((f) => f.hint)]) {
        const h = hint.toLowerCase();
        for (const term of q.withheld) expect(h.includes(term.toLowerCase()), `${q.id}: hint "${hint}" contains withheld "${term}"`).toBe(false);
        for (const line of lines) expect(h.includes(line), `${q.id}: hint repeats answer line "${line}"`).toBe(false);
        // any 8-word run copied from the example answer would be a leak
        const words = q.answer.text.toLowerCase().split(/\s+/);
        for (let i = 0; i + 8 <= words.length; i++) expect(h.includes(words.slice(i, i + 8).join(" ")), `${q.id}: hint copies the answer text`).toBe(false);
      }
    }
  });
  it("every withheld term really is part of the answer (so the list is meaningful)", () => {
    for (const q of QUESTIONS) {
      const answer = [q.answer.text, ...q.answer.snippets.map((s) => `${s.setup ?? ""}\n${s.code}`), ...q.followUps.map((f) => `${f.answer}\n${f.snippet?.code ?? ""}`)].join("\n").toLowerCase();
      expect(q.withheld.some((t) => answer.includes(t.toLowerCase())), `${q.id}: none of ${q.withheld.join(", ")} appears in the answer`).toBe(true);
    }
  });
  it("the prompt does not state the answer's key terms for SQL questions that ask for a technique", () => {
    // A prompt may name the problem (NOT IN) but the withheld function names must not be in any prompt or clarifying question.
    for (const q of QUESTIONS) for (const term of q.withheld.filter((t) => /^[A-Z_]+\(|^[A-Z ]{6,}$/.test(t))) {
      expect(`${q.prompt} ${q.clarify.join(" ")}`.includes(term), `${q.id}: prompt reveals ${term}`).toBe(false);
    }
  });
});

describe("links point at routes that exist", () => {
  const routes = new Set([...routesSource.matchAll(/path: "(\/[^"]*)"/g)].map((m) => m[1]));
  it("every concept link is a real route", () => {
    expect(routes.has("/visual/git")).toBe(true);
    let linked = 0;
    for (const q of QUESTIONS) if (q.link) { linked++; expect(routes.has(q.link.to), `${q.id} -> ${q.link.to}`).toBe(true); expect(q.link.label.length).toBeGreaterThan(5); }
    expect(linked).toBeGreaterThanOrEqual(20);
    const targets = new Set(QUESTIONS.map((q) => q.link?.to));
    for (const t of ["/query-visualizer", "/visual/python", "/visual/data", "/visual/etl", "/visual/stats", "/visual/business", "/visual/git"]) expect(targets.has(t), t).toBe(true);
  });
  it("links match the topic of the category", () => {
    const expected: Record<string, string> = { sql: "/query-visualizer", python: "/visual/python", pandas: "/visual/data", etl: "/visual/etl", stats: "/visual/stats", case: "/visual/business", git: "/visual/git" };
    for (const q of QUESTIONS) if (q.link) expect(q.link.to, q.id).toBe(expected[q.category]);
  });
});

describe("the stated outputs are true: Python snippets are run with real Python", () => {
  it("there are Python snippets to check", () => { expect(pythonSnippets().length).toBeGreaterThanOrEqual(10); });
  const cases = pythonSnippets();
  for (const { id, where, s } of cases) {
    it(`${id} (${where}): ${s.title}`, () => {
      const r = spawnSync(PYTHON, ["-I", "-c", s.code], { cwd: tmpdir(), encoding: "utf8", timeout: 60_000 });
      expect(r.stderr, "stderr").toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout.trimEnd()).toBe((s.expect.stdout ?? "").trimEnd());
    }, 90_000);
  }
});

describe("the stated outputs are true: SQL snippets are run on PostgreSQL (PGlite, Northwind)", () => {
  let pg: PGlite;
  beforeAll(async () => { pg = new PGlite(); await pg.exec(northwind); }, 120_000);
  it("there are SQL snippets to check", () => { expect(sqlSnippets().length).toBeGreaterThanOrEqual(10); });

  const same = (a: unknown, b: Cell): boolean => {
    if (a === null || b === null) return a === b;
    const sa = String(a), sb = String(b);
    return sa === sb || (sa.trim() !== "" && sb.trim() !== "" && !Number.isNaN(Number(sa)) && !Number.isNaN(Number(sb)) && Number(sa) === Number(sb));
  };

  for (const { id, where, s } of sqlSnippets()) {
    it(`${id} (${where}): ${s.title}`, async () => {
      await pg.exec("BEGIN");
      try {
        if (s.setup) await pg.exec(s.setup);
        const results = await pg.exec(s.code);
        const last = results[results.length - 1];
        const columns = last.fields.map((f) => f.name);
        expect(columns).toEqual(s.expect.columns);
        const rows = (last.rows as Record<string, unknown>[]).map((r) => columns.map((c) => r[c]));
        expect(rows.length).toBe(s.expect.rows!.length);
        rows.forEach((row, i) => row.forEach((cell, j) => expect(same(cell, s.expect.rows![i][j]), `row ${i} column ${columns[j]}: got ${String(cell)}, stated ${String(s.expect.rows![i][j])}`).toBe(true)));
      } finally { await pg.exec("ROLLBACK"); }
    }, 60_000);
  }

  it("SQL answers that name a wrong result also show the right one (NOT IN gives 0, NOT EXISTS gives 2)", async () => {
    const q = questionById("sql-not-in-null")!;
    expect(q.answer.snippets[0].expect.rows).toEqual([[0, 2]]);
  });
});

describe("numbers quoted in prose agree with the checked snippets", () => {
  it("A/B test: rates, z and p quoted in the answer text match the snippet output", () => {
    const q = questionById("stats-ab-test")!;
    expect(q.answer.snippets[0].expect.stdout).toBe("0.050 0.065 z=2.23 p=0.0256");
    expect(q.answer.text).toContain("5.0%");
    expect(q.answer.text).toContain("6.5%");
    expect(q.answer.text).toContain("0.026");
  });
  it("Simpson's paradox: percentages in the text match the snippet", () => {
    const q = questionById("stats-simpson")!;
    for (const pct of ["93.1%", "86.7%", "73.0%", "68.8%", "82.6%", "78.0%"]) expect(q.answer.text).toContain(pct);
    expect(q.answer.snippets[0].expect.stdout).toContain("'A': 0.931, 'B': 0.867");
    expect(q.answer.snippets[0].expect.stdout).toContain("overall {'A': 0.78, 'B': 0.826}");
  });
  it("metric drop: the quoted drop equals the conversion effect in the snippet", () => {
    const q = questionById("case-metric-drop")!;
    expect(q.answer.text).toContain("48,000");
    expect(q.answer.snippets[0].expect.stdout).toContain("conversion -48000");
  });
  it("ten independent tests at 5%: about 40% chance of a false positive", () => {
    expect(Math.round((1 - 0.95 ** 10) * 100)).toBe(40);
    expect(questionById("stats-ab-test")!.followUps[1].answer).toContain("about 40%");
  });
});
