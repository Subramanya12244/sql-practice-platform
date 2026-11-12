import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Visual Learning Engine across browser engines. Runs unchanged in every Playwright project (desktop, mobile, and the opt-in
 * firefox-* / webkit-* projects, see playwright.config.ts). Results per engine are recorded in docs/VISUAL_BROWSER_MATRIX.md.
 * Group names in the test titles are the rows of that matrix. Pyodide and pandas downloads are slow: only the tests that need
 * them set a long timeout.
 */
test.beforeEach(async ({ page }) => { page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); }); });

const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
const bar = (page: Page) => page.getByRole("group", { name: "Playback controls" });
const status = (page: Page) => bar(page).getByRole("status");
const step = async (page: Page) => Number(/Step (\d+) of/.exec((await status(page).textContent()) ?? "")?.[1] ?? 0);
const total = async (page: Page) => Number(/of (\d+)/.exec((await status(page).textContent()) ?? "")?.[1] ?? 0);
const editor = async (p: Page, text: string) => { await p.locator(".monaco-editor").first().click(); await p.keyboard.press("ControlOrMeta+A"); await p.keyboard.insertText(text); };
const small = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

// ── SQL Query Cinema ─────────────────────────────────────────────────────
test.describe("SQL Query Cinema", () => {
  test("SQL Query Cinema: Visualize builds the stage player, Next step moves it, set operators show their branches", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/query-visualizer");
    await page.getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(bar(page)).toBeVisible({ timeout: 120_000 });
    expect(await step(page)).toBe(1);
    await page.getByRole("button", { name: "Next step" }).click();
    expect(await step(page)).toBe(2);
    await expect(page.getByTestId("rowflow").first()).toBeVisible();
    await noHScroll(page);
    await page.getByRole("button", { name: "UNION (set operator)" }).click();
    await page.getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(bar(page)).toBeVisible({ timeout: 60_000 });
    // Walk the stages until the set-operation view (both inputs, matches, removals, result) appears.
    const n = await total(page);
    let seen = false;
    for (let i = 0; i < n && !seen; i++) {
      seen = await page.getByTestId("setop-view").isVisible();
      if (!seen) await page.getByRole("button", { name: "Next step" }).click({ trial: false }).catch(() => undefined);
    }
    expect(seen, "a set-operation stage is shown for UNION").toBe(true);
    await expect(page.getByRole("region", { name: "Column compatibility" })).toBeVisible();
  });
});

// ── Python tracing in real Pyodide ───────────────────────────────────────
test.describe("Python tracing (real Pyodide)", () => {
  test("Python tracing: a real trace of a loop; End shows the finished state and the printed output", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/visual/python");
    await page.getByRole("button", { name: "Loop and total" }).click();
    await page.getByRole("button", { name: "Explain visually" }).click();
    await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 200_000 });
    await expect(status(page)).toHaveText(/Step 1 of/);
    await bar(page).focus();
    await page.keyboard.press("End");
    await expect(page.getByText("The program finished. These are the final values.")).toBeVisible();
    await expect(page.getByLabel("Program output")).toContainText("8");
    await page.getByRole("tab", { name: "Memory model" }).click();
    await expect(page.getByLabel("Memory model")).toBeVisible();
    await noHScroll(page);
  });
  test("Python tracing: an exception is reported with its type", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/visual/python");
    await page.getByRole("button", { name: "Exception" }).click();
    await page.getByRole("button", { name: "Explain visually" }).click();
    await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 200_000 });
    await bar(page).focus();
    await page.keyboard.press("End");
    await expect(page.getByText(/Stopped by IndexError/)).toBeVisible();
  });
});

