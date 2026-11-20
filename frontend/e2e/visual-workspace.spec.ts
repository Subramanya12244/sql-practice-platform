import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Python, pandas and NumPy visualization on the shared engines, in a real browser with real Pyodide. Nothing is mocked.
 * Covers: Run -> Visualize -> Step over/into/out/back on a Python exercise; a sampled long loop disabling stepping across its gap;
 * Python errors and their line numbers as Pyodide really prints them; /visual/data on the data adapter (old and new ?preset= ids,
 * groups before aggregation, merge keys, invalid broadcast and matmul with NumPy's own error text); pandas.read_csv from
 * ExerciseDef.files. Run on desktop and mobile; the first Pyodide start is slow, so timeouts are long.
 */
// Monaco rejects an internal promise with "Canceled" when an editor is disposed mid-request (a touch viewport triggers it on navigation). It is not an app error.
test.beforeEach(async ({ page }) => { page.on("pageerror", (e) => { if (e.message !== "Canceled") throw new Error(`page error: ${e.message}`); }); });
test.describe.configure({ timeout: 300_000 }); // the file-level test.setTimeout() does not apply; this does

const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
const bar = (page: Page) => page.getByRole("group", { name: "Playback controls" });
const stepOf = async (page: Page) => Number(/Step (\d+) of/.exec((await bar(page).getByRole("status").textContent()) ?? "")?.[1] ?? 0);
const totalOf = async (page: Page) => Number(/of (\d+)/.exec((await bar(page).getByRole("status").textContent()) ?? "")?.[1] ?? 0);

async function openWorkspace(page: Page, id: string, isMobile: boolean) {
  await page.goto(`/workspace?e=${encodeURIComponent(id)}`);
  await expect(page.getByTestId("exercise-workspace")).toBeVisible({ timeout: 60_000 });
  if (isMobile) await page.getByRole("tab", { name: "Editor" }).click();
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
}
const setCode = (page: Page, code: string) =>
  page.evaluate((c) => (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getModels()[0].setValue(c), code);
const tab = async (page: Page, isMobile: boolean, name: string) => { if (isMobile) await page.getByRole("tab", { name }).click(); };
const typeInEditor = async (p: Page, text: string) => { await p.locator(".monaco-editor").first().click(); await p.keyboard.press("ControlOrMeta+A"); await p.keyboard.insertText(text); };

const NESTED = [
  "def add(a, b):", "    total = a + b", "    return total", "",
  "def twice(x):", "    y = add(x, x)", "    return y", "",
  "def cart_total(items):", "    r = twice(3)", "    return 5.0", "",
  "r = twice(3)", "print(cart_total([{'price': 2.5, 'qty': 2}]))",
].join("\n");

test.describe("Python workspace: Run, Visualize, step over / into / out / back", () => {
  test("nested calls: step into goes inside, out comes back, over skips the call, back returns", async ({ page, isMobile }) => {
    await openWorkspace(page, "py:cart-line-total", !!isMobile);
    await setCode(page, NESTED);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByTestId("workspace-results")).toContainText("5.0", { timeout: 180_000 });
    await page.getByRole("button", { name: "Visualize" }).click();
    await tab(page, !!isMobile, "Visualization");
    const box = page.getByTestId("python-visualizer");
    await expect(box).toBeVisible({ timeout: 180_000 });
    const depth = async () => Number(/depth (\d+)/.exec((await page.getByTestId("step-position").textContent()) ?? "")?.[1]);
    // move to the call `r = twice(3)` on line 13
    for (let i = 0; i < 20 && !(await box.locator("li[data-mark='now']").textContent())?.includes("r = twice(3)"); i++) await page.getByRole("button", { name: "Next step" }).click();
    await expect(box.locator("li[data-mark='now']")).toContainText("r = twice(3)");
    expect(await depth()).toBe(1);
    await box.getByRole("button", { name: "Step into" }).click();
    expect(await depth()).toBe(2); // inside twice()
    await expect(page.getByTestId("step-note")).toContainText(/\S/);
    await box.getByRole("button", { name: "Step out" }).click();
    expect(await depth()).toBe(1);
    await box.getByRole("button", { name: "Step back" }).click();
    expect(await depth()).toBeGreaterThanOrEqual(1);
    // restart and use step over on the same call: it must not enter twice()
    await box.getByRole("button", { name: "Restart" }).click();
    for (let i = 0; i < 20 && !(await box.locator("li[data-mark='now']").textContent())?.includes("r = twice(3)"); i++) await box.getByRole("button", { name: "Step over" }).click();
    await box.getByRole("button", { name: "Step over" }).click();
    expect(await depth()).toBe(1);
    await expect(page.getByLabel("Variable inspector")).toContainText("r");
    await noHScroll(page);
  });

  test("a sampled long loop cannot be stepped across its gap; the jump is labelled as a jump", async ({ page, isMobile }) => {
    await openWorkspace(page, "py:cart-line-total", !!isMobile);
    await setCode(page, "t = 0\nfor i in range(5000):\n    t += i\nprint(t)\n");
    await page.getByRole("button", { name: "Visualize" }).click();
    await tab(page, !!isMobile, "Visualization");
    await expect(page.getByTestId("python-visualizer")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("sampled-notice")).toBeVisible();
    await page.getByRole("button", { name: "Next gap" }).click();
    await expect(page.getByTestId("gap-block")).toBeVisible();
    await expect(page.getByRole("button", { name: /Jump to step \d+ \(not a step\)/ })).toBeVisible();
    const stepButtons = ["Step into", "Step over", "Step back", "Step out"];
    const states = await Promise.all(stepButtons.map((n) => page.getByRole("button", { name: n, exact: true }).isDisabled()));
    expect(states.some(Boolean)).toBe(true);
    await expect(page.getByTestId("python-visualizer")).toContainText(/Python's sys\.settrace|sampled/);
  });
});

test.describe("Python errors and their line numbers in real Pyodide", () => {
  test("workspace: a failed Submit with an error inside the learner's function names that line", async ({ page, isMobile }) => {
    await openWorkspace(page, "py:cart-line-total", !!isMobile);
    await setCode(page, "def cart_total(items):\n    first = items[99]\n    return first\n");
    await page.getByRole("button", { name: "Submit" }).click();
    await tab(page, !!isMobile, "Results");
    const fb = page.getByRole("region", { name: "Feedback" });
    await expect(fb).toBeVisible({ timeout: 180_000 });
    await expect(fb).toContainText("line 2");
    await expect(fb).toContainText(/IndexError/);
  });

  test("Pyodide prints <exec> frames with NO source text; the practice page still names the learner's own line and never a test line", async ({ page, isMobile }) => {
    await page.goto("/practice/python/cart-line-total");
    if (isMobile) await page.getByRole("link", { name: /Jump to the workspace/ }).click();
    await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
    await setCode(page, "def cart_total(items):\n    first = items[99]\n    return first\n"); // setValue: typing multi-line code into Monaco adds auto-indent and causes an IndentationError
    await page.getByRole("button", { name: /Check Tests/ }).click();
    const help = page.getByTestId("py-failure-help");
    await expect(help).toBeVisible({ timeout: 180_000 });
    await expect(help).toContainText(/IndexError/);
    await expect(help).toContainText("line 2");
    // The raw traceback Pyodide produced: every frame is <exec>, and no frame has a source line under it.
    const raw = await page.getByLabel("Console Output").locator("pre").first().textContent();
    expect(raw).toMatch(/File "<exec>", line 2, in cart_total/);
    expect(raw).not.toMatch(/^\s{4}\S/m);
    // a failed assert (wrong answer, no error) must not claim a line of the learner's code
    await setCode(page, "def cart_total(items):\n    return 0\n");
    await page.getByRole("button", { name: /Check Tests/ }).click();
    await expect(page.getByText(/Tests Incomplete/)).toBeVisible({ timeout: 120_000 });
    expect((await page.getByTestId("py-failure-help").allTextContents()).join(" ")).not.toMatch(/line 1\b/);
    // a plain Run error from the file's own code
    await setCode(page, "items = [1]\nprint(items[3])\n");
    await page.getByRole("button", { name: /Run Script/ }).click();
    await expect(page.getByTestId("py-failure-help")).toContainText(/IndexError/, { timeout: 120_000 });
  });

  test("workspace: errors name the line, and the Python visualizer ends on the exception with its diagnosis", async ({ page, isMobile }) => {
    await openWorkspace(page, "py:cart-line-total", !!isMobile);
    await setCode(page, "def f(a):\n    return a[5]\n\ndef g():\n    return f([1])\n\ng()\n");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await tab(page, !!isMobile, "Results");
    await expect(page.getByTestId("workspace-results").getByRole("alert")).toContainText("(line 2)", { timeout: 180_000 });
    await page.getByRole("button", { name: "Visualize" }).click();
    await tab(page, !!isMobile, "Visualization");
    await expect(page.getByTestId("python-visualizer")).toBeVisible({ timeout: 180_000 });
    await page.getByRole("button", { name: "Go to the exception" }).click();
    await expect(page.getByTestId("diagnosis")).toContainText(/IndexError/);
    await expect(page.getByTestId("diagnosis")).toContainText(/line 2/);
    expect(await page.getByLabel("Call stack, innermost first").getByRole("listitem").count()).toBe(3);
  });
});

test.describe("/visual/data on the shared data adapter", () => {
  const runStudio = async (page: Page) => {
    await page.getByRole("button", { name: "Explain visually" }).click();
    await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 240_000 });
    await expect(bar(page)).toBeVisible();
  };
  // A stage can be several beats now (a step is a beat), so go by the stage heading, not by the step number.
  const goToStage = async (page: Page, i: number) => { for (let k = 0; k < 80 && !(await page.getByText(new RegExp(`Stage ${i} of \\d+`)).first().isVisible()); k++) await page.getByRole("button", { name: "Next step" }).click(); };
  // Beats that have their own picture keep the full stage (every table, the merge keys, the shapes) in a collapsed block.
  const openDetails = async (page: Page) => { const d = page.getByTestId("stage-details"); if ((await d.count()) && !(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator("summary").click(); };

  test("old ?preset= ids, new ids and aliases open on the right example", async ({ page }) => {
    const expectCode = async (q: string, snippet: string) => {
      await page.goto(`/visual/data${q}`);
      await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
      const code = await page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco.editor.getModels()[0].getValue());
      expect(code, q).toContain(snippet);
    };
    await expectCode("?preset=numpy-broadcasting", "a + col");
    await expectCode("?preset=filter-and-sort", "sort_values");
    await expectCode("?preset=pd-merge", "how='outer'");
    await expectCode("?preset=groupby", "groupby('team')");
    await expectCode("?preset=np-broadcast-bad", "np.ones(4)");
    await expectCode("?preset=nonsense", "sort_values"); // unknown id: the old default example
    await expect(page.getByRole("button", { name: "Filter and sort" })).toHaveAttribute("aria-pressed", "true");
  });

  test("groupby shows the groups before the aggregate, with the exact group sizes", async ({ page }) => {
    await page.goto("/visual/data?preset=groupby-and-aggregate");
    await runStudio(page);
    const n = await totalOf(page);
    let seen = false;
    for (let i = 0; i < n && !seen; i++) {
      seen = await page.locator("[data-group-view]").first().isVisible();
      if (!seen) await page.getByRole("button", { name: "Next step" }).click();
    }
    expect(seen).toBe(true);
    await expect(page.locator("[data-group-view]").first()).toContainText(/2 groups by team from 5 rows/);
    await expect(page.locator("[data-group-view]").first()).toContainText(/group a/);
    await noHScroll(page);
  });

  test("merge shows matched and unmatched keys", async ({ page }) => {
    await page.goto("/visual/data?preset=merge");
    await runStudio(page);
    const n = await totalOf(page);
    let seen = false;
    for (let i = 0; i < n && !seen; i++) {
      seen = (await page.getByText("Matched keys").count()) > 0; // in the merge stage's full panel (collapsed under its pictures)
      if (!seen) await page.getByRole("button", { name: "Next step" }).click();
    }
    expect(seen).toBe(true);
    await openDetails(page);
    await expect(page.getByText("Matched keys").first()).toBeVisible();
    await expect(page.getByText("Left only").first()).toBeVisible();
    await expect(page.getByText("Right only").first()).toBeVisible();
    await expect(page.getByText(/keys 2, 4/).first()).toBeVisible(); // users 2 and 4 have no order
    await expect(page.getByText(/keys 9/).first()).toBeVisible(); // order for user 9 has no user
  });

  test("filter and sort: rows retained and removed come from the real run", async ({ page }) => {
    await page.goto("/visual/data");
    await runStudio(page);
    await goToStage(page, 3);
    await openDetails(page);
    await expect(page.getByText(/4 in, 3 retained, 1 removed, 3 out/).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tables and arrays" })).toHaveAttribute("aria-selected", "true");
    await bar(page).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("table", { name: /Current value|After|Before|Result/ }).first()).toBeVisible();
  });

  test("invalid broadcast: the failing stage shows the conflicting axis and NumPy's real error text", async ({ page }) => {
    await page.goto("/visual/data?preset=np-broadcast-bad");
    await runStudio(page);
    await expect.poll(async () => (await stepOf(page)) === (await totalOf(page)) && (await totalOf(page)) > 1).toBe(true); // opens on the stage that raised
    await expect(page.getByRole("alert").filter({ hasText: /operands could not be broadcast together with shapes \(3,2\) \(4,2\)|shapes \(2,3\) \(4,\)/ }).first()).toBeVisible();
    await expect(page.getByText(/incompatible|mismatch|cannot/i).first()).toBeVisible();
    await expect(page.getByTestId("data-feedback")).toBeVisible();
  });

  test("the exact case np.ones((3,2)) + np.ones((4,2)): axis 0 (3 vs 4) is the conflict and the error is NumPy's own", async ({ page, isMobile }) => {
    await page.goto("/visual/data");
    await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
    await typeInEditor(page, "import numpy as np\na = np.ones((3, 2))\nb = np.ones((4, 2))\nc = a + b\n");
    await runStudio(page);
    await expect(page.getByRole("alert").filter({ hasText: "operands could not be broadcast together with shapes (3,2) (4,2)" }).first()).toBeVisible();
    await expect(page.getByText(/ValueError/).first()).toBeVisible();
    await expect(page.getByText(/axis 0|3 vs 4|3 and 4/i).first()).toBeVisible();
    if (!isMobile) await expect(page.getByRole("list", { name: "Source code" }).locator("[aria-current]")).toContainText("c = a + b");
    await noHScroll(page);
  });

  test("invalid matmul shows the inner-dimension rule and NumPy's real error", async ({ page }) => {
    await page.goto("/visual/data?preset=np-matmul-bad");
    await runStudio(page);
    // The NumPy beat picture and the (collapsed) stage details both carry the marker; the visible one is the one the learner sees.
    await expect(page.locator("[data-matmul-valid='false']:visible")).toBeVisible();
    await expect(page.getByText(/NumPy said:/).first()).toBeVisible();
    await expect(page.getByText(/matmul: Input operand 1 has a mismatch in its core dimension 0/).first()).toBeVisible();
  });

  test("Run alone shows output without the stage view; a valid broadcast shows the alignment table", async ({ page }) => {
    await page.goto("/visual/data?preset=np-broadcast-ok");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("region", { name: "Run output" })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByRole("list", { name: "Source code" })).toHaveCount(0);
    await page.getByRole("button", { name: "Explain visually" }).click();
    await expect(page.getByRole("list", { name: "Source code" })).toBeVisible({ timeout: 240_000 });
    const n = await totalOf(page);
    let seen = false;
    for (let i = 0; i < n && !seen; i++) { seen = await page.getByText("Broadcasting", { exact: true }).first().isVisible(); if (!seen) await page.getByRole("button", { name: "Next step" }).click(); }
    expect(seen).toBe(true);
  });

  test("pandas.read_csv from ExerciseDef.files runs through the data adapter in the same Pyodide and is staged", async ({ page }) => {
    await page.goto("/visual/data");
    // Needs the source modules, which only the Vite dev server serves (a built copy has no /src).
    const dev = await page.evaluate(() => fetch("/src/site/lib/pyRunner.ts").then((r) => (r.headers.get("content-type") ?? "").includes("javascript")).catch(() => false));
    test.skip(!dev, "needs the Vite dev server: the built copy has no /src modules");
    const out = await page.evaluate(async () => {
      const { pandasAdapter } = await import("/src/site/workspace/adapters/data/adapter.ts");
      const exercise = {
        id: "files:csv", domain: "pandas", source: { kind: "authored", id: "csv" }, title: "csv", difficulty: "Easy", topic: "t", statement: "", objectives: [], concepts: [], starterCode: "",
        validation: { kind: "none" }, hints: [], files: { "sales.csv": "city,amount\nOslo,10\nRome,7\nLima,\n" },
      };
      const code = "import pandas as pd\ndf = pd.read_csv('sales.csv')\ntotal = df['amount'].sum()\nprint(df.shape)\n";
      const ctx = { exercise: exercise as never };
      const run = await pandasAdapter.run(code, ctx);
      const model = await pandasAdapter.visualize!(code, run, ctx);
      const d = model?.data as { stages: { code: string; output: { shape?: number[] } | null }[]; ok: boolean } | undefined;
      return { status: run.status, stdout: run.stdout, shapes: d?.stages.map((s) => s.output?.shape ?? null), ok: d?.ok };
    });
    expect(out.status).toBe("ok");
    expect(out.stdout?.trim()).toBe("(3, 2)");
    expect(out.shapes?.some((s) => s && s[0] === 3 && s[1] === 2)).toBe(true);
  });

  test("no horizontal scroll with the stage view open", async ({ page }) => {
    await page.goto("/visual/data?preset=pd-merge");
    await runStudio(page);
    await noHScroll(page);
  });
});
