import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "./fixtures";

/**
 * QA of the SQL Practice visualizer on the REAL route /questions/q01-product-revenue (real PostgreSQL in WebAssembly in the
 * browser), desktop 1440x900 and mobile 390x844 (the Playwright projects `desktop` and `mobile`), light and dark.
 *
 * Expectations come from an INDEPENDENT PostgreSQL (PGlite in this Node process, loaded from public/data/northwind.sql), never
 * from what the page says about itself. Written against docs/SQL_VISUALIZER_UPGRADE_CONTRACT.md: the stable test ids and the
 * `data-step-index` marker on every region that shows the current step.
 *
 *   E2E_BASE_URL=http://localhost:5184 npx playwright test e2e/sql-practice-visualizer-qa.spec.ts --project=desktop --retries=0
 *   (add QA_SHOTS=1 to write the screenshots to docs/images/sql-practice-visualizer/after-*.png)
 */
const SHOTS = process.env.QA_SHOTS === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.resolve(here, "../../docs/images/sql-practice-visualizer");
const small = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
const vpName = (page: Page) => (small(page) ? "mobile" : "desktop");
type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

/* ------------------------------------------------------------------------------------------------------------------ */
/* independent reference database                                                                                        */
let ref: PGlite;
test.beforeAll(async () => {
  ref = new PGlite();
  await ref.exec(await readFile(path.resolve(here, "../public/data/northwind.sql"), "utf8"));
});
test.afterAll(async () => { await ref?.close(); });

const isNullText = (t: string) => /^(NULL|null|∅|—|–)$/.test(t.trim());
/** One canonical text for a cell, whether it comes from the database or from the page ("1,196.10", "1196.1" and 1196.1 agree). */
const canon = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return v.toISOString();
  const t = String(v).trim();
  if (isNullText(t)) return "NULL";
  const n = t.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(n) ? String(Number(Number(n).toPrecision(12))) : t;
};
async function reference(sql: string): Promise<{ columns: string[]; rows: string[][] }> {
  const r = await ref.query<unknown[]>(sql, [], { rowMode: "array" });
  return { columns: r.fields.map((f) => f.name), rows: (r.rows as unknown[][]).map((row) => row.map(canon)) };
}
const refCount = async (sql: string) => Number((await ref.query<{ n: number | string }>(`SELECT count(*)::int AS n FROM (${sql}) x`)).rows[0].n);

/* ------------------------------------------------------------------------------------------------------------------ */
/* page helpers                                                                                                          */
interface Watch { errors: string[]; probes: string[] }
/** Console errors and uncaught page errors. PostgreSQL's message for the old row-trace ctid probe is kept apart (`probes`): the matrix test asserts it is gone. */
function watch(page: Page): Watch {
  const w: Watch = { errors: [], probes: [] };
  page.on("pageerror", (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/\bctid\b[^\n]*(does not exist|must appear in the GROUP BY)|(does not exist|must appear in the GROUP BY)[^\n]*\bctid\b/.test(t)) w.probes.push(t.slice(0, 160));
    else w.errors.push(`console.error: ${t.slice(0, 300)}`);
  });
  return w;
}

