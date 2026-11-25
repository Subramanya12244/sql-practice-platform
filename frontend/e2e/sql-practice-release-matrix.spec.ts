import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "./fixtures";

/**
 * RELEASE MATRIX: browser regression of the SQL Practice visualizer on the REAL route /questions/q01-product-revenue (the
 * "Visualize query" tab), across representative query kinds, against an INDEPENDENT PostgreSQL (PGlite in this Node process,
 * loaded from public/data/northwind.sql). Nothing is compared with what the page says about itself.
 *
 * Per query: the Results panel rows, the visualizer's final result (count and values), the rows in/out of every stage, every region
 * (SQL highlight, rail, explanation, tables, board, progress) on the same data-step-index after each step, no sideways page scroll,
 * no console error. Then: stale data (a second query replaces the first), invalid SQL, editing and re-running, playback, rail,
 * keyboard and reset.
 *
 * Projects: desktop, mobile (Chromium); with E2E_ENGINES: firefox-desktop, firefox-mobile, webkit-desktop, webkit-mobile.
 * Themes are set through localStorage `sqlp.theme` (never page.emulateMedia colorScheme: on a phone it hides the editor).
 *
 *   E2E_BASE_URL=http://localhost:5194 npx playwright test e2e/sql-practice-release-matrix.spec.ts --project=desktop --project=mobile --retries=0
 *   E2E_ENGINES=firefox E2E_BASE_URL=http://localhost:5194 npx playwright test e2e/sql-practice-release-matrix.spec.ts --project=firefox-desktop --project=firefox-mobile
 *   E2E_ENGINES=webkit  E2E_BASE_URL=http://localhost:5194 npx playwright test e2e/sql-practice-release-matrix.spec.ts --project=webkit-desktop --project=webkit-mobile
 *   (add R4_SHOTS=1 to write screenshots to docs/images/sql-practice-release/; R4_THEMES=light to run one theme only)
 */
const SHOTS = process.env.R4_SHOTS === "1";
/** R4_CURATED=1 writes the few screenshots kept in docs/images/sql-practice-release/ (see curated()). */
const CURATED = process.env.R4_CURATED === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.resolve(here, "../../docs/images/sql-practice-release");
const small = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
type Theme = "light" | "dark";
const THEMES = (process.env.R4_THEMES ?? "light,dark").split(",").filter((t): t is Theme => t === "light" || t === "dark");

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
interface Watch { errors: string[]; probes: string[]; hydration: string[]; loading: boolean }
const watches = new WeakMap<Page, Watch>();
const HYDRATION = /Minified React error #(418|423|425)|Hydration failed|hydrat/i;
/**
 * Console errors and uncaught page errors. The old row-trace ctid probe message is kept apart (`probes`): it must stay gone.
 * React hydration errors that arrive while the page is still loading (before the editor is up, see openQuestion) are kept apart
 * (`hydration`) and asserted by their own test: on the production build they come with every question page (found by this spec),
 * and counting them in each of the 40 tests would hide everything else. Any such error AFTER the page has loaded stays a failure.
 */
function watch(page: Page): Watch {
  const w: Watch = { errors: [], probes: [], hydration: [], loading: true };
  watches.set(page, w);
  const add = (t: string) => { if (w.loading && HYDRATION.test(t)) w.hydration.push(t.slice(0, 120)); else w.errors.push(t); };
  page.on("pageerror", (e) => add(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/\bctid\b[^\n]*(does not exist|must appear in the GROUP BY)|(does not exist|must appear in the GROUP BY)[^\n]*\bctid\b/.test(t)) w.probes.push(t.slice(0, 160));
    else add(`console.error: ${t.slice(0, 300)}`);
  });
  return w;
}
/**
 * Used ONLY by "invalid SQL after a good run": visualizing a FAILED query runs the shared visualize() engine, whose derived queries
 * each fail with PostgreSQL's own message ("relation ... does not exist") and some report "current transaction is aborted, commands
 * ignored until end of transaction block". Firefox prints those as a bare "Error". Uncaught page errors are never tolerated, nor is any other console error.
 */
const notPgliteFailureEcho = (e: string) => {
  if (e.startsWith("pageerror")) return true;
  const first = e.split("\n")[0];
  return !(/no_such_table|syntax error|relation .* does not exist|column .* does not exist|current transaction is aborted, commands ignored until end of transaction block/i.test(e) || /^console\.error: Error$/.test(first));
};

