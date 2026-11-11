import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getProgress, replaceProgress, setDailyPath, updateDay } from "../site/lib/progress";
import { AUTHORED_IDS, CURRICULUM, findDay, loadDay } from "../site/lib/daily";

const page = vi.hoisted(() => ({ value: { data: {} as Record<string, unknown>, params: {} as Record<string, string> } }));
vi.mock("../site/SiteApp", () => ({ usePage: () => page.value }));
import { DailyLessonPage, DailyPage } from "../site/pages/DailyPages";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class { observe() {} disconnect() {} unobserve() {} };

const reset = () => {
  localStorage.clear();
  replaceProgress({ version: 1, questions: {}, activeDays: [], cards: {}, migrations: ["q98-142-to-q147-191"] });
};
beforeEach(() => { reset(); page.value = { data: { index: [], topics: [] }, params: {} }; });
afterEach(cleanup);

const dashboard = () => render(<MemoryRouter><DailyPage /></MemoryRouter>);

describe("Daily Learning dashboard", () => {
  it("shows the programme overview, today's lesson and the roadmap for a new learner", async () => {
    dashboard();
    expect(screen.getByRole("heading", { name: "Your 180-day learning programme" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Day 1: Install Python/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start learning/ })).toHaveAttribute("href", "/daily/day/1");
    const overview = screen.getByRole("region", { name: "DataForge Daily Learning" });
    expect(within(overview).getByText("0%")).toBeInTheDocument();
    expect(screen.getAllByText("Python fundamentals").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Advanced SQL, optimisation and analytics").length).toBeGreaterThan(0);
  });

  it("opens the current phase to a clickable day list with statuses", () => {
    dashboard();
    const link = screen.getByRole("link", { name: /Day 2.*Variables and data types/ });
    expect(link).toHaveAttribute("href", "/daily/day/2");
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
  });

  it("marks lessons that are not written yet instead of faking them", () => {
    // Open a phase that still has an unwritten day (none left once every lesson exists: then there is nothing to mark).
    const phase = CURRICULUM.phases.find((p) => p.path !== "engineer" && CURRICULUM.days.some((d) => d.phase === p.id && !AUTHORED_IDS.has(d.id)));
    if (!phase) return;
    act(() => setDailyPath("analyst"));
    dashboard();
    const header = screen.getAllByRole("button").find((b) => b.getAttribute("aria-expanded") !== null && b.textContent?.includes(phase.title));
    expect(header, `phase ${phase.title}`).toBeDefined();
    if (header?.getAttribute("aria-expanded") === "false") fireEvent.click(header);
    expect(screen.getAllByText("Lesson in preparation").length).toBeGreaterThan(0);
  });


  it("lets the learner preview and choose a path without losing common-core progress", () => {
    dashboard();
    fireEvent.click(screen.getAllByRole("button", { name: "Preview roadmap" })[0]);
    expect(screen.getByRole("heading", { name: /Preview: Data Analyst roadmap/ })).toBeInTheDocument();
    expect(screen.getByText("Excel for analysis")).toBeInTheDocument();
    act(() => updateDay("d001", (r) => ({ ...r, theory: new Date().toISOString() })));
    fireEvent.click(screen.getAllByRole("button", { name: "Choose this path" })[1]);
    expect(getProgress().daily?.path).toBe("engineer");
    expect(getProgress().daily?.days.d001.theory).toBeDefined();
  });

  it("shows Continue learning once work has started, and never counts opening as progress", () => {
    act(() => updateDay("d001", (r) => ({ ...r, theory: new Date().toISOString() })));
    dashboard();
    expect(screen.getByRole("link", { name: /Continue learning/ })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "DataForge Daily Learning" })).getByText("0%")).toBeInTheDocument();
  });

  it("moves to the next day only after the day is completed", () => {
    act(() => updateDay("d001", (r) => ({ ...r, completedAt: new Date().toISOString() })));
    dashboard();
    expect(screen.getByRole("heading", { name: /Day 2: Variables and data types/ })).toBeInTheDocument();
  });
});

describe("Daily lesson page", () => {
  const lesson = (path: string, n: string, content: unknown = null) => {
    page.value = { data: { index: [], topics: [], dailyContent: content, dailyLinks: [] }, params: path === "common" ? { n } : { path, n } };
    return render(<MemoryRouter><DailyLessonPage /></MemoryRouter>);
  };

  it("shows topics and prerequisites, not a fake lesson, when a day has no content", () => {
    lesson("common", "42");
    expect(screen.getByRole("heading", { name: /Self joins/ })).toBeInTheDocument();
    expect(screen.getByText("This lesson is being prepared")).toBeInTheDocument();
    expect(screen.getByText(/Prerequisites/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Lesson steps" })).toBeNull();
  });

  it("resolves analyst and engineer days at the same day number", () => {
    expect(findDay("analyst", 120)?.id).toBe("a120");
    expect(findDay("engineer", 120)?.id).toBe("e120");
    lesson("analyst", "120");
    expect(screen.getByText(/Analyst|Data Analyst/)).toBeInTheDocument();
  });

  it.skipIf(!AUTHORED_IDS.has("d001"))("renders an authored lesson with the seven steps and keeps completion locked until the work is done", async () => {
    const content = await loadDay("d001");
    lesson("common", "1", content);
    const steps = screen.getByRole("list", { name: "Lesson steps" });
    expect(within(steps).getAllByRole("button")).toHaveLength(7);
    fireEvent.click(within(steps).getByRole("button", { name: /Complete day/ }));
    const panelButton = screen.getAllByRole("button", { name: /Complete day/ }).find((b) => !steps.contains(b))!;
    expect(panelButton).toBeDisabled();
    expect(getProgress().daily?.days.d001?.completedAt).toBeUndefined();
  });
});
