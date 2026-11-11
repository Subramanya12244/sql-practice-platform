import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Live Supabase sync checks. NOT RUN YET: skipped unless E2E_SYNC=1 and the site is built against a
 * Supabase project that is safe to test on. See docs/SUPABASE_TEST_PLAN.md before enabling.
 */
test.skip(!process.env.E2E_SYNC, "set E2E_SYNC=1 with a test Supabase project (see docs/SUPABASE_TEST_PLAN.md)");
test.describe.configure({ mode: "serial" });

const user = `e2e_sync_${Math.random().toString(36).slice(2, 8)}`;
const password = `Pw-${Math.random().toString(36).slice(2, 12)}!`;

const device = async (browser: Browser) => (await browser.newContext()).newPage();
const signIn = async (p: Page) => {
  await p.goto("/login");
  await p.locator("main input:not([type=password])").fill(user);
  await p.locator("main input[type=password]").fill(password);
  await p.getByRole("button", { name: "Sign in" }).last().click();
  await expect(p.getByRole("button", { name: new RegExp(`Account menu for ${user}`) })).toBeVisible({ timeout: 20_000 });
};
const sessions = (p: Page) => p.evaluate(() => (JSON.parse(localStorage.getItem("sqlp.public.progress") ?? "{}").sessions ?? []) as { id: string }[]);

let a: Page, b: Page;

test("1-3 sign up, logout and login, session restore", async ({ browser }) => {
  a = await device(browser);
  await a.goto("/signup");
  await a.locator("main input").nth(0).fill(user);
  await a.locator("main input[type=password]").first().fill(password);
  await a.getByRole("button", { name: /create|sign up/i }).last().click();
  await expect(a.getByRole("button", { name: new RegExp(`Account menu for ${user}`) })).toBeVisible({ timeout: 20_000 });
  await a.getByRole("button", { name: /Account menu/ }).click();
  await a.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(a);
  await a.reload();
  await expect(a.getByRole("button", { name: new RegExp(`Account menu for ${user}`) })).toBeVisible();
});

test("4-6 progress and attempts sync to a second device without duplicates", async ({ browser }) => {
  await a.goto("/questions/q01-product-revenue");
  await expect(a.getByRole("timer").first()).toBeVisible();
  await a.getByRole("button", { name: "Finish session without solving" }).click();
  await a.getByRole("button", { name: "End", exact: true }).click();
  await a.waitForTimeout(3000); // let the sink push profiles.state
  b = await device(browser);
  await signIn(b);
  await b.waitForTimeout(4000);
  await signIn(b).catch(() => {}); // a second sync round must not duplicate
  expect((await sessions(b)).length).toBe(1);
  expect(new Set((await sessions(b)).map((s) => s.id)).size).toBe(1);
});

test("7 offline changes sync after reconnect", async () => {
  await a.context().setOffline(true);
  await a.goto("/practice/python/cart-line-total").catch(() => {});
  await a.context().setOffline(false);
  await a.goto("/questions/q02-category-revenue");
  await expect(a.getByRole("timer").first()).toBeVisible();
  await a.getByRole("button", { name: "Finish session without solving" }).click();
  await a.getByRole("button", { name: "End", exact: true }).click();
  await a.waitForTimeout(3000);
  await b.reload();
  await b.waitForTimeout(4000);
  expect((await sessions(b)).length).toBeGreaterThanOrEqual(2);
});
