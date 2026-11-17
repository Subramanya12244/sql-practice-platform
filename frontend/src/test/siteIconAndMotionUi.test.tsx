import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Check } from "lucide-react";
import { ICON_PX, ICON_STROKE, Icon, IconTile } from "../site/components/Icon";
import { CountUp, useSettled } from "../site/components/Motion";
import { Disclosure, ProgressBar, Tabs } from "../site/components/ui";
import { ProjectCard, ResultBanner, StatusChip, TaskRoadmap } from "../site/components/projects/ProjectUi";
import type { ProjectMeta } from "../site/lib/projects";
import { summarise } from "../site/lib/projectsLab";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Icon", () => {
  it("is decorative by default, and meaningful only when given a label", () => {
    const { container, rerender } = render(<Icon icon={Check} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    rerender(<Icon icon={Check} label="Passed" />);
    expect(screen.getByRole("img", { name: "Passed" })).toBeTruthy();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBeNull();
  });

  it("uses the five sizes and one stroke family, in currentColor", () => {
    expect(ICON_PX).toEqual({ inline: 15, button: 17, nav: 19, card: 22, feature: 32 });
    for (const [k, px] of Object.entries(ICON_PX)) {
      const { container, unmount } = render(<Icon icon={Check} size={k as keyof typeof ICON_PX} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("width")).toBe(String(px));
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(Number(svg.getAttribute("stroke-width"))).toBe(ICON_STROKE[k as keyof typeof ICON_PX]);
      unmount();
    }
    for (const w of Object.values(ICON_STROKE)) expect(w).toBeLessThan(2);
  });

  it("an icon tile is a decorative tinted square", () => {
    const { container } = render(<IconTile icon={Check} tone="success" />);
    expect(container.firstElementChild!.className).toContain("bg-success-dim");
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("progress animates real changes, not the first fill", () => {
  it("the value present at load snaps; a later change transitions", () => {
    const { container, rerender } = render(<ProgressBar value={3} max={10} label="p" />);
    const fill = () => container.querySelector('[role="progressbar"] > div') as HTMLElement;
    expect(fill().className).not.toContain("transition-[width]");
    expect(fill().style.width).toBe("30%");
    act(() => { vi.advanceTimersByTime(200); });
    expect(fill().className).toContain("transition-[width]");
    rerender(<ProgressBar value={5} max={10} label="p" />);
    expect(fill().style.width).toBe("50%");
    expect(fill().className).toContain("duration-slow");
  });

  it("useSettled is false first and true after the delay", () => {
    function Probe() { return <span data-testid="s">{String(useSettled(100))}</span>; }
    render(<Probe />);
    expect(screen.getByTestId("s").textContent).toBe("false");
    act(() => { vi.advanceTimersByTime(120); });
    expect(screen.getByTestId("s").textContent).toBe("true");
  });
});

describe("CountUp", () => {
  it("shows the real value first, ends on it, and never leaves the page stuck on an in-between number", () => {
    const { container, rerender } = render(<CountUp value={10} />);
    expect(container.textContent).toBe("10");
    // a clock that only moves when the frame callback runs, so the animation is deterministic under fake timers
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => { now += 16; cb(now); }, 16) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    rerender(<CountUp value={50} duration={100} />);
    act(() => { vi.advanceTimersByTime(48); });
    const mid = Number(container.textContent);
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(50);
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.textContent).toBe("50");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("jumps straight to the value when the visitor asked for reduced motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    const { container, rerender } = render(<CountUp value={1} />);
    rerender(<CountUp value={99} />);
    expect(container.textContent).toBe("99");
    vi.unstubAllGlobals();
  });
});

describe("Tabs", () => {
  const tabs = [{ id: "a", label: "Library" }, { id: "b", label: "Mine" }];
  it("marks the selected tab, switches on click and on the arrow keys, and has a moving highlight after mount", () => {
    const seen: string[] = [];
    const { rerender } = render(<Tabs tabs={tabs} value="a" onChange={(v) => seen.push(v)} label="View" />);
    expect(screen.getByRole("tab", { name: "Library" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Mine" }));
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(seen).toEqual(["b", "b"]);
    rerender(<Tabs tabs={tabs} value="b" onChange={() => {}} label="View" />);
    expect(screen.getByRole("tab", { name: "Mine" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tablist").querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});

describe("Disclosure", () => {
  it("is a real button: it toggles aria-expanded, keeps its content in the page, and hides it from the keyboard and screen readers while closed", () => {
    render(<Disclosure header="Module one"><a href="#x">Lesson link</a></Disclosure>);
    const button = screen.getByRole("button", { name: /Module one/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.textContent).toContain("Lesson link"); // still in the HTML for crawlers and prerendering
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    expect(panel.hasAttribute("inert")).toBe(false);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
  it("can start open", () => {
    render(<Disclosure header="Open" defaultOpen><p>body</p></Disclosure>);
    expect(screen.getByRole("button", { name: /Open/ }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("project UI", () => {
  const p: ProjectMeta = { slug: "csv-to-postgres-etl", title: "CSV to PostgreSQL", level: "Beginner", description: "Load a CSV.", technologies: ["Python", "PostgreSQL", "SQL", "pandas"], dataset: "northwind", prerequisites: [], minutes: 90, taskCount: 3, automated: 2, manual: 1 };
  const tasks = [{ id: "a", type: "sql" as const, title: "Create the table" }, { id: "b", type: "python" as const, title: "Clean the data" }, { id: "m", type: "checklist" as const, title: "Review" }];
  const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("a card links to its project, shows tags, progress and the next task, and does not claim progress before the browser knows it", () => {
    const { container, rerender } = wrap(<ProjectCard p={p} />);
    expect(screen.getByRole("link", { name: "CSV to PostgreSQL" }).getAttribute("href")).toBe("/projects-lab/csv-to-postgres-etl");
    expect(container.textContent).toContain("0/2 passed");
    expect(container.textContent).not.toContain("Start with:");
    expect(screen.getByText("+1")).toBeTruthy(); // 4 technologies, 3 shown
    const progress = { tasks: { a: { passed: true, at: "x" } }, checklist: {} };
    rerender(<MemoryRouter><ProjectCard p={p} summary={summarise(tasks, progress, "In progress")} /></MemoryRouter>);
    expect(container.textContent).toContain("1/2 passed");
    expect(container.textContent).toContain("Next:");
    expect(container.textContent).toContain("Clean the data");
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("a card for a project nobody started says where to start", () => {
    const { container } = wrap(<ProjectCard p={p} summary={summarise(tasks, { tasks: {}, checklist: {} }, "Not started")} />);
    expect(container.textContent).toContain("Start with:");
    expect(container.textContent).toContain("Create the table");
  });

  it("a completed card says so only when the status is Completed", () => {
    const done = { tasks: { a: { passed: true, at: "x" }, b: { passed: true, at: "x" } }, checklist: { m: [true] } };
    const { container } = wrap(<ProjectCard p={p} summary={summarise(tasks, done, "Completed")} />);
    expect(container.textContent).toContain("All checks passed");
  });

  it("every status has a distinct label and an icon", () => {
    for (const s of ["Not started", "In progress", "Submitted", "Under evaluation", "Completed", "Changes requested", "Rejected"] as const) {
      const { container, unmount } = render(<StatusChip s={s} />);
      expect(container.textContent).toBe(s);
      expect(container.querySelector("svg")).toBeTruthy();
      unmount();
    }
  });

  it("the roadmap lists every task with its real state and marks the next one", () => {
    const progress = { tasks: { a: { passed: true, at: "x" }, b: { passed: false, at: "x" } }, checklist: {} };
    render(<TaskRoadmap tasks={tasks} progress={progress} nextId="b" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].querySelector('[aria-label="Passed"]')).toBeTruthy();
    expect(items[1].querySelector('[aria-label="Not passing yet"]')).toBeTruthy();
    expect(items[2].querySelector('[aria-label="Not started"]')).toBeTruthy();
    expect(items[1].textContent).toContain("Next");
    expect(items[1].querySelector("a")!.getAttribute("aria-current")).toBe("step");
    expect(items[0].querySelector("a")!.getAttribute("href")).toBe("#task-a");
  });

  it("a result is announced in words, passes offer the next task, and the check's own message is shown unchanged", () => {
    const { container, rerender } = render(<ResultBanner ok message="3 rows loaded." nextTitle="Clean the data" nextHref="#task-b" />);
    expect(screen.getByRole("status").textContent).toContain("Check passed");
    expect(container.textContent).toContain("3 rows loaded.");
    expect(screen.getByRole("link", { name: /Next task: Clean the data/ })).toBeTruthy();
    rerender(<ResultBanner ok={false} message="Expected 5 rows, got 3." />);
    expect(screen.getByRole("status").textContent).toContain("Check did not pass");
    expect(container.textContent).toContain("Expected 5 rows, got 3.");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
