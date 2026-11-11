import { expect, test } from "./fixtures";

// Real browser: the lesson timer runs, and leaving the lesson stores active study time inside the Daily Learning progress.
test("Daily Learning: lesson timer counts active time and stores it on leaving; the dashboard shows it", async ({ page }) => {
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.goto("/daily/day/1");
  const timer = page.getByRole("group", { name: "Lesson study timer" });
  await expect(timer).toBeVisible();
  await page.waitForTimeout(7000);
  await page.getByRole("link", { name: "Daily Learning" }).first().click();
  await expect(page).toHaveURL(/\/daily$/);
  const stored = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k) ?? "";
      const m = v.includes('"study"') && /"activeSec":(\d+)/.exec(v);
      if (m) return Number(m[1]);
    }
    return null;
  });
  expect(stored).toBeGreaterThanOrEqual(5);
  await expect(page.getByRole("heading", { name: "Study time" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Study time by phase" })).toBeVisible();
});
