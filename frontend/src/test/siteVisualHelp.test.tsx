import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HELP, HELP_IDS, PLAYBACK_CONTROLS, helpFor, type HelpId } from "../site/lib/visual/helpContent";
import { VisualHelp } from "../site/components/visual/VisualHelp";
import * as Pages from "../site/pages/VisualPages";

// The pages mount a lazy Monaco editor; a null stub stands in so the test stays about Help.
vi.mock("../site/components/CodeEditor", () => ({ default: () => null }));
vi.mock("../site/SiteApp", () => ({ usePage: () => ({ data: {}, params: {} }) }));
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
afterEach(cleanup);

const ALL: HelpId[] = ["sql", "python", "data", "api", "etl", "charts", "tree", "graph", "excel", "linux", "git", "stats", "business", "interview"];
const LABELS = /\b(Executed|Parsed|Plan|Estimated|Conceptual|Simulated)\b/;
/** Words that mean a draft or placeholder leaked into learner-facing text. */
const DRAFT = /\b(todo|tbd|fixme|lorem|placeholder|draft|coming soon|is being built|xxx)\b/i;
const OLD_DRAFT_LINES = ["Pick an example or change the inputs.", "Use the playback controls to step through.", "Each badge says whether the data is real, modelled or simulated.", "Open the first preset and press Next step until the end."];

const texts = (id: HelpId) => {
  const h = HELP[id];
  return [h.title, h.what, ...h.how, ...(h.controls ?? []).flatMap((c) => [c.name, c.does]), ...h.reading, ...h.mistakes, h.example, ...(h.walkthrough ?? []).flatMap((w) => [w.title, w.body])];
};

describe("help content", () => {
  it("covers exactly the 14 modules", () => {
    expect([...HELP_IDS].sort()).toEqual([...ALL].sort());
    expect(Object.keys(HELP).sort()).toEqual([...ALL].sort());
  });

  for (const id of ALL) {
    describe(id, () => {
      const h = HELP[id];
      it("has every field filled in, with no draft text", () => {
        expect(helpFor(id)).toBe(h);
        for (const t of texts(id)) { expect(t.trim().length, `${id}: empty text`).toBeGreaterThan(0); expect(t, `${id}: draft text`).not.toMatch(DRAFT); }
        expect(h.title.length).toBeGreaterThan(5);
        expect(h.what.length).toBeGreaterThan(60);
        expect(h.how.length, "steps").toBeGreaterThanOrEqual(3);
        expect(h.reading.length, "reading").toBeGreaterThanOrEqual(3);
        expect(h.mistakes.length, "mistakes").toBeGreaterThanOrEqual(3);
        expect(h.example.length, "example").toBeGreaterThan(80);
        expect((h.controls ?? []).length, "tool-specific controls").toBeGreaterThanOrEqual(2);
        for (const old of OLD_DRAFT_LINES) expect(texts(id)).not.toContain(old);
      });
      it("says which parts are executed, parsed, planned, estimated, conceptual or simulated", () => {
        expect(h.reading.join(" ")).toMatch(LABELS);
      });
      it("repeats no line within a list (the component uses the text as its React key)", () => {
        for (const list of [h.how, h.reading, h.mistakes, (h.controls ?? []).map((c) => c.name)]) expect(new Set(list).size).toBe(list.length);
      });
      it("has a walkthrough of 3 to 6 steps", () => {
        expect(h.walkthrough, "walkthrough").toBeDefined();
        expect(h.walkthrough!.length).toBeGreaterThanOrEqual(3);
        expect(h.walkthrough!.length).toBeLessThanOrEqual(6);
      });
    });
  }

  it("explains the SQL Query Cinema: stages, row animation, reduced motion, set operations, plan tab and compare", () => {
    const t = texts("sql").join(" ").toLowerCase();
    for (const w of ["logical", "row animation", "reduce motion", "union", "intersect", "except", "execution plan", "explain analyze", "compare two queries", "estimated", "executed", "parsed"]) expect(t, w).toContain(w);
  });
  it("explains the Python trace, truncation and the conceptual memory model", () => {
    const t = texts("python").join(" ").toLowerCase();
    for (const w of ["executed", "conceptual", "memory model", "first iterations", "summary", "checkpoints", "last iterations", "gap marker", "sampled", "call stack"]) expect(t, w).toContain(w);
  });
  it("describes each new aid by what it covers", () => {
    const covers: Record<string, string[]> = {
      tree: ["insert", "search", "delete", "in-order", "call stack", "queue", "height", "depth", "degenerate"],
      graph: ["bfs", "dfs", "dijkstra", "bellman-ford", "cycle", "components", "topological", "queue", "stack", "visited"],
      excel: ["formula", "lookup", "pivot", "conditional formatting", "cleaning", "simulated"],
      linux: ["terminal", "virtual file system", "pipe", "redirection", "permissions", "processes", "simulated"],
      git: ["commit", "three areas", "merge", "rebase", "conflict", "simulated"],
      stats: ["distribution", "spread", "probability", "sampling", "confidence interval", "hypothesis", "regression", "seeded"],
      business: ["kpi", "variance waterfall", "cohort", "funnel", "rfm", "decision", "assumptions"],
      interview: ["hint", "example answer", "follow-up"],
    };
    for (const [id, words] of Object.entries(covers)) {
      const t = texts(id as HelpId).join(" ").toLowerCase();
      for (const w of words) expect(t, `${id}: ${w}`).toContain(w);
    }
  });
});

