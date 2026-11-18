import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Unified Exercise Workspace, in a real browser: one SQL, one Python, one Pandas and one NumPy exercise, on desktop and phone.
 * Each runs the learner's code in the real engine (PGlite or Pyodide). Nothing is mocked.
 */
const sqlSolution: string = JSON.parse(readFileSync("public/data/q/q01-product-revenue.json", "utf8")).solution;

const modelValue = () => (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco.editor.getModels()[0].getValue();

async function open(page: Page, id: string, isMobile: boolean) {
  await page.goto(`/workspace?e=${encodeURIComponent(id)}`);
  await expect(page.getByTestId("exercise-workspace")).toBeVisible({ timeout: 60_000 });
  if (isMobile) await page.getByRole("tab", { name: "Editor" }).click();
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
}

async function setCode(page: Page, code: string) {
  await page.evaluate((c) => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue(c), code);
}

async function tab(page: Page, isMobile: boolean, name: string) {
  if (isMobile) await page.getByRole("tab", { name }).click();
}

const phone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

test.describe("Exercise workspace", () => {
  test.setTimeout(240_000);

  test("page opens with starter exercises and no horizontal scroll", async ({ page }) => {
    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "Exercise workspace" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Starter exercises" }).getByRole("link")).toHaveCount(4);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("SQL: run, visualize, hints stay hidden, submit passes with the reference answer", async ({ page }) => {
    const isMobile = phone(page);
    await open(page, "sql:q01-product-revenue", !!isMobile);
    await setCode(page, sqlSolution);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByTestId("workspace-results")).toContainText("total_revenue", { timeout: 60_000 });

    await page.getByRole("button", { name: "Visualize" }).click();
    await tab(page, !!isMobile, "Visualization");
    await expect(page.getByTestId("visualizer-box")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("workspace-visual")).toContainText(/Executed|Parsed/);

    await tab(page, !!isMobile, "Explanation");
    // Nothing is revealed until asked: no solution text on the page.
    await expect(page.getByTestId("workspace-explanation")).not.toContainText("unit_price * od.quantity");
    await expect(page.getByRole("button", { name: /Show level 1/ })).toBeVisible();

    await tab(page, !!isMobile, "Editor");
    await page.getByRole("button", { name: "Submit" }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByText("Correct. All checks passed.")).toBeVisible({ timeout: 60_000 });
  });

  test("SQL: a wrong query fails the check with feedback and is not marked solved", async ({ page }) => {
    const isMobile = phone(page);
    await open(page, "sql:q01-product-revenue", !!isMobile);
    await setCode(page, "SELECT 1 AS wrong");
    await page.getByRole("button", { name: "Submit" }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByText("Not yet. At least one check failed.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Correct. All checks passed.")).toHaveCount(0);
  });

  test("Python: run, trace with stepping, submit passes", async ({ page }) => {
    const isMobile = phone(page);
    await open(page, "py:cart-line-total", !!isMobile);
    const code = [
      "def cart_total(items):",
      "    total = 0",
      "    for it in items:",
      "        if it['qty'] > 0:",
      "            total += it['price'] * it['qty']",
      "    return round(total, 2)",
      "",
      "print(cart_total([{'price': 2.5, 'qty': 2}, {'price': 9, 'qty': 0}]))",
    ].join("\n");
    await setCode(page, code);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByTestId("workspace-results")).toContainText("5.0", { timeout: 120_000 });

    await page.getByRole("button", { name: "Visualize" }).click();
    await tab(page, !!isMobile, "Visualization");
    await expect(page.getByTestId("visualizer-box")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("workspace-visual")).toContainText(/total/i);

    await tab(page, !!isMobile, "Editor");
    await page.getByRole("button", { name: "Submit" }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByText("Correct. All checks passed.")).toBeVisible({ timeout: 120_000 });
  });

  test("Python: an error is explained and can still be visualized", async ({ page }) => {
    const isMobile = phone(page);
    await open(page, "py:cart-line-total", !!isMobile);
    await setCode(page, "items = [1, 2]\nprint(items[5])");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByTestId("workspace-results").getByRole("alert")).toContainText("IndexError", { timeout: 120_000 });
    await page.getByRole("button", { name: "Visualize" }).click();
    await tab(page, !!isMobile, "Visualization");
    await expect(page.getByTestId("workspace-visual")).toContainText(/IndexError|index/i, { timeout: 120_000 });
  });

  test("Pandas: stages show shapes from the real run", async ({ page }) => {
    const isMobile = phone(page);
    const id = await page.goto("/workspace").then(async () => page.getByRole("list", { name: "Starter exercises" }).getByRole("link").nth(2).getAttribute("href"));
    const e = new URL(id!, "http://x").searchParams.get("e")!;
    await open(page, e, !!isMobile);
    await setCode(page, "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2, 3, 4], 'b': list('wxyz')})\nkept = df[df.a > 2]\nprint(kept)");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByTestId("workspace-results")).toContainText("z", { timeout: 120_000 });
    await page.getByRole("button", { name: "Visualize" }).click();
    await tab(page, !!isMobile, "Visualization");
    const box = page.getByTestId("visualizer-box");
    await expect(box).toContainText("Stage 1 of 2", { timeout: 120_000 });
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(box).toContainText("Stage 2 of 2");
    await expect(box).toContainText("4 in, 2 retained, 2 removed");
  });

  test("NumPy: broadcasting shapes come from the real arrays", async ({ page }) => {
    const isMobile = phone(page);
    await page.goto("/workspace");
    const href = await page.getByRole("list", { name: "Starter exercises" }).getByRole("link").nth(3).getAttribute("href");
    const e = new URL(href!, "http://x").searchParams.get("e")!;
    await open(page, e, !!isMobile);
    await setCode(page, "import numpy as np\na = np.ones((3, 1))\nb = np.ones((1, 4))\nc = a + b\nprint(c.shape)");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByTestId("workspace-results")).toContainText("(3, 4)", { timeout: 120_000 });
    await page.getByRole("button", { name: "Visualize" }).click();
    await tab(page, !!isMobile, "Visualization");
    await expect(page.getByTestId("visualizer-box")).toContainText("(3, 4)", { timeout: 120_000 });
  });

  test("Open in workspace links exist on the existing exercise pages", async ({ page }) => {
    await page.goto("/questions/q01-product-revenue");
    await expect(page.getByTestId("open-in-workspace").first()).toHaveAttribute("href", /workspace\?e=sql%3Aq01-product-revenue/);
    await page.goto("/practice/python/cart-line-total");
    await expect(page.getByTestId("open-in-workspace").first()).toHaveAttribute("href", /workspace\?e=py%3Acart-line-total/);
  });

  test("layout: mobile has five tabs, desktop has the split workspace; no horizontal scroll", async ({ page }) => {
    const isMobile = phone(page);
    await open(page, "sql:q01-product-revenue", !!isMobile);
    if (isMobile) {
      for (const name of ["Problem", "Editor", "Visualization", "Results", "Explanation"]) await expect(page.getByRole("tab", { name })).toBeVisible();
      await expect(page.getByTestId("exercise-workspace")).toHaveAttribute("data-layout", "tabs");
    } else {
      await expect(page.getByTestId("exercise-workspace")).toHaveAttribute("data-layout", "split");
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    void modelValue;
  });
});
