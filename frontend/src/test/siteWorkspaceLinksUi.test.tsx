// The workspace blocks in a browser-like DOM: the empty snapshot first, then real progress from the existing stores, links that point to
// /workspace?e=<encoded id>, and nothing written when a link is clicked (project status in particular).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderToString } from "react-dom/server";
import { LinkedExerciseList, NextQuestionLink, PathWorkspaceStep, WorkspacePracticeBlock } from "../site/components/learn/WorkspacePractice";
import { completeExercise, recordAttempt, resetProgress, updateDay } from "../site/lib/progress";
import { recordPyAttempt } from "../site/lib/pyPractice";
import { getProjectProgress, projectStatus, saveProjectProgress } from "../site/lib/projects";
import { workspaceUrl } from "../site/components/WorkspaceLink";
import { CURRICULUM, isAuthored } from "../site/lib/daily";
import { exercisesForTask, lessonWorkspaceIds, type PracticeItem } from "../site/lib/workspaceLinks";

const ITEMS: PracticeItem[] = [
  { id: "sql:q05-top-5-customers-by-number-of-orders", title: "Top 5 Customers By Number Of Orders", difficulty: "Easy", domain: "sql" },
  { id: "py:cart-line-total", title: "Cart Line Total", difficulty: "Easy", domain: "python" },
  { id: "daily:d031#g1", title: "A daily exercise", difficulty: "Easy", domain: "sql" },
  { id: "py:merge-intervals", title: "Merge Intervals", difficulty: "Medium", domain: "python" },
];
const wrap = (ui: React.ReactElement) => (
  <MemoryRouter initialEntries={["/start"]}><Routes><Route path="/start" element={ui} /><Route path="/workspace" element={<Where />} /></Routes></MemoryRouter>
);
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }

beforeEach(() => { localStorage.clear(); resetProgress(); });
afterEach(cleanup);

describe("WorkspacePracticeBlock", () => {
  it("server render (empty snapshot) lists the exercises as not started and shows no count", () => {
    const html = renderToString(<MemoryRouter><WorkspacePracticeBlock items={ITEMS} /></MemoryRouter>);
    expect(html).toContain("Practise in the workspace");
    for (const i of ITEMS) expect(html).toContain(`href="${workspaceUrl(i.id).replace(/&/g, "&amp;")}"`);
    expect(html).not.toContain("Solved");
    expect(html).not.toContain("solved</span>");
    expect((html.match(/Not started/g) ?? []).length).toBe(ITEMS.length);
  });

  it("every link is /workspace?e=<encoded id>", () => {
    render(wrap(<WorkspacePracticeBlock items={ITEMS} />));
    const links = screen.getAllByTestId("workspace-exercise-link");
    expect(links).toHaveLength(4);
    for (const [n, a] of links.entries()) expect(a.getAttribute("href")).toBe(`/workspace?e=${encodeURIComponent(ITEMS[n].id)}`);
    expect(links[2].getAttribute("href")).toBe("/workspace?e=daily%3Ad031%23g1");
  });

  it("shows real progress from the SQL, Python and Daily stores, and a count after mount", () => {
    recordAttempt(5, "select 1", true);
    recordAttempt(32, "select 1", false); // some other question: not in the list
    completeExercise("py:cart-line-total");
    recordPyAttempt("merge-intervals", false);
    updateDay("d031", (r) => ({ ...r, attempted: ["g1"] }));
    render(wrap(<WorkspacePracticeBlock items={ITEMS} />));
    const rows = screen.getAllByTestId("workspace-exercise-link");
    expect(within(rows[0]).getByText(/Solved:/)).toBeTruthy();
    expect(within(rows[1]).getByText(/Solved:/)).toBeTruthy();
    expect(within(rows[2]).getByText(/Attempted, not solved yet:/)).toBeTruthy();
    expect(within(rows[3]).getByText(/Attempted, not solved yet:/)).toBeTruthy();
    expect(screen.getByTestId("workspace-practice-count").textContent).toBe("2 of 4 solved");
  });

  it("opening an exercise navigates to the workspace and writes no progress", () => {
    recordAttempt(5, "select 1", true);
    const before = JSON.stringify({ ...localStorage });
    render(wrap(<WorkspacePracticeBlock items={ITEMS} />));
    fireEvent.click(screen.getAllByTestId("workspace-exercise-link")[1]);
    expect(screen.getByTestId("where").textContent).toBe("/workspace?e=py%3Acart-line-total");
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });

  it("renders nothing for a topic with no exercises", () => {
    const { container } = render(wrap(<WorkspacePracticeBlock items={[]} />));
    expect(container.querySelector("[data-testid=workspace-practice]")).toBeNull();
  });
});

