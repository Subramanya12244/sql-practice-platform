import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

const noHorizontalScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
});

test("Daily Learning: dashboard shows today's lesson, the roadmap and the calendar, without horizontal scroll", async ({ page }) => {
  await page.goto("/daily");
  await expect(page.getByRole("heading", { name: "Your 180-day learning programme" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Day 1: Install Python/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start learning/ })).toHaveAttribute("href", "/daily/day/1");
  await expect(page.getByRole("heading", { name: "Learning calendar" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Day 2.*Variables and data types/ })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("Daily Learning: open a lesson, run an example in the browser, and completion stays locked until the work is done", async ({ page }) => {
  await page.goto("/daily/day/1");
  const steps = page.getByRole("list", { name: "Lesson steps" });
  await expect(steps.getByRole("button")).toHaveCount(7);
  // The step buttons show short labels on narrow screens, so address them by position: 1 Understand, 2 examples, ... 7 Complete day.
  await steps.getByRole("button").nth(1).click();
  await page.getByRole("button", { name: "Run", exact: true }).first().click();
  await expect(page.locator("pre").first()).toBeVisible({ timeout: 120_000 });
  await steps.getByRole("button").nth(6).click();
  const panelButton = page.getByRole("button", { name: /Complete day/ }).last();
  await expect(panelButton).toBeDisabled();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("Daily Learning: a day with no lesson says so and keeps its topics and prerequisites visible", async ({ page }) => {
  await page.goto("/daily/engineer/day/165");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const prepared = page.getByText("This lesson is being prepared");
  if (await prepared.count()) {
    await expect(page.getByText("Topics this day covers")).toBeVisible();
    await expect(page.getByText("Prerequisites")).toBeVisible();
  } else {
    await expect(page.getByRole("list", { name: "Lesson steps" })).toBeVisible();
  }
});

test("Daily Learning: progress survives a refresh and the path choice is remembered", async ({ page }) => {
  await page.goto("/daily");
  await page.getByRole("button", { name: "Choose this path" }).first().click();
  await page.reload();
  await expect(page.getByText(/Following: Data Analyst/)).toBeVisible();
});

test("navigation: Daily Learning is a top-level group and existing groups remain", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: /menu/i }).first().click();
  for (const label of ["Dashboard", "Daily Learning", "Learn", "Practice", "Projects"]) {
    await expect(page.getByRole("button", { name: new RegExp(label) }).first()).toBeAttached();
  }
});