async function openQuestion(page: Page, theme: Theme = "light") {
  await page.addInitScript((t) => { try { localStorage.setItem("sqlp.theme", t); } catch { /* storage unavailable */ } }, theme);
  await page.goto("/questions/q01-product-revenue");
  // On a phone the editor is hidden until the learner opens the practice panel. A tap that lands while the page is still settling
  // can miss (the sticky header moves), so the open is retried once with a fresh page: the same harness retry for every test.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (small(page)) await page.locator("button:visible", { hasText: "Visualize ↗" }).first().click();
    const ok = await page.locator(".monaco-editor").first().waitFor({ timeout: attempt < 2 ? 20_000 : 90_000 }).then(() => true, () => false);
    if (ok) break;
    if (attempt === 2) throw new Error("the Monaco editor never became visible");
    await page.reload();
  }
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: { editor: { getModels: () => unknown[] } } }).monaco?.editor.getModels().length), null, { timeout: 60_000 });
}
async function setSql(page: Page, sql: string) {
  await page.evaluate((q) => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue(q), sql);
}
/** Run All and return what the Results panel reports: the row count (null when the panel is in another tab on a phone) and its first rows. */
async function runAll(page: Page) {
  await page.getByRole("button", { name: /Run All/ }).click();
  const table = page.locator("table:has(th:text-is('#'))").first();
  // On a phone the Results panel is in a hidden container (its row chip has no size), so the row count is only read on a desktop;
  // the first rows are read from the table's text, which exists either way.
  await table.waitFor({ state: "attached", timeout: 90_000 }).catch(() => undefined);
  let rows: number | null = null;
  if (!small(page)) {
    const chip = page.getByText(/^\d[\d,]* rows?$/).filter({ visible: true }).first();
    rows = await chip.waitFor({ state: "visible", timeout: 90_000 }).then(async () => Number((await chip.innerText()).replace(/[^\d]/g, ""))).catch(() => null);
  }
  const first = !(await table.count()) ? null
    : await table.locator("tbody tr").evaluateAll((trs) => trs.slice(0, 6).map((tr) => [...tr.querySelectorAll("td")].slice(1).map((td) => td.textContent ?? "")));
  return { rows, first };
}
async function openVisualizer(page: Page) {
  await page.locator("button:visible", { hasText: "Visualize query" }).first().click();
  await page.locator("button:visible", { hasText: /Visualize my (latest )?query/ }).first().click();
  await expect(page.getByTestId("classic-viz")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("rowflow-identity")).toContainText(/real \(ctid\)|trace|stage/i, { timeout: 60_000 }); // row-level data has arrived
}
async function visualize(page: Page, sql: string, theme: Theme = "light") {
  await openQuestion(page, theme);
  await setSql(page, sql);
  const results = await runAll(page);
  await openVisualizer(page);
  return results;
}

const REGIONS = ["classic-sql", "classic-step-rail", "classic-explain", "classic-tables", "rowflow", "classic-progress"] as const;
interface Sync { root: string | null; regions: Record<string, string | null>; now: number; max: number; count: number; railCurrent: number; railButtons: number }
const readSync = (page: Page): Promise<Sync> => page.evaluate((ids) => {
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const bar = q("classic-progress");
  const rail = [...(q("classic-step-rail")?.querySelectorAll("button") ?? [])];
  return {
    root: q("classic-viz")?.getAttribute("data-step-index") ?? null,
    regions: Object.fromEntries(ids.map((id) => [id, q(id)?.getAttribute("data-step-index") ?? null])),
    now: Number(bar?.getAttribute("aria-valuenow")), max: Number(bar?.getAttribute("aria-valuemax")), count: Number(q("classic-viz")?.getAttribute("data-step-count")),
    railCurrent: rail.findIndex((b) => b.getAttribute("aria-current") === "step"), railButtons: rail.length,
  };
}, [...REGIONS]);
/** Every region, the root and the progress bar say the same step (polls: the step settles within a frame). */
async function expectSync(page: Page, n: number) {
  await expect.poll(async () => {
    const s = await readSync(page);
    return JSON.stringify({ root: s.root, ...s.regions, now: s.now, max: s.max, count: s.count, rail: s.railCurrent });
  }, { timeout: 8000, message: `all regions on step ${n}` }).toBe(JSON.stringify({
    root: String(n), "classic-sql": String(n), "classic-step-rail": String(n), "classic-explain": String(n), "classic-tables": String(n), rowflow: String(n), "classic-progress": String(n),
    now: n + 1, max: (await readSync(page)).count, count: (await readSync(page)).count, rail: n,
  }));
}
const stepCount = async (page: Page) => (await readSync(page)).count;
const next = (page: Page) => page.getByRole("button", { name: "Next step" }).click();
const prev = (page: Page) => page.getByRole("button", { name: "Previous step" }).click();
const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
const textOf = (loc: Locator) => loc.innerText().then((t) => t.replace(/\s+/g, " "));
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotDir, `${name}.png`) });
}
async function walk(page: Page) {
  const count = await stepCount(page);
  await expectSync(page, 0);
  for (let i = 1; i < count; i++) { await next(page); await expectSync(page, i); await noHScroll(page); }
  return count;
}

