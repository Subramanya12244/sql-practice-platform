import type { Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";

/**
 * SQL Practice (the question page, /questions/q01-product-revenue) shows the ORIGINAL SQL visualizer, not the SQL Query Cinema:
 * stage buttons, the five tabs, the shared playback bar and the row-movement panel, on real PostgreSQL in WebAssembly.
 * With SQLVIZ_SHOTS=1 it writes the screenshots used by docs/SQL_PRACTICE_ORIGINAL_VISUALIZER_RESTORATION.md.
 */
const SHOTS = process.env.SQLVIZ_SHOTS === "1";
const shotDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/images/sql-practice-original");
const small = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
const shot = async (page: Page, name: string) => { if (!SHOTS) return; await page.waitForTimeout(1500); await page.screenshot({ path: path.join(shotDir, `${name}-${small(page) ? "mobile" : "desktop"}.png`) }); };

const QUERIES: { name: string; sql: string }[] = [
  { name: "select-where", sql: "SELECT product_name, unit_price FROM products WHERE unit_price > 50 ORDER BY unit_price DESC" },
  { name: "inner-join", sql: "SELECT p.product_name, od.quantity FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE od.quantity > 50" },
  { name: "left-join", sql: "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL" },
  { name: "group-by", sql: "SELECT c.country, COUNT(*) AS n, SUM(o.freight) AS f FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.country HAVING COUNT(*) > 5 ORDER BY n DESC" },
  { name: "order-by", sql: "SELECT product_name FROM products ORDER BY product_name LIMIT 7" },
  { name: "subquery", sql: "SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products)" },
  { name: "cte", sql: "WITH big AS (SELECT order_id, SUM(quantity) AS q FROM order_details GROUP BY order_id) SELECT order_id, q FROM big WHERE q > 100 ORDER BY q DESC" },
  { name: "q01-product-revenue", sql: "SELECT p.product_id, p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS total_revenue FROM products p JOIN order_details od ON od.product_id = p.product_id GROUP BY p.product_id, p.product_name ORDER BY total_revenue DESC" },
];

async function runAndVisualize(page: Page, sql: string) {
  await page.goto("/questions/q01-product-revenue");
  // On a phone the editor is hidden until the learner opens the practice panel.
  if (small(page)) await page.locator("button:visible", { hasText: "Visualize ↗" }).first().click();
  await page.locator(".monaco-editor").first().waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: { editor: { getModels: () => unknown[] } } }).monaco?.editor.getModels().length), null, { timeout: 60_000 });
  await page.evaluate((q) => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue(q), sql);
  await page.getByRole("button", { name: /Run All/ }).click();
  // The Results panel reports how many rows the query returned. On a phone that panel sits in a hidden container (its chip has no size)
  // and the only visible "N rows" chips belong to the visualizer itself, so the count is read on a desktop only; on a phone the
  // final-result caption is checked on its own (the `rows === null` branch below).
  let rows: number | null = null;
  if (!small(page)) {
    const chip = page.getByText(/^\d[\d,]* rows?$/).filter({ visible: true }).first();
    rows = await chip.waitFor({ state: "visible", timeout: 90_000 }).then(async () => Number((await chip.innerText()).replace(/[^\d]/g, ""))).catch(() => null);
  } else await page.getByRole("table").first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
  await page.locator("button:visible", { hasText: "Visualize query" }).first().click();
  await page.locator("button:visible", { hasText: /Visualize my (latest )?query/ }).first().click();
  await expect(page.getByRole("tab", { name: "Logical steps" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("rowflow-identity")).toContainText(/real \(ctid\)|trace|stage/i, { timeout: 60_000 });
  // Wait for the real row ids: until they arrive the first frame is drawn from the stage sample (kind "scan") and is then replaced
  // (kind "join" for FROM + JOIN), so a kind read before that moment is not the settled one.
  await expect(page.getByTestId("rowflow-refining")).toHaveCount(0, { timeout: 60_000 });
  return rows;
}

test.describe("SQL Practice shows the original visualizer", () => {
  test.beforeEach(() => { test.setTimeout(240_000); });

  for (const q of QUERIES) {
    test(`${q.name}: the original visualizer is rendered (stage buttons, five tabs, playback, row movement), never the Cinema, and its final result matches the query`, async ({ page }) => {
      const rows = await runAndVisualize(page, q.sql);
      // the original, not the Cinema
      await expect(page.getByTestId("cinema")).toHaveCount(0);
      await expect(page.getByTestId("cinema-rail")).toHaveCount(0);
      await expect(page.getByTestId("cinema-expand")).toHaveCount(0);
      for (const t of ["Logical steps", "Flow diagram", "Relationships", "Structure", "Execution plan"]) await expect(page.getByRole("tab", { name: t })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("group", { name: "Playback controls" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("rowflow").first()).toBeVisible({ timeout: 30_000 });
      // its final result is the real result the Results panel reports
      if (rows !== null) await expect(page.getByText(/Final result \(/).first()).toContainText(`Final result (${rows.toLocaleString()} row`);
      else await expect(page.getByText(/Final result \(\d+ rows?\)/).first()).toBeVisible();
      if (q.name === "q01-product-revenue" || q.name === "inner-join") await shot(page, `after-${q.name}-from`);
      // stepping: Next moves the row-movement panel to the next stage, Previous and Restart come back
      const kind = () => page.getByTestId("rowflow").first().getAttribute("data-kind");
      const first = await kind();
      await page.getByRole("button", { name: "Next step" }).click();
      await expect(page.getByTestId("rowflow").first()).toBeVisible();
      if (q.name === "q01-product-revenue") await shot(page, "after-q01-product-revenue-step2");
      await page.getByRole("button", { name: "Previous step" }).click();
      expect(await kind()).toBe(first);
      await page.getByRole("button", { name: "Next step" }).click();
      await page.getByRole("button", { name: "Restart" }).click();
      expect(await kind()).toBe(first);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test("the other tabs of the original work (flow diagram, relationships, structure, execution plan) and the play button runs through the stages", async ({ page }) => {
    await runAndVisualize(page, QUERIES[3].sql);
    for (const t of ["Flow diagram", "Relationships", "Structure", "Execution plan"]) {
      await page.getByRole("tab", { name: t }).click();
      await expect(page.getByRole("tab", { name: t })).toHaveAttribute("aria-selected", "true");
    }
    await page.getByRole("tab", { name: "Logical steps" }).click();
    await page.getByRole("button", { name: "Restart" }).click();
    const bar = page.getByRole("group", { name: "Playback controls" });
    await bar.getByRole("button", { name: "Play", exact: true }).click();
    await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
    await bar.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByTestId("cinema")).toHaveCount(0);
  });

  test("an invalid query: Run reports the error and nothing is visualized as a result", async ({ page }) => {
    await page.goto("/questions/q01-product-revenue");
    if (small(page)) await page.locator("button:visible", { hasText: "Visualize ↗" }).first().click();
    await page.locator(".monaco-editor").first().waitFor({ timeout: 90_000 });
    await page.waitForFunction(() => Boolean((window as unknown as { monaco?: { editor: { getModels: () => unknown[] } } }).monaco?.editor.getModels().length), null, { timeout: 60_000 });
    await page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue("SELECT x FROM no_such_table"));
    await page.getByRole("button", { name: /Run All/ }).click();
    await expect(page.getByText(/no_such_table|does not exist/i).first()).toBeVisible({ timeout: 60_000 });
    await page.locator("button:visible", { hasText: "Visualize query" }).first().click();
    await expect(page.getByTestId("cinema")).toHaveCount(0);
  });
});

test.describe("the rest of the site keeps what it had", () => {
  test("/query-visualizer still works and is not the SQL Practice upgrade (no Cinema: main removed it)", async ({ page }) => {
    await page.goto("/query-visualizer");
    await expect(page.getByRole("button", { name: "Visualize", exact: true })).toBeVisible();
    for (const id of ["cinema", "cinema-empty", "classic-viz"]) await expect(page.getByTestId(id)).toHaveCount(0);
  });
});
