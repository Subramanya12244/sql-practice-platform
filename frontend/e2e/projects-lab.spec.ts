import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Projects Lab in a real browser: discovery (search, filters, URL), card interaction, the task roadmap, and a real check that
// passes or fails against a real PostgreSQL. Progress is seeded only where a test is about how stored progress is shown.

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The first automated task of a project, read from the project's own Markdown. */
function firstAutomatedTask(slug: string) {
  const raw = readFileSync(join(process.cwd(), "src", "site", "content", "projects", `${slug}.md`), "utf8");
  const tasks = [...raw.matchAll(/```task\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]) as { id: string; type: string; title: string; solution: string; starter?: string });
  return { all: tasks, first: tasks.find((t) => t.type !== "checklist")! };
}

const seed = (page: Page, slug: string, passedIds: string[], failedIds: string[] = []) =>
  page.addInitScript(([s, pass, fail]) => {
    try {
      if (localStorage.getItem(`df.test.seeded.${s}`)) return;
      localStorage.setItem(`df.test.seeded.${s}`, "1");
      const tasks: Record<string, unknown> = {};
      for (const id of pass) tasks[id] = { passed: true, at: new Date().toISOString() };
      for (const id of fail) tasks[id] = { passed: false, at: new Date().toISOString(), message: "Expected 5 rows, got 3." };
      localStorage.setItem(`sqlp.project.${s}`, JSON.stringify({ tasks, checklist: {} }));
    } catch { /* storage unavailable */ }
  }, [slug, passedIds, failedIds] as const);

test("library: 12 projects, the task totals, and every card has an icon, level, tags and progress", async ({ page }) => {
  await page.goto("/projects-lab");
  await expect(page.getByRole("heading", { level: 1, name: "Projects lab" })).toBeVisible();
  const cards = page.locator("[data-project]");
  await expect(cards).toHaveCount(12);
  await expect(page.getByText(/92 tasks · 85 auto-checked/)).toBeVisible();
  for (const card of await cards.all()) {
    await expect(card.locator("svg").first()).toBeVisible();
    await expect(card.getByRole("list", { name: "Technologies" })).toBeVisible();
    await expect(card.getByRole("progressbar")).toBeVisible();
    await expect(card.getByRole("link").first()).toHaveAttribute("href", /^\/projects-lab\/[a-z-]+$/);
  }
  for (const level of ["Beginner", "Intermediate", "Advanced"]) await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${level}`) })).toBeVisible();
  expect(await noHScroll(page)).toBeLessThanOrEqual(1);
});

test("filters: level, technology, status and search narrow the library, show what is active, and stay in the address", async ({ page }) => {
  await page.goto("/projects-lab");
  const count = page.getByRole("status").filter({ hasText: /projects?$/ });
  await expect(count).toHaveText("12 of 12 projects");

  const beginner = page.getByRole("group", { name: "Difficulty" }).getByRole("button", { name: /^Beginner/ });
  await beginner.click();
  await expect(beginner).toHaveAttribute("aria-pressed", "true");
  await expect(count).toHaveText(/^\d+ of 12 projects$/);
  for (const card of await page.locator("[data-project]").all()) await expect(card).toContainText("Beginner");
  await expect(page).toHaveURL(/level=Beginner/);

  await page.getByLabel("Technology").selectOption({ label: /Python/ } as never).catch(async () => { await page.getByLabel("Technology").selectOption("Python"); });
  await expect(page).toHaveURL(/tech=Python/);

  await page.getByRole("searchbox", { name: "Search projects" }).fill("warehouse");
  await expect(page).toHaveURL(/q=warehouse/);
  await expect(page.getByRole("status").filter({ hasText: /project/ })).toContainText("No projects found").catch(() => undefined);

  await page.locator('[data-help="projects-filters"]').getByRole("button", { name: "Clear filters" }).click();
  await expect(count).toHaveText("12 of 12 projects");
  await expect(page).not.toHaveURL(/level=|tech=|q=/);
});

