import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";

/**
 * The pandas story on /visual/data, in a real browser with real Pyodide and pandas: the brief's filter example
 *   df = pd.DataFrame({"name": ["A","B","C","D"], "salary": [30000, 60000, 45000, 80000]}); result = df[df["salary"] > 50000]
 * is played one beat at a time on desktop and on a 390 x 844 phone. At every step the highlighted source line, the picture, the
 * four-part story and the step counter must agree. Previous restores exactly what Next showed, Play then Pause works, a groupby and a
 * merge play their own beats, and the page never scrolls sideways. With STORY_SHOTS=1 one screenshot per step is saved to
 * docs/images/viz-quality/pandas/.
 */
// Monaco rejects an internal promise with "Canceled" when an editor is disposed mid-request. It is not an app error.
test.beforeEach(async ({ page }) => { page.on("pageerror", (e) => { if (e.message !== "Canceled") throw new Error(`page error: ${e.message}`); }); });
test.describe.configure({ timeout: 300_000 });
test.beforeEach(() => { test.setTimeout(300_000); });

const CODE = "import pandas as pd\ndf = pd.DataFrame({\"name\": [\"A\", \"B\", \"C\", \"D\"], \"salary\": [30000, 60000, 45000, 80000]})\nresult = df[df[\"salary\"] > 50000]\n";

interface Step { line: number; slug: string; view: string | null; what: RegExp; id: string }
const STEPS: Step[] = [
  { line: 2, slug: "create-dataframe", view: null, what: /Creates a DataFrame of shape \(4, 2\)/, id: "0.0" },
  { line: 3, slug: "1-input-dataframe", view: "flow", what: /The input has 4 rows and 2 columns \(name, salary\)/, id: "1.0" },
  { line: 3, slug: "2-evaluate-condition", view: "calc", what: /Evaluates df\["salary"\] > 50000 once for every row/, id: "1.1" },
  { line: 3, slug: "3-classify-rows", view: "flow", what: /Each row is marked: True means keep it, False means drop it/, id: "1.2" },
  { line: 3, slug: "4-filter-rows", view: "flow", what: /The rows that fail fade out and the kept rows move into the result/, id: "1.3" },
  { line: 3, slug: "5-result", view: "flow", what: /The result is a new DataFrame with 2 rows: rows 1, 3/, id: "1.4" },
];

const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
const bar = (page: Page) => page.getByRole("group", { name: "Playback controls" });
const stepOf = async (page: Page) => Number(/Step (\d+) of/.exec((await bar(page).getByRole("status").textContent()) ?? "")?.[1] ?? 0);
const totalOf = async (page: Page) => Number(/of (\d+)/.exec((await bar(page).getByRole("status").textContent()) ?? "")?.[1] ?? 0);
const setCode = (page: Page, code: string) =>
  page.evaluate((c) => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue(c), code);

async function openAndExplain(page: Page, code: string, last: string) {
  await page.goto("/visual/data");
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText(/\S/, { timeout: 30_000 }); // the editor has rendered text
  await setCode(page, code);
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText(last, { timeout: 30_000 });
  await page.getByRole("button", { name: "Explain visually" }).click();
  await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 240_000 });
  await expect(bar(page)).toBeVisible();
}

/** What the screen shows at this step, so Previous can be compared with what Next showed. */
async function snapshot(page: Page) {
  const pic = page.getByTestId("beat-picture");
  return {
    line: await page.getByRole("list", { name: "Source code" }).locator("[aria-current]").evaluate((li) => Number(/^\d+/.exec(li.textContent ?? "")?.[0])),
    story: await page.getByTestId("step-story").innerText(),
    type: (await pic.count()) ? await pic.getAttribute("data-beat-type") : null,
    picture: (await pic.count()) ? await pic.innerText() : null,
    cards: (await pic.count()) ? await pic.locator("[data-card]:not([aria-hidden])").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-card")}:${e.getAttribute("data-lane")}:${e.getAttribute("data-tone")}:${e.getAttribute("data-faded") ?? ""}`)) : [],
  };
}

