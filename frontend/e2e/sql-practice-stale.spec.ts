import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * SQL Practice, Visualize query tab: the visualization belongs to the newest SUCCESSFULLY executed query, and the notice above it says
 * whether it is the editor's query, the last successful run, or an earlier one. Real route, real PostgreSQL in WebAssembly, desktop and phone.
 * Release finding F1: on a phone, "Visualize ↗" used to show a visualization of the reference/starter query (Q01: 75 rows) before the
 * learner ran anything, and kept it after a failed Run.
 */
const small = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
const A = "SELECT product_name FROM products ORDER BY product_name LIMIT 7";
const B = "SELECT product_name FROM products ORDER BY product_name LIMIT 3";
const BAD = "SELECT x FROM no_such_table";
type M = { editor: { getModels: () => { setValue: (v: string) => void }[] } };

const notice = (page: Page) => page.getByTestId("classic-stale-notice");
const expectNotice = (page: Page, status: string, reason: string) =>
  expect(notice(page)).toHaveAttribute("data-status", status, { timeout: 30_000 }).then(() => expect(notice(page)).toHaveAttribute("data-reason", reason, { timeout: 5_000 }));
const finalResult = (page: Page) => page.getByText(/Final result \(/);
const execCount = (page: Page) => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem("sqlp.exec.q1") ?? "[]") as unknown[]).length; } catch { return 0; } });

async function openQuestion(page: Page, pressVisualizeArrow = true) {
  await page.goto("/questions/q01-product-revenue");
  // On a phone the editor is hidden until the learner opens the practice panel with "Visualize ↗" (F1: what that tap shows).
  // A tap that lands while the page is still settling can miss (the sticky header moves): retried with a fresh page, as in the QA spec.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (small(page) && pressVisualizeArrow) await page.locator("button:visible", { hasText: "Visualize ↗" }).first().click();
    const ok = await page.locator(".monaco-editor").first().waitFor({ timeout: attempt < 2 ? 20_000 : 90_000 }).then(() => true, () => false);
    if (ok) break;
    if (attempt === 2) throw new Error("the Monaco editor never became visible");
    await page.reload();
  }
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: M }).monaco?.editor.getModels().length), null, { timeout: 60_000 });
}
const setSql = (page: Page, sql: string) => page.evaluate((q) => (window as unknown as { monaco: M }).monaco.editor.getModels()[0].setValue(q), sql);
async function run(page: Page, sql: string) {
  const before = await execCount(page);
  await setSql(page, sql);
  await page.getByRole("button", { name: /Run All/ }).click();
  await expect.poll(() => execCount(page), { timeout: 90_000 }).toBe(before + 1);
}
const openVizTab = (page: Page) => page.locator("button:visible", { hasText: "Visualize query" }).first().click();
const pressVisualize = (page: Page) => page.locator("button:visible", { hasText: /Visualize my (latest )?query/ }).first().click();
async function visualizeLatest(page: Page) {
  await pressVisualize(page);
  await expect(page.getByRole("tab", { name: "Logical steps" })).toBeVisible({ timeout: 120_000 });
  await expect(finalResult(page).first()).toBeVisible({ timeout: 60_000 });
}

