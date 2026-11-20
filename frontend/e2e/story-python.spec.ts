import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";

/**
 * The Python story in the workspace, in a real browser with real Pyodide: the brief's prices / total example is played one step at a
 * time on desktop and on a 390 x 844 phone. At every step the highlighted source line, the variable inspector, the picture (calculation,
 * list with the current element, output) and the four-part story must agree with each other. Previous restores, Play then Pause works,
 * and the page never scrolls sideways. With STORY_SHOTS=1 one screenshot per step is saved to docs/images/viz-quality/python/.
 */
// Monaco rejects an internal promise with "Canceled" when an editor is disposed mid-request. It is not an app error.
test.beforeEach(async ({ page }) => { page.on("pageerror", (e) => { if (e.message !== "Canceled") throw new Error(`page error: ${e.message}`); }); });
test.describe.configure({ timeout: 300_000 });

const CODE = "prices = [100, 200, 300]\ntotal = 0\nfor price in prices:\n    total += price\nprint(total)\n";

interface Expect { line: number; slug: string; total?: string; calc?: string; index?: number; loop?: "taking" | "running" | "finished"; output?: string; what: RegExp }
const STEPS: Expect[] = [
  { line: 1, slug: "create-list", what: /prices = \[100, 200, 300\]/ },
  { line: 2, slug: "create-total", what: /total = 0/ },
  { line: 3, slug: "loop-begins-item-0", total: "0", index: 0, loop: "taking", what: /Loop check 1/ },
  { line: 4, slug: "add-100", total: "0", calc: "0 + 100 = 100", index: 0, loop: "running", what: /Iteration 1 of 3/ },
  { line: 3, slug: "loop-item-1", total: "100", index: 1, loop: "taking", what: /Loop check 2/ },
  { line: 4, slug: "add-200", total: "100", calc: "100 + 200 = 300", index: 1, loop: "running", what: /Iteration 2 of 3/ },
  { line: 3, slug: "loop-item-2", total: "300", index: 2, loop: "taking", what: /Loop check 3/ },
  { line: 4, slug: "add-300", total: "300", calc: "300 + 300 = 600", index: 2, loop: "running", what: /Iteration 3 of 3/ },
  { line: 3, slug: "loop-ends", total: "600", loop: "finished", what: /finds no items left/ },
  { line: 5, slug: "print-total", total: "600", output: "600", what: /print\(total\)/ },
  { line: 5, slug: "program-finishes", total: "600", output: "600", what: /The program finishes/ },
];

const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
const bar = (page: Page) => page.getByRole("group", { name: "Playback controls" });
const stepOf = async (page: Page) => Number(/Step (\d+) of/.exec((await bar(page).getByRole("status").textContent()) ?? "")?.[1] ?? 0);
const setCode = (page: Page, code: string) =>
  page.evaluate((c) => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue(c), code);
const tab = async (page: Page, isMobile: boolean, name: string) => { if (isMobile) await page.getByRole("tab", { name }).click(); };

// Firefox's touch profile is not "isMobile": the phone layout (tabs) is decided from the viewport width, like the app does.
const phone = (page: Page, isMobile: boolean) => isMobile || (page.viewportSize()?.width ?? 1440) < 768;

async function openAndVisualize(page: Page, isMobile: boolean) {
  await page.goto(`/workspace?e=${encodeURIComponent("py:cart-line-total")}`);
  await expect(page.getByTestId("exercise-workspace")).toBeVisible({ timeout: 60_000 });
  if (isMobile) await page.getByRole("tab", { name: "Editor" }).click();
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText(/\S/, { timeout: 30_000 }); // the editor has rendered text
  await setCode(page, CODE);
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText("prices = [100, 200, 300]", { timeout: 30_000 });
  await page.getByRole("button", { name: "Visualize" }).click();
  await tab(page, isMobile, "Visualization");
  await expect(page.getByTestId("python-visualizer")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("py-story-block")).toBeVisible();
}

/** What the screen shows at this step, so Previous can be compared with what Next showed. */
async function snapshot(page: Page) {
  const box = page.getByTestId("python-visualizer");
  return {
    line: await box.locator("li[data-mark='now']").evaluate((li) => Number(/^\d+/.exec(li.textContent ?? "")?.[0])),
    story: await page.getByTestId("step-story").innerText(),
    calc: (await page.getByTestId("py-calc").count()) ? await page.getByTestId("py-calc").getAttribute("data-formula") : null,
    inspector: await page.getByLabel("Variable inspector").innerText(),
  };
}

