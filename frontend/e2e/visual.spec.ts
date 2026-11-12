import { expect, test } from "./fixtures";

// Visual Learning Engine, in a real browser. The Python tests run the tracer inside real Pyodide.
test.beforeEach(async ({ page }) => { page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); }); });

const noHScroll = async (page: import("@playwright/test").Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test("hub lists the tools, navigation reaches it, and there is no horizontal scroll", async ({ page }) => {
  await page.goto("/visual");
  await expect(page.getByRole("heading", { name: "Python Code Time Machine" })).toBeVisible();
  await noHScroll(page);
});

test("Python Time Machine: a real Pyodide trace, stepping, keyboard control, aliasing in the memory model", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/visual/python");
  await page.getByRole("button", { name: "List aliasing" }).click();
  await page.getByRole("button", { name: "Explain visually" }).click();
  const src = page.getByRole("list", { name: "Source code" });
  await expect(src).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole("group", { name: "Playback controls" }).getByRole("status")).toHaveText(/Step 1 of/);
  const bar = page.getByRole("group", { name: "Playback controls" });
  await bar.focus();
  await page.keyboard.press("End");
  await expect(page.getByText("The program finished. These are the final values.")).toBeVisible();
  await expect(page.getByLabel("Program output")).toContainText("[1, 2, 3] [1, 2, 3, 4]");
  await page.getByRole("tab", { name: "Memory model" }).click();
  await expect(page.getByText(/shared by a and b/)).toBeVisible();
  await bar.focus(); // the tab click moved focus; keyboard control belongs to the playback bar
  await page.keyboard.press("Home");
  await expect(page.getByText(/About to run line 1/)).toBeVisible();
  await noHScroll(page);
});

test("Python Time Machine: an exception shows its type and where it happened", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/visual/python");
  await page.getByRole("button", { name: "Exception" }).click();
  await page.getByRole("button", { name: "Explain visually" }).click();
  await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 150_000 });
  await page.getByRole("group", { name: "Playback controls" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByText(/Stopped by IndexError/)).toBeVisible();
});

test("Pandas studio: real DataFrames, changed cells highlighted", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/visual/data");
  await page.getByRole("button", { name: "Missing values and types" }).click();
  await page.getByRole("button", { name: "Explain visually" }).click();
  await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 220_000 });
  await page.getByRole("group", { name: "Playback controls" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Tables and arrays" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("table", { name: /Current value|After|Before/ }).first()).toBeVisible();
});

test("API studio, ETL playback and chart explorer respond", async ({ page }) => {
  await page.goto("/visual/api");
  await page.getByRole("tab", { name: "404 Not Found" }).click();
  await expect(page.getByText(/Fetch order 999/).first()).toBeVisible();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByRole("group", { name: "Playback controls" }).getByRole("status")).toHaveText(/Step 2 of/);
  await noHScroll(page);
  await page.goto("/visual/etl");
  await page.getByLabel("Inject a failure").selectOption("load-always-fails");
  await expect(page.locator("text=/dead-lettered/ >> visible=true").first()).toBeVisible(); // the closed Help also mentions it
  await noHScroll(page);
  await page.goto("/visual/charts");
  await page.getByLabel("Chart type").selectOption("pie");
  await page.getByLabel("Dimension (group by)").selectOption("month");
  await expect(page.getByRole("list", { name: "Chart advice" })).toContainText("slices");
  await noHScroll(page);
});

test("Query Cinema: shared playback bar steps the logical stages; set operators show their branches", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/query-visualizer");
  await page.getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(page.getByRole("group", { name: "Playback controls" })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByRole("group", { name: "Playback controls" }).getByRole("status")).toHaveText(/Step 2 of/);
  await page.getByRole("button", { name: "UNION (set operator)" }).click();
  await page.getByRole("button", { name: "Visualize", exact: true }).click();
  await page.getByRole("tab", { name: /structure/i }).click({ timeout: 90_000 });
  await expect(page.getByText("Set operation branches")).toBeVisible();
});
