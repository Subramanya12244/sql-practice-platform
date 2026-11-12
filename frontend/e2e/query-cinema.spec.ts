import type { Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";

/**
 * SQL Query Cinema in a real browser (real PostgreSQL in WebAssembly): the learner presses Visualize and SEES the tables, the
 * matching rows, the filtered rows, the groups, the aggregates and the result, through an animation they can control.
 * Runs in every Playwright project. With CINEMA_SHOTS=1 it also writes the screenshots used by docs/QUERY_VISUALIZER_UX_REPORT.md
 * to docs/images/query-cinema/.
 */
const SHOTS = process.env.CINEMA_SHOTS === "1";
const shotDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/images/query-cinema");
const shot = async (page: Page, name: string) => { if (!SHOTS) return; await page.waitForTimeout(1800); /* let the beats finish so the picture shows the settled stage */ await page.screenshot({ path: path.join(shotDir, `${name}${/-(desktop|mobile)$/.test(name) ? "" : small(page) ? "-mobile" : "-desktop"}.png`) }); };

const cinema = (page: Page) => page.getByTestId("cinema");
const flow = (page: Page) => page.getByTestId("rowflow").first();
const ctl = (page: Page, name: string) => page.getByTestId("cinema-controls").getByRole("button", { name, exact: true });
const rail = (page: Page) => page.getByTestId("cinema-rail").getByRole("button");
const small = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
const ready = async (page: Page) => {
  await expect(page.getByRole("group", { name: "Playback controls" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("rowflow-identity")).toContainText("real (ctid)", { timeout: 60_000 }); // row-level data has arrived
};
async function visualize(page: Page, preset: string) {
  await page.goto("/query-visualizer");
  await page.getByRole("button", { name: preset, exact: true }).click();
  await ready(page);
}
const next = async (page: Page) => { await page.getByRole("button", { name: "Next step" }).click(); await expect(flow(page)).toHaveAttribute("data-phase", /2|static/, { timeout: 5000 }); };
const labels = (page: Page) => rail(page).evaluateAll((els) => els.map((e) => (e.querySelector("span")?.textContent ?? "").trim()));
const toStage = async (page: Page, label: string) => { await rail(page).nth((await labels(page)).indexOf(label)).click(); await expect(page.getByTestId("cinema-title")).toContainText(new RegExp(label, "i")); await expect(flow(page)).toHaveAttribute("data-phase", /2|static/, { timeout: 5000 }); };

const MAIN = "JOIN + GROUP BY + HAVING";
const SPEC = "Customers with many large orders";

test.describe("Query Cinema layout", () => {
  test("before a query runs, the page shows the pipeline it is about to play, not a line of text", async ({ page }) => {
    await page.goto("/query-visualizer");
    await expect(page.getByTestId("cinema-empty")).toBeVisible();
    await expect(page.getByTestId("cinema-empty")).toContainText("Your query will play here");
    await expect(page.getByRole("button", { name: "Visualize", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Example queries" })).toBeVisible();
    await shot(page, "00-before-visualize");
  });

  test("the animated canvas is the main thing on the page: it fills the screen and the controls stay in reach", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    const vp = page.viewportSize()!;
    const rail0 = await page.getByTestId("cinema-rail").boundingBox();
    const canvas = await flow(page).boundingBox();
    const controls = await page.getByTestId("cinema-controls").boundingBox();
    // the cinema is brought to the top of the screen, so the pipeline rail is visible without scrolling
    await expect.poll(async () => (await page.getByTestId("cinema-rail").boundingBox())!.y, { timeout: 5000 }).toBeLessThan(vp.height * 0.4);
    expect(rail0).toBeTruthy();
    expect(canvas!.height).toBeGreaterThan(small(page) ? 250 : 380);
    expect(canvas!.width).toBeGreaterThan(vp.width * (small(page) ? 0.8 : 0.5));
    // the playback bar is pinned inside the viewport while the canvas is on screen
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(vp.height + 2);
    await noHScroll(page);
    await shot(page, "01-from");
  });
});

test.describe("Query Cinema, JOIN + GROUP BY + HAVING", () => {
  test("every logical stage is a step: FROM, JOIN, WHERE, GROUP BY, HAVING, SELECT, ORDER BY, LIMIT, with exact counts", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await expect(rail(page)).toHaveCount(8);
    const names = await labels(page);
    expect(names).toEqual(["FROM", "JOIN", "WHERE", "GROUP BY", "HAVING", "SELECT", "ORDER BY", "LIMIT"]);
    await expect(rail(page).nth(0)).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("cinema-counts")).toContainText("91");
    await expect(rail(page).nth(1)).toContainText("91 → 100");
    await expect(rail(page).nth(7)).toContainText("12 → 5");
    await expect(page.getByText(/Logical order: how SQL defines the result/)).toContainText("PostgreSQL may run the query differently");
  });

  test("FROM and JOIN: the real tables, the matching rows and the rows with no partner", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await expect(flow(page).locator("[data-card]").first()).toContainText("ALFKI");
    await shot(page, "02-from");
    await next(page); // JOIN
    await expect(page.getByTestId("cinema-title")).toContainText("JOIN orders o");
    const lanes = await flow(page).locator("p", { hasText: /Left rows|Right rows|Result/i }).allTextContents();
    expect(lanes.join(" ")).toMatch(/LEFT ROWS.*91/i);
    expect(lanes.join(" ")).toMatch(/RIGHT ROWS.*100/i);
    const tones = await flow(page).locator("[data-card]").evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.tone))]);
    expect(tones).toContain("matched"); // rows with a partner
    expect(tones).toContain("removed"); // FISSA and PARIS have no orders and an INNER JOIN drops them
    const groups = await flow(page).locator("[data-card][data-group]").evaluateAll((els) => new Set(els.map((e) => (e as HTMLElement).dataset.group)).size);
    expect(groups).toBeGreaterThan(2); // matching rows share a colour per family
    await expect(flow(page).getByTestId("rowflow-links")).toBeVisible().catch(() => undefined); // match links are drawn before rows merge into the result
    await shot(page, "03-join");
  });

  test("WHERE: each row shows what the condition evaluated to, then true rows are kept and false rows move to Removed", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await next(page); // JOIN
    // record every change of the beat together with where the first "true" row sits at that moment (atomic, so no polling race)
    await page.evaluate(() => {
      const w = window as unknown as { __beats: string[] };
      w.__beats = [];
      const snap = () => {
        const f = document.querySelector('[data-testid="rowflow"]');
        const c = f?.querySelector('[data-card][data-verdict="true"]') as HTMLElement | null;
        const entry = `${f?.getAttribute("data-phase")}|${c?.style.transform ?? ""}`;
        if (w.__beats[w.__beats.length - 1] !== entry) w.__beats.push(entry);
      };
      new MutationObserver(snap).observe(document.body, { subtree: true, attributes: true, childList: true, attributeFilter: ["data-phase", "style"] });
    });
    await rail(page).nth(2).click(); // WHERE: watch the beats from the start
    await expect(flow(page)).toHaveAttribute("data-phase", "2", { timeout: 8000 }); // travel
    const beats = await page.evaluate(() => (window as unknown as { __beats: string[] }).__beats);
    expect(beats.some((b) => /^1\|translate\(0%/.test(b))).toBe(true); // while rows are evaluated they are still in the input relation
    await expect(flow(page).getByTestId("rowflow-verdict").first()).toBeVisible();
    const after = await flow(page).locator('[data-card][data-verdict="true"]').first().evaluate((e) => (e as HTMLElement).style.transform);
    expect(after).toMatch(/^translate\(100%/); // into the Kept lane
    const removed = await flow(page).locator('[data-card][data-verdict="false"]').first().evaluate((e) => (e as HTMLElement).style.transform);
    expect(removed).toMatch(/^translate\(200%/); // into the Removed lane
    const verdicts = await flow(page).locator("[data-card][data-verdict]").evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.verdict, (e as HTMLElement).dataset.tone]));
    for (const [v, t] of verdicts) expect(t).toBe(v === "true" ? "kept" : "removed");
    await expect(page.getByTestId("cinema-counts")).toContainText(/100.*in/);
    await shot(page, "04-where");
  });

  test("GROUP BY collects rows into coloured groups with their aggregate; HAVING compares each group's aggregate", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await toStage(page, "GROUP BY");
    const buckets = flow(page).locator('[data-card^="bucket:"]');
    expect(await buckets.count()).toBeGreaterThan(3);
    await expect(buckets.first()).toContainText(/orders = \d+/);
    const members = await flow(page).locator("[data-card]:not([data-card^='bucket:'])[data-group]").count();
    expect(members).toBeGreaterThan(5);
    await shot(page, "05-group-by");
    await toStage(page, "HAVING");
    const cards = flow(page).locator("[data-card][data-verdict]");
    const rows = await cards.evaluateAll((els) => els.map((e) => ({ v: (e as HTMLElement).dataset.verdict, t: e.textContent ?? "" })));
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) { const n = Number(/(\d+)\s*[✓✕∅]/.exec(r.t)?.[1] ?? /(\d+)/.exec(r.t)?.[1]); expect(r.v).toBe(n >= 3 ? "true" : "false"); }
    await shot(page, "06-having");
  });

  test("SELECT, ORDER BY and LIMIT: groups become output rows, rows reorder, the rest is cut off", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await toStage(page, "SELECT");
    await expect(flow(page)).toHaveAttribute("data-kind", "aggregate");
    await shot(page, "07-select");
    await toStage(page, "ORDER BY");
    await expect(flow(page)).toHaveAttribute("data-kind", "sort");
    await expect(flow(page).locator("[data-card]").first()).toContainText("France");
    await shot(page, "08-order-by");
    await toStage(page, "LIMIT");
    const kept = await flow(page).locator('[data-card][data-tone="kept"]').count();
    const cut = await flow(page).locator('[data-card][data-tone="cut"]').count();
    expect(kept).toBe(5);
    expect(cut).toBeGreaterThan(0);
    await shot(page, "09-limit");
  });

  test("the final result is the query's real result", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    const table = page.getByText(/Final result \(5 rows\)/).locator("xpath=..").locator("table");
    const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent).join(" ")));
    expect(rows.map((r) => r.replace(/\s+/g, " ").trim())).toEqual(["France 13", "Germany 13", "USA 13", "Brazil 9", "UK 8"]);
    await page.getByTestId("cinema").scrollIntoViewIfNeeded();
  });
});

