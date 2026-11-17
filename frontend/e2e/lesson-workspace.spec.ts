import { expect, test } from "./fixtures";

/** The Daily lesson workspace in a real browser: three panes on a wide screen, folded blocks on a phone, reading progress, and resume. */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
});

test("wide screen: day list, lesson and rail side by side, with the real status of each day", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop layout");
  await page.setViewportSize({ width: 1680, height: 950 });
  await page.goto("/daily/day/3");
  const days = page.getByRole("region", { name: "Days in this phase" });
  const rail = page.getByRole("region", { name: "About this lesson" });
  await expect(days).toBeVisible();
  await expect(rail).toBeVisible();
  const a = await days.boundingBox();
  const b = await page.getByRole("list", { name: "Lesson steps" }).boundingBox();
  const c = await rail.boundingBox();
  expect(a!.x + a!.width).toBeLessThan(b!.x); // day list is left of the lesson
  expect(b!.x + b!.width).toBeLessThan(c!.x + 1); // rail is right of it
  await expect(days.locator('a[aria-current="page"]')).toContainText("Numbers and operators");
  await expect(days).toContainText("0 of 15 days complete");
  await expect(page.getByRole("region", { name: "Key concepts" })).toContainText("floor division and modulo");
  await expect(page.getByRole("region", { name: "On this page" }).getByRole("link").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a heading in 'On this page' scrolls to that section", async ({ page, isMobile }) => {
  test.skip(isMobile, "the rail is folded on phones");
  await page.setViewportSize({ width: 1680, height: 950 });
  await page.goto("/daily/day/3");
  const toc = page.getByRole("region", { name: "On this page" });
  const last = toc.getByRole("link").last();
  const text = (await last.textContent())!.trim();
  await last.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expect(page.getByRole("heading", { name: text }).first()).toBeInViewport();
});

test("reading progress follows the scroll", async ({ page }) => {
  await page.goto("/daily/day/3");
  const bar = page.getByRole("progressbar", { name: "Reading progress" });
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(50);
});

test("leave a lesson part-way and come back: the page offers to resume, and resuming goes to that step", async ({ page }) => {
  await page.goto("/daily/day/3");
  await expect(page.getByRole("region", { name: "Resume this lesson" })).toHaveCount(0); // a first visit has nothing to resume
  await page.getByRole("list", { name: "Lesson steps" }).getByRole("button").nth(2).click(); // Guided practice
  await expect(page.getByRole("list", { name: "Lesson steps" }).getByRole("button").nth(2)).toHaveAttribute("aria-current", "step");
  await page.reload();
  const banner = page.getByRole("region", { name: "Resume this lesson" });
  await expect(banner).toContainText("Guided practice");
  await expect(page.getByRole("list", { name: "Lesson steps" }).getByRole("button").nth(0)).toHaveAttribute("aria-current", "step"); // nothing is restored without asking
  await banner.getByRole("button", { name: "Resume where you left off" }).click();
  await expect(page.getByRole("list", { name: "Lesson steps" }).getByRole("button").nth(2)).toHaveAttribute("aria-current", "step");
  await expect(banner).toHaveCount(0);
});

test("a phone folds the overview and the day list into buttons and never scrolls sideways", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  await page.goto("/daily/day/3");
  const overview = page.getByRole("button", { name: "Lesson overview" });
  const daysBtn = page.getByRole("button", { name: "Days in this phase" });
  await expect(overview).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("region", { name: "About this lesson" })).toBeHidden();
  await overview.click();
  await expect(page.getByRole("region", { name: "About this lesson" })).toBeVisible();
  await daysBtn.click();
  await expect(page.getByRole("region", { name: "Days in this phase" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the lesson's footer has previous, finish and next, and finishing needs the real work", async ({ page }) => {
  await page.goto("/daily/day/3");
  const nav = page.getByRole("navigation", { name: "Previous and next day" });
  await expect(nav.getByRole("link").first()).toContainText("Day 2");
  await expect(nav.getByRole("link").last()).toContainText("Day 4");
  await nav.getByRole("button", { name: "Finish the day" }).click();
  await expect(page.getByRole("list", { name: "Lesson steps" }).getByRole("button").nth(6)).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: /Complete day/ }).last()).toBeDisabled(); // locked until the activities are done
});