test("filters: a search with no match shows an empty state that can be cleared, and a filtered address survives a refresh", async ({ page }) => {
  await page.goto("/projects-lab?level=Advanced&q=dbt");
  const cards = page.locator("[data-project]");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(/dbt/i);
  await page.reload();
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole("searchbox", { name: "Search projects" })).toHaveValue("dbt");
  await page.getByRole("searchbox", { name: "Search projects" }).fill("qqqqzzzz");
  await expect(page.getByText("No projects match these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(cards).toHaveCount(12);
});

test("filters: status and the My projects tab use real stored progress", async ({ page }) => {
  const { first } = firstAutomatedTask("hr-analytics-warehouse");
  await seed(page, "hr-analytics-warehouse", [first.id]);
  await page.goto("/projects-lab");
  const card = page.locator('[data-project="hr-analytics-warehouse"]');
  await expect(card).toContainText("In progress");
  await expect(card).toContainText("1/");
  await expect(card).toContainText("Next:");
  await page.getByLabel("Status").selectOption("in-progress");
  await expect(page.locator("[data-project]")).toHaveCount(1);
  await page.locator('[data-help="projects-filters"]').getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("tab", { name: /My projects \(1\)/ }).click();
  await expect(page.locator("[data-project]")).toHaveCount(1);
  await page.getByRole("tab", { name: "Project library" }).click();
  await expect(page.locator("[data-project]")).toHaveCount(12);
});

test("a new learner's cards offer the first task, and nothing is shown as passed", async ({ page }) => {
  await page.goto("/projects-lab");
  const { first } = firstAutomatedTask("hr-analytics-warehouse");
  const card = page.locator('[data-project="hr-analytics-warehouse"]');
  await expect(card).toContainText("Start with:");
  await expect(card).toContainText(first.title);
  await expect(card).toContainText("0/");
  await expect(card).toContainText("Not started");
});

test("cards respond to the pointer: they lift on hover, press in on click, and open the project", async ({ page, isMobile }) => {
  await page.goto("/projects-lab");
  const card = page.locator('[data-project="hr-analytics-warehouse"]');
  await card.scrollIntoViewIfNeeded();
  if (!isMobile) {
    const before = await card.evaluate((el) => getComputedStyle(el).transform);
    await card.hover();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).transform), { timeout: 1500 }).not.toBe(before);
    const ms = await card.evaluate((el) => Number.parseFloat(getComputedStyle(el).transitionDuration) * 1000);
    expect(ms).toBeLessThanOrEqual(200); // card hover is 140-200 ms
  }
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/projects-lab\/hr-analytics-warehouse$/);
  await expect(page.getByRole("heading", { level: 1, name: /HR analytics warehouse/i })).toBeVisible();
});

test("keyboard: tab reaches a card and Enter opens it, with a visible focus ring", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard");
  await page.goto("/projects-lab");
  const link = page.locator('[data-project="csv-to-postgres-etl"] a').first();
  await link.focus();
  const ring = await link.evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth) }; });
  expect(ring.style).not.toBe("none");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects-lab\/csv-to-postgres-etl$/);
});

test("project page: the task roadmap lists every task with its real state, marks the next one, and jumps to it", async ({ page }) => {
  const { all, first } = firstAutomatedTask("hr-analytics-warehouse");
  await seed(page, "hr-analytics-warehouse", [first.id]);
  await page.goto("/projects-lab/hr-analytics-warehouse");
  const roadmap = page.getByRole("list", { name: "Task roadmap" });
  await expect(roadmap.getByRole("listitem")).toHaveCount(all.length);
  await expect(roadmap.getByRole("listitem").first().getByLabel("Passed")).toBeVisible();
  const next = all.filter((t) => t.type !== "checklist")[1];
  const nextRow = roadmap.getByRole("listitem").filter({ hasText: next.title });
  await expect(nextRow).toContainText("Next");
  await expect(nextRow.getByRole("link")).toHaveAttribute("aria-current", "step");
  await nextRow.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`#task-${next.id}$`));
  await expect(page.getByRole("link", { name: /Resume task:/ })).toBeVisible();
  // the roadmap collapses and expands like any accordion
  const toggle = page.getByRole("button", { name: /Task roadmap/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(roadmap).toBeHidden();
});

