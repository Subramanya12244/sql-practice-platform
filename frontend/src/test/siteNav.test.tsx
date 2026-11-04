import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SiteLayout } from "../site/components/SiteLayout";
import { AuthProvider } from "../site/lib/auth";
import { ThemeProvider } from "../contexts/ThemeContext";
import { NAV_GROUPS, activeGroup } from "../site/lib/navigation";

const render = (path: string) =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider><AuthProvider><SiteLayout loading={false} error={null}><p>x</p></SiteLayout></AuthProvider></ThemeProvider>
    </MemoryRouter>,
  );

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;

describe("navigation", () => {
  it("maps paths to the right group", () => {
    expect(activeGroup("/")).toBe("overview");
    expect(activeGroup("/notes/left-join")).toBe("learn");
    expect(activeGroup("/questions/q25-x")).toBe("practice");
    expect(activeGroup("/projects-lab/abc")).toBe("projects");
    expect(activeGroup("/ai-tutor")).toBe("ai");
  });
  it("highlights only the current group and brands the header", () => {
    const html = render("/notes/left-join");
    expect(html).toContain("DataForge");
    const overview = html.match(/<a[^>]*href="\/"[^>]*>Overview<\/a>/)![0];
    expect(overview).not.toContain("aria-current");
    expect(html).toMatch(/aria-expanded="false" aria-haspopup="true" class="[^"]*bg-accent-dim[^"]*">Learn/);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Overview", "Learn", "Practice", "Data Engineering", "Projects", "Data Quality", "AI & Intelligence", "Assessments", "Career", "Progress"]);
  });
});