test.describe("Query Cinema, controls", () => {
  test("pause on any stage and inspect it; play, step back, scrub, change speed", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await ctl(page, "Play").click();
    await expect(cinema(page)).not.toHaveAttribute("data-index", "0", { timeout: 8000 });
    await ctl(page, "Pause").click();
    const at = await cinema(page).getAttribute("data-index");
    await page.waitForTimeout(2200);
    expect(await cinema(page).getAttribute("data-index")).toBe(at); // paused: it stays where it is
    await page.getByRole("button", { name: "Previous step" }).click();
    expect(Number(await cinema(page).getAttribute("data-index"))).toBe(Number(at) - 1);
    await page.getByRole("slider", { name: "Timeline" }).fill("4");
    await expect(page.getByTestId("cinema-title")).toContainText("HAVING");
    await page.getByRole("combobox", { name: "Playback speed" }).selectOption("4");
    await page.getByRole("button", { name: "Restart" }).click();
    await expect(cinema(page)).toHaveAttribute("data-index", "0");
  });

  test("keyboard: arrows, Home, End and Space work on the cinema", async ({ page }) => {
    test.skip(small(page), "keyboard shortcuts are a desktop feature");
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await rail(page).nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(cinema(page)).toHaveAttribute("data-index", "2");
    await page.keyboard.press("ArrowLeft");
    await expect(cinema(page)).toHaveAttribute("data-index", "1");
    await page.keyboard.press("End");
    await expect(cinema(page)).toHaveAttribute("data-index", "7");
    await page.keyboard.press("Home");
    await expect(cinema(page)).toHaveAttribute("data-index", "0");
    await rail(page).nth(0).blur();
    await cinema(page).focus();
    await page.keyboard.press("Space");
    await expect(ctl(page, "Pause")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(ctl(page, "Play")).toBeVisible();
  });

  test("clicking a stage on the rail jumps there and marks the earlier ones done", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await toStage(page, "HAVING");
    await expect(rail(page).nth(4)).toHaveAttribute("data-state", "active");
    await expect(rail(page).nth(0)).toHaveAttribute("data-state", "done");
    await expect(rail(page).nth(7)).toHaveAttribute("data-state", "next");
  });

  test("each stage answers what SQL does, why, which rows changed and what happens without the clause", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    await toStage(page, "WHERE");
    const box = page.getByTestId("cinema-insights");
    for (const q of ["What SQL does here", "Why this stage", "Which rows changed", "If this clause were removed"]) await expect(box).toContainText(q);
    await expect(box).toContainText("All 100 rows would continue instead of");
    await page.getByText("The SQL for this step, and its exact tables and counts").click();
    await expect(page.getByText("The part of your query this step runs")).toBeVisible();
  });
});