// ── pandas and NumPy ─────────────────────────────────────────────────────
test.describe("Pandas visualization", () => {
  test("Pandas: real DataFrames as tables, changed cells highlighted", async ({ page }) => {
    test.setTimeout(420_000);
    await page.goto("/visual/data");
    await page.getByRole("button", { name: "Filter and sort" }).click();
    await page.getByRole("button", { name: "Explain visually" }).click();
    await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 380_000 });
    await bar(page).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Tables and arrays" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table", { name: /Current value|After|Before/ }).first()).toBeVisible();
    await expect(page.getByText(/shape \(/).first()).toBeVisible();
  });
});
test.describe("NumPy visualization", () => {
  test("NumPy: an array and its broadcast result as tables with shape and dtype", async ({ page }) => {
    test.setTimeout(420_000);
    await page.goto("/visual/data");
    await page.getByRole("button", { name: "NumPy broadcasting" }).click();
    await page.getByRole("button", { name: "Explain visually" }).click();
    await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 380_000 });
    await bar(page).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("table", { name: /Current value|After|Before/ }).first()).toBeVisible();
    await expect(page.getByText(/dtype int/).first()).toBeVisible();
  });
});

// ── API Studio, ETL, Charts ──────────────────────────────────────────────
test.describe("API Studio", () => {
  test("API Studio: pick a scenario, step, no horizontal scroll", async ({ page }) => {
    await page.goto("/visual/api");
    await page.getByRole("tab", { name: "404 Not Found" }).click();
    await expect(page.getByText(/Fetch order 999/).first()).toBeVisible();
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(status(page)).toHaveText(/Step 2 of/);
    await noHScroll(page);
  });
});
test.describe("ETL Playback", () => {
  test("ETL Playback: inject a failure and see the dead letter", async ({ page }) => {
    await page.goto("/visual/etl");
    await page.getByLabel("Inject a failure").selectOption("load-always-fails");
    await expect(page.locator("text=/dead-lettered/ >> visible=true").first()).toBeVisible(); // the closed Help also mentions it
    await page.getByRole("button", { name: "Next step" }).click();
    await noHScroll(page);
  });
});
test.describe("Chart Explorer", () => {
  test("Chart Explorer: change chart type and dimension, advice and numbers follow", async ({ page }) => {
    await page.goto("/visual/charts");
    await page.getByLabel("Chart type").selectOption("pie");
    await page.getByLabel("Dimension (group by)").selectOption("month");
    await expect(page.getByRole("list", { name: "Chart advice" })).toContainText("slices");
    await noHScroll(page);
  });
});

// ── The new pages ────────────────────────────────────────────────────────
type Probe = { path: string; title: string; interact: (page: Page) => Promise<void> };
const nextStepWorks = async (page: Page) => { const before = await step(page); await page.getByRole("button", { name: "Next step" }).click(); expect(await step(page)).toBe(before + 1); };
const PAGES: Probe[] = [
  { path: "/visual/tree", title: "Tree Explorer", interact: async (page) => {
    const label = async () => (await page.getByRole("img", { name: /tree/i }).first().getAttribute("aria-label")) ?? "";
    const before = await label();
    await page.getByLabel("Value").fill("9999");
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(bar(page)).toBeVisible();
    await bar(page).focus(); await page.keyboard.press("End");
    expect(await total(page)).toBeGreaterThan(1);
    await expect.poll(label).not.toBe(before); // the drawn tree now has the new node
  } },
  { path: "/visual/graph", title: "Graph Explorer", interact: async (page) => {
    await expect(bar(page)).toBeVisible();
    await nextStepWorks(page);
    await page.getByLabel("Algorithm").selectOption({ index: 1 });
    await expect(bar(page)).toBeVisible();
    expect(await step(page)).toBe(1); // a new algorithm restarts the player
  } },
  { path: "/visual/excel", title: "Excel Lab", interact: async (page) => {
    await expect(page.getByRole("grid").first()).toBeVisible();
    await page.getByLabel("Selected cell").fill("J20");
    await page.getByLabel("Formula bar").fill("=2+3");
    await page.getByLabel("Formula bar").press("Enter");
    await expect(page.getByRole("grid").first().getByLabel(/J20 formula =2\+3 value 5/)).toBeVisible();
  } },
  { path: "/visual/linux", title: "Linux Terminal Lab", interact: async (page) => { await expect(page.getByRole("textbox").first()).toBeVisible(); } },
  { path: "/visual/git", title: "Git Lab", interact: async (page) => {
    await page.getByRole("button", { name: "git status" }).click();
    await expect(page.getByRole("log", { name: "Terminal transcript" })).toContainText(/branch|nothing to commit|Changes/i);
  } },
  { path: "/visual/stats", title: "Statistics Lab", interact: async (page) => {
    const group = page.getByRole("group", { name: "Distribution" });
    const second = group.getByRole("button").nth(1);
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
  } },
  { path: "/visual/business", title: "Business Analytics Lab", interact: async (page) => {
    await expect(page.getByRole("list", { name: "KPI tiles" })).toBeVisible();
    const before = (await page.getByRole("list", { name: "KPI tiles" }).textContent()) ?? "";
    await page.getByText("Period type").locator("select").selectOption("month");
    await expect.poll(async () => (await page.getByRole("list", { name: "KPI tiles" }).textContent()) ?? "").not.toBe(before);
  } },
  { path: "/visual/interview", title: "Interview Walkthrough", interact: async (page) => { await expect(page.getByRole("button").first()).toBeVisible(); } },
];
const isPlaceholder = async (page: Page) => /is being built/i.test((await page.locator("main").textContent()) ?? "");