test.describe("SQL Practice: what the Visualize tab shows after Run, failures and edits", () => {
  test.beforeEach(() => { test.setTimeout(240_000); });

  test("first open: no visualization of the starter or reference query is presented as the learner's; the notice says to run first", async ({ page }) => {
    await openQuestion(page);
    await openVizTab(page);
    await expectNotice(page, "none", "no-run");
    await expect(notice(page)).toContainText("Nothing to show yet");
    await expect(page.getByTestId("classic-viz")).toHaveCount(0);
    await expect(finalResult(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Visualize my (latest )?query/ })).toHaveCount(0);
    // the "Visualize ↗ tab" link under the editor opens this same, honest state (it used to visualize the reference solution)
    if (!small(page)) {
      await page.getByRole("button", { name: "Visualize ↗ tab" }).click();
      await expectNotice(page, "none", "no-run");
      await expect(page.getByTestId("classic-viz")).toHaveCount(0);
      await expect(finalResult(page)).toHaveCount(0);
    }
  });

  test("failure first (the F1 repro): the failed Run leaves nothing visualized, and the notice says so", async ({ page }) => {
    await openQuestion(page);
    await run(page, BAD);
    await expect(page.getByText(/no_such_table|does not exist/i).first()).toBeVisible({ timeout: 60_000 });
    await openVizTab(page);
    await expectNotice(page, "none", "only-failed");
    await expect(notice(page)).toContainText("failed");
    await expect(page.getByTestId("classic-viz")).toHaveCount(0);
    await expect(finalResult(page)).toHaveCount(0);
    await expect(page.getByText("Final result (75 rows)")).toHaveCount(0);
    // asking for it shows the failed step, labelled as a failed run (not a result)
    await pressVisualize(page);
    await expectNotice(page, "current", "failed-run");
    await expect(page.getByTestId("classic-explain")).toContainText(/no_such_table|does not exist|failed|rejected/i, { timeout: 60_000 });
    await expect(finalResult(page)).toHaveCount(0);
  });

  test("a successful run after tapping Visualize ↗ shows the learner's own query (not an unrelated 75-row one), and says it is current", async ({ page }) => {
    await openQuestion(page);
    await run(page, A);
    await openVizTab(page);
    // on a phone "Visualize ↗" already asked for the visualization; on a desktop the button does
    if (!(await page.getByTestId("classic-viz").count())) await visualizeLatest(page);
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)", { timeout: 60_000 });
    await expectNotice(page, "current", "matches-editor");
    await expect(notice(page)).toContainText("Showing the query in your editor");
  });

  test("success then failure: the last successful visualization stays, and the notice says the latest run failed", async ({ page }) => {
    await openQuestion(page);
    await run(page, A);
    await openVizTab(page);
    if (!(await page.getByTestId("classic-viz").count())) await visualizeLatest(page);
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)", { timeout: 60_000 });
    await run(page, BAD);
    await expect(page.getByText(/no_such_table|does not exist/i).first()).toBeVisible({ timeout: 60_000 });
    await expectNotice(page, "last-successful", "latest-failed");
    await expect(notice(page)).toContainText("latest run failed");
    await expect(notice(page)).toContainText("last successful run");
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)");
    // looking at the failed query itself is an explicit choice, and is labelled
    await pressVisualize(page);
    await expectNotice(page, "current", "failed-run");
    await expect(finalResult(page)).toHaveCount(0);
    await expect(page.getByTestId("classic-explain")).toContainText(/no_such_table|does not exist|failed|rejected/i, { timeout: 60_000 });
    // and the way back is one button
    await page.getByRole("button", { name: "Show my last successful run" }).click();
    await expectNotice(page, "last-successful", "latest-failed");
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)", { timeout: 60_000 });
  });

  test("editing without executing: the visualization does not change, and the notice says it no longer matches the editor", async ({ page }) => {
    await openQuestion(page);
    await run(page, A);
    await openVizTab(page);
    if (!(await page.getByTestId("classic-viz").count())) await visualizeLatest(page);
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)", { timeout: 60_000 });
    await expectNotice(page, "current", "matches-editor");
    await setSql(page, B);
    await expectNotice(page, "last-successful", "edited");
    await expect(notice(page)).toContainText("changed the editor");
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)");
    expect(await execCount(page)).toBe(1);
    // putting the very same query back (only whitespace and a semicolon differ) is not an edit
    await setSql(page, `  ${A.replace(/ /g, "\n  ")} ;\n`);
    await expectNotice(page, "current", "matches-editor");
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)");
  });

  test("repeated executions: the newest successful run is the one shown", async ({ page }) => {
    await openQuestion(page);
    await run(page, A);
    await openVizTab(page);
    if (!(await page.getByTestId("classic-viz").count())) await visualizeLatest(page);
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)", { timeout: 60_000 });
    await run(page, B);
    await expect(finalResult(page).first()).toContainText("Final result (3 rows)", { timeout: 90_000 });
    await expectNotice(page, "current", "matches-editor");
    await run(page, A);
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)", { timeout: 90_000 });
    await expectNotice(page, "current", "matches-editor");
    await run(page, BAD);
    await expectNotice(page, "last-successful", "latest-failed");
    await run(page, B);
    await expect(finalResult(page).first()).toContainText("Final result (3 rows)", { timeout: 90_000 });
    await expectNotice(page, "current", "matches-editor");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("an earlier query reopened from History is marked as earlier, and the next run replaces it", async ({ page }) => {
    await openQuestion(page);
    await run(page, A);
    await run(page, B);
    await page.locator("button:visible", { hasText: /^History$/ }).first().click();
    // the History list is newest first: the second entry is A
    await page.locator("#panel-history").getByRole("button", { name: "Visualize", exact: true }).nth(1).click();
    await expectNotice(page, "stale", "older-run");
    await expect(notice(page)).toContainText("earlier query");
    await expect(finalResult(page).first()).toContainText("Final result (7 rows)", { timeout: 90_000 });
    await run(page, A);
    await expectNotice(page, "current", "matches-editor");
  });
});
