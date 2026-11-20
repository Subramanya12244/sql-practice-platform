import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";

/**
 * The NumPy story on /visual/data, in a real browser with real Pyodide: the brief's broadcasting example
 *   a = [[1],[2],[3]]; b = [10, 20, 30]; result = a + b
 * is played one beat at a time on desktop and on a 390 x 844 phone. At every step the highlighted source line, the picture, the four-part
 * story and the step counter must agree. Previous restores exactly what Next showed, Play then Pause works, an invalid broadcast opens on
 * the failing stage with NumPy's own error text, and the page never scrolls sideways. With STORY_SHOTS=1 one screenshot per step is saved
 * to docs/images/viz-quality/numpy/.
 */
// Monaco rejects an internal promise with "Canceled" when an editor is disposed mid-request. It is not an app error.
test.beforeEach(async ({ page }) => { page.on("pageerror", (e) => { if (e.message !== "Canceled") throw new Error(`page error: ${e.message}`); }); });
test.describe.configure({ timeout: 300_000 });

const CODE = "import numpy as np\na = np.array([[1], [2], [3]])\nb = np.array([10, 20, 30])\nresult = a + b\n";
const BAD = "import numpy as np\na = np.ones((3, 2))\nb = np.ones((4, 2))\nresult = a + b\n";

interface Step { line: number; slug: string; view: string | null; what: RegExp; id: string }
const STEPS: Step[] = [
  { line: 2, slug: "create-a", view: null, what: /Creates an array: shape \(3,1\)/, id: "0.0" },
  { line: 3, slug: "create-b", view: null, what: /Creates an array: shape \(3,\)/, id: "1.0" },
  { line: 4, slug: "arrays", view: "arrays", what: /here are its two real operands: A is an array of shape \(3, 1\) and B is an array of shape \(3,\)/, id: "2.0" },
  { line: 4, slug: "shapes", view: "shapes", what: /^A has shape \(3, 1\) and B has shape \(3,\)\.$/, id: "2.1" },
  { line: 4, slug: "align-right-to-left", view: "align", what: /Line the shapes up from the right: B \(3,\) is treated as \(1, 3\)/, id: "2.2" },
  { line: 4, slug: "stretch-to-3x3", view: "expand", what: /stretches the arrays to the common shape \(3, 3\)/, id: "2.3" },
  { line: 4, slug: "calculate-each-cell", view: "compute", what: /Apply \+ to every pair of cells/, id: "2.4" },
  { line: 4, slug: "result", view: "result", what: /The result is the \(3, 3\) array stored in result/, id: "2.5" },
];

const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
const bar = (page: Page) => page.getByRole("group", { name: "Playback controls" });
const stepOf = async (page: Page) => Number(/Step (\d+) of/.exec((await bar(page).getByRole("status").textContent()) ?? "")?.[1] ?? 0);
const totalOf = async (page: Page) => Number(/of (\d+)/.exec((await bar(page).getByRole("status").textContent()) ?? "")?.[1] ?? 0);
const setCode = (page: Page, code: string) =>
  page.evaluate((c) => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue(c), code);

async function openAndExplain(page: Page, code: string) {
  await page.goto("/visual/data?preset=numpy-broadcasting");
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText(/\S/, { timeout: 30_000 }); // the editor has rendered text
  await setCode(page, code);
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText("result = a + b", { timeout: 30_000 });
  await page.getByRole("button", { name: "Explain visually" }).click();
  await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 240_000 });
  await expect(bar(page)).toBeVisible();
}

/** What the screen shows at this step, so Previous can be compared with what Next showed. */
async function snapshot(page: Page) {
  const pic = page.getByTestId("np-picture");
  return {
    line: await page.getByRole("list", { name: "Source code" }).locator("[aria-current]").evaluate((li) => Number(/^\d+/.exec(li.textContent ?? "")?.[0])),
    story: await page.getByTestId("step-story").innerText(),
    picture: (await pic.count()) ? await pic.innerText() : null,
    view: (await pic.count()) ? await pic.getAttribute("data-np-view") : null,
  };
}