test("the prices / total example, step by step: code, inspector, picture and story agree", async ({ page, isMobile }, info) => {
  await openAndVisualize(page, phone(page, !!isMobile));
  const shots = process.env.STORY_SHOTS === "1";
  const dir = path.resolve(process.cwd(), "../docs/images/viz-quality/python") // the specs run from frontend/;
  if (shots) mkdirSync(dir, { recursive: true });
  const seen: Awaited<ReturnType<typeof snapshot>>[] = [];
  const box = page.getByTestId("python-visualizer");
  const next = page.getByRole("button", { name: "Next step" });

  for (let n = 0; n < STEPS.length; n++) {
    const e = STEPS[n];
    expect(await stepOf(page), `player step before checking ${e.slug}`).toBe(n + 1);
    // code highlight
    await expect(box.locator("li[data-mark='now']")).toContainText(String(e.line));
    expect(await box.locator("li[data-mark='now']").count()).toBe(1);
    // story: step counter, the four parts, the "what" card is the live region
    const story = page.getByTestId("step-story");
    await expect(story).toContainText(`Step ${n + 1} of ${STEPS.length}`);
    await expect(story.locator("[data-story='what'] dd")).toHaveText(e.what);
    for (const k of ["what", "changed", "why", "remember"]) expect((await story.locator(`[data-story='${k}'] dd`).innerText()).trim().length).toBeGreaterThan(10);
    await expect(story.locator("[aria-live]")).toHaveCount(1);
    // calculation
    if (e.calc) {
      await expect(page.getByTestId("py-calc")).toHaveText(e.calc);
      await expect(story.locator("[data-story='changed'] dd")).toContainText(e.calc);
    } else await expect(page.getByTestId("py-calc")).toHaveCount(0);
    // inspector: the row of `total` shows the recorded value, and nothing is shown before total exists
    const inspector = page.getByLabel("Variable inspector");
    if (e.total !== undefined) await expect(inspector.locator("tr", { has: page.locator("code", { hasText: /^total$/ }) }).locator("td").nth(1)).toHaveText(e.total);
    else await expect(inspector.locator("tr", { has: page.locator("code", { hasText: /^total$/ }) })).toHaveCount(0);
    // the list and its current element
    if (e.loop) {
      await expect(page.getByTestId("py-loop")).toHaveAttribute("data-state", e.loop);
      const current = page.getByTestId("py-list").locator("li[data-state='current']");
      if (e.index !== undefined) {
        await expect(current).toHaveCount(1);
        await expect(current).toContainText(["100", "200", "300"][e.index]);
        await expect(page.getByTestId("py-loop")).toHaveAttribute("data-index", String(e.index));
      } else await expect(current).toHaveCount(0);
    }
    // output
    if (e.output && e.slug === "print-total") {
      await expect(page.getByTestId("py-output-new")).toHaveText(e.output);
      await expect(story.locator("[data-story='why'] dd")).toContainText("0 → 100 → 300 → 600");
    }
    // the story and the picture come before the code and the table
    const top = (id: string) => page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const storyTop = await top("step-story");
    const codeTop = await box.getByLabel("Source code").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(storyTop).toBeLessThan(codeTop);
    await noHScroll(page);
    seen.push(await snapshot(page));
    if (shots) {
      // The picture is the story: show the whole visualization (the box is normally height-limited and scrolls) with the player under it.
      await page.getByTestId("visualizer-box").evaluate((el) => { el.scrollTop = 0; el.style.maxHeight = "none"; });
      await page.getByTestId("workspace-visual").screenshot({ path: path.join(dir, `${String(n + 1).padStart(2, "0")}-${e.slug}${info.project.name === "mobile" ? "-mobile" : ""}.png`) });
      await page.getByTestId("visualizer-box").evaluate((el) => { el.style.maxHeight = ""; });
    }
    if (n < STEPS.length - 1) await next.click();
  }
  await expect(next).toBeDisabled();

  // Previous restores exactly what Next showed
  const prev = page.getByRole("button", { name: "Previous step" });
  for (let n = STEPS.length - 2; n >= 0; n--) {
    await prev.click();
    expect(await stepOf(page)).toBe(n + 1);
    expect(await snapshot(page), `after Previous at step ${n + 1}`).toEqual(seen[n]);
  }
  // Restart goes back to the first step
  await next.click(); await next.click(); await next.click();
  await bar(page).getByRole("button", { name: "Restart" }).click();
  expect(await stepOf(page)).toBe(1);
  expect(await snapshot(page)).toEqual(seen[0]);
});

test("Play advances through the story and Pause stops it", async ({ page, isMobile }) => {
  await openAndVisualize(page, phone(page, !!isMobile));
  expect(await stepOf(page)).toBe(1);
  await bar(page).getByRole("button", { name: "Play" }).click();
  await expect.poll(() => stepOf(page), { timeout: 30_000 }).toBeGreaterThan(1);
  await bar(page).getByRole("button", { name: "Pause" }).click();
  const at = await stepOf(page);
  await page.waitForTimeout(2500);
  expect(await stepOf(page)).toBe(at);
  // code, calculation and story still agree after the run of playback
  const line = Number(/^\d+/.exec((await page.getByTestId("python-visualizer").locator("li[data-mark='now']").textContent()) ?? "")?.[0]);
  expect(line).toBe(STEPS[at - 1].line);
  await expect(page.getByTestId("step-story")).toContainText(`Step ${at} of ${STEPS.length}`);
  await noHScroll(page);
});
