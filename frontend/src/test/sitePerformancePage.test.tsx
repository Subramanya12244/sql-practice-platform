import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getProgress, replaceProgress } from "../site/lib/progress";
import type { SolveSession } from "../site/lib/solveSessions";

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../site/SiteApp", () => ({ usePage: () => ({ data: page.data }) }));
import { PerformancePage } from "../site/pages/PerformancePage";

const q = (number: number, topic: string, topicLabel: string, difficulty = "Easy") => ({ number, slug: `q${number}`, title: `Question ${number}`, topic, topicLabel, difficulty, concepts: [], hadMistakes: false, watchOutFor: "", takeaway: "" });
const INDEX = [q(1, "joins", "Joins"), q(2, "joins", "Joins", "Medium"), q(3, "joins", "Joins"), q(4, "cte", "CTEs")];
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const sess = (id: string, o: Partial<SolveSession>): SolveSession => ({ id, kind: "sql", ref: "sql:1", startedAt: day(0), endedAt: day(0), activeSec: 300, attempts: 1, executions: 2, hints: 0, status: "solved", difficulty: "Easy", topic: "joins", ...o });
const view = () => render(<MemoryRouter><PerformancePage /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
  page.data = { index: INDEX, exercises: [] };
});
afterEach(cleanup);

describe("PerformancePage (module)", () => {
  it("shows an error state when the question list is missing", async () => {
    page.data = {};
    view();
    expect(await screen.findByText("Analytics could not load")).toBeInTheDocument();
  });

  it("anonymous learner with no sessions: friendly empty state, topics still listed", async () => {
    view();
    expect(await screen.findByText("No timed sessions yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a SQL question" })).toHaveAttribute("href", "/questions");
    expect(screen.getAllByText("Not started").length).toBeGreaterThan(0);
  });

  it("computes overall stats from the stored sessions", async () => {
    replaceProgress({ ...getProgress(), sessions: [
      sess("a", { ref: "sql:1", activeSec: 120, attempts: 1, endedAt: day(1) }),
      sess("b", { ref: "sql:2", activeSec: 600, attempts: 3, endedAt: day(0) }),
      sess("c", { ref: "sql:3", status: "abandoned", activeSec: 90, attempts: 2, endedAt: day(0) }),
    ] });
    view();
    const overall = (await screen.findByRole("heading", { name: "Overall" })).closest("section")!;
    const card = (label: string) => within(overall).getByText(label, { exact: false }).closest("div")!.parentElement!.textContent ?? "";
    expect(card("Active learning time")).toMatch(/14 min/); // 810 s = 13.5 min, rounded
    expect(card("Challenges attempted")).toMatch(/3/);
    expect(card("Challenges completed")).toMatch(/2/);
    expect(card("Success rate")).toMatch(/67%/);
    expect(card("Average solve time")).toMatch(/6 min/); // (120+600)/2 = 360 s
    expect(card("Fastest solve")).toMatch(/2 min/);
    expect(card("Attempts per solve")).toMatch(/2/);
  });

  it("builds the heatmap from sessions, with a label per day", async () => {
    replaceProgress({ ...getProgress(), sessions: [sess("a", { activeSec: 1500, endedAt: day(0) })] });
    view();
    const map = await screen.findByRole("group", { name: /Daily practice heatmap/ });
    const cells = within(map).getAllByRole("img");
    expect(cells.length).toBeGreaterThan(100);
    expect(cells.filter((c) => /25 min/.test(c.getAttribute("aria-label") ?? ""))).toHaveLength(1);
    expect(screen.getByText(/nothing here counts against you/)).toBeInTheDocument();
  });

  it("explains classifications and gives reasons for recommendations", async () => {
    replaceProgress({ ...getProgress(),
      questions: { 1: { attempts: 6, solvedAt: day(5), practiced: true, assisted: true, hintLevel: 3 } },
      sessions: [sess("a", { status: "abandoned" }), sess("b", { status: "abandoned" }), sess("c", { status: "abandoned" })] });
    view();
    const needs = (await screen.findByRole("region", { name: "Needs practice" }));
    expect(within(needs).getByText("Joins", { exact: false })).toBeInTheDocument();
    expect(within(needs).getByText(/Why needs practice\?/)).toBeInTheDocument();
    expect(screen.getAllByText(/Why:/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Speed is never part of it/)).toBeInTheDocument();
  });
});
