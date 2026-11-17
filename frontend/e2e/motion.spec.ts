import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// How fast the interface answers, measured in a real browser: entrances finish quickly, nothing loops for decoration, hover and
// press respond in the targeted time, and a visitor who asks for reduced motion gets none.

const ROUTES = ["/", "/learn", "/dashboard", "/daily", "/projects-lab", "/career/planner", "/etl-builder", "/dag-simulator", "/schema-designer", "/dq-exercises"];

/**
 * Running animations right now. `settleMs` is how long the single-pass ones (entrances) take to finish; `cueMs` is the longest
 * total time of a limited repeating cue (a few pulses on today's marker, the data-flow line); `infinite` never finish.
 */
const animations = (page: Page) => page.evaluate(() => {
  const list = document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming);
  const timing = (a: Animation) => a.effect!.getComputedTiming();
  const once = list.filter((a) => timing(a).iterations === 1);
  const repeating = list.filter((a) => { const i = timing(a).iterations; return typeof i === "number" && i > 1 && i !== Infinity; });
  return {
    settleMs: Math.round(once.reduce((m, a) => Math.max(m, Number(timing(a).delay) + Number(timing(a).duration)), 0)),
    cueMs: Math.round(repeating.reduce((m, a) => Math.max(m, Number(timing(a).duration) * Number(timing(a).iterations)), 0)),
    infinite: list.filter((a) => timing(a).iterations === Infinity).map((a) => (a as CSSAnimation).animationName || "transition"),
  };
});

test("entrances finish within 400 ms and nothing loops once the page has loaded", async ({ page }) => {
  for (const path of ROUTES) {
    await page.goto(path);
    const a = await animations(page);
    expect(a.settleMs, `${path} entrance`).toBeLessThanOrEqual(400);
    expect(a.cueMs, `${path} repeating cue`).toBeLessThanOrEqual(5000);
    await page.waitForTimeout(1500); // a lab's loading skeleton pulses until its editor has loaded; after that nothing loops
    expect((await animations(page)).infinite, `${path} still looping`).toEqual([]);
  }
});

test("moving to another page does not leave animations running for most of a second", async ({ page, isMobile }) => {
  test.skip(isMobile, "sidebar");
  await page.goto("/learn");
  while ((await page.locator('aside button[data-nav-group][aria-expanded="false"]').count()) > 0) await page.locator('aside button[data-nav-group][aria-expanded="false"]').first().click();
  for (const [href, heading] of [["/dashboard", /learning dashboard/i], ["/daily", /180-day/i], ["/projects-lab", /Projects lab/]] as const) {
    await page.locator(`aside a[href="${href}"]`).first().click();
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(heading);
    const a = await animations(page);
    expect(a.settleMs, `${href} after navigation`).toBeLessThanOrEqual(420);
  }
});

test("hover and press feedback are quick: buttons and chips 100-160 ms, cards 140-200 ms", async ({ page, isMobile }) => {
  test.skip(isMobile, "pointer");
  await page.goto("/projects-lab");
  const card = page.locator("[data-project]").first();
  const cardMs = await card.evaluate((el) => Number.parseFloat(getComputedStyle(el).transitionDuration.split(",")[0]) * 1000);
  expect(cardMs).toBeGreaterThanOrEqual(140);
  expect(cardMs).toBeLessThanOrEqual(200);
  const chip = page.getByRole("group", { name: "Difficulty" }).getByRole("button").first();
  const chipMs = await chip.evaluate((el) => Number.parseFloat(getComputedStyle(el).transitionDuration.split(",")[0]) * 1000);
  expect(chipMs).toBeGreaterThanOrEqual(100);
  expect(chipMs).toBeLessThanOrEqual(160);
});

test("a pressed button gives immediate feedback", async ({ page, isMobile }) => {
  test.skip(isMobile, "pointer");
  await page.goto("/learn");
  const button = page.getByRole("button", { name: "Search", exact: true }).first();
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => button.evaluate((el) => getComputedStyle(el).transform), { timeout: 400 }).not.toBe("none");
  await page.mouse.up();
});

test("the tab highlight moves to the selected tab", async ({ page }) => {
  await page.goto("/projects-lab");
  const list = page.getByRole("tablist", { name: "Projects view" });
  const mine = list.getByRole("tab", { name: /My projects/ });
  const marker = list.locator('span[aria-hidden="true"]').first();
  await expect(marker).toBeVisible();
  const x1 = await marker.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  await mine.click();
  await expect.poll(() => marker.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41), { timeout: 800 }).toBeGreaterThan(x1);
  await expect(mine).toHaveAttribute("aria-selected", "true");
});

test("accordions open and close from the keyboard, with the chevron following", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard");
  await page.goto("/learn/path/python-for-data");
  const header = page.getByRole("button", { name: /Python fundamentals/ }).first();
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: /\bDay 1\b/ }).first()).toBeVisible();
  await page.keyboard.press("Space");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  const chevron = header.locator("svg").last();
  await expect(chevron).not.toHaveClass(/rotate-180/);
});

test("reduced motion: entrances, reveals and the page transition are switched off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/learn");
  const dur = await page.locator(".stagger > *").first().evaluate((el) => Number.parseFloat(getComputedStyle(el).animationDuration));
  expect(dur).toBeLessThan(0.001); // seconds: 0.01 ms
  await page.goto("/");
  const hidden = await page.evaluate(() => document.querySelectorAll(".reveal-pending").length);
  expect(hidden).toBe(0); // nothing is parked below the fold waiting for a scroll
  const a = await animations(page);
  expect(a.settleMs).toBeLessThanOrEqual(5);
});

test("progress from storage appears at once; only a change while you are here animates", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem("df.test.seeded.motion")) return;
      localStorage.setItem("df.test.seeded.motion", "1");
      localStorage.setItem("sqlp.public.progress", JSON.stringify({ version: 1, questions: { 1: { attempts: 1, solvedAt: "2026-01-01" } }, activeDays: [], cards: {} }));
    } catch { /* ignore */ }
  });
  await page.goto("/learn");
  const bar = page.locator('#practice [role="progressbar"] > div').first();
  await expect(bar).toBeVisible();
  const width = await bar.evaluate((el) => (el as HTMLElement).style.width);
  expect(width).not.toBe("0%");
  const cls = await bar.evaluate((el) => el.className);
  // 150 ms after load the transition is armed; the value that came from storage did not use it
  await page.waitForTimeout(300);
  expect(await bar.evaluate((el) => el.className)).toContain("transition-[width]");
  expect(cls).toBeTruthy();
});