test("the brief's filter example, step by step: code, picture, story and counter agree", async ({ page }, info) => {
  await openAndExplain(page, CODE, "> 50000");
  const shots = process.env.STORY_SHOTS === "1";
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/images/viz-quality/pandas");
  if (shots) mkdirSync(dir, { recursive: true });
  const seen: Awaited<ReturnType<typeof snapshot>>[] = [];
  const next = page.getByRole("button", { name: "Next step" });
  const story = page.getByTestId("step-story");
  const pic = page.getByTestId("beat-picture");
  expect(await totalOf(page)).toBe(STEPS.length);

  for (let n = 0; n < STEPS.length; n++) {
    const e = STEPS[n];
    expect(await stepOf(page), `player step before checking ${e.slug}`).toBe(n + 1);
    // code highlight, story counter and the four parts; the "what" card is the one live region
    await expect(page.getByRole("list", { name: "Source code" }).locator("[aria-current]")).toContainText(String(e.line));
    await expect(story).toContainText(`Step ${n + 1} of ${STEPS.length}`);
    await expect(story).toHaveAttribute("data-step-key", e.id);
    await expect(story.locator("[data-story='what'] dd")).toHaveText(e.what);
    for (const k of ["what", "changed", "why", "remember"]) expect((await story.locator(`[data-story='${k}'] dd`).innerText()).trim().length).toBeGreaterThan(10);
    await expect(story.locator("[aria-live]")).toHaveCount(1);
    // the picture belongs to this beat
    if (e.view === null) await expect(pic).toHaveCount(0);
    else await expect(pic).toHaveAttribute("data-beat-type", e.view);
    const card = (label: string) => pic.locator(`[data-card='${label}']`);
    switch (n) {
      case 1: // input DataFrame: all four rows, nothing decided yet
        await expect(pic.locator("[data-card]")).toHaveCount(4);
        await expect(pic.locator("[data-card][data-tone='normal']")).toHaveCount(4);
        await expect(card("1")).toContainText("60000");
        await expect(pic.locator("[data-testid='flow-verdict']")).toHaveCount(0);
        break;
      case 2: // the condition evaluated per row: operands and a verdict chip each
        await expect(pic.getByTestId("calc-row")).toHaveCount(4);
        expect(await pic.getByTestId("calc-row").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-verdict")))).toEqual(["false", "true", "false", "true"]);
        await expect(pic.getByTestId("calc-row").nth(0)).toContainText("30000 > 50000");
        await expect(pic.getByTestId("calc-row").nth(1)).toContainText("60000 > 50000");
        break;
      case 3: // classification: kept / removed with words and glyphs, nothing has moved
        expect(await pic.locator("[data-card]").evaluateAll((els) => els.map((x) => x.getAttribute("data-tone")))).toEqual(["removed", "kept", "removed", "kept"]);
        await expect(pic.locator("[data-card][data-lane='1']")).toHaveCount(0);
        await expect(pic.getByTestId("flow-verdict")).toHaveText(["✕ False", "✓ True", "✕ False", "✓ True"]);
        break;
      case 4: { // filtering: the kept rows travel into the result lane, the removed rows stay and fade
        await expect(pic.locator("[data-card][data-lane='1']")).toHaveCount(2);
        await expect(pic.locator("[data-card][data-faded='true']")).toHaveCount(2);
        await expect(card("1")).toHaveAttribute("data-lane", "1");
        await expect(card("0")).toHaveAttribute("data-faded", "true");
        // after the move has settled the kept card sits to the right of the removed one (a real transform, not only a class)
        await expect.poll(async () => (await card("1").boundingBox())!.x > (await card("0").boundingBox())!.x + 20, { timeout: 5000 }).toBe(true);
        await expect.poll(async () => Number(await card("0").evaluate((el) => getComputedStyle(el).opacity)), { timeout: 5000 }).toBeLessThan(0.9);
        break;
      }
      case 5: // the real result
        await expect(pic.getByRole("table", { name: /Result: 2 rows/ }).locator("tbody tr")).toHaveCount(2);
        await expect(pic.getByRole("table", { name: /Result: 2 rows/ })).toContainText("80000");
        await expect(pic.getByTestId("flow-reasons")).toContainText("Row 0: 30000 > 50000 is False → removed");
        await expect(pic.getByTestId("flow-reasons")).toContainText("Row 3: 80000 > 50000 is True → kept");
        break;
    }
    // the story and the picture come before the full stage details (code, shapes, every table)
    if (e.view) {
      const top = (id: string) => page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      expect(await top("step-story")).toBeLessThan(await top("beat-picture"));
      expect(await top("beat-picture")).toBeLessThan(await top("stage-details"));
    }
    await noHScroll(page);
    seen.push(await snapshot(page));
    if (shots) {
      await page.waitForTimeout(700); // let the move settle so the shot shows the beat, not the middle of it
      // the visualizer block: step heading, the four-part story, the picture and the collapsed stage details
      await page.locator("[data-data-visualizer]").screenshot({ path: path.join(dir, `${String(n + 1).padStart(2, "0")}-${e.slug}${info.project.name === "mobile" ? "-mobile" : ""}.png`) });
    }
    if (n < STEPS.length - 1) await next.click();
  }
  await expect(next).toBeDisabled();

  // Previous restores exactly what Next showed
  const prev = page.getByRole("button", { name: "Previous step" });
  for (let n = STEPS.length - 2; n >= 0; n--) {
    await prev.click();
    expect(await stepOf(page)).toBe(n + 1);
    await page.waitForTimeout(450);
    expect(await snapshot(page), `after Previous at step ${n + 1}`).toEqual(seen[n]);
  }
  // Restart goes back to the first step, and Next walks to the same beats again
  await next.click(); await next.click(); await next.click();
  await bar(page).getByRole("button", { name: "Restart" }).click();
  expect(await stepOf(page)).toBe(1);
  expect(await snapshot(page)).toEqual(seen[0]);
  for (let k = 0; k < 4; k++) await next.click();
  await page.waitForTimeout(450);
  expect(await snapshot(page)).toEqual(seen[4]);
});

test("Play advances through the beats and Pause stops it", async ({ page }) => {
  await openAndExplain(page, CODE, "> 50000");
  expect(await stepOf(page)).toBe(1);
  await bar(page).getByRole("button", { name: "Play" }).click();
  await expect.poll(() => stepOf(page), { timeout: 30_000 }).toBeGreaterThan(1);
  await bar(page).getByRole("button", { name: "Pause" }).click();
  const at = await stepOf(page);
  await page.waitForTimeout(2500);
  expect(await stepOf(page)).toBe(at);
  // picture, code and story still agree after the run of playback
  await expect(page.getByTestId("step-story")).toHaveAttribute("data-step-key", STEPS[at - 1].id);
  await expect(page.getByRole("list", { name: "Source code" }).locator("[aria-current]")).toContainText(String(STEPS[at - 1].line));
  if (STEPS[at - 1].view) await expect(page.getByTestId("beat-picture")).toHaveAttribute("data-beat-type", STEPS[at - 1].view!);
  await noHScroll(page);
});

test("groupby then sum, and a merge, play their own beats with real rows and keys", async ({ page }) => {
  const prog = "import pandas as pd\ndf = pd.DataFrame({\"k\": [\"a\", \"b\", \"a\", \"b\", \"c\"], \"v\": [1, 2, 3, 4, 5]})\nt = df.groupby(\"k\")[\"v\"].sum()\nu = pd.DataFrame({\"id\": [1, 2, 3], \"x\": [\"p\", \"q\", \"r\"]})\nw = pd.DataFrame({\"id\": [2, 3, 4], \"y\": [10, 20, 40]})\nm = u.merge(w, on=\"id\", how=\"outer\")\n";
  await openAndExplain(page, prog, "how=\"outer\"");
  const next = page.getByRole("button", { name: "Next step" });
  const story = page.getByTestId("step-story");
  const pic = page.getByTestId("beat-picture");
  const goTo = async (id: string) => { for (let i = 0; i < 40; i++) { if ((await story.getAttribute("data-step-key")) === id) return; await next.click(); } throw new Error(`never reached beat ${id}`); };
  // the groupby: rows coloured by key, then gathered into groups
  await goTo("1.1");
  await expect(pic.locator("[data-card][data-group]:not([aria-hidden])")).toHaveCount(5);
  expect(await pic.locator("[data-card]:not([aria-hidden])").evaluateAll((els) => els.map((x) => x.getAttribute("data-group")))).toEqual(["0", "1", "0", "1", "2"]);
  await goTo("1.2");
  await expect(pic.locator("[data-card][data-lane='1']:not([aria-hidden])")).toHaveCount(8); // 5 rows and 3 group headers
  // the aggregation: each group's calculation, then the result
  const sumStage = 3; // stages: 0 df, 1 groupby, 2 ["v"], 3 sum, 4 u, 5 w, 6 merge
  await goTo(`${sumStage}.1`);
  await expect(pic.getByTestId("group-calc")).toHaveText(["sum(1, 3) = 4", "sum(2, 4) = 6", "sum(5) = 5"]);
  await goTo(`${sumStage}.2`);
  await expect(pic.getByRole("table", { name: /Result: one row per group/ }).locator("tbody tr")).toHaveCount(3);
  // the merge: the key links, then the result with its origin
  const mergeStage = 6;
  await goTo(`${mergeStage}.1`);
  await expect(pic.locator("[data-testid='flow-links'] [data-link='on']")).toHaveCount(2);
  await expect(pic.locator("[data-card][data-tone='unmatched']")).toHaveCount(2);
  await goTo(`${mergeStage}.3`);
  await expect(pic.getByRole("table", { name: /Result: merged, 4 rows/ })).toContainText("left only");
  await expect(pic.getByRole("table", { name: /Result: merged, 4 rows/ })).toContainText("right only");
  await noHScroll(page);
  expect(await totalOf(page)).toBeGreaterThan(10);
});

test("the same five beats play in the exercise workspace, driven by its own player", async ({ page }) => {
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  await page.goto("/workspace");
  const href = await page.getByRole("list", { name: "Starter exercises" }).getByRole("link").nth(2).getAttribute("href");
  await page.goto(`/workspace?e=${encodeURIComponent(new URL(href!, "http://x").searchParams.get("e")!)}`);
  await expect(page.getByTestId("exercise-workspace")).toBeVisible({ timeout: 60_000 });
  if (phone) await page.getByRole("tab", { name: "Editor" }).click();
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
  await setCode(page, CODE);
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText("> 50000", { timeout: 30_000 });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  if (phone) await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByTestId("workspace-results")).toContainText("80000", { timeout: 120_000 });
  await page.getByRole("button", { name: "Visualize" }).click();
  if (phone) await page.getByRole("tab", { name: "Visualization" }).click();
  const box = page.getByTestId("visualizer-box");
  await expect(box).toContainText("Stage 1 of 2", { timeout: 120_000 });
  const next = page.getByRole("button", { name: "Next step" });
  const story = box.getByTestId("step-story");
  const pic = box.getByTestId("beat-picture");
  const seen: string[] = [];
  for (let n = 1; n <= 5; n++) {
    await next.click();
    await expect(story).toHaveAttribute("data-step-key", `1.${n - 1}`);
    await expect(box).toContainText(`part ${n} of 5`);
    await expect(pic).toHaveAttribute("data-beat-type", ["flow", "calc", "flow", "flow", "flow"][n - 1]);
    seen.push(await story.innerText());
  }
  await expect(pic.getByRole("table", { name: /Result: 2 rows/ }).locator("tbody tr")).toHaveCount(2);
  expect(new Set(seen).size).toBe(5);
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(story).toHaveAttribute("data-step-key", "1.3");
  await expect(pic.locator("[data-card][data-faded='true']")).toHaveCount(2);
  await noHScroll(page);
});
