import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SiteLayout } from "../site/components/SiteLayout";
import { AuthProvider } from "../site/lib/auth";
import { ThemeProvider } from "../contexts/ThemeContext";
import { NAV_GROUPS, activeGroup, breadcrumbFor } from "../site/lib/navigation";

const render = (path: string) =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider><AuthProvider><SiteLayout loading={false} error={null}><p>x</p></SiteLayout></AuthProvider></ThemeProvider>
    </MemoryRouter>,
  );

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;

describe("navigation", () => {
  it("has the six categories, in order", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Home", "Learn", "Practice", "Labs", "Projects", "Career"]);
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["home", "learn", "practice", "labs", "projects", "career"]);
  });
  it("maps paths to the right group", () => {
    expect(activeGroup("/")).toBe("home");
    expect(activeGroup("/learn")).toBe("home");
    expect(activeGroup("/analytics")).toBe("home");
    expect(activeGroup("/career/planner")).toBe("career");
    expect(activeGroup("/portfolio")).toBe("career");
    expect(activeGroup("/portfolio/export")).toBe("projects");
    expect(activeGroup("/leaderboard")).toBe("practice");
    expect(activeGroup("/notes/left-join")).toBe("learn");
    expect(activeGroup("/daily")).toBe("learn");
    expect(activeGroup("/daily/day/12")).toBe("learn");
    expect(activeGroup("/daily/analyst/day/120")).toBe("learn");
    expect(activeGroup("/questions/q25-x")).toBe("practice");
    expect(activeGroup("/query-visualizer")).toBe("practice");
    expect(activeGroup("/etl-builder")).toBe("labs");
    expect(activeGroup("/visual/python")).toBe("labs");
    expect(activeGroup("/projects-lab/abc")).toBe("projects");
  });
  it("no path is listed in two groups, so one page never highlights two groups", () => {
    const paths = NAV_GROUPS.flatMap((g) => (g.items ?? []).map((i) => i.to));
    expect(new Set(paths).size).toBe(paths.length);
  });
  it("highlights only the current group and brands the header", () => {
    const html = render("/notes/left-join");
    expect(html).toContain("DataForge");
    expect(html).toContain('data-nav-group="learn" data-active="true" aria-expanded="true"');
    expect(html).toContain('data-nav-group="practice" data-active="false" aria-expanded="false"');
  });
  it("builds breadcrumbs from the navigation", () => {
    expect(breadcrumbFor("/")).toEqual([]);
    expect(breadcrumbFor("/etl-builder")).toEqual([{ label: "Labs" }, { label: "ETL pipeline builder" }]);
    expect(breadcrumbFor("/notes/left-join")).toEqual([{ label: "Learn" }, { label: "SQL notes", to: "/notes" }]);
    expect(breadcrumbFor("/daily/day/12")).toEqual([{ label: "Learn" }, { label: "Daily Learning", to: "/daily" }]);
    expect(breadcrumbFor("/daily/day/1")).toEqual([{ label: "Learn" }, { label: "Daily Learning", to: "/daily" }]);
    expect(breadcrumbFor("/nowhere")).toEqual([]);
  });
  it("renders the breadcrumb in the header of a page that is in the navigation", () => {
    const html = render("/etl-builder");
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain("ETL pipeline builder");
  });
});
