import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HeroPipeline } from "../site/components/home/HeroPipeline";
import { DailyResume, FeaturedTools, LearningDomains, LearningJourney } from "../site/components/home/HomeSections";
import { dailyResume, lastVisitedDay } from "../site/lib/dailyResume";
import { Breadcrumbs, Badge } from "../site/components/ui";
import { matchRoute } from "../site/routes";
import { sequenceFor } from "../site/lib/daily";
import type { DailyState } from "../site/lib/dailyProgress";

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const seq = sequenceFor(undefined);

describe("homepage sections: no dead links", () => {
  it("every link in the hero, domains, journey and tools opens a real page", () => {
    const { container } = wrap(<><HeroPipeline /><LearningDomains /><LearningJourney /><FeaturedTools /></>);
    const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!);
    expect(hrefs.length).toBeGreaterThan(35);
    for (const h of new Set(hrefs)) expect(matchRoute(h).route.path, `${h} is not a route`).not.toBe("*");
  });

  it("shows the four learning domains and the five journey steps in order", () => {
    wrap(<><LearningDomains /><LearningJourney /></>);
    for (const t of ["SQL and Databases", "Python and Analytics", "Data Engineering", "Business Intelligence"]) expect(screen.getByRole("heading", { name: t })).toBeTruthy();
    const steps = within(screen.getByRole("list", { name: "Learning journey" })).getAllByRole("heading").map((h) => h.textContent);
    expect(steps).toEqual(["Learn", "Practice", "Build", "Prove", "Grow"]);
  });

  it("features the six tools the brief names", () => {
    wrap(<FeaturedTools />);
    for (const t of ["SQL Query Visualizer", "Python workspace", "ETL Pipeline Builder", "DAG Simulator", "Data Quality Exercises", "Schema Designer"]) expect(screen.getByText(t)).toBeTruthy();
  });
});

describe("continue learning is built from real progress only", () => {
  const view = (state: DailyState) => ({ state, seq, path: state.path });

  it("a new learner is told to start at day 1 and nothing is shown as done", () => {
    const r = dailyResume(view({ days: {} }));
    expect(r.started).toBe(false);
    expect(r.stats.completed).toBe(0);
    expect(r.target?.day).toBe(1);
    wrap(<DailyResume view={{ ...view({ days: {} }), progress: {} as never, revisions: {} }} />);
    expect(screen.getByText(/Start Day 1/)).toBeTruthy();
  });

  it("resumes the lesson that was opened and not finished", () => {
    const [d1, d2] = seq;
    const state: DailyState = { days: { [d1.id]: { completedAt: "2026-01-01T10:00:00Z", lastVisit: "2026-01-01T10:00:00Z" }, [d2.id]: { startedAt: "2026-01-02T09:00:00Z", lastVisit: "2026-01-02T09:30:00Z" } } };
    expect(lastVisitedDay({ state })?.id).toBe(d2.id);
    const r = dailyResume(view(state));
    expect(r.started).toBe(true);
    expect(r.stats.completed).toBe(1);
    expect(r.target?.id).toBe(d2.id);
    wrap(<DailyResume view={{ ...view(state), progress: {} as never, revisions: {} }} />);
    expect(screen.getByText(/1 of 90 days/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Resume lesson/ }).getAttribute("href")).toBe(`/daily/day/${d2.day}`);
  });

  it("moves to the next lesson once the last one opened is complete", () => {
    const [d1, d2] = seq;
    const state: DailyState = { days: { [d1.id]: { completedAt: "2026-01-01T10:00:00Z", lastVisit: "2026-01-01T10:00:00Z" } } };
    const r = dailyResume(view(state));
    expect(r.lastDone).toBe(true);
    expect(r.target?.id).toBe(d2.id);
  });
});

describe("shared primitives", () => {
  it("Breadcrumbs link the trail and mark the current page", () => {
    wrap(<Breadcrumbs items={[{ label: "Learn", to: "/daily" }, { label: "Daily Learning", to: "/daily" }, { label: "Day 1" }]} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/daily", "/daily"]);
    expect(within(nav).getByText("Day 1").getAttribute("aria-current")).toBe("page");
  });

  it("Badge has an information tone", () => {
    wrap(<Badge tone="info">Note</Badge>);
    expect(screen.getByText("Note").className).toContain("text-info");
  });
});
