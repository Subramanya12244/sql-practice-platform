import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Daily Learning lessons with the unified exercise workspace embedded, in a real browser (desktop and phone). One SQL, one Python, one
 * Pandas and one NumPy lesson. Each opens its first guided exercise, checks that opening and visualizing record nothing, solves it with the
 * lesson's own reference answer (read from the lesson JSON), checks the pass is recorded exactly once and survives a reload, and that the
 * page never scrolls sideways and the console stays clean. Nothing is mocked: SQL runs on PGlite and Python on Pyodide.
 */
const LESSONS = [
  { domain: "SQL", id: "d031", n: 31 },
  { domain: "Python", id: "d001", n: 1 },
  { domain: "NumPy", id: "d063", n: 63 },
  { domain: "pandas", id: "d070", n: 70 },
] as const;

const exerciseOf = (id: string) => (JSON.parse(readFileSync(`src/site/content/daily/days/${id}.json`, "utf8")).guided as { id: string; solution: string; starter: string; kind: string }[])[0];

const progress = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("sqlp.public.progress") ?? "{}"));
const events = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("sqlp.activity.queue") ?? "[]") as { type: string; ref?: string; meta?: { passed?: boolean } }[]);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1);
// A tab switch on a phone remounts Monaco. Typing into the model in the first milliseconds can be lost, because the editor has not
// attached its change handler yet (a person cannot type that fast). Wait until the editor has drawn its text.
const setCode = async (page: Page, code: string) => {
  await expect(page.locator(".monaco-editor .view-lines").first()).not.toHaveText("", { timeout: 30_000 });
  await page.waitForTimeout(300);
  await setCodeNow(page, code);
};
const setCodeNow = (page: Page, code: string) => page.evaluate((c) => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue(c), code);
const getCode = (page: Page) => page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco.editor.getModels()[0].getValue());

