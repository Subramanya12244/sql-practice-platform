import { expect, test, type Page } from "@playwright/test";

const timerSeconds = async (p: Page) => {
  const t = await p.getByRole("timer").first().innerText();
  const n = t.split(":").map(Number);
  return n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
};
const editor = async (p: Page, text: string) => {
  await p.locator(".monaco-editor").first().click();
  await p.keyboard.press("ControlOrMeta+A");
  await p.keyboard.insertText(text);
};
const noHorizontalScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); }); // includes React #419/#418
});

test("solve timer: starts, pauses, survives refresh", async ({ page }) => {
  await page.goto("/questions/q01-product-revenue");
  await expect(page.getByRole("timer").first()).toBeVisible();
  await page.waitForTimeout(2500);
  expect(await timerSeconds(page)).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Pause timer" }).click();
  const frozen = await timerSeconds(page);
  await page.waitForTimeout(2500);
  expect(await timerSeconds(page)).toBe(frozen);
  await page.reload();
  await expect(page.getByRole("timer").first()).toBeVisible();
  expect(await timerSeconds(page)).toBeGreaterThanOrEqual(frozen);
});

test("SQL: valid query returns rows, invalid query shows the coach", async ({ page, isMobile }) => {
  await page.goto("/questions/q01-product-revenue");
  if (isMobile) await page.getByRole("link", { name: /Jump to the editor/ }).click();
  await editor(page, "SELECT product_id, product_name FROM products ORDER BY product_id LIMIT 3;");
  await page.getByRole("button", { name: /Run All/ }).click();
  await expect(page.getByText("product_name").first()).toBeVisible({ timeout: 60_000 });
  await editor(page, "SELECT employee_id FROM products;");
  await page.getByRole("button", { name: /Run All/ }).click();
  await expect(page.getByText(/Unknown column/)).toBeVisible({ timeout: 30_000 });
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("Python: run, stop an infinite loop, run again", async ({ page, isMobile }) => {
  await page.goto("/practice/python/cart-line-total");
  if (isMobile) await page.getByRole("link", { name: /Jump to the workspace/ }).click();
  await editor(page, "print('hello' + str(6 * 7))\n");
  await page.getByRole("button", { name: /Run Script/ }).click();
  await expect(page.getByLabel("Console Output")).toContainText("hello42", { timeout: 90_000 });
  await editor(page, "while True:\n    pass\n");
  await page.getByRole("button", { name: /Run Script/ }).click();
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect(page.getByLabel("Console Output")).toContainText(/stopped/i);
  await editor(page, "print('again' + str(1 + 1))\n");
  await page.getByRole("button", { name: /Run Script/ }).click();
  await expect(page.getByLabel("Console Output")).toContainText("again2", { timeout: 90_000 });
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("two tabs share one session", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto("/practice/python/cart-line-total");
  await b.goto("/practice/python/cart-line-total");
  await a.waitForTimeout(1500);
  const sessions = await a.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("sqlp.solve.active") ?? "{}")));
  expect(sessions).toEqual(["py:cart-line-total"]);
});

test("navigation works and analytics page renders", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByRole("button", { name: /menu/i }).first().click();
    await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  }
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Performance analytics" })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("error log: an uncaught error is saved and shown in /debug after reload", async ({ page }) => {
  await page.goto("/questions/q01-product-revenue");
  await expect(page.getByRole("timer").first()).toBeVisible(); // hydrated: global handlers are installed
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { error: new Error("e2e synthetic failure"), message: "e2e synthetic failure" })));
  await page.goto("/debug");
  await expect(page.getByText(/UNCAUGHT_ERROR/).first()).toBeVisible();
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem("sqlp.diag.log") ?? "[]") as { technicalMessage: string }[]).some((e) => e.technicalMessage.includes("e2e synthetic")))).toBe(true);
});