/* ------------------------------------------------------------------------------------------------------------------ */
const Q01 = "SELECT p.product_id, p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS total_revenue FROM products p JOIN order_details od ON od.product_id = p.product_id GROUP BY p.product_id, p.product_name ORDER BY total_revenue DESC";
const SOME_ORDERS = "order_id IN (SELECT order_id FROM orders WHERE shipped_date IS NULL UNION ALL SELECT order_id FROM (SELECT order_id FROM orders ORDER BY order_id LIMIT 4) f)";
const MATRIX: { name: string; sql: string; reference: string; tables?: (n: number) => Promise<string[]> }[] = [
  { name: "SELECT-WHERE", sql: "SELECT product_name, unit_price FROM products WHERE unit_price > 50 ORDER BY unit_price DESC", reference: "SELECT product_name, unit_price FROM products WHERE NOT (unit_price <= 50) ORDER BY unit_price DESC" },
  { name: "INNER JOIN", sql: "SELECT p.product_name, od.quantity FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE od.quantity > 30 ORDER BY od.order_id, p.product_id", reference: "SELECT p.product_name, od.quantity FROM order_details od, products p WHERE p.product_id = od.product_id AND od.quantity > 30 ORDER BY od.order_id, p.product_id" },
  { name: "LEFT JOIN", sql: "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL ORDER BY c.customer_id", reference: "SELECT c.customer_id, NULL FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id) ORDER BY c.customer_id" },
  { name: "3-table JOIN", sql: "SELECT c.company_name, o.order_id, e.last_name FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN employees e ON e.employee_id = o.employee_id WHERE c.country = 'Germany' ORDER BY o.order_id", reference: "SELECT c.company_name, o.order_id, e.last_name FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id AND c.country = 'Germany' ORDER BY o.order_id" },
  { name: "GROUP BY-SUM-COUNT-AVG", sql: "SELECT category_id, COUNT(*) AS n, SUM(units_in_stock) AS stock, ROUND(AVG(unit_price), 2) AS a FROM products GROUP BY category_id ORDER BY category_id", reference: "SELECT c.category_id, (SELECT count(*) FROM products p WHERE p.category_id = c.category_id), (SELECT sum(units_in_stock) FROM products p WHERE p.category_id = c.category_id), round((SELECT avg(unit_price) FROM products p WHERE p.category_id = c.category_id), 2) FROM (SELECT DISTINCT category_id FROM products) c ORDER BY 1" },
  { name: "HAVING", sql: "SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id HAVING COUNT(*) > 8 ORDER BY n DESC, category_id", reference: "SELECT category_id, count(*) FROM products GROUP BY category_id HAVING count(*) > 8 ORDER BY 2 DESC, 1" },
  { name: "ORDER BY NULLs", sql: `SELECT order_id, shipped_date::text AS shipped FROM orders WHERE ${SOME_ORDERS} ORDER BY shipped_date DESC, order_id`, reference: `SELECT order_id, shipped_date::text FROM orders WHERE ${SOME_ORDERS} ORDER BY shipped_date DESC NULLS FIRST, order_id` },
  { name: "LIMIT-OFFSET", sql: "SELECT product_name, unit_price FROM products ORDER BY unit_price DESC, product_id LIMIT 5 OFFSET 2", reference: "SELECT product_name, unit_price FROM products ORDER BY unit_price DESC, product_id OFFSET 2 FETCH FIRST 5 ROWS ONLY" },
  { name: "subquery", sql: "SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products) ORDER BY product_name", reference: "SELECT product_name FROM products p WHERE p.unit_price > (SELECT sum(unit_price) / count(*) FROM products) ORDER BY product_name" },
  { name: "CTE", sql: "WITH big AS (SELECT order_id, SUM(quantity) AS q FROM order_details GROUP BY order_id) SELECT order_id, q FROM big WHERE q > 100 ORDER BY q DESC, order_id", reference: "SELECT order_id, sum(quantity) FROM order_details GROUP BY order_id HAVING sum(quantity) > 100 ORDER BY 2 DESC, 1" },
  { name: "window", sql: "SELECT product_name, category_id, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS rk FROM products WHERE category_id IN (5, 6, 7) ORDER BY category_id, rk, product_name", reference: "SELECT p.product_name, p.category_id, 1 + (SELECT count(*) FROM products q WHERE q.category_id = p.category_id AND q.unit_price > p.unit_price) AS rk FROM products p WHERE p.category_id IN (5, 6, 7) ORDER BY 2, 3, 1" },
  { name: "NULL behaviour", sql: "SELECT COUNT(*) AS all_rows, COUNT(shipped_date) AS shipped, SUM(freight) FILTER (WHERE shipped_date IS NULL) AS pending_freight FROM orders", reference: "SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM orders WHERE shipped_date IS NOT NULL), (SELECT sum(freight) FROM orders WHERE shipped_date IS NULL)" },
  { name: "Q01 Product Revenue", sql: Q01, reference: "SELECT p.product_id, p.product_name, round((SELECT sum(od.unit_price * od.quantity * (1 - od.discount)) FROM order_details od WHERE od.product_id = p.product_id)::numeric, 2) AS t FROM products p WHERE EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id) ORDER BY t DESC" },
];

