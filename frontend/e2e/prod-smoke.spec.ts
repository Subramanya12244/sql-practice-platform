import { expect, test } from "./fixtures";

// Loads each key route of a prerendered build and fails on any page error (this includes React hydration errors #418/#423/#425).
// It creates no accounts and writes nothing but browser-local state.
//   E2E_BASE_URL=https://dataforge.dataforge-learn.workers.dev npx playwright test e2e/prod-smoke.spec.ts
const ROUTES = [
  "/", "/daily", "/daily/day/1", "/daily/day/42", "/daily/day/90", "/daily/analyst/day/100", "/daily/engineer/day/95", "/daily/engineer/day/165",
  "/login", "/signup", "/reset-password", "/account", "/account?reset",
  "/learn", "/notes/left-join", "/questions/q01-product-revenue", "/practice/python", "/playground",
  "/mistakes", "/review", "/analytics", "/career/planner", "/mock-interview", "/portfolio",
  "/etl-builder", "/dag-simulator", "/schema-designer", "/dq-exercises", "/dq-exercises?e=dq-dedupe", "/de-scenarios", "/de-scenarios?e=de-batch-upsert",
];

for (const route of ROUTES) {
  test(`loads without page errors: ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(route, { waitUntil: "load" });
    expect(res?.status(), `${route} status`).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(1500); // let hydration and the first effects run
    expect(errors, `page errors on ${route}`).toEqual([]);
  });
}

test("login shows the sign-in form on the deployed build (accounts are enabled)", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});

test("a Daily Learning lesson runs Python in the browser", async ({ page }) => {
  await page.goto("/daily/day/1");
  const steps = page.getByRole("list", { name: "Lesson steps" });
  await steps.getByRole("button").nth(1).click();
  await page.getByRole("button", { name: "Run", exact: true }).first().click();
  await expect(page.locator("pre").first()).toBeVisible({ timeout: 120_000 });
});

test("a Daily Learning lesson runs SQL in the browser", async ({ page }) => {
  await page.goto("/daily/day/32");
  const steps = page.getByRole("list", { name: "Lesson steps" });
  await steps.getByRole("button").nth(1).click();
  await page.getByRole("button", { name: "Run", exact: true }).first().click();
  await expect(page.getByRole("table").first()).toBeVisible({ timeout: 120_000 });
});