describe("VisualHelp component", () => {
  it("renders every section, the playback controls and the tool's own controls", () => {
    for (const id of ALL) {
      const h = HELP[id];
      const { container, unmount } = render(<VisualHelp id={id} />);
      const root = container.querySelector("details")!;
      expect(root.getAttribute("aria-label")).toBe(`Help: ${h.title}`);
      const view = within(root);
      for (const s of ["What it does.", "How to use it", "Controls", "How to read what you see", "Common mistakes", "Example."]) expect(view.getByText(s), `${id}: ${s}`).toBeTruthy();
      expect(root.querySelectorAll("ol li").length).toBe(h.how.length);
      const names = [...root.querySelectorAll("dt")].map((d) => d.textContent);
      for (const c of PLAYBACK_CONTROLS) expect(names, `${id}: ${c.name}`).toContain(c.name);
      for (const c of h.controls ?? []) expect(names, `${id}: ${c.name}`).toContain(c.name);
      expect(names.length).toBe(PLAYBACK_CONTROLS.length + (h.controls ?? []).length);
      expect(root.textContent).toContain(h.example);
      unmount();
    }
  });
  it("walks through the guided steps with Back, Next and Finish", () => {
    for (const id of ALL) {
      const steps = HELP[id].walkthrough!;
      const { unmount } = render(<VisualHelp id={id} />);
      fireEvent.click(screen.getByRole("button", { name: `Take the guided walkthrough (${steps.length} steps)` }));
      const tour = () => screen.getByRole("group", { name: "Guided walkthrough" });
      for (let i = 0; i < steps.length; i++) {
        expect(tour().textContent, `${id} step ${i + 1}`).toContain(`Step ${i + 1} of ${steps.length}`);
        expect(tour().textContent).toContain(steps[i].title);
        expect(tour().textContent).toContain(steps[i].body);
        if (i === 0) expect((within(tour()).getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(within(tour()).getByRole("button", { name: i + 1 < steps.length ? "Next" : "Finish" }));
      }
      expect(screen.queryByRole("group", { name: "Guided walkthrough" }), `${id}: Finish closes the tour`).toBeNull();
      expect(screen.getByRole("button", { name: /Take the guided walkthrough/ })).toBeTruthy();
      unmount();
    }
  });
  it("goes back a step", () => {
    const steps = HELP.sql.walkthrough!;
    render(<VisualHelp id="sql" />);
    fireEvent.click(screen.getByRole("button", { name: /Take the guided walkthrough/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("group", { name: "Guided walkthrough" }).textContent).toContain(steps[1].title);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("group", { name: "Guided walkthrough" }).textContent).toContain(steps[0].title);
  });
});

describe("every visual page shows its Help", () => {
  const src = fs.readFileSync(path.join(__dirname, "../site/pages/VisualPages.tsx"), "utf8");
  const sql = fs.readFileSync(path.join(__dirname, "../site/pages/QueryVisualizerPage.tsx"), "utf8");
  const PAGES: [string, HelpId][] = [
    ["PythonVisualPage", "python"], ["DataVisualPage", "data"], ["ApiVisualPage", "api"], ["EtlVisualPage", "etl"], ["ChartsVisualPage", "charts"],
    ["TreeVisualPage", "tree"], ["GraphVisualPage", "graph"], ["ExcelVisualPage", "excel"], ["LinuxVisualPage", "linux"], ["GitVisualPage", "git"],
    ["StatsVisualPage", "stats"], ["BusinessVisualPage", "business"], ["InterviewVisualPage", "interview"],
  ];
  for (const [name, id] of PAGES) {
    it(`${name} renders Help: ${HELP[id].title}`, () => {
      const Page = (Pages as unknown as Record<string, () => JSX.Element>)[name];
      expect(Page, name).toBeDefined();
      render(<MemoryRouter><Page /></MemoryRouter>);
      expect(screen.getByLabelText(`Help: ${HELP[id].title}`), name).toBeTruthy();
    });
  }
  it("the SQL visualizer page and every page in VisualPages.tsx use a help id from the table", () => {
    expect(sql).toMatch(/<VisualHelp id="sql"/);
    const used = [...src.matchAll(/\bhelp="(\w+)"/g)].map((m) => m[1]);
    expect(new Set(used)).toEqual(new Set(ALL.filter((i) => i !== "sql")));
  });
});