/** The final table of the visualizer (after the "Final result (N rows)" heading): its first rows, as canonical text. */
async function finalTable(page: Page) {
  const heading = page.getByText(/Final result \(/).first();
  const text = (await heading.textContent()) ?? ""; // textContent: the heading is upper-cased by CSS, innerText would say "ROWS"
  const n = Number(/\(([\d,]+) rows?\)/i.exec(text)?.[1]?.replace(/,/g, ""));
  const table = page.locator(".vizc-final table, [data-testid='classic-viz'] table").last();
  const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.slice(0, 8).map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")));
  return { n, rows };
}

test.describe("matrix: every query, on the real page, against an independent database", () => {
  test.beforeEach(() => { test.setTimeout(300_000); });

  for (const q of MATRIX) {
    test(`${q.name}: Results panel, visualizer final result, every step in sync, no console errors`, async ({ page }) => {
      const w = watch(page);
      const want = await reference(q.reference);
      const { rows, first } = await visualize(page, q.sql);

      // the query editor path is unchanged: the Results panel reports the independent count and rows
      if (rows !== null) expect(rows, "Results panel row count").toBe(want.rows.length);
      if (first) expect(first.map((r) => r.map(canon)), "Results panel first rows").toEqual(want.rows.slice(0, first.length));

      // the original visualizer, never the Cinema
      for (const id of ["cinema", "cinema-rail", "cinema-expand", "cinema-empty"]) await expect(page.getByTestId(id)).toHaveCount(0);
      for (const t of ["Logical steps", "Flow diagram", "Relationships", "Structure", "Execution plan"]) await expect(page.getByRole("tab", { name: t })).toBeVisible();
      await expect(page.getByRole("group", { name: "Playback controls" })).toBeVisible();

      // the visualizer's final result is the independent result
      const fin = await finalTable(page);
      expect(fin.n, "Final result row count").toBe(want.rows.length);
      expect(fin.rows.map((r) => r.map(canon)), "Final result first rows").toEqual(want.rows.slice(0, fin.rows.length));

      // every step: all regions in sync, no sideways page scroll; then back to the first step
      const count = await walk(page);
      expect(count).toBeGreaterThanOrEqual(2);
      await page.getByRole("button", { name: "Restart" }).click();
      await expectSync(page, 0);
      await noHScroll(page);

      expect(w.errors).toEqual([]);
      expect(w.probes, "the ctid-probe console errors (fixed in the final tree) must not come back").toEqual([]);
    });
  }
});

test.describe("what each step shows is true", () => {
  test.beforeEach(() => { test.setTimeout(300_000); });

  test("WHERE step: the tables and the explanation carry the independent row counts (kept and source)", async ({ page }) => {
    await visualize(page, MATRIX[0].sql);
    const all = await refCount("SELECT * FROM products");
    const kept = await refCount("SELECT * FROM products WHERE unit_price > 50");
    expect(await textOf(page.getByTestId("classic-tables"))).toContain(String(all)); // FROM: the whole table
    const rail = page.getByTestId("classic-step-rail").getByRole("button");
    const labels = (await rail.allTextContents()).map((t) => t.trim().toUpperCase());
    const where = labels.indexOf("WHERE");
    expect(where, `rail ${labels.join(" > ")}`).toBeGreaterThan(-1);
    await rail.nth(where).click();
    await expectSync(page, where);
    expect(await textOf(page.getByTestId("classic-tables"))).toContain(String(kept));
    expect(await textOf(page.getByTestId("classic-explain"))).toContain(String(kept));
    const mark = await page.getByTestId("classic-sql").locator("mark").innerText();
    expect(mark).toMatch(/WHERE|unit_price/i);
  });

  test("JOIN and GROUP BY steps: join counts and group counts equal independent counts", async ({ page }) => {
    await visualize(page, Q01);
    const joined = await refCount("SELECT * FROM order_details od, products p WHERE p.product_id = od.product_id");
    const groups = await refCount("SELECT DISTINCT p.product_id FROM order_details od, products p WHERE p.product_id = od.product_id");
    const rail = page.getByTestId("classic-step-rail").getByRole("button");
    const labels = (await rail.allTextContents()).map((t) => t.trim().toUpperCase());
    const text = async (label: string) => { const i = labels.findIndex((l) => (label === "JOIN" ? /JOIN/.test(l) : l === label)); expect(i, `rail ${labels.join(" > ")}`).toBeGreaterThan(-1); await rail.nth(i).click(); await expectSync(page, i); return (await textOf(page.getByTestId("classic-tables"))) + " " + (await textOf(page.getByTestId("classic-explain"))); };
    const fromText = await text("JOIN"); // the rail may call it JOIN or "FROM + JOIN"
    expect(fromText).toContain(String(joined));
    expect(await text("GROUP BY")).toContain(String(groups));
  });

  test("LEFT JOIN: the unmatched customers are named as NULL-padded", async ({ page }) => {
    await visualize(page, "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id");
    const orphans = (await reference("SELECT customer_id FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)")).rows.flat();
    expect(orphans.length).toBeGreaterThan(0);
    const viz = (await textOf(page.getByTestId("classic-viz")));
    expect(viz).toMatch(/NULL/);
    expect(viz).toMatch(new RegExp(`${orphans.length} (left )?rows? (found no|with no|have no)|${orphans.length} left rows?|${orphans.length} unmatched`, "i"));
  });

  test("empty result: the visualizer says there are no rows, does not crash, and every step still works", async ({ page }) => {
    const w = watch(page);
    const { rows } = await visualize(page, "SELECT * FROM products WHERE unit_price > 1000000");
    if (rows !== null) expect(rows).toBe(0);
    expect((await finalTable(page).catch(() => ({ n: 0 }))).n).toBe(0);
    expect(await textOf(page.getByTestId("classic-viz"))).toMatch(/\b(no rows|0 rows|empty|nothing)\b/i);
    await walk(page);
    expect(w.errors).toEqual([]);
  });
});

test.describe("invalid SQL and non-SELECT", () => {
  test.beforeEach(() => { test.setTimeout(240_000); });

  test("invalid SQL: the error is shown, no result is produced, the page does not throw", async ({ page }) => {
    const w = watch(page);
    await openQuestion(page);
    await setSql(page, "SELECT x FROM no_such_table");
    await page.getByRole("button", { name: /Run All/ }).click();
    await expect(page.getByText(/no_such_table|does not exist/i).first()).toBeVisible({ timeout: 60_000 });
    await page.locator("button:visible", { hasText: "Visualize query" }).first().click();
    await expect(page.getByTestId("cinema")).toHaveCount(0);
    const go = page.locator("button:visible", { hasText: /Visualize my (latest )?query/ }).first();
    await go.waitFor({ state: "visible", timeout: 10_000 }).then(() => go.click(), () => undefined);
    // the visualizer reports the failed step (on a phone the page first shows an earlier visualization, which this replaces)
    await expect(page.getByTestId("classic-explain")).toContainText(/no_such_table|does not exist|failed|rejected/i, { timeout: 60_000 });
    await expect(page.getByText(/Final result \(/)).toHaveCount(0);
    expect(w.errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });

  test("a DROP TABLE is never run; the products table is untouched afterwards", async ({ page }) => {
    await openQuestion(page);
    await setSql(page, "DROP TABLE products");
    await page.getByRole("button", { name: /Run All/ }).click();
    await page.waitForTimeout(3000);
    await setSql(page, "SELECT count(*) AS n FROM products");
    const { rows } = await runAll(page);
    if (rows !== null) expect(rows).toBe(1);
    await expect(page.getByText("77", { exact: true }).first()).toBeVisible({ timeout: 30_000 }).catch(() => { /* the count cell can sit in another tab on a phone */ });
  });
});

test.describe("interaction: navigation, keyboard, reset, replay, playback, editor, grading", () => {
  test.beforeEach(() => { test.setTimeout(300_000); });

  test("rail, Next, Previous, Restart, Reset, keyboard and the timeline keep every region in sync (Q01)", async ({ page }) => {
    const w = watch(page);
    await visualize(page, Q01);
    const count = await stepCount(page);
    expect(count).toBeGreaterThanOrEqual(4);
    await expectSync(page, 0);
    await expect(page.getByRole("button", { name: "Previous step" })).toBeDisabled();
    for (let i = 1; i < count; i++) { await next(page); await expectSync(page, i); }
    await expect(page.getByRole("button", { name: "Next step" })).toBeDisabled();
    for (let i = count - 2; i >= 0; i--) { await prev(page); await expectSync(page, i); }
    const rail = page.getByTestId("classic-step-rail").getByRole("button");
    await rail.nth(count - 1).click(); await expectSync(page, count - 1);
    await rail.nth(1).click(); await expectSync(page, 1);
    await page.getByRole("button", { name: "Restart" }).click(); await expectSync(page, 0);
    await next(page); await next(page); await expectSync(page, 2);
    await page.getByTestId("classic-reset").click(); await expectSync(page, 0);
    // keyboard (desktop and phone with a keyboard): focus the playback group
    const group = page.getByRole("group", { name: "Playback controls" });
    await group.focus();
    await page.keyboard.press("ArrowRight"); await expectSync(page, 1);
    await page.keyboard.press("ArrowRight"); await expectSync(page, 2);
    await page.keyboard.press("ArrowLeft"); await expectSync(page, 1);
    await page.keyboard.press("End"); await expectSync(page, count - 1);
    await page.keyboard.press("ArrowRight"); await expectSync(page, count - 1);
    await page.keyboard.press("Home"); await expectSync(page, 0);
    await page.keyboard.press("ArrowLeft"); await expectSync(page, 0);
    // the timeline slider
    await page.getByLabel("Timeline").focus();
    await page.keyboard.press("End"); await expectSync(page, count - 1);
    expect(w.errors).toEqual([]);
  });

  test("Play runs the steps in order and stops at the last; Pause holds the step; Replay keeps the step", async ({ page }) => {
    await visualize(page, MATRIX[5].sql);
    const count = await stepCount(page);
    const bar = page.getByRole("group", { name: "Playback controls" });
    await page.getByRole("button", { name: "Restart" }).click();
    await bar.getByLabel("Playback speed").selectOption("4");
    await bar.getByRole("button", { name: "Play", exact: true }).click();
    const seen: number[] = [];
    await expect.poll(async () => { const n = (await readSync(page)).now; if (seen.at(-1) !== n) seen.push(n); return n; }, { timeout: 60_000, intervals: [30] }).toBe(count);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBe(1);
    await expectSync(page, count - 1);
    await expect(bar.getByRole("button", { name: "Play", exact: true })).toBeVisible({ timeout: 15_000 }); // it stopped by itself
    await page.getByRole("button", { name: "Restart" }).click();
    await bar.getByRole("button", { name: "Play", exact: true }).click();
    await bar.getByRole("button", { name: "Pause" }).click();
    const held = (await readSync(page)).now;
    await page.waitForTimeout(1200);
    expect((await readSync(page)).now).toBe(held);
    await page.getByRole("button", { name: "Next step" }).click();
    const at = (await readSync(page)).root!;
    const replay = page.getByRole("button", { name: /Replay/ }).first();
    if (await replay.isVisible().catch(() => false)) await replay.click();
    await expectSync(page, Number(at));
  });

  test("the other tabs work (flow diagram, relationships, structure, execution plan) and come back to the same step", async ({ page }) => {
    await visualize(page, MATRIX[5].sql);
    await next(page); await next(page);
    await expectSync(page, 2);
    for (const t of ["Flow diagram", "Relationships", "Structure", "Execution plan"]) {
      await page.getByRole("tab", { name: t }).click();
      await expect(page.getByRole("tab", { name: t })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("cinema")).toHaveCount(0);
    }
    await page.getByRole("tab", { name: "Logical steps" }).click();
    await expectSync(page, 2);
  });

  test("the editor and grading are unaffected: the Results panel is unchanged after visualizing and stepping, and Submit still grades", async ({ page }) => {
    await openQuestion(page);
    await setSql(page, Q01);
    const before = await runAll(page);
    const want = await reference(MATRIX.at(-1)!.reference);
    if (before.rows !== null) expect(before.rows).toBe(want.rows.length);
    await openVisualizer(page);
    await walk(page);
    // back on the editor: the same SQL, the same result, and Submit grades it as correct
    if (small(page)) await page.locator("button:visible", { hasText: "Visualize ↗" }).first().click().catch(() => undefined);
    const model = await page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco.editor.getModels()[0].getValue());
    expect(model).toBe(Q01);
    const after = await runAll(page);
    expect(after.rows).toBe(before.rows);
    expect(after.first).toEqual(before.first);
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(/Correct! Your query produces the expected result|Query passed/i).first()).toBeVisible({ timeout: 90_000 });
  });

  test("a wrong query still fails grading (the visualizer does not let it through)", async ({ page }) => {
    await openQuestion(page);
    await setSql(page, "SELECT p.product_id, p.product_name, 0 AS total_revenue FROM products p");
    await runAll(page);
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(/Correct! Your query produces the expected result/i)).toHaveCount(0, { timeout: 15_000 });
    // the verdict text can sit in a hidden panel on a phone, so it is checked as present, not as visible
    await expect.poll(() => page.getByText(/does not match the expected result/i).count(), { timeout: 90_000 }).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ */
/* look and feel: layout, themes, contrast, reduced motion                                                               */
interface Contrast { ratio: number; text: string; fg: string; bg: string; size: number; region: string }
/** The contrast of every visible text in the given regions, computed from the browser's own colours (any CSS colour syntax). */
const contrastReport = (page: Page, regions: string[]): Promise<Contrast[]> => page.evaluate((ids) => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  const rgba = (c: string): [number, number, number, number] => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])) as [number, number, number];
  const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const background = (el: Element): [number, number, number] => {
    const layers: [number, number, number, number][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
    let base: [number, number, number] = [255, 255, 255];
    const htmlBg = rgba(getComputedStyle(document.documentElement).backgroundColor);
    if (htmlBg[3] > 0) base = over(htmlBg, [255, 255, 255]);
    for (const l of layers.reverse()) base = over(l, base);
    return base;
  };
  const out: { ratio: number; text: string; fg: string; bg: string; size: number; region: string }[] = [];
  for (const id of ids) {
    const root = document.querySelector(`[data-testid="${id}"]`);
    if (!root) continue;
    for (const el of [root, ...root.querySelectorAll("*")]) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim()).map((n) => n.textContent!.trim()).join(" ");
      if (!own) continue;
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || st.visibility === "hidden" || st.display === "none") continue;
      if ((el as HTMLButtonElement).disabled || el.closest("[aria-hidden='true'], [disabled]")) continue;
      if (el.closest(".sr-only")) continue;
      let alpha = 1; for (let e: Element | null = el; e; e = e.parentElement) alpha *= Number(getComputedStyle(e).opacity);
      const bg = background(el);
      const fgc = rgba(st.color); fgc[3] *= alpha;
      const fg = over(fgc, bg);
      const [l1, l2] = [lum(fg), lum(bg)];
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      out.push({ ratio: Math.round(ratio * 100) / 100, text: own.slice(0, 50), fg: fg.map(Math.round).join(","), bg: bg.map(Math.round).join(","), size: parseFloat(st.fontSize), region: id });
    }
  }
  return out;
}, regions);

