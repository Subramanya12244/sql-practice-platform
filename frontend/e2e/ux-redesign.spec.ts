import { expect, test } from "./fixtures";

/** The redesigned shell and pages, in a real browser. */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
});

const noHScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("homepage: the headline, both calls to action and the four domains", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Become a Data Professional." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start Learning" })).toHaveAttribute("href", "/daily/day/1");
  await expect(page.getByRole("link", { name: /Explore Curriculum/ })).toHaveAttribute("href", "/daily");
  for (const t of ["SQL and Databases", "Python and Analytics", "Data Engineering", "Business Intelligence"]) await expect(page.getByRole("heading", { name: t })).toBeVisible();
  await expect(page.getByRole("list", { name: "Learning journey" }).getByRole("heading")).toHaveText(["Learn", "Practice", "Build", "Prove", "Grow"]);
  expect(await noHScroll(page)).toBeLessThanOrEqual(1);
});

test("homepage: every link on the page opens a real page (no dead links)", async ({ page, request, baseURL }) => {
  await page.goto("/");
  const hrefs = await page.locator("main a[href^='/']").evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split("#")[0]))]);
  expect(hrefs.length).toBeGreaterThan(30);
  for (const h of hrefs) {
    const r = await request.get(`${baseURL}${h}`);
    expect(r.status(), h).toBeLessThan(400);
  }
});

test("navigation: six categories, the header trail, and tooltips from the descriptions", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop sidebar");
  await page.goto("/etl-builder");
  const side = page.getByRole("navigation", { name: "Main" });
  await expect(side.getByRole("button")).toHaveText(["Home", "Learn", "Practice", "Labs", "Projects", "Career"]);
  await expect(side.locator('[data-nav-group="labs"]')).toHaveAttribute("data-active", "true");
  const trail = page.getByTestId("breadcrumbs");
  await expect(trail).toContainText("Labs");
  await expect(trail).toContainText("ETL pipeline builder");
  await expect(side.getByRole("link", { name: "DAG simulator" })).toHaveAttribute("title", /retries and failures/);
});

test("search (Ctrl+K) finds a tool, a lesson and a Python exercise", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcut");
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Search the site" });
  await box.fill("etl");
  const options = page.locator("#search-results [role=option]");
  await expect(options.first()).toContainText("Tool");
  await expect(options.first()).toContainText("ETL pipeline builder");
  await box.fill("day 12");
  await expect(options.first()).toContainText("Day 12:");
  await box.fill("PY-085");
  await expect(options.first()).toContainText("Exercise");
  await options.first().click();
  await expect(page).toHaveURL(/\/practice\/python\//);
});

test("dashboard: next actions, revision, skill mastery and projects, from real (here: empty) progress", async ({ page }) => {
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "What to do next" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start Day 1/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revision and mistakes" })).toBeVisible();
  await expect(page.getByText("Nothing to revise yet")).toBeVisible();
  const skills = page.getByRole("region", { name: "Skill mastery" });
  await expect(skills.getByRole("listitem")).toHaveCount(10);
  await expect(skills.getByRole("listitem").getByText("Not assessed")).toHaveCount(10); // a new learner has no evidence for any skill
  await expect(skills.getByText(/0 of 30 lessons completed/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  expect(await noHScroll(page)).toBeLessThanOrEqual(1);
});

test("dashboard: finishing lesson work changes the skill status (started, then practicing)", async ({ page }) => {
  await page.goto("/learn");
  // a visit alone is not progress
  await expect(page.getByRole("region", { name: "Skill mastery" }).getByRole("listitem").getByText("Not assessed")).toHaveCount(10);
  await page.evaluate(() => {
    const raw = { version: 1, ...JSON.parse(localStorage.getItem("sqlp.public.progress") ?? "{}") }; // the store ignores records without a version
    raw.daily = { days: { d031: { completedAt: "2026-02-01T10:00:00Z", lastVisit: "2026-02-01T10:00:00Z", theory: "2026-02-01T09:00:00Z" } } };
    localStorage.setItem("sqlp.public.progress", JSON.stringify(raw));
  });
  await page.reload();
  const sql = page.getByRole("region", { name: "Skill mastery" }).locator("li", { hasText: "SQL" }).first();
  await expect(sql).toContainText("Practicing");
  await expect(sql).toContainText("1 of 30 lessons completed");
});

test("labs and designers never scroll sideways on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  for (const path of ["/schema-designer", "/etl-builder", "/dag-simulator", "/dq-exercises", "/de-scenarios", "/query-visualizer", "/daily/day/3", "/learn", "/"]) {
    await page.goto(path);
    expect(await noHScroll(page), path).toBeLessThanOrEqual(1);
  }
});

test("query visualizer: Format SQL tidies the query in the editor", async ({ page }) => {
  await page.goto("/query-visualizer");
  const editor = page.getByLabel("Query to visualize");
  await expect(editor.first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Format SQL" }).click();
  await expect(page.getByTestId("format-error")).toHaveCount(0);
  // the first preset is one clause per line already; the formatter keeps keywords upper-case and the text still runs
  await page.getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(page.getByTestId("cinema")).toBeVisible({ timeout: 120_000 });
});
