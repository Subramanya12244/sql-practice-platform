import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Discovery of the unified workspace from the Learn hub, Projects Lab, scenarios and question pages: real exercises, truthful progress,
// opening an exercise changes nothing. Dev server on port 5204 (E2E_BASE_URL=http://localhost:5204).

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const watch = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
};
/** Everything the stores keep about solving: SQL questions, Python lessons, Daily records, Python stats and every project record. */
const stores = (page: Page) =>
  page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("sqlp.public.progress") ?? "{}");
    const rest = Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("sqlp.project.") || k === "sqlp.py.stats").sort().map((k) => [k, localStorage.getItem(k)]));
    return JSON.stringify({ questions: p.questions ?? {}, lessons: p.lessons ?? {}, daily: p.daily ?? {}, mistakes: p.mistakes ?? {}, rest });
  });

const seedSolved = (page: Page) =>
  page.addInitScript(() => {
    try {
      if (localStorage.getItem("df.test.wsSeeded")) return;
      localStorage.setItem("df.test.wsSeeded", "1");
      localStorage.setItem("sqlp.public.progress", JSON.stringify({ version: 1, questions: { 25: { attempts: 2, solvedAt: "2026-01-01T00:00:00.000Z" } }, activeDays: [], cards: {}, lessons: { "py:cart-line-total": "2026-01-01T00:00:00.000Z" } }));
      localStorage.setItem("sqlp.project.csv-to-postgres-etl", JSON.stringify({ tasks: { "parse-csv": { passed: true, at: "2026-01-01T00:00:00.000Z", message: "ok" } }, checklist: {} }));
    } catch { /* storage unavailable */ }
  });