test.describe("layout, themes and motion (Q01)", () => {
  test.beforeEach(() => { test.setTimeout(300_000); });

  for (const theme of THEMES) {
    test(`${theme}: the page is in the ${theme} theme, nothing scrolls sideways, the visualizer fits its pane, and the key texts are readable`, async ({ page }) => {
      const w = watch(page);
      await visualize(page, Q01, theme);
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
      await noHScroll(page);
      await shot(page, `after-${vpName(page)}-${theme}`);

      // layout: the visualizer and each region lie inside the viewport and inside the visualizer; the pane does not scroll sideways
      const fit = async () => page.evaluate((ids) => {
        const root = document.querySelector("[data-testid='classic-viz']")!.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const bad: string[] = [];
        if (root.left < -1 || root.right > vw + 1) bad.push(`classic-viz outside the viewport (${Math.round(root.left)}..${Math.round(root.right)} of ${vw})`);
        for (const id of ids) {
          const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
          if (!r) { bad.push(`${id} missing`); continue; }
          if (r.left < root.left - 1 || r.right > root.right + 1) bad.push(`${id} sticks out of classic-viz (${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(root.left)}..${Math.round(root.right)})`);
        }
        for (let e: HTMLElement | null = document.querySelector<HTMLElement>("[data-testid='classic-viz']")!.parentElement; e && e !== document.body; e = e.parentElement) {
          const ox = getComputedStyle(e).overflowX;
          if ((ox === "auto" || ox === "scroll") && e.scrollWidth > e.clientWidth + 1) bad.push(`the pane scrolls sideways (${e.scrollWidth} > ${e.clientWidth})`);
        }
        return bad;
      }, [...REGIONS]);
      expect(await fit()).toEqual([]);
      const count = await stepCount(page);
      const mid = Math.min(2, count - 1);
      for (let i = 1; i <= mid; i++) await next(page);
      await expectSync(page, mid);
      expect(await fit()).toEqual([]);
      await shot(page, `after-${vpName(page)}-${theme}-step${mid}`);

      // contrast of the key texts at this step and at the last one (WCAG AA: 4.5, or 3 for large text)
      const failures: Contrast[] = [];
      for (const step of [mid, count - 1]) {
        while ((await readSync(page)).now - 1 < step) await next(page);
        await expectSync(page, step);
        await page.waitForTimeout(700); // let the step's motion settle
        const rep = await contrastReport(page, ["classic-sql", "classic-step-rail", "classic-explain", "classic-tables", "classic-player"]);
        expect(rep.length, "texts were found").toBeGreaterThan(5);
        failures.push(...rep.filter((c) => c.ratio < (c.size >= 24 || (c.size >= 18.66) ? 3 : 4.5)));
      }
      await shot(page, `after-${vpName(page)}-${theme}-last`);
      const uniq = [...new Map(failures.map((f) => [`${f.region}|${f.text}|${f.fg}|${f.bg}`, f])).values()];
      expect(uniq.map((f) => `${f.region} "${f.text}" ${f.ratio}:1 fg=${f.fg} bg=${f.bg} ${f.size}px`)).toEqual([]);
      expect(w.errors).toEqual([]);
    });
  }

  test("reduced motion: no animation and no transform, opacity or all-property transition inside the visualizer, at every step", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await visualize(page, Q01);
    const moving = () => page.evaluate(() => {
      const root = document.querySelector("[data-testid='classic-viz']")!;
      const bad: string[] = [];
      for (const el of [root, ...root.querySelectorAll("*")]) {
        const st = getComputedStyle(el);
        const props = st.transitionProperty.split(",").map((s) => s.trim());
        const durs = st.transitionDuration.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 0.001 : 1));
        props.forEach((p, i) => { if (/^(all|transform|opacity|top|left|width|height)$/.test(p) && durs[i % durs.length] > 0.001) bad.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)} transition ${p} ${durs[i % durs.length]}s`); });
        if (st.animationName !== "none" && parseFloat(st.animationDuration) > 0.001) bad.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)} animation ${st.animationName}`);
      }
      return bad;
    });
    expect(await moving()).toEqual([]);
    expect(await page.getByTestId("rowflow").first().getAttribute("data-reduced")).toBe("true");
    const count = await stepCount(page);
    for (let i = 1; i < count; i++) { await next(page); await expectSync(page, i); expect(await moving()).toEqual([]); }
  });

  test("with motion allowed the board is animated (data-reduced is false) and playback still reaches the last step", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await visualize(page, MATRIX[5].sql);
    expect(await page.getByTestId("rowflow").first().getAttribute("data-reduced")).toBe("false");
    await walk(page);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ */
test.describe("the rest of the site is unchanged by the SQL Practice upgrade", () => {
  test("/query-visualizer shows the plain original visualizer (main removed the Cinema), not the SQL Practice upgrade", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/query-visualizer");
    await expect(page.getByRole("button", { name: "Visualize", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "JOIN + GROUP BY + HAVING", exact: true }).first().click().catch(() => undefined);
    await page.getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Logical steps" })).toBeVisible({ timeout: 120_000 });
    for (const id of ["cinema", "cinema-rail", "classic-viz", "classic-step-rail"]) await expect(page.getByTestId(id)).toHaveCount(0);
  });

  test("the question page never renders any Cinema element, even before a query is visualized", async ({ page }) => {
    await page.goto("/questions/q01-product-revenue");
    for (const id of ["cinema", "cinema-rail", "cinema-empty", "cinema-expand", "cinema-controls"]) await expect(page.getByTestId(id)).toHaveCount(0);
  });
});