async function openQuestion(page: Page, theme: Theme = "light") {
  await page.addInitScript((t) => { try { localStorage.setItem("sqlp.theme", t); } catch { /* storage unavailable */ } }, theme);
  await page.goto("/questions/q01-product-revenue");
  // On a phone the editor is hidden until the learner opens the practice panel. A tap can miss while the page settles: retried with a fresh page.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (small(page)) await page.locator("button:visible", { hasText: "Visualize ↗" }).first().click();
    const ok = await page.locator(".monaco-editor").first().waitFor({ timeout: attempt < 2 ? 20_000 : 90_000 }).then(() => true, () => false);
    if (ok) break;
    if (attempt === 2) throw new Error("the Monaco editor never became visible");
    await page.reload();
  }
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: { editor: { getModels: () => unknown[] } } }).monaco?.editor.getModels().length), null, { timeout: 60_000 });
  await page.waitForTimeout(1500); // late hydration errors still belong to the load
  const w = watches.get(page);
  if (w) w.loading = false;
}
/** Set the editor text like a learner's edit. Focusing the editor matters in Firefox: after a bare model.setValue the first Run All click is lost (found by this spec: real typing or a focused editor runs at once). */
async function setSql(page: Page, sql: string) {
  await page.evaluate((q) => {
    const m = (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[]; getEditors: () => { focus: () => void }[] } } }).monaco.editor;
    m.getModels()[0].setValue(q);
    m.getEditors()[0]?.focus();
  }, sql);
}
const editorSql = (page: Page) => page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco.editor.getModels()[0].getValue());
interface Run { rows: number | null; first: string[][] | null }
/** Run All and return what the Results panel reports: row count (null on a phone, where the panel is hidden) and its first rows. */
async function runAll(page: Page, want?: { rows: number; first?: string[] }): Promise<Run> {
  const wantRows = want?.rows;
  await page.getByRole("button", { name: /Run All/ }).click();
  const table = page.locator("table:has(th:text-is('#'))").first();
  await table.waitFor({ state: "attached", timeout: 90_000 }).catch(() => undefined);
  let rows: number | null = null;
  if (!small(page)) {
    const chip = page.getByText(/^\d[\d,]* rows?$/).filter({ visible: true }).first();
    rows = await chip.waitFor({ state: "visible", timeout: 90_000 }).then(async () => Number((await chip.innerText()).replace(/[^\d]/g, ""))).catch(() => null);
    // a second run: the previous run's chip is still on screen until the new result arrives, so wait for the expected count (a real mismatch still shows)
    if (wantRows !== undefined && rows !== wantRows) {
      await expect.poll(async () => page.getByText(/^\d[\d,]* rows?$/).filter({ visible: true }).first().innerText().then((t) => Number(t.replace(/[^\d]/g, "")), () => -1), { timeout: 20_000 }).toBe(wantRows).catch(() => undefined);
      rows = await page.getByText(/^\d[\d,]* rows?$/).filter({ visible: true }).first().innerText().then((t) => Number(t.replace(/[^\d]/g, "")), () => null);
    }
  }
  const readFirst = async () => !(await table.count()) ? null
    : await table.locator("tbody tr").evaluateAll((trs) => trs.slice(0, 6).map((tr) => [...tr.querySelectorAll("td")].slice(1).map((td) => td.textContent ?? "")));
  // the Results table of the previous run stays on screen until the new one replaces it (also on a phone, where there is no row chip)
  if (want?.first) await expect.poll(async () => ((await readFirst())?.[0] ?? []).map(canon).join("|"), { timeout: 20_000 }).toBe(want.first.join("|")).catch(() => undefined);
  const first = await readFirst();
  return { rows, first };
}
/**
 * Open the Visualize query tab. Since the stale-query fix the panel shows the newest SUCCESSFUL run by itself once it was asked
 * for (the tab, or "Visualize ↗ tab" on a phone); the "Visualize my (latest) query" button pins the newest run (even a failed one).
 * `press`: also press that button when the panel did not show a visualization on its own (needed for a failed latest run).
 */
async function openVisualizer(page: Page, opts: { expectViz?: boolean; press?: boolean } = {}) {
  const { expectViz = true, press = false } = opts;
  await page.locator("button:visible", { hasText: "Visualize query" }).first().click();
  if (press) {
    const go = page.locator("button:visible", { hasText: /Visualize my (latest )?query/ }).first();
    await go.waitFor({ state: "visible", timeout: 15_000 }).then(() => go.click(), () => undefined);
  }
  if (!expectViz) return;
  const viz = page.getByTestId("classic-viz");
  // On a phone "Visualize ↗ tab" has already started it; on a desktop the tab alone shows "Press the button to visualize your last successful run".
  const shown = await viz.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false);
  if (!shown) {
    const go = page.locator("button:visible", { hasText: /Visualize my (latest )?query/ }).first();
    await go.waitFor({ state: "visible", timeout: 10_000 }).then(() => go.click(), () => undefined);
  }
  await expect(viz).toBeVisible({ timeout: 120_000 });
  if (!press) await expect(page.getByTestId("rowflow-identity")).toContainText(/real \(ctid\)|trace|stage/i, { timeout: 60_000 }); // row-level data has arrived (a failed query has no board)
}
/** The practice editor is in the same page; scroll it into view before editing the next query. */
async function backToEditor(page: Page) {
  await page.locator(".monaco-editor").first().scrollIntoViewIfNeeded().catch(() => undefined);
  await page.locator(".monaco-editor").first().waitFor({ state: "visible", timeout: 30_000 });
}
/** The panel (without any press) now shows this query, fully built, as the current one. */
async function expectShows(page: Page, q: { sql: string; name: string }, status: string = "current") {
  await expect.poll(() => page.getByTestId("classic-sql").innerText().then(norm).catch(() => ""), { timeout: 45_000, message: `${q.name}: the visualizer shows this query` }).toContain(norm(q.sql).slice(0, 50));
  await expect(page.getByTestId("classic-loading")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId("classic-stale-notice"), `${q.name}: notice`).toHaveAttribute("data-status", status, { timeout: 15_000 });
}
async function visualize(page: Page, sql: string, theme: Theme = "light") {
  await openQuestion(page, theme);
  await setSql(page, sql);
  const results = await runAll(page);
  await openVisualizer(page);
  return results;
}

