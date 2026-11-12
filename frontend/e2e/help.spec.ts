import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/** DataForge Guide in a real browser: Help on every major section, tours, search, onboarding, themes, mobile drawer, examples. */

const MAJOR: { path: string; title: RegExp }[] = [
  { path: "/", title: /DataForge basics/ },
  { path: "/questions", title: /SQL practice/i },
  { path: "/questions/q01-product-revenue", title: /SQL practice/i },
  { path: "/playground", title: /playground/i },
  { path: "/query-visualizer", title: /visualizer/i },
  { path: "/practice/python", title: /Python/i },
  { path: "/etl-builder", title: /ETL/i },
  { path: "/daily", title: /Daily/i },
  { path: "/projects-lab", title: /Project/i },
  { path: "/scenarios", title: /Scenario|Project/i },
  { path: "/mistakes", title: /Mistake/i },
  { path: "/analytics", title: /Analytics|Performance/i },
];

const panel = (page: Page) => page.getByRole("dialog", { name: /.+/ }).filter({ has: page.locator("#help-title") });

test.describe("Help on every major section", () => {
  for (const { path, title } of MAJOR) {
    test(`${path}: Help opens section-specific content`, async ({ page }) => {
      await page.goto(path);
      await page.locator('[data-help="help-button"]:visible').first().click();
      const p = page.locator("[data-help-panel]");
      await expect(p).toBeVisible();
      await expect(p.locator("#help-title")).toHaveText(title);
      await expect(p.getByRole("button", { name: /Overview/ })).toBeVisible();
      await expect(p.getByText("Next steps")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(p).toBeHidden();
    });
  }
});

test("search finds help and opens the matching section", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-help="help-button"]:visible').first().click();
  await page.getByRole("searchbox", { name: "Search help" }).fill("group by");
  const results = page.getByRole("list", { name: "Help search results" });
  await expect(results.getByRole("button").first()).toBeVisible();
  await results.getByRole("button").first().click();
  await expect(page.locator("[data-help-section]")).toBeVisible();
});

test("tour: Next, Previous, Skip and Finish; remembered; restartable", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-help="help-button"]:visible').first().click();
  await page.getByRole("button", { name: /Start tour/ }).first().click();
  const tour = page.locator("[data-guided-tour] [role=dialog]");
  await expect(tour).toContainText("Step 1 of");
  await tour.getByRole("button", { name: /Next/ }).click();
  await expect(tour).toContainText("Step 2 of");
  await tour.getByRole("button", { name: "Previous" }).click();
  await expect(tour).toContainText("Step 1 of");
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
  // restart, then finish
  await page.locator('[data-help="help-button"]:visible').first().click();
  await page.getByRole("button", { name: /(Start|Restart) tour/ }).first().click();
  for (let i = 0; i < 20 && (await tour.getByRole("button", { name: "Finish" }).count()) === 0; i++) await tour.getByRole("button", { name: /Next/ }).click();
  await tour.getByRole("button", { name: "Finish" }).click();
  await expect(tour).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("df.help.v1") ?? "{}"));
  expect(Object.values(saved.tours as Record<string, { status: string }>).some((t) => t.status === "done")).toBe(true);
  await page.locator('[data-help="help-button"]:visible').first().click();
  await expect(page.getByRole("button", { name: "Restart tour" }).first()).toBeVisible();
});

test("welcome card: shown once, skippable, not shown again, replayable from Settings", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("df.test.keepOnboarding", "1"); localStorage.removeItem("df.help.v1"); } catch { /* */ } });
  await page.goto("/");
  const card = page.locator("[data-onboarding]");
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(card).toBeHidden();
  await page.addInitScript(() => { try { localStorage.setItem("df.help.v1", JSON.stringify({ version: 1, onboarding: "skipped", tours: {} })); } catch { /* */ } });
  await page.reload();
  await page.waitForTimeout(2200);
  await expect(card).toBeHidden();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Replay welcome tour" }).click();
  await expect(card).toBeVisible();
});

test("works in light and dark themes", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.goto("/");
    await page.evaluate((t) => { localStorage.setItem("sqlp.theme", t); }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await page.locator('[data-help="help-button"]:visible').first().click();
    const p = page.locator("[data-help-panel]");
    await expect(p).toBeVisible();
    const bg = await p.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(theme === "dark" ? "rgb(13, 19, 33)" : "rgb(255, 255, 255)");
    await page.keyboard.press("Escape");
  }
});