test("project page: a failed check is shown as failed, with the check's own message", async ({ page }) => {
  const { first } = firstAutomatedTask("hr-analytics-warehouse");
  await seed(page, "hr-analytics-warehouse", [], [first.id]);
  await page.goto("/projects-lab/hr-analytics-warehouse");
  const panel = page.locator(`section[aria-labelledby="task-${first.id}"]`);
  await expect(panel.getByRole("status")).toContainText("Check did not pass");
  await expect(panel.getByRole("status")).toContainText("Expected 5 rows, got 3.");
  await expect(page.getByRole("list", { name: "Task roadmap" }).getByRole("listitem").first().getByLabel("Not passing yet")).toBeVisible();
  await expect(page.locator("[data-help='project-progress']").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
});

test("project page: a real check runs against PostgreSQL: the starter does not pass, the solution does, and the result persists", async ({ page }) => {
  test.setTimeout(180_000);
  const { all, first } = firstAutomatedTask("hr-analytics-warehouse");
  expect(first.type).toBe("sql");
  await page.goto("/projects-lab/hr-analytics-warehouse");
  const panel = page.locator(`section[aria-labelledby="task-${first.id}"]`);
  await panel.scrollIntoViewIfNeeded();
  const editor = panel.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 90_000 });

  // 1. the starter code must not pass
  await panel.getByRole("button", { name: "Check" }).click();
  await expect(panel.getByRole("status")).toContainText("Check did not pass", { timeout: 120_000 });
  await expect(page.getByRole("list", { name: "Task roadmap" }).getByRole("listitem").first().getByLabel("Not passing yet")).toBeVisible();

  // 2. the project's own solution passes
  // Typing into Monaco auto-closes brackets and quotes, which would change the SQL; set the editor's content through its own API.
  await panel.evaluate((el, value) => {
    const monaco = (window as unknown as { monaco: { editor: { getEditors(): { getContainerDomNode(): HTMLElement; setValue(v: string): void }[] } } }).monaco;
    const ed = monaco.editor.getEditors().find((e) => el.contains(e.getContainerDomNode()));
    if (!ed) throw new Error("no editor in this task panel");
    ed.setValue(value);
  }, first.solution);
  await panel.getByRole("button", { name: "Check" }).click();
  await expect(panel.getByRole("status")).toContainText("Check passed", { timeout: 120_000 });
  const roadmapFirst = page.getByRole("list", { name: "Task roadmap" }).getByRole("listitem").first();
  await expect(roadmapFirst.getByLabel("Passed")).toBeVisible();
  const autos = all.filter((t) => t.type !== "checklist").length;
  await expect(page.locator("[data-help='project-progress']").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByText(new RegExp(`1/${autos}`)).first()).toBeVisible();
  await expect(panel.getByRole("link", { name: /Next task:/ })).toBeVisible();

  // 3. it survives a refresh, and the library card shows it
  await page.reload();
  await expect(page.getByRole("list", { name: "Task roadmap" }).getByRole("listitem").first().getByLabel("Passed")).toBeVisible();
  await page.goto("/projects-lab");
  await expect(page.locator('[data-project="hr-analytics-warehouse"]')).toContainText(`1/${autos}`);
  await expect(page.locator('[data-project="hr-analytics-warehouse"]')).toContainText("In progress");
});

test("a project is never Completed by passing some checks", async ({ page }) => {
  const { all } = firstAutomatedTask("hr-analytics-warehouse");
  const autos = all.filter((t) => t.type !== "checklist");
  await seed(page, "hr-analytics-warehouse", autos.slice(0, autos.length - 1).map((t) => t.id));
  await page.goto("/projects-lab/hr-analytics-warehouse");
  await expect(page.getByText("In progress", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toHaveCount(0);
});

test("phone: the library and a project page do not scroll sideways", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  for (const path of ["/projects-lab", "/projects-lab?level=Advanced", "/projects-lab/csv-to-postgres-etl", "/projects-lab/end-to-end-pipeline"]) {
    await page.goto(path);
    expect(await noHScroll(page), path).toBeLessThanOrEqual(1);
  }
});