test("the brief's example, step by step: code, picture, story and counter agree", async ({ page, isMobile }, info) => {
  await openAndExplain(page, CODE);
  const shots = process.env.STORY_SHOTS === "1";
  const dir = path.resolve(process.cwd(), "../docs/images/viz-quality/numpy");
  if (shots) mkdirSync(dir, { recursive: true });
  const seen: Awaited<ReturnType<typeof snapshot>>[] = [];
  const next = page.getByRole("button", { name: "Next step" });
  const story = page.getByTestId("step-story");
  const pic = page.getByTestId("np-picture");
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
    else {
      await expect(pic).toHaveAttribute("data-np-view", e.view);
      await expect(page.getByTestId("beat-picture")).toHaveAttribute("data-beat-type", e.view);
    }
    switch (e.view) {
      case "arrays":
        await expect(pic.locator("[data-np-operand='A'] td")).toHaveText(["1", "2", "3"]);
        await expect(pic.locator("[data-np-operand='B'] td")).toHaveText(["10", "20", "30"]);
        break;
      case "shapes":
        await expect(pic.locator("[data-np-shape-text]")).toHaveText(["(3, 1)", "(3,)"]);
        break;
      case "align":
        await expect(pic.locator("th[data-np-axis]")).toHaveText([/axis -2/, /axis -1.*checked 1st/]);
        await expect(pic.locator("td[data-status='missing']")).toHaveCount(1);
        await expect(pic.locator("[data-np-verdict]")).toContainText("(3,3)");
        break;
      case "expand":
        await expect(pic.locator("[data-np-expanded='A'] td")).toHaveCount(9);
        await expect(pic.locator("td[data-tone='repeat']")).toHaveCount(12);
        break;
      case "compute":
        await expect(pic.locator("[data-np-calc]")).toHaveCount(9);
        await expect(pic.locator("[data-np-calc='0,0']")).toContainText("1 + 10");
        await expect(pic.locator("[data-np-calc='0,0']")).toContainText("= 11");
        await expect(pic.locator("[data-np-calc='2,2']")).toContainText("3 + 30");
        await expect(pic.locator("[data-np-calc='2,2']")).toContainText("= 33");
        await expect(story.locator("[data-story='changed'] dd")).toContainText("1 + 10 = 11");
        break;
      case "result":
        await expect(pic.locator("tbody td")).toHaveText(["11", "21", "31", "12", "22", "32", "13", "23", "33"]);
        await expect(pic.locator("[data-np-result-shape]")).toHaveText("(3, 3)");
        break;
    }
    // the story and the picture come before the full stage details (code, shapes, every table)
    if (e.view) {
      const top = (id: string) => page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      expect(await top("step-story")).toBeLessThan(await top("np-picture"));
      expect(await top("np-picture")).toBeLessThan(await top("stage-details"));
    }
    await noHScroll(page);
    seen.push(await snapshot(page));
    if (shots) {
      await page.locator("[data-data-visualizer]").evaluate((el) => { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -80); }); // the story and the picture, not the page header
      await page.screenshot({ path: path.join(dir, `${String(n + 1).padStart(2, "0")}-${e.slug}${info.project.name === "mobile" ? "-mobile" : ""}.png`), fullPage: false });
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
  // Restart goes back to the first step, and Next walks to the same beats again
  await next.click(); await next.click(); await next.click();
  await bar(page).getByRole("button", { name: "Restart" }).click();
  expect(await stepOf(page)).toBe(1);
  expect(await snapshot(page)).toEqual(seen[0]);
  for (let k = 0; k < 4; k++) await next.click();
  expect(await snapshot(page)).toEqual(seen[4]);
});

test("Play advances through the beats and Pause stops it", async ({ page }) => {
  await openAndExplain(page, CODE);
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
  if (STEPS[at - 1].view) await expect(page.getByTestId("np-picture")).toHaveAttribute("data-np-view", STEPS[at - 1].view!);
  await noHScroll(page);
});

test("an invalid broadcast opens on the failing stage: the conflicting axis and NumPy's real error", async ({ page }) => {
  await openAndExplain(page, BAD);
  // the player opens on the stage that raised: the last beat, NumPy's error
  await expect.poll(async () => (await stepOf(page)) === (await totalOf(page)) && (await totalOf(page)) === 6).toBe(true);
  const pic = page.getByTestId("np-picture");
  await expect(pic).toHaveAttribute("data-np-view", "error");
  await expect(page.getByTestId("np-error")).toContainText("ValueError: operands could not be broadcast together with shapes (3,2) (4,2)");
  await expect(page.getByTestId("np-error")).toContainText("axis -2: A has 3, B has 4");
  await expect(page.getByRole("list", { name: "Source code" }).locator("[aria-current]")).toContainText("result = a + b");
  await expect(page.getByTestId("step-story").locator("[data-story='what'] dd")).toContainText("ValueError");
  await expect(page.locator("[data-np-calc]")).toHaveCount(0);
  // one step back: the alignment with the conflicting axis marked in words
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(pic).toHaveAttribute("data-np-view", "align");
  await expect(pic.locator("td[data-status='incompatible']")).toHaveText([/^3/, /^4/]);
  await expect(page.getByTestId("step-story").locator("[data-story='what'] dd")).toContainText("axis -2 cannot match: A has 3 and B has 4, and neither is 1");
  await noHScroll(page);
});