test.describe("New pages", () => {
  for (const p of PAGES) {
    test(`New pages: ${p.title} loads, shows its Help and responds`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto(p.path);
      await expect(page.getByRole("heading", { level: 1, name: p.title })).toBeVisible();
      test.skip(await isPlaceholder(page), `${p.title} is still the placeholder component ("is being built"): nothing to test yet`);
      const help = page.locator("details", { has: page.locator("summary", { hasText: "Help: how" }) }).first();
      await help.locator("summary").click();
      await expect(help.getByText("What it does.")).toBeVisible();
      await expect(help.getByText("Controls", { exact: true }).first()).toBeVisible();
      await help.locator("summary").click();
      await p.interact(page);
      await noHScroll(page);
    });
  }
});

// ── Responsive layout ────────────────────────────────────────────────────
test.describe("Responsive layout", () => {
  test("Responsive layout: no horizontal scroll on the hub and every visual page", async ({ page }) => {
    test.setTimeout(240_000);
    const bad: string[] = [];
    for (const path of ["/visual", "/visual/python", "/visual/data", "/visual/api", "/visual/etl", "/visual/charts", ...PAGES.map((p) => p.path)]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Let the page (and its lazy editor) finish loading before leaving: WebKit reports a script load that a navigation aborts as a "[object Event]" page error.
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) bad.push(`${path} (+${over}px)`);
    }
    expect(bad, "pages wider than the viewport").toEqual([]);
  });
  test("Responsive layout: the playback bar stays reachable (all controls visible) on this viewport", async ({ page }) => {
    await page.goto("/visual/api");
    for (const name of ["Restart", "Previous step", "Next step"]) await expect(page.getByRole("button", { name }).first()).toBeVisible();
    const box = await bar(page).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1);
    if (small(page)) expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
});

// ── Keyboard ─────────────────────────────────────────────────────────────
test.describe("Keyboard", () => {
  test("Keyboard: Space, arrows, Home and End on the playback bar", async ({ page }) => {
    await page.goto("/visual/api");
    await page.getByRole("tab", { name: "404 Not Found" }).click();
    const n = await total(page);
    expect(n).toBeGreaterThan(2);
    await bar(page).focus();
    await page.keyboard.press("ArrowRight");
    expect(await step(page)).toBe(2);
    await page.keyboard.press("ArrowRight");
    expect(await step(page)).toBe(3);
    await page.keyboard.press("ArrowLeft");
    expect(await step(page)).toBe(2);
    await page.keyboard.press("End");
    expect(await step(page)).toBe(n);
    await page.keyboard.press("Home");
    expect(await step(page)).toBe(1);
    await page.keyboard.press("Space");
    await expect(bar(page).getByRole("button", { name: "Pause" })).toBeVisible();
    await expect.poll(() => step(page), { timeout: 20_000 }).toBeGreaterThan(1); // it advances by itself
    await page.keyboard.press("Space");
    await expect(bar(page).getByRole("button", { name: "Play" })).toBeVisible();
    const held = await step(page);
    await page.waitForTimeout(1500);
    expect(await step(page)).toBe(held); // paused means paused
  });
  test("Keyboard: a focused control keeps working with the keys (Tab reaches the bar, the speed select is not hijacked)", async ({ page }) => {
    await page.goto("/visual/etl");
    await bar(page).focus();
    await page.keyboard.press("End");
    const last = await step(page);
    expect(last).toBe(await total(page));
    const speed = bar(page).getByLabel("Playback speed");
    await speed.focus();
    await page.keyboard.press("ArrowDown"); // changes the select, must not move the player
    expect(await step(page)).toBe(last);
  });
});

