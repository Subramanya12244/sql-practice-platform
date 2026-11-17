import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Release-style checks for the Learn hub that are read-only, so they also run against production
// (E2E_BASE_URL=https://dataforge.dataforge-learn.workers.dev): clean console, no hydration errors, no failed requests,
// refresh and back/forward behave, breadcrumbs follow the page.

const ROUTES = [
  "/", "/learn", "/dashboard",
  "/learn/path/sql-developer", "/learn/path/python-for-data", "/learn/path/data-analyst", "/learn/path/data-engineer",
  "/learn/topic/left-join", "/learn/topic/row-number", "/learn/topic/python-pandas", "/learn/topic/excel", "/learn/topic/etl-incremental-load", "/learn/topic/airflow-dags",
  "/daily", "/daily/day/1", "/questions", "/practice/python", "/notes", "/portfolio",
];

/** Collects what a visitor would call broken: console errors, page errors, hydration warnings, failed or 4xx/5xx requests to this site. */
function watch(page: Page, origin: string) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("requestfailed", (r) => { if (r.url().startsWith(origin)) problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ""}`); });
  page.on("response", (r) => { if (r.url().startsWith(origin) && r.status() >= 400 && !/favicon|\.map$/.test(r.url())) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return problems;
}

test("release: every key route loads with no console errors, hydration errors or failed requests", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const origin = new URL(baseURL!).origin;
  const problems = watch(page, origin);
  for (const path of ROUTES) {
    const before = problems.length;
    const res = await page.goto(path);
    expect(res?.status(), `${path} status`).toBeLessThan(400);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(problems.slice(before), path).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} overflow`).toBeLessThanOrEqual(1);
  }
});

test("release: no topic page scrolls sideways on a phone", async ({ page, isMobile, baseURL }) => {
  test.skip(!isMobile, "phone layout");
  test.setTimeout(480_000);
  // every topic in the sitemap when there is one (a built or deployed site); otherwise the samples above
  const xml = await (await page.request.get(new URL("/sitemap.xml", baseURL!).href)).text();
  const fromSitemap = [...xml.matchAll(/<loc>[^<]*(\/learn\/topic\/[a-z0-9-]+)<\/loc>/g)].map((m) => m[1]);
  const paths = fromSitemap.length > 100 ? fromSitemap : ROUTES.filter((r) => r.startsWith("/learn/topic/"));
  const wide: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) wide.push(`${path} (+${over}px)`);
  }
  expect(wide).toEqual([]);
});

test("release: page titles are specific", async ({ page }) => {
  const titles: Record<string, RegExp> = {
    "/learn": /Learn SQL, Python, Data Analytics and Data Engineering/,
    "/dashboard": /Your learning dashboard/,
    "/learn/path/sql-developer": /Learn SQL/,
    "/learn/path/python-for-data": /Python for Data/,
    "/learn/path/data-analyst": /Data Analyst/,
    "/learn/path/data-engineer": /Data Engineer/,
    "/learn/topic/left-join": /LEFT JOIN: notes, practice and projects/,
    "/learn/topic/excel": /Excel for analysis: notes, practice and projects/,
  };
  for (const [path, re] of Object.entries(titles)) {
    await page.goto(path);
    await expect(page, path).toHaveTitle(re);
  }
});

test("release: back and forward walk the hub, a path and a topic, and a refresh keeps the page", async ({ page }) => {
  await page.goto("/learn");
  await page.locator('[data-path="data-engineer"]').getByRole("link", { name: "Data Engineer", exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/path\/data-engineer$/);
  await page.goto("/learn/topic/left-join");
  await page.goBack();
  await expect(page).toHaveURL(/\/learn\/path\/data-engineer$/);
  await expect(page.getByRole("heading", { level: 1, name: "Data Engineer" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole("heading", { level: 1, name: /Learn data skills/ })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/learn\/path\/data-engineer$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Data Engineer" })).toBeVisible();
});

test("release: a filtered library survives a refresh and back/forward", async ({ page }) => {
  await page.goto("/learn?subject=engineering&level=Advanced#topics");
  const lib = page.locator("#topics");
  await expect(lib.getByRole("button", { name: /^Data Engineering/ })).toHaveAttribute("aria-pressed", "true");
  await expect(lib.getByLabel("Difficulty")).toHaveValue("Advanced");
  const count = await lib.getByRole("status").innerText();
  await page.reload();
  await expect(lib.getByRole("status")).toHaveText(count);
  await lib.locator("[data-topic]").first().click();
  await expect(page).toHaveURL(/\/learn\/topic\//);
  await page.goBack();
  await expect(page).toHaveURL(/subject=engineering/);
  await expect(lib.getByLabel("Difficulty")).toHaveValue("Advanced");
  await expect(lib.getByRole("status")).toHaveText(count);
});

test("release: breadcrumbs follow the page and a direct link to a topic works", async ({ page, isMobile }) => {
  test.skip(isMobile, "the header breadcrumb is hidden below 768 px");
  for (const [path, last] of [["/learn", "Learning hub"], ["/learn/path/sql-developer", "Learning hub"], ["/learn/topic/left-join", "Learning hub"], ["/dashboard", "Dashboard"]] as const) {
    await page.goto(path);
    const crumbs = page.getByTestId("breadcrumbs");
    await expect(crumbs, path).toContainText(last);
  }
  await page.goto("/learn/topic/left-join");
  await expect(page.getByRole("heading", { level: 1, name: /LEFT JOIN/ })).toBeVisible();
});

test("release: the dashboard still has every card it had", async ({ page }) => {
  await page.goto("/dashboard");
  for (const name of ["What to do next", "Revision and mistakes", "Skill mastery", "Projects", "Recommended next", "Bookmarks", "Achievements", "Daily missions", "Concept progress", "Study modules", "This week"]) {
    await expect(page.getByRole("heading", { name }).first(), name).toBeVisible();
  }
  await expect(page.getByLabel("Target")).toBeVisible();
});

test("release: opening topics changes no progress", async ({ page }) => {
  await page.goto("/learn/topic/left-join");
  await page.goto("/learn/topic/excel");
  await page.goto("/learn/path/sql-developer");
  const stored = await page.evaluate(() => localStorage.getItem("sqlp.public.progress"));
  const p = stored ? JSON.parse(stored) : {};
  expect(Object.keys(p.read ?? {})).toEqual([]);
  expect(Object.keys(p.daily?.days ?? {})).toEqual([]);
  expect(Object.keys(p.questions ?? {})).toEqual([]);
});
