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

test("mistake notebook: a failed submit appears, solving it later marks it fixed", async ({ page, request, isMobile }) => {
  const ref = (await (await request.get("/data/q/q01-product-revenue.json")).json()).referenceQuery as string;
  await page.goto("/questions/q01-product-revenue");
  if (isMobile) await page.getByRole("link", { name: /Jump to the editor/ }).click();
  await editor(page, "SELECT 1 AS x;");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("sqlp.public.progress") ?? "{}").mistakes?.["sql:1"]?.count ?? 0), { timeout: 30_000 }).toBe(1);
  await page.goto("/mistakes");
  await expect(page.getByRole("heading", { name: "Mistake notebook" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Q1 Product/ })).toBeVisible();
  const section = page.getByRole("region", { name: /SQL · Aggregations/ });
  await expect(section.getByText("Still open")).toBeVisible();
  await page.getByRole("link", { name: /Retry/ }).first().click();
  if (isMobile) await page.getByRole("link", { name: /Jump to the editor/ }).click();
  await editor(page, ref);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText(/Correct!/)).toBeVisible({ timeout: 30_000 });
  await page.goto("/mistakes");
  await expect(page.getByRole("region", { name: /SQL · Aggregations/ }).getByText("Solved since")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("SQL review: opt-in after a correct submit, labelled findings, no speed claims", async ({ page, request, isMobile }) => {
  const ref = (await (await request.get("/data/q/q01-product-revenue.json")).json()).referenceQuery as string;
  await page.goto("/questions/q01-product-revenue");
  if (isMobile) await page.getByRole("link", { name: /Jump to the editor/ }).click();
  await editor(page, ref);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText(/Correct!/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Solution review" })).toHaveCount(0); // nothing until asked
  await page.getByRole("button", { name: /Review my solution/ }).click();
  const panel = page.getByRole("region", { name: "Solution review" });
  await expect(panel.getByRole("heading", { name: "Solution review" })).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText("Correct result")).toBeVisible();
  await expect(panel.getByText("Measured time")).toBeVisible();
  expect(await panel.innerText()).not.toMatch(/\b(is|are) (much )?(faster|slower)\b/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("mock interview: no solution in the page while running; finished report has topics, notes and revision", async ({ page, request }) => {
  await page.goto("/mock-interview");
  await page.getByRole("button", { name: "Start interview" }).click();
  await expect(page.getByRole("timer").first()).toBeVisible({ timeout: 30_000 });
  const slugs = await page.evaluate(() => (JSON.parse(localStorage.getItem("sqlp.public.mock") ?? "{}").slugs ?? []) as string[]);
  expect(slugs).toHaveLength(5);
  await page.waitForTimeout(2500);
  const html = await page.content();
  for (const slug of slugs.slice(0, 2)) {
    const ref = ((await (await request.get(`/data/q/${slug}.json`)).json()).referenceQuery as string).replace(/\s+/g, " ").trim();
    expect(html.replace(/\s+/g, " ")).not.toContain(ref.slice(0, 60)); // not even hidden in the DOM
  }
  // Finish it with nothing solved and read the report.
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("sqlp.public.mock")!); s.finishedAt = Date.now(); localStorage.setItem("sqlp.public.mock", JSON.stringify(s)); });
  await page.reload();
  await expect(page.getByRole("heading", { name: "By topic" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What to revise" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("python assessment: an endless loop shows a resource-limit message, then the next check works", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/practice/python/assessment");
  await page.getByRole("button", { name: "Start assessment" }).click();
  await expect(page.getByRole("timer").first()).toBeVisible();
  await editor(page, "x = 1\n");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("status").first()).toBeVisible({ timeout: 90_000 }); // Pyodide is loaded now (the first run gets a longer limit)
  await editor(page, "while True:\n    pass\n"); // runs at import, so the tests hit the time limit
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText(/Resource limit:/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/second limit and was stopped/)).toBeVisible();
  await editor(page, "y = 2\n");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  const checks = () => page.evaluate(() => Object.values((JSON.parse(localStorage.getItem("sqlp.pyassess.active") ?? "{}").checks ?? {}) as Record<string, number>).reduce((n, c) => n + c, 0));
  await expect.poll(checks, { timeout: 60_000 }).toBe(3); // the runtime recovered from the stopped run and graded again
  await expect(page.getByText(/Resource limit:/)).toHaveCount(0); // the new result replaced the limit message
});

test("planner: this week, focus and reminders (off by default, remembered when turned on)", async ({ page }) => {
  await page.goto("/career/planner");
  await expect(page.getByRole("heading", { name: "This week", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Practice minutes per day" })).toBeVisible();
  const box = page.getByLabel(/Remind me to practise/);
  await expect(box).not.toBeChecked();
  await box.check();
  await page.reload();
  await expect(page.getByLabel(/Remind me to practise/)).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("portfolio: resume bullets show an honest empty state until a check has passed", async ({ page }) => {
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Resume bullets" })).toBeVisible();
  await expect(page.getByText("No project evidence yet")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("ETL builder: run the example, read the log, break the wiring, save and reopen", async ({ page }) => {
  await page.goto("/etl-builder");
  await expect(page.getByRole("heading", { name: "ETL pipeline builder" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Pipeline canvas/ })).toBeVisible();
  await page.getByRole("button", { name: "Run pipeline" }).click();
  await expect(page.getByText("Succeeded")).toBeVisible();
  await expect(page.getByText(/Removed 1 duplicate row/)).toBeVisible();
  await page.getByText("orders_clean", { exact: true }).first().click();
  await expect(page.getByRole("table", { name: "Output rows" })).toContainText("1005");
  // Remove a middle step: the wiring problem is shown before anything runs.
  await page.getByText("One row per order", { exact: true }).first().click();
  await page.getByRole("button", { name: /Remove this step/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /needs 1 input but has 0/ })).toBeVisible();
  await page.getByLabel("Pipeline name").fill("E2E pipeline");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();
  await page.reload();
  await page.getByLabel("Open a saved pipeline").selectOption({ label: "E2E pipeline" });
  await expect(page.getByRole("alert").filter({ hasText: /needs 1 input but has 0/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("DAG simulator: run, see retries and an upstream failure, retry, break a task, save", async ({ page }) => {
  await page.goto("/dag-simulator");
  await expect(page.getByRole("heading", { name: "Pipeline orchestration simulator" })).toBeVisible();
  await page.getByRole("button", { name: "Run the schedule" }).click();
  const log = page.getByRole("region", { name: "Run log" });
  await expect(log).toContainText("UP_FOR_RETRY (retry_delay=5m)"); // extract flaked then recovered
  await expect(log).toContainText("marking it FAILED"); // validate fails on the first run
  await expect(log).toContainText("upstream_failed and does not run"); // load never started
  await expect(page.getByRole("table", { name: "DAG runs" })).toContainText("Failed");
  await page.getByRole("button", { name: "Retry failed tasks" }).click();
  await expect(log).toContainText("cleared validate, load"); // bad data: the retry runs but fails again
  // Break the DAG: a task that depends on itself through a cycle is explained.
  await page.getByRole("button", { name: "extract", exact: true }).first().click();
  await page.getByRole("group", { name: "Runs after" }).getByLabel("load").check();
  await expect(page.getByRole("alert").filter({ hasText: /circle/ })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("database design playground: relationship exercise, real PostgreSQL, normalization and index demo", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/schema-designer");
  await expect(page.getByRole("heading", { name: "Database design playground" })).toBeVisible();
  // Start from the one-to-many exercise: its starter has no foreign key, so the check explains what to add.
  await page.getByLabel("Start from").selectOption({ label: "Exercise: A customer has many orders" });
  await page.getByRole("button", { name: "Check my design" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Add a foreign key from orders to customers/ })).toBeVisible();
  // Add the foreign key through the UI and check again.
  const ordersTable = page.getByRole("group", { name: "Table orders" });
  await ordersTable.getByRole("button", { name: "Add column" }).click();
  await ordersTable.getByLabel("Column name").last().fill("customer_id");
  await ordersTable.getByLabel("References").last().selectOption("customers.customer_id");
  await page.getByRole("button", { name: "Check my design" }).click();
  await expect(page.getByText("That works.")).toBeVisible();
  // Create it in PostgreSQL; the orphan-row demo shows referential integrity.
  await page.getByRole("button", { name: "Create in database" }).click();
  await expect(page.getByText(/Created 2 tables: customers, orders/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/foreign key constraint/)).toBeVisible();
  // Normalization exercise.
  await page.getByRole("tab", { name: "Normalization exercises" }).click();
  const card = page.getByRole("region", { name: "Remove a transitive dependency" });
  await card.getByRole("textbox").fill("emp_id, emp_name, dept_id\ndept_id, dept_name, dept_location");
  await card.getByRole("button", { name: "Check" }).click();
  await expect(card.getByText("Correct.")).toBeVisible();
  // Index demo.
  await page.getByRole("tab", { name: "Indexes" }).click();
  await page.getByRole("button", { name: "Run the demo" }).click();
  await expect(page.getByText("Before the index")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Seq Scan/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