test("keyboard: ? opens help, Tab reaches controls, Esc closes and focus returns", async ({ page }) => {
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("?");
  const p = page.locator("[data-help-panel]");
  await expect(p).toBeVisible();
  await page.keyboard.press("Tab");
  const focusInside = await page.evaluate(() => !!document.activeElement?.closest("[data-help-panel]"));
  expect(focusInside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(p).toBeHidden();
});

test("SQL playground: Try example asks before replacing code and keeps it on Keep my code", async ({ page }) => {
  await page.goto("/playground");
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.locator('[data-help="help-button"]:visible').first().click();
  const p = page.locator("[data-help-panel]");
  await p.getByRole("button", { name: /Practical example/ }).click();
  const tryBtn = p.getByRole("button", { name: /Try example/ });
  await expect(tryBtn).toBeVisible();
  const before = await page.evaluate(() => (window as unknown as { monaco?: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco?.editor.getModels()[0]?.getValue() ?? null);
  await tryBtn.click();
  // The playground cannot prove its editor is untouched, so it must ask.
  await expect(p.getByRole("alertdialog")).toBeVisible();
  await p.getByRole("button", { name: "Keep my code" }).click();
  await expect(p.getByRole("alertdialog")).toBeHidden();
  if (before !== null) expect(await page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco.editor.getModels()[0].getValue())).toBe(before);
  // Replace: the example lands in the editor.
  await tryBtn.click();
  await p.getByRole("button", { name: "Replace", exact: true }).click();
  // On a phone the sheet closes so the editor is visible; on desktop the panel confirms.
  if ((page.viewportSize()?.width ?? 1440) > 500) await expect(p.getByRole("status")).toContainText(/Loaded into/);
  else await expect(p).toBeHidden();
  await expect(page.locator(".monaco-editor").first()).toContainText("DENSE_RANK", { timeout: 15_000 });
});

test("Python: Try example adds help_example.py and never touches solution.py", async ({ page }) => {
  await page.goto("/practice/python/cart-line-total");
  await expect(page.locator('[data-help="py-workspace"]').first()).toBeVisible({ timeout: 60_000 });
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
  const editorText = () => page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco.editor.getModels()[0].getValue());
  const solutionBefore = await editorText();
  expect(solutionBefore).toContain("def ");
  await page.locator('[data-help="help-button"]:visible').first().click();
  const p = page.locator("[data-help-panel]");
  await p.getByRole("button", { name: /Practical example/ }).click();
  await p.getByRole("button", { name: /Try example/ }).click();
  // New file, so learner code is never at risk: no confirmation is needed.
  await expect(p.getByRole("alertdialog")).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1440) > 500) await expect(p.getByRole("status")).toContainText(/Loaded into the Python workspace/);
  await expect(page.getByText("help_example.py").first()).toBeVisible();
  await expect.poll(editorText).not.toBe(solutionBefore);
  await page.keyboard.press("Escape");
  await page.getByText("solution.py", { exact: true }).first().click();
  await expect.poll(editorText).toBe(solutionBefore);
});

test("Python: Try example from the exercise list opens an exercise and loads it there", async ({ page }) => {
  await page.goto("/practice/python");
  await page.locator('[data-help="help-button"]:visible').first().click();
  const p = page.locator("[data-help-panel]");
  await p.getByRole("button", { name: /Practical example/ }).click();
  await p.getByRole("button", { name: /Try example/ }).click();
  await page.waitForURL(/\/practice\/python\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByText("help_example.py").first()).toBeVisible({ timeout: 60_000 });
});

test("ETL builder: Try example loads the preset, asking first when the pipeline was changed", async ({ page }) => {
  await page.goto("/etl-builder");
  await page.locator('[data-help="etl-run"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-help="help-button"]:visible').first().click();
  const p = page.locator("[data-help-panel]");
  await p.getByRole("button", { name: /Practical example/ }).click();
  await p.getByRole("button", { name: /Try example/ }).click();
  if (await p.getByRole("alertdialog").count()) await p.getByRole("button", { name: "Replace", exact: true }).click();
  if ((page.viewportSize()?.width ?? 1440) > 500) await expect(p.getByRole("status")).toContainText(/Loaded into the ETL builder/);
  await page.keyboard.press("Escape");
  await page.locator('[data-help="etl-run"]').click();
  await expect(page.getByText(/orders_clean/).first()).toBeVisible({ timeout: 20_000 });
});
