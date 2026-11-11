import { expect, test } from "./fixtures";

// Run against a prerendered build to exercise hydration (the Vite dev server does not prerender):
//   E2E_BASE_URL=http://localhost:<port> npx playwright test e2e/guided-labs.spec.ts
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); }); // includes React #418/#423/#425 hydration errors
});

const first = "Find incomplete customers";
const dedupe = "Keep one row per customer";

test("guided labs: the plain page and a deep link both hydrate, and switching exercises follows the URL, back and forward", async ({ page }) => {
  await page.goto("/dq-exercises");
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");

  await page.getByRole("navigation", { name: "Exercises" }).getByRole("button", { name: new RegExp(dedupe) }).click();
  await expect(page).toHaveURL(/e=dq-dedupe/);
  await expect(page.getByRole("heading", { name: dedupe })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: dedupe })).toBeVisible();

  // Opening the deep link directly (what a shared link does).
  await page.goto("/dq-exercises?e=dq-dedupe");
  await expect(page.getByRole("heading", { name: dedupe })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Exercises" }).getByRole("button", { name: new RegExp(dedupe) })).toHaveAttribute("aria-current", "true");
});

test("guided labs: the scenarios page deep link and an unknown exercise id also hydrate cleanly", async ({ page }) => {
  await page.goto("/de-scenarios?e=de-batch-upsert");
  await expect(page.getByRole("navigation", { name: "Exercises" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Exercises" }).locator('[aria-current="true"]')).toHaveCount(1);
  await page.goto("/dq-exercises?e=does-not-exist");
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
});