describe("Projects Lab entry point", () => {
  const project = { slug: "csv-to-postgres-etl", tasks: [{ id: "parse-csv", type: "python" }, { id: "idempotent-load", type: "sql" }, { id: "d-reject-rows", type: "decision" }] };

  it("a linked task lists its exercises with the reason, and a task without a match shows nothing", () => {
    const items = exercisesForTask(project.slug, "idempotent-load");
    expect(items.length).toBeGreaterThan(0);
    render(wrap(<LinkedExerciseList items={items} />));
    expect(screen.getByText("Open a practice exercise")).toBeTruthy();
    expect(screen.getAllByTestId("workspace-exercise-link").length).toBe(items.length);
    cleanup();
    const none = render(wrap(<LinkedExerciseList items={exercisesForTask(project.slug, "d-reject-rows")} />));
    expect(none.container.querySelector("[data-testid=task-practice]")).toBeNull();
  });

  it("rendering and clicking leaves the project progress and status exactly as they were", () => {
    saveProjectProgress(project.slug, { tasks: { "parse-csv": { passed: true, at: "2026-01-01", code: "x" } }, checklist: {} });
    const raw = localStorage.getItem(`sqlp.project.${project.slug}`);
    const before = projectStatus(project as never, getProjectProgress(project.slug));
    render(wrap(<LinkedExerciseList items={exercisesForTask(project.slug, "idempotent-load")} />));
    fireEvent.click(screen.getAllByTestId("workspace-exercise-link")[0]);
    expect(localStorage.getItem(`sqlp.project.${project.slug}`)).toBe(raw);
    expect(projectStatus(project as never, getProjectProgress(project.slug))).toBe(before);
    expect(screen.getByTestId("where").textContent).toMatch(/^\/workspace\?e=/);
  });

  it("shows a linked exercise as solved only when its own store says so", () => {
    const items = exercisesForTask("airflow-etl-pipeline", "dag-topology");
    completeExercise("py:topological-sort");
    render(wrap(<LinkedExerciseList items={items} />));
    const rows = screen.getAllByTestId("workspace-exercise-link");
    expect(within(rows[0]).getByText(/Solved:/)).toBeTruthy();
    expect(within(rows[1]).getByText(/Not started:/)).toBeTruthy();
  });
});

describe("path step and next question", () => {
  const days = CURRICULUM.days.filter((d) => isAuthored(d.id) && d.path === "common").slice(0, 3);
  it("links the first exercise of the first lesson, then the next one after it is passed", () => {
    const first = lessonWorkspaceIds(days[0].id)[0];
    const { rerender } = render(wrap(<PathWorkspaceStep days={days} daily={{ days: {} }} />));
    expect(screen.getByTestId("path-workspace-step").getAttribute("href")).toBe(workspaceUrl(first));
    rerender(wrap(<PathWorkspaceStep days={days} daily={{ days: { [days[0].id]: { passed: [first.split("#")[1]] } } }} />));
    expect(screen.getByTestId("path-workspace-step").getAttribute("href")).not.toBe(workspaceUrl(first));
  });

  it("the question link picks the first unsolved question and updates when one is solved", () => {
    const qs = [{ slug: "q01-product-revenue", title: "Product Revenue", number: 1 }, { slug: "q02-category-revenue", title: "Category Revenue", number: 2 }];
    render(wrap(<NextQuestionLink questions={qs} />));
    expect(screen.getByTestId("workspace-exercise-link").getAttribute("href")).toBe("/workspace?e=sql%3Aq01-product-revenue");
    act(() => { recordAttempt(1, "select 1", true); });
    expect(screen.getByTestId("workspace-exercise-link").getAttribute("href")).toBe("/workspace?e=sql%3Aq02-category-revenue");
  });
});