// ── Reduced motion ───────────────────────────────────────────────────────
test.describe("Reduced motion", () => {
  async function openRowFlow(page: Page) {
    await page.goto("/query-visualizer");
    await page.getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(bar(page)).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(page.getByTestId("rowflow").first()).toBeVisible();
    // The first frame is drawn from the stage sample; real row ids arrive a moment later ("looking up real row ids…"). Compare after that.
    await expect(page.getByText("looking up real row ids")).toHaveCount(0, { timeout: 60_000 });
    await page.waitForTimeout(300);
  }
  const cardIds = (page: Page) => page.locator('[data-testid="rowflow"] [data-card]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-card")))].sort());

  test("Reduced motion: row animation is static (no running animation or transition) and shows the same information", async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await openRowFlow(page);
    const flow = page.getByTestId("rowflow").first();
    await expect(flow).toHaveAttribute("data-reduced", "true");
    await expect(page.getByTestId("rowflow-static").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay" })).toHaveCount(0);
    const motion = await flow.evaluate((root) => {
      // The row-animation elements: the boards and their cards. (Buttons elsewhere in the block keep ordinary hover colour fades.)
      const all = [...root.querySelectorAll('[data-testid="rowflow-board"], [data-testid="rowflow-board"] *')] as HTMLElement[];
      const animated = typeof document.getAnimations === "function" ? document.getAnimations().filter((a) => { const t = (a.effect as KeyframeEffect | null)?.target; return t && root.contains(t); }).length : 0;
      const transitions = all.filter((e) => { const cs = getComputedStyle(e); return cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0.001) && cs.transitionProperty !== "none"; }).length; // site.css clamps reduced-motion durations to 0.01ms, which is no visible transition
      const cssAnimations = all.filter((e) => { const cs = getComputedStyle(e); return cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.001; }).length;
      return { animated, transitions, cssAnimations };
    });
    expect(motion, "running animations / transitions / CSS animations inside the row-flow").toEqual({ animated: 0, transitions: 0, cssAnimations: 0 });
    const reducedText = (await page.getByTestId("rowflow-live").first().textContent()) ?? "";
    const reducedCards = await cardIds(page);
    expect(reducedText.length).toBeGreaterThan(10);
    expect(reducedCards.length).toBeGreaterThan(0);

    // The same stage with full motion: the same sentence and the same rows (only the presentation differs).
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openRowFlow(page);
    await expect(page.getByTestId("rowflow").first()).toHaveAttribute("data-reduced", "false");
    expect((await page.getByTestId("rowflow-live").first().textContent()) ?? "").toBe(reducedText);
    expect(await cardIds(page)).toEqual(reducedCards);
  });

  test("Reduced motion: the player does not auto-play and the Graph Explorer draws static", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/visual/graph");
    await expect(bar(page)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await step(page)).toBe(1);
    await expect(page.locator('svg[data-reduced="true"]').first()).toBeVisible();
  });
});