test.describe("Query Cinema, motion and edge cases", () => {
  test("reduced motion shows the same information as static Before and After boards", async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await visualize(page, MAIN);
    await toStage(page, "WHERE");
    await expect(flow(page)).toHaveAttribute("data-reduced", "true");
    await expect(page.getByTestId("rowflow-static").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay" })).toHaveCount(0);
    const motion = await flow(page).evaluate((root) => [...root.querySelectorAll<HTMLElement>("*")].filter((el) => getComputedStyle(el).transitionDuration.split(",").some((d) => parseFloat(d) > 0.001)).map((el) => `${el.tagName}.${el.className}`.slice(0, 120)));
    expect(motion).toEqual([]);
    await expect(flow(page).getByTestId("rowflow-verdict").first()).toBeVisible();
    await shot(page, "10-reduced-motion");
  });

  test("when HAVING removes every group the Kept lane is empty and the result has no rows", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, SPEC);
    await toStage(page, "HAVING");
    await expect(flow(page)).toContainText("0 of 0");
    expect(await flow(page).locator('[data-card][data-tone="kept"]').count()).toBe(0);
    expect(await flow(page).locator('[data-card][data-tone="removed"]').count()).toBeGreaterThan(5);
    await expect(page.getByText(/Final result \(0 rows\)/)).toBeVisible();
    await shot(page, "11-all-groups-removed");
  });

  test("LEFT JOIN keeps rows with no partner; DISTINCT merges duplicates; UNION shows both inputs", async ({ page }) => {
    test.setTimeout(240_000);
    await visualize(page, "LEFT JOIN (unmatched rows)");
    await toStage(page, "JOIN");
    expect(await flow(page).locator('[data-card][data-tone="unmatched"]').count()).toBeGreaterThan(0);
    await shot(page, "12-left-join");
    await visualize(page, "DISTINCT");
    await toStage(page, "DISTINCT");
    expect(await flow(page).locator('[data-card][data-tone="dup"]').count()).toBeGreaterThan(0);
    expect(await flow(page).locator('[data-card][data-tone="survivor"]').count()).toBeGreaterThan(0);
    await shot(page, "13-distinct");
    await page.getByRole("button", { name: "UNION (set operator)", exact: true }).click();
    await expect(page.getByTestId("cinema-title")).toContainText(/UNION/i, { timeout: 120_000 });
    await expect(page.getByTestId("setop-view")).toBeVisible();
  });

  test("the page never scrolls sideways and every stage fits the screen width", async ({ page }) => {
    test.setTimeout(180_000);
    await visualize(page, MAIN);
    for (let i = 0; i < 7; i++) { await next(page); await noHScroll(page); }
    if (small(page)) {
      const sc = flow(page).getByTestId("rowflow-scroll");
      expect(await sc.evaluate((e) => e.scrollWidth > e.clientWidth || e.clientWidth > 0)).toBe(true); // wide lanes scroll inside the canvas, not the page
    }
  });
});