const REGIONS = ["classic-sql", "classic-step-rail", "classic-explain", "classic-tables", "rowflow", "classic-progress"] as const;
interface Sync { root: string | null; regions: Record<string, string | null>; now: number; max: number; count: number; railCurrent: number }
const readSync = (page: Page): Promise<Sync> => page.evaluate((ids) => {
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const bar = q("classic-progress");
  const rail = [...(q("classic-step-rail")?.querySelectorAll("button") ?? [])];
  return {
    root: q("classic-viz")?.getAttribute("data-step-index") ?? null,
    regions: Object.fromEntries(ids.map((id) => [id, q(id)?.getAttribute("data-step-index") ?? null])),
    now: Number(bar?.getAttribute("aria-valuenow")), max: Number(bar?.getAttribute("aria-valuemax")), count: Number(q("classic-viz")?.getAttribute("data-step-count")),
    railCurrent: rail.findIndex((b) => b.getAttribute("aria-current") === "step"),
  };
}, [...REGIONS]);
/** Every region, the root and the progress bar say the same step (polls: the step settles within a frame). */
async function expectSync(page: Page, n: number) {
  const count = (await readSync(page)).count;
  await expect.poll(async () => {
    const s = await readSync(page);
    return JSON.stringify({ root: s.root, ...s.regions, now: s.now, max: s.max, count: s.count, rail: s.railCurrent });
  }, { timeout: 8000, message: `all regions on step ${n}` }).toBe(JSON.stringify({
    root: String(n), "classic-sql": String(n), "classic-step-rail": String(n), "classic-explain": String(n), "classic-tables": String(n), rowflow: String(n), "classic-progress": String(n),
    now: n + 1, max: count, count, rail: n,
  }));
}
const stepCount = async (page: Page) => (await readSync(page)).count;
const next = (page: Page) => page.getByRole("button", { name: "Next step" }).click();
const prev = (page: Page) => page.getByRole("button", { name: "Previous step" }).click();
const noHScroll = async (page: Page, where = "") => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal page overflow ${where}`).toBeLessThanOrEqual(1);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const textOf = (page: Page, id: string) => page.getByTestId(id).innerText().then(norm);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
async function shot(page: Page, theme: Theme, query: string, when: "first" | "mid" | "last") {
  if (!SHOTS) return;
  await page.waitForTimeout(1200); // let the step's motion settle
  const project = test.info().project.name;
  const file = `${project}-${theme}-${slug(query)}-${when}`;
  await page.screenshot({ path: path.join(shotDir, `${file}.png`), fullPage: true });
  if (!small(page) && when !== "first") {
    // on a desktop the visualizer scrolls inside its own pane: a tall viewport shows the pane's whole content (tables, explanation)
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: 3200 });
    await page.waitForTimeout(500);
    await page.getByTestId("classic-viz").screenshot({ path: path.join(shotDir, `${file}-viz.png`) }).catch(() => undefined);
    await page.setViewportSize(vp);
    await page.waitForTimeout(300);
  }
}

/** One of the curated screenshots: the visualizer element (on a desktop in a tall viewport, so its scrolling pane shows everything). */
async function curated(page: Page, name: string, mode: "viz" | "viewport" | { el: string } = "viz") {
  if (!CURATED) return;
  await page.waitForTimeout(1200);
  const file = path.join(shotDir, `${name}.png`);
  if (mode === "viewport") { await page.screenshot({ path: file }); return; }
  const vp = page.viewportSize()!;
  const desktop = !small(page);
  if (desktop) { await page.setViewportSize({ width: vp.width, height: 3200 }); await page.waitForTimeout(500); }
  await page.getByTestId(mode === "viz" ? "classic-viz" : mode.el).first().screenshot({ path: file }).catch(() => undefined);
  if (desktop) { await page.setViewportSize(vp); await page.waitForTimeout(300); }
}

/** The final table of the visualizer (after the "Final result (N rows)" heading): its row count and first rows. */
async function finalTable(page: Page) {
  const heading = page.getByText(/Final result \(/).first();
  const text = (await heading.textContent()) ?? ""; // textContent: the heading is upper-cased by CSS
  const n = Number(/\(([\d,]+) rows?\)/i.exec(text)?.[1]?.replace(/,/g, ""));
  const table = page.locator(".vizc-final table, [data-testid='classic-viz'] table").last();
  const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.slice(0, 8).map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")));
  return { n, rows };
}
const readCounts = (page: Page) => page.evaluate(() => {
  const spans = [...(document.querySelector("[data-testid='classic-counts']")?.querySelectorAll("span") ?? [])].map((s) => s.textContent ?? "");
  const get = (re: RegExp) => { const m = spans.map((s) => re.exec(s.trim())).find(Boolean); return m ? Number(m[1].replace(/,/g, "")) : null; };
  return { in: get(/^in\s*([\d,]+)/i), out: get(/^out\s*([\d,]+)/i) };
});
const railLabels = async (page: Page) => (await page.getByTestId("classic-step-rail").getByRole("button").allTextContents()).map((t) => norm(t).toUpperCase());

/** The SQL highlight of the current step covers exactly the clause that data-range names. */
async function expectHighlight(page: Page, sql: string, where: string) {
  const range = await page.getByTestId("classic-sql").getAttribute("data-range");
  if (!range) return;
  const [s, e] = range.split(",").map(Number);
  if (!(e > s)) return;
  const marks = await page.getByTestId("classic-sql").locator("mark").allTextContents();
  expect(marks.length, `a highlighted clause (${where})`).toBeGreaterThan(0);
  expect(norm(marks.join(" ")), `the highlight is the clause at data-range ${range} (${where})`).toBe(norm(sql.slice(s, e)));
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* the queries                                                                                                           */
/** What a stage must report, from reference counts: `at` matches the rail label (the first unused step that matches). */
interface Stage { at: RegExp; in?: string; out?: string; label: string }
const st = (label: string, at: RegExp, inn?: string, out?: string): Stage => ({ label, at, in: inn, out });
interface Q { name: string; sql: string; reference: string; stages: Stage[]; shots?: boolean | "dark" }

const Q01 = "SELECT p.product_id, p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS total_revenue FROM products p JOIN order_details od ON od.product_id = p.product_id GROUP BY p.product_id, p.product_name ORDER BY total_revenue DESC";
const SOME_ORDERS = "order_id IN (SELECT order_id FROM orders WHERE shipped_date IS NULL UNION ALL SELECT order_id FROM (SELECT order_id FROM orders ORDER BY order_id LIMIT 4) f)";
const ALL_P = "SELECT 1 FROM products";
const P50 = "SELECT 1 FROM products WHERE NOT (unit_price <= 50)";
const OD_P = "SELECT 1 FROM order_details od, products p WHERE p.product_id = od.product_id";
const GERMAN3 = "SELECT 1 FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id AND c.country = 'Germany'";
const CAT_GROUPS = "SELECT DISTINCT category_id FROM products";
const HAV = "SELECT category_id FROM products GROUP BY category_id HAVING count(*) > 8";
const ORPHANS = "SELECT 1 FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)";
const LEFT_ALL = `SELECT 1 FROM customers c, orders o WHERE o.customer_id = c.customer_id UNION ALL ${ORPHANS}`;
const SOME = `SELECT 1 FROM orders WHERE ${SOME_ORDERS}`;
const BIGQ = "SELECT order_id FROM order_details GROUP BY order_id HAVING sum(quantity) > 100";

const MATRIX: Q[] = [
  { name: "SELECT and WHERE", sql: "SELECT product_name, unit_price FROM products WHERE unit_price > 50 ORDER BY unit_price DESC", shots: true,
    reference: "SELECT product_name, unit_price FROM products WHERE NOT (unit_price <= 50) ORDER BY unit_price DESC",
    stages: [st("FROM", /^FROM$/, undefined, ALL_P), st("WHERE", /^WHERE$/, ALL_P, P50), st("SELECT", /^SELECT$/, P50, P50), st("ORDER BY", /^ORDER BY$/, P50, P50)] },
  { name: "INNER JOIN", sql: "SELECT p.product_name, od.quantity FROM products p JOIN order_details od ON od.product_id = p.product_id WHERE od.quantity > 30 ORDER BY od.order_id, p.product_id",
    reference: "SELECT p.product_name, od.quantity FROM order_details od, products p WHERE p.product_id = od.product_id AND od.quantity > 30 ORDER BY od.order_id, p.product_id",
    stages: [st("JOIN", /JOIN/, ALL_P, OD_P), st("WHERE", /^WHERE$/, OD_P, `${OD_P} AND od.quantity > 30`), st("ORDER BY", /^ORDER BY$/, `${OD_P} AND od.quantity > 30`, `${OD_P} AND od.quantity > 30`)] },
  { name: "LEFT JOIN", shots: true, sql: "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id IS NULL ORDER BY c.customer_id",
    reference: "SELECT c.customer_id, NULL FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id) ORDER BY c.customer_id",
    stages: [st("JOIN", /JOIN/, "SELECT 1 FROM customers", LEFT_ALL), st("WHERE", /^WHERE$/, LEFT_ALL, ORPHANS), st("SELECT", /^SELECT$/, ORPHANS, ORPHANS)] },
  { name: "Three-table JOIN", shots: "dark", sql: "SELECT c.company_name, o.order_id, e.last_name FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN employees e ON e.employee_id = o.employee_id WHERE c.country = 'Germany' ORDER BY o.order_id",
    reference: "SELECT c.company_name, o.order_id, e.last_name FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id AND c.country = 'Germany' ORDER BY o.order_id",
    stages: [st("JOIN", /JOIN/, "SELECT 1 FROM customers", "SELECT 1 FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id"), st("WHERE", /^WHERE$/, "SELECT 1 FROM orders o, customers c, employees e WHERE o.customer_id = c.customer_id AND e.employee_id = o.employee_id", GERMAN3), st("ORDER BY", /^ORDER BY$/, GERMAN3, GERMAN3)] },
  { name: "GROUP BY with SUM", shots: true, sql: "SELECT category_id, SUM(units_in_stock) AS stock FROM products GROUP BY category_id ORDER BY category_id",
    reference: "SELECT c.category_id, (SELECT sum(units_in_stock) FROM products p WHERE p.category_id = c.category_id) FROM (SELECT DISTINCT category_id FROM products) c ORDER BY 1",
    stages: [st("GROUP BY", /^GROUP BY$/, ALL_P, CAT_GROUPS), st("SUM", /^(SUM|AGGREGATES?)$/, undefined, CAT_GROUPS), st("ORDER BY", /^ORDER BY$/, CAT_GROUPS, CAT_GROUPS)] },
  { name: "GROUP BY with COUNT SUM AVG", sql: "SELECT category_id, COUNT(*) AS n, SUM(units_in_stock) AS stock, ROUND(AVG(unit_price), 2) AS a FROM products GROUP BY category_id ORDER BY category_id",
    reference: "SELECT c.category_id, (SELECT count(*) FROM products p WHERE p.category_id = c.category_id), (SELECT sum(units_in_stock) FROM products p WHERE p.category_id = c.category_id), round((SELECT avg(unit_price) FROM products p WHERE p.category_id = c.category_id), 2) FROM (SELECT DISTINCT category_id FROM products) c ORDER BY 1",
    stages: [st("GROUP BY", /^GROUP BY$/, ALL_P, CAT_GROUPS), st("aggregates", /^(AGGREGATES?|COUNT|SUM)$/, undefined, CAT_GROUPS), st("ORDER BY", /^ORDER BY$/, CAT_GROUPS, CAT_GROUPS)] },
  { name: "HAVING", shots: "dark", sql: "SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id HAVING COUNT(*) > 8 ORDER BY n DESC, category_id",
    reference: "SELECT category_id, count(*) FROM products GROUP BY category_id HAVING count(*) > 8 ORDER BY 2 DESC, 1",
    stages: [st("GROUP BY", /^GROUP BY$/, ALL_P, CAT_GROUPS), st("HAVING", /^HAVING$/, CAT_GROUPS, HAV), st("COUNT", /^(COUNT|AGGREGATES?)$/, undefined, HAV), st("ORDER BY", /^ORDER BY$/, HAV, HAV)] },
  { name: "ORDER BY with NULLs", sql: `SELECT order_id, shipped_date::text AS shipped FROM orders WHERE ${SOME_ORDERS} ORDER BY shipped_date DESC, order_id`,
    reference: `SELECT order_id, shipped_date::text FROM orders WHERE ${SOME_ORDERS} ORDER BY shipped_date DESC NULLS FIRST, order_id`,
    stages: [st("FROM", /^FROM$/, undefined, "SELECT 1 FROM orders"), st("WHERE", /^WHERE$/, "SELECT 1 FROM orders", SOME), st("ORDER BY", /^ORDER BY$/, SOME, SOME)] },
  { name: "CTE", sql: "WITH big AS (SELECT order_id, SUM(quantity) AS q FROM order_details GROUP BY order_id) SELECT order_id, q FROM big WHERE q > 100 ORDER BY q DESC, order_id",
    reference: "SELECT order_id, sum(quantity) FROM order_details GROUP BY order_id HAVING sum(quantity) > 100 ORDER BY 2 DESC, 1",
    stages: [st("FROM", /^FROM$/, undefined, "SELECT order_id FROM order_details GROUP BY order_id"), st("WHERE", /^WHERE$/, "SELECT order_id FROM order_details GROUP BY order_id", BIGQ), st("ORDER BY", /^ORDER BY$/, BIGQ, BIGQ)] },
  { name: "Subquery", sql: "SELECT product_name FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products) ORDER BY product_name",
    reference: "SELECT product_name FROM products p WHERE p.unit_price > (SELECT sum(unit_price) / count(*) FROM products) ORDER BY product_name",
    stages: [st("FROM", /^FROM$/, undefined, ALL_P), st("WHERE", /^WHERE$/, ALL_P, "SELECT 1 FROM products p WHERE p.unit_price > (SELECT sum(unit_price) / count(*) FROM products)")] },
  { name: "Window function", shots: "dark", sql: "SELECT product_name, category_id, RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS rk FROM products WHERE category_id IN (5, 6, 7) ORDER BY category_id, rk, product_name",
    reference: "SELECT p.product_name, p.category_id, 1 + (SELECT count(*) FROM products q WHERE q.category_id = p.category_id AND q.unit_price > p.unit_price) AS rk FROM products p WHERE p.category_id IN (5, 6, 7) ORDER BY 2, 3, 1",
    stages: [st("WHERE", /^WHERE$/, ALL_P, "SELECT 1 FROM products WHERE category_id IN (5, 6, 7)"), st("WINDOW", /^WINDOW$/, "SELECT 1 FROM products WHERE category_id IN (5, 6, 7)", "SELECT 1 FROM products WHERE category_id IN (5, 6, 7)"), st("ORDER BY", /^ORDER BY$/, "SELECT 1 FROM products WHERE category_id IN (5, 6, 7)", "SELECT 1 FROM products WHERE category_id IN (5, 6, 7)")] },
  { name: "NULL handling", sql: "SELECT COUNT(*) AS all_rows, COUNT(shipped_date) AS shipped, SUM(freight) FILTER (WHERE shipped_date IS NULL) AS pending_freight FROM orders",
    reference: "SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM orders WHERE shipped_date IS NOT NULL), (SELECT sum(freight) FROM orders WHERE shipped_date IS NULL)",
    stages: [st("FROM", /^FROM$/, undefined, "SELECT 1 FROM orders"), st("ONE GROUP", /^(ONE GROUP|GROUP BY)$/, "SELECT 1 FROM orders", "SELECT 1"), st("aggregates", /^(AGGREGATES?|COUNT|SUM)$/, undefined, "SELECT 1")] },
  { name: "Empty result", shots: true, sql: "SELECT * FROM products WHERE unit_price > 1000000",
    reference: "SELECT * FROM products WHERE unit_price > 1000000",
    stages: [st("FROM", /^FROM$/, undefined, ALL_P), st("WHERE", /^WHERE$/, ALL_P, "SELECT 1 WHERE false")] },
  { name: "Q01 Product Revenue", sql: Q01, shots: true,
    reference: "SELECT p.product_id, p.product_name, round((SELECT sum(od.unit_price * od.quantity * (1 - od.discount)) FROM order_details od WHERE od.product_id = p.product_id)::numeric, 2) AS t FROM products p WHERE EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id) ORDER BY t DESC",
    stages: [st("JOIN", /JOIN/, ALL_P, OD_P), st("GROUP BY", /^GROUP BY$/, OD_P, "SELECT DISTINCT p.product_id FROM order_details od, products p WHERE p.product_id = od.product_id"), st("SUM", /^(SUM|AGGREGATES?)$/, undefined, "SELECT DISTINCT p.product_id FROM order_details od, products p WHERE p.product_id = od.product_id"), st("ORDER BY", /^ORDER BY$/, "SELECT DISTINCT p.product_id FROM order_details od, products p WHERE p.product_id = od.product_id", "SELECT DISTINCT p.product_id FROM order_details od, products p WHERE p.product_id = od.product_id")] },
];
const expectRun = async (q: { reference: string }) => { const r = await reference(q.reference); return { rows: r.rows.length, first: r.rows[0] }; };
const byName = (n: string) => MATRIX.find((q) => q.name === n)!;

/** Walk every step: all regions in sync, the highlight is the named clause, no sideways scroll, and every stage reports the independent rows in/out. */
async function walkStages(page: Page, q: Q, theme: Theme) {
  const count = await stepCount(page);
  const labels = await railLabels(page);
  expect(labels.length, "one rail button per step").toBe(count);
  const used = new Set<Stage>();
  const mid = Math.floor((count - 1) / 2);
  const problems: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) await next(page);
    await expectSync(page, i);
    await noHScroll(page, `step ${i} ${labels[i]}`);
    await expectHighlight(page, q.sql, `step ${i} ${labels[i]}`);
    const spec = q.stages.find((s) => !used.has(s) && s.at.test(labels[i]));
    if (spec) {
      used.add(spec);
      const got = await readCounts(page);
      const want = { in: spec.in ? await refCount(spec.in) : undefined, out: spec.out ? await refCount(spec.out) : undefined };
      if (want.out !== undefined && got.out !== want.out) problems.push(`${spec.label} (step ${i}, rail "${labels[i]}"): rows out ${got.out}, independent ${want.out}`);
      if (want.in !== undefined && got.in !== want.in) problems.push(`${spec.label} (step ${i}, rail "${labels[i]}"): rows in ${got.in}, independent ${want.in}`);
    }
    if (CURATED) {
      const project = test.info().project.name;
      const slugq = q.name === "HAVING" ? "having" : q.name === "Q01 Product Revenue" ? "q01" : "";
      const when = i === 0 ? "first" : i === mid ? "mid" : i === count - 1 ? "last" : "";
      if (when && slugq && theme === "light" && project === "desktop") await curated(page, `desktop-light-${slugq}-${when}`);
      if (when === "mid" && slugq === "having" && theme === "dark" && project === "mobile") await curated(page, "mobile-dark-having-mid");
      if (when === "mid" && slugq === "having" && theme === "light" && project === "firefox-desktop") await curated(page, "firefox-desktop-light-having-mid");
      if (when === "mid" && q.name === "LEFT JOIN" && theme === "light" && project === "mobile") await curated(page, "mobile-light-table-scroll-hint", { el: "classic-tables" });
    }
    if (q.shots === true || (q.shots === "dark" && theme === "dark")) {
      if (i === 0) await shot(page, theme, q.name, "first");
      if (i === mid) await shot(page, theme, q.name, "mid");
      if (i === count - 1) await shot(page, theme, q.name, "last");
    }
  }
  const unused = q.stages.filter((s) => !used.has(s)).map((s) => `${s.label} (no rail step matches; rail: ${labels.join(" > ")})`);
  expect([...problems, ...unused], "stage counts against the independent database").toEqual([]);
  return count;
}

/* ------------------------------------------------------------------------------------------------------------------ */
test.describe("matrix: every query kind on the real page, against an independent database", () => {
  test.beforeEach(() => { test.setTimeout(300_000); });

  for (const theme of THEMES) for (const q of MATRIX) {
    test(`[${theme}] ${q.name}: Results panel, final result, rows in/out of every stage, regions in sync, no console errors`, async ({ page }) => {
      const w = watch(page);
      const want = await reference(q.reference);
      const { rows, first } = await visualize(page, q.sql, theme);
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), "theme applied").toBe(theme === "dark");
      await expect(page.getByTestId("classic-stale-notice"), "the visualization is the editor's query").toHaveAttribute("data-status", "current");

      // the query editor path: the Results panel reports the independent count and rows
      if (rows !== null) expect(rows, "Results panel row count").toBe(want.rows.length);
      // (an empty result renders one placeholder row with no data cells: only non-empty results are compared cell by cell)
      if (first && want.rows.length > 0) expect(first.map((r) => r.map(canon)), "Results panel first rows").toEqual(want.rows.slice(0, first.length));
      if (first && want.rows.length === 0) expect(first.flat().filter((c) => c.trim()), "Results panel shows no data cell for an empty result").toEqual([]);

      // the original visualizer, never a Cinema
      for (const id of ["cinema", "cinema-rail", "cinema-expand", "cinema-empty"]) await expect(page.getByTestId(id)).toHaveCount(0);
      for (const t of ["Logical steps", "Flow diagram", "Relationships", "Structure", "Execution plan"]) await expect(page.getByRole("tab", { name: t })).toBeVisible();
      await expect(page.getByRole("group", { name: "Playback controls" })).toBeVisible();

      // the visualizer's final result is the independent result
      if (want.rows.length === 0) {
        expect(await page.getByText(/Final result \(/).first().textContent().then((t) => /\(0 rows?\)/i.test(t ?? ""), () => true), "an empty final result says 0 rows (or no table)").toBe(true);
        expect(await textOf(page, "classic-viz")).toMatch(/\b(no rows|0 rows|empty|nothing)\b/i);
      } else {
        const fin = await finalTable(page);
        expect(fin.n, "Final result row count").toBe(want.rows.length);
        expect(fin.rows.map((r) => r.map(canon)), "Final result first rows").toEqual(want.rows.slice(0, fin.rows.length));
      }

      const count = await walkStages(page, q, theme);
      expect(count).toBeGreaterThanOrEqual(2);
      await page.getByRole("button", { name: "Restart" }).click();
      await expectSync(page, 0);
      await noHScroll(page, "after Restart");

      expect(w.errors).toEqual([]);
      expect(w.probes, "the ctid-probe console errors must not come back").toEqual([]);
    });
  }
});

test.describe("page load", () => {
  // INFORMATIONAL, never fails the suite: React hydration errors (#418 text mismatch, #423 fallback to client rendering) on first visit are
  // PRE-EXISTING on the live base (main): the deployed site shows the same errors intermittently (home 17, q02 6, q01 and /questions 0 in one
  // comparison; the preview build varies by page). They are recorded as annotations so a change in their number stays visible, and every other
  // test keeps them out of its console-error check (see watch()). Any such error AFTER the page has loaded still fails the test that sees it.
  test("page load: React hydration errors are recorded (pre-existing on the live base, informational)", async ({ page }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openQuestion(page);
    const kinds = [...new Set(w.hydration.map((e) => /#\d+/.exec(e)?.[0] ?? e.slice(0, 40)))];
    test.info().annotations.push({ type: "hydration-errors (pre-existing on live)", description: `${w.hydration.length} during load${kinds.length ? ` (${kinds.join(", ")})` : ""}` });
    expect(w.errors, "no console error or page error after the page has loaded").toEqual([]);
  });
});

test.describe("stale data, invalid SQL, editing", () => {
  test.beforeEach(() => { test.setTimeout(420_000); });

  test("a second, different query replaces the first one's visualization (four in a row, no reload, no button)", async ({ page }) => {
    const w = watch(page);
    const seq = [byName("SELECT and WHERE"), byName("HAVING"), byName("LEFT JOIN"), byName("SELECT and WHERE")];
    await openQuestion(page);
    for (const [k, q] of seq.entries()) {
      if (k > 0) await backToEditor(page);
      await setSql(page, q.sql);
      const r = await runAll(page, await expectRun(q));
      const want = await reference(q.reference);
      if (r.rows !== null) expect(r.rows, `${q.name}: Results panel`).toBe(want.rows.length);
      if (k === 0) await openVisualizer(page);
      await expectShows(page, q); // the panel follows the newest successful run by itself
      const fin = await finalTable(page);
      expect(fin.n, `${q.name}: final result count`).toBe(want.rows.length);
      expect(fin.rows.map((x) => x.map(canon)), `${q.name}: final result rows`).toEqual(want.rows.slice(0, fin.rows.length));
      const labels = await railLabels(page);
      // the rail is this query's: a HAVING step only exists for the HAVING query
      expect(labels.includes("HAVING"), `${q.name}: rail ${labels.join(" > ")}`).toBe(q.name === "HAVING");
      await expectSync(page, 0);
      await walkStages(page, q, "light");
      await expect(page.getByTestId("classic-viz")).toHaveCount(1); // exactly one visualizer, and it is the new one
      if (k > 0 && seq[k - 1].name !== q.name) expect(await textOf(page, "classic-viz")).not.toContain(norm(seq[k - 1].sql).slice(0, 50));
    }
    expect(w.errors).toEqual([]);
  });

  test("editing without running: the old visualization is labelled as the last successful run, and running replaces it", async ({ page }) => {
    await openQuestion(page);
    const a = byName("SELECT and WHERE"), b = byName("Window function");
    await setSql(page, a.sql); await runAll(page); await openVisualizer(page);
    await expectShows(page, a);
    await backToEditor(page);
    await setSql(page, b.sql); // edited, not run
    // A is still the newest successful run, so it may stay, but the panel must not call it the editor's query
    await expect(page.getByTestId("classic-stale-notice")).toHaveAttribute("data-status", /last-successful|stale/, { timeout: 15_000 });
    expect(await textOf(page, "classic-sql")).toContain(norm(a.sql).slice(0, 40));
    const r = await runAll(page, await expectRun(b));
    const wantB = await reference(b.reference);
    if (r.rows !== null) expect(r.rows).toBe(wantB.rows.length);
    await expectShows(page, b);
    expect((await finalTable(page)).n).toBe(wantB.rows.length);
    expect(await textOf(page, "classic-sql")).not.toContain(norm(a.sql).slice(0, 40));
  });

  test("invalid SQL after a good run: the error is shown, the last successful run is labelled as such, the invalid query is never drawn as a result", async ({ page }) => {
    const w = watch(page);
    const a = byName("HAVING");
    const phase: string[] = [];
    const mark = (n: string) => phase.push(`${n}:${w.errors.length}`);
    await openQuestion(page);
    await setSql(page, a.sql); await runAll(page); await openVisualizer(page);
    await expectShows(page, a); mark("A visualized");
    await backToEditor(page);
    await setSql(page, "SELECT x FROM no_such_table");
    await page.getByRole("button", { name: /Run All/ }).click();
    await expect(page.getByText(/no_such_table|does not exist/i).first()).toBeVisible({ timeout: 60_000 });
    if (!small(page)) await expect(page.locator("table:has(th:text-is('#')) tbody tr"), "no result rows of the previous query under the error").toHaveCount(0);
    mark("invalid run shown");
    // the panel keeps the last SUCCESSFUL run and says so; it never shows the failed query's steps as a result
    await expect(page.getByTestId("classic-stale-notice")).toHaveAttribute("data-reason", "latest-failed", { timeout: 20_000 });
    await expect(page.getByTestId("classic-stale-notice")).not.toHaveAttribute("data-status", "current");
    expect(await textOf(page, "classic-sql")).toContain(norm(a.sql).slice(0, 40));
    expect(await textOf(page, "classic-sql")).not.toContain("no_such_table");
    // pressing the button on the failed run visualizes THAT query: the steps show where it stopped, with the real error, and no result
    mark("notice checked");
    if (!small(page)) await curated(page, "desktop-failed-query-stale-notice", "viewport");
    await openVisualizer(page, { press: true });
    await expect(page.getByTestId("classic-explain").or(page.getByTestId("classic-tables")).filter({ hasText: /no_such_table|does not exist|failed|rejected|couldn.t be computed/i }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Final result \(/)).toHaveCount(0);
    expect(await textOf(page, "classic-viz")).not.toMatch(/Logical step \d of \d: (GROUP BY|HAVING)/);
    mark("failed query visualized");
    // and the page still works afterwards: a valid query visualizes normally, current again
    await backToEditor(page);
    const ok = byName("Subquery");
    await setSql(page, ok.sql);
    const r = await runAll(page, await expectRun(ok));
    const want = await reference(ok.reference);
    if (r.rows !== null) expect(r.rows).toBe(want.rows.length);
    await expectShows(page, ok);
    expect((await finalTable(page)).n).toBe(want.rows.length);
    await expectSync(page, 0);
    expect(w.errors.filter((e) => e.startsWith("pageerror")), "no uncaught page error").toEqual([]);
    mark("valid query again");
    expect(w.errors.filter(notPgliteFailureEcho), `no console error other than the echo of the invalid SQL (console errors so far by phase: ${phase.join(", ")}; kinds: ${[...new Set(w.errors.map((e) => e.split("\n")[0].slice(0, 90)))].join(" | ")})`).toEqual([]);
  });

  for (const [label, bad, message] of [
    ["syntax error", "SELECT product_name FROM products WHERE unit_price >", /syntax error/i],
    // On the production build a mistyped leading keyword is stopped by the read-only policy before PostgreSQL sees it, and the page says "SELEC statements change data, the schema or the session ..." (misleading for a typo: reported).
    ["mistyped keyword", "SELEC product_name FROM products", /syntax error|statements change data|read-only/i],
  ] as const) test(`invalid SQL as the first run (${label}): an error is shown, nothing is visualized as a result`, async ({ page }) => {
    await openQuestion(page);
    await setSql(page, bad);
    await page.getByRole("button", { name: /Run All/ }).click();
    await expect(page.getByText(message).first()).toBeVisible({ timeout: 60_000 });
    await openVisualizer(page, { expectViz: false });
    // every run failed: nothing to show yet
    await expect(page.getByTestId("classic-stale-notice")).toHaveAttribute("data-status", "none", { timeout: 15_000 });
    await expect(page.getByText(/Final result \(/)).toHaveCount(0);
    expect(await page.getByTestId("classic-step-rail").count() ? await railLabels(page) : [], "no stage rail of a valid query").not.toContain("WHERE");
  });

  test("editing and execution: run, edit, run again, run twice; a failed run does not poison the next one", async ({ page }) => {
    await openQuestion(page);
    const a = byName("SELECT and WHERE"), b = byName("HAVING");
    const [wa, wb] = [await reference(a.reference), await reference(b.reference)];
    await setSql(page, a.sql);
    const r1 = await runAll(page);
    if (r1.rows !== null) expect(r1.rows).toBe(wa.rows.length);
    expect(r1.first?.map((r) => r.map(canon))).toEqual(wa.rows.slice(0, r1.first!.length));
    const r1b = await runAll(page, await expectRun(a)); // the same query twice
    expect(r1b.first).toEqual(r1.first);
    await setSql(page, "SELECT * FROM does_not_exist_tbl");
    await page.getByRole("button", { name: /Run All/ }).click();
    await expect(page.getByText(/does_not_exist_tbl|does not exist/i).first()).toBeVisible({ timeout: 60_000 });
    await setSql(page, b.sql);
    const r2 = await runAll(page, await expectRun(b));
    if (r2.rows !== null) expect(r2.rows).toBe(wb.rows.length);
    expect(r2.first?.map((r) => r.map(canon))).toEqual(wb.rows.slice(0, r2.first!.length));
    expect(await editorSql(page)).toBe(b.sql);
  });

  test("a DROP TABLE is never run; products is untouched afterwards", async ({ page }) => {
    await openQuestion(page);
    await setSql(page, "DROP TABLE products");
    await page.getByRole("button", { name: /Run All/ }).click();
    await page.waitForTimeout(3000);
    const ok = byName("SELECT and WHERE");
    await setSql(page, ok.sql);
    const r = await runAll(page, await expectRun(ok));
    expect(r.first?.map((x) => x.map(canon))).toEqual((await reference(ok.reference)).rows.slice(0, r.first!.length));
  });
});

test.describe("playback, rail, keyboard, reset", () => {
  test.beforeEach(() => { test.setTimeout(300_000); });
  const Qp = () => byName("HAVING");

  test("Next, Previous, rail, Restart, Reset and the keyboard keep every region in sync", async ({ page }) => {
    const w = watch(page);
    await visualize(page, Qp().sql);
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
    const group = page.getByRole("group", { name: "Playback controls" });
    await group.focus();
    await page.keyboard.press("ArrowRight"); await expectSync(page, 1);
    await page.keyboard.press("ArrowRight"); await expectSync(page, 2);
    await page.keyboard.press("ArrowLeft"); await expectSync(page, 1);
    await page.keyboard.press("End"); await expectSync(page, count - 1);
    await page.keyboard.press("ArrowRight"); await expectSync(page, count - 1);
    await page.keyboard.press("Home"); await expectSync(page, 0);
    await page.keyboard.press("ArrowLeft"); await expectSync(page, 0);
    await page.getByLabel("Timeline").focus();
    await page.keyboard.press("End"); await expectSync(page, count - 1);
    expect(w.errors).toEqual([]);
  });

  test("Play runs the steps in order and stops at the last; Pause holds the step; speed changes the pace", async ({ page }) => {
    await visualize(page, Qp().sql);
    const count = await stepCount(page);
    const bar = page.getByRole("group", { name: "Playback controls" });
    const play = () => bar.getByRole("button", { name: "Play", exact: true });
    const timeToEnd = async (speed: string) => {
      await page.getByRole("button", { name: "Restart" }).click();
      await expectSync(page, 0);
      await bar.getByLabel("Playback speed").selectOption(speed);
      const t0 = Date.now();
      await play().click();
      const seen: number[] = [];
      await expect.poll(async () => { const n = (await readSync(page)).now; if (seen.at(-1) !== n) seen.push(n); return n; }, { timeout: 90_000, intervals: [30] }).toBe(count);
      const took = Date.now() - t0;
      expect(seen, `speed ${speed}: steps in order`).toEqual([...seen].sort((a, b) => a - b));
      expect(seen[0]).toBe(1);
      await expectSync(page, count - 1);
      await expect(play()).toBeVisible({ timeout: 15_000 }); // it stopped by itself
      return took;
    };
    const slow = await timeToEnd("1");
    const fast = await timeToEnd("4");
    expect(fast, `4x (${fast} ms) is faster than 1x (${slow} ms)`).toBeLessThan(slow);
    // Pause holds the step
    await page.getByRole("button", { name: "Restart" }).click();
    await expectSync(page, 0);
    await bar.getByLabel("Playback speed").selectOption("1");
    await play().click();
    await bar.getByRole("button", { name: "Pause" }).click();
    const held = (await readSync(page)).now;
    await page.waitForTimeout(1500);
    expect((await readSync(page)).now, "Pause holds the step").toBe(held);
    await expectSync(page, held - 1);
    // stepping while paused, then Play continues from there and Restart resets
    await next(page);
    const at = (await readSync(page)).root!;
    await expectSync(page, Number(at));
    await page.getByRole("button", { name: "Restart" }).click();
    await expectSync(page, 0);
  });

  test("the other tabs work and come back to the same step", async ({ page }) => {
    await visualize(page, Qp().sql);
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

  for (const theme of THEMES) test(`compact step bar [${theme}]: appears when the player scrolls away, drives the same step, glyph readable, goes away again at the top`, async ({ page }) => {
    const q = byName("Q01 Product Revenue");
    await visualize(page, q.sql, theme);
    const bar = page.getByTestId("classic-step-bar");
    await expect(bar, "hidden while the full player is in view").toBeHidden();
    // scroll until the player is out of view (the pane scrolls inside itself on a desktop, the document on a phone)
    await page.getByTestId("classic-tables").evaluate((el) => el.scrollIntoView({ block: "end" }));
    await next(page).catch(() => undefined); // keeps the content long enough on every query; harmless
    await page.getByTestId("classic-tables").evaluate((el) => el.scrollIntoView({ block: "end" }));
    await expect(bar, "the compact bar replaces the scrolled-away player").toBeVisible({ timeout: 10_000 });
    if (!small(page)) await curated(page, "desktop-compact-step-bar", "viewport");
    // the icon of the Play button (an SVG drawn in currentColor) must be readable on its background: >= 3:1 for a UI glyph
    const glyph = await page.getByRole("button", { name: /Step bar: (auto-run|stop)/ }).evaluate((b) => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1;
      const cx = cv.getContext("2d", { willReadFrequently: true })!;
      const rgb = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
      const lum = (c: number[]) => { const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const st = getComputedStyle(b); const fg = rgb(st.color), bg = rgb(st.backgroundColor);
      const [a, z] = [lum(fg), lum(bg)];
      return { ratio: Math.round(((Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05)) * 100) / 100, fg: fg.join(","), bg: bg.join(",") };
    });
    expect(glyph.ratio, `compact bar play glyph colour ${glyph.fg} on ${glyph.bg}`).toBeGreaterThanOrEqual(3);
    const now = (await readSync(page)).now - 1;
    await expect(bar).toHaveAttribute("data-step-index", String(now));
    await page.getByRole("button", { name: "Step bar: forward" }).click();
    await expectSync(page, now + 1);
    await expect(bar).toHaveAttribute("data-step-index", String(now + 1));
    await page.getByRole("button", { name: "Step bar: back" }).click();
    await expectSync(page, now);
    await page.getByRole("button", { name: "Step bar: auto-run" }).click();
    await expect(page.getByRole("button", { name: "Step bar: stop" })).toBeVisible();
    await page.getByRole("button", { name: "Step bar: stop" }).click();
    const held = (await readSync(page)).now;
    await page.waitForTimeout(1500);
    expect((await readSync(page)).now, "stop holds the step").toBe(held);
    await expectSync(page, held - 1);
    await noHScroll(page, "with the compact bar");
    await page.getByTestId("classic-sql").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(bar, "hidden again once the player is back in view").toBeHidden({ timeout: 10_000 });
  });

  test("grading is unaffected: after visualizing and stepping, the editor still holds the SQL, re-runs identically and Submit passes", async ({ page }) => {
    await openQuestion(page);
    await setSql(page, Q01);
    const before = await runAll(page);
    await openVisualizer(page);
    await page.getByRole("button", { name: "Next step" }).click();
    await backToEditor(page);
    expect(await editorSql(page)).toBe(Q01);
    const after = await runAll(page);
    expect(after.rows).toBe(before.rows);
    expect(after.first).toEqual(before.first);
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(/Correct! Your query produces the expected result|Query passed/i).first()).toBeVisible({ timeout: 90_000 });
  });
});