async function expectWorkspaceOn(page: Page, id: string) {
  await expect(page).toHaveURL(new RegExp(`/workspace\\?e=${encodeURIComponent(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect(page.getByTestId("exercise-workspace")).toBeVisible({ timeout: 60_000 });
}

test.describe("Learn hub topic page", () => {
  test("the block lists real exercises and opening one opens the workspace on it, changing no progress", async ({ page, isMobile }) => {
    const errors = watch(page);
    await seedSolved(page);
    await page.goto("/learn/topic/left-join");
    const block = page.getByTestId("workspace-practice");
    await expect(block).toBeVisible({ timeout: 30_000 });
    await expect(block.getByRole("heading", { name: "Practise in the workspace" })).toBeVisible();
    const links = block.getByTestId("workspace-exercise-link");
    const n = await links.count();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
    for (let i = 0; i < n; i++) await expect(links.nth(i)).toHaveAttribute("href", /^\/workspace\?e=(sql|py|daily)%3A/);
    await expect(block.getByTestId("workspace-practice-count")).toHaveText(/^\d+ of \d+ solved$/);
    if (isMobile) expect(await noHScroll(page)).toBeLessThanOrEqual(1);

    const before = await stores(page);
    const first = links.first();
    const id = (await first.getAttribute("data-exercise-id"))!;
    const title = (await first.locator("span.truncate").innerText()).trim();
    await first.click();
    await expectWorkspaceOn(page, id);
    await expect(page.getByTestId("exercise-workspace")).toContainText(title);
    expect(await stores(page)).toBe(before);
    expect(errors).toEqual([]);
  });

  test("shows the real state of each exercise from the learner's own record", async ({ page }) => {
    await seedSolved(page);
    // Q25 (Customers and Order Count) is solved in the seeded record and is a LEFT JOIN question.
    await page.goto("/learn/topic/left-join");
    const row = page.getByTestId("workspace-practice").locator('[data-exercise-id^="sql:q25-"]');
    if (await row.count()) await expect(row.getByText("Solved:", { exact: false })).toBeAttached();
    await page.goto("/learn/topic/python-loops");
    const py = page.getByTestId("workspace-practice").locator('[data-exercise-id="py:cart-line-total"]');
    if (await py.count()) await expect(py.getByText("Solved:", { exact: false })).toBeAttached();
    await expect(page.getByTestId("workspace-practice-count")).toHaveText(/^\d+ of \d+ solved$/);
  });

  test("a topic with no exercise shows no block and keeps its empty practice state", async ({ page }) => {
    await page.goto("/learn/topic/dbt-models");
    await expect(page.getByTestId("workspace-practice")).toHaveCount(0);
    await expect(page.getByText("No graded practice is linked to this topic yet")).toBeVisible();
  });
});

test("path page: the next-exercise link opens the workspace", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/learn/path/data-analyst");
  const step = page.getByTestId("path-workspace-step");
  await expect(step).toBeVisible();
  const id = (await step.getAttribute("data-exercise-id"))!;
  await step.click();
  await expectWorkspaceOn(page, id);
  expect(errors).toEqual([]);
});

test.describe("Projects Lab", () => {
  test("a task entry point opens the right exercise and the project record is untouched", async ({ page, isMobile }) => {
    const errors = watch(page);
    await seedSolved(page);
    await page.goto("/projects-lab/rest-api-to-postgres");
    const box = page.locator("#task-flatten-json").locator("xpath=ancestor::section[1]").getByTestId("task-practice");
    await expect(box).toBeVisible();
    await box.locator("summary").click();
    const link = box.locator('[data-exercise-id="daily:e104#g4"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/workspace?e=daily%3Ae104%23g4");
    if (isMobile) expect(await noHScroll(page)).toBeLessThanOrEqual(1);
    // a task with no genuine exercise (a land-raw-json SQL task) has no entry point; a decision task never does
    await expect(page.locator("#task-land-raw-json").locator("xpath=ancestor::section[1]").getByTestId("task-practice")).toHaveCount(0);
    await expect(page.locator("#task-d-pagination").locator("xpath=ancestor::section[1]").getByTestId("task-practice")).toHaveCount(0);
    const before = await stores(page);
    await link.click();
    await expectWorkspaceOn(page, "daily:e104#g4");
    await expect(page.getByTestId("exercise-workspace")).toContainText("Flatten with json_normalize");
    expect(await stores(page)).toBe(before);
    expect(errors).toEqual([]);
  });

  test("a seeded project keeps its status and passed task after the page renders and an entry is opened", async ({ page }) => {
    await seedSolved(page);
    await page.goto("/projects-lab/csv-to-postgres-etl");
    await expect(page.locator("strong").filter({ hasText: /^1\/\d+$/ })).toBeVisible({ timeout: 30_000 });
    const box = page.locator("#task-idempotent-load").locator("xpath=ancestor::section[1]").getByTestId("task-practice");
    await box.locator("summary").click();
    await box.getByTestId("workspace-exercise-link").first().click();
    await expect(page.getByTestId("exercise-workspace")).toBeVisible({ timeout: 60_000 });
    await page.goto("/projects-lab/csv-to-postgres-etl");
    await expect(page.locator("strong").filter({ hasText: /^1\/\d+$/ })).toBeVisible({ timeout: 30_000 });
  });
});

test("scenario page: practise-the-concept entry opens the question in the workspace", async ({ page, isMobile }) => {
  const errors = watch(page);
  await page.goto("/scenarios/monthly-revenue-growth");
  const box = page.getByTestId("scenario-practice");
  await expect(box).toBeVisible();
  await box.locator("summary").click();
  await box.getByTestId("workspace-exercise-link").click();
  await expectWorkspaceOn(page, "sql:q152-month-over-month-revenue-change");
  if (isMobile) expect(await noHScroll(page)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("question pages and lists: header link, topic and list links open the workspace", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/questions/q01-product-revenue");
  await page.getByTestId("open-in-workspace").first().click();
  await expectWorkspaceOn(page, "sql:q01-product-revenue");
  await page.goto("/topics/left-join");
  const next = page.getByTestId("next-question-workspace").getByTestId("workspace-exercise-link");
  const id = (await next.getAttribute("data-exercise-id"))!;
  await next.click();
  await expectWorkspaceOn(page, id);
  await page.goto("/questions");
  await expect(page.getByTestId("next-question-workspace")).toBeVisible();
  expect(errors).toEqual([]);
});

test("no sideways scroll on the new blocks on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout only");
  for (const path of ["/learn/topic/window-functions", "/learn/topic/excel", "/learn/path/sql-developer", "/projects-lab/star-schema-warehouse", "/topics/window-functions"]) {
    await page.goto(path);
    expect(await noHScroll(page), path).toBeLessThanOrEqual(1);
  }
});