async function guided(page: Page, n: number) {
  await page.goto(`/daily/day/${n}`);
  await page.getByRole("list", { name: "Lesson steps" }).getByRole("button").nth(2).click(); // Guided practice
  await expect(page.getByLabel(/^Exercise 1:/).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("Daily Learning: embedded exercise workspace", () => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  test.beforeEach(async ({ page }) => {
    problems.length = 0;
    page.on("pageerror", (e) => { if (e.message !== "Canceled") problems.push(`page error: ${e.message}`); }); // Monaco's internal cancellation, not an app error
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  });
  test.afterEach(() => { expect(problems).toEqual([]); });

  for (const L of LESSONS) {
    test(`${L.domain} (${L.id}): open and visualize record nothing; the reference answer passes once and survives a reload`, async ({ page, isMobile }) => {
      test.setTimeout(300_000);
      const ex = exerciseOf(L.id);
      expect(ex.id).toBe("g1");
      await guided(page, L.n);
      const card = page.getByLabel(/^Exercise 1:/).first();

      // Not opened yet: the prompt, an Open button, no editor and no engine.
      await expect(card.getByRole("button", { name: "Open the exercise" })).toBeVisible();
      await expect(page.locator(".monaco-editor")).toHaveCount(0);
      await card.getByRole("button", { name: "Open the exercise" }).click();
      const workspace = card.getByTestId("exercise-workspace");
      await expect(workspace).toBeVisible({ timeout: 60_000 });
      expect(await noOverflow(page)).toBe(true);
      if (isMobile) await workspace.getByRole("tab", { name: "Editor" }).click();
      await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
      await expect(card.getByTestId("daily-embedded-exercise")).toHaveAttribute("data-exercise-id", `daily:${L.id}#g1`);

      // Looking is free: run the starter and build the step view. Neither passes anything.
      await workspace.getByRole("button", { name: /^Run/ }).click();
      await expect(workspace.getByRole("button", { name: /^Run/ })).toBeEnabled({ timeout: 120_000 });
      await workspace.getByRole("button", { name: "Visualize", exact: true }).click();
      await expect(workspace.getByRole("button", { name: "Visualize", exact: true })).toBeEnabled({ timeout: 120_000 });
      let p = await progress(page);
      expect(p.daily?.days?.[L.id]?.passed ?? []).toEqual([]);
      expect(p.lessons?.[`daily:${L.id}#g1`]).toBeUndefined();
      expect((await events(page)).filter((e) => /_submitted$/.test(e.type))).toEqual([]);
      expect(await noOverflow(page)).toBe(true);

      // Solve it with the lesson's own reference answer.
      if (isMobile) await workspace.getByRole("tab", { name: "Editor" }).click();
      await setCode(page, ex.solution);
      await workspace.getByRole("button", { name: /^Submit/ }).click();
      await expect(workspace.getByText(/Correct\. All checks passed/)).toBeVisible({ timeout: 120_000 });
      await expect(card.getByText("Passed", { exact: true })).toBeVisible();
      p = await progress(page);
      expect(p.daily.days[L.id].passed).toEqual(["g1"]);
      expect(p.daily.days[L.id].attempted).toEqual(["g1"]);
      expect(p.lessons[`daily:${L.id}#g1`]).toBeTruthy();
      expect(p.mistakes?.[`daily:${L.id}#g1`]).toBeUndefined();
      const submitted = (await events(page)).filter((e) => /_submitted$/.test(e.type) && e.ref === `daily:${L.id}:g1`);
      expect(submitted).toHaveLength(1);
      expect(submitted[0].meta?.passed).toBe(true);
      expect(p.daily.days[L.id].completedAt).toBeUndefined(); // one exercise never completes the day
      expect(await noOverflow(page)).toBe(true);

      // Reload: the pass, the badge and the saved code are all still there, and the exercise opens by itself.
      await page.waitForTimeout(1200); // the draft is saved a moment after typing stops
      await page.reload();
      await page.getByRole("list", { name: "Lesson steps" }).getByRole("button").nth(2).click();
      const again = page.getByLabel(/^Exercise 1:/).first();
      await expect(again.getByText("Passed", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(again.getByTestId("exercise-workspace")).toBeVisible({ timeout: 60_000 });
      if (isMobile) await again.getByRole("tab", { name: "Editor" }).click();
      await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
      expect((await getCode(page)).trim()).toBe(ex.solution.trim());
      await expect(again.getByText("Your saved work was restored.")).toBeVisible();
      p = await progress(page);
      expect(p.daily.days[L.id].passed).toEqual(["g1"]);
      expect(await noOverflow(page)).toBe(true);
    });
  }

  test("a second exercise of the same lesson has its own state, and a written exercise keeps its own card", async ({ page, isMobile }) => {
    test.setTimeout(300_000);
    await guided(page, 1);
    const one = page.getByLabel(/^Exercise 1:/).first();
    const two = page.getByLabel(/^Exercise 2:/).first();
    await one.getByRole("button", { name: "Open the exercise" }).click();
    await two.getByRole("button", { name: "Open the exercise" }).click();
    await expect(page.getByTestId("exercise-workspace")).toHaveCount(2);
    await expect(one.getByText("Not started")).toBeVisible();
    await expect(two.getByText("Not started")).toBeVisible();
    await expect(page.getByTestId("daily-embedded-exercise").nth(1)).toHaveAttribute("data-exercise-id", "daily:d001#g2");
    await expect(page.getByTestId("daily-embedded-exercise").nth(2)).toHaveAttribute("data-exercise-id", "daily:d001#g3"); // not opened: only its prompt shows
    await expect(page.getByLabel(/^Exercise 3:/).first().getByTestId("exercise-workspace")).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    // Independent practice of a lesson that has a written exercise: the self-assessed card is untouched.
    await page.goto("/daily/day/22");
    await page.getByRole("list", { name: "Lesson steps" }).getByRole("button").nth(3).click();
    await expect(page.getByText("Self-assessed")).toBeVisible({ timeout: 30_000 });
    expect(await noOverflow(page)).toBe(true);
    void isMobile;
  });
});