// ── Equivalence in the browser: does tracing change what a run prints? ───
// The Python practice page runs code normally ("Run Script") and traces the latest run in "Explain your solution".
test.describe("Equivalence (browser)", () => {
  async function runThenTrace(page: Page, code: string, marker: string) {
    await page.goto("/practice/python/cart-line-total");
    if (small(page)) await page.getByRole("link", { name: /Jump to the workspace/ }).click();
    await editor(page, code);
    await page.getByRole("button", { name: /Run Script/ }).click();
    const consoleOut = page.getByLabel("Console Output");
    await expect(consoleOut).toContainText(marker, { timeout: 150_000 });
    const normal = ((await consoleOut.textContent()) ?? "").trim();
    const box = page.getByRole("region", { name: "Explain your solution" });
    await box.scrollIntoViewIfNeeded();
    await box.locator("summary").click();
    await box.getByRole("button", { name: "Explain visually" }).first().click();
    await expect(box.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 150_000 });
    await box.getByRole("group", { name: "Playback controls" }).focus();
    await page.keyboard.press("End");
    const traced = ((await box.getByLabel("Program output").textContent()) ?? "").trim();
    return { normal, traced };
  }

  test("Equivalence (browser): the same printed output with and without tracing, real Pyodide", async ({ page }) => {
    test.setTimeout(300_000);
    const { normal, traced } = await runThenTrace(page, "total = 0\nfor i in range(4):\n    total += i * i\nprint('total', total)\nprint(sorted({3, 1, 2}))\n", "total 14");
    expect(normal).toContain("total 14");
    expect(traced).toContain("total 14");
    expect(traced).toContain("[1, 2, 3]");
  });

  // Found in this browser run (Chromium, Pyodide 0.29.5), FIXED in pyTrace.ts: the plain run uses a dict that holds the worker's
  // setup names (`sys`, `importlib`) and has no `__name__` key; the tracer now builds the same namespace under Pyodide.
  // V2 scalability, real Pyodide: a long loop is sampled instead of recorded step by step, the program still finishes, and the
  // result line from the tracer reaches the page whole (it is far larger than the worker's 20,000-character print cap).
  for (const n of [10_000, 200_000]) {
    test(`Scale (browser): a ${n.toLocaleString("en-US")}-iteration loop is sampled, exact, and the program still finishes`, async ({ page }) => {
      test.setTimeout(300_000);
      const { normal } = await runThenTrace(page, `total = 0\nfor i in range(${n}): total += i\nprint('total', total)\n`, "total");
      const box = page.getByRole("region", { name: "Explain your solution" });
      const want = `total ${(n * (n - 1)) / 2}`;
      expect(normal).toContain(want);
      await expect(box.getByLabel("Program output")).toContainText(want);
      const note = box.getByRole("note", { name: "This trace is sampled" });
      await expect(note).toBeVisible();
      // The exact counts are reported even though most steps are not recorded: events in the notice, executions beside each line (the loop header runs n + 1 times).
      await expect(note).toContainText("traced events ran");
      // On a slower engine the 5 s trace budget can stop tracing early; the count is then shown as a lower bound ("≥×N") and the
      // notice says so. The program itself still finished (its output was checked above).
      const stopped = /stopped early/.test((await note.textContent()) ?? "");
      const src = box.getByRole("list", { name: "Source code" });
      if (stopped) await expect(src).toContainText(/≥×\d{1,3}(,\d{3})+/);
      else await expect(src).toContainText(`×${(n + 1).toLocaleString("en-US")}`);
    });
  }
  test("Equivalence (browser): `__name__` is the same with and without tracing", async ({ page }) => {
    test.setTimeout(300_000);
    const { normal, traced } = await runThenTrace(page, "print('name is', __name__)\n", "name is");
    expect(traced).toContain(normal.split("\n").find((l) => l.startsWith("name is")) ?? "NO NORMAL OUTPUT");
  });
  test("Equivalence (browser): a program that uses `sys` without importing it behaves the same with and without tracing", async ({ page }) => {
    test.setTimeout(300_000);
    const { normal, traced } = await runThenTrace(page, "print('major', sys.version_info[0])\n", "major");
    expect(traced).toContain(normal.split("\n").find((l) => l.startsWith("major")) ?? "NO NORMAL OUTPUT");
  });
});
